"""ACE-Step 1.5 无头生成（由 dsh-song-studio 插件调用）。

用法：
  python ace_generate.py --params params.json
params.json:
  {
    "caption": "...", "lyrics": "...", "duration": 30, "bpm": 96,
    "keyscale": "", "language": "zh", "seed": 1234, "steps": 8,
    "out_dir": "E:/AI-Song/songgen/out"
  }
stdout 最后一行输出 JSON 结果：{"ok": true, "audio": "...", "params": "..."} 或 {"ok": false, "error": "..."}
"""
import argparse
import json
import os
import sys
import time
import traceback

for k in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"):
    os.environ.pop(k, None)
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--params", required=True)
    a = ap.parse_args()
    p = json.load(open(a.params, encoding="utf8"))
    root = p.get("ace_dir") or os.environ.get("ACE_DIR") or os.getcwd()
    out_dir = p.get("out_dir") or os.path.join(root, "out")
    os.makedirs(out_dir, exist_ok=True)
    sys.path.insert(0, root)
    result = {"ok": False}
    try:
        from acestep.handler import AceStepHandler
        from acestep.llm_inference import LLMHandler
        from acestep.inference import GenerationParams, GenerationConfig, generate_music

        t0 = time.time()
        dit = AceStepHandler()
        msg, ok = dit.initialize_service(
            project_root=root,
            config_path=p.get("dit_config", "acestep-v15-turbo"),
            device=p.get("device", "auto"),
            offload_to_cpu=bool(p.get("offload", True)),
        )
        if not ok:
            raise RuntimeError(f"DiT init failed: {msg}")
        dit_secs = round(time.time() - t0, 1)

        llm = None
        lm_secs = 0.0
        if not p.get("no_lm"):
            t0 = time.time()
            llm = LLMHandler()
            msg, ok_lm = llm.initialize(
                checkpoint_dir=os.path.join(root, "checkpoints"),
                lm_model_path=p.get("lm_config", "acestep-5Hz-lm-0.6B"),
                backend=p.get("lm_backend", "pt"),
                device=p.get("device", "auto"),
                offload_to_cpu=bool(p.get("offload", True)),
                dtype=None,
            )
            lm_secs = round(time.time() - t0, 1)
            if not ok_lm:
                llm = None

        params = GenerationParams(
            task_type="text2music",
            thinking=bool(llm),
            caption=p.get("caption", ""),
            lyrics=p.get("lyrics", ""),
            instrumental=bool(p.get("instrumental", False)),
            bpm=p.get("bpm") or None,
            keyscale=p.get("keyscale", ""),
            timesignature=str(p.get("timesignature", "4")),
            vocal_language=p.get("language", "zh"),
            duration=float(p.get("duration", 30)),
            inference_steps=int(p.get("steps", 8)),
            guidance_scale=float(p.get("guidance_scale", 1.0)),
            seed=int(p.get("seed", -1)),
        )
        cfg = GenerationConfig(batch_size=int(p.get("batch_size", 1)),
                               audio_format=p.get("audio_format", "wav"))
        t0 = time.time()
        res = generate_music(dit, llm, params=params, config=cfg, save_dir=out_dir)
        gen_secs = round(time.time() - t0, 1)
        if not res.success:
            raise RuntimeError(f"generate failed: {res.status_message}")
        audio = None
        for item in res.audios:
            audio = item.get("path") or audio
        meta = os.path.join(out_dir, f"generate_{int(time.time())}.params.json")
        with open(meta, "w", encoding="utf8") as f:
            json.dump({**p, "dit_seconds": dit_secs, "lm_seconds": lm_secs,
                       "generate_seconds": gen_secs}, f, ensure_ascii=False, indent=2)
        result = {"ok": True, "audio": audio, "params": meta,
                  "dit_seconds": dit_secs, "lm_seconds": lm_secs,
                  "generate_seconds": gen_secs}
    except Exception as e:
        result = {"ok": False, "error": str(e), "trace": traceback.format_exc()[-2000:]}
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
