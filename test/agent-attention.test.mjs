import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DDL, RedteamStore, dispatch } from "../lib/redteam/store-core.js";
import { parseAgentAttention } from "../lib/redteam/agent-attention.js";
import { createReservations, reservedUsage } from "../lib/redteam/agent-reservations.js";

function fixture(dbs) {
  return {
    databases: dbs,
    db(id) { return this.databases[id]; },
    recordAgentReport: RedteamStore.prototype.recordAgentReport,
    attentionQueue: RedteamStore.prototype.attentionQueue,
    acknowledgeAgentReport: RedteamStore.prototype.acknowledgeAgentReport,
    activeEngagementId() { return "a"; },
  };
}
const report = (run_id, status, session_id = "child", parent_session = "root", extra = {}) =>
  ({ run_id, status, session_id, parent_session, ...extra });

test("explicit final structured status is parsed without storing the full assistant reply", () => {
  const r = parseAgentAttention([{ type: "text", text: "Verbose private transcript...\nredteamReport: " +
    '{"status":"waiting","blocked_reason":"Need user answer",' +
    '"needs":[{"kind":"tool","detail":"Missing scanner package"},' +
    '{"kind":"credential","detail":"password=PRIVATE123"}]}' }]);
  assert.equal(r.status, "waiting");
  assert.equal(r.needs.length, 2);
  assert.equal(r.needs[1].detail.includes("PRIVATE123"), false);
  assert.equal(r.blocked_reason, "Need user answer");
  assert.equal(parseAgentAttention([{ type: "text", text: "I might be waiting" }]), null);
  assert.equal(parseAgentAttention("redteamReport: { status: ready }").status, "ready");
  assert.equal(parseAgentAttention("redteamReport: { status: invented }"), null);
});

test("attention is one per latest child and never resurrects older after ack", () => {
  const a = new DatabaseSync(":memory:"), b = new DatabaseSync(":memory:");
  const store = fixture({ a, b });
  try {
    a.exec(DDL); b.exec(DDL); a.exec(DDL);
    const first = store.recordAgentReport("a", report("run-1", "waiting", "child-1",
      "root-a", { blocked_reason: "needs key", needs: [{ kind: "config", detail: "configure provider" }] }));
    assert.equal(first.recorded, true);
    assert.deepEqual(store.recordAgentReport("a", report("run-1", "ready", "child-1", "root-a")), {
      id: first.id, recorded: false,
    }, "duplicate lifecycle event cannot insert twice");
    const second = store.recordAgentReport("a", report("run-2", "ready", "child-1", "root-a"));
    const third = store.recordAgentReport("a", report("run-3", "blocked", "child-2", "root-a"));
    store.recordAgentReport("b", report("run-4", "waiting", "child-3", "root-b"));
    const queue = store.attentionQueue("a");
    assert.equal(queue.total, 2);
    assert.equal(queue.awaiting_person, 1);
    assert.deepEqual(queue.items.map(row => row.id), [third.id, second.id]);
    assert.equal(store.attentionQueue("b").total, 1);
    assert.deepEqual(store.acknowledgeAgentReport("a", first.id), { report_id: first.id, acknowledged: false },
      "an older report cannot acknowledge a newer one");
    assert.deepEqual(store.acknowledgeAgentReport("a", second.id), { report_id: second.id, acknowledged: true });
    assert.equal(store.attentionQueue("a").total, 1);
    assert.equal(store.attentionQueue("a").items[0].id, third.id);
    assert.equal(store.acknowledgeAgentReport("a", second.id).acknowledged, false);
    assert.equal(store.attentionQueue("b").total, 1);
    assert.deepEqual(dispatch(store, { op: "attention", engagement: "a", limit: 1 }).items.map(x => x.id), [third.id]);
    assert.equal(dispatch(store, { op: "attentionAck", engagement: "a", report_id: third.id }).ack.acknowledged, true);
    assert.equal(store.attentionQueue("a").total, 0);
  } finally { a.close(); b.close(); }
});

test("attention rows survive reopening the same engagement database", t => {
  const dir = mkdtempSync(join(tmpdir(), "purge-attention-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, "target.db");
  const first = new DatabaseSync(dbPath);
  first.exec(DDL);
  let store = fixture({ a: first });
  const added = store.recordAgentReport("a", report("run-1", "waiting"));
  first.close();
  const reopened = new DatabaseSync(dbPath);
  try {
    reopened.exec(DDL);
    store = fixture({ a: reopened });
    assert.equal(store.attentionQueue("a").items[0].id, added.id);
    assert.equal(store.acknowledgeAgentReport("a", added.id).acknowledged, true);
    assert.equal(store.attentionQueue("a").total, 0);
  } finally { reopened.close(); }
});

test("waiting report never frees reserved or host-observed running slots", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(DDL);
    const store = fixture({ a: db });
    const book = createReservations();
    book.acquire("root", "root", "work", 1, "TASK");
    book.start({ runId: "run-1", parentSessionId: "root", id: "child" });
    const running = { running: 1, running_ids: ["child"] };
    const countBefore = reservedUsage(running, book.list("root"));
    store.recordAgentReport("a", report("run-1", "waiting"));
    const countAfter = reservedUsage(running, book.list("root"));
    assert.equal(countBefore, 1);
    assert.equal(countAfter, 1);
    assert.equal(store.attentionQueue("a").awaiting_person, 1);
    assert.deepEqual(book.matchRun({ runId: "run-1", parentSessionId: "root" }),
      { owner: "root", key: "TASK", childId: "child" });
    book.end({ runId: "run-1", parentSessionId: "root" });
    assert.equal(book.matchRun({ runId: "run-1", parentSessionId: "root" }), null);
  } finally { db.close(); }
});

test("unknown or stale report identifiers are never silently acknowledged", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(DDL);
    const store = fixture({ a: db });
    assert.equal(store.acknowledgeAgentReport("a", 99).acknowledged, false);
    for (const bad of [null, 0, -1, "not-a-number", 1.5]) {
      if (bad === null) continue;
      assert.throws(() => store.acknowledgeAgentReport("a", bad), /report_id/);
    }
    assert.deepEqual(store.attentionQueue("a", { limit: 1 }).items, []);
  } finally { db.close(); }
});

test("existing upstream agent_report table is untouched and does not collide with our view", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE agent_report (id INTEGER PRIMARY KEY, session_id TEXT, status TEXT, acknowledged_at TEXT)");
    db.exec("INSERT INTO agent_report(session_id,status) VALUES ('upstream-child','blocked')");
    db.exec(DDL);
    const store = fixture({ a: db });
    const row = store.recordAgentReport("a", report("r1", "ready"));
    assert.equal(store.attentionQueue("a").items[0].id, row.id);
    assert.equal(db.prepare("SELECT status FROM agent_report WHERE session_id = 'upstream-child'").get()?.status, "blocked");
    assert.notEqual(db.prepare("SELECT name FROM sqlite_master WHERE name = 'agent_attention'").get(), undefined);
  } finally { db.close(); }
});

test("needs are scrubbed at the database storage boundary too", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(DDL);
    const store = fixture({ a: db });
    store.recordAgentReport("a", report("r1", "waiting", "child", "root", {
      needs: [{ kind: "credential", detail: "api_key=SUPERSECRET" }],
    }));
    const stored = db.prepare("SELECT needs FROM agent_attention WHERE run_id = 'r1'").get().needs;
    assert.doesNotMatch(stored, /SUPERSECRET/);
    assert.deepEqual(store.attentionQueue("a").items[0].needs, [
      { kind: "credential", detail: "api_key=[REDACTED_SECRET]" },
    ]);
  } finally { db.close(); }
});
