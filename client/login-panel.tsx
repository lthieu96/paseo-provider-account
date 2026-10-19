import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl } from "@getpaseo/plugin/client";
import { Icon, copyText } from "@getpaseo/plugin/client/react-native";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import type { LoginState } from "../shared/login.ts";
import { FluidButton, FluidField, Tint, fluid, squircle } from "./fluid.tsx";

const steps = ["Open page", "Approve", "Done"];

// Progress of an in-app sign-in, one card replaced in place: steps on top, then the link to open, the
// Codex device code, or the pasted Claude code. Done and failed tint the card.
export function LoginPanel({
  theme,
  compact,
  hostLabel,
  login,
  busy,
  onSubmitCode,
  onCancel,
  onRetry,
}: {
  theme: PluginTheme;
  compact: boolean;
  hostLabel: string;
  login: LoginState;
  busy: boolean;
  onSubmitCode(code: string): void;
  onCancel(): void;
  onRetry(method: "browser" | "code"): void;
}) {
  const [code, setCode] = useState("");
  const [useCode, setUseCode] = useState(false);
  const [opened, setOpened] = useState(false);
  const [note, setNote] = useState("");
  // The raw link only shows when it can't be opened or copied, so it can be selected by hand.
  const [showLink, setShowLink] = useState(false);
  const c = theme.colors;
  const t = fluid.type(compact);
  const text = { ...t.body, color: c.foreground };
  const muted = { ...t.caption, color: c.foregroundMuted };
  const link = login.provider === "claude" && useCode ? login.codeUrl : login.url ?? login.codeUrl;
  const method = login.userCode ? "code" : "browser";
  const open = (url: string) => {
    setOpened(true);
    return openExternalUrl(url).catch(() => {
      setNote("Couldn't open a browser here. Copy the link instead.");
      setShowLink(true);
    });
  };
  const copy = (value: string, what: string) => {
    if (what === "Link") setOpened(true);
    return copyText(value).then(
      () => setNote(`${what} copied.`),
      () => {
        setNote("Copying isn't available here. Select the text below instead.");
        setShowLink(true);
      },
    );
  };
  const row = { flexDirection: "row" as const, flexWrap: "wrap" as const, alignItems: "center" as const, gap: 8 };
  const card = (children: ReactNode, tint?: string, live = false) => (
    <View
      {...squircle}
      accessibilityLiveRegion={live ? "polite" : undefined}
      style={{ gap: 12, padding: 16, borderRadius: fluid.radius.container, borderWidth: tint ? 0 : 1, borderColor: c.border }}
    >
      {tint ? (
        <>
          <Tint color={tint} opacity={0.07} card />
          <Tint color={tint} opacity={0.4} outline card />
        </>
      ) : null}
      {children}
    </View>
  );

  if (login.step === "done")
    return card(
      <View style={{ ...row, gap: 12 }}>
        <View style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}>
          <Tint color={c.statusSuccess} opacity={0.16} radius={18} />
          <View>
            <Icon name="Check" size={18} color={c.statusSuccess} />
          </View>
        </View>
        <View style={{ flex: 1, minWidth: 160 }}>
          <Text style={{ ...t.subtitle, color: c.foreground, fontWeight: fluid.semibold }}>
            {login.email ?? "Signed in"}
          </Text>
          <Text style={muted}>{[login.plan, "Save to finish"].filter(Boolean).join(" · ")}</Text>
        </View>
        <FluidButton theme={theme} label="Sign in again" icon="RotateCcw" variant="ghost" disabled={busy} onPress={() => onRetry(method)} />
      </View>,
      c.statusSuccess,
      true,
    );
  if (login.step === "failed" || login.step === "canceled") {
    const failed = login.step === "failed";
    return card(
      <>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Icon name={failed ? "CircleAlert" : "CircleSlash"} size={18} color={failed ? c.statusDanger : c.foregroundMuted} />
          <Text style={{ ...text, flex: 1, color: failed ? c.statusDanger : c.foregroundMuted }}>
            {failed ? login.message || "Sign-in did not finish." : "Sign-in canceled."}
          </Text>
        </View>
        <View style={row}>
          <FluidButton theme={theme} label="Try again" icon="RotateCcw" variant="primary" onPress={() => onRetry(method)} disabled={busy} />
          {method === "code" ? (
            <FluidButton theme={theme} label="Use the browser" onPress={() => onRetry("browser")} disabled={busy} />
          ) : null}
        </View>
      </>,
      failed ? c.statusDanger : undefined,
      true,
    );
  }
  if (login.step === "starting" || !link)
    return card(
      <>
        <View style={row}>
          <ActivityIndicator size="small" color={c.foregroundMuted} />
          <Text style={muted}>Starting the official sign-in…</Text>
        </View>
        <FluidButton theme={theme} label="Cancel" variant="ghost" onPress={onCancel} />
      </>,
    );
  const current = login.step === "checking" ? 2 : opened || useCode ? 1 : 0;
  return card(
    <>
      <View accessible accessibilityLabel={`Step ${current + 1} of 3: ${steps[current]}`} style={{ ...row, columnGap: 10 }}>
        {steps.map((step, index) => {
          const done = index < current;
          const color = done ? c.statusSuccess : index === current ? c.foreground : c.foregroundMuted;
          return (
            <View key={step} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              {index ? <View style={{ width: 16, height: 1, backgroundColor: c.border }} /> : null}
              <View
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  borderWidth: 1.5,
                  borderColor: color,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {done ? (
                  <Icon name="Check" size={12} color={color} />
                ) : (
                  <Text style={{ ...t.caption, fontSize: 11, lineHeight: 14, color }}>{index + 1}</Text>
                )}
              </View>
              <Text style={{ ...t.body, color }}>{step}</Text>
            </View>
          );
        })}
      </View>
      {login.step === "checking" ? (
        <View style={row}>
          <ActivityIndicator size="small" color={c.foregroundMuted} />
          <Text style={muted}>Checking the account…</Text>
        </View>
      ) : null}
      <Text style={text}>
        {login.userCode
          ? "Open the page and enter this code:"
          : useCode
            ? "Sign in on any device, then paste the code it shows — including the part after #."
            : `Open the page and approve in a browser on ${hostLabel}. This finishes by itself.`}
      </Text>
      {login.userCode ? (
        <View
          style={{
            ...row,
            justifyContent: "space-between",
            padding: 12,
            paddingLeft: 16,
            borderRadius: fluid.radius.container,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.surface0,
          }}
        >
          <Text selectable style={{ ...t.display, fontFamily: fluid.font.mono, color: c.foreground, letterSpacing: 4 }}>
            {login.userCode}
          </Text>
          <FluidButton
            theme={theme}
            label="Copy"
            accessibilityLabel="Copy code"
            icon="Copy"
            onPress={() => void copy(login.userCode!, "Code")}
          />
        </View>
      ) : null}
      {useCode ? (
        <FluidField
          theme={theme}
          label="Code from the sign-in page"
          hideLabel
          value={code}
          onChangeText={setCode}
          placeholder="Paste the whole code, including the part after #"
          mono
        />
      ) : null}
      <View style={row}>
        {useCode ? (
          <FluidButton
            theme={theme}
            label="Finish sign-in"
            variant="primary"
            disabled={busy || !code.trim()}
            onPress={() => onSubmitCode(code)}
          />
        ) : null}
        {useCode ? null : (
          <FluidButton theme={theme} label="Open sign-in page" icon="ExternalLink" variant="primary" onPress={() => void open(link)} />
        )}
        {login.userCode ? null : (
          <FluidButton theme={theme} label="Copy link" icon="Copy" onPress={() => void copy(link, "Link")} />
        )}
        {useCode ? (
          <FluidButton theme={theme} label="Back" variant="ghost" onPress={() => setUseCode(false)} />
        ) : (
          <FluidButton theme={theme} label="Cancel" variant="ghost" onPress={onCancel} />
        )}
      </View>
      {showLink ? (
        <Text selectable numberOfLines={2} style={{ ...muted, fontFamily: fluid.font.mono }}>
          {link}
        </Text>
      ) : null}
      {login.provider === "claude" && login.codeUrl && !useCode ? (
        <View style={{ borderTopWidth: 1, borderTopColor: c.border, paddingTop: 4 }}>
          <FluidButton
            theme={theme}
            label="On another device? Use a code instead"
            icon="Smartphone"
            variant="link"
            accent
            onPress={() => setUseCode(true)}
          />
        </View>
      ) : null}
      {login.provider === "codex" && login.userCode ? (
        <Text style={muted}>Needs "device code login" in ChatGPT → Settings → Security.</Text>
      ) : null}
      {login.provider === "codex" && !login.userCode ? (
        <Text style={muted}>The browser callback only works on the host computer. Elsewhere, cancel and use a device code.</Text>
      ) : null}
      {login.message || note ? (
        <Text accessibilityLiveRegion="polite" style={muted}>
          {login.message || note}
        </Text>
      ) : null}
    </>,
  );
}
