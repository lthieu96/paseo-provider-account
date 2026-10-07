import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MutableDaemonConfigSchema,
  type MutableDaemonConfigPatch,
} from "@getpaseo/protocol/messages";
import { createProfileHandlers } from "./profiles.ts";
import { saveInputSchema, type SaveInput } from "../shared/profiles.ts";

function fixture() {
  let config = MutableDaemonConfigSchema.parse({
    mcp: { injectIntoAgents: true },
    providers: {
      claude: { enabled: true },
      "claude-work": {
        extends: "claude",
        label: "Work",
        env: {
          ANTHROPIC_API_KEY: "test-secret-only",
          CLAUDE_CONFIG_DIR: "/tmp/claude-work",
        },
        params: { customOption: { keep: true } },
        disallowedTools: ["WebSearch"],
        models: [
          {
            id: "fixed-model",
            label: "Fixed",
            thinkingOptions: [{ id: "high", label: "High" }],
          },
        ],
      },
    },
  });
  const patches: MutableDaemonConfigPatch[] = [];
  const context = {
    paseo: {
      config: {
        async get() {
          return { requestId: "test", config: structuredClone(config) };
        },
        async patch(patch: MutableDaemonConfigPatch) {
          patches.push(structuredClone(patch));
          // Model v0.10.3 in-memory merges; assert complete env is sent before that merge.
          for (const [id, value] of Object.entries(patch.providers ?? {})) {
            config.providers[id] = {
              ...config.providers[id],
              ...value,
              env: {
                ...Object(config.providers[id]?.env),
                ...Object(value.env),
              },
            };
          }
          for (const id of patch.removeProviders ?? [])
            delete config.providers[id];
          return { requestId: "test", config: structuredClone(config) };
        },
      },
    },
  };
  return {
    context,
    patches,
    handlers: createProfileHandlers(),
    config: () => config,
  };
}
// What every Claude account is saved with: competing credentials and backends blanked.
const cliLoginEnv = {
  ANTHROPIC_API_KEY: "",
  ANTHROPIC_AUTH_TOKEN: "",
  CLAUDE_CODE_OAUTH_TOKEN: "",
  ANTHROPIC_BASE_URL: "https://api.anthropic.com",
  ANTHROPIC_CUSTOM_HEADERS: "",
  CLAUDE_CODE_USE_BEDROCK: "",
  CLAUDE_CODE_USE_VERTEX: "",
  CLAUDE_CODE_USE_FOUNDRY: "",
  CLAUDE_CODE_USE_ANTHROPIC_AWS: "",
  CLAUDE_CODE_USE_MANTLE: "",
};

function input(overrides: Partial<SaveInput> = {}): SaveInput {
  return {
    id: "codex-personal",
    revision: null,
    provider: "codex",
    label: "Personal",
    env: { CODEX_HOME: "/tmp/codex-personal" },
    command: [],
    additionalModels: [],
    homeDirectory: "",
    ...overrides,
  };
}

test("lists aliases without credential values, hides builtin overrides", async () => {
  const f = fixture();
  const result = await f.handlers.list({}, f.context);
  assert.equal(result.profiles.length, 1);
  assert.equal(result.profiles[0].id, "claude-work");
  assert.deepEqual(result.profiles[0].envKeys, [
    "ANTHROPIC_API_KEY",
    "CLAUDE_CONFIG_DIR",
  ]);
  assert.equal(JSON.stringify(result).includes("test-secret-only"), false);
  assert.equal(result.profiles[0].homeDirectory, "/tmp/claude-work");
  assert.equal(result.profiles[0].legacySignIn, true); // the fixture still uses an API key
});

test("edit keeps provider-private metadata and switches a legacy API key to CLI login", async () => {
  const f = fixture();
  const {
    profiles: [profile],
  } = await f.handlers.list({}, f.context);
  await f.handlers.save(
    input({
      id: profile.id,
      revision: profile.revision,
      provider: "claude",
      label: "Renamed",
      env: { ANTHROPIC_BASE_URL: "https://gateway.example.com" },
      additionalModels: ["gateway-model", "gateway-model"],
    }),
    f.context,
  );
  const patch = f.patches[0].providers?.[profile.id];
  assert.deepEqual(patch?.env, {
    ...cliLoginEnv,
    CLAUDE_CONFIG_DIR: "/tmp/claude-work",
  });
  assert.equal(JSON.stringify(f.patches).includes("test-secret-only"), false);
  assert.deepEqual(patch?.params, { customOption: { keep: true } });
  assert.deepEqual(patch?.disallowedTools, ["WebSearch"]);
  assert.deepEqual(patch?.models, f.config().providers[profile.id].models);
  assert.deepEqual(patch?.additionalModels, [
    { id: "gateway-model", label: "gateway-model" },
  ]);
});

test("creates independent Codex and ACP profiles, toggles and removes only that alias", async () => {
  const f = fixture();
  await f.handlers.save(input(), f.context);
  let profile = (await f.handlers.list({}, f.context)).profiles.find(
    (profile) => profile.id === "codex-personal",
  )!;
  await f.handlers.change(
    { id: profile.id, revision: profile.revision, action: "disable" },
    f.context,
  );
  profile = (await f.handlers.list({}, f.context)).profiles.find(
    (profile) => profile.id === "codex-personal",
  )!;
  assert.equal(profile.enabled, false);
  await f.handlers.change(
    { id: profile.id, revision: profile.revision, action: "enable" },
    f.context,
  );
  profile = (await f.handlers.list({}, f.context)).profiles.find(
    (profile) => profile.id === "codex-personal",
  )!;
  assert.equal(profile.enabled, true);
  await f.handlers.change(
    { id: profile.id, revision: profile.revision, action: "delete" },
    f.context,
  );
  assert.equal(f.config().providers[profile.id], undefined);
  assert.ok(f.config().providers["claude-work"]);
  assert.ok(f.config().providers.claude);
  await f.handlers.save(
    input({
      id: "gemini-work",
      provider: "acp",
      env: {},
      command: ["gemini", "--acp"],
    }),
    f.context,
  );
  assert.deepEqual(f.config().providers["gemini-work"].command, [
    "gemini",
    "--acp",
  ]);
});

test("rejects collisions, builtins, stale revisions and provider changes without mutation", async () => {
  const f = fixture();
  const {
    profiles: [profile],
  } = await f.handlers.list({}, f.context);
  await assert.rejects(f.handlers.save(input({ id: "claude" }), f.context));
  await assert.rejects(
    f.handlers.save(input({ id: "claude-work" }), f.context),
  );
  await assert.rejects(
    f.handlers.save(
      input({ id: profile.id, revision: "stale", provider: "claude" }),
      f.context,
    ),
  );
  await assert.rejects(
    f.handlers.save(
      input({ id: profile.id, revision: profile.revision, provider: "codex" }),
      f.context,
    ),
  );
  await assert.rejects(
    f.handlers.change(
      { id: "claude", revision: "", action: "delete" },
      f.context,
    ),
  );
  assert.equal(f.patches.length, 0);
});

test("validates paths, endpoints and ACP command before mutation, never echoes keys", async () => {
  const f = fixture();
  for (const value of [
    input({ env: { CODEX_HOME: "~/relative" } }),
    input({
      env: { OPENAI_BASE_URL: "https://user:test-secret-only@example.com" },
    }),
    input({
      env: { OPENAI_BASE_URL: "https://example.com?token=test-secret-only" },
    }),
    input({ env: { OPENAI_BASE_URL: "ftp://example.com" } }),
    input({ provider: "acp", env: {} }),
  ]) {
    await assert.rejects(
      f.handlers.save(value, f.context),
      (error: Error) => !error.message.includes("test-secret-only"),
    );
  }
  assert.equal(f.patches.length, 0);
  assert.equal(
    saveInputSchema.safeParse(input({ id: "constructor" })).success,
    false,
  );
  assert.equal(
    saveInputSchema.safeParse(input({ env: { "INVALID-NAME": "value" } }))
      .success,
    false,
  );
});

test("serializes concurrent edits and rejects the second stale update", async () => {
  const f = fixture();
  const {
    profiles: [profile],
  } = await f.handlers.list({}, f.context);
  const edit = input({
    id: profile.id,
    revision: profile.revision,
    provider: "claude",
    env: {},
  });
  const results = await Promise.allSettled([
    f.handlers.save({ ...edit, label: "First" }, f.context),
    f.handlers.save({ ...edit, label: "Second" }, f.context),
  ]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "rejected");
  assert.equal(f.config().providers[profile.id].label, "First");
  assert.equal(f.patches.length, 1);
});

test("Claude and Codex accounts sign in only with the CLI login, even if credentials are typed as env", async () => {
  const f = fixture();
  let result = await f.handlers.save(
    input({
      id: "claude-new",
      provider: "claude",
      env: { ANTHROPIC_API_KEY: "test-secret-only", CLAUDE_CODE_OAUTH_TOKEN: "test-secret-only", MCP_TIMEOUT: "5000" },
      homeDirectory: "/tmp/claude-new",
    }),
    f.context,
  );
  assert.deepEqual(f.patches[0].providers?.["claude-new"].env, {
    ...cliLoginEnv,
    MCP_TIMEOUT: "5000",
    CLAUDE_CONFIG_DIR: "/tmp/claude-new",
  });
  assert.equal(result.profiles.find((p) => p.id === "claude-new")?.legacySignIn, false);
  result = await f.handlers.save(
    input({ env: { OPENAI_API_KEY: "test-secret-only", OPENAI_BASE_URL: "https://gateway.example.com" } }),
    f.context,
  );
  assert.deepEqual(f.patches[1].providers?.["codex-personal"].env, {
    OPENAI_API_KEY: "",
    OPENAI_BASE_URL: "",
  });
  assert.equal(result.profiles.find((p) => p.id === "codex-personal")?.legacySignIn, false);
  assert.equal(JSON.stringify(f.patches).includes("test-secret-only"), false);
});

test("rejects relative account folders and folders for agents without one, before mutation", async () => {
  const f = fixture();
  await assert.rejects(f.handlers.save(input({ env: {}, homeDirectory: "relative/path" }), f.context));
  await assert.rejects(
    f.handlers.save(input({ id: "gemini-work", provider: "acp", env: {}, command: ["gemini"], homeDirectory: "/tmp/x" }), f.context),
  );
  assert.equal(f.patches.length, 0);
});
