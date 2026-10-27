#!/usr/bin/env bash
# DiffSinger（SVS）推理环境 + 公开中文声库检查点。
# 必需：PY310；可选：AI_ROOT / TORCH_WHEEL / HF_ENDPOINT / PIP_MIRROR
set -euo pipefail
: "${PY310:?请设置 PY310=Python3.10 解释器路径}"
AI_ROOT="${AI_ROOT:-$PWD/AI-Song}"
HF="${HF_ENDPOINT:-https://hf-mirror.com}"
PIP_MIRROR="${PIP_MIRROR:-https://mirrors.aliyun.com/pypi/simple}"
DS="$AI_ROOT/svs/DiffSinger"
mkdir -p "$DS"

echo "== 1/5 源码（OpenVPI/DiffSinger main）"
if [ ! -f "$DS/scripts/infer.py" ]; then
  tmp="$(mktemp -d)"
  curl -sL --retry 3 -o "$tmp/ds.tgz" "https://codeload.github.com/OpenVPI/DiffSinger/tar.gz/refs/heads/main"
  tar xzf "$tmp/ds.tgz" -C "$DS" --strip-components=1
  rm -rf "$tmp"
fi

echo "== 2/5 venv + torch"
if [ ! -x "$DS/env/Scripts/python.exe" ]; then "$PY310" -m venv "$DS/env"; fi
VPY="$DS/env/Scripts/python.exe"
"$VPY" -m pip install -q --upgrade pip
if [ -n "${TORCH_WHEEL:-}" ] && [ -f "$TORCH_WHEEL" ]; then
  "$VPY" -m pip install "$TORCH_WHEEL"
else
  "$VPY" -m pip install torch -i "$PIP_MIRROR"
fi

echo "== 3/5 requirements"
"$VPY" -m pip install -r "$DS/requirements.txt" -i "$PIP_MIRROR"

echo "== 4/5 公开声库检查点（Apache-2.0 标注的社区检查点）"
dl() { [ -s "$2" ] || curl -sL --retry 3 --max-time 1800 -o "$2" "$1"; }
HFB="$HF/PillowTa1k/DiffSinger/resolve/main"
mkdir -p "$DS/checkpoints/0228_opencpop_ds100_rel" "$DS/checkpoints/0109_hifigan_bigpopcs_hop128"
dl "$HFB/0228_opencpop_ds100_rel/model_ckpt_steps_160000.ckpt" "$DS/checkpoints/0228_opencpop_ds100_rel/model_ckpt_steps_160000.ckpt"
dl "$HFB/0228_opencpop_ds100_rel/config.yaml"                   "$DS/checkpoints/0228_opencpop_ds100_rel/config.yaml"
dl "$HFB/0109_hifigan_bigpopcs_hop128/model_ckpt_steps_1512000.ckpt" "$DS/checkpoints/0109_hifigan_bigpopcs_hop128/model_ckpt_steps_1512000.ckpt"
dl "$HFB/0109_hifigan_bigpopcs_hop128/config.yaml"                   "$DS/checkpoints/0109_hifigan_bigpopcs_hop128/config.yaml"

echo "== 5/5 自检（跑仓库自带的示例 .ds）"
"$VPY" -c "import torch;print('torch',torch.__version__,'cuda',torch.cuda.is_available())"
SAMPLE="$(ls "$DS"/samples/*.ds 2>/dev/null | head -1 || true)"
if [ -n "$SAMPLE" ]; then
  echo "示例谱面: $SAMPLE"
  echo "请运行: cd \"$DS\" && env/Scripts/python.exe scripts/infer.py acoustic \"$SAMPLE\" --exp 0228_opencpop_ds100_rel --out out --title demo"
fi
echo "DIFFSINGER DONE: $DS"
