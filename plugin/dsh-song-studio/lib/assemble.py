#!/usr/bin/env python
"""把 SVS 干声 / ACE-Step 伴奏对齐成 mix.py 能吃的三轨（44.1 kHz、等长、双声道）。

用法：
  python assemble.py --lead lead.wav --inst inst.wav --out-dir work \
      [--harm auto|none|path] [--target-rate 44100]

输出 work/lead.wav / work/inst.wav / work/harm.wav，并打印 JSON。
--harm auto 表示生成一条等长的静音和声轨（SVS 独唱没有和声时用）。
"""
import argparse
import json
import os

import numpy as np
import soundfile as sf
from math import gcd
from scipy.signal import resample_poly


def read_any(path, target_rate):
    y, sr = sf.read(path, always_2d=True, dtype="float32")
    if sr != target_rate:
        d = gcd(int(sr), int(target_rate))
        y = resample_poly(y, target_rate // d, int(sr) // d, axis=0).astype("float32")
    return y, target_rate


def fit(y, n, ch=2):
    if y.shape[1] == 1 and ch == 2:
        y = np.repeat(y, 2, axis=1)
    elif y.shape[1] > ch:
        y = y[:, :ch]
    if len(y) >= n:
        return y[:n]
    pad = np.zeros((n - len(y), y.shape[1]), dtype="float32")
    return np.concatenate([y, pad], axis=0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lead", required=True)
    ap.add_argument("--inst", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--harm", default="auto")
    ap.add_argument("--target-rate", type=int, default=44100)
    a = ap.parse_args()
    os.makedirs(a.out_dir, exist_ok=True)
    rate = a.target_rate

    lead, _ = read_any(a.lead, rate)
    inst, _ = read_any(a.inst, rate)
    n = len(lead)
    if n <= 0:
        raise SystemExit("lead 为空")
    lead = fit(lead, n)
    inst = fit(inst, n)

    if a.harm in ("auto", "none", ""):
        harm = np.zeros((n, 2), dtype="float32")
    else:
        harm, _ = read_any(a.harm, rate)
        harm = fit(harm, n)

    paths = {
        "lead": os.path.join(a.out_dir, "lead.wav"),
        "inst": os.path.join(a.out_dir, "inst.wav"),
        "harm": os.path.join(a.out_dir, "harm.wav"),
    }
    sf.write(paths["lead"], lead, rate, subtype="FLOAT")
    sf.write(paths["inst"], inst, rate, subtype="FLOAT")
    sf.write(paths["harm"], harm, rate, subtype="FLOAT")
    print(json.dumps({
        "ok": True, "sample_rate": rate,
        "duration": round(n / rate, 3),
        "lead": paths["lead"], "inst": paths["inst"], "harm": paths["harm"],
        "harm_mode": a.harm,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
