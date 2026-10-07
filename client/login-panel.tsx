import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl } from "@getpaseo/plugin/client";
import { copyText } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import type { LoginState } from "../shared/login.ts";
import { FluidButton, FluidField, fluid } from "./fluid.tsx";

// Progress of an in-app sign-in: the link to open, the Codex device code, or the pasted Claude code.
export function LoginPanel({
  theme,
  compact,
  login,
  busy,
  onSubmitCode,
  onCancel,
  onRetry,
}: {
  theme: PluginTheme;
  compact: boolean;
  login: LoginState;
  busy: boolean;
  onSubmitCode(code: string): void;
  onCancel(): void;
  onRetry(): void;
}) {
  const [code, setCode] = useState("");
  const [useCode, setUseCode] = useState(false);
  const [note, setNote] = useState("");
  const c = theme.colors;
  const t = fluid.type(compact);
  const text = { ...t.body, color: c.foreground };
  const muted = { ...t.caption, color: c.foregroundMuted };
  const link = login.provider === "claude" && useCode ? login.codeUrl : login.url ?? login.codeUrl;
  const open = (url: string) => openExternalUrl(url).catch(() => setNote("Couldn't open a browser here. Copy the link instead."));
  const copy = (value: string, what: string) =>
    copyText(value).then(
      () => setNote(`${what} copied.`),
      () => setNote("Copying isn't available here. Select the text below instead."),
    );
  const row = { flexDirection: "row" as const, flexWrap: "wrap" as const, alignItems: "center" as const, gap: 8 };
  const box = { gap: 12, padding: 12, borderRadius: fluid.radius.item, backgroundColor: c.surface2 };

  if (login.step === "done")
    return (
      <View style={box} accessibilityLiveRegion="polite">
        <Text style={{ ...text, color: c.statusSuccess }}>
          ✓ Signed in{login.email ? ` as ${login.email}` : ""}
          {login.plan ? ` (${login.plan})` : ""}. Save to finish.
        </Text>
      </View>
    );
  if (login.step === "failed" || login.step === "canceled")
    return (
      <View style={box} accessibilityLiveRegion="polite">
        <Text style={{ ...text, color: login.step === "failed" ? c.statusDanger : c.foregroundMuted }}>
          {login.step === "failed" ? login.message || "Sign-in did not finish." : "Sign-in canceled."}
        </Text>
        <View style={row}>
          <FluidButton theme={theme} label="Try again" onPress={onRetry} disabled={busy} />
        </View>
      </View>
    );
  if (login.step === "starting" || !link)
    return (
      <View style={{ ...box, ...row }}>
        <ActivityIndicator size="small" color={c.foregroundMuted} />
        <Text style={muted}>Starting the official sign-in…</Text>
        <FluidButton theme={theme} label="Cancel" variant="ghost" onPress={onCancel} />
      </View>
    );
  return (
    <View style={box}>
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
            ? "Open this page on any device, sign in, then paste the code it shows."
            : "Open the page and approve. It finishes by itself in a browser on the host computer."}
      </Text>
      {login.userCode ? (
        <Text selectable style={{ ...t.display, fontFamily: fluid.font.mono, color: c.foreground, letterSpacing: 2 }}>
          {login.userCode}
        </Text>
      ) : null}
      <View style={row}>
        <FluidButton theme={theme} label="Open sign-in page" variant="primary" onPress={() => void open(link)} />
        <FluidButton theme={theme} label="Copy link" onPress={() => void copy(link, "Link")} />
        {login.userCode ? (
          <FluidButton theme={theme} label="Copy code" onPress={() => void copy(login.userCode!, "Code")} />
        ) : null}
        <FluidButton theme={theme} label="Cancel" variant="ghost" onPress={onCancel} />
      </View>
      <Text selectable numberOfLines={2} style={{ ...muted, fontFamily: fluid.font.mono }}>
        {link}
      </Text>
      {login.provider === "claude" && login.codeUrl ? (
        useCode ? (
          <View style={{ gap: 8 }}>
            <FluidField
              theme={theme}
              label="Code from the sign-in page"
              value={code}
              onChangeText={setCode}
              placeholder="Paste the whole code, including the part after #"
              mono
            />
            <View style={row}>
              <FluidButton
                theme={theme}
                label="Finish sign-in"
                variant="primary"
                disabled={busy || !code.trim()}
                onPress={() => onSubmitCode(code)}
              />
            </View>
          </View>
        ) : (
          <FluidButton theme={theme} label="Signing in on another device? Use a code instead" variant="link" onPress={() => setUseCode(true)} />
        )
      ) : null}
      {login.provider === "codex" && !login.userCode ? (
        <Text style={muted}>The browser callback only works on the host computer. Elsewhere, cancel and use a device code.</Text>
      ) : null}
      {login.message || note ? <Text style={muted}>{login.message || note}</Text> : null}
    </View>
  );
}
