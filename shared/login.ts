import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

// One in-app sign-in run by the official CLI on the daemon host. The client polls it.
export const loginStateSchema = z.object({
  loginId: z.string(),
  provider: z.enum(["claude", "codex"]),
  homeDirectory: z.string(),
  step: z.enum(["starting", "waiting", "checking", "done", "failed", "canceled"]),
  url: z.string().nullable(), // sign-in page; finishes by itself in a browser on the daemon host
  codeUrl: z.string().nullable(), // Claude: page that shows a code to paste back, from any device
  userCode: z.string().nullable(), // Codex device code to enter on `url`
  message: z.string().nullable(),
  email: z.string().nullable(),
  plan: z.string().nullable(),
});
export type LoginState = z.infer<typeof loginStateSchema>;

const loginIdSchema = z.object({ loginId: z.string().max(64) });

export const startLoginRpc = defineRpc({
  name: "profiles.login.start",
  input: z.object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/).max(80),
    provider: z.enum(["claude", "codex"]),
    homeDirectory: z.string().max(4096).default(""),
    method: z.enum(["browser", "code"]).default("browser"), // Codex only: browser callback or device code
  }),
  output: loginStateSchema,
});
export const loginStatusRpc = defineRpc({ name: "profiles.login.status", input: loginIdSchema, output: loginStateSchema });
export const submitLoginCodeRpc = defineRpc({
  name: "profiles.login.code",
  input: loginIdSchema.extend({ code: z.string().max(4096) }),
  output: loginStateSchema,
});
export const cancelLoginRpc = defineRpc({ name: "profiles.login.cancel", input: loginIdSchema, output: loginStateSchema });
