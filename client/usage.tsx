import type { PluginTheme } from "@getpaseo/plugin";
import { Text, View } from "react-native";
import type { UsageReport } from "../shared/usage.ts";
import { fluid } from "./fluid.tsx";

function resetLabel(iso: string) {
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return date.toLocaleString("en-US", {
    ...(sameDay ? {} : { month: "short", day: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
}

// Quota meters: "5-hour ▬▬▭ 42%" on one wrapping line, stacked rows on compact. Reset times show once a
// limit is ≥75%.
export function UsageMeters({
  theme,
  report,
  compact,
}: {
  theme: PluginTheme;
  report: UsageReport | undefined;
  compact: boolean;
}) {
  const c = theme.colors;
  const caption = fluid.type(compact).caption;
  const muted = { ...caption, color: c.foregroundMuted };
  if (!report) return <Text style={muted}>Checking usage…</Text>;
  if (report.status !== "available")
    return <Text style={{ ...muted, color: report.status === "error" ? c.statusDanger : c.foregroundMuted }}>{report.message}</Text>;
  const track = (used: number | null, style: object) => (
    <View style={{ height: 4, borderRadius: 2, overflow: "hidden", ...style }}>
      {/* Track at 12% foreground, Fluid's border mix, so it reads on light and dark surfaces. */}
      <View style={{ position: "absolute", inset: 0, backgroundColor: c.foreground, opacity: 0.12 }} />
      {used !== null ? (
        <View
          style={{
            width: `${used}%`,
            height: 4,
            backgroundColor: used >= 90 ? c.statusDanger : used >= 75 ? c.statusWarning : c.foreground,
          }}
        />
      ) : null}
    </View>
  );
  return (
    <View style={compact ? { gap: 6 } : { flexDirection: "row", flexWrap: "wrap", columnGap: 20, rowGap: 6 }}>
      {report.windows.map((window) => {
        const used = window.usedPct;
        const label = window.label.replace(/ limit$/, "");
        const percent = used === null ? "—" : `${Math.round(used)}%`;
        const reset = used !== null && used >= 75 && window.resetsAt ? `resets ${resetLabel(window.resetsAt)}` : "";
        const a11y = {
          accessibilityRole: "progressbar" as const,
          accessibilityLabel: `${label} usage${window.resetsAt ? `, resets ${resetLabel(window.resetsAt)}` : ""}`,
          accessibilityValue:
            used === null ? { text: "Not reported" } : { min: 0, max: 100, now: Math.round(used) },
        };
        // Compact: fixed label and percent columns so stacked bars line up; reset on its own line.
        return compact ? (
          <View key={window.id} {...a11y} style={{ gap: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text numberOfLines={1} style={{ ...muted, width: 88, flexShrink: 0 }}>
                {label}
              </Text>
              {track(used, { flex: 1 })}
              <Text style={{ ...caption, width: 36, flexShrink: 0, textAlign: "right", color: c.foreground, fontVariant: ["tabular-nums"] }}>
                {percent}
              </Text>
            </View>
            {reset ? <Text style={{ ...muted, paddingLeft: 96 }}>{reset}</Text> : null}
          </View>
        ) : (
          <View key={window.id} {...a11y} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={muted}>{label}</Text>
            {track(used, { width: 56 })}
            <Text style={{ ...caption, color: c.foreground, fontVariant: ["tabular-nums"] }}>{percent}</Text>
            {reset ? <Text style={muted}>· {reset}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}
