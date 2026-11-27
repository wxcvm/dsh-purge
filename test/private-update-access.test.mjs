import test from "node:test";
import assert from "node:assert/strict";
import { updateRequestHeaders, privateUpdateArchiveUrl, readPrivateRemoteHead, readPrivateRemotePackageVersion, resolveUpdateRedirect } from "../lib/update.js";

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

const failing = (status) => async () => { throw Object.assign(new Error("sensitive-response"), { status }); };

test("private version discovery distinguishes absent beta from authorization and network failures", async () => {
  const sha = "a".repeat(40);
  assert.equal(await readPrivateRemoteHead("master", { request: async url => {
    assert.equal(url, api + "/commits/master");
    return { sha };
  }}), sha);
  assert.equal(await readPrivateRemoteHead("beta", { allowMissing: true, request: failing(404) }), "");
  await assert.rejects(readPrivateRemoteHead("master", { request: failing(404) }), /404/);
  for (const status of [401, 403, 429, 503]) {
    await assert.rejects(readPrivateRemoteHead("beta", { allowMissing: true, request: failing(status) }), error => {
      assert.match(error.message, new RegExp(String(status)));
      assert.doesNotMatch(error.message, /sensitive-response/);
      return true;
    });
  }
  await assert.rejects(readPrivateRemoteHead("beta", { allowMissing: true, request: async () => { throw new Error("socket timeout"); } }), /网络不可用/);
  await assert.rejects(readPrivateRemoteHead("master", { request: async () => ({ sha: "not-a-sha" }) }), /远端响应无效/);
});

test("private package version must be known before declaring the updater current", async () => {
  const sha = "b".repeat(40);
  const version = "1.1.92-wxcvm.7-beta.3";
  assert.equal(await readPrivateRemotePackageVersion(sha, async (url, timeout, headers) => {
    assert.equal(url, api + "/contents/package.json?ref=" + sha);
    assert.equal(headers.accept, "application/vnd.github.raw+json");
    return { version };
  }), version);
  assert.equal(await readPrivateRemotePackageVersion(sha, async () => ({
    encoding: "base64", content: Buffer.from(JSON.stringify({ version })).toString("base64"),
  })), version);
  await assert.rejects(readPrivateRemotePackageVersion(sha, async () => ({})), /版本号/);
  await assert.rejects(readPrivateRemotePackageVersion(sha, failing(403)), /403/);
});

test("archive redirects accept GitHub signed HTTPS URLs without forwarding authorization", () => {
  const source = api + "/zipball/" + "a".repeat(40);
  const signed = "https://codeload.github.com/wxcvm/dsh-purge/legacy.zip/abc?token=temporary";
  assert.equal(resolveUpdateRedirect(source, signed), signed);
  assert.equal(updateRequestHeaders(signed, { Authorization: "Bearer " + token }, token).authorization, undefined);
  for (const target of [
    "http://codeload.github.com/wxcvm/dsh-purge/legacy.zip",
    "https://example.com/?token=secret",
    "https://user:secret@codeload.github.com/wxcvm/dsh-purge/legacy.zip",
    "https://codeload.github.com:8443/wxcvm/dsh-purge/legacy.zip",
    "https://[invalid/?token=secret",
  ]) {
    assert.throws(() => resolveUpdateRedirect(source, target), error => {
      assert.match(error.message, /redirect/);
      assert.doesNotMatch(error.message, /secret/);
      return true;
    });
  }
  assert.equal(updateRequestHeaders("https://user:secret@api.github.com/repos/wxcvm/dsh-purge/commits/master", {}, token).authorization, undefined);
});
