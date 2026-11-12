import test from "node:test";
import assert from "node:assert/strict";
import { updateRequestHeaders, privateUpdateArchiveUrl } from "../lib/update.js";

const token = "test-only-token";
const api = "https://api.github.com/repos/wxcvm/dsh-purge";

test("private updater authenticates only repository API requests", () => {
  const headers = updateRequestHeaders(api + "/commits/master", { accept: "application/json" }, token);
  assert.equal(headers.authorization, "Bearer " + token);
  assert.equal(headers.accept, "application/json");
  for (const url of [
    "https://codeload.github.com/wxcvm/dsh-purge/legacy.zip",
    "https://raw.githubusercontent.com/wxcvm/dsh-purge/master/package.json",
    "https://cdn.jsdelivr.net/gh/wxcvm/dsh-purge@master/package.json",
    "https://api.github.com/repos/other/repo/commits/master",
    "https://api.github.com/repos/wxcvm/dsh-purge-other/commits/master",
    "https://api.github.com.example.org/repos/wxcvm/dsh-purge/commits/master",
    "http://api.github.com/repos/wxcvm/dsh-purge/commits/master",
  ]) {
    const redirected = updateRequestHeaders(url, { Authorization: "Bearer stale", ...headers }, token);
    assert.equal(Object.keys(redirected).some(key => key.toLowerCase() === "authorization"), false, url);
    assert.equal(redirected.accept, "application/json");
  }
});

test("private archive route contains immutable ref but no token; public mode unchanged", () => {
  const sha = "a".repeat(40);
  assert.equal(privateUpdateArchiveUrl(sha, token), api + "/zipball/" + sha);
  assert.equal(privateUpdateArchiveUrl("release/test", token), api + "/zipball/release%2Ftest");
  assert.equal(privateUpdateArchiveUrl(sha, ""), "");
  assert.equal(updateRequestHeaders(api + "/tags", {}, "").authorization, undefined);
});
