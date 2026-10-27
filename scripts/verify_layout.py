#!/usr/bin/env python
"""校验本地布局是否满足 dsh-cover-pipeline 的自动发现契约。

用法：
  python verify_layout.py [--root AI_SONG_ROOT] [--json out.json]

只做文件存在性 + 大小检查，不加载模型、不碰网络。
退出码：0 全部就绪 / 1 有缺失 / 2 参数错误。
"""
import argparse
import json
import sys
from pathlib import Path

# (标签, 相对路径, 最小字节数)
CORE = [
    ("MSST 引擎 inference.py", "01_人声分离_MSST-GUI/inference.py", 1),
    ("MSST python", "01_人声分离_MSST-GUI/env/Scripts/python.exe", 1),
    ("kim 权重", "01_人声分离_MSST-GUI/pretrain/MelBandRoformer_kim.ckpt", 900_000_000),
    ("kim config", "01_人声分离_MSST-GUI/configs/config_vocals_mel_band_roformer_kim.yaml", 100),
    ("karaoke 权重", "01_人声分离_MSST-GUI/pretrain/bs_roformer_karaoke_frazer_becruily.ckpt", 200_000_000),
    ("karaoke config", "01_人声分离_MSST-GUI/configs/config_karaoke_frazer_becruily.yaml", 100),
    ("DDSP batch_infer.py", "02_模型推理_DDSP-SVC-6.2/DDSP-barbara-6.2/batch_infer.py", 1),
    ("DDSP python", "02_模型推理_DDSP-SVC-6.2/DDSP-barbara-6.2/env/Scripts/python.exe", 1),
    ("ContentVec", "02_模型推理_DDSP-SVC-6.2/DDSP-barbara-6.2/pretrain/contentvec/checkpoint_best_legacy_500.pt", 300_000_000),
    ("HiFiGAN", "02_模型推理_DDSP-SVC-6.2/DDSP-barbara-6.2/pretrain/pc_nsf_hifigan_44.1k_hop512_128bin_2025.02/model.ckpt", 50_000_000),
    ("HiFiGAN config", "02_模型推理_DDSP-SVC-6.2/DDSP-barbara-6.2/pretrain/pc_nsf_hifigan_44.1k_hop512_128bin_2025.02/config.json", 100),
    ("RMVPE", "02_模型推理_DDSP-SVC-6.2/DDSP-barbara-6.2/pretrain/rmvpe/model.pt", 300_000_000),
]

OPTIONAL = [
    ("DiffSinger 引擎", "svs/DiffSinger/scripts/infer.py", 1),
    ("ACE-Step 源码", "songgen/ace-step/pyproject.toml", 1),
    ("混音工作目录", "cover_runs", 0),
]


def check(root: Path):
    rows = []
    for label, rel, min_bytes in CORE:
        p = root / rel
        ok = p.exists() and (p.is_dir() or p.stat().st_size >= min_bytes)
        rows.append({"label": label, "path": str(p), "required": True, "ok": ok,
                     "size": p.stat().st_size if p.exists() and p.is_file() else None})
    for label, rel, min_bytes in OPTIONAL:
        p = root / rel
        ok = p.exists()
        rows.append({"label": label, "path": str(p), "required": False, "ok": ok,
                     "size": p.stat().st_size if p.exists() and p.is_file() else None})
    # 音色：任意 03_*/<名字>/exp*/reflow*/model_*.pt
    voices = sorted(root.glob("03_*/*/exp*/reflow*/model_*.pt"))
    rows.append({"label": "音色权重（任意一个）", "path": str(voices[0]) if voices else "",
                 "required": True, "ok": bool(voices),
                 "size": voices[0].stat().st_size if voices else None})
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="AI-Song")
    ap.add_argument("--json", default="")
    args = ap.parse_args()
    root = Path(args.root).expanduser().resolve()
    rows = check(root)
    missing = [r for r in rows if r["required"] and not r["ok"]]
    for r in rows:
        mark = "OK  " if r["ok"] else ("MISS" if r["required"] else "opt-")
        print(f"[{mark}] {r['label']:<24} {r['path']}")
    print()
    if missing:
        print(f"缺失 {len(missing)} 项（见上）。核心依赖请按 docs/02 安装。")
        code = 1
    else:
        print("核心依赖齐全：可以跑 S1–S6。")
        code = 0
    if args.json:
        Path(args.json).write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf8")
    return code


if __name__ == "__main__":
    sys.exit(main())
