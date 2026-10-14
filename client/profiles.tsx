import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Platform, ScrollView, Text, View } from "react-native";
import {
  providers,
  listProfilesRpc,
  saveProfileRpc,
  changeProfileRpc,
  type Profile,
} from "../shared/profiles.ts";
import { cancelLoginRpc, loginStatusRpc, startLoginRpc, submitLoginCodeRpc, type LoginState } from "../shared/login.ts";
import { usageRpc, type UsageReport } from "../shared/usage.ts";
import {
  DraftError,
  editDraft,
  filterProfiles,
  newDraft,
  providerLabels,
  toSaveInput,
  type Draft,
  type DraftField,
  type ProviderGroup,
} from "./draft.ts";
import { FluidButton, FluidDialog, FluidField, FluidSegmented, fluid, headingLevel } from "./fluid.tsx";
import { ProfileForm } from "./profile-form.tsx";
import { ProfileList } from "./profile-list.tsx";

// Keeps an open form (and its sign-in) if the user leaves this screen. Typed env values are never kept.
const drafts = new Map<string, Draft>();

const ended = (state: LoginState | undefined) => !!state && ["done", "failed", "canceled"].includes(state.step);
const needsUsageRetry = (data: { reports: UsageReport[] } | undefined) =>
  data?.reports.some(
    (report) =>
      report.status === "error" ||
      report.message === "Login expired. Sign in again." ||
      report.message === "Claude Code is signed out. Sign in again.",
  ) ?? false;

export function ProfilesSurface(props: PluginSurfaceProps) {
  return <ProfilesScreen key={props.host.id} {...props} />;
}

function ProfilesScreen({ theme, layout, host }: PluginSurfaceProps) {
  const list = useRpc(listProfilesRpc);
  const save = useRpc(saveProfileRpc);
  const change = useRpc(changeProfileRpc);
  const startLoginCall = useRpc(startLoginRpc);
  const loginStatus = useRpc(loginStatusRpc);
  const submitLoginCode = useRpc(submitLoginCodeRpc);
  const cancelLoginCall = useRpc(cancelLoginRpc);
  const readUsage = useRpc(usageRpc);
  const cache = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(() => drafts.get(host.id) || null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ProviderGroup | "all">("all");
  // `field` ties a validation message to the input it is about; other errors show in the footer.
  const [error, setError] = useState<{ message: string; field?: DraftField } | null>(null);
  const [notice, setNotice] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Snapshot of the draft as opened; a restored draft (after leaving the screen) counts as changed.
  const pristine = useRef<string | null>(null);
  const profiles = useQuery({ queryKey: ["profiles"], queryFn: () => list({}) });
  const usage = useQuery({
    queryKey: ["profile-usage"],
    queryFn: () => readUsage({ force: false }),
    enabled: !draft,
    refetchInterval: (query) => (needsUsageRetry(query.state.data) ? 30000 : 300000),
    staleTime: (query) => (needsUsageRetry(query.state.data) ? 30000 : 300000),
    retry: false,
  });
  useEffect(() => {
    if (draft)
      drafts.set(host.id, {
        ...draft,
        env: draft.env.map((row) => ({ ...row, value: "" })),
      });
    else drafts.delete(host.id);
  }, [draft, host.id]);

  function applied(data: Awaited<ReturnType<typeof list>>, message: string) {
    cache.setQueryData(["profiles"], data);
    void cache.invalidateQueries({ queryKey: ["profile-usage"] });
    setDraft(null);
    setNotice(message);
  }
  function failed(failure: Error) {
    setError({ message: failure.message });
    void cache.invalidateQueries({ queryKey: ["profiles"] });
  }
  const saveMutation = useMutation({
    mutationFn: save,
    gcTime: 0, // do not keep the submitted secret in the mutation cache
    onSuccess: (data) => applied(data, "Saved. Pick the account in the model picker for new agents."),
    onError: failed,
    onSettled() {
      saveMutation.reset();
    },
  });
  const changeMutation = useMutation({
    mutationFn: change,
    onSuccess: (data, input) => applied(data, input.action === "delete" ? "Account deleted." : ""),
    onError: failed,
  });
  const refreshUsage = useMutation({
    mutationFn: () => readUsage({ force: true }),
    onSuccess: (data) => cache.setQueryData(["profile-usage"], data),
  });
  // The sign-in runs on the daemon; poll it until it ends.
  const loginId = draft?.loginId;
  const login = useQuery({
    queryKey: ["login", loginId],
    queryFn: () => loginStatus({ loginId: loginId! }),
    enabled: !!loginId,
    refetchInterval: (query) => (ended(query.state.data) ? false : 1000),
    retry: false,
    gcTime: 0,
  });
  const loginStart = useMutation({
    mutationFn: startLoginCall,
    onSuccess(state) {
      cache.setQueryData(["login", state.loginId], state);
      setDraft((previous) =>
        previous ? { ...previous, loginId: state.loginId, homeDirectory: state.homeDirectory } : previous,
      );
    },
    onError: failed,
  });
  useEffect(() => {
    // The sign-in is gone (e.g. the plugin reloaded): offer to start again.
    if (login.error) {
      setDraft((previous) => (previous ? { ...previous, loginId: undefined } : previous));
      setError({ message: login.error.message });
    }
  }, [login.error]);
  const busy = saveMutation.isPending || changeMutation.isPending;
  const c = theme.colors;
  const t = fluid.type(layout.compact);
  const muted = { ...t.body, color: c.foregroundMuted };

  function open(next: Draft | null) {
    // Leaving the dialog stops a sign-in that is still waiting.
    if (loginId && !ended(login.data)) void cancelLoginCall({ loginId }).catch(() => undefined);
    pristine.current = next ? JSON.stringify(next) : null;
    setDraft(next);
    setError(null);
    setNotice("");
    setConfirmDiscard(false);
  }
  // Closing a changed draft asks first; asking again (Escape, backdrop) confirms the discard.
  function requestClose() {
    if (!draft || confirmDiscard || !dirty) open(null);
    else setConfirmDiscard(true);
  }
  function update(patch: Partial<Draft>) {
    setError(null);
    setConfirmDiscard(false);
    setDraft((previous) => (previous ? { ...previous, ...patch } : previous));
  }
  function startLogin(method: "browser" | "code") {
    if (!draft || (draft.provider !== "claude" && draft.provider !== "codex")) return;
    const id = draft.id.trim();
    if (!/^[a-z][a-z0-9-]*$/.test(id) || providers.some((provider) => provider === id))
      return setError({ message: "Enter a valid account ID first.", field: "id" });
    setError(null);
    loginStart.mutate({ id, provider: draft.provider, homeDirectory: draft.homeDirectory, method });
  }
  function loginCall(call: (loginId: string) => Promise<LoginState>) {
    if (!loginId) return;
    call(loginId).then((state) => cache.setQueryData(["login", loginId], state), failed);
  }
  function submit() {
    if (!draft) return;
    setError(null);
    try {
      saveMutation.mutate(toSaveInput(draft));
    } catch (failure) {
      setError(
        failure instanceof DraftError
          ? { message: failure.message, field: failure.field }
          : { message: "The account could not be saved." },
      );
    }
  }
  function changeProfile(profile: Profile, action: "enable" | "disable" | "delete") {
    setError(null);
    changeMutation.mutate({ id: profile.id, revision: profile.revision, action });
  }

  const all = profiles.data?.profiles ?? [];
  const { counts, visible } = filterProfiles(all, search, filter);
  const narrowed = !!search.trim() || filter !== "all";
  const dirty = !!draft && JSON.stringify(draft) !== pristine.current;
  const editing = draft?.revision ? all.find((profile) => profile.id === draft.id) : undefined;
  const usageError = refreshUsage.error || usage.error;
  const errorText = error ? (
    <Text accessibilityRole="alert" style={{ ...t.body, color: c.statusDanger, flexShrink: 1 }}>
      {error.field ? `${error.message} See the field marked in red.` : error.message}
    </Text>
  ) : null;

  return (
    <View style={{ flex: 1, backgroundColor: c.surface0 }}>
      <ScrollView
        style={{ flex: 1 }}
        aria-hidden={!!draft}
        importantForAccessibility={draft ? "no-hide-descendants" : "auto"}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: layout.compact ? 12 : 32, paddingBottom: 48 }}
      >
        <View style={{ width: "100%", maxWidth: 760, alignSelf: "center", gap: 16, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              <Text
                accessibilityRole="header"
                {...headingLevel(1)}
                style={{ ...t.display, color: c.foreground, fontWeight: "700" }}
              >
                Provider accounts
              </Text>
              {layout.compact ? null : (
                <Text style={muted}>
                  Separate logins for each agent on {host.label}. Pick one in the model picker when you start an agent.
                </Text>
              )}
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <FluidButton
                theme={theme}
                label="Refresh"
                icon="RefreshCw"
                iconOnly
                variant="tertiary"
                disabled={profiles.isFetching || refreshUsage.isPending}
                loading={profiles.isFetching || refreshUsage.isPending}
                onPress={() => {
                  setError(null);
                  void profiles.refetch();
                  refreshUsage.mutate();
                }}
              />
              <FluidButton
                theme={theme}
                label="New account"
                icon="Plus"
                iconOnly={layout.compact}
                variant="primary"
                disabled={busy || !profiles.data}
                onPress={() => open(newDraft())}
              />
            </View>
          </View>
          {notice ? (
            <Text accessibilityLiveRegion="polite" style={{ ...t.body, color: c.statusSuccess }}>
              {notice}
            </Text>
          ) : null}
          {draft ? null : errorText}
          {usageError ? <Text style={{ ...t.caption, color: c.statusDanger }}>Usage: {usageError.message}</Text> : null}
          <View
            style={{
              flexDirection: layout.compact ? "column" : "row",
              alignItems: layout.compact ? "stretch" : "center",
              gap: layout.compact ? 8 : 16,
            }}
          >
            <FluidSegmented<ProviderGroup | "all">
              theme={theme}
              label="Show accounts"
              compact={layout.compact}
              value={filter}
              onChange={setFilter}
              options={(["all", "claude", "codex", "other"] as const).map((value) => ({
                value,
                label: value === "all" ? "All" : value === "other" ? "Other" : providerLabels[value],
                count: layout.compact ? undefined : counts[value],
              }))}
            />
            <View style={{ flex: layout.compact ? undefined : 1, maxWidth: layout.compact ? undefined : 300, marginLeft: "auto", width: layout.compact ? "100%" : undefined }}>
              <FluidField
                theme={theme}
                label="Search accounts"
                hideLabel
                icon="Search"
                value={search}
                onChangeText={setSearch}
                placeholder="Search accounts"
              />
            </View>
          </View>
          {profiles.isPending ? <Text style={muted}>Loading accounts…</Text> : null}
          {profiles.error ? (
            <Text accessibilityRole="alert" style={{ ...t.body, color: c.statusDanger }}>
              {profiles.error.message}
            </Text>
          ) : null}
          {profiles.data && visible.length === 0 ? (
            <View
              style={{
                padding: 24,
                gap: 4,
                alignItems: "center",
                borderRadius: fluid.radius.container,
                borderWidth: 1,
                borderStyle: "dashed",
                borderColor: c.border,
              }}
            >
              <Text style={{ ...t.subtitle, color: c.foreground }}>
                {narrowed ? "No matching accounts" : "No accounts yet"}
              </Text>
              <Text style={{ ...muted, textAlign: "center" }}>
                {narrowed
                  ? "Try another name, clear the search or show all agents."
                  : "Add one to run Claude, Codex or another agent with a separate login or endpoint."}
              </Text>
            </View>
          ) : null}
          {visible.length ? (
            <ProfileList
              theme={theme}
              compact={layout.compact}
              profiles={visible}
              usage={new Map(usage.data?.reports.map((report) => [report.profileId, report]))}
              busy={busy}
              onEdit={(profile) => open(editDraft(profile))}
              onToggle={(profile, enabled) => changeProfile(profile, enabled ? "enable" : "disable")}
            />
          ) : null}
        </View>
      </ScrollView>

      {draft ? (
        <FluidDialog
          theme={theme}
          compact={layout.compact}
          title={draft.revision ? `Edit ${draft.label || draft.id}` : "New account"}
          subtitle={
            draft.revision
              ? `${draft.id} · ${providerLabels[draft.provider]}`
              : "Shows up in the model picker as its own provider."
          }
          onClose={requestClose}
          footer={
            confirmDiscard ? (
              <>
                <Text style={{ ...t.body, color: c.foreground, flexGrow: 1 }}>Discard unsaved changes?</Text>
                <FluidButton theme={theme} label="Keep editing" variant="ghost" onPress={() => setConfirmDiscard(false)} />
                <FluidButton theme={theme} label="Discard" destructive onPress={() => open(null)} />
              </>
            ) : (
              <>
                {error ? <View style={{ flexBasis: "100%" }}>{errorText}</View> : null}
                {dirty ? (
                  <Text style={{ ...t.body, flexGrow: 1, color: c.statusWarning }}>● Unsaved changes</Text>
                ) : (
                  <Text style={{ ...t.caption, flexGrow: 1, color: c.foregroundMuted }}>
                    {Platform.OS === "web" ? (
                      <>
                        <Text style={{ fontFamily: fluid.font.mono }}>Esc</Text> to cancel
                      </>
                    ) : null}
                  </Text>
                )}
                <FluidButton theme={theme} label="Cancel" variant="ghost" onPress={requestClose} />
                <FluidButton
                  theme={theme}
                  label={saveMutation.isPending ? "Saving…" : draft.revision ? "Save" : "Add account"}
                  variant="accent"
                  disabled={busy}
                  loading={saveMutation.isPending}
                  onPress={submit}
                />
              </>
            )
          }
        >
          <ProfileForm
            key={draft.revision ?? "new"}
            theme={theme}
            compact={layout.compact}
            draft={draft}
            update={update}
            fieldError={error?.field ? { field: error.field, message: error.message } : null}
            busy={busy}
            login={loginId ? (login.data ?? null) : null}
            loginStarting={loginStart.isPending}
            onStartLogin={startLogin}
            onSubmitCode={(code) => loginCall((id) => submitLoginCode({ loginId: id, code }))}
            onCancelLogin={() => loginCall((id) => cancelLoginCall({ loginId: id }))}
            onDelete={() => editing && changeProfile(editing, "delete")}
          />
        </FluidDialog>
      ) : null}
    </View>
  );
}
