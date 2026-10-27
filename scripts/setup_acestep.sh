#!/usr/bin/env bash
# ACE-Step 1.5 安装（Windows / 6–8 GB 显存档：2B turbo + 5Hz LM 0.6B + CPU offload）
#
# 关键点（实测）：
#  1) pyproject 把 torch 指向 download.pytorch.org（国内常不通）→ 先从镜像取 cp312 cu128 轮子手动装；
#  2) uv venv 建出来的 .venv 没有 pip → 后续一律用 `python -m uv pip install`；
#  3) 不要用 `uv sync`（会重解依赖图/写锁文件，实测又慢又容易卡）；
#  4) 依赖用 requirements.txt 过滤版（去掉 torch*/triton*/flash-attn/extra-index 行）；
#  5) 权重用仓库自带 model_downloader + HF 镜像。
set -uo pipefail
AI_ROOT="${AI_ROOT:-$PWD/AI-Song}"
HF="${HF_ENDPOINT:-https://hf-mirror.com}"
PT_MIRROR="${PYTORCH_MIRROR:-https://mirrors.nju.edu.cn/pytorch/whl/cu128}"
PIP_MIRROR="${PIP_MIRROR:-https://mirrors.aliyun.com/pypi/simple}"
PY312="${PY312:-python}"
UV="${UV:-python -m uv}"
ACE="$AI_ROOT/songgen/ace-step"
W="$AI_ROOT/_wheels/cu128-cp312"
mkdir -p "$W" "$(dirname "$ACE")"

echo "== 1/6 源码"
if [ ! -f "$ACE/pyproject.toml" ]; then
  tmp="$(mktemp -d)"
  curl -sL --retry 3 -o "$tmp/ace.tgz" "https://codeload.github.com/ace-step/ACE-Step-1.5/tar.gz/refs/heads/main"
  tar xzf "$tmp/ace.tgz" -C "$ACE" --strip-components=1
  rm -rf "$tmp"
fi

echo "== 2/6 cp312 cu128 轮子"
dl() { [ -s "$2" ] || curl -sL --retry 3 --max-time 3600 -o "$2" "$1"; }
dl "$PT_MIRROR/torch-2.7.1%2Bcu128-cp312-cp312-win_amd64.whl"        "$W/torch-2.7.1+cu128-cp312-cp312-win_amd64.whl"
dl "$PT_MIRROR/torchvision-0.22.1%2Bcu128-cp312-cp312-win_amd64.whl" "$W/torchvision-0.22.1+cu128-cp312-cp312-win_amd64.whl"
dl "$PT_MIRROR/torchaudio-2.7.1%2Bcu128-cp312-cp312-win_amd64.whl"   "$W/torchaudio-2.7.1+cu128-cp312-cp312-win_amd64.whl"
ls -la "$W"

echo "== 3/6 uv + venv（注意：uv venv 没有 pip）"
"$PY312" -m pip install -q --upgrade uv 2>/dev/null || true
cd "$ACE"
[ -x .venv/Scripts/python.exe ] || "$PY312" -m uv venv -p "$PY312" .venv

echo "== 4/6 torch trio（本地轮子）"
"$PY312" -m uv pip install --python .venv/Scripts/python.exe \
  "$W/torch-2.7.1+cu128-cp312-cp312-win_amd64.whl" \
  "$W/torchvision-0.22.1+cu128-cp312-cp312-win_amd64.whl" \
  "$W/torchaudio-2.7.1+cu128-cp312-cp312-win_amd64.whl"

echo "== 5/6 其余依赖（过滤版 requirements）"
grep -v -E '^\s*(--extra-index-url|torch==|torchvision==|torchaudio==|torch>=|torchaudio>=|torchvision;|triton-windows|triton|flash-attn|#)' \
  requirements.txt | grep -v -E '^\s*$' > requirements-win-nofix.txt
"$PY312" -m uv pip install --python .venv/Scripts/python.exe \
  -r requirements-win-nofix.txt --index-url "$PIP_MIRROR"

echo "== 6/6 权重（首次约 9 GB，走 HF 镜像）"
HF_ENDPOINT="$HF" .venv/Scripts/python.exe -c "
import sys; sys.path.insert(0, '.')
from acestep.model_downloader import download_main_model, download_submodel
print('MAIN', download_main_model(prefer_source='huggingface'))
print('LM  ', download_submodel('acestep-5Hz-lm-0.6B', prefer_source='huggingface'))
" || echo "权重下载失败，可稍后重跑本步"

.venv/Scripts/python.exe -c "import torch;print('torch',torch.__version__,'cuda',torch.cuda.is_available())"
echo
echo "启动：cd \"$ACE\" && .venv/Scripts/python.exe -m uv run acestep       # 7860"
echo "      cd \"$ACE\" && .venv/Scripts/python.exe -m uv run acestep-api   # 8001"
echo "无头：HF_ENDPOINT=$HF .venv/Scripts/python.exe smoke_generate.py --duration 30"
echo "ACE STEP DONE: $ACE"
