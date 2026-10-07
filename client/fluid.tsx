/* Native adaptation of Fluid Functionalism (MIT, commit bf9ece4): button, input-group,
 * select, switch, card and dialog contracts. See THIRD-PARTY-NOTICES.md.
 * Colors come from the Paseo theme; geometry, type and motion follow the Fluid tokens.
 */
import type { PluginTheme } from "@getpaseo/plugin";
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

// Only the DOM shape needed for menu keyboard navigation; native controls use accessibility actions.
type RadioElement = { focus(): void; closest(selector: string): RadioElement | null };
type KeyboardEvent = { key: string; preventDefault(): void; target: RadioElement; currentTarget: { querySelectorAll(selector: string): ArrayLike<RadioElement> } };


// "link" (card.tsx action link): no padding or fill, so its text lines up with surrounding content.
type ButtonVariant = "primary" | "secondary" | "tertiary" | "ghost" | "link";

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
}: {
  theme: PluginTheme;
  label: string;
  onPress(): void;
  accessibilityLabel?: string; // for symbol-only labels such as ✕
  expanded?: boolean; // disclosure buttons
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
        paddingHorizontal: variant === "link" ? 0 : 16,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        alignSelf: "flex-start",
        maxWidth: "100%",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {({ pressed }) => {
        const lit = (hover || pressed) && !inactive;
        const solid = variant === "primary" || variant === "secondary";
        const color =
          variant === "primary"
            ? c.surface0
            : destructive
              ? c.statusDanger
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
                    : solid || (lit && variant !== "link")
                      ? c.surface2
                      : "transparent",
                opacity: solid && lit ? (pressed ? 0.8 : 0.9) : 1,
                borderWidth: variant === "tertiary" ? 1 : 0,
                borderColor: c.border,
              }}
            />
            <FocusRing visible={focus} />
            {loading ? <ActivityIndicator size="small" color={color} /> : null}
            <Text
              numberOfLines={1}
              style={{ ...type.body, fontWeight: "500", color }}
            >
              {label}
            </Text>
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
  compact = false,
  raised = false,
  children,
}: {
  theme: PluginTheme;
  label: string;
  compact?: boolean;
  raised?: boolean; // lets a floating menu inside paint over the rows after it
  children: ReactNode;
}) {
  return (
    <View style={{ flexDirection: compact ? "column" : "row", gap: compact ? 6 : 16, zIndex: raised ? 1 : 0 }}>
      <Text
        style={{
          ...type.body,
          width: compact ? undefined : 132,
          paddingTop: compact ? 0 : 8,
          color: theme.colors.foregroundMuted,
        }}
      >
        {label}
      </Text>
      <View style={{ flex: compact ? undefined : 1, minWidth: 0, gap: 8, zIndex: raised ? 1 : 0 }}>{children}</View>
    </View>
  );
}

// Only the DOM shape needed for dialog keyboard handling on web; the lib config has no DOM types.
type DomElement = {
  focus(): void;
  contains(node: unknown): boolean;
  querySelectorAll(selector: string): ArrayLike<DomElement>;
};
type DomEvent = { key: string; shiftKey: boolean; target: unknown; preventDefault(): void; stopPropagation(): void };
type DomDocument = {
  activeElement: DomElement | null;
  addEventListener(type: "keydown" | "pointerdown", listener: (event: DomEvent) => void, capture?: boolean): void;
  removeEventListener(type: "keydown" | "pointerdown", listener: (event: DomEvent) => void, capture?: boolean): void;
};
const webDocument = () => (Platform.OS === "web" ? (globalThis as { document?: DomDocument }).document : undefined);
const tabbable = 'input:not([disabled]), textarea:not([disabled]), [tabindex="0"]';

// dialog.tsx: a raised panel over a dimmed backdrop, drawn inside the plugin surface rather than as a
// native Modal so it only covers this screen. Anchored near the top so it does not jump as content
// changes; full-height on compact layouts. Fades in (moderate tier). Backdrop click, ✕ and Escape call
// onClose. On web, focus moves into the dialog, Tab cycles inside it, and returns to the opener on close.
export function FluidDialog({
  theme,
  title,
  compact = false,
  onClose,
  footer,
  children,
}: {
  theme: PluginTheme;
  title: string;
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
          <Text
            accessibilityRole="header"
            {...headingLevel(2)}
            numberOfLines={1}
            style={{ ...t.title, flex: 1, color: c.foreground, fontWeight: fluid.semibold }}
          >
            {title}
          </Text>
          <FluidButton theme={theme} label="✕" accessibilityLabel="Close" variant="ghost" onPress={onClose} />
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

// select.tsx: a field-like trigger with a floating option menu on web. react-native-web Views each
// form a stacking context, so every ancestor up to the overlapped content needs a raised zIndex
// (see FluidRow `raised`). Outside click, Escape and Tab close it; arrows move between options; choosing returns focus to the trigger. Native keeps the list
// inline, because touches outside a parent's bounds are not delivered there.
export function FluidSelect<Value extends string>({
  theme,
  label,
  value,
  options,
  onChange,
  disabled = false,
}: SelectProps<Value>) {
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState(false);
  const root = useRef<View>(null);
  const trigger = useRef<View>(null);
  const menu = useRef<View>(null);
  const floating = Platform.OS === "web";
  const c = theme.colors;
  const current = options.find((option) => option.value === value);
  const dom = (ref: { current: View | null }) => ref.current as unknown as DomElement | null;
  function close(refocus: boolean) {
    setOpen(false);
    if (refocus) dom(trigger)?.focus();
  }
  useEffect(() => {
    const doc = webDocument();
    const node = dom(root);
    if (!open || !doc || !node) return;
    dom(menu)?.querySelectorAll('[aria-checked="true"]')[0]?.focus();
    // Capture phase, so Escape closes only the menu and not the dialog around it.
    const onKey = (event: DomEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        event.preventDefault();
        close(true);
      } else if (event.key === "Tab") setOpen(false);
    };
    const onPointer = (event: DomEvent) => {
      if (!node.contains(event.target)) setOpen(false);
    };
    doc.addEventListener("keydown", onKey, true);
    doc.addEventListener("pointerdown", onPointer, true);
    return () => {
      doc.removeEventListener("keydown", onKey, true);
      doc.removeEventListener("pointerdown", onPointer, true);
    };
  }, [open]);
  // Arrow keys move focus only; Enter/Space activate the focused option through Pressable.
  const menuKeys =
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
  return (
    <View ref={root} style={{ position: "relative", zIndex: open ? 20 : 0 }}>
      <Pressable
        ref={trigger}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current?.label ?? "none"}`}
        accessibilityState={{ expanded: open, disabled }}
        {...(Platform.OS === "web" ? { "aria-haspopup": "true" } : {})}
        disabled={disabled}
        onPress={() => setOpen(!open)}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        onPressIn={() => setFocus(false)}
        style={{
          height: fluid.control,
          paddingHorizontal: 10,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          borderRadius: fluid.radius.item,
          borderWidth: 1,
          borderColor: open ? fluid.focusRing : c.border,
          backgroundColor: c.surface0,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <FocusRing visible={focus} />
        <Text style={{ ...type.body, color: c.foreground }}>{current?.label}</Text>
        <Text aria-hidden style={{ ...type.caption, color: c.foregroundMuted }}>
          {open ? "▲" : "▼"}
        </Text>
      </Pressable>
      {open ? (
        <View
          ref={menu}
          accessibilityRole="radiogroup"
          accessibilityLabel={label}
          {...menuKeys}
          style={{
            ...(floating ? { position: "absolute" as const, top: fluid.control + 4, left: 0, right: 0 } : { marginTop: 4 }),
            padding: 4,
            borderRadius: fluid.radius.item + 4,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.surface1,
            shadowColor: "#000",
            shadowOpacity: 0.25,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 8 },
          }}
        >
          {options.map((option) => (
            <SelectOption
              key={option.value}
              theme={theme}
              label={option.label}
              checked={option.value === value}
              onPress={() => {
                onChange(option.value);
                close(true);
              }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function SelectOption({
  theme,
  label,
  checked,
  onPress,
}: {
  theme: PluginTheme;
  label: string;
  checked: boolean;
  onPress(): void;
}) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const c = theme.colors;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      aria-checked={checked}
      accessibilityState={{ checked }}
      tabIndex={checked ? 0 : -1}
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={{
        height: 32,
        paddingHorizontal: 8,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        borderRadius: fluid.radius.item - 2,
        backgroundColor: hover || focus ? c.surface2 : "transparent",
      }}
    >
      <Text style={{ ...type.body, color: c.foreground, fontWeight: checked ? fluid.semibold : "400" }}>{label}</Text>
      {checked ? <Text aria-hidden style={{ ...type.body, color: c.foreground }}>✓</Text> : null}
    </Pressable>
  );
}

type SelectProps<Value extends string> = {
  theme: PluginTheme;
  label: string;
  value: Value;
  options: Array<{ value: Value; label: string }>;
  onChange(value: Value): void;
  disabled?: boolean;
};
