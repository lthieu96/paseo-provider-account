import assert from "node:assert/strict";
import { test } from "node:test";
import { MutableDaemonConfigSchema } from "@getpaseo/protocol/messages";
import {
  createUsageHandler,
  normalizeClaudeUsage,
  normalizeCodexUsage,
} from "./usage.ts";

test("Claude usage preserves zero/unknown values and reconciles scoped limits", () => {
  const windows = normalizeClaudeUsage({
    five_hour: { utilization: 0 },
    seven_day: { utilization: null },
    seven_day_opus: { utilization: 20 },
    limits: [
      {
        kind: "weekly_scoped",
        percent: 40,
        scope: { model: { id: "opus", display_name: "Opus" } },
      },
      {
        kind: "weekly_scoped",
        percent: 5,
        scope: { surface: { id: "opus", display_name: "Opus" } },
      },
      { kind: "other", percent: 99 },
    ],
  });
  assert.equal(windows[0].usedPct, 0);
  assert.equal(windows[1].usedPct, null);
  assert.equal(
    windows.filter((window) => window.id.startsWith("weekly_model")).length,
    1,
  );
  assert.equal(
    windows.find((window) => window.id === "weekly_model_opus")?.usedPct,
    40,
  );
  assert.equal(
    windows.find((window) => window.id === "weekly_surface_opus")?.usedPct,
    5,
  );
});

test("Codex labels use reported periods and never invent zero usage for missing fields", () => {
  const { windows } = normalizeCodexUsage({
    rate_limit: {
      primary_window: {
        used_percent: 25,
        limit_window_seconds: 18000,
        reset_at: 2000000000,
      },
      secondary_window: {},
    },
  });
  assert.equal(windows[0].label, "5-hour limit");
  assert.equal(windows[0].resetsAt, new Date(2000000000000).toISOString());
  assert.equal(windows[1].label, "Secondary limit");
  assert.equal(windows[1].usedPct, null);
  assert.equal(windows[1].remainingPct, null);
});

function fixture() {
  const config = MutableDaemonConfigSchema.parse({
    mcp: { injectIntoAgents: true },
    providers: {
      "claude-a": {
        extends: "claude",
        label: "Account A",
        env: { CLAUDE_CODE_OAUTH_TOKEN: "fake-token-a" },
      },
      "claude-b": {
        extends: "claude",
        label: "Account B",
        env: { CLAUDE_CODE_OAUTH_TOKEN: "fake-token-b" },
      },
    },
  });
  const context = {
    paseo: {
      config: {
        get: async () => ({ requestId: "test", config }),
        patch: async () => ({ requestId: "test", config }),
      },
    },
  };
  return { config, context };
}

test("quota uses only each profile's token, sanitizes 403, caches, and refreshes on credential changes", async () => {
  const f = fixture();
  const requests: string[] = [];
  let clock = 1000000;
  const handler = createUsageHandler({
    now: () => clock,
    readCredential: async (profile) => ({
      token: profile.env.CLAUDE_CODE_OAUTH_TOKEN,
      source: "Profile token",
    }),
    fetchApi: async (_url, init) => {
      const authorization =
        new Headers(init?.headers).get("Authorization") || "";
      requests.push(authorization);
      return authorization.endsWith("fake-token-a")
        ? new Response("credential-like-vendor-error-never-return", {
            status: 403,
          })
        : new Response(JSON.stringify({ five_hour: { utilization: 35 } }), {
            status: 200,
          });
    },
  });
  const first = await handler({ force: false }, f.context);
  assert.equal(first.reports[0].status, "unavailable");
  assert.equal(first.reports[1].windows[0].usedPct, 35);
  assert.equal(requests.length, 2);
  assert.ok(requests.includes("Bearer fake-token-a"));
  assert.ok(requests.includes("Bearer fake-token-b"));
  assert.equal(JSON.stringify(first).includes("fake-token"), false);
  assert.equal(
    JSON.stringify(first).includes("credential-like-vendor-error"),
    false,
  );
  await handler({ force: false }, f.context);
  assert.equal(requests.length, 2);
  f.config.providers["claude-a"].env = {
    CLAUDE_CODE_OAUTH_TOKEN: "fake-token-c",
  };
  await handler({ force: false }, f.context);
  assert.equal(requests.length, 3);
  clock += 300001;
  await handler({ force: false }, f.context);
  assert.equal(requests.length, 5);
});

test("usage failures never expose credential errors and concurrent requests share one fetch", async () => {
  const f = fixture();
  delete f.config.providers["claude-b"];
  let calls = 0;
  const handler = createUsageHandler({
    readCredential: async () => ({
      token: "secret-never-return",
      source: "Profile token",
    }),
    fetchApi: async () => {
      calls++;
      await Promise.resolve();
      throw new Error("secret-never-return");
    },
  });
  const results = await Promise.all([
    handler({ force: true }, f.context),
    handler({ force: true }, f.context),
  ]);
  assert.equal(calls, 1);
  assert.equal(results[0].reports[0].status, "error");
  assert.equal(JSON.stringify(results).includes("secret-never-return"), false);
});
