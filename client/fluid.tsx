/* Native button, input-group, segmented control, switch, card and dialog components.
 * Colors come from the Paseo theme; geometry, type and motion follow shared design tokens.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

const body = Platform.select({
  web: "Inter, system-ui, sans-serif",
  ios: "System",
  android: "sans-serif",
});
// Fluid type-scale.ts: [size, leading] per role, default and compact ladder steps.
const scale = {
  display: [[28, 34], [24, 30]],
  title: [[16, 22], [15, 20]],
  subtitle: [[14, 20], [13, 18]],
  body: [[13, 20], [12, 18]],
  caption: [[12, 16], [11, 14]],
} as const;
type Role = keyof typeof scale;

export const fluid = {
  radius: { item: 8, ring: 10, container: 12 },
  control: 36,
  focusRing: "#6B97FF",
  semibold: "600" as const,
  font: {
    body,
    mono: Platform.select({
      ios: "Menlo",
      android: "monospace",
      web: "ui-monospace, SFMono-Regular, monospace",
    }),
  },
  type(compact: boolean) {
    return Object.fromEntries(
      Object.entries(scale).map(([role, steps]) => {
        const [fontSize, lineHeight] = steps[compact ? 1 : 0];
        return [role, { fontFamily: body, fontSize, lineHeight }];
      }),
    ) as Record<
      Role,
      { fontFamily: string | undefined; fontSize: number; lineHeight: number }
    >;
  },
};
const type = fluid.type(false);

// Cards spread `squircle`: on web, where corner-shape is supported, they become 28px squircles (the
// same rule as Chat Polish); elsewhere they keep their round radius.
export const squircle = { dataSet: { paSquircle: "card" } } as object;
type StyleElement = { textContent: string; remove(): void };
export function styleCards() {
  const doc = (globalThis as { document?: { createElement(tag: "style"): StyleElement; head: { appendChild(el: StyleElement): void } } })
    .document;
  if (Platform.OS !== "web" || !doc) return () => {};
  const style = doc.createElement("style");
  style.textContent =
    '@supports (corner-shape: squircle) { [data-pa-squircle="card"] { border-radius: 28px !important; corner-shape: squircle; } }';
  doc.head.appendChild(style);
  return () => style.remove();
}

// Heading level for screen readers; react-native-web maps it to aria-level, native ignores it.
export function headingLevel(level: number): {} {
  return Platform.OS === "web" ? { "aria-level": level } : {};
}

export function FocusRing({ visible, inset = -2 }: { visible: boolean; inset?: number }) {
  return visible ? (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        inset,
        borderRadius: fluid.radius.ring,
        borderWidth: 1,
        borderColor: fluid.focusRing,
      }}
    />
  ) : null;
}

// Only the DOM shape needed for radiogroup keyboard navigation; native controls use accessibility actions.
type RadioElement = { focus(): void; closest(selector: string): RadioElement | null };
type KeyboardEvent = { key: string; preventDefault(): void; target: RadioElement; currentTarget: { querySelectorAll(selector: string): ArrayLike<RadioElement> } };

// Spread on a radiogroup: arrow keys, Home and End move focus between its radios on web; Enter/Space
// activate the focused one through Pressable. Radios use a roving tabIndex (0 when checked).
export const radioKeys =
  Platform.OS === "web"
    ? {
        onKeyDown(event: KeyboardEvent) {
          const items = Array.from(event.currentTarget.querySelectorAll('[role="radio"]'));
          const current = items.indexOf(event.target.closest('[role="radio"]')!);
          const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
          const next =
            step !== undefined
              ? (current + step + items.length) % items.length
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? items.length - 1
                  : -1;
          if (next < 0) return;
          event.preventDefault();
          items[next].focus();
        },
      }
    : {};

// A status tint behind content: theme colors are opaque, so the fill (or outline) is drawn at an opacity.
export function Tint({
  color,
  opacity,
  radius = fluid.radius.container,
  outline = false,
  card = false,
}: {
  color: string;
  opacity: number;
  radius?: number;
  outline?: boolean;
  card?: boolean; // fills a squircle card, so takes its shape
}) {
  return (
    <View
      {...(card ? squircle : {})}
      pointerEvents="none"
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: radius,
        opacity,
        ...(outline ? { borderWidth: 1, borderColor: color } : { backgroundColor: color }),
      }}
    />
  );
}

// "link" (card.tsx action link): no padding or fill, so its text lines up with surrounding content.
// "accent": the dialog's confirming action.
type ButtonVariant = "primary" | "accent" | "secondary" | "tertiary" | "ghost" | "link";

// button.tsx: the fill contracts one pixel per edge while pressed instead of scaling.
export function FluidButton({
  theme,
  label,
  onPress,
  variant = "secondary",
  destructive = false,
  disabled = false,
  loading = false,
  accessibilityLabel,
  expanded,
  icon,
  iconOnly = false,
  accent = false,
  stretch = false,
}: {
  theme: PluginTheme;
  label: string;
  onPress(): void;
  accessibilityLabel?: string; // for symbol-only labels such as ✕
  expanded?: boolean; // disclosure buttons
  icon?: string; // Lucide name, before the label
  iconOnly?: boolean; // square button; the label stays as the accessibility label
  accent?: boolean; // accent-colored text for in-line actions on link and ghost buttons
  stretch?: boolean; // full width of the parent
  variant?: ButtonVariant;
  destructive?: boolean;
  disabled?: boolean;
  loading?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const c = theme.colors;
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive, busy: loading, expanded }}
      disabled={inactive}
      hitSlop={4}
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      onPressIn={() => setFocus(false)} // approximate :focus-visible
      style={{
        height: fluid.control,
        width: iconOnly ? fluid.control : undefined,
        paddingHorizontal: variant === "link" || iconOnly ? 0 : icon ? 12 : 16,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        alignSelf: stretch ? "stretch" : "flex-start",
        maxWidth: "100%",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {({ pressed }) => {
        const lit = (hover || pressed) && !inactive;
        const solid = variant === "primary" || variant === "accent" || variant === "secondary";
        const color =
          variant === "primary"
            ? c.surface0
            : variant === "accent"
              ? c.accentForeground
              : destructive
                ? c.statusDanger
                : accent
                  ? c.accent
                  : (variant === "ghost" || variant === "link") && !lit
                    ? c.foregroundMuted
                    : c.foreground;
        return (
          <>
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                inset: pressed ? 1 : 0,
                borderRadius: fluid.radius.item - (pressed ? 1 : 0),
                backgroundColor:
                  variant === "primary"
                    ? c.foreground
                    : variant === "accent"
                      ? c.accent
                      : solid || (lit && variant !== "link")
                      ? c.surface2
                      : "transparent",
                opacity: solid && lit ? (pressed ? 0.8 : 0.9) : 1,
                borderWidth: variant === "tertiary" ? 1 : 0,
                borderColor: c.border,
              }}
            />
            <FocusRing visible={focus} />
            {loading ? (
              <ActivityIndicator size="small" color={color} />
            ) : icon ? (
              // A View stacks above the absolute fill on web; a bare svg would paint under it.
              <View>
                <Icon name={icon} size={16} color={color} />
              </View>
            ) : null}
            {iconOnly && (icon || loading) ? null : (
              <Text
                numberOfLines={1}
                style={{ ...type.body, fontWeight: "500", color }}
              >
                {label}
              </Text>
            )}
          </>
        );
      }}
    </Pressable>
  );
}

// input-group.tsx states, except fields keep a hairline frame at rest: frameless fields made
// placeholders read as filled-in values in this form-heavy screen.
export function FluidField({
  theme,
  label,
  value,
  onChangeText,
  placeholder = "",
  helper = "",
  error = "",
  secret = false,
  multiline = false,
  disabled = false,
  hideLabel = false,
  mono = false,
  icon,
}: {
  theme: PluginTheme;
  label: string;
  value: string;
  onChangeText(value: string): void;
  placeholder?: string;
  helper?: string;
  error?: string;
  secret?: boolean;
  multiline?: boolean;
  disabled?: boolean;
  hideLabel?: boolean;
  mono?: boolean;
  icon?: string; // Lucide name inside the field's leading edge
}) {
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const c = theme.colors;
  return (
    <View
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      style={{ gap: 4, minWidth: 0, opacity: disabled ? 0.5 : 1 }}
    >
      {hideLabel ? null : (
        <Text
          style={{
            ...type.body,
            color: error ? c.statusDanger : c.foreground,
          }}
        >
          {label}
        </Text>
      )}
      {icon ? (
        <View pointerEvents="none" style={{ position: "absolute", left: 10, top: (hideLabel ? 0 : 24) + 10, zIndex: 1 }}>
          <Icon name={icon} size={16} color={c.foregroundMuted} />
        </View>
      ) : null}
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={error || helper || undefined}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.foregroundMuted}
        secureTextEntry={secret}
        multiline={multiline}
        editable={!disabled}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          color: c.foreground,
          backgroundColor: focused || !hovered ? c.surface0 : c.surface2,
          borderWidth: 1,
          borderColor: error ? c.statusDanger : focused ? fluid.focusRing : c.border,
          borderRadius: fluid.radius.item,
          minHeight: multiline ? 88 : fluid.control,
          paddingHorizontal: 10,
          paddingLeft: icon ? 34 : 10,
          paddingVertical: 8,
          fontFamily: mono && value ? fluid.font.mono : fluid.font.body, // hints stay in the text face
          // 16px on touch avoids focus zoom (type-scale.ts fieldTouchClass).
          fontSize: Platform.OS === "web" ? 13 : 16,
          lineHeight: 20,
          textAlignVertical: multiline ? "top" : "center",
          outlineWidth: 0, // the border is the focus ring
        }}
      />
      {error || helper ? (
        <Text
          style={{
            ...type.caption,
            color: error ? c.statusDanger : c.foregroundMuted,
          }}
        >
          {error || helper}
        </Text>
      ) : null}
    </View>
  );
}

// switch.tsx geometry: 34×20 track, 16px thumb inset 2px. Same look on every platform.
export function FluidSwitch({
  theme,
  label,
  value,
  onChange,
  disabled = false,
}: {
  theme: PluginTheme;
  label: string;
  value: boolean;
  onChange(value: boolean): void;
  disabled?: boolean;
}) {
  const [focus, setFocus] = useState(false);
  const c = theme.colors;
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled }}
      aria-checked={value}
      disabled={disabled}
      hitSlop={12}
      onPress={() => onChange(!value)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      onPressIn={() => setFocus(false)}
      style={{
        width: 34,
        height: 20,
        borderRadius: 10,
        backgroundColor: value ? c.foreground : c.surface2,
        borderWidth: value ? 0 : 1,
        borderColor: c.border,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {focus ? (
        <View
          pointerEvents="none"
          style={{ position: "absolute", inset: -3, borderRadius: 13, borderWidth: 1, borderColor: fluid.focusRing }}
        />
      ) : null}
      <View
        style={{
          position: "absolute",
          top: value ? 2 : 1,
          left: value ? 16 : 1,
          width: 16,
          height: 16,
          borderRadius: 8,
          backgroundColor: value ? c.surface0 : c.foregroundMuted,
        }}
      />
    </Pressable>
  );
}

// Settings-style row: label column on wide layouts, stacked on compact ones.
export function FluidRow({
  theme,
  label,
  trailing = "",
  compact = false,
  children,
}: {
  theme: PluginTheme;
  label: string;
  trailing?: string; // a short hint at the end of the label line (stacked layout)
  compact?: boolean;
  children: ReactNode;
}) {
  const labelText = (
    <Text
      style={{
        ...type.body,
        flex: compact ? 1 : undefined,
        width: compact ? undefined : 132,
        paddingTop: compact ? 0 : 8,
        color: theme.colors.foregroundMuted,
      }}
    >
      {label}
    </Text>
  );
  return (
    <View style={{ flexDirection: compact ? "column" : "row", gap: compact ? 6 : 16 }}>
      {compact && trailing ? (
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
          {labelText}
          <Text style={{ ...type.caption, color: theme.colors.foregroundMuted }}>{trailing}</Text>
        </View>
      ) : (
        labelText
      )}
      <View style={{ flex: compact ? undefined : 1, minWidth: 0, gap: 8 }}>{children}</View>
    </View>
  );
}

// Only the DOM shape needed for dialog keyboard handling on web; the lib config has no DOM types.
type DomElement = {
  focus(): void;
  contains(node: unknown): boolean;
  querySelectorAll(selector: string): ArrayLike<DomElement>;
};
type DomEvent = { key: string; shiftKey: boolean; preventDefault(): void };
type DomDocument = {
  activeElement: DomElement | null;
  addEventListener(type: "keydown", listener: (event: DomEvent) => void): void;
  removeEventListener(type: "keydown", listener: (event: DomEvent) => void): void;
};
const tabbable = 'input:not([disabled]), textarea:not([disabled]), [tabindex="0"]';

// dialog.tsx: a raised panel over a dimmed backdrop, drawn inside the plugin surface rather than as a
// native Modal so it only covers this screen. Anchored near the top so it does not jump as content
// changes; full-height on compact layouts. Fades in (moderate tier). Backdrop click, ✕ and Escape call
// onClose. On web, focus moves into the dialog, Tab cycles inside it, and returns to the opener on close.
export function FluidDialog({
  theme,
  title,
  subtitle,
  compact = false,
  onClose,
  footer,
  children,
}: {
  theme: PluginTheme;
  title: string;
  subtitle?: string;
  compact?: boolean;
  onClose(): void;
  footer: ReactNode;
  children: ReactNode;
}) {
  const c = theme.colors;
  const t = fluid.type(compact);
  const opacity = useRef(new Animated.Value(0)).current;
  const panel = useRef<View>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: Platform.OS !== "web" }).start();
    const doc = (globalThis as { document?: DomDocument }).document;
    const node = panel.current as unknown as DomElement | null;
    if (Platform.OS !== "web" || !doc || !node) return;
    const opener = doc.activeElement;
    const items = () => Array.from(node.querySelectorAll(tabbable));
    (node.querySelectorAll("input:not([disabled]), textarea:not([disabled])")[0] ?? items()[0])?.focus();
    const onKey = (event: DomEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const list = items();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      const active = doc.activeElement;
      const wrapTo = !node.contains(active) ? first : event.shiftKey && active === first ? last : !event.shiftKey && active === last ? first : null;
      if (wrapTo) {
        event.preventDefault();
        wrapTo.focus();
      }
    };
    doc.addEventListener("keydown", onKey);
    return () => {
      doc.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [opacity]);
  const pad = compact ? 16 : 24;
  return (
    <Animated.View
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 10,
        opacity,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        alignItems: "center",
        justifyContent: compact ? "center" : "flex-start",
        padding: compact ? 0 : 24,
        paddingTop: compact ? 0 : 56,
      }}
    >
      <Pressable
        accessible={false}
        importantForAccessibility="no"
        aria-hidden
        tabIndex={-1}
        onPress={onClose}
        style={{ position: "absolute", inset: 0 }}
      />
      <View
        ref={panel}
        role="dialog"
        aria-modal
        aria-label={title}
        accessibilityViewIsModal
        style={{
          width: "100%",
          maxWidth: 640,
          height: compact ? "100%" : undefined,
          maxHeight: "100%",
          backgroundColor: c.surface1,
          borderRadius: compact ? 0 : fluid.radius.container + 4,
          borderWidth: compact ? 0 : 1,
          borderColor: c.border,
          overflow: "hidden",
          shadowColor: "#000",
          shadowOpacity: 0.3,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 12 },
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingLeft: pad,
            paddingRight: pad - 8,
            paddingVertical: 12,
            borderBottomWidth: 1,
            borderBottomColor: c.border,
          }}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              accessibilityRole="header"
              {...headingLevel(2)}
              numberOfLines={1}
              style={{ ...t.title, color: c.foreground, fontWeight: fluid.semibold }}
            >
              {title}
            </Text>
            {subtitle ? (
              <Text numberOfLines={1} style={{ ...t.body, color: c.foregroundMuted }}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          <FluidButton theme={theme} label="Close" icon="X" iconOnly variant="ghost" onPress={onClose} />
        </View>
        <ScrollView
          style={{ flexGrow: compact ? 1 : 0, flexShrink: 1 }}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: pad }}
        >
          {children}
        </ScrollView>
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 8,
            paddingHorizontal: pad,
            paddingVertical: 12,
            borderTopWidth: 1,
            borderTopColor: c.border,
          }}
        >
          {footer}
        </View>
      </View>
    </Animated.View>
  );
}

// segmented-control: one choice of a few, with optional counts. A radiogroup, like the select menu.
export function FluidSegmented<Value extends string>({
  theme,
  label,
  value,
  options,
  onChange,
  compact = false,
}: {
  theme: PluginTheme;
  label: string;
  value: Value;
  options: Array<{ value: Value; label: string; count?: number }>;
  onChange(value: Value): void;
  compact?: boolean; // full width, equal segments
}) {
  const c = theme.colors;
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      {...radioKeys}
      style={{
        flexDirection: "row",
        alignSelf: compact ? "stretch" : "flex-start",
        padding: 3,
        gap: 2,
        borderRadius: fluid.radius.ring,
        borderWidth: 1,
        borderColor: c.border,
      }}
    >
      {options.map((option) => (
        <Segment
          key={option.value}
          theme={theme}
          option={option}
          checked={option.value === value}
          grow={compact}
          onPress={() => onChange(option.value)}
        />
      ))}
    </View>
  );
}

function Segment({
  theme,
  option,
  checked,
  grow,
  onPress,
}: {
  theme: PluginTheme;
  option: { label: string; count?: number };
  checked: boolean;
  grow: boolean;
  onPress(): void;
}) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const c = theme.colors;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={option.count === undefined ? option.label : `${option.label}, ${option.count}`}
      aria-checked={checked}
      accessibilityState={{ checked }}
      tabIndex={checked ? 0 : -1}
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      onPressIn={() => setFocus(false)}
      style={{
        flexGrow: grow ? 1 : 0,
        flexBasis: grow ? 0 : "auto",
        height: fluid.control - 8,
        paddingHorizontal: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        borderRadius: fluid.radius.item - 1,
        backgroundColor: checked ? c.surface2 : "transparent",
      }}
    >
      <FocusRing visible={focus} inset={-1} />
      <Text style={{ ...type.body, fontWeight: "500", color: checked || hover ? c.foreground : c.foregroundMuted }}>
        {option.label}
      </Text>
      {option.count === undefined ? null : (
        <Text style={{ ...type.caption, color: c.foregroundMuted, fontVariant: ["tabular-nums"] }}>{option.count}</Text>
      )}
    </Pressable>
  );
}
