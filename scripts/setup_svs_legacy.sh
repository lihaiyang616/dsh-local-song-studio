#!/usr/bin/env bash
# SVS：DiffSinger（OpenVPI master 分支 = MoonInTheRiver MIDI-B + PE）推理环境
#
# 为什么是 master 分支：公开声库（PillowTa1k/DiffSinger）是 2023 年的 MIDI-B 格式
#   检查点键：model.fs2.* / model.betas / pe.*，config 里 task_cls=DiffSingerMIDITask、
#   pe_enable/pe_ckpt/use_midi。只有 master 分支（modules/diffsinger_midi + modules/fastspeech/pe.py）
#   能原样加载；OpenVPI 现行 main（2026）是 v2/v3 架构，加载不了。
#
# 必需环境变量：PY310；可选：AI_ROOT / TORCH_WHEEL / PIP_MIRROR
set -uo pipefail
: "${PY310:?请设置 PY310=Python3.10 解释器路径}"
AI_ROOT="${AI_ROOT:-$PWD/AI-Song}"
HF="${HF_ENDPOINT:-https://hf-mirror.com}"
PIP_MIRROR="${PIP_MIRROR:-https://mirrors.aliyun.com/pypi/simple}"
SVS="$AI_ROOT/svs/DiffSinger-master"
ENV_PY="$AI_ROOT/svs/DiffSinger-master/env/Scripts/python.exe"
mkdir -p "$SVS" "$AI_ROOT/svs/out"

echo "== 1/6 源码（master 分支）"
if [ ! -f "$SVS/inference/svs/ds_e2e.py" ]; then
  tmp="$(mktemp -d)"
  curl -sL --retry 3 -o "$tmp/ds.tgz" "https://codeload.github.com/OpenVPI/DiffSinger/tar.gz/refs/heads/master"
  tar xzf "$tmp/ds.tgz" -C "$SVS" --strip-components=1
  rm -rf "$tmp"
fi

echo "== 2/6 venv + torch（cp310 cu128）"
if [ ! -x "$ENV_PY" ]; then "$PY310" -m venv "$SVS/env"; fi
"$ENV_PY" -m pip install -q --upgrade pip
if [ -n "${TORCH_WHEEL:-}" ] && [ -f "$TORCH_WHEEL" ]; then
  "$ENV_PY" -m pip install "$TORCH_WHEEL"
else
  "$ENV_PY" -m pip install torch -i "$PIP_MIRROR"
fi

echo "== 3/6 推理依赖（master 时代的老 API；numpy 必须 <1.24）"
"$ENV_PY" -m pip install -i "$PIP_MIRROR" \
  "numpy==1.23.5" "scipy<1.16" "scikit-image==0.19.3" librosa==0.9.2 soundfile \
  pypinyin==0.39.0 jieba g2pM pycwt einops pyloudnorm webrtcvad-wheels \
  PyYAML h5py tqdm tensorboard tensorboardX lightning >/dev/null 2>&1 || \
  "$ENV_PY" -m pip install -i "$PIP_MIRROR" "numpy==1.23.5" scipy "scikit-image==0.19.3" librosa soundfile pypinyin jieba g2pM pycwt einops pyloudnorm webrtcvad-wheels PyYAML h5py tqdm tensorboard tensorboardX lightning
# 有些包会把 numpy 顶到 2.x，这里强制回落（scikit-image 0.19.3 / 老代码都要求 <1.24）
"$ENV_PY" -m pip install -q --force-reinstall --no-deps "numpy==1.23.5"

echo "== 4/6 兼容补丁（老代码里的 scipy/numpy 已移除 API）"
[ -f "$SVS/modules/parallel_wavegan/layers/pqmf.py" ] && \
  sed -i 's/^from scipy.signal import kaiser$/from scipy.signal.windows import kaiser/' "$SVS/modules/parallel_wavegan/layers/pqmf.py"
[ -f "$SVS/data_gen/tts/data_gen_utils.py" ] && \
  sed -i 's/^from scipy.ndimage.morphology import binary_dilation$/from scipy.ndimage import binary_dilation/' "$SVS/data_gen/tts/data_gen_utils.py"
[ -f "$SVS/utils/pitch_utils.py" ] && \
  sed -i 's/astype(np\.int)/astype(int)/' "$SVS/utils/pitch_utils.py"

echo "== 5/6 公开声库（PillowTa1k/DiffSinger）"
dl() { [ -s "$2" ] || curl -sL --retry 3 --max-time 1800 -o "$2" "$1"; }
HFB="$HF/PillowTa1k/DiffSinger/resolve/main"
mkdir -p "$SVS/checkpoints/0228_opencpop_ds100_rel" "$SVS/checkpoints/0109_hifigan_bigpopcs_hop128" "$SVS/checkpoints/0102_xiaoma_pe"
dl "$HFB/0228_opencpop_ds100_rel/model_ckpt_steps_160000.ckpt" "$SVS/checkpoints/0228_opencpop_ds100_rel/model_ckpt_steps_160000.ckpt"
dl "$HFB/0228_opencpop_ds100_rel/config.yaml"                   "$SVS/checkpoints/0228_opencpop_ds100_rel/config.yaml"
dl "$HFB/0109_hifigan_bigpopcs_hop128/model_ckpt_steps_1512000.ckpt" "$SVS/checkpoints/0109_hifigan_bigpopcs_hop128/model_ckpt_steps_1512000.ckpt"
dl "$HFB/0109_hifigan_bigpopcs_hop128/config.yaml"                   "$SVS/checkpoints/0109_hifigan_bigpopcs_hop128/config.yaml"
dl "$HFB/0102_xiaoma_pe/model_ckpt_steps_60000.ckpt" "$SVS/checkpoints/0102_xiaoma_pe/model_ckpt_steps_60000.ckpt"
dl "$HFB/0102_xiaoma_pe/config.yaml"                 "$SVS/checkpoints/0102_xiaoma_pe/config.yaml"

echo "== 6/6 自检：用内置示例合成一次"
cd "$SVS"
TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1 PYTHONPATH=. "$ENV_PY" -m inference.svs.ds_e2e \
  --config usr/configs/midi/e2e/opencpop/ds100_adj_rel.yaml \
  --exp_name 0228_opencpop_ds100_rel 2>&1 | tail -3
ls -la infer_out 2>/dev/null
echo "SVS DONE: $SVS  （自定义歌词见 scripts/svs_sing.py）"
