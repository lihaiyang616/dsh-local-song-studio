#!/usr/bin/env bash
# 应用「DDSP-SVC 6.2 → 去掉 fairseq」补丁。
# 用法：bash apply_ddsp62_patch.sh [DDSP_DIR]（默认 $AI_ROOT/02_模型推理_DDSP-SVC-6.2/DDSP-barbara-6.2）
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH_FILE="$HERE/../patches/ddsp-svc-6.2-contentvec-transformers.patch"
TARGET="${1:-${AI_ROOT:-$PWD/AI-Song}/02_模型推理_DDSP-SVC-6.2/DDSP-barbara-6.2}"
[ -d "$TARGET" ] || { echo "找不到 DDSP 目录: $TARGET" >&2; exit 1; }
[ -f "$PATCH_FILE" ] || { echo "找不到补丁: $PATCH_FILE" >&2; exit 1; }

cd "$TARGET"
if grep -q "HubertModelWithFinalProj" ddsp/vocoder.py 2>/dev/null; then
  echo "补丁已应用，跳过"
  exit 0
fi
patch -p1 --forward < "$PATCH_FILE"
echo "补丁应用完成：$(grep -c 'HubertModelWithFinalProj' ddsp/vocoder.py) 处引用"
