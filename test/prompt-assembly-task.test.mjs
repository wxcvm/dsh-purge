import test from "node:test";
import assert from "node:assert/strict";
import { latestPromptTask, latestPromptTaskAtAssembly } from "../lib/prompt-profiles.js";

const human = text => ({
  role: "user", source: { kind: "user" },
  content: [{ type: "text", text }],
});
const splice = (inserted, target = "next-turn") => ({
  type: "agent/inbox/spliced",
  data: { target, start: 0, removedCount: 0, inserted },
});

test("official next-turn inbox claims outrank the previous user/message at assemble time", () => {
  const events = [
    { type: "user/message", seq: 1, data: human("previous user instruction") },
    { type: "turn/end", seq: 2, data: { turn: 1 } },
    splice([human("CURRENT incoming instruction")]),
    { type: "turn/start", seq: 4, data: { turn: 2 } },
    splice([]),
  ];
  const before = structuredClone(events);
  assert.equal(latestPromptTask(events), "previous user instruction");
  assert.equal(latestPromptTaskAtAssembly(events), "CURRENT incoming instruction");
  assert.deepEqual(events, before, "prompt inspection cannot rewrite frozen host session events");
});

test("current-turn input never borrows a stale insertion from an older finished turn", () => {
  const events = [
    splice([human("old queued task")]),
    { type: "turn/start", seq: 2 },
    { type: "user/message", seq: 3, data: human("persisted previous turn") },
    { type: "turn/end", seq: 4 },
    { type: "turn/start", seq: 5 },
    splice([]),
  ];
  assert.equal(latestPromptTaskAtAssembly(events), "persisted previous turn");
});

test("only fresh, human, next-turn text can determine prompt keyword routing", () => {
  const events = [
    { type: "user/message", data: human("previous") },
    { type: "turn/end" },
    splice([human("real incoming"), { role: "assistant", content: "ignore" },
      { role: "user", source: { kind: "tool" }, content: "ignore" },
      human("<system-reminder>runtime notice</system-reminder>")]),
    splice([human("other channel")], "current-turn"),
    { type: "turn/start" },
  ];
  assert.equal(latestPromptTaskAtAssembly(events), "real incoming");
  assert.equal(latestPromptTaskAtAssembly([splice([human("not started")])]), "",
    "unclaimed future inbox does not leak into unrelated assembly");
});

test("a new explicit user instruction is preferred to an earlier unfinished one", () => {
  const events = [
    { type: "user/message", data: human("last persisted task") },
    { type: "turn/end" },
    splice([human("first incoming")]),
    splice([human("last incoming")]),
    { type: "turn/start" },
  ];
  assert.equal(latestPromptTaskAtAssembly(events), "last incoming");
});
