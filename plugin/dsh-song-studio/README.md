# dsh-song-studio

DSH 插件：把本机的 **ACE-Step 1.5（整曲生成）→ MSST（分离/分轨）→ DDSP-SVC 6.2（换声）→ mix/verify（母带 + 五门验收）**
串成 7 个工具。零运行时 npm 依赖，只用 `node:` 内置模块；配置在插件加载时解析。

## 工具

| 工具 | 作用 |
|---|---|
| `song_status` | 体检：ACE 引擎/权重、MSST/DDSP 环境、cover runtime 的 mix/verify、目标音色、ffmpeg、最近产物 |
| `song_plan` | 需求 → 结构标签 + 英文风格 caption + 歌词草稿 + BPM 建议（模板、确定性，不调模型） |
| `song_generate` | ACE-Step 生成整首带唱的歌（一个候选一次调用；建议换 seed 出 2–3 个） |
| `song_separate` | MSST 人声/伴奏分离（`karaoke=true` 再做主唱/和声二次分离） |
| `song_convert` | DDSP-SVC 6.2 换声（pilot/full、移调、分块） |
| `song_mix` | 混音 + 母带（−14 LUFS 归一） |
| `song_verify` | 五门技术验收（LUFS / 真峰值 / crest / LRA / 立体声相关） |
| `song_sing` | SVS 唱歌：歌词 + 音符（如 `C4`/`rest`）→ 24 kHz 干声（DiffSinger master/MIDI-B + PE） |
| `song_produce` | **一条命令出歌**：SVS 唱 → DDSP 换声 → ACE-Step 伴奏 → 对齐 → 混音 → 五门验收 |

## 安装

```bash
dsh plugin --profile desktop add <本目录绝对路径>
# 重启 DSH，然后 song_status 体检
```

前置组件见同仓库 `docs/02`（MSST + DDSP）与 `docs/04`（ACE-Step）。路径留空时自动发现：

- `aiRoot`：`E:/AI-Song` → `D:/AI-Song` → `C:/AudioWork`，或环境变量 `AI_ROOT`
- `aceDir`：`<aiRoot>/songgen/ace-step`；`acePy`：其 `.venv/Scripts/python.exe`
- `msstEnv` / `ddspEnv`：各自工程下的 `env/Scripts/python.exe`
- `coverRuntime`：`$DSH_HOME/plugins/dsh-cover-pipeline/runtime`
- `voiceModel`：扫描 `<aiRoot>/03_音色模型_*/<音色>_步数N/exp/reflow-test/model_*.pt`

## 典型流程

```
song_plan(theme="深海里的鲸鱼与夜晚的陪伴", style="流行", language="zh", duration=30)
song_generate(caption, lyrics, duration=30, bpm=96, language="zh", seed=1234)   # 换 seed 出候选
song_separate(inputFolder=<生成音频目录>, outDir=..., karaoke=false)
song_convert(src=<vocals.wav>, outDir=..., key=0, mode="pilot", duration=30)
song_mix(inst=<instrumental>, lead=<换声后>, harm=<optional>, out=...)
song_verify(wav=<master.wav>)
```

## 边界

- 技术指标通过 ≠ 听感通过；审美判断必须由人做。
- 生成/换声都不代表对音色、词曲、录音的授权；发布前自行确认（同仓库 `docs/07`）。
- 8 GB 显存档：ACE-Step 用 2B turbo + LM 0.6B + `pt` 后端 + CPU offload（见 `docs/04`）。
