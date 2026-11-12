import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = p => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const entry = read("lib/index.js");
const client = read("client.js");

test("delayed readiness from an old host does not mark the new host ready", async () => {
  const start = entry.indexOf("function watchWebTreeReady(");
  const end = entry.indexOf("function fsExists(", start);
  const watch = new Function(entry.slice(start, end) + "\nreturn watchWebTreeReady;")();
  const pending = () => {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    const ctx = { inject: (_keys, callback) => callback({
      get: name => name === "loader" ? { await: () => promise } : {},
    }) };
    return { ctx, resolve };
  };
  const old = pending(), next = pending();
  const oldState = watch(old.ctx), nextState = watch(next.ctx);
  assert.equal(oldState.ready, false);
  assert.equal(nextState.ready, false);
  old.resolve();
  await Promise.resolve();
  assert.equal(oldState.ready, true);
  assert.equal(nextState.ready, false);
  next.resolve();
  await Promise.resolve();
  assert.equal(nextState.ready, true);
  assert.equal(watch({}).ready, true);
});

test("status cache belongs to route lifetime and disposed async work cannot publish it", () => {
  const start = entry.indexOf("function installWebServer(");
  const end = entry.indexOf("function methodNotAllowed(", start);
  const route = entry.slice(start, end);
  assert.match(route, /host\.effect\(\(\) => \{\s*let lastStatusPayload = null;\s*let routesActive = true;/);
  assert.match(route, /ready: readiness\.ready && Boolean\(lastStatusPayload\)/);
  assert.match(route, /if \(!routesActive\) \{[\s\S]*?ready: false[\s\S]*?return;\s*\}\s*lastStatusPayload = payload/);
  assert.match(route, /routesActive = false;\s*lastStatusPayload = null;/);
});

test("host target metadata distinguishes listed, unlisted and unknown versions without blocking loading", () => {
  const start = entry.indexOf("function declaredHostTargets(");
  const end = entry.indexOf("function watchWebTreeReady(", start);
  const manifest = { dshTarget: "0.2.2-rc.1", dshTargets: ["0.2.2-rc.1", "0.2.1-rc.5", null, ""] };
  const api = new Function("fs", "path", "updater", entry.slice(start, end) + "\nreturn { declaredHostTargets, describeHostCompatibility };")(
    { readFileSync: () => JSON.stringify(manifest) }, { join: (...a) => a.join("/") }, { pluginRoot: () => "/plugin" });
  assert.deepEqual(api.declaredHostTargets(manifest), ["0.2.2-rc.1", "0.2.1-rc.5"]);
  assert.equal(api.describeHostCompatibility({ package: { name: "@deepseek-ai/dsh", version: "0.2.2-rc.1" } }).status, "declared");
  assert.equal(api.describeHostCompatibility({ package: { name: "@deepseek-ai/dsh-base", version: "0.3.0" } }).status, "not_listed");
  assert.equal(api.describeHostCompatibility({ package: { name: "@deepseek-ai/dsh-agent-instructions", version: "0.2.2-rc.1" } }).status, "unknown");
  assert.equal(api.describeHostCompatibility(null).status, "unknown");
  assert.equal(api.describeHostCompatibility({ package: { name: "@deepseek-ai/dsh", version: "0.2.2-rc.1" } }, []).status, "unknown");
  assert.match(client, /这不是不兼容结论/);
  assert.match(client, /前端运行构建/);
  assert.match(client, /diskBuild && diskBuild !== CLIENT_BUILD_ID/);
});
