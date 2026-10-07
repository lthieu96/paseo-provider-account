import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const providers = [
  "claude",
  "codex",
  "copilot",
  "opencode",
  "pi",
  "omp",
  "acp",
] as const;
export const providerSchema = z.enum(providers);
// Variables that select Claude's credential and backend. CLI-login accounts blank them so an inherited
// key, token or gateway cannot take precedence over the account's own login.
export const claudeAuthVariables = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_CUSTOM_HEADERS",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_ANTHROPIC_AWS",
  "CLAUDE_CODE_USE_MANTLE",
];
const idSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]*$/,
    "Use lowercase letters, numbers and hyphens for the account ID.",
  )
  .refine(
    (id) => !["constructor", "prototype"].includes(id),
    "Choose a different account ID.",
  );
const modelSchema = z.object({ id: z.string(), label: z.string() });
export const profileSchema = z.object({
  id: idSchema,
  label: z.string(),
  provider: providerSchema,
  enabled: z.boolean(),
  envKeys: z.array(z.string()),
  command: z.array(z.string()),
  models: z.array(modelSchema),
  additionalModels: z.array(modelSchema),
  homeDirectory: z.string().nullable(),
  // A Claude/Codex account whose config still selects a token, API key or custom endpoint (set by an
  // older version or by hand). Saving it switches it to CLI login.
  legacySignIn: z.boolean(),
  revision: z.string(),
});
export type Profile = z.infer<typeof profileSchema>;
export const profileListSchema = z.object({ profiles: z.array(profileSchema) });
export const saveInputSchema = z.object({
  id: idSchema.max(80),
  revision: z.string().nullable(), // null creates; a revision edits an existing profile
  label: z.string().trim().min(1, "Enter an account name.").max(120),
  provider: providerSchema,
  env: z
    .record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string().max(16384))
    .default({}),
  command: z.array(z.string().min(1).max(4096)).max(64),
  additionalModels: z.array(z.string().trim().min(1).max(200)).max(100),
  homeDirectory: z.string().max(4096).default(""), // Claude/Codex account folder; blank keeps the current one
});
export type SaveInput = z.infer<typeof saveInputSchema>;
export const changeInputSchema = z.object({
  id: idSchema,
  revision: z.string(),
  action: z.enum(["enable", "disable", "delete"]),
});

export const listProfilesRpc = defineRpc({
  name: "profiles.list",
  input: z.object({}),
  output: profileListSchema,
});
export const saveProfileRpc = defineRpc({
  name: "profiles.save",
  input: saveInputSchema,
  output: profileListSchema,
});
export const changeProfileRpc = defineRpc({
  name: "profiles.change",
  input: changeInputSchema,
  output: profileListSchema,
});
