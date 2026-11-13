import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("workspace source and stylesheet generate the exact embedded client shell", () => {
  const client = read("client.js");
  const source = read("lib/workspace/client-shell.js");
  const css = read("lib/workspace/workspace.css");
  const begin = "/* __DSH_PURGE_WORKSPACE_BEGIN__ */";
  const end = "/* __DSH_PURGE_WORKSPACE_END__ */";
  const placeholder = 'const PURGE_WORKSPACE_CSS = "__DSH_PURGE_WORKSPACE_CSS__";';
  assert.equal(source.split(placeholder).length, 2);
  assert.equal(client.split(begin).length, 2);
  assert.equal(client.split(end).length, 2);
  const expected = source.replace(placeholder, "const PURGE_WORKSPACE_CSS = " + JSON.stringify(css) + ";")
    .split("\n").map((line) => line ? "\t\t" + line : line).join("\n");
  const actual = client.slice(client.indexOf(begin) + begin.length + 1, client.indexOf(end));
  assert.equal(actual, expected);
  assert.ok(!actual.includes("__DSH_PURGE_WORKSPACE_CSS__"));
});
