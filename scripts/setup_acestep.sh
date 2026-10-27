#!/usr/bin/env bash
# ACE-Step 1.5 安装（Windows / 8 GB 显存档）。
# 关键：pyproject 把 torch 指向 download.pytorch.org（国内常不通），这里先用镜像把
# cp312 cu128 三件套装进 .venv，再让 uv sync 只装其余依赖。
# 可选环境变量：AI_ROOT / PY312 / PYTORCH_MIRROR / PIP_MIRROR / HF_ENDPOINT
set -uo pipefail
AI_ROOT="${AI_ROOT:-$PWD/AI-Song}"
HF="${HF_ENDPOINT:-https://hf-mirror.com}"
PT_MIRROR="${PYTORCH_MIRROR:-https://mirrors.nju.edu.cn/pytorch/whl/cu128}"   # 实测 ~10 MB/s
PIP_MIRROR="${PIP_MIRROR:-https://mirrors.aliyun.com/pypi/simple}"
PY312="${PY312:-python}"
ACE="$AI_ROOT/songgen/ace-step"
W="${AI_ROOT}/_wheels/cu128-cp312"
mkdir -p "$W" "$(dirname "$ACE")"

echo "== 1/5 源码（ace-step/ACE-Step-1.5 main）"
if [ ! -f "$ACE/pyproject.toml" ]; then
  tmp="$(mktemp -d)"
  curl -sL --retry 3 -o "$tmp/ace.tgz" "https://codeload.github.com/ace-step/ACE-Step-1.5/tar.gz/refs/heads/main"
  tar xzf "$tmp/ace.tgz" -C "$ACE" --strip-components=1
  rm -rf "$tmp"
fi

echo "== 2/5 cp312 cu128 轮子（torch/torchvision/torchaudio == 2.7.1+cu128）"
dl() { [ -s "$2" ] || curl -sL --retry 3 --max-time 3600 -o "$2" "$1"; }
dl "$PT_MIRROR/torch-2.7.1%2Bcu128-cp312-cp312-win_amd64.whl"      "$W/torch-2.7.1+cu128-cp312-cp312-win_amd64.whl"
dl "$PT_MIRROR/torchvision-0.22.1%2Bcu128-cp312-cp312-win_amd64.whl" "$W/torchvision-0.22.1+cu128-cp312-cp312-win_amd64.whl"
dl "$PT_MIRROR/torchaudio-2.7.1%2Bcu128-cp312-cp312-win_amd64.whl"  "$W/torchaudio-2.7.1+cu128-cp312-cp312-win_amd64.whl"
ls -la "$W"

echo "== 3/5 uv + .venv"
"$PY312" -m pip install -q --upgrade uv 2>/dev/null || true
cd "$ACE"
"$PY312" -m uv venv -p "$(command -v python)" .venv
"$PY312" -m uv pip install --python .venv/Scripts/python.exe \
  "$W/torch-2.7.1+cu128-cp312-cp312-win_amd64.whl" \
  "$W/torchvision-0.22.1+cu128-cp312-cp312-win_amd64.whl" \
  "$W/torchaudio-2.7.1+cu128-cp312-cp312-win_amd64.whl"

echo "== 4/5 uv sync（跳过 torch 三件套与 vendored nano-vllm；后端用 pt）"
export HF_ENDPOINT="$HF"
"$PY312" -m uv sync --python .venv/Scripts/python.exe \
  --index-url "$PIP_MIRROR" \
  --no-install-package torch --no-install-package torchvision --no-install-package torchaudio \
  --no-install-package nano-vllm 2>&1 | tail -20

echo "== 5/5 自检"
.venv/Scripts/python.exe -c "import torch;print('torch',torch.__version__,'cuda',torch.cuda.is_available())"
echo
echo "首次推理会从 \$HF_ENDPOINT 下载权重（约 7 GB）。启动方式："
echo "  cd \"$ACE\" && .venv/Scripts/python.exe -m uv run acestep        # Gradio 7860"
echo "  cd \"$ACE\" && .venv/Scripts/python.exe -m uv run acestep-api    # REST 8001"
echo "  cd \"$ACE\" && .venv/Scripts/python.exe cli.py --help            # 命令行"
echo "ACE STEP DONE: $ACE"
