// Credentials are scoped to the selected profile.
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { UsageReport, UsageWindow } from "../shared/usage.ts";

const profileSchema = z
  .object({
    extends: z.string(),
    label: z.string(),
    env: z.record(z.string(), z.string()).default({}),
    command: z.array(z.string()).optional(),
  })
  .passthrough();
type UsageProfile = z.infer<typeof profileSchema>;
type Credential = {
  token: string;
  accountId?: string;
  email?: string;
  source: string;
};
const codexCredentialSchema = z.object({
  tokens: z.object({
    access_token: z.string(),
    account_id: z.string().optional(),
    id_token: z.string().optional(),
  }),
});
const objectSchema = z.record(z.string(), z.unknown());

function number(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function date(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}
function window(
  id: string,
  label: string,
  used: unknown,
  resets: unknown,
): UsageWindow {
  const value = number(used);
  const usedPct = value === null ? null : Math.max(0, Math.min(100, value));
  return {
    id,
    label,
    usedPct,
    remainingPct: usedPct === null ? null : 100 - usedPct,
    resetsAt: date(resets),
  };
}
function record(value: unknown): Record<string, unknown> {
  return objectSchema.safeParse(value).data || {};
}

export function normalizeClaudeUsage(raw: unknown): UsageWindow[] {
  const data = record(raw);
  const windows: UsageWindow[] = [];
  const legacyScopes: Array<{
    dimension: string;
    id: string | null;
    name: string;
    used: unknown;
    resets: unknown;
  }> = [];
  for (const [field, label] of [
    ["five_hour", "5-hour limit"],
    ["seven_day", "7-day limit"],
  ]) {
    if (data[field]) {
      const value = record(data[field]);
      windows.push(window(field, label, value.utilization, value.resets_at));
    }
  }
  for (const [field, value] of Object.entries(data)) {
    if (field.startsWith("seven_day_") && value) {
      const limit = record(value);
      const name = field.slice(10).replaceAll("_", " ");
      legacyScopes.push({
        dimension: "model",
        id: null,
        name,
        used: limit.utilization,
        resets: limit.resets_at,
      });
    }
  }
  const scopes = [...legacyScopes];
  for (const entry of Array.isArray(data.limits) ? data.limits : []) {
    const limit = record(entry);
    if (limit.kind !== "weekly_scoped") continue;
    const scope = record(limit.scope);
    for (const dimension of ["model", "surface"]) {
      const item = record(scope[dimension]);
      const id = typeof item.id === "string" ? item.id : null;
      const name =
        typeof item.display_name === "string" ? item.display_name : id;
      if (!name) continue;
      const found = scopes.findIndex(
        (old) =>
          old.dimension === dimension &&
          (old.id && id
            ? old.id === id
            : old.name.toLowerCase().replace(/[^a-z0-9]/g, "") ===
              name.toLowerCase().replace(/[^a-z0-9]/g, "")),
      );
      const old = found >= 0 ? scopes[found] : undefined;
      const value = {
        dimension,
        id,
        name,
        used: limit.percent ?? old?.used,
        resets: limit.resets_at ?? old?.resets,
      };
      if (found >= 0) scopes[found] = value;
      else scopes.push(value);
      break;
    }
  }
  const taken = new Set<string>();
  for (const scope of scopes) {
    const base = `weekly_${scope.dimension}_${scope.id || scope.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
    let id = base;
    for (let suffix = 2; taken.has(id); suffix++) id = `${base}_${suffix}`;
    taken.add(id);
    windows.push(
      window(id, `Weekly · ${scope.name}`, scope.used, scope.resets),
    );
  }
  return windows;
}

export function normalizeCodexUsage(raw: unknown): {
  windows: UsageWindow[];
  planLabel: string | null;
} {
  const data = record(raw);
  const rate = record(data.rate_limit);
  const review = record(data.code_review_rate_limit);
  const windows: UsageWindow[] = [];
  for (const [id, label, rawWindow] of [
    ["primary", "Primary limit", rate.primary_window],
    ["secondary", "Secondary limit", rate.secondary_window],
    ["review", "Code review", review.primary_window],
  ] as const) {
    if (!rawWindow) continue;
    const value = record(rawWindow);
    const seconds = number(value.limit_window_seconds);
    const named =
      seconds && seconds > 0 && seconds % 86400 === 0
        ? `${seconds / 86400}-day limit`
        : seconds && seconds > 0 && seconds % 3600 === 0
          ? `${seconds / 3600}-hour limit`
          : label;
    const reset = number(value.reset_at);
    windows.push(
      window(
        id,
        id === "review" ? label : named,
        value.used_percent,
        reset === null ? null : date(reset * 1000),
      ),
    );
  }
  return {
    windows,
    planLabel: typeof data.plan_type === "string" ? data.plan_type : null,
  };
}

// Reads the email claim without verifying the JWT: it is only displayed, never trusted.
export function jwtEmail(token: string | undefined): string | undefined {
  try {
    const claims = record(JSON.parse(Buffer.from(token?.split(".")[1] ?? "", "base64url").toString("utf8")));
    const profile = record(claims["https://api.openai.com/profile"]);
    const email = claims.email ?? profile.email;
    return typeof email === "string" ? email : undefined;
  } catch {
    return undefined;
  }
}

async function credentialFile(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function loadCredential(profile: UsageProfile): Promise<Credential | null> {
  // Match provider launch inheritance, including explicit empty-string overrides.
  const env = { ...process.env, ...profile.env };
  if (profile.extends === "codex") {
    if (env.OPENAI_API_KEY?.trim() || env.OPENAI_BASE_URL?.trim()) return null;
    const home =
      env.CODEX_HOME || process.env.CODEX_HOME || join(homedir(), ".codex");
    if (!isAbsolute(home)) return null;
    const parsed = codexCredentialSchema.safeParse(
      await credentialFile(join(home, "auth.json")),
    );
    if (!parsed.success || !parsed.data.tokens.access_token) return null;
    return {
      token: parsed.data.tokens.access_token,
      accountId: parsed.data.tokens.account_id,
      email: jwtEmail(parsed.data.tokens.id_token),
      source: "Selected Codex account",
    };
  }
  return null;
}

function supportsClaudeSubscriptionUsage(profile: UsageProfile): boolean {
  const env = { ...process.env, ...profile.env };
  if (
    env.ANTHROPIC_API_KEY?.trim() ||
    env.ANTHROPIC_AUTH_TOKEN?.trim() ||
    env.CLAUDE_CODE_OAUTH_TOKEN?.trim()
  )
    return false;
  try {
    if (
      env.ANTHROPIC_BASE_URL &&
      new URL(env.ANTHROPIC_BASE_URL).origin !== "https://api.anthropic.com"
    )
      return false;
  } catch {
    return false;
  }
  for (const key of [
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
    "CLAUDE_CODE_USE_ANTHROPIC_AWS",
    "CLAUDE_CODE_USE_MANTLE",
  ])
    if (env[key]) return false;
  return !env.CLAUDE_CONFIG_DIR || isAbsolute(env.CLAUDE_CONFIG_DIR);
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) =>
    signal.addEventListener("abort", () => resolve(), { once: true }),
  );
}

async function resolveClaudeExecutable(
  profile: UsageProfile,
  env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  // On Windows, the configured command is often a .cmd shim that the SDK cannot spawn.
  if (process.platform === "win32") return undefined;
  const command = profile.command?.[0] || "claude";
  const candidates = command.includes("/")
    ? [resolve(command)]
    : (env.PATH || "").split(delimiter).map((directory) => join(directory, command));
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Try the next PATH entry.
    }
  }
  throw new Error("Claude Code executable was not found on PATH.");
}

// The subset of @anthropic-ai/claude-agent-sdk used here. Paseo's plugin compiler follows type imports
// into the SDK, whose bundled .d.mts files reference paths that do not exist, so the SDK is loaded at
// runtime through a non-literal specifier and only these shapes are typed.
type SDKControlGetUsageResponse = {
  subscription_type?: string | null;
  rate_limits_available?: boolean;
  rate_limits?: Record<string, unknown> & {
    model_scoped?: Array<{ utilization: unknown; resets_at: unknown; display_name: string }>;
  };
};
type ClaudeSession = {
  initializationResult(): Promise<{
    account?: { email?: string; tokenSource?: string; subscriptionType?: string };
  }>;
  usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(options: {
    skipBehaviors: boolean;
  }): Promise<SDKControlGetUsageResponse>;
  close(): void;
};
type ClaudeQuery = (input: { prompt: AsyncIterable<never>; options: Record<string, unknown> }) => ClaudeSession;
const claudeSdk = "@anthropic-ai/claude-agent-sdk";
let claudeQuery: Promise<ClaudeQuery> | undefined;
function loadClaudeQuery() {
  claudeQuery ??= import(claudeSdk).then(
    (sdk: { query: ClaudeQuery }) => sdk.query,
    (error: unknown) => {
      claudeQuery = undefined; // retry on the next refresh
      throw error;
    },
  );
  return claudeQuery;
}

async function readClaudeUsage(profile: UsageProfile): Promise<{
  response?: SDKControlGetUsageResponse;
  planLabel: string | null;
  email: string | null;
  signedOut: boolean;
}> {
  const abort = new AbortController();
  const env = {
    ...process.env,
    ...profile.env,
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
    CLAUDE_CODE_AUTO_CONNECT_IDE: "0",
    CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL: "1",
  };
  const executablePath = await resolveClaudeExecutable(profile, env);
  const session = (await loadClaudeQuery())({
    // Keep the CLI alive after initialization without sending a user prompt.
    prompt: (async function* (): AsyncGenerator<never> {
      await waitForAbort(abort.signal);
    })(),
    options: {
      abortController: abort,
      ...(executablePath
        ? { pathToClaudeCodeExecutable: executablePath }
        : {}),
      persistSession: false,
      settingSources: [],
      settings: { disableAllHooks: true },
      tools: [],
      allowedTools: [],
      mcpServers: {},
      strictMcpConfig: true,
      env,
      stderr: () => {},
    },
  });
  const timeout = setTimeout(() => abort.abort(), 15000);
  try {
    const initialized = await session.initializationResult();
    const account = initialized.account;
    if (account?.tokenSource === "none")
      return {
        planLabel: account.subscriptionType || null,
        email: account.email || null,
        signedOut: true,
      };
    const response = await session.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(
      { skipBehaviors: true },
    );
    return {
      response,
      planLabel: response.subscription_type || account?.subscriptionType || null,
      email: account?.email || null,
      signedOut: false,
    };
  } finally {
    clearTimeout(timeout);
    if (!abort.signal.aborted) abort.abort();
    session.close();
  }
}

function normalizeClaudeAgentUsage(
  response: SDKControlGetUsageResponse,
): UsageWindow[] {
  if (!response.rate_limits_available || !response.rate_limits) return [];
  const scoped = response.rate_limits.model_scoped?.map((limit) => ({
    kind: "weekly_scoped",
    percent: limit.utilization,
    resets_at: limit.resets_at,
    scope: { model: { display_name: limit.display_name } },
  }));
  return normalizeClaudeUsage({
    ...response.rate_limits,
    ...(scoped ? { limits: scoped } : {}),
  });
}

type UsageContext = { paseo: Pick<PluginHandlerContext["paseo"], "config"> };
export function createUsageHandler(
  options: {
    fetchApi?: typeof fetch;
    readCredential?: typeof loadCredential;
    now?: () => number;
  } = {},
) {
  const fetchApi = options.fetchApi || fetch;
  const readCredential = options.readCredential || loadCredential;
  // Explicit credential injection keeps the HTTP adapter controllable in callers and tests.
  const useInjectedCredentialReader = options.readCredential !== undefined;
  const now = options.now || Date.now;
  const cache = new Map<
    string,
    { revision: string; until: number; result: UsageReport }
  >();
  const pending = new Map<string, Promise<UsageReport>>();
  return async function usage(
    { force }: { force: boolean },
    { paseo }: UsageContext,
  ) {
    const { config } = await paseo.config.get();
    const profiles = Object.entries(config.providers).flatMap(([id, raw]) => {
      const parsed = profileSchema.safeParse(raw);
      return parsed.success ? [{ id, profile: parsed.data }] : [];
    });
    const validIds = new Set(profiles.map(({ id }) => id));
    for (const id of cache.keys()) if (!validIds.has(id)) cache.delete(id);
    async function query(
      id: string,
      profile: UsageProfile,
    ): Promise<UsageReport> {
      const base: UsageReport = {
        profileId: id,
        label: profile.label,
        provider: profile.extends,
        status: "unavailable",
        source: "Account",
        planLabel: null,
        email: null,
        fetchedAt: new Date(now()).toISOString(),
        windows: [],
        message: null,
      };
      if (!["claude", "codex"].includes(profile.extends))
        return {
          ...base,
          message:
            "Usage is available for Claude and Codex.",
        };
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        if (profile.extends === "claude" && !useInjectedCredentialReader) {
          if (!supportsClaudeSubscriptionUsage(profile))
            return {
              ...base,
              message: "No usage data for this sign-in method.",
            };
          base.source = "Claude Code CLI";
          const result = await readClaudeUsage(profile);
          if (result.signedOut)
            return {
              ...base,
              message: "Claude Code is signed out. Sign in again.",
            };
          base.planLabel = result.planLabel;
          base.email = result.email;
          base.windows = result.response
            ? normalizeClaudeAgentUsage(result.response)
            : [];
          return base.windows.length
            ? { ...base, status: "available" }
            : { ...base, message: "No limits reported." };
        }
        const auth = await readCredential(profile);
        if (!auth)
          return {
            ...base,
            message:
              "No usage data for this sign-in method.",
          };
        base.source = auth.source;
        base.email = auth.email ?? null;
        const headers: Record<string, string> = {
          Authorization: `Bearer ${auth.token}`,
          Accept: "application/json",
        };
        const url =
          profile.extends === "claude"
            ? "https://api.anthropic.com/api/oauth/usage"
            : "https://chatgpt.com/backend-api/wham/usage";
        if (profile.extends === "claude")
          headers["anthropic-beta"] = "oauth-2025-04-20";
        else {
          headers["User-Agent"] = "Mozilla/5.0";
          if (auth.accountId) headers["ChatGPT-Account-Id"] = auth.accountId;
        }
        const controller = new AbortController();
        timeout = setTimeout(() => controller.abort(), 15000);
        const response = await fetchApi(url, {
          headers,
          redirect: "error",
          signal: controller.signal,
        });
        if (response.status === 401)
          return {
            ...base,
            message:
              "Login expired. Sign in again.",
          };
        if (response.status === 403)
          return {
            ...base,
            message:
              "Usage access denied. Check this account's login.",
          };
        if (!response.ok)
          return {
            ...base,
            status: "error",
            message: `Usage service error (HTTP ${response.status}).`,
          };
        const data: unknown = await response.json();
        if (profile.extends === "claude")
          base.windows = normalizeClaudeUsage(data);
        else {
          const parsed = normalizeCodexUsage(data);
          base.windows = parsed.windows;
          base.planLabel = parsed.planLabel;
        }
        return base.windows.length
          ? { ...base, status: "available" }
          : {
              ...base,
              message: "No limits reported.",
            };
      } catch {
        return {
          ...base,
          status: "error",
          message:
            "Usage could not be read. Try again later.",
        };
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
    const reports = await Promise.all(
      profiles.map(async ({ id, profile }) => {
        const revision = createHash("sha256")
          .update(JSON.stringify(profile))
          .digest("hex");
        const saved = cache.get(id);
        if (!force && saved?.revision === revision && saved.until > now())
          return saved.result;
        const key = `${id}:${revision}`;
        if (pending.has(key)) return pending.get(key)!;
        const request = query(id, profile)
          .then((result) => {
            if (
              result.status === "available" ||
              result.message === "No limits reported." ||
              result.message ===
                "Usage access denied. Check this account's login."
            )
              cache.set(id, { revision, until: now() + 300000, result });
            else cache.delete(id);
            return result;
          })
          .finally(() => pending.delete(key));
        pending.set(key, request);
        return request;
      }),
    );
    return { reports };
  };
}
