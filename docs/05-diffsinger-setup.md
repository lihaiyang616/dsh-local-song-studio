# 05 · DiffSinger（SVS）：按谱面唱

上游：https://github.com/OpenVPI/DiffSinger （**Apache-2.0**，Python 3.10+，不需要 fairseq）
它和 DDSP-SVC 的关系：SVS 从**谱面**合成歌声；SVC 只换音色。两者可以串联（DiffSinger 唱 → DDSP 换音色）。

## 安装

```bash
export PY310=/path/to/python310/python.exe
export TORCH_WHEEL=/path/to/torch-2.7.1+cu128-cp310-cp310-win_amd64.whl
bash scripts/setup_diffsinger.sh
```

脚本做四件事：venv(py3.10) → 本地 torch cu128 → `pip install -r requirements.txt`（PyPI） → 下载公开声库检查点：

- `0228_opencpop_ds100_rel`（中文 OpenCpop 声学模型，392 MB）
- `0109_hifigan_bigpopcs_hop128`（NSF-HiFiGAN 声码器，56 MB）
- 来源：https://huggingface.co/PillowTa1k/DiffSinger （Apache-2.0 标注）

放置约定（`scripts/infer.py` 的 `--exp` 就是目录名）：

```
checkpoints/
├── 0228_opencpop_ds100_rel/{config.yaml, model_ckpt_steps_160000.ckpt}
└── 0109_hifigan_bigpopcs_hop128/{config.yaml, model_ckpt_steps_1512000.ckpt}
```

## DS 文件（谱面输入格式）

DiffSinger 的推理输入是 `.ds`（JSON）。仓库自带 8 个中文示例（`samples/*.ds`）。每个元素是一个片段：

```json
{
  "offset": 0.0,
  "text": "AP 试 着 SP 掬 一 把 星 辰",
  "ph_seq": "AP sh ir zh e SP j v y i b a",
  "ph_dur": "0.3947 0.209 0.2554 0.1509 0.5921 0.1045 0.1045 0.3019 0.0929 0.3019 0.0929 0.2438",
  "ph_num": "2 2 1 2 2 2 2 2 1 2 2 2",
  "note_seq": "rest D#3 C4 rest D#4 C4 A#3 C4 C4",
  "note_dur": "0.6 0.4 0.6 0.2 0.4 0.4 0.4 0.2 0.4",
  "note_slur": "0 0 0 0 0 0 0 0 0 0 0 0",
  "f0_seq": "…", "f0_timestep": "…", "spk": "…"
}
```

- `ph_seq` 是音素序列（中文用拼音风格音素，字典见仓库 `dictionaries/opencpop-extension.txt`）
- `ph_dur` 是每个音素时长（秒），与 `ph_seq` 一一对应
- `note_seq/note_dur` 是 MIDI 音名与时值，`AP`/`SP` 对应 `rest`
- 生产用谱面一般由 [OpenUTAU for DiffSinger](https://github.com/stakira/OpenUtau) 导出；也可以按上面格式自己生成（本仓库的路线是"我写 MIDI + 拼音 → 生成 .ds"）

## 推理

```bash
cd "$DS_DIR"
env/Scripts/python.exe scripts/infer.py acoustic "samples/00_我多想说再见啊.ds" \
  --exp 0228_opencpop_ds100_rel \
  --out out \
  --title demo
```

输出 `out/demo.wav`（44.1 kHz）。`--spk` 用于多说话人模型，单说话人可省略。

## 状态与注意（实测，2026-10-27）

- **引擎装好了，公开检查点对不上**。`PillowTa1k/DiffSinger` 的三个检查点都是**旧版 DiffSinger 格式**（`state_dict` 键为 `pe.mel_prenet.*`，config 里有 `pe_enable: true` / `pe_ckpt` / `use_midi: true`），而 OpenVPI 现行代码（2026 main）要求 v2 格式。实测依次撞上：
  ```
  KeyError: 'K_step_infer' → KeyError: 'dictionary' → KeyError: 'train_aux_decoder'
  → RuntimeError: Category is not specified in this checkpoint.
  ```
  补齐前三个键后仍因旧格式的 `state_dict` 命名无法加载。
- **进一步定位**：该检查点属于 **2023-03 的 pre-refactor（含 PE / MIDI-B）** 架构。把 OpenVPI 的代码回退到 pre-refactor 提交 `a0cd33d`（"Re-organize model structure and add migrating scripts" 的父提交）后即可对上这套 `model.*` + `pe.*` 键；本机已把这份代码放到 `$AI_ROOT/svs/DiffSinger-legacy-2023/`（未跑通，仅作为下一步的起点）。它需要独立的旧依赖环境（`numpy==1.19`、`librosa==0.8`、`pytorch-lightning==0.7.1`，且代码里有 `np.float` 这类已被 numpy 移除的别名），属于"再投半天到一天"的活。
- **三条可选后续路线**：
  1. 用 pre-refactor 代码（`a0cd33d`，已下好）+ 独立旧 env + `numpy<1.24` 补丁，把 0228/0102/0109 三个检查点跑起来（最接近"装完就能用"，但依赖最脏）；
  2. 换 **v2 格式声库**（OpenUtau for DiffSinger 的 `.onnx` 声库 + `dsdict.yaml`），用支持 ONNX 的推理器（官方 dsinfer 是 C++/vcpkg，Windows 需 MSVC；也有第三方 Python ONNX 推理项目）；
  3. 自己训练一个 v2 声库（需要数据与 GPU 时间，不是一次性操作）。
- 因此本仓库的 SVS 部分当前提供的是**引擎 + 安装脚本 + 版本兼容诊断 + 旧版代码起点**，不提供开箱即用的合成结果。
- 声库音色固定：想要目标音色，把 DiffSinger 的输出再送进 DDSP-SVC 换声（两套引擎都是 44.1 kHz，链路顺）。
- 声库/音色的授权不随模型许可转移，公开发布前自行确认。
- 和 `docs/04` 的 ACE-Step 相比：DiffSinger 的**旋律完全可控**（你有 MIDI），但没有编曲、没有和声、没有自动混音，那些仍要靠后续处理。

> 工程建议：如果目标是"设计一首歌并唱出来"，先用 **ACE-Step**（docs/04）出成品；需要"每个音符可控"时再投入 DiffSinger 声库适配成本。

