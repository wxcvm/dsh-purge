import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_SETTINGS,
  decide,
  defenseSummary,
  loadDefenseState,
  noteOutcome,
  noteRecovered,
  saveDefenseState,
  scoreRefusalSignals,
} from "../lib/refusal-defense.js";

test("融合评分：正文分 + 任务风险，交付物形态反向压分", () => {
  const plain = scoreRefusalSignals({ textScore: 4, taskText: "写个脚本" });
  assert.equal(plain.score, 4);
  assert.ok(plain.reasons.includes("text-refusal"));

  const risky = scoreRefusalSignals({ textScore: 4, taskText: "打一下这个政务站" });
  assert.equal(risky.score, 5);
  assert.ok(risky.reasons.includes("task-risk"));

  const delivered = scoreRefusalSignals({ textScore: 4, taskText: "写个脚本", deliverable: true });
  assert.ok(delivered.score < 4, "出现交付物形态要压分");
  assert.ok(delivered.reasons.includes("deliverable-shape"));
});

test("融合评分：连续拒绝每轮 +2，思考分打七五折", () => {
  const a = scoreRefusalSignals({ textScore: 0, streak: 2 });
  assert.equal(a.score, 4);
  const b = scoreRefusalSignals({ thinkingScore: 4 });
  assert.equal(b.score, 3); // 4 * 0.75
});

test("decide：按分档给出动作，并写会话状态", () => {
  const state = loadDefenseState("");
  const cases = [
    { textScore: 0, level: "allow" },
    { textScore: 3, level: "anchor" },
    { textScore: 4, level: "nudge" },
    { textScore: 6, level: "kill" },
    { textScore: 8, level: "rewrite" },
  ];
  for (const c of cases) {
    const plan = decide({ sessionId: `s-${c.textScore}`, signals: { textScore: c.textScore, taskText: "x" }, state });
    assert.equal(plan.level, c.level, `textScore=${c.textScore} 应判到 ${c.level}`);
  }
  assert.equal(state.sessions["s-8"].keepTail, 0, "rewrite 档把 keepTail 压到 0");
  assert.equal(state.sessions["s-4"].keepTail, 1);
});

test("decide：掐断预算用尽后退回 nudge；连续三次拒直接 rewrite", () => {
  const state = loadDefenseState("");
  const settings = { ...DEFAULT_SETTINGS, maxKillsPerTurn: 1, rewriteStreak: 2 };
  const first = decide({ sessionId: "k1", signals: { textScore: 6 }, state, settings });
  assert.equal(first.level, "kill");
  const second = decide({ sessionId: "k1", signals: { textScore: 6 }, state, settings });
  assert.equal(second.level, "nudge", "预算用尽不再 kill");

  let plan = null;
  for (let i = 0; i < 3; i += 1) plan = decide({ sessionId: "k2", signals: { textScore: 3 }, state, settings });
  assert.equal(plan.level, "rewrite", "连续拒绝到 rewriteStreak → 直接改写历史");
  assert.equal(plan.keepTail, 0);
});

test("战绩：noteOutcome 累计、noteRecovered 记一次成功并清连续计数", () => {
  const state = loadDefenseState("");
  decide({ sessionId: "r1", signals: { textScore: 6 }, state });
  noteOutcome(state, { action: "kill", recovered: false });
  noteRecovered(state, "r1");
  assert.deepEqual(state.stats.kill, [2, 1], "一次显式失败 + 一次恢复成功");
  assert.equal(state.sessions.r1.streak, 0);
  assert.equal(state.sessions.r1.lastAction, "kill");
});

test("自适应：kill 成功率过低时下调 rewrite 阈值", () => {
  const state = loadDefenseState("");
  state.stats.kill = [10, 1]; // 成功率 10%
  const tuned = decide({ sessionId: "a1", signals: { textScore: 6 }, state, settings: { adaptive: true } });
  assert.equal(tuned.thresholds.rewriteAt, 6, "rewriteAt 从 8 下调到 6");
  const plan = decide({ sessionId: "a2", signals: { textScore: 6 }, state, settings: { adaptive: true } });
  assert.equal(plan.level, "rewrite", "6 分直接改写历史");
});

test("状态文件：写入后可读回，坏文件回落到空状态", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "defense-"));
  try {
    const state = loadDefenseState(dir);
    decide({ sessionId: "p1", signals: { textScore: 4 }, state });
    assert.equal(saveDefenseState(dir, state).ok, true);
    const back = loadDefenseState(dir);
    assert.equal(back.sessions.p1.level, "nudge");
    fs.writeFileSync(path.join(dir, "dsh-purge", "refusal-defense.json"), "{not json", "utf8");
    assert.deepEqual(loadDefenseState(dir).sessions, {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("summary：一行战绩，缺数据时显示 0/0", () => {
  const line = defenseSummary({ stats: { kill: [4, 2], nudge: [3, 3], rewrite: [0, 0] } });
  assert.match(line, /kill 2\/4（50%）/);
  assert.match(line, /nudge 3\/3（100%）/);
  assert.match(line, /rewrite 0\/0（0%）/);
});
