# 05 · SVS（DiffSinger）：按谱面唱 —— 已跑通

**结论先说**：公开声库（PillowTa1k/DiffSinger）是 **2023 年的 MIDI-B + PE 格式**，只能用 OpenVPI 仓库的
**`master` 分支**（= MoonInTheRiver 的最后一版：`modules/diffsinger_midi` + `modules/fastspeech/pe.py`）加载；
现行 `main`（v2/v3，2026）架构不同，会报 `Category is not specified` / `Missing/unexpected keys`。
本机已按 master 跑通：**歌词 + 音符 → 唱歌干声**，实测 82 秒示例一次合成成功、24 kHz。

## 它和 ACE-Step / DDSP 的分工

| | SVS（DiffSinger） | ACE-Step | DDSP-SVC |
|---|---|---|---|
| 输入 | 歌词 + **音符（音高/时值）** | 歌词 + 风格描述 | 一段已有的人声 |
| 输出 | 干声（只有唱，无伴奏） | 整首带唱的歌 | 换过音色的干声 |
| 旋律可控 | 逐音符 | 不可控 | 跟随源人声 |
| 不需要录音 | ✅ | ✅ | ❌ |

典型用法：`SVS 唱干声 → DDSP 换成目标音色 → 与 ACE-Step 的伴奏/母带链路合成`。

## 安装（一条命令）

```bash
export AI_ROOT=/path/to/AI-Song
export PY310=/path/to/python310/python.exe
export TORCH_WHEEL=/path/to/torch-2.7.1+cu128-cp310-cp310-win_amd64.whl
bash scripts/setup_svs_legacy.sh
```

脚本做的事：
1. 下载 **master 分支**源码到 `$AI_ROOT/svs/DiffSinger-master`；
2. 建独立 venv（py3.10 + torch cu128）；
3. 装**老依赖**：`numpy==1.23.5`、`scipy<1.16`、`scikit-image==0.19.3`、`librosa==0.9.2`、`pypinyin`、`jieba`、`g2pM`、`pycwt`、`einops`、`pyloudnorm`、`webrtcvad-wheels`、`lightning`…
   ⚠️ 装完必须把 numpy **强制回落 1.23.5**（有些包会把它顶到 2.x，scikit-image 0.19.3 / 老代码都会二进制崩）；
4. 打三个兼容补丁：
   - `scipy.signal.kaiser` → `scipy.signal.windows.kaiser`（`modules/parallel_wavegan/layers/pqmf.py`）
   - `scipy.ndimage.morphology.binary_dilation` → `scipy.ndimage.binary_dilation`（`data_gen/tts/data_gen_utils.py`）
   - `astype(np.int)` → `astype(int)`（`utils/pitch_utils.py`）
5. 下载公开声库三个目录到 `checkpoints/`：
   `0228_opencpop_ds100_rel`（中文声学，392 MB）+ `0109_hifigan_bigpopcs_hop128`（声码器，56 MB）+ `0102_xiaoma_pe`（音高提取器，13 MB）；
6. 跑一次内置示例自检。

运行时必须带两个环境变量（老代码 + 新 torch 的组合）：

```bash
TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1 PYTHONPATH=. \
  env/Scripts/python.exe -m inference.svs.ds_e2e \
  --config usr/configs/midi/e2e/opencpop/ds100_adj_rel.yaml \
  --exp_name 0228_opencpop_ds100_rel
# -> infer_out/example_out.wav（24 kHz）
```

## 用自己的歌词 + 旋律（关键用法）

`scripts/svs_sing.py` 接一个 JSON（`text` 里每个汉字一个音符，`SP`/`rest` 表示停顿）：

```json
{
  "config": "usr/configs/midi/e2e/opencpop/ds100_adj_rel.yaml",
  "exp": "0228_opencpop_ds100_rel",
  "out": "out/我的歌.wav",
  "segments": [
    {"text": "SP 深 海 里 的 鲸 鱼 SP",
     "notes": "rest|C4|D4|E4|G4|A4|G4|rest",
     "notes_duration": "0.3|0.4|0.4|0.4|0.5|0.5|0.6|0.3",
     "offset": 0.0}
  ]
}
```

```bash
cd "$AI_ROOT/svs/DiffSinger-master"
TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1 PYTHONPATH=. \
  env/Scripts/python.exe ../../projects/dsh-local-song-studio/scripts/svs_sing.py --inp 我的歌.json
```

- `notes` 用 `|` 或空格分隔，音名如 `C4`/`D#4`/`F4`，`rest` 是休止；
- 每个汉字对 **一个** 音符；`SP` 对应 `rest`；
- 多段用 `segments[]`，`offset` 是时间轴上的起点（秒）。

## 实测（RTX 5060 Laptop 8 GB，2026-10-27）

| 项 | 结果 |
|---|---|
| 模型加载 | 声学 + PE + HiFiGAN 全部加载成功 |
| 扩散步数 | 100 步（config 的 `K_step`），82 s 音频约 **7 s** 采样（GPU） |
| 输出 | 24 kHz 单声道 WAV |
| 示例 ASR | 转写出「今天别想太多 / 你是我的梦 / 像被放的风」——与内置输入的歌词对得上 |
| 自定义旋律 | 「深海的鲸鱼」6 个字按 C4-D4-E4-G4-A4-G4 唱出，3.4 s |

## 限制与注意

- 声库音色固定（opencpop 风格女声）；要目标音色就再接一层 **DDSP-SVC**（24 kHz 输出先重采样到 44.1 kHz）。
- 只支持该声库的中文音素表（`dictionaries/opencpop-extension.txt` 同源）；日文/英文要换声库。
- 旋律必须自己给（MIDI 音名+时值）；它不会自动编旋律，也不做伴奏/混音。
- 老依赖组合脆弱：不要随便升级 numpy/scipy/scikit-image；升级后按上面"兼容补丁"重打。
- 声库/音色的授权不随模型许可转移，公开发布前自行确认（`docs/07`）。
