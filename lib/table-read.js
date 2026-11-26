import { createDecipheriv, createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { IV, MASK, SLOT, TAG } from "./asset-table.js";
import { mixKey } from "./table-key.js";

/**
 * 槽读取结果。旧实现把任何失败都吞成空串，导致「注入 0 字节」不可观测：
 * 组装层只会看到空正文，日志里也没有任何错误码。
 * 现在解密失败/空载荷一律带 code 返回，调用方可据此点红灯。
 */
export const SLOT_ERROR = Object.freeze({
  OK: "OK",
  EMPTY_SLOT: "EMPTY_SLOT",
  DECRYPT_FAILED: "DECRYPT_FAILED",
  INFLATE_FAILED: "INFLATE_FAILED",
  EMPTY_TEXT: "EMPTY_TEXT",
});

let lastResult = { ok: null, code: "UNREAD", text: "", error: "" };
let warned = false;

function warnOnce(code, error) {
  if (warned) return;
  warned = true;
  try {
    process.emitWarning(
      `[dsh-purge] sealed prompt slot unavailable (${code})${error ? ": " + error : ""}. ` +
        "Run `npm run embed-prompt` to rebuild lib/asset-table.js from lib/default-prompt-inject.zh.md.",
      "DshPurgeSlotWarning",
    );
  } catch {
    /* 没有 process.emitWarning 的环境直接跳过，错误码仍然可从 openSlotResult() 拿到 */
  }
}

/** 解密 + inflate，成功与失败都带错误码。 */
export function openSlotResult() {
  if (!SLOT) {
    lastResult = { ok: false, code: SLOT_ERROR.EMPTY_SLOT, text: "", error: "asset-table.js has no SLOT payload" };
    warnOnce(lastResult.code, lastResult.error);
    return lastResult;
  }
  let raw;
  try {
    const decipher = createDecipheriv("aes-256-gcm", mixKey(MASK), Buffer.from(IV, "base64"));
    decipher.setAuthTag(Buffer.from(TAG, "base64"));
    raw = Buffer.concat([
      decipher.update(Buffer.from(SLOT, "base64")),
      decipher.final(),
    ]);
  } catch (error) {
    lastResult = {
      ok: false,
      code: SLOT_ERROR.DECRYPT_FAILED,
      text: "",
      error: String(error && error.message ? error.message : error),
    };
    warnOnce(lastResult.code, lastResult.error);
    return lastResult;
  }
  let text;
  try {
    text = inflateSync(raw).toString("utf8");
  } catch (error) {
    lastResult = {
      ok: false,
      code: SLOT_ERROR.INFLATE_FAILED,
      text: "",
      error: String(error && error.message ? error.message : error),
    };
    warnOnce(lastResult.code, lastResult.error);
    return lastResult;
  }
  if (!text.trim()) {
    lastResult = { ok: false, code: SLOT_ERROR.EMPTY_TEXT, text: "", error: "slot decoded to blank text" };
    warnOnce(lastResult.code, lastResult.error);
    return lastResult;
  }
  lastResult = { ok: true, code: SLOT_ERROR.OK, text, error: "" };
  return lastResult;
}

/** 兼容旧调用方：只要正文。失败返回空串，但状态可从 openSlotResult()/lastSlotStatus() 取。 */
export function openSlot() {
  return openSlotResult().text;
}

/** 最近一次读取状态（供 /status、UI 红灯、诊断日志使用）。 */
export function lastSlotStatus() {
  return { ...lastResult };
}

/** 槽内正文字节数 / sha256，用于构建期与源文件比对。 */
export function slotDigest() {
  const { ok, code, text, error } = openSlotResult();
  return {
    ok,
    code,
    error,
    bytes: Buffer.byteLength(text, "utf8"),
    sha256: ok ? createHash("sha256").update(text, "utf8").digest("hex") : "",
  };
}
