import test from "node:test";
import assert from "node:assert/strict";

import { promptAssemblyMetrics } from "../lib/identity.js";

test("prompt metrics report UTF-8 bytes by stable section family without content", () => {
  const workspace = "No workspace instructions are currently active";
  const sections = [
    { name: "dsh-purge", text: "鸟" },
    { name: "dshpg-capabilities", text: "A" },
    { name: "dshpg-objective", text: "目标" },
    { name: "dshpg-redteam-role", text: "角色" },
    { name: "persona:prefix", text: "## 运行环境前提\n专用演练环境" },
    { name: "agent-instructions", text: workspace },
    { name: "dsh-purge:post", text: "private-prompt-secret" },
    { name: "third-party-private-secret", text: "host-value" },
    { name: "unresolved", text: () => "must not be evaluated" },
  ];

  const metrics = promptAssemblyMetrics(sections);
  assert.equal(metrics.sectionCount, sections.length);
  assert.equal(metrics.operatorBytes, Buffer.byteLength("鸟", "utf8"));
  assert.equal(metrics.capabilityBytes, Buffer.byteLength("A", "utf8"));
  assert.equal(metrics.objectiveBytes, Buffer.byteLength("目标", "utf8"));
  assert.equal(metrics.redteamRoleBytes, Buffer.byteLength("角色", "utf8"));
  assert.equal(metrics.redteamOpsBytes, Buffer.byteLength("## 运行环境前提\n专用演练环境", "utf8"));
  assert.equal(metrics.workspaceBaselineBytes, Buffer.byteLength(workspace, "utf8"));
  assert.equal(metrics.pluginOtherBytes, Buffer.byteLength("private-prompt-secret", "utf8"));
  assert.equal(metrics.hostOtherBytes, Buffer.byteLength("host-value", "utf8"));
  assert.equal(metrics.totalBytes, Object.entries(metrics)
    .filter(([key]) => key !== "sectionCount" && key !== "totalBytes")
    .reduce((sum, [, value]) => sum + value, 0));
  assert.equal(JSON.stringify(metrics).includes("private"), false);
  assert.equal(JSON.stringify(metrics).includes("host-value"), false);
});

test("prompt metrics handle absent and malformed section collections", () => {
  const empty = {
    sectionCount: 0,
    totalBytes: 0,
    operatorBytes: 0,
    capabilityBytes: 0,
    objectiveBytes: 0,
    redteamRoleBytes: 0,
    redteamOpsBytes: 0,
    workspaceBaselineBytes: 0,
    pluginOtherBytes: 0,
    hostOtherBytes: 0,
  };
  assert.deepEqual(promptAssemblyMetrics(undefined), empty);
  assert.deepEqual(promptAssemblyMetrics({ sections: [] }), empty);
  assert.deepEqual(promptAssemblyMetrics([null, "ignored", { name: "empty", text: 12 }]), {
    ...empty,
    sectionCount: 1,
  });
});
