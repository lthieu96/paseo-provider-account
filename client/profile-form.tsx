import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { providers, type Profile } from "../shared/profiles.ts";
import type { LoginState } from "../shared/login.ts";
import type { UsageReport } from "../shared/usage.ts";
import { LoginPanel } from "./login-panel.tsx";
import { ProviderIcon } from "./provider-icon.tsx";
import {
  isManaged,
  providerLabels,
  showEnvRow,
  slug,
  type Draft,
  type DraftField,
  type EnvRow,
} from "./draft.ts";
import { FluidButton, FluidField, FluidRow, FocusRing, Tint, fluid, headingLevel, radioKeys, squircle } from "./fluid.tsx";
import { windowLabel } from "./usage.tsx";

const agentNote = (provider: Profile["provider"]) =>
  isManaged(provider) ? "Sign in in-app" : provider === "acp" ? "Custom command" : "Own login";

// Settings-style form: agent, name and sign-in up front, rarely used fields behind "More options", and a
// danger zone when editing.
export function ProfileForm({
  theme,
  compact,
  hostLabel,
  draft,
  report,
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
  hostLabel: string;
  draft: Draft;
  report: UsageReport | undefined; // this account's usage, when editing
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
  const [editId, setEditId] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const errorFor = (field: DraftField) => (fieldError?.field === field ? fieldError.message : "");
  // Reveal a validation error that lives under More options (the ACP command is up front).
  useEffect(() => {
    if (
      fieldError &&
      !["label", "id"].includes(fieldError.field) &&
      !(draft.provider === "acp" && fieldError.field === "command")
    )
      setMore(true);
  }, [fieldError]);
  const validId = /^[a-z][a-z0-9-]*$/.test(draft.id.trim()) && !providers.some((id) => id === draft.id.trim());
  const c = theme.colors;
  const t = fluid.type(compact);
  const muted = { ...t.caption, color: c.foregroundMuted };
  const editing = draft.revision !== null;
  const managed = isManaged(draft.provider);
  const label = providerLabels[draft.provider];

  // Inside the dialog, groups are a heading plus content; a card around them would be a box in a box.
  const group = (title: string, children: ReactNode, trailing = "") => (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
        <Text
          accessibilityRole="header"
          {...headingLevel(3)}
          style={{ ...t.body, flex: 1, color: c.foreground, fontWeight: fluid.semibold }}
        >
          {title}
        </Text>
        {trailing ? <Text style={muted}>{trailing}</Text> : null}
      </View>
      {children}
    </View>
  );
  const row = (label: string, children: ReactNode, trailing = "") => (
    <FluidRow theme={theme} label={label} trailing={trailing} compact>
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
  const signInCard = (title: string, description: string, actions: ReactNode) => (
    <View
      {...squircle}
      style={{
        flexDirection: compact ? "column" : "row",
        alignItems: compact ? "stretch" : "center",
        gap: 16,
        padding: 16,
        borderRadius: fluid.radius.container,
        backgroundColor: c.surface2,
      }}
    >
      <View style={{ flex: compact ? undefined : 1, minWidth: 0, flexDirection: "row", gap: 12 }}>
        <View
          style={{
            width: 40,
            height: 40,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: fluid.radius.ring,
            backgroundColor: c.surface0,
          }}
        >
          <ProviderIcon theme={theme} provider={draft.provider} command={[]} size={20} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={{ ...t.subtitle, color: c.foreground, fontWeight: fluid.semibold }}>{title}</Text>
          <Text style={{ ...t.body, color: c.foregroundMuted }}>{description}</Text>
        </View>
      </View>
      {actions}
    </View>
  );
  const summary = [managed ? "Account folder" : null, "extra models", draft.provider === "acp" ? null : "command", "environment"]
    .filter(Boolean)
    .join(", ");
  return (
    <View style={{ gap: 24 }}>
      {editing
        ? null
        : group(
            "Agent",
            <View accessibilityRole="radiogroup" accessibilityLabel="Agent" {...radioKeys} style={{ flexDirection: "row", flexWrap: "wrap", margin: -4 }}>
              {providers.map((provider) => (
                <View key={provider} style={{ width: compact ? "50%" : "25%", padding: 4 }}>
                  <AgentTile
                    theme={theme}
                    compact={compact}
                    provider={provider}
                    checked={provider === draft.provider}
                    disabled={busy}
                    onPress={() => update({ provider })}
                  />
                </View>
              ))}
            </View>,
            "CLI login for Claude & Codex",
          )}

      <View style={{ gap: 8 }}>
        {input(
          "Name",
          draft.label,
          (label) => update({ label, ...(draft.idEdited ? {} : { id: slug(label) }) }),
          { hideLabel: false, placeholder: "e.g. Work", error: errorFor("label") },
        )}
        {editing ? null : editId || errorFor("id") ? (
          input("ID", draft.id, (id) => update({ id, idEdited: true }), {
            hideLabel: false,
            placeholder: "Filled from the name",
            mono: true,
            error: errorFor("id"),
            helper: "Lowercase letters, numbers and hyphens.",
          })
        ) : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text numberOfLines={1} style={{ ...muted, flexShrink: 1 }}>
              ID{" "}
              <Text style={{ fontFamily: draft.id ? fluid.font.mono : undefined, color: draft.id ? c.foreground : c.foregroundMuted }}>
                {draft.id || "filled from the name"}
              </Text>{" "}
              ·
            </Text>
            <FluidButton theme={theme} label="Edit" accessibilityLabel="Edit account ID" variant="link" accent onPress={() => setEditId(true)} />
          </View>
        )}
      </View>
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

      {group(
        "Sign-in",
        managed ? (
          <>
            {draft.legacySignIn ? (
              <Text style={{ ...t.body, color: c.statusWarning }}>
                This account was set up with a token, API key or custom endpoint. Saving switches it to CLI login.
              </Text>
            ) : null}
            {login ? (
              <LoginPanel
                theme={theme}
                compact={compact}
                hostLabel={hostLabel}
                login={login}
                busy={busy}
                onSubmitCode={onSubmitCode}
                onCancel={onCancelLogin}
                onRetry={onStartLogin}
              />
            ) : editing && !draft.legacySignIn && report?.status === "available" ? (
              <View
                {...squircle}
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 12,
                  padding: 16,
                  borderRadius: fluid.radius.container,
                  backgroundColor: c.surface2,
                }}
              >
                <View style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}>
                  <Tint color={c.statusSuccess} opacity={0.16} radius={18} />
                  <View>
                    <Icon name="Check" size={18} color={c.statusSuccess} />
                  </View>
                </View>
                <View style={{ flex: 1, minWidth: 160, gap: 2 }}>
                  <Text style={{ ...t.subtitle, color: c.foreground, fontWeight: fluid.semibold }}>
                    {report.email ?? "Signed in"}
                  </Text>
                  <Text style={{ ...t.body, color: c.foregroundMuted }}>
                    {[
                      report.planLabel ? report.planLabel[0].toUpperCase() + report.planLabel.slice(1) : null,
                      ...report.windows.map(
                        (w) => `${windowLabel(w.label, true)} ${w.usedPct === null ? "—" : `${Math.round(w.usedPct)}%`}`,
                      ),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                </View>
                <FluidButton
                  theme={theme}
                  label="Sign in again"
                  icon="RotateCcw"
                  variant="tertiary"
                  disabled={busy || loginStarting}
                  loading={loginStarting}
                  onPress={() => onStartLogin(draft.provider === "claude" ? "browser" : "code")}
                />
              </View>
            ) : (
              signInCard(
                draft.provider === "claude" ? "Sign in with your Claude account" : "Sign in with your ChatGPT account",
                `Runs the official ${draft.provider === "claude" ? "Claude Code" : "Codex"} login on ${hostLabel}. Your token never leaves the account folder.`,
                <View style={{ gap: 6, alignItems: compact ? "flex-start" : "flex-end" }}>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {draft.provider === "claude" ? (
                      signInButton(editing ? "Sign in again" : "Sign in", "browser", "primary")
                    ) : (
                      <>
                        {signInButton("Sign in with a device code", "code", "primary")}
                        {signInButton("Use the browser", "browser")}
                      </>
                    )}
                  </View>
                  {validId ? null : <Text style={muted}>Enter a name first.</Text>}
                </View>,
              )
            )}
          </>
        ) : (
          signInCard(
            draft.provider === "acp" ? "Uses the command's own login" : `Uses ${label}'s own login`,
            "Add credential variables under More options if it needs them.",
            null,
          )
        ),
      )}

      <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <FluidButton
            theme={theme}
            label="More options"
            icon={more ? "ChevronDown" : "ChevronRight"}
            expanded={more}
            variant="link"
            onPress={() => setMore(!more)}
          />
          {more ? null : (
            <Text numberOfLines={1} style={{ ...muted, flexShrink: 1 }}>
              {summary[0].toUpperCase() + summary.slice(1)}
            </Text>
          )}
        </View>
        {more ? (
          <View style={{ gap: 20, paddingTop: 8 }}>
            {managed
              ? row(
                  "Account folder",
                  input("Account folder", draft.homeDirectory, (homeDirectory) => update({ homeDirectory }), {
                    placeholder: "Created when you sign in",
                    mono: true,
                    error: errorFor("folder"),
                    helper:
                      draft.provider === "claude"
                        ? "Shares settings, skills and history with ~/.claude. Login and MCP auth stay separate."
                        : "Absolute path on the host. Keeps this account's login and history apart.",
                  }),
                )
              : null}
            {row(
              "Extra models",
              input("Extra models", draft.models, (models) => update({ models }), {
                placeholder: "One model ID per line",
                multiline: true,
                mono: true,
                error: errorFor("models"),
                helper: draft.pinnedModels.length ? `Fixed: ${draft.pinnedModels.join(", ")}.` : "",
              }),
              "One per line",
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
                          placeholder: item.saved ? "•••••• saved" : "Value",
                          mono: true,
                          secret: /key|token|secret|password|credential/i.test(item.name),
                        })}
                      </View>
                      {item.saved ? (
                        <View aria-hidden style={{ width: fluid.control, height: fluid.control, alignItems: "center", justifyContent: "center" }}>
                          <Icon name="Lock" size={16} color={c.foregroundMuted} />
                        </View>
                      ) : (
                        <FluidButton
                          theme={theme}
                          label={`Remove ${item.name || "variable"}`}
                          icon="X"
                          iconOnly
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
                  icon="Plus"
                  variant="link"
                  accent
                  disabled={busy}
                  onPress={() => update({ env: [...draft.env, { name: "", value: "", saved: false }] })}
                />
                {errorFor("env") ? (
                  <Text style={{ ...muted, color: c.statusDanger }}>{errorFor("env")}</Text>
                ) : null}
                {draft.env.some((row) => row.saved && showEnvRow(draft, row)) ? (
                  <Text style={muted}>Saved values stay hidden; type to replace. Removing a saved variable needs a new account.</Text>
                ) : null}
              </>,
              "Passed to the agent process",
            )}
          </View>
        ) : null}
      </View>

      {editing ? (
        <View {...squircle} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12, padding: 16 }}>
          <Tint color={c.statusDanger} opacity={0.04} card />
          <Tint color={c.statusDanger} opacity={0.45} outline card />
          <View style={{ flex: 1, minWidth: 200, gap: 2 }}>
            <Text
              accessibilityRole="header"
              {...headingLevel(3)}
              style={{ ...t.body, color: c.foreground, fontWeight: fluid.semibold }}
            >
              Delete account
            </Text>
            <Text style={{ ...t.body, color: c.foregroundMuted }}>
              {confirmDelete
                ? "Delete this account from Paseo? Its saved credentials are removed; the account folder and CLI login stay on the host."
                : "Removes it from Paseo. The account folder and CLI login stay on the host."}
            </Text>
          </View>
          {confirmDelete ? (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <FluidButton theme={theme} label="Keep" variant="ghost" onPress={() => setConfirmDelete(false)} />
              <FluidButton theme={theme} label="Delete" destructive disabled={busy} loading={busy} onPress={onDelete} />
            </View>
          ) : (
            <FluidButton
              theme={theme}
              label="Delete…"
              accessibilityLabel="Delete account"
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

// One agent choice in the New account grid: logo, name and how it signs in.
function AgentTile({
  theme,
  compact,
  provider,
  checked,
  disabled,
  onPress,
}: {
  theme: PluginTheme;
  compact: boolean;
  provider: Profile["provider"];
  checked: boolean;
  disabled: boolean;
  onPress(): void;
}) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const c = theme.colors;
  const t = fluid.type(compact);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={providerLabels[provider]}
      accessibilityHint={agentNote(provider)}
      aria-checked={checked}
      accessibilityState={{ checked, disabled }}
      tabIndex={checked ? 0 : -1}
      disabled={disabled}
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      onPressIn={() => setFocus(false)}
      style={{
        gap: 2,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: fluid.radius.container,
        borderWidth: 1,
        borderColor: checked ? c.accent : c.border,
        backgroundColor: hover && !checked ? c.surface2 : "transparent",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {checked ? <Tint color={c.accent} opacity={0.08} /> : null}
      <FocusRing visible={focus} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <ProviderIcon theme={theme} provider={provider} size={16} />
        <Text numberOfLines={1} style={{ ...t.subtitle, flex: 1, color: c.foreground, fontWeight: fluid.semibold }}>
          {providerLabels[provider]}
        </Text>
        {checked ? <Icon name="CircleCheck" size={16} color={c.accent} /> : null}
      </View>
      <Text numberOfLines={1} style={{ ...t.caption, color: c.foregroundMuted }}>
        {agentNote(provider)}
      </Text>
    </Pressable>
  );
}
