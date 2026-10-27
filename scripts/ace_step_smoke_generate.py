#!/usr/bin/env python
"""ACE-Step 1.5 headless 生成冒烟测试（8 GB 显存档：2B turbo + 5Hz LM 0.6B + CPU offload）。

用法：
  HF_ENDPOINT=https://hf-mirror.com .venv/Scripts/python.exe smoke_generate.py --duration 30

输出：out/smoke_*.wav（以及生成参数 json）。
"""
import argparse
import json
import os
import sys
import time

os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
for k in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"):
    os.environ.pop(k, None)

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)

DEFAULT_CAPTION = (
    "A clean, warm Chinese pop ballad with piano, soft strings and a gentle beat. "
    "A clear intimate female vocal sings softly in the verse and opens up in the chorus. "
    "Mellow, emotional, hopeful, radio-friendly production."
)
DEFAULT_LYRICS = (
    "[Intro]\n\n"
    "[Verse]\n深海里的鲸鱼游过我的窗\n把一天的疲惫轻轻放在一旁\n\n"
    "[Chorus]\n如果世界太吵 就听我唱\n把没说完的话 都唱成光\n"
)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", default=os.path.join(ROOT, "out"))
    ap.add_argument("--duration", type=int, default=30)
    ap.add_argument("--bpm", type=int, default=96)
    ap.add_argument("--keyscale", default="")
    ap.add_argument("--language", default="zh")
    ap.add_argument("--caption", default=DEFAULT_CAPTION)
    ap.add_argument("--lyrics", default=DEFAULT_LYRICS)
    ap.add_argument("--seed", type=int, default=1234)
    ap.add_argument("--steps", type=int, default=8)
    ap.add_argument("--no-lm", action="store_true", help="只用 DiT（不加载 LM）")
    ap.add_argument("--no-offload", action="store_true")
    args = ap.parse_args()
    os.makedirs(args.out_dir, exist_ok=True)

    from loguru import logger
    from acestep.handler import AceStepHandler
    from acestep.llm_inference import LLMHandler
    from acestep.inference import GenerationParams, GenerationConfig, generate_music

    t0 = time.time()
    dit = AceStepHandler()
    msg, ok = dit.initialize_service(
        project_root=ROOT,
        config_path="acestep-v15-turbo",
        device="auto",
        offload_to_cpu=not args.no_offload,
    )
    logger.info(f"DiT init {time.time() - t0:.1f}s ok={ok} — {msg}")
    if not ok:
        sys.exit(1)

    llm = None
    if not args.no_lm:
        t0 = time.time()
        llm = LLMHandler()
        msg, ok_lm = llm.initialize(
            checkpoint_dir=os.path.join(ROOT, "checkpoints"),
            lm_model_path="acestep-5Hz-lm-0.6B",
            backend="pt",
            device="auto",
            offload_to_cpu=not args.no_offload,
            dtype=None,
        )
        logger.info(f"LM init {time.time() - t0:.1f}s ok={ok_lm} — {msg}")
        if not ok_lm:
            llm = None

    params = GenerationParams(
        task_type="text2music",
        thinking=bool(llm),
        caption=args.caption,
        lyrics=args.lyrics,
        bpm=args.bpm,
        keyscale=args.keyscale,
        timesignature="4",
        vocal_language=args.language,
        duration=args.duration,
        inference_steps=args.steps,
        guidance_scale=1.0,
        seed=args.seed,
    )
    config = GenerationConfig(batch_size=1, audio_format="wav")

    t0 = time.time()
    result = generate_music(dit, llm, params=params, config=config, save_dir=args.out_dir)
    logger.info(f"generate {time.time() - t0:.1f}s success={result.success} — {result.status_message}")
    out = {}
    if result.success:
        for i, audio in enumerate(result.audios):
            out[f"audio_{i}"] = audio.get("path")
            print("AUDIO", audio.get("path"))
    else:
        print("FAILED", result.status_message)
    meta = os.path.join(args.out_dir, "smoke_params.json")
    with open(meta, "w", encoding="utf8") as f:
        json.dump({"caption": args.caption, "lyrics": args.lyrics, "bpm": args.bpm,
                   "language": args.language, "seed": args.seed, "steps": args.steps,
                   "duration": args.duration, "result": out}, f, ensure_ascii=False, indent=2)
    print("META", meta)
    return 0 if result.success else 1


if __name__ == "__main__":
    sys.exit(main())
