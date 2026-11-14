#!/usr/bin/env node
/**
 * gguf-inspect.mjs — 不装任何依赖，直接读 GGUF 头，列出张量名/量化类型/形状/偏移。
 *
 * 用途：在做权重手术（scripts/abliterate.py）之前先确认
 *   1. 目标文件到底是不是 GGUF、版本多少；
 *   2. `blk.N.attn_output.weight` / `blk.N.ffn_down.weight` 在不在、是 Q4_K 还是 F16；
 *   3. 张量数据区的对齐（general.alignment），写回时要按同一对齐补 padding。
 *
 * 用法：
 *   node scripts/gguf-inspect.mjs "D:/deepseek/models/qwen2.5-3b-q4km.gguf"
 *   node scripts/gguf-inspect.mjs <file> --filter attn_output --json
 */
import fs from "node:fs";
import process from "node:process";

const VALUE_TYPE = {
  0: ["UINT8", 1], 1: ["INT8", 1], 2: ["UINT16", 2], 3: ["INT16", 2],
  4: ["UINT32", 4], 5: ["INT32", 4], 6: ["FLOAT32", 4], 7: ["BOOL", 1],
  8: ["STRING", 0], 9: ["ARRAY", 0], 10: ["UINT64", 8], 11: ["INT64", 8], 12: ["FLOAT64", 8],
};

/** ggml 张量类型（只列常见的，其余按编号显示）。 */
const GGML_TYPE = {
  0: "F32", 1: "F16", 2: "Q4_0", 3: "Q4_1", 6: "Q5_0", 7: "Q5_1", 8: "Q8_0", 9: "Q8_1",
  10: "Q2_K", 11: "Q3_K", 12: "Q4_K", 13: "Q5_K", 14: "Q6_K", 15: "Q8_K",
  16: "IQ2_XXS", 17: "IQ2_XS", 18: "IQ3_XXS", 19: "IQ1_S", 20: "IQ4_NL", 21: "IQ3_S",
  22: "IQ2_S", 23: "IQ4_XS", 24: "I8", 25: "I16", 26: "I32", 27: "I64", 28: "F64", 29: "IQ1_M",
  30: "BF16", 34: "TQ1_0", 35: "TQ2_0",
};

class Reader {
  constructor(buffer) {
    this.buf = buffer;
    this.pos = 0;
  }
  need(n) {
    if (this.pos + n > this.buf.length) throw new Error(`GGUF 越界：pos=${this.pos} need=${n} size=${this.buf.length}`);
  }
  u32() { this.need(4); const v = this.buf.readUInt32LE(this.pos); this.pos += 4; return v; }
  i32() { this.need(4); const v = this.buf.readInt32LE(this.pos); this.pos += 4; return v; }
  u64() { this.need(8); const v = Number(this.buf.readBigUInt64LE(this.pos)); this.pos += 8; return v; }
  f32() { this.need(4); const v = this.buf.readFloatLE(this.pos); this.pos += 4; return v; }
  f64() { this.need(8); const v = this.buf.readDoubleLE(this.pos); this.pos += 8; return v; }
  bool() { this.need(1); const v = this.buf.readUInt8(this.pos); this.pos += 1; return v !== 0; }
  str() {
    const len = this.u64();
    this.need(len);
    const v = this.buf.toString("utf8", this.pos, this.pos + len);
    this.pos += len;
    return v;
  }
  value(type) {
    switch (type) {
      case 0: this.need(1); { const v = this.buf.readUInt8(this.pos); this.pos += 1; return v; }
      case 1: this.need(1); { const v = this.buf.readInt8(this.pos); this.pos += 1; return v; }
      case 2: this.need(2); { const v = this.buf.readUInt16LE(this.pos); this.pos += 2; return v; }
      case 3: this.need(2); { const v = this.buf.readInt16LE(this.pos); this.pos += 2; return v; }
      case 4: return this.u32();
      case 5: return this.i32();
      case 6: return this.f32();
      case 7: return this.bool();
      case 8: return this.str();
      case 9: {
        const elem = this.u32();
        const count = this.u64();
        if (count > 1_000_000) return `[ARRAY ${count} × ${VALUE_TYPE[elem]?.[0] || elem} — 略]`;
        const out = [];
        for (let i = 0; i < count; i += 1) out.push(this.value(elem));
        return out;
      }
      case 10: return this.u64();
      case 11: { this.need(8); const v = Number(this.buf.readBigInt64LE(this.pos)); this.pos += 8; return v; }
      case 12: return this.f64();
      default: throw new Error(`未知 GGUF value type ${type}`);
    }
  }
}

/** 只读文件头。大模型 GGUF 动辄 5GB，`readFileSync` 在 >2GiB 上会直接抛错，所以按块读。 */
function readHead(filepath) {
  const size = fs.statSync(filepath).size;
  const fd = fs.openSync(filepath, "r");
  try {
    let want = Math.min(size, 4 * 1024 * 1024);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const buffer = Buffer.alloc(want);
      const read = fs.readSync(fd, buffer, 0, want, 0);
      const slice = buffer.subarray(0, read);
      try {
        const info = parseHead(slice);
        return { info, size };
      } catch (error) {
        if (want >= size) throw error;
        want = Math.min(size, want * 2);
      }
    }
    throw new Error("头部读取失败：张量表超出上一次块长，换官方 gguf 工具看");
  } finally {
    fs.closeSync(fd);
  }
}

function parseHead(buffer) {
  const reader = new Reader(buffer);
  const magic = buffer.toString("ascii", 0, 4);
  if (magic !== "GGUF") throw new Error(`不是 GGUF 文件（magic=${JSON.stringify(magic)}）`);
  reader.pos = 4;
  const version = reader.u32();
  const tensorCount = reader.u64();
  const kvCount = reader.u64();
  const metadata = {};
  for (let i = 0; i < kvCount; i += 1) {
    const key = reader.str();
    const type = reader.u32();
    metadata[key] = { type: VALUE_TYPE[type]?.[0] || String(type), value: reader.value(type) };
  }
  const alignment = Number(metadata["general.alignment"]?.value) || 32;
  const tensors = [];
  for (let i = 0; i < tensorCount; i += 1) {
    const name = reader.str();
    const nDims = reader.u32();
    const dims = [];
    for (let d = 0; d < nDims; d += 1) dims.push(reader.u64());
    const type = reader.u32();
    const offset = reader.u64();
    tensors.push({ name, dims, type: GGML_TYPE[type] || `T${type}`, typeId: type, offset });
  }
  return {
    version,
    tensorCount,
    kvCount,
    alignment,
    headersEnd: reader.pos,
    dataStart: Math.ceil(reader.pos / alignment) * alignment,
    metadata,
    tensors,
  };
}

export function inspectGguf(filepath) {
  const { info, size } = readHead(filepath);
  return { file: filepath, bytes: size, ...info };
}

function main() {
  const args = process.argv.slice(2);
  const file = args[0];
  if (!file) {
    console.error('用法: node scripts/gguf-inspect.mjs <model.gguf> [--filter attn_output] [--json]');
    process.exit(1);
  }
  const filterIndex = args.indexOf("--filter");
  const filter = filterIndex >= 0 ? args[filterIndex + 1] : "";
  const asJson = args.includes("--json");
  const info = inspectGguf(file);
  if (asJson) {
    console.log(JSON.stringify(info, null, 2));
    return;
  }
  console.log(`文件: ${info.file}`);
  console.log(`大小: ${(info.bytes / 2 ** 30).toFixed(2)} GiB · GGUF v${info.version} · 对齐 ${info.alignment}`);
  console.log(`张量: ${info.tensorCount} · KV: ${info.kvCount} · 数据区起点 ${info.dataStart}`);
  const arch = info.metadata["general.architecture"]?.value;
  const params = arch ? info.metadata[`${arch}.parameter_count`]?.value : undefined;
  if (arch) console.log(`架构: ${arch}${params ? ` · 参数 ${params}` : ""}`);
  const rows = filter ? info.tensors.filter((t) => t.name.includes(filter)) : info.tensors;
  console.log("");
  console.log("张量（截前 60 条）:");
  for (const tensor of rows.slice(0, 60)) {
    console.log(`  ${tensor.name.padEnd(46)} ${tensor.type.padEnd(7)} [${tensor.dims.join(", ")}]`);
  }
  if (rows.length > 60) console.log(`  … 其余 ${rows.length - 60} 条用 --json 看`);
  const byType = {};
  for (const tensor of info.tensors) byType[tensor.type] = (byType[tensor.type] || 0) + 1;
  console.log("");
  console.log(`量化分布: ${Object.entries(byType).map(([k, v]) => `${k}×${v}`).join("  ")}`);
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("gguf-inspect.mjs")) {
  try {
    main();
  } catch (error) {
    console.error("读取失败:", String(error && error.message ? error.message : error));
    process.exit(1);
  }
}
