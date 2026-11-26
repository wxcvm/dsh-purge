import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");
const start = source.indexOf("function promptTargetObservation(");
const end = source.indexOf("function rememberPromptTarget(", start);
assert.ok(start >= 0 && end > start);
const observe = new Function(source.slice(start, end) + "\nreturn promptTargetObservation;")();

test("rc.5 prompt diagnostics use the latest per-step model and provider as a pair", () => {
  const old = { model: "draft-v1", provider: "writing-local" };
  assert.deepEqual(observe({ modelSelection: { model: "draft-v2", provider: "writing-remote" } }, old),
    { model: "draft-v2", provider: "writing-remote" });
  assert.strictEqual(observe({ modelSelection: { model: "draft-v2" } }, old), old);
  assert.strictEqual(observe({}, old), old);
  assert.match(source.slice(end), /rememberPromptTarget\(\{ home: dshHome, \.\.\.promptTargetObservation\(context, \{ model, provider \}\)/);
});
