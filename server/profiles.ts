import { createHash } from "node:crypto";
import { URL } from "node:url";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import {
  claudeAuthVariables,
  providers,
  providerSchema,
  saveInputSchema,
  changeInputSchema,
  type Profile,
  type SaveInput,
} from "../shared/profiles.ts";

// Preserve provider-private fields while only returning public profile metadata.
const definitionSchema = z
  .object({
    extends: z.string().optional(),
    label: z.string().optional(),
    enabled: z.boolean().optional(),
    env: z.record(z.string(), z.string()).optional(),
    command: z.array(z.string()).optional(),
    models: z
      .array(z.object({ id: z.string(), label: z.string() }).passthrough())
      .optional(),
    additionalModels: z
      .array(z.object({ id: z.string(), label: z.string() }).passthrough())
      .optional(),
  })
  .passthrough();
type Definition = z.infer<typeof definitionSchema>;
type ProfileContext = { paseo: Pick<PluginHandlerContext["paseo"], "config"> };

const officialClaudeApi = "https://api.anthropic.com";

function legacySignIn(provider: Profile["provider"], env: Record<string, string> = {}) {
  if (provider === "claude")
    return claudeAuthVariables.some((key) => {
      const value = env[key]?.trim();
      return key === "ANTHROPIC_BASE_URL" ? !!value && value !== officialClaudeApi : !!value;
    });
  if (provider === "codex") return !!(env.OPENAI_API_KEY?.trim() || env.OPENAI_BASE_URL?.trim());
  return false;
}

// Claude and Codex accounts sign in only through their official CLI login, kept in the account folder.
// Every variable that would select another credential or backend is blanked, including values the
// provider would otherwise inherit from the daemon. Other agents keep their own env.
function applySignIn(env: Record<string, string>, input: SaveInput) {
  const home = input.homeDirectory.trim();
  if (input.provider !== "claude" && input.provider !== "codex") {
    if (home) throw new Error("Use environment variables for this agent's account folder.");
    return env;
  }
  const homeVariable = input.provider === "claude" ? "CLAUDE_CONFIG_DIR" : "CODEX_HOME";
  if (home) {
    validateEnvironment({ [homeVariable]: home });
    env[homeVariable] = home;
  }
  if (input.provider === "claude") {
    // Older Claude CLIs treat the string "0" as true, so flags are blanked rather than set to "0".
    for (const key of claudeAuthVariables) env[key] = "";
    env.ANTHROPIC_BASE_URL = officialClaudeApi;
  } else {
    env.OPENAI_API_KEY = "";
    env.OPENAI_BASE_URL = "";
  }
  return env;
}

function revision(definition: Definition) {
  return createHash("sha256").update(JSON.stringify(definition)).digest("hex");
}

async function read({ paseo }: ProfileContext) {
  const { config } = await paseo.config.get();
  return Object.fromEntries(
    Object.entries(config.providers).map(([id, value]) => [
      id,
      definitionSchema.parse(value),
    ]),
  );
}

function list(definitions: Record<string, Definition>) {
  const profiles: Profile[] = [];
  for (const [id, item] of Object.entries(definitions)) {
    const provider = providerSchema.safeParse(item.extends);
    if (!provider.success) continue; // Leave built-in overrides to Paseo settings.
    profiles.push({
      id,
      label: item.label ?? id,
      provider: provider.data,
      enabled: item.enabled !== false,
      envKeys: Object.keys(item.env ?? {}).sort(),
      legacySignIn: legacySignIn(provider.data, item.env),
      homeDirectory:
        item.env?.[
          provider.data === "claude"
            ? "CLAUDE_CONFIG_DIR"
            : provider.data === "codex"
              ? "CODEX_HOME"
              : ""
        ] || null,
      command: item.command ?? [],
      models: (item.models ?? []).map(({ id, label }) => ({ id, label })),
      additionalModels: (item.additionalModels ?? []).map(({ id, label }) => ({
        id,
        label,
      })),
      revision: revision(item),
    });
  }
  return { profiles: profiles.sort((a, b) => a.label.localeCompare(b.label)) };
}

function checkedProfile(
  definitions: Record<string, Definition>,
  id: string,
  expected: string,
) {
  const item = definitions[id];
  if (
    !Object.hasOwn(definitions, id) ||
    !item?.extends ||
    providers.some((provider) => provider === id)
  )
    throw new Error(
      "Only accounts added here can be edited. Built-in providers stay in Paseo settings.",
    );
  if (revision(item) !== expected)
    throw new Error("This account changed elsewhere. Refresh and try again.");
  return item;
}

function validateEnvironment(env: Record<string, string>) {
  for (const [key, value] of Object.entries(env)) {
    if (
      key === "__proto__" ||
      key === "prototype" ||
      key === "constructor" ||
      value.includes("\0")
    )
      throw new Error("Enter a valid environment variable.");
    if (key === "CLAUDE_CONFIG_DIR" || key === "CODEX_HOME") {
      if (!value.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(value))
        throw new Error(`${key} needs an absolute path on the daemon host.`);
    }
    if ((key === "ANTHROPIC_BASE_URL" || key === "OPENAI_BASE_URL") && value) {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        throw new Error(`${key} needs a valid URL.`);
      }
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new Error(
          `${key} needs an HTTP(S) URL without credentials, query or fragment.`,
        );
    }
  }
}

export function createProfileHandlers() {
  // ponytail: serialize this plugin's mutations; revision checks catch external edits seen before each request.
  let tail: Promise<unknown> = Promise.resolve();
  function serial<T>(run: () => Promise<T>): Promise<T> {
    const result = tail.then(run);
    tail = result.catch(() => {});
    return result;
  }
  return {
    async list(_input: object, context: ProfileContext) {
      return list(await read(context));
    },
    save(raw: z.infer<typeof saveInputSchema>, context: ProfileContext) {
      return serial(async () => {
        const input = saveInputSchema.parse(raw);
        if (providers.some((provider) => provider === input.id))
          throw new Error(
            "Choose a separate ID, such as claude-work or codex-personal.",
          );
        const definitions = await read(context);
        let previous: Definition = {};
        if (input.revision === null) {
          if (Object.hasOwn(definitions, input.id))
            throw new Error(
              "This ID already exists. Edit that account or choose a new ID.",
            );
        } else {
          previous = checkedProfile(definitions, input.id, input.revision);
          if (previous.extends !== input.provider)
            throw new Error("Create a new account to change its provider.");
        }
        if (input.provider === "acp" && input.command.length === 0)
          throw new Error('ACP needs a command, such as ["gemini", "--acp"].');
        if (previous.command?.length && input.command.length === 0)
          throw new Error(
            "Create a new account to return to the default command.",
          );
        validateEnvironment(input.env);
        const env = applySignIn({ ...previous.env, ...input.env }, input);
        const additionalModels = [...new Set(input.additionalModels)].map(
          (id) =>
            previous.additionalModels?.find((model) => model.id === id) ?? {
              id,
              label: id,
            },
        );
        const definition: Definition = {
          ...previous,
          extends: input.provider,
          label: input.label,
          enabled: previous.enabled ?? true,
          env,
          additionalModels,
          ...(input.command.length ? { command: input.command } : {}),
        };
        // v0.10.3 deep-merges env in memory but replaces it on disk: always send the complete merged env.
        await context.paseo.config.patch({
          providers: { [input.id]: definition },
        });
        return list(await read(context));
      });
    },
    change(raw: z.infer<typeof changeInputSchema>, context: ProfileContext) {
      return serial(async () => {
        const input = changeInputSchema.parse(raw);
        const definitions = await read(context);
        const previous = checkedProfile(definitions, input.id, input.revision);
        if (input.action === "delete") {
          await context.paseo.config.patch({ removeProviders: [input.id] });
        } else {
          await context.paseo.config.patch({
            providers: {
              [input.id]: { ...previous, enabled: input.action === "enable" },
            },
          });
        }
        return list(await read(context));
      });
    },
  };
}
