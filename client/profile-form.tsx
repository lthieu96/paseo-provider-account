import type { PluginTheme } from "@getpaseo/plugin";
import { useEffect, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { providers } from "../shared/profiles.ts";
import type { LoginState } from "../shared/login.ts";
import { LoginPanel } from "./login-panel.tsx";
import {
  isManaged,
  providerLabels,
  showEnvRow,
  slug,
  type Draft,
  type DraftField,
  type EnvRow,
} from "./draft.ts";
import {
  FluidButton,
  FluidField,
  FluidRow,
  FluidSelect,
  fluid,
  headingLevel,
} from "./fluid.tsx";

// Settings-style form: "Account" and "Sign-in" groups, rarely used fields behind "More options".
export function ProfileForm({
  theme,
  compact,
  draft,
  update,
  busy,
  login,
  loginStarting,
  onStartLogin,
  onSubmitCode,
  onCancelLogin,
  onDelete,
  fieldError,
}: {
  theme: PluginTheme;
  compact: boolean;
  draft: Draft;
  fieldError: { field: DraftField; message: string } | null;
  update(patch: Partial<Draft>): void;
  busy: boolean;
  login: LoginState | null;
  loginStarting: boolean;
  onStartLogin(method: "browser" | "code"): void;
  onSubmitCode(code: string): void;
  onCancelLogin(): void;
  onDelete(): void;
}) {
  const hasExtras =
    draft.models.trim() !== "" ||
    (draft.provider !== "acp" && draft.command.trim() !== "") ||
    draft.env.some((row) => showEnvRow(draft, row));
  const [more, setMore] = useState(hasExtras);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const errorFor = (field: DraftField) => (fieldError?.field === field ? fieldError.message : "");
  // Reveal a validation error that lives under More options.
  useEffect(() => {
    if (fieldError && !["label", "id", "folder"].includes(fieldError.field)) setMore(true);
  }, [fieldError]);
  const validId = /^[a-z][a-z0-9-]*$/.test(draft.id.trim()) && !providers.some((id) => id === draft.id.trim());
  const c = theme.colors;
  const t = fluid.type(compact);
  const muted = { ...t.caption, color: c.foregroundMuted };
  const editing = draft.revision !== null;
  const managed = isManaged(draft.provider);

  // Inside the dialog, groups are a heading plus rows; a card around them would be a box in a box.
  const group = (title: string, children: ReactNode, raised = false) => (
    <View style={{ gap: 16, zIndex: raised ? 1 : 0 }}>
      <Text
        accessibilityRole="header"
        {...headingLevel(3)}
        style={{ ...t.subtitle, color: c.foreground, fontWeight: fluid.semibold }}
      >
        {title}
      </Text>
      {children}
    </View>
  );
  const row = (label: string, children: ReactNode, raised = false) => (
    <FluidRow theme={theme} label={label} compact={compact} raised={raised}>
      {children}
    </FluidRow>
  );
  const input = (
    label: string,
    value: string,
    onChangeText: (value: string) => void,
    options: Partial<Parameters<typeof FluidField>[0]> = {},
  ) => (
    <FluidField
      theme={theme}
      label={label}
      hideLabel
      value={value}
      onChangeText={onChangeText}
      {...options}
      disabled={busy || options.disabled}
    />
  );
  // Sign-in needs the account ID for its folder, so it waits until the ID is valid.
  const signInButton = (label: string, method: "browser" | "code", variant: "primary" | "secondary" = "secondary") => (
    <FluidButton
      theme={theme}
      label={label}
      variant={variant}
      onPress={() => onStartLogin(method)}
      disabled={busy || loginStarting || !validId}
      loading={loginStarting}
    />
  );
  const setEnvRow = (index: number, patch: Partial<EnvRow>) =>
    update({ env: draft.env.map((item, i) => (i === index ? { ...item, ...patch } : item)) });
  return (
    <View style={{ gap: 24 }}>
      {group(
        "Account",
        <>
          {row(
            "Agent",
            editing ? (
              <Text style={{ ...t.body, color: c.foreground, paddingTop: compact ? 0 : 8 }}>
                {providerLabels[draft.provider]}
              </Text>
            ) : (
              <FluidSelect
                theme={theme}
                label="Agent"
                value={draft.provider}
                options={providers.map((value) => ({ value, label: providerLabels[value] }))}
                disabled={busy}
                onChange={(value) => update({ provider: value })}
              />
            ),
            true,
          )}
          {row(
            "Name",
            input(
              "Name",
              draft.label,
              (label) => update({ label, ...(draft.idEdited ? {} : { id: slug(label) }) }),
              { placeholder: `e.g. ${providerLabels[draft.provider]} Work`, error: errorFor("label") },
            ),
          )}
          {row(
            "ID",
            editing ? (
              <Text style={{ ...t.body, fontFamily: fluid.font.mono, color: c.foreground, paddingTop: compact ? 0 : 8 }}>
                {draft.id}
              </Text>
            ) : (
              input("ID", draft.id, (id) => update({ id, idEdited: true }), {
                placeholder: "Filled from the name",
                mono: true,
                error: errorFor("id"),
                helper: "Lowercase letters, numbers and hyphens.",
              })
            ),
          )}
          {draft.provider === "acp"
            ? row(
                "Command",
                input("ACP command", draft.command, (command) => update({ command }), {
                  placeholder: '["gemini", "--acp"]',
                  mono: true,
                  error: errorFor("command"),
                  helper: "Required. JSON array: program, then arguments.",
                }),
              )
            : null}
        </>,
        true,
      )}

      {group(
        "Sign-in",
        managed ? (
          <>
            <Text style={muted}>
              {draft.provider === "claude"
                ? "Sign in with your Claude account through the official Claude Code login. Sign in again here any time. The login stays in the account folder."
                : "Sign in with your ChatGPT account through the official Codex login. Sign in again here any time. The login stays in the account folder."}
            </Text>
            {draft.legacySignIn ? (
              <Text style={{ ...t.body, color: c.statusWarning }}>
                This account was set up with a token, API key or custom endpoint. Saving switches it to CLI login.
              </Text>
            ) : null}
            {row(
              "Login",
              login ? (
                <LoginPanel
                  theme={theme}
                  compact={compact}
                  login={login}
                  busy={busy}
                  onSubmitCode={onSubmitCode}
                  onCancel={onCancelLogin}
                  onRetry={() => onStartLogin(login.userCode ? "code" : "browser")}
                />
              ) : (
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                  {draft.provider === "claude" ? (
                    signInButton("Sign in", "browser", "primary")
                  ) : (
                    <>
                      {signInButton("Sign in with a device code", "code", "primary")}
                      {signInButton("Use the browser", "browser")}
                    </>
                  )}
                  {validId ? null : <Text style={muted}>Enter a name first.</Text>}
                </View>
              ),
            )}
            {row(
              "Account folder",
              input("Account folder", draft.homeDirectory, (homeDirectory) => update({ homeDirectory }), {
                placeholder: "Created when you sign in",
                mono: true,
                error: errorFor("folder"),
                helper: "Absolute path on the host. Keeps this account's login, settings and history apart.",
              }),
            )}
          </>
        ) : (
          <Text style={{ ...t.body, color: c.foregroundMuted }}>
            {draft.provider === "acp" ? "Uses the command's own login." : `Uses ${providerLabels[draft.provider]}'s own login.`}{" "}
            Add credential variables under More options if it needs them.
          </Text>
        ),
      )}

      <View style={{ gap: 8 }}>
        <FluidButton
          theme={theme}
          label={more ? "▾ More options" : "▸ More options"}
          accessibilityLabel="More options"
          expanded={more}
          variant="link"
          onPress={() => setMore(!more)}
        />
        {more ? (
          <View style={{ gap: 16, paddingTop: 8 }}>
                {row(
                  "Extra models",
                  input("Extra models", draft.models, (models) => update({ models }), {
                    placeholder: "One model ID per line",
                    multiline: true,
                    mono: true,
                    error: errorFor("models"),
                    helper: draft.pinnedModels.length
                      ? `Added to the agent's models. Fixed: ${draft.pinnedModels.join(", ")}.`
                      : "Added to the agent's own models.",
                  }),
                )}
                {draft.provider !== "acp"
                  ? row(
                      "Command",
                      input("Command", draft.command, (command) => update({ command }), {
                        placeholder: "Default CLI",
                        mono: true,
                        error: errorFor("command"),
                        helper: 'JSON array, e.g. ["/opt/bin/claude"].',
                      }),
                    )
                  : null}
                {row(
                  "Environment",
                  <>
                    {draft.env.map((item, index) =>
                      showEnvRow(draft, item) ? (
                        <View key={index} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
                          <View style={{ flex: 2, minWidth: 0 }}>
                            {input("Variable name", item.name, (name) => setEnvRow(index, { name }), {
                              placeholder: "NAME",
                              mono: true,
                              disabled: item.saved,
                            })}
                          </View>
                          <View style={{ flex: 3, minWidth: 0 }}>
                            {input(`Value of ${item.name || "variable"}`, item.value, (value) => setEnvRow(index, { value }), {
                              placeholder: item.saved ? "Saved" : "Value",
                              mono: true,
                              secret: /key|token|secret|password|credential/i.test(item.name),
                            })}
                          </View>
                          {item.saved ? null : (
                            <FluidButton
                              theme={theme}
                              label="✕"
                              accessibilityLabel={`Remove ${item.name || "variable"}`}
                              variant="ghost"
                              onPress={() => update({ env: draft.env.filter((_, i) => i !== index) })}
                            />
                          )}
                        </View>
                      ) : null,
                    )}
                    <FluidButton
                      theme={theme}
                      label="Add variable"
                      variant="tertiary"
                      disabled={busy}
                      onPress={() => update({ env: [...draft.env, { name: "", value: "", saved: false }] })}
                    />
                    {errorFor("env") ? (
                      <Text style={{ ...muted, color: c.statusDanger }}>{errorFor("env")}</Text>
                    ) : null}
                    <Text style={muted}>
                      {draft.env.some((row) => row.saved && showEnvRow(draft, row))
                        ? "Saved values stay hidden; type to replace. Removing a saved variable needs a new account."
                        : "Variables passed to the agent's process."}
                    </Text>
                  </>,
                )}
          </View>
        ) : null}
      </View>

      {editing ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
          {confirmDelete ? (
            <>
              <Text style={{ ...t.body, color: c.foreground }}>
                Delete this account from Paseo? Its saved credentials are removed; the account folder and CLI login
                stay on the host.
              </Text>
              <FluidButton theme={theme} label="Delete" destructive disabled={busy} loading={busy} onPress={onDelete} />
              <FluidButton theme={theme} label="Keep" variant="ghost" onPress={() => setConfirmDelete(false)} />
            </>
          ) : (
            <FluidButton
              theme={theme}
              label="Delete account"
              variant="link"
              destructive
              disabled={busy}
              onPress={() => setConfirmDelete(true)}
            />
          )}
        </View>
      ) : null}
    </View>
  );
}
