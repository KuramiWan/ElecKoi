// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, it, expect, vi } from "vitest";
import { JSDOM } from "jsdom";
import { NativeAuthorClient } from "@eleckoi/dsh-client-author/runtime";
import { dshClientPlugin } from "./helpers/dshClientPlugin";
import { officialChatFixture } from "./helpers/officialTrajectory.js";
const source = readFileSync("packages/client/features/dsh-client-conversations/src/client.js", "utf8");
const record = { id: "synthetic-chat", title: "Synthetic chat", metadata: { characterId: "synthetic-character" } };
const event = (type, seq, data, surfaceOp) => ({ type, seq, time: seq * 100, data, ...surfaceOp ? { surfaceOp } : {} });
const rounds = [1, 2].flatMap((turn) => {
  const base = (turn - 1) * 6;
  return [
    event("turn/start", base + 1, { turn }),
    event("step/start", base + 2, { turn, step: 1 }),
    event("user/message", base + 3, { id: `synthetic-user-${turn}`, role: "user", source: { kind: "user" }, content: [{ type: "text", text: `Synthetic input ${turn}` }] }, "append"),
    event("assistant/message", base + 4, { turn, step: 1, stream: [], message: { id: `synthetic-reply-${turn}`, role: "assistant", source: { provider: "synthetic", model: "synthetic" }, content: [{ type: "text", text: `<FINAL>Synthetic reply ${turn}</FINAL>` }] } }, "append"),
    event("step/end", base + 5, { turn, step: 1 }),
    event("turn/end", base + 6, { turn, reason: { kind: "completed" } })
  ];
});
function catalogFixture(states = {}) {
  let registration, catalog;
  runInNewContext(source, {
    AbortController,
    setTimeout,
    clearTimeout,
    window: { __ModuleLoader__: { load: (value) => {
      registration = value;
    } } }
  });
  dshClientPlugin(registration).apply({ remote: {}, provide: (_name, value) => {
    catalog = value;
  }, effect() {
  }, on: () => () => {
  } });
  catalog.detailsSnapshot = { id: record.id, status: "ready", error: "", details: {
    conversation: record,
    metadata: record.metadata,
    runtimeSessionId: "synthetic-session",
    messages: [],
    runtimeVariableStateByTurn: states,
    hasMore: false
  } };
  const fixture = officialChatFixture();
  let chat = fixture.replace(rounds);
  const session = { getSnapshot: () => ({ running: false }), projections: { faceOf: () => void 0 } };
  const target = { getSnapshot: () => chat };
  catalog.sessionReference = { sessionId: "synthetic-session", binding: {
    session,
    eventSource: { getSnapshot: () => ({ hasMore: false, entries: rounds.map((event2) => ({ type: "event", event: event2 })) }) }
  }, release() {
  } };
  const publish = () => catalog.acceptOfficialSession(record.id, "synthetic-session", session, target);
  publish();
  return { catalog, publishChanged() {
    chat = fixture.append(event("turn/start", 13, { turn: 3 }));
    publish();
  } };
}
function authorFixture(catalog) {
  const page = new JSDOM("<!doctype html><body></body>", { url: "http://localhost/" });
  const latest = vi.fn(async () => ({ ok: true, value: '{"score":99}' }));
  const runtime = new NativeAuthorClient({
    window: page.window,
    conversations: catalog,
    models: {},
    libraries: {},
    report: (error) => {
      throw error;
    },
    remote: {
      eleckoiAuthorVariables: { getState: latest },
      eleckoiCharacterConfiguration: {},
      eleckoiAgentPresets: {}
    }
  });
  return { page, runtime, latest, async close() {
    await runtime.dispose();
    page.window.close();
    catalog.dispose();
  } };
}
describe("historical variable state preservation across official Session publications", () => {
  it("records missing-history behavior across two real official publications", async () => {
    const fixture = catalogFixture();
    const author = authorFixture(fixture.catalog);
    try {
      author.runtime.mountDocument(author.page.window, record.id, "synthetic-reply-1");
      const api = author.page.window.ElecKoi;
      await expect(api.variables.getState({ messageId: "synthetic-reply-1" })).rejects.toMatchObject({ code: "VARIABLE_HISTORY_NOT_AVAILABLE" });
      expect(fixture.catalog.getDetailsSnapshot().details.messages.find((message) => message.id === "synthetic-reply-1")).toMatchObject({ variableSnapshotAvailable: false, variableStateJson: "{}" });
      fixture.publishChanged();
      await expect(api.variables.getState({ messageId: "synthetic-reply-1" })).rejects.toMatchObject({ code: "VARIABLE_HISTORY_NOT_AVAILABLE" });
      expect(fixture.catalog.getDetailsSnapshot().details.messages.find((message) => message.id === "synthetic-reply-1")).toMatchObject({ variableSnapshotAvailable: false, nativeVariableStateJson: void 0 });
      expect(fixture.catalog.getDetailsSnapshot().details.runtimeVariableStateByTurn).toEqual({});
      expect(author.latest).not.toHaveBeenCalled();
    } finally {
      await author.close();
    }
  });
  it.each([
    ["valid empty snapshot", "{}", {}],
    ["valid populated snapshot", '{"score":7}', { score: 7 }]
  ])("keeps %s distinct from a missing snapshot before and after refresh", async (_case, saved, expected) => {
    const fixture = catalogFixture({ 1: saved }), author = authorFixture(fixture.catalog);
    try {
      author.runtime.mountDocument(author.page.window, record.id, "synthetic-reply-1");
      const api = author.page.window.ElecKoi;
      expect(await api.variables.getState({ messageId: "synthetic-reply-1" })).toEqual(expected);
      expect(fixture.catalog.getDetailsSnapshot().details.messages.find((message) => message.id === "synthetic-reply-1")).toMatchObject({ variableSnapshotAvailable: true, nativeVariableStateJson: saved });
      fixture.publishChanged();
      expect(await api.variables.getState({ messageId: "synthetic-reply-1" })).toEqual(expected);
      expect(author.latest).not.toHaveBeenCalled();
    } finally {
      await author.close();
    }
  });
});
