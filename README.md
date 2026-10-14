# Provider accounts for Paseo

Run several accounts per Paseo provider (Claude, Codex, Copilot, OpenCode, Pi, OMP, ACP agents). Each account is a provider alias in `agents.providers`, so it shows up in the model picker, e.g. `claude-work` and `claude-personal`. The plugin ID stays `paseo-agent-profiles`.

Supports Paseo `>=0.10.3 <0.12.0`. It uses `addSurface`/`addSidebarItem`, which 0.12 replaces with `addScreen`/`addSidebarHeaderItem`.

## Usage

1. Open **Provider accounts** from the sidebar or the Command Center.
2. **New account**: pick an agent, enter a name (the ID is derived from it).
3. Claude and Codex sign in through their official CLI login, run in the background on the daemon:
   - On the daemon machine, approve in the browser.
   - Elsewhere, Claude uses **Use a code instead** (paste the whole code, including the part after `#`). Codex uses a device code (enable "device code login" in ChatGPT → Settings → Security).
   - A new or empty Claude account folder shares settings, skills, hooks, plugins and history with `~/.claude`. Login and MCP auth stay per account.
4. Save, then pick the account in the model picker.

The list groups accounts by agent and shows each Claude/Codex account's email, plan and usage limits (5-hour, weekly, per-model weekly such as Fable). Deleting an account does not delete its folder or sign out the CLI.

## Security

- No Claude/Codex tokens or API keys are stored by the plugin. The official CLI keeps the login in the account folder (macOS Keychain for Claude, `auth.json` or keyring for Codex).
- Saving a Claude/Codex account blanks inherited credential and backend variables (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_USE_*`, `OPENAI_API_KEY`, …) and pins `ANTHROPIC_BASE_URL` to the official API. An `apiKeyHelper` in Claude settings can still take precedence.
- Accounts from older versions (token, API key, custom endpoint) show "Old sign-in"; saving switches them to CLI login. Old Keychain tokens (service `paseo-agent-profiles`) are not removed automatically.
- Saved environment values are never sent to the UI.

## Install and develop

```sh
paseo plugin install github:lthieu96/paseo-provider-account
```

Git installs run `npm ci --omit=dev` (declared as `build` in `paseo-plugin.json`) to fetch `@anthropic-ai/claude-agent-sdk`, which Claude usage loads at runtime; npm must be on the daemon's `PATH`. A local folder install runs nothing, so run `npm ci --omit=dev` there first, then `paseo plugin install /absolute/path` and `paseo plugin reload paseo-agent-profiles` after edits.

Development (Node 22.18+ or 24+): `npm ci --ignore-scripts && npm run typecheck && npm test`.

| Path | Role |
| --- | --- |
| `shared/` | RPC contracts and zod schemas |
| `server/profiles.ts` | Read, save, toggle and delete aliases; enforce CLI login |
| `server/login.ts` | In-app sign-in via `claude auth login` / `codex app-server` |
| `server/usage.ts` | Usage limits, plan and email per account |
| `client/` | React Native UI; `fluid.tsx` is the component kit, `draft.ts` the tested form logic |
| `design/export/` | Design references for the UI |

## Notes

- Config patches use `{ providers: { id: … } }` and `{ removeProviders: [id] }`, never both for one ID. `env` is replaced as a whole on write, so the server always sends the merged env. A variable cannot be removed; create a new account instead.
- Empty strings block inherited variables (older CLIs treat `CLAUDE_CODE_USE_*="0"` as on).
- The SDK is imported with a non-literal specifier: Paseo's plugin compiler follows type imports, and the SDK's bundled `.d.mts` files reference paths that do not exist.
- Revision checks stop overwriting a stale edit, but the config API has no compare-and-swap.
