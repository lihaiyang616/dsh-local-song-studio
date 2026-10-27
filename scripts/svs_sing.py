#!/usr/bin/env python
"""DiffSinger (master / MIDI-B + PE) 无头合成：歌词 + 旋律 → 干声。

用法：
  python svs_sing.py --inp input.json
input.json:
  {
    "config": "usr/configs/midi/e2e/opencpop/ds100_adj_rel.yaml",
    "exp": "0228_opencpop_ds100_rel",
    "out": "out/svs.wav",
    "sample_rate": 24000,
    "segments": [
      {"text": "SP 深 海 里 的 鲸 鱼 SP", "notes": "rest|C4|D4|E4|G4|A4|G4|rest", "notes_duration": "0.3|0.4|0.4|0.4|0.4|0.4|0.4|0.3", "offset": 0.0}
    ]
  }
notes 用 "|" 分隔（与官方示例一致），也可用空格；notes_duration 同理。
"""
import argparse
import json
import os
import sys

os.environ.setdefault("TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD", "1")

ROOT = os.path.dirname(os.path.abspath(__file__))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--inp", required=True)
    ap.add_argument("--repo", default=os.environ.get("DS_REPO", os.path.dirname(ROOT)))
    a = ap.parse_args()
    p = json.load(open(a.inp, encoding="utf8"))
    repo = os.path.abspath(p.get("repo") or a.repo)
    os.chdir(repo)
    sys.path.insert(0, repo)
    sys.argv = [
        "svs_sing.py",
        "--config", p.get("config", "usr/configs/midi/e2e/opencpop/ds100_adj_rel.yaml"),
        "--exp_name", p.get("exp", "0228_opencpop_ds100_rel"),
    ]
    import numpy as np  # noqa: E402
    from inference.svs.ds_e2e import DiffSingerE2EInfer  # noqa: E402
    from utils.hparams import set_hparams, hparams  # noqa: E402
    from utils.audio import save_wav  # noqa: E402

    set_hparams(print_hparams=False)
    sr = int(p.get("sample_rate") or hparams["audio_sample_rate"])
    infer = DiffSingerE2EInfer(hparams)

    segments = p.get("segments") or []
    if not segments:
        raise SystemExit("segments 为空")
    pieces = []
    t = 0.0
    for seg in segments:
        inp = {
            "text": seg["text"],
            "notes": seg["notes"],
            "notes_duration": seg["notes_duration"],
            "input_type": "word",
        }
        wav = infer.infer_once(inp)  # 1 x T
        wav = np.asarray(wav).reshape(-1)
        off = float(seg.get("offset", t))
        start = int(round(off * sr))
        need = start + len(wav)
        while len(pieces) < need:
            pieces.append(0.0)
        buf = np.asarray(pieces, dtype=np.float32)
        buf[start:start + len(wav)] += wav.astype(np.float32)
        pieces = [float(x) for x in buf]
        t = off + len(wav) / sr

    audio = np.asarray(pieces, dtype=np.float32)
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak > 0.99:
        audio = audio * (0.99 / peak)
    out = p.get("out") or os.path.join(repo, "infer_out", "svs_out.wav")
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    save_wav(audio, out, sr)
    print(json.dumps({"ok": True, "audio": os.path.abspath(out), "sample_rate": sr,
                      "duration": round(len(audio) / sr, 2)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
