// In-app sign-in: run the official CLI in the background on the daemon host and surface its sign-in
// link (and code) to the dialog, instead of opening a terminal. OAuth stays in the CLIs; the plugin
// never sees or stores a credential.
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { RpcInput } from "@getpaseo/plugin";
import { claudeAuthVariables } from "../shared/profiles.ts";
import type { LoginState, startLoginRpc } from "../shared/login.ts";

const execFileAsync = promisify(execFile);
type Provider = "claude" | "codex";
type Login = { state: LoginState; submit?(code: string): void; cancel(): void; endedAt?: number };
type ConfigContext = { paseo: Pick<PluginHandlerContext["paseo"], "config"> };

const logins = new Map<string, Login>();
const timeoutMs = 15 * 60_000;
const keepEndedMs = 10 * 60_000;
// Links are opened in the user's browser, so only accept the providers' own sign-in hosts.
const signInHosts = /(^|\.)(claude\.com|claude\.ai|anthropic\.com|openai\.com|chatgpt\.com)$/;

function paseoHome() {
  return process.env.PASEO_HOME || join(homedir(), ".paseo");
}

export function stripAnsi(text: string) {
  return text
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b[@-Z\\-_]/g, "")
    .replace(/\r/g, "\n");
}

export function signInUrl(text: string, path: RegExp): string | null {
  for (const [candidate] of text.matchAll(/https:\/\/[^\s"'<>]+/g)) {
    try {
      const url = new URL(candidate);
      if (signInHosts.test(url.hostname) && path.test(url.pathname)) return candidate;
    } catch {
      // not a URL
    }
  }
  return null;
}

// Environment the agent itself runs with: the daemon's, minus anything that would pick another
// credential or backend, plus the account folder.
function accountEnv(provider: Provider, home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1" };
  const drop = provider === "claude" ? claudeAuthVariables : ["OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_API_KEY"];
  for (const key of drop) delete env[key];
  env[provider === "claude" ? "CLAUDE_CONFIG_DIR" : "CODEX_HOME"] = home;
  return env;
}

// A new Claude account folder shares everything but the account itself with ~/.claude, like
// clausona's merged profiles: settings, CLAUDE.md, skills, hooks, sessions and history are symlinked.
// Per-account state stays local (login and its backups, user MCP servers, org policy, MCP auth). plugins/ is a real
// folder of links, with the two files that hold absolute paths rewritten to point inside it.
const accountOwnItems = new Set([
  ".claude.json",
  ".credentials.json",
  "remote-settings.json",
  "policy-limits.json",
  "mcp-needs-auth-cache.json",
  "backups", // holds .claude.json backups of the main account
  "statsig",
  "image-cache",
  "plugins",
]);
const pluginPathFiles = new Set(["installed_plugins.json", "known_marketplaces.json"]);

export async function shareClaudeConfig(home: string, primary: string) {
  if (resolve(home) === resolve(primary) || (await readdir(home)).length) return; // never touch a used folder
  const items = await readdir(primary).catch(() => [] as string[]);
  for (const name of items) if (!accountOwnItems.has(name)) await symlink(join(primary, name), join(home, name));
  if (!items.includes("plugins")) return;
  const from = join(primary, "plugins");
  const to = join(home, "plugins");
  await mkdir(to);
  for (const name of await readdir(from)) {
    if (!pluginPathFiles.has(name)) await symlink(join(from, name), join(to, name));
    else await writeFile(join(to, name), (await readFile(join(from, name), "utf8")).split(`${from}/`).join(`${to}/`));
  }
}

// `claude auth login` always starts a fresh browser login. CLIs without it would read "auth login"
// as a prompt for the model, so check first.
export async function supportsAuthLogin(command: string[]) {
  try {
    const { stdout, stderr } = await execFileAsync(command[0], [...command.slice(1), "auth", "login", "--help"], {
      timeout: 10_000,
    });
    return /auth login/.test(stdout + stderr);
  } catch {
    return false;
  }
}

// A $BROWSER stand-in that records the link instead of opening a window on the daemon host, so the
// link can be opened on whichever device the user is holding.
let browserShim: Promise<string> | null = null;
function captureBrowser() {
  browserShim ??= (async () => {
    const directory = join(paseoHome(), "profiles", ".bin");
    const path = join(directory, "capture-url");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(path, '#!/bin/sh\n[ -n "$PASEO_PROFILES_URL_OUT" ] && printf \'%s\\n\' "$1" > "$PASEO_PROFILES_URL_OUT"\nexit 0\n', {
      mode: 0o700,
    });
    await chmod(path, 0o700);
    return path;
  })();
  return browserShim;
}

function update(login: Login, patch: Partial<LoginState>) {
  if (login.endedAt) return;
  login.state = { ...login.state, ...patch };
  if (["done", "failed", "canceled"].includes(login.state.step)) login.endedAt = Date.now();
}

function lastLine(text: string) {
  return stripAnsi(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .pop();
}

async function claudeIdentity(command: string[], env: NodeJS.ProcessEnv) {
  const { stdout } = await execFileAsync(command[0], [...command.slice(1), "auth", "status", "--json"], {
    env,
    timeout: 30_000,
  });
  const status = JSON.parse(stdout) as { loggedIn?: unknown; email?: unknown; subscriptionType?: unknown };
  if (status.loggedIn !== true) throw new Error("Claude Code reports that this account is not signed in.");
  return {
    email: typeof status.email === "string" ? status.email : null,
    plan: typeof status.subscriptionType === "string" ? status.subscriptionType : null,
  };
}

async function startClaude(login: Login, command: string[], env: NodeJS.ProcessEnv) {
  if (!(await supportsAuthLogin(command)))
    return update(login, {
      step: "failed",
      message: "This Claude Code can't sign in from Paseo. Update it (claude update) and try again.",
    });
  const capture = join(tmpdir(), `paseo-profiles-${randomBytes(6).toString("hex")}.url`);
  const child = spawn(command[0], [...command.slice(1), "auth", "login", "--claudeai"], {
    env: { ...env, BROWSER: await captureBrowser(), PASEO_PROFILES_URL_OUT: capture },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let canceled = false;
  const poll = setInterval(() => {
    void readFile(capture, "utf8")
      .then((text) => {
        const url = signInUrl(text, /\/oauth\/authorize$/);
        if (url && url !== login.state.url) update(login, { step: "waiting", url });
      })
      .catch(() => undefined);
  }, 250);
  const stopPolling = setTimeout(() => clearInterval(poll), 60_000);
  child.stdin.on("error", () => undefined);
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += stripAnsi(chunk.toString("utf8"));
    // The printed link redirects to a page that shows a code, for signing in from another device.
    const codeUrl = signInUrl(stdout, /\/oauth\/authorize$/);
    if (codeUrl && codeUrl !== login.state.codeUrl) update(login, { step: "waiting", codeUrl });
  });
  child.stderr.on("data", (chunk: Buffer) => {
    const text = stripAnsi(chunk.toString("utf8"));
    stderr += text;
    if (/invalid code/i.test(text))
      update(login, { message: "That code didn't work. Copy the whole code from the page and paste it again." });
  });
  child.on("error", (error) => update(login, { step: "failed", message: `Could not start Claude Code: ${error.message}` }));
  child.on("close", (code) => {
    clearInterval(poll);
    clearTimeout(stopPolling);
    void rm(capture, { force: true });
    if (canceled) return update(login, { step: "canceled", message: null });
    if (code !== 0)
      return update(login, {
        step: "failed",
        message: (lastLine(stderr) ?? lastLine(stdout) ?? "Sign-in did not finish.").replace(/^Login failed:\s*/i, "Sign-in failed: "),
      });
    update(login, { step: "checking", message: null });
    claudeIdentity(command, env).then(
      (identity) => update(login, { step: "done", ...identity }),
      (error: Error) => update(login, { step: "failed", message: error.message }),
    );
  });
  login.submit = (code) => {
    let value = code.trim().replace(/\s+/g, "");
    if (!value) throw new Error("Paste the code from the sign-in page.");
    // The CLI only checks that a "#state" suffix is present; the exchange uses the flow's own state.
    if (!value.includes("#")) value = `${value}#paseo`;
    update(login, { message: "Checking the code…" });
    child.stdin.write(`${value}\n`);
  };
  login.cancel = () => {
    canceled = true;
    child.kill("SIGTERM");
  };
}

// Newline-delimited JSON-RPC with `codex app-server` (no "jsonrpc" field on the wire).
class AppServer {
  private nextId = 1;
  private buffer = "";
  private stderr = "";
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  private readonly listeners = new Map<string, (params: Record<string, unknown>) => void>();
  readonly exited: Promise<string>;
  private readonly child: ChildProcessWithoutNullStreams;

  constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    child.stdin.on("error", () => undefined);
    child.stderr.on("data", (chunk: Buffer) => (this.stderr = (this.stderr + chunk.toString("utf8")).slice(-4000)));
    child.stdout.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf8");
      for (let at = this.buffer.indexOf("\n"); at >= 0; at = this.buffer.indexOf("\n")) {
        const line = this.buffer.slice(0, at).trim();
        this.buffer = this.buffer.slice(at + 1);
        if (line) this.dispatch(line);
      }
    });
    this.exited = new Promise((resolve) => {
      const finish = (reason: string) => {
        for (const request of this.pending.values()) request.reject(new Error(reason));
        this.pending.clear();
        resolve(reason);
      };
      child.on("error", (error) => finish(error.message));
      child.on("close", () => finish(lastLine(this.stderr) ?? "Codex stopped."));
    });
  }

  private dispatch(line: string) {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const id = typeof message.id === "number" ? message.id : null;
    if (id !== null && typeof message.method === "string")
      return this.send({ id, error: { code: -32601, message: "Not supported" } }); // server-initiated request
    if (id !== null) {
      const request = this.pending.get(id);
      this.pending.delete(id);
      const error = message.error as { message?: unknown } | undefined;
      if (error) request?.reject(new Error(typeof error.message === "string" ? error.message : "Codex request failed"));
      else request?.resolve(message.result);
      return;
    }
    if (typeof message.method === "string")
      this.listeners.get(message.method)?.((message.params ?? {}) as Record<string, unknown>);
  }

  private send(message: Record<string, unknown>) {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  on(method: string, listener: (params: Record<string, unknown>) => void) {
    this.listeners.set(method, listener);
  }

  request(method: string, params: unknown = {}, ms = 30_000): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex did not answer ${method}.`));
      }, ms);
      this.pending.set(id, {
        resolve: (value) => (clearTimeout(timer), resolve(value)),
        reject: (error) => (clearTimeout(timer), reject(error)),
      });
      this.send({ id, method, params });
    });
  }

  async initialize() {
    await this.request("initialize", {
      clientInfo: { name: "codex_cli_rs", title: "Paseo Agent Profiles", version: "1.1.0" },
      capabilities: { experimentalApi: false },
    }, 60_000);
    this.send({ method: "initialized" });
  }

  close() {
    this.child.stdin.end();
    this.child.kill("SIGTERM");
  }
}

function codexError(message: string) {
  return /device code login is not enabled/i.test(message)
    ? "Device-code sign-in is off for this ChatGPT account. Turn on “device code login” in ChatGPT → Settings → Security, or use the browser option."
    : message;
}

async function startCodex(login: Login, command: string[], env: NodeJS.ProcessEnv, method: "browser" | "code") {
  const server = new AppServer(spawn(command[0], [...command.slice(1), "app-server"], { env, stdio: ["pipe", "pipe", "pipe"] }));
  let loginId: string | null = null;
  const fail = (message: string) => {
    update(login, { step: "failed", message: codexError(message) });
    server.close();
  };
  login.cancel = () => {
    if (loginId) void server.request("account/login/cancel", { loginId }, 5000).catch(() => undefined);
    update(login, { step: "canceled", message: null });
    setTimeout(() => server.close(), 300);
  };
  void server.exited.then((reason) => fail(`Codex stopped before sign-in finished: ${reason}`));
  server.on("account/login/completed", (params) => {
    if (loginId && params.loginId && params.loginId !== loginId) return;
    if (params.success !== true) return fail(typeof params.error === "string" ? params.error : "Sign-in did not finish.");
    update(login, { step: "checking", message: null });
    server
      .request("account/read", {})
      .then((result) => {
        const account = (result as { account?: { email?: unknown; planType?: unknown } | null }).account;
        update(login, {
          step: "done",
          email: typeof account?.email === "string" ? account.email : null,
          plan: typeof account?.planType === "string" ? account.planType : null,
        });
        server.close();
      })
      .catch((error: Error) => fail(error.message));
  });
  try {
    await server.initialize();
    const result = (await server.request("account/login/start", {
      type: method === "code" ? "chatgptDeviceCode" : "chatgpt",
    })) as { loginId?: unknown; verificationUrl?: unknown; authUrl?: unknown; userCode?: unknown };
    loginId = typeof result.loginId === "string" ? result.loginId : null;
    const link = String(method === "code" ? result.verificationUrl : result.authUrl);
    const url = signInUrl(link, /\/(codex\/device|oauth\/authorize)$/);
    if (!url) return fail("Codex did not return a sign-in link.");
    update(login, {
      step: "waiting",
      url,
      userCode: typeof result.userCode === "string" && /^[A-Za-z0-9-]{3,64}$/.test(result.userCode) ? result.userCode : null,
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

function find(loginId: string) {
  for (const [id, login] of logins) if (login.endedAt && Date.now() - login.endedAt > keepEndedMs) logins.delete(id);
  const login = logins.get(loginId);
  if (!login) throw new Error("This sign-in has ended. Start it again.");
  return login;
}

export async function startLogin(input: RpcInput<typeof startLoginRpc>, { paseo }: ConfigContext): Promise<LoginState> {
  if (process.platform === "win32") throw new Error("Signing in from Paseo needs a macOS or Linux daemon.");
  if (["claude", "codex"].includes(input.id)) throw new Error("Use a separate account ID, such as claude-work.");
  const { config } = await paseo.config.get();
  const previous = config.providers[input.id] as { extends?: unknown; env?: unknown; command?: unknown } | undefined;
  if (previous && previous.extends !== input.provider) throw new Error("The existing account uses a different provider.");
  const homeVariable = input.provider === "claude" ? "CLAUDE_CONFIG_DIR" : "CODEX_HOME";
  const storedHome =
    previous?.env && typeof previous.env === "object" ? Reflect.get(previous.env, homeVariable) : undefined;
  const homeDirectory =
    input.homeDirectory.trim() ||
    (typeof storedHome === "string" ? storedHome : "") ||
    join(paseoHome(), "profiles", input.id);
  if (!isAbsolute(homeDirectory) || homeDirectory.includes("\0"))
    throw new Error("Choose an absolute account folder on the daemon host.");
  await mkdir(homeDirectory, { recursive: true, mode: 0o700 });
  if (input.provider === "claude") await shareClaudeConfig(homeDirectory, join(homedir(), ".claude"));
  const command =
    Array.isArray(previous?.command) && previous.command.length && previous.command.every((part) => typeof part === "string")
      ? (previous.command as string[])
      : [input.provider];
  // One sign-in per account: a new attempt replaces the previous one.
  for (const login of logins.values())
    if (!login.endedAt && login.state.homeDirectory === homeDirectory) login.cancel();
  const login: Login = {
    state: {
      loginId: randomUUID(),
      provider: input.provider,
      homeDirectory,
      step: "starting",
      url: null,
      codeUrl: null,
      userCode: null,
      message: null,
      email: null,
      plan: null,
    },
    cancel: () => update(login, { step: "canceled" }),
  };
  logins.set(login.state.loginId, login);
  const env = accountEnv(input.provider, homeDirectory);
  if (input.provider === "claude") await startClaude(login, command, env);
  else await startCodex(login, command, env, input.method);
  setTimeout(() => {
    if (!login.endedAt) {
      login.cancel();
      update(login, { step: "failed", message: "Sign-in timed out. Start it again." });
    }
  }, timeoutMs).unref();
  return login.state;
}

export function loginStatus({ loginId }: { loginId: string }) {
  return find(loginId).state;
}

export function submitLoginCode({ loginId, code }: { loginId: string; code: string }) {
  const login = find(loginId);
  if (login.endedAt || !login.submit) throw new Error("This sign-in doesn't take a code.");
  login.submit(code);
  return login.state;
}

export function cancelLogin({ loginId }: { loginId: string }) {
  const login = find(loginId);
  if (!login.endedAt) login.cancel();
  return login.state;
}

// Plugin reload or disable: stop every sign-in still running.
export function stopAllLogins() {
  for (const login of logins.values()) if (!login.endedAt) login.cancel();
}
