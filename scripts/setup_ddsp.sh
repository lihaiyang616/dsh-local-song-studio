#!/usr/bin/env bash
# DDSP-SVC 6.2 换声环境（含预训练件），不需要百度网盘。
# 必需：PY310；可选：AI_ROOT / TORCH_WHEEL / HF_ENDPOINT / PIP_MIRROR / PYTORCH_MIRROR
set -euo pipefail
: "${PY310:?请设置 PY310=Python3.10 解释器路径}"
AI_ROOT="${AI_ROOT:-$PWD/AI-Song}"
HF="${HF_ENDPOINT:-https://hf-mirror.com}"
PIP_MIRROR="${PIP_MIRROR:-https://mirrors.aliyun.com/pypi/simple}"
PT_MIRROR="${PYTORCH_MIRROR:-https://mirrors.nju.edu.cn/pytorch/whl/cu128}"
DDSP="$AI_ROOT/02_模型推理_DDSP-SVC-6.2/DDSP-barbara-6.2"
mkdir -p "$DDSP"

echo "== 1/6 源码：必须是 6.2 分支（默认分支 6.3 与 6.2 音色不兼容）"
if [ ! -f "$DDSP/batch_infer.py" ]; then
  tmp="$(mktemp -d)"
  curl -sL --retry 3 -o "$tmp/ddsp62.tgz" "https://codeload.github.com/yxlllc/DDSP-SVC/tar.gz/refs/heads/6.2"
  tar xzf "$tmp/ddsp62.tgz" -C "$DDSP" --strip-components=1
  rm -rf "$tmp"
fi

echo "== 2/6 venv + torch/torchaudio"
if [ ! -x "$DDSP/env/Scripts/python.exe" ]; then "$PY310" -m venv "$DDSP/env"; fi
VPY="$DDSP/env/Scripts/python.exe"
"$VPY" -m pip install -q --upgrade pip
if [ -n "${TORCH_WHEEL:-}" ] && [ -f "$TORCH_WHEEL" ]; then
  "$VPY" -m pip install "$TORCH_WHEEL"
else
  "$VPY" -m pip install torch -i "$PIP_MIRROR"
fi
# torchaudio 用与 torch 同版本的 cu128 轮子；没有就从镜像抓 cp310
"$VPY" -m pip install --no-deps \
  "$PT_MIRROR/torchaudio-2.7.1%2Bcu128-cp310-cp310-win_amd64.whl" || \
  "$VPY" -m pip install torchaudio -i "$PIP_MIRROR"

echo "== 3/6 依赖（剔除 fairseq：Windows 无 MSVC 编不了，用补丁绕开）"
grep -v -E '^\s*fairseq\s*$' "$DDSP/requirements.txt" > "$DDSP/requirements-nofairseq.txt"
"$VPY" -m pip install -r "$DDSP/requirements-nofairseq.txt" -i "$PIP_MIRROR"
"$VPY" -m pip install -i "$PIP_MIRROR" gin-config        # 6.2 的 unit2control.py 需要
"$VPY" -m pip install -i "$PIP_MIRROR" pedalboard pyloudnorm  # 混音/验收适配器也用得上

echo "== 4/6 预训练件"
dl() { [ -s "$2" ] || curl -sL --retry 3 --max-time 1800 -o "$2" "$1"; }
mkdir -p "$DDSP/pretrain/contentvec" "$DDSP/pretrain/rmvpe" \
         "$DDSP/pretrain/pc_nsf_hifigan_44.1k_hop512_128bin_2025.02"
# ContentVec：HF 转换版（键名 feature_extractor.*/encoder.*/final_proj.*），配合 patch 使用
dl "$HF/lengyue233/content-vec-best/resolve/main/pytorch_model.bin" \
   "$DDSP/pretrain/contentvec/checkpoint_best_legacy_500.pt"
# 声码器 + 配套 config.json（load_config 从 ckpt 同目录读 config.json）
dl "$HF/None1145/DDSP-SVC-Base/resolve/main/nsf_hifigan/model/vocoder.ckpt" \
   "$DDSP/pretrain/pc_nsf_hifigan_44.1k_hop512_128bin_2025.02/model.ckpt"
dl "$HF/None1145/DDSP-SVC-Base/resolve/main/nsf_hifigan/config.json" \
   "$DDSP/pretrain/pc_nsf_hifigan_44.1k_hop512_128bin_2025.02/config.json"
# RMVPE（代码里硬编码 pretrain/rmvpe/model.pt）
dl "$HF/None1145/DDSP-SVC-Base/resolve/main/rmvpe/model.pt" "$DDSP/pretrain/rmvpe/model.pt"

echo "== 5/6 应用 fairseq-free 补丁"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$HERE/apply_ddsp62_patch.sh" "$DDSP"

echo "== 6/6 自检"
"$VPY" -c "import torch;print('torch',torch.__version__,'cuda',torch.cuda.is_available())"
( cd "$DDSP" && "$VPY" -c "import sys;sys.path.insert(0,'.');import ddsp.vocoder as v;print('vocoder ok, finalproj=',hasattr(v,'HubertModelWithFinalProj'))" )
echo "DDSP DONE: $DDSP"
