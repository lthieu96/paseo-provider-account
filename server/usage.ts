// API contracts adapted from Paseo v0.10.3 quota-fetcher (Apache-2.0).
// See THIRD-PARTY-NOTICES.md. Credentials are scoped to the selected profile.
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { UsageReport, UsageWindow } from "../shared/usage.ts";

const execFileAsync = promisify(execFile);
const profileSchema = z
  .object({
    extends: z.string(),
    label: z.string(),
    env: z.record(z.string(), z.string()).default({}),
  })
  .passthrough();
type UsageProfile = z.infer<typeof profileSchema>;
type Credential = {
  token: string;
  accountId?: string;
  plan?: string;
  source: string;
};
const claudeCredentialSchema = z.object({
  claudeAiOauth: z.object({
    accessToken: z.string(),
    subscriptionType: z.string().optional(),
  }),
});
const codexCredentialSchema = z.object({
  tokens: z.object({
    access_token: z.string(),
    account_id: z.string().optional(),
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
  if (profile.extends === "claude") {
    if (env.ANTHROPIC_API_KEY?.trim() || env.ANTHROPIC_AUTH_TOKEN?.trim())
      return null;
    if (
      env.ANTHROPIC_BASE_URL &&
      new URL(env.ANTHROPIC_BASE_URL).origin !== "https://api.anthropic.com"
    )
      return null;
    for (const key of [
      "CLAUDE_CODE_USE_BEDROCK",
      "CLAUDE_CODE_USE_VERTEX",
      "CLAUDE_CODE_USE_FOUNDRY",
      "CLAUDE_CODE_USE_ANTHROPIC_AWS",
      "CLAUDE_CODE_USE_MANTLE",
    ])
      if (env[key]) return null;
    // Usage is read from the CLI login only; a token in the environment takes over and is not reported.
    if (env.CLAUDE_CODE_OAUTH_TOKEN?.trim()) return null;
    const selected = env.CLAUDE_CONFIG_DIR || process.env.CLAUDE_CONFIG_DIR;
    const home = selected || join(homedir(), ".claude");
    if (!isAbsolute(home)) return null;
    let raw: unknown = null;
    if (process.platform === "darwin") {
      const service = `Claude Code-credentials${selected ? `-${createHash("sha256").update(selected).digest("hex").slice(0, 8)}` : ""}`;
      try {
        const result = await execFileAsync(
          "security",
          [
            "find-generic-password",
            "-a",
            process.env.USER || userInfo().username,
            "-w",
            "-s",
            service,
          ],
          { timeout: 2000, maxBuffer: 1024 * 1024 },
        );
        raw = JSON.parse(result.stdout);
      } catch {
        /* No fallback to another keychain account or directory. */
      }
    }
    let parsed = claudeCredentialSchema.safeParse(raw);
    if (!parsed.success)
      parsed = claudeCredentialSchema.safeParse(
        await credentialFile(join(home, ".credentials.json")),
      );
    if (!parsed.success || !parsed.data.claudeAiOauth.accessToken) return null;
    return {
      token: parsed.data.claudeAiOauth.accessToken,
      plan: parsed.data.claudeAiOauth.subscriptionType,
      source: selected ? "Selected CLI account" : "Default CLI account",
    };
  }
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
      source: "Selected Codex account",
    };
  }
  return null;
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
        const auth = await readCredential(profile);
        if (!auth)
          return {
            ...base,
            message:
              "No usage data for this sign-in method.",
          };
        base.source = auth.source;
        base.planLabel = auth.plan || null;
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
            cache.set(id, { revision, until: now() + 300000, result });
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
