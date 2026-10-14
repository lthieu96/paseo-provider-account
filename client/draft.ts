// Form state for one profile and its conversion to the save RPC input, plus the list's filter. No React
// here, so it is unit-tested.
import {
  claudeAuthVariables,
  saveInputSchema,
  type Profile,
  type SaveInput,
} from "../shared/profiles.ts";

export type EnvRow = { name: string; value: string; saved: boolean };
export type Draft = {
  id: string;
  idEdited: boolean;
  label: string;
  provider: Profile["provider"];
  revision: string | null;
  command: string;
  models: string;
  env: EnvRow[];
  pinnedModels: string[];
  homeDirectory: string;
  legacySignIn: boolean; // saving switches it to CLI login
  loginId?: string; // in-app sign-in in progress or just finished
};

export const providerLabels: Record<Profile["provider"], string> = {
  claude: "Claude",
  codex: "Codex",
  copilot: "Copilot",
  opencode: "OpenCode",
  pi: "Pi",
  omp: "OMP",
  acp: "ACP",
};
export const homeVariables = { claude: "CLAUDE_CONFIG_DIR", codex: "CODEX_HOME" };
// Set by the server for CLI login, so they are not editable as env.
const managedVariables = new Set([...claudeAuthVariables, "OPENAI_API_KEY", "OPENAI_BASE_URL"]);

export function isManaged(provider: Profile["provider"]): provider is "claude" | "codex" {
  return provider === "claude" || provider === "codex";
}

// The list's filter tabs: Claude, Codex, and every other agent together.
export type ProviderGroup = "claude" | "codex" | "other";
export const providerGroup = (provider: Profile["provider"]): ProviderGroup => (isManaged(provider) ? provider : "other");

// Search and filter combine; counts follow the search so each tab says how many matches it holds.
export function filterProfiles(profiles: Profile[], search: string, filter: ProviderGroup | "all") {
  const query = search.trim().toLowerCase();
  const found = profiles.filter((profile) =>
    `${profile.label} ${profile.id} ${providerLabels[profile.provider]}`.toLowerCase().includes(query),
  );
  const counts = { all: found.length, claude: 0, codex: 0, other: 0 };
  for (const profile of found) counts[providerGroup(profile.provider)]++;
  return { counts, visible: filter === "all" ? found : found.filter((p) => providerGroup(p.provider) === filter) };
}

export function slug(label: string) {
  return label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+|-+$/g, "")
    .slice(0, 80);
}

export function newDraft(): Draft {
  return {
    id: "",
    idEdited: false,
    label: "",
    provider: "claude",
    revision: null,
    command: "",
    models: "",
    env: [],
    pinnedModels: [],
    homeDirectory: "",
    legacySignIn: false,
  };
}

export function editDraft(profile: Profile): Draft {
  return {
    id: profile.id,
    idEdited: true,
    label: profile.label,
    provider: profile.provider,
    revision: profile.revision,
    command: profile.command.length ? JSON.stringify(profile.command) : "",
    models: profile.additionalModels.map(({ id }) => id).join("\n"),
    env: profile.envKeys.map((name) => ({ name, value: "", saved: true })),
    pinnedModels: profile.models.map(({ id }) => id),
    homeDirectory: profile.homeDirectory || "",
    legacySignIn: profile.legacySignIn,
  };
}

// Rows shown under More options: the sign-in owns the account folder and credential variables.
export function showEnvRow(draft: Draft, row: EnvRow) {
  if (!isManaged(draft.provider)) return true;
  return row.name !== homeVariables[draft.provider] && !managedVariables.has(row.name);
}

export type DraftField = "label" | "id" | "command" | "models" | "env" | "folder";
// A user-facing validation message, tied to the field that needs fixing when there is one.
export class DraftError extends Error {
  readonly field?: DraftField;
  constructor(message: string, field?: DraftField) {
    super(message);
    this.field = field;
  }
}
const fieldByKey: Record<string, DraftField> = {
  label: "label",
  id: "id",
  command: "command",
  additionalModels: "models",
  env: "env",
  homeDirectory: "folder",
};

// Throws a DraftError, checking fields in the order the form shows them.
export function toSaveInput(draft: Draft): SaveInput {
  if (!draft.label.trim()) throw new DraftError("Enter an account name.", "label");
  const env: Record<string, string> = {};
  const names = new Set<string>();
  for (const row of draft.env) {
    const name = row.name.trim();
    if (!name && !row.value) continue;
    if (!name) throw new DraftError("Enter a name for each new variable.", "env");
    if (names.has(name)) throw new DraftError(`The variable ${name} appears twice.`, "env");
    names.add(name);
    if (!row.value && row.saved) continue;
    if (!row.value) throw new DraftError(`Enter a value for ${name}, or remove the new variable.`, "env");
    if (["__proto__", "constructor", "prototype"].includes(name))
      throw new DraftError("Choose a valid variable name.", "env");
    env[name] = row.value;
  }
  let command: unknown = [];
  if (draft.command.trim()) {
    try {
      command = JSON.parse(draft.command);
    } catch {
      throw new DraftError('Use a JSON array for the command, such as ["gemini", "--acp"].', "command");
    }
  }
  const parsed = saveInputSchema.safeParse({
    id: draft.id.trim(),
    label: draft.label,
    provider: draft.provider,
    revision: draft.revision,
    env,
    command,
    additionalModels: draft.models
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean),
    homeDirectory: draft.homeDirectory,
  });
  if (!parsed.success) {
    // Report the first problem in on-screen order rather than schema key order.
    const order = ["label", "id", "command", "homeDirectory", "additionalModels", "env"];
    const issue = [...parsed.error.issues].sort(
      (a, b) => order.indexOf(String(a.path[0])) - order.indexOf(String(b.path[0])),
    )[0];
    throw new DraftError(issue.message, fieldByKey[String(issue.path[0])]);
  }
  return parsed.data;
}
