#!/usr/bin/env python3
"""abliterate.py — 真的改 GGUF 里的权重：把「拒绝方向」从中段层的输出投影里正交化掉。

这不是提示词技巧，是权重手术。方向向量的来源有三档，越往后越准：

  1. `--direction heuristic`（默认）
     取中段层 `blk.N.attn_output.weight` 的**最大右奇异向量**。经验上 residual stream 里
     最主要的那根方向就藏在这里；它是启发式，不保证等于 activation 里测出来的 refusal direction。
  2. `--direction <file.npy`
     你自己用 activation 抽出来的方向（推荐做法：同题集的 harmful / harmless 各跑一遍，
     取残差流最后一层的均值差，归一化后存 .npy）。这一档才是论文里的做法。
  3. 未来：`--from-hf <path>`，直接从 HF 权重做，需要 torch。

数学上做的是「对每个目标层的输出投影做秩一减法」：

    W ← W − λ · r (rᵀ W)        r 单位向量，λ ∈ [0, 1]

λ=1 是完整抹掉该方向，0.6–0.8 一般能在「不拒」和「不胡」之间取平衡。

前置：
    pip install --user numpy gguf
    （Python 3.14 目前没有 torch wheel；这条路径故意不用 torch。）

用法：
    python scripts/abliterate.py --inspect "D:/deepseek/models/qwen2.5-3b-q4km.gguf"
    python scripts/abliterate.py --plan    "D:/deepseek/models/qwen2.5-3b-q4km.gguf" --layers 8-16 --lambdas 0.6,0.8,1.0
    python scripts/abliterate.py --run     "D:/deepseek/models/qwen2.5-3b-q4km.gguf" \
        --layers 8-16 --lambda 0.8 --out "D:/LMStudio/models/local/Qwen2.5-3B-ABL/Qwen2.5-3B-ABL-f16.gguf"

改完怎么验收：
    node scripts/refusal-score.mjs --base http://127.0.0.1:1234/v1 --model <新模型> --out abl.json
    对比改之前的 P_refuse / hardRate；normalHardRate 必须不动（正常题不能被改坏）。

注意：
  - Q4_K 反量化是有损的；输出 f16 体积约等于参数量 × 2B（3B ≈ 6GB，9B ≈ 18GB）。
  - 一次 `--run` 只处理一个 λ。三档就写三个文件，或者在 LM Studio 里换着加载。
  - 输出目录不要直接写进 LM Studio 的 models 根，先写隔离目录，验完再挪。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

TARGET_SUFFIXES = ("attn_output.weight", "ffn_down.weight")


def die(message: str, code: int = 1) -> None:
    print(f"[abliterate] {message}", file=sys.stderr)
    raise SystemExit(code)


def parse_layers(spec: str, total: int) -> list[int]:
    """'8-16' / '4,6,8' / 'all' → 层号列表（闭区间）。"""
    spec = spec.strip().lower()
    if spec in ("", "all"):
        return list(range(total))
    wanted: list[int] = []
    for chunk in spec.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        if "-" in chunk:
            left, right = chunk.split("-", 1)
            start, end = int(left), int(right)
            wanted.extend(range(start, end + 1))
        else:
            wanted.append(int(chunk))
    return sorted({index for index in wanted if 0 <= index < total})


def load_modules():
    try:
        import numpy as np  # noqa: F401
    except Exception:
        die("缺 numpy：pip install --user numpy", 2)
    try:
        import gguf  # noqa: F401
    except Exception:
        die("缺 gguf：pip install --user gguf", 2)
    import numpy
    import gguf
    return numpy, gguf


def tensor_rows(array):
    """把 GGUF 的张量整理成 PyTorch 的 (out, in) 语义。

    GGUF 的 ne0 = in_features（ggml 里 src0 的 ne0 就是矩阵乘的输入维），所以
    `reader.get_tensor()` 拿到的 2D 数组是 (in, out)；这里转置成 (out, in)，
    方向向量才有「输出侧」这一维可以减。
    """
    import numpy as np

    if array.ndim != 2:
        raise ValueError(f"只处理 2D 权重，拿到 {array.shape}")
    return np.asarray(array, dtype=np.float32).T


def direction_for(weight, mode: str, file_hint: str):
    """返回单位方向向量 r（长度 = out 维）。

    heuristic 档取 W 的**最大左奇异向量** u1：它是输出空间（residual stream）里权重投影
    最强的方向，也就是「这个层往残差里灌得最多的那根」。用幂迭代算，避免对
    ffn_down（2048×11008）做完整 SVD。
    """
    import numpy as np

    if mode != "heuristic":
        vec = np.load(file_hint).astype(np.float32).reshape(-1)
        if vec.shape[0] != weight.shape[0]:
            raise ValueError(f"方向长度 {vec.shape[0]} 与输出维 {weight.shape[0]} 不一致")
        norm = float(np.linalg.norm(vec))
        if norm == 0:
            raise ValueError("方向向量是零向量")
        return vec / norm

    rng = np.random.default_rng(0)
    vector = rng.standard_normal(weight.shape[0]).astype(np.float32)
    vector /= float(np.linalg.norm(vector)) or 1.0
    # W Wᵀ 的幂迭代：两次 matvec，等价于求最大左奇异向量
    for _ in range(32):
        projected = weight @ (weight.T @ vector)
        norm = float(np.linalg.norm(projected))
        if norm == 0.0:
            break
        vector = projected / norm
    return vector / (float(np.linalg.norm(vector)) or 1.0)


def ablate(weight, direction, lam: float):
    """W ← W − λ · r (rᵀ W)。r 是 out 维方向，作用在输出侧。"""
    # rᵀW → (in,)；outer(r, ·) → (out, in)
    projection = direction @ weight
    return weight - lam * (direction[:, None] * projection[None, :])


def inspect(path: Path) -> int:
    numpy, gguf = load_modules()
    reader = gguf.GGUFReader(str(path))
    arch = reader.get_field("general.architecture")
    print(f"文件: {path}")
    print(f"张量: {len(reader.tensors)}  架构: {arch.contents() if arch else '?'}")
    layers: dict[int, dict[str, tuple]] = {}
    for tensor in reader.tensors:
        name = tensor.name
        if not name.startswith("blk."):
            continue
        try:
            index = int(name.split(".")[1])
        except (IndexError, ValueError):
            continue
        for suffix in TARGET_SUFFIXES:
            if name.endswith(suffix):
                layers.setdefault(index, {})[suffix] = (tensor.tensor_type.name, tuple(tensor.shape))
    if not layers:
        die("没找到 attn_output / ffn_down 张量，确认这是 transformer 的 GGUF")
    print(f"可手术层: {min(layers)}–{max(layers)}（共 {len(layers)} 层）")
    for index in sorted(layers)[:6]:
        print(f"  blk.{index}: " + "  ".join(f"{k}={v[0]}{v[1]}" for k, v in layers[index].items()))
    if len(layers) > 6:
        print("  …")
    print("")
    print("下一步: --plan 看每层形状与 λ 组合，--run 真正写文件")
    return 0


def plan(path: Path, layers_spec: str, lambdas: list[float]) -> int:
    numpy, gguf = load_modules()
    reader = gguf.GGUFReader(str(path))
    names = [tensor.name for tensor in reader.tensors]
    layer_ids = sorted({int(name.split(".")[1]) for name in names if name.startswith("blk.") and name.split(".")[1].isdigit()})
    chosen = parse_layers(layers_spec, (max(layer_ids) + 1) if layer_ids else 0)
    print(f"候选层 {len(layer_ids)} 个，本次选中 {len(chosen)} 个: {chosen}")
    print(f"λ 档位: {lambdas}")
    print(f"预计输出 {len(lambdas)} 个文件，每个约 {path.stat().st_size * 2 / 2**30:.1f} GiB（f16）")
    for index in chosen[:4]:
        tensor = next((item for item in reader.tensors if item.name == f"blk.{index}.attn_output.weight"), None)
        if tensor is None:
            print(f"  blk.{index}: 没有 attn_output.weight，跳过")
            continue
        print(f"  blk.{index}.attn_output.weight  {tensor.tensor_type.name} {tuple(tensor.shape)}")
    return 0


def _py(value):
    """numpy 标量/数组 → 普通 python 类型，GGUFWriter 只吃原生类型。"""
    import numpy as np

    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return float(value)
    if isinstance(value, np.ndarray):
        return [_py(item) for item in value.tolist()]
    if isinstance(value, (list, tuple)):
        return [_py(item) for item in value]
    return value


def run(path: Path, layers_spec: str, lam: float, out_path: Path, direction_mode: str, direction_file: str, copy_kv: bool) -> int:
    numpy, gguf = load_modules()

    reader = gguf.GGUFReader(str(path))
    names = [tensor.name for tensor in reader.tensors]
    layer_ids = sorted({int(name.split(".")[1]) for name in names if name.startswith("blk.") and name.split(".")[1].isdigit()})
    total_layers = (max(layer_ids) + 1) if layer_ids else 0
    chosen = set(parse_layers(layers_spec, total_layers))
    if not chosen:
        die("没有选中任何层")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    # 架构名必须从 KV 里读：GGUFReader 没有 .architecture 属性，猜成 "llama" 会让
    # llama.cpp 用错 arch，加载直接失败或输出全乱。
    arch_field = reader.fields.get("general.architecture")
    arch = str(arch_field.contents()) if arch_field is not None else "llama"
    if arch == "llama" and arch_field is None:
        print("  ! 没读到 general.architecture，按 llama 写；如果加载异常请检查这个字段")
    writer = gguf.GGUFWriter(str(out_path), arch=arch)
    print(f"  架构: {arch}")

    if copy_kv:
        from gguf import GGUFValueType  # noqa: F401  (vtype 来源)

        for key in reader.fields:
            # GGUFWriter 的构造函数已经写过 general.architecture，重复写会告警并覆盖
            if key.startswith("GGUF.") or key == "general.architecture":
                continue
            try:
                field = reader.fields[key]
                vtype = field.types[0]
                sub_type = field.types[1] if len(field.types) > 1 else None
                writer.add_key_value(key, _py(field.contents()), vtype, sub_type)
            except Exception as error:  # KV 复制失败不该挡住张量
                print(f"  ! 跳过 KV {key}: {error}")

    from gguf.quants import dequantize

    changed = 0
    copied = 0
    for tensor in reader.tensors:
        name = tensor.name
        layer_index = int(name.split(".")[1]) if name.startswith("blk.") and name.split(".")[1].isdigit() else -1
        is_target = (
            layer_index >= 0
            and layer_index in chosen
            and name.endswith(TARGET_SUFFIXES)
            and len(tensor.shape) == 2
        )
        if is_target:
            try:
                weight = tensor_rows(dequantize(tensor.data, tensor.tensor_type))  # (out, in)
                direction = direction_for(weight, direction_mode, direction_file)
                patched = ablate(weight, direction, lam)
                writer.add_tensor(name, patched.T.astype(numpy.float16))           # 写回 (in, out)
                changed += 1
                print(f"  ✓ {name}  λ={lam}  ||W||→{float(numpy.linalg.norm(patched)):.3f}")
            except Exception as error:
                die(f"张量 {name} 手术失败（不要留下半成品文件）: {error}")
        else:
            # 未改的张量按原始量化字节直写：不反量化 → 不损失精度、文件也不会翻倍。
            # 量化张量的 tensor.data 形状是 (rows, bytes_per_row)，raw_dtype 下 add_tensor
            # 会自己按块数反推逻辑形状，所以**不要** reshape，也不要传 raw_shape。
            from gguf.quants import GGML_QUANT_SIZES

            if tensor.tensor_type in GGML_QUANT_SIZES:
                writer.add_tensor(name, numpy.ascontiguousarray(tensor.data), raw_dtype=tensor.tensor_type)
            else:
                writer.add_tensor(name, numpy.ascontiguousarray(tensor.data))
            copied += 1

    writer.write_header_to_file()
    writer.write_kv_data_to_file()
    writer.write_tensors_to_file()
    writer.close()
    size_gib = out_path.stat().st_size / 2**30
    print(f"\n完成: {out_path}  ({size_gib:.2f} GiB, 改了 {changed} 个张量)")
    print("验收: node scripts/refusal-score.mjs --base <LM Studio base> --model <新模型> --out abl.json")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="GGUF 权重手术：拒绝方向正交化")
    parser.add_argument("model", help="输入 GGUF 路径")
    parser.add_argument("--inspect", action="store_true", help="只看结构，不改任何东西")
    parser.add_argument("--plan", action="store_true", help="看将要处理的层与体积")
    parser.add_argument("--run", action="store_true", help="真正写文件")
    parser.add_argument("--layers", default="", help="层区间，如 8-16 或 4,6,8；默认全部")
    parser.add_argument("--lambda", dest="lam", type=float, default=0.8, help="正交化强度 0–1，默认 0.8")
    parser.add_argument("--lambdas", default="0.6,0.8,1.0", help="--plan 里展示的档位")
    parser.add_argument("--out", default="", help="--run 的输出路径")
    parser.add_argument("--direction", default="heuristic", help="heuristic 或 .npy 文件路径")
    parser.add_argument("--no-kv", action="store_true", help="不复制 metadata KV（不推荐）")
    args = parser.parse_args()

    path = Path(args.model)
    if not path.exists():
        die(f"找不到 {path}")

    if args.inspect:
        return inspect(path)

    direction_mode = "heuristic" if args.direction == "heuristic" else "file"
    direction_file = "" if args.direction == "heuristic" else args.direction
    if direction_mode == "file" and not Path(direction_file).exists():
        die(f"方向文件不存在: {direction_file}")

    numbers = [float(item) for item in args.lambdas.split(",") if item.strip()]
    if args.plan:
        return plan(path, args.layers, numbers)

    if args.run:
        if not args.out:
            die("--run 需要 --out")
        if not (0.0 <= args.lam <= 1.0):
            die("--lambda 必须在 0–1")
        return run(path, args.layers, args.lam, Path(args.out), direction_mode, direction_file, not args.no_kv)

    parser.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
