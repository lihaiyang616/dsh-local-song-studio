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

## 状态与注意

- **状态：安装脚本已就绪，本机端到端待验证**（验证后会补：加载耗时、显存峰值、单句合成耗时、与示例音频的听感/指标）。
- 声库音色固定：想要目标音色，把 DiffSinger 的输出再送进 DDSP-SVC 换声（两套引擎都是 44.1 kHz，链路顺）。
- 声库/音色的授权不随模型许可转移，公开发布前自行确认。
- 和 `docs/04` 的 ACE-Step 相比：DiffSinger 的**旋律完全可控**（你有 MIDI），但没有编曲、没有和声、没有自动混音，那些仍要靠后续处理。
