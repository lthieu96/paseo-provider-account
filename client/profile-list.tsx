import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import type { Profile } from "../shared/profiles.ts";
import type { UsageReport } from "../shared/usage.ts";
import { isManaged, providerGroup, providerLabels, type ProviderGroup } from "./draft.ts";
import { FluidButton, FluidSwitch, FocusRing, Tint, fluid, headingLevel, squircle } from "./fluid.tsx";
import { ProviderIcon } from "./provider-icon.tsx";
import { UsageMeters, meterGap, meterWidth, windowLabel } from "./usage.tsx";

const groups: Array<{ id: ProviderGroup; label: string }> = [
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex" },
  { id: "other", label: "Other" },
];
// Wide rows reserve room for three meters so every row's usage column starts at the same x.
const usageWidth = meterWidth * 3 + meterGap * 2;
// Both usage messages for a lost login end this way (server/usage.ts).
const signedOut = (report: UsageReport | undefined) => /Sign in again\.$/.test(report?.message ?? "");
// Hidden from assistive tech and touches: the row's button and hint already carry it.
const visualOnly = { "aria-hidden": true, importantForAccessibility: "no-hide-descendants", pointerEvents: "none" } as const;

// Profiles grouped as Claude, Codex and Other. Tap a row to edit; the switch enables or disables it.
export function ProfileList({
  theme,
  compact,
  profiles,
  usage,
  busy,
  onEdit,
  onToggle,
}: {
  theme: PluginTheme;
  compact: boolean;
  profiles: Profile[];
  usage: Map<string, UsageReport>;
  busy: boolean;
  onEdit(profile: Profile): void;
  onToggle(profile: Profile, enabled: boolean): void;
}) {
  const c = theme.colors;
  const t = fluid.type(compact);
  return (
    <View style={{ gap: 24 }}>
      {groups.map(({ id, label }) => {
        const group = profiles.filter((profile) => providerGroup(profile.provider) === id);
        if (!group.length) return null;
        const fetched = group.flatMap((profile) => usage.get(profile.id)?.fetchedAt ?? []).map(Date.parse);
        const minutes = id === "claude" && fetched.length ? Math.round((Date.now() - Math.min(...fetched)) / 60000) : null;
        return (
          <View key={id} style={{ gap: compact ? 12 : 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              {id === "other" ? (
                <Icon name="Sparkle" size={14} color={c.foreground} />
              ) : (
                <ProviderIcon theme={theme} provider={id} size={14} />
              )}
              <Text
                accessibilityRole="header"
                {...headingLevel(2)}
                style={{ ...t.subtitle, color: compact ? c.foregroundMuted : c.foreground, fontWeight: fluid.semibold }}
              >
                {label}
              </Text>
              <Text style={{ ...t.caption, flex: 1, color: c.foregroundMuted }}>{compact ? "" : group.length}</Text>
              {minutes === null || compact ? null : (
                <Text style={{ ...t.caption, color: c.foregroundMuted }}>
                  Usage updated {minutes < 1 ? "just now" : `${minutes} min ago`}
                </Text>
              )}
            </View>
            <View
              {...(compact ? {} : squircle)}
              style={
                compact
                  ? { gap: 12 }
                  : {
                      backgroundColor: c.surface1,
                      borderWidth: 1,
                      borderColor: c.border,
                      borderRadius: fluid.radius.container,
                      overflow: "hidden",
                    }
              }
            >
              {group.map((profile, index) => (
                <ProfileRow
                  key={profile.id}
                  theme={theme}
                  compact={compact}
                  profile={profile}
                  report={usage.get(profile.id)}
                  first={index === 0}
                  busy={busy}
                  onEdit={() => onEdit(profile)}
                  onToggle={(enabled) => onToggle(profile, enabled)}
                />
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function ProfileRow({
  theme,
  compact,
  profile,
  report,
  first,
  busy,
  onEdit,
  onToggle,
}: {
  theme: PluginTheme;
  compact: boolean;
  profile: Profile;
  report: UsageReport | undefined;
  first: boolean;
  busy: boolean;
  onEdit(): void;
  onToggle(enabled: boolean): void;
}) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const c = theme.colors;
  const t = fluid.type(compact);
  const managed = isManaged(profile.provider);
  const lost = managed && signedOut(report);
  const plan = report?.planLabel ? report.planLabel[0].toUpperCase() + report.planLabel.slice(1) : null;
  const detail = !profile.enabled
    ? "Off"
    : lost
      ? report!.message!.replace(/\.? Sign in again\.$/, "")
      : managed
        ? (plan ?? "CLI login")
        : [providerLabels[profile.provider], profile.command.join(" ")].filter(Boolean).join(" · ");
  const pill = profile.legacySignIn
    ? { text: "Old sign-in", color: c.statusWarning }
    : lost
      ? { text: "Signed out", color: c.statusDanger }
      : null;
  const note = !managed
    ? profile.provider === "acp"
      ? "Uses the command's own login"
      : `Uses ${providerLabels[profile.provider]}'s own login`
    : profile.legacySignIn
      ? "Edit to switch to CLI login"
      : "";
  // The row is one button, so its hint carries what the meters and labels show visually.
  const usageSummary =
    report?.status === "available"
      ? report.windows
          .map((w) => `${windowLabel(w.label)} ${w.usedPct === null ? "not reported" : `${Math.round(w.usedPct)}% used`}`)
          .join(", ")
      : lost
        ? ""
        : (report?.message ?? "");
  const hint = [
    pill?.text,
    profile.enabled ? "" : "Off",
    profile.id,
    report?.email,
    profile.enabled ? detail : "",
    note,
    managed && profile.enabled ? usageSummary : "",
  ]
    .filter(Boolean)
    .join(". ");
  const dim = profile.enabled ? 1 : 0.55;

  const info = (
    <View {...visualOnly} style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12, opacity: dim }}>
      <View
        style={{
          width: 36,
          height: 36,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: fluid.radius.ring,
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.surface2,
        }}
      >
        <ProviderIcon theme={theme} provider={profile.provider} command={profile.command} size={18} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
          <Text numberOfLines={1} style={{ ...t.subtitle, flexShrink: 1, fontWeight: fluid.semibold, color: c.foreground }}>
            {profile.label}
          </Text>
          {compact ? null : (
            <Text numberOfLines={1} style={{ ...t.caption, flexShrink: 2, fontFamily: fluid.font.mono, color: c.foregroundMuted }}>
              {profile.id}
            </Text>
          )}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {pill && !compact ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 7, borderRadius: 999 }}>
              <Tint color={pill.color} opacity={0.14} radius={999} />
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: pill.color }} />
              <Text style={{ ...t.caption, color: pill.color, fontWeight: "500" }}>{pill.text}</Text>
            </View>
          ) : null}
          <Text numberOfLines={1} style={{ ...t.body, flexShrink: 1, color: c.foregroundMuted }}>
            {[compact ? profile.id : report?.email, detail].filter(Boolean).join(" · ")}
          </Text>
        </View>
      </View>
    </View>
  );
  // Usage column: meters, a way back in after a lost login, or a note on how the agent signs in.
  let aside: ReactNode = null;
  if (note) aside = <Text {...visualOnly} style={{ ...t.body, color: c.foregroundMuted, opacity: dim }}>{note}</Text>;
  else if (lost) {
    const signIn = (
      <FluidButton
        theme={theme}
        label="Sign in again"
        accessibilityLabel={`Sign in to ${profile.label} again`}
        icon="LogIn"
        variant={compact ? "ghost" : "tertiary"}
        destructive={compact}
        stretch={compact}
        onPress={onEdit}
      />
    );
    // Compact: a full-width, danger-tinted bar under the account.
    aside = compact ? (
      <View>
        <Tint color={c.statusDanger} opacity={0.14} radius={fluid.radius.item} />
        {signIn}
      </View>
    ) : (
      signIn
    );
  }
  else if (profile.enabled)
    aside = (
      <View {...visualOnly}>
        <UsageMeters theme={theme} compact={compact} report={report} />
      </View>
    );

  const button = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Edit ${profile.label}`}
      accessibilityHint={hint}
      onPress={onEdit}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      onPressIn={() => setFocus(false)}
      style={{ position: "absolute", inset: 0, borderRadius: compact ? fluid.radius.container : 0 }}
    >
      <FocusRing visible={focus} inset={2} />
    </Pressable>
  );
  const toggle = (
    <FluidSwitch theme={theme} label={`${profile.label} enabled`} value={profile.enabled} disabled={busy} onChange={onToggle} />
  );

  // The button fills the row behind its content; the switch and sign-in button sit above it.
  return compact ? (
    <View
      {...squircle}
      pointerEvents="box-none"
      style={{
        gap: 12,
        padding: 12,
        borderRadius: fluid.radius.container,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: hover ? c.surface2 : c.surface1,
      }}
    >
      {button}
      <View pointerEvents="box-none" style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        {info}
        {toggle}
      </View>
      {aside}
    </View>
  ) : (
    <View
      pointerEvents="box-none"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 16,
        padding: 16,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: c.border,
        backgroundColor: hover ? c.surface2 : "transparent",
      }}
    >
      {button}
      {info}
      <View pointerEvents="box-none" style={{ width: usageWidth, flexShrink: 1, alignItems: "flex-start" }}>
        {aside}
      </View>
      {toggle}
      <View {...visualOnly}>
        <Icon name="ChevronRight" size={16} color={c.foregroundMuted} />
      </View>
    </View>
  );
}
