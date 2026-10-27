#!/usr/bin/env bash
# MSST 分离环境（kim + karaoke），不需要百度网盘。
# 必需环境变量：PY310（Python 3.10 解释器）；可选：AI_ROOT / TORCH_WHEEL / HF_ENDPOINT / PIP_MIRROR
set -euo pipefail
: "${PY310:?请设置 PY310=Python3.10 解释器路径}"
AI_ROOT="${AI_ROOT:-$PWD/AI-Song}"
HF="${HF_ENDPOINT:-https://hf-mirror.com}"
PIP_MIRROR="${PIP_MIRROR:-https://mirrors.aliyun.com/pypi/simple}"
MSST="$AI_ROOT/01_人声分离_MSST-GUI"
mkdir -p "$MSST/pretrain" "$MSST/configs"

echo "== 1/5 源码（MSST main）"
if [ ! -f "$MSST/inference.py" ]; then
  tmp="$(mktemp -d)"
  curl -sL --retry 3 -o "$tmp/msst.tgz" "https://codeload.github.com/ZFTurbo/Music-Source-Separation-Training/tar.gz/refs/heads/main"
  tar xzf "$tmp/msst.tgz" -C "$MSST" --strip-components=1
  rm -rf "$tmp"
fi

echo "== 2/5 venv + torch"
if [ ! -x "$MSST/env/Scripts/python.exe" ]; then "$PY310" -m venv "$MSST/env"; fi
VPY="$MSST/env/Scripts/python.exe"
"$VPY" -m pip install -q --upgrade pip
if [ -n "${TORCH_WHEEL:-}" ] && [ -f "$TORCH_WHEEL" ]; then
  "$VPY" -m pip install "$TORCH_WHEEL"
else
  echo "未提供 TORCH_WHEEL，尝试从 PyPI 安装 CPU 版 torch（CUDA 版请自备 cp310 cu128 轮子）"
  "$VPY" -m pip install torch -i "$PIP_MIRROR"
fi

echo "== 3/5 推理所需依赖（kim/karaoke 不需要完整 requirements.txt）"
"$VPY" -m pip install -i "$PIP_MIRROR" \
  "numpy==1.26.4" scipy soundfile librosa matplotlib tqdm PyYAML omegaconf \
  ml_collections einops rotary_embedding_torch beartype pedalboard pyloudnorm

echo "== 4/5 权重与配置"
dl() { [ -s "$2" ] || curl -sL --retry 3 --max-time 1800 -o "$2" "$1"; }
dl "$HF/KimberleyJSN/melbandroformer/resolve/main/MelBandRoformer.ckpt" \
   "$MSST/pretrain/MelBandRoformer_kim.ckpt"
dl "$HF/becruily/bs-roformer-karaoke/resolve/main/bs_roformer_karaoke_frazer_becruily.ckpt" \
   "$MSST/pretrain/bs_roformer_karaoke_frazer_becruily.ckpt"
dl "$HF/becruily/bs-roformer-karaoke/resolve/main/config_karaoke_frazer_becruily.yaml" \
   "$MSST/configs/config_karaoke_frazer_becruily.yaml"
if [ -f "$MSST/configs/KimberleyJensen/config_vocals_mel_band_roformer_kj.yaml" ]; then
  cp -n "$MSST/configs/KimberleyJensen/config_vocals_mel_band_roformer_kj.yaml" \
        "$MSST/configs/config_vocals_mel_band_roformer_kim.yaml"
fi

echo "== 5/5 自检"
"$VPY" -c "import torch;print('torch',torch.__version__,'cuda',torch.cuda.is_available())"
ls -la "$MSST/pretrain"
echo "MSST DONE: $MSST"
