import type { PluginTheme } from "@getpaseo/plugin";
import { Text, View } from "react-native";
import type { UsageReport } from "../shared/usage.ts";
import { fluid } from "./fluid.tsx";

export const meterWidth = 108;
export const meterGap = 14;

function resetLabel(iso: string) {
  const date = new Date(iso);
  const days = (date.getTime() - Date.now()) / 86400000;
  const sameDay = date.toDateString() === new Date().toDateString();
  return date.toLocaleString("en-US", {
    ...(sameDay ? {} : days < 6 ? { weekday: "short" } : { month: "short", day: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
}

// "5-hour limit" → "5-hour"; the 7-day window is what people call the weekly limit.
// "Weekly · Fable" shows as "Fable": the full label does not fit a meter column.
export const windowLabel = (label: string) =>
  label.replace(/ limit$/, "").replace(/^7-day$/, "Weekly").replace(/^Weekly · /, "");

// Quota meters. Wide: fixed-width columns (label and % over a bar) so bars line up across rows. Compact:
// stacked rows with fixed label and % columns. Reset times show once a limit is ≥75%.
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
  const tone = (used: number | null) =>
    used !== null && used >= 90 ? c.statusDanger : used !== null && used >= 75 ? c.statusWarning : c.foreground;
  const track = (used: number | null, style: object) => (
    <View style={{ height: 4, borderRadius: 2, overflow: "hidden", ...style }}>
      {/* Track at 12% foreground, Fluid's border mix, so it reads on light and dark surfaces. */}
      <View style={{ position: "absolute", inset: 0, backgroundColor: c.foreground, opacity: 0.12 }} />
      {used !== null ? <View style={{ width: `${used}%`, height: 4, backgroundColor: tone(used) }} /> : null}
    </View>
  );
  return (
    <View
      style={
        compact
          ? { gap: 8 }
          : { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", columnGap: meterGap, rowGap: 10 }
      }
    >
      {report.windows.map((window) => {
        const used = window.usedPct;
        const label = windowLabel(window.label);
        const percentText = used === null ? "—" : `${Math.round(used)}%`;
        const reset = used !== null && used >= 75 && window.resetsAt ? `resets ${resetLabel(window.resetsAt)}` : "";
        const a11y = {
          accessibilityRole: "progressbar" as const,
          accessibilityLabel: `${label} usage${window.resetsAt ? `, resets ${resetLabel(window.resetsAt)}` : ""}`,
          accessibilityValue:
            used === null ? { text: "Not reported" } : { min: 0, max: 100, now: Math.round(used) },
        };
        const percent = (style: object = {}) => (
          <Text style={{ ...caption, ...style, color: tone(used), fontWeight: "500", fontVariant: ["tabular-nums"] }}>
            {percentText}
          </Text>
        );
        // Compact: label column, bar, right-aligned % column; the reset line starts under the bar.
        return compact ? (
          <View key={window.id} {...a11y} style={{ gap: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text numberOfLines={1} style={{ ...muted, width: 96, flexShrink: 0 }}>
                {label}
              </Text>
              {track(used, { flex: 1 })}
              {percent({ width: 32, flexShrink: 0, textAlign: "right" })}
            </View>
            {reset ? <Text style={{ ...muted, paddingLeft: 104 }}>{reset}</Text> : null}
          </View>
        ) : (
          <View key={window.id} {...a11y} style={{ width: meterWidth, gap: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
              <Text numberOfLines={1} style={{ ...muted, flex: 1 }}>
                {label}
              </Text>
              {percent()}
            </View>
            {track(used, {})}
            {reset ? <Text numberOfLines={1} style={muted}>{reset}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}
