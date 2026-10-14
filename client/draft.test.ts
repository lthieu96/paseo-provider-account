import assert from "node:assert/strict";
import { test } from "node:test";
import type { Profile } from "../shared/profiles.ts";
import { editDraft, filterProfiles, newDraft, showEnvRow, slug, toSaveInput } from "./draft.ts";

const sample: Profile = {
  id: "codex-work",
  label: "Work",
  provider: "codex",
  enabled: true,
  envKeys: ["CODEX_HOME", "OPENAI_API_KEY"],
  command: [],
  models: [],
  additionalModels: [],
  homeDirectory: "/tmp/codex",
  legacySignIn: true,
  revision: "r1",
};

test("slug turns a profile name into a valid ID", () => {
  assert.equal(slug("Claude · Work"), "claude-work");
  assert.equal(slug("Tài khoản Đông"), "tai-khoan-dong");
  assert.equal(slug("2nd Codex!"), "nd-codex");
});

test("toSaveInput keeps saved env blank, rejects incomplete rows and bad commands", () => {
  const draft = { ...newDraft(), id: "claude-work", label: "Work" };
  draft.env = [
    { name: "SAVED", value: "", saved: true },
    { name: "NEW", value: "1", saved: false },
    { name: "", value: "", saved: false },
  ];
  const input = toSaveInput(draft);
  assert.deepEqual(input.env, { NEW: "1" });
  assert.throws(() => toSaveInput({ ...draft, env: [{ name: "X", value: "", saved: false }] }), /value for X/);
  assert.throws(() => toSaveInput({ ...draft, command: "gemini --acp" }), /JSON array/);
  assert.throws(() => toSaveInput({ ...draft, label: " " }), { field: "label", message: /account name/ });
  // Name is reported before the ID, matching the form order.
  assert.throws(() => toSaveInput({ ...draft, label: "", id: "" }), { field: "label" });
  assert.throws(() => toSaveInput({ ...draft, id: "Bad ID" }), { field: "id" });
  assert.throws(() => toSaveInput({ ...draft, command: "x" }), { field: "command" });
});

test("credential and folder variables stay out of More options for Claude/Codex only", () => {
  const draft = newDraft();
  const row = (name: string) => ({ name, value: "", saved: true });
  assert.equal(showEnvRow(draft, row("ANTHROPIC_API_KEY")), false);
  assert.equal(showEnvRow(draft, row("CLAUDE_CONFIG_DIR")), false);
  assert.equal(showEnvRow(draft, row("MCP_TIMEOUT")), true);
  assert.equal(showEnvRow({ ...draft, provider: "acp" }, row("ANTHROPIC_API_KEY")), true);
});

test("filter tabs group other agents and combine with search", () => {
  const profile = (id: string, provider: Profile["provider"]) => ({ ...sample, id, label: id, provider });
  const all = [profile("work", "claude"), profile("team", "codex"), profile("gem", "acp"), profile("cop", "copilot")];
  assert.deepEqual(filterProfiles(all, "", "all").counts, { all: 4, claude: 1, codex: 1, other: 2 });
  assert.deepEqual(filterProfiles(all, "", "other").visible.map((p) => p.id), ["gem", "cop"]);
  // Agent names match too; counts follow the search.
  const search = filterProfiles(all, " CODEX ", "claude");
  assert.deepEqual(search.counts, { all: 1, claude: 0, codex: 1, other: 0 });
  assert.deepEqual(search.visible, []);
});

test("an untouched edit sends no env values and keeps the account folder", () => {
  const draft = editDraft(sample);
  assert.equal(draft.legacySignIn, true);
  const input = toSaveInput(draft);
  assert.deepEqual(input.env, {});
  assert.equal(input.homeDirectory, "/tmp/codex");
});
