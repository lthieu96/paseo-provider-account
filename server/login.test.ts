import assert from "node:assert/strict";
import { test } from "node:test";
import { chmod, mkdir, mkdtemp, readFile, readdir, readlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cancelLogin, loginStatus, shareClaudeConfig, signInUrl, startLogin, submitLoginCode } from "./login.ts";

// Stand-ins for the official CLIs, speaking just enough of their sign-in protocol.
const fakeClaude = `#!/usr/bin/env node
const args = process.argv.slice(2).join(" ");
if (args === "auth login --help") { console.log("Usage: claude auth login [options]"); process.exit(0); }
if (args === "auth status --json") { console.log(JSON.stringify({ loggedIn: true, email: "work@example.com", subscriptionType: "max" })); process.exit(0); }
if (args === "auth login --claudeai") {
  if (process.env.ANTHROPIC_API_KEY) { console.error("Login failed: an inherited key leaked in"); process.exit(1); }
  require("node:child_process").execFileSync(process.env.BROWSER, ["https://claude.com/cai/oauth/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A1%2Fcallback"]);
  process.stdout.write("If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&state=s\\nPaste code here if prompted > ");
  process.stdin.once("data", (data) => process.exit(String(data).trim() === "good#paseo" ? 0 : 1));
}
`;
const oldClaude = `#!/usr/bin/env node
console.log("Usage: claude [options] [command] [prompt]");
`;
const fakeCodex = `#!/usr/bin/env node
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.method === "initialize") send({ id: m.id, result: {} });
  else if (m.method === "account/login/start") {
    send({ id: m.id, result: { type: "chatgptDeviceCode", loginId: "L1", verificationUrl: "https://auth.openai.com/codex/device", userCode: "ABCD-1234" } });
    setTimeout(() => send({ method: "account/login/completed", params: { loginId: "L1", success: true } }), 50);
  } else if (m.method === "account/read") send({ id: m.id, result: { account: { type: "chatgpt", email: "team@example.com", planType: "team" } } });
});
`;

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "profiles-login-"));
  process.env.PASEO_HOME = root;
  process.env.HOME = root; // no ~/.claude to share from
  process.env.ANTHROPIC_API_KEY = "inherited-test-key"; // must not reach the sign-in
  const write = async (name: string, body: string) => {
    const path = join(root, name);
    await writeFile(path, body);
    await chmod(path, 0o755);
    return path;
  };
  const commands = { claude: await write("claude", fakeClaude), old: await write("old-claude", oldClaude), codex: await write("codex", fakeCodex) };
  const context = (provider: string, command: string) => ({
    paseo: {
      config: {
        async get() {
          return { requestId: "t", config: { providers: { acct: { extends: provider, label: "A", command: [command] } } } };
        },
      },
    },
  });
  return { root, commands, context };
}

async function until(loginId: string, steps: string[]) {
  for (let i = 0; i < 200; i++) {
    const state = loginStatus({ loginId });
    if (steps.includes(state.step)) return state;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`stuck at ${loginStatus({ loginId }).step}`);
}

test("Claude sign-in: captures both links, takes a pasted code, reports the account", async () => {
  const { root, commands, context } = await setup();
  let state = await startLogin(
    { id: "acct", provider: "claude", homeDirectory: "", method: "browser" },
    context("claude", commands.claude) as never,
  );
  assert.equal(state.homeDirectory, join(root, "profiles", "acct"));
  state = await until(state.loginId, ["waiting"]);
  for (let i = 0; i < 40 && !(state.url && state.codeUrl); i++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    state = loginStatus({ loginId: state.loginId });
  }
  assert.match(state.url ?? "", /redirect_uri=http%3A%2F%2Flocalhost/); // from $BROWSER, finishes on the host
  assert.match(state.codeUrl ?? "", /code=true/); // printed, for pasting a code from another device
  submitLoginCode({ loginId: state.loginId, code: " good " });
  state = await until(state.loginId, ["done", "failed"]);
  assert.equal(state.step, "done", state.message ?? "");
  assert.equal(state.email, "work@example.com");
  assert.equal(state.plan, "max");
});

test("Claude sign-in refuses CLIs without `auth login` instead of sending it as a prompt", async () => {
  const { commands, context } = await setup();
  const state = await startLogin(
    { id: "acct", provider: "claude", homeDirectory: "", method: "browser" },
    context("claude", commands.old) as never,
  );
  assert.equal(state.step, "failed");
  assert.match(state.message ?? "", /Update it/);
});

test("Codex device-code sign-in through app-server, then cancel is a no-op once done", async () => {
  const { commands, context } = await setup();
  let state = await startLogin(
    { id: "acct", provider: "codex", homeDirectory: "", method: "code" },
    context("codex", commands.codex) as never,
  );
  assert.equal(state.url, "https://auth.openai.com/codex/device");
  assert.equal(state.userCode, "ABCD-1234");
  state = await until(state.loginId, ["done", "failed"]);
  assert.equal(state.step, "done", state.message ?? "");
  assert.equal(state.email, "team@example.com");
  assert.equal(cancelLogin({ loginId: state.loginId }).step, "done");
});

test("only the providers' own https sign-in links are accepted", () => {
  assert.equal(signInUrl("go https://evil.example/oauth/authorize now", /\/oauth\/authorize$/), null);
  assert.equal(signInUrl("http://claude.com/cai/oauth/authorize", /\/oauth\/authorize$/), null);
  assert.equal(
    signInUrl("visit: https://claude.com/cai/oauth/authorize?x=1", /\/oauth\/authorize$/),
    "https://claude.com/cai/oauth/authorize?x=1",
  );
});

test("a new Claude folder links the shared config from ~/.claude but keeps the account's own state", async () => {
  const root = await mkdtemp(join(tmpdir(), "profiles-share-"));
  const primary = join(root, ".claude");
  await mkdir(join(primary, "skills"), { recursive: true });
  await mkdir(join(primary, "plugins", "cache"), { recursive: true });
  for (const name of ["settings.json", "CLAUDE.md", ".credentials.json", "mcp-needs-auth-cache.json"])
    await writeFile(join(primary, name), "{}");
  await writeFile(
    join(primary, "plugins", "installed_plugins.json"),
    JSON.stringify({ plugins: { p: [{ installPath: join(primary, "plugins", "cache", "p") }] } }),
  );
  const home = join(root, "acct");
  await mkdir(home);
  await shareClaudeConfig(home, primary);
  assert.deepEqual((await readdir(home)).sort(), ["CLAUDE.md", "plugins", "settings.json", "skills"]);
  assert.equal(await readlink(join(home, "settings.json")), join(primary, "settings.json"));
  assert.equal(await readlink(join(home, "plugins", "cache")), join(primary, "plugins", "cache"));
  assert.match(await readFile(join(home, "plugins", "installed_plugins.json"), "utf8"), new RegExp(`${home}/plugins/cache/p`));
  const used = join(root, "used");
  await mkdir(used);
  await writeFile(join(used, "own.json"), "{}");
  await shareClaudeConfig(used, primary);
  assert.deepEqual(await readdir(used), ["own.json"]); // an existing folder is left alone
});
