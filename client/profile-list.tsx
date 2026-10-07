import type { PluginTheme } from "@getpaseo/plugin";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { providers, type Profile } from "../shared/profiles.ts";
import type { UsageReport } from "../shared/usage.ts";
import { isManaged, providerLabels } from "./draft.ts";
import { FluidSwitch, FocusRing, fluid, headingLevel } from "./fluid.tsx";
import { UsageMeters } from "./usage.tsx";

// Profiles grouped by agent. Tap a row to edit; the switch enables or disables it.
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
      {providers.map((provider) => {
        const group = profiles.filter((profile) => profile.provider === provider);
        if (!group.length) return null;
        return (
          <View key={provider} style={{ gap: 8 }}>
            <Text
              accessibilityRole="header"
              {...headingLevel(2)}
              style={{ ...t.subtitle, color: c.foreground, fontWeight: fluid.semibold }}
            >
              {providerLabels[provider]}
            </Text>
            <View
              style={{
                backgroundColor: c.surface1,
                borderWidth: 1,
                borderColor: c.border,
                borderRadius: fluid.radius.container,
                overflow: "hidden",
              }}
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
  const meta = [
    profile.id,
    managed ? (profile.legacySignIn ? "Old sign-in · edit to switch to CLI login" : "CLI login") : null,
  ]
    .filter(Boolean)
    .join(" · ");
  // The row is one button, so its hint carries what the meters show visually.
  const usageSummary =
    report?.status === "available"
      ? report.windows
          .map((w) => `${w.label.replace(/ limit$/, "")} ${w.usedPct === null ? "not reported" : `${Math.round(w.usedPct)}% used`}`)
          .join(", ")
      : report?.message ?? "";
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingRight: compact ? 12 : 16,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: c.border,
        backgroundColor: hover ? c.surface2 : "transparent",
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Edit ${profile.label}`}
        accessibilityHint={[profile.enabled ? "" : "Off", meta, managed && profile.enabled ? usageSummary : ""]
          .filter(Boolean)
          .join(". ")}
        onPress={onEdit}
        onHoverIn={() => setHover(true)}
        onHoverOut={() => setHover(false)}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        onPressIn={() => setFocus(false)}
        style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12, padding: compact ? 12 : 16 }}
      >
        <FocusRing visible={focus} inset={2} />
        <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
          <View>
            <Text
              numberOfLines={1}
              style={{
                ...t.subtitle,
                fontWeight: fluid.semibold,
                color: profile.enabled ? c.foreground : c.foregroundMuted,
              }}
            >
              {profile.label}
            </Text>
            <Text numberOfLines={1} style={{ ...t.caption, color: c.foregroundMuted }}>
              {profile.enabled ? meta : `Off · ${meta}`}
            </Text>
          </View>
          {managed && profile.enabled ? <UsageMeters theme={theme} compact={compact} report={report} /> : null}
        </View>
        <Text aria-hidden style={{ ...t.title, color: c.foregroundMuted }}>
          ›
        </Text>
      </Pressable>
      <FluidSwitch
        theme={theme}
        label={`${profile.label} enabled`}
        value={profile.enabled}
        disabled={busy}
        onChange={onToggle}
      />
    </View>
  );
}
