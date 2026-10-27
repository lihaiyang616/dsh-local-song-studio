# 09 · dsh-song-studio 插件（已验证）

把本机验证过的四个引擎包成 7 个 DSH 工具：

```
song_plan → song_generate → song_separate → song_convert → song_mix → song_verify
```

安装（本机已装）：

```bash
dsh plugin --profile desktop add /path/to/repo/plugin/dsh-song-studio
# 重启 DSH 后先跑 song_status
```

## 工具与配置

| 工具 | 说明 |
|---|---|
| `song_status` | 体检：ACE python/权重、MSST/DDSP env、cover runtime 的 3 个适配器、目标音色、最近产物 |
| `song_plan` | 需求 → 结构标签 + 英文 caption + 歌词草稿 + BPM（模板、确定性） |
| `song_generate` | ACE-Step 生成（一个候选一次调用；`seed` 控制复现） |
| `song_separate` | MSST kim 分离；`karaoke=true` 再做主唱/和声 |
| `song_convert` | DDSP-SVC 6.2 换声（pilot/full、移调、自动分块） |
| `song_mix` | pedalboard 混音母带（−14 LUFS） |
| `song_sing` | SVS：歌词 + 音符（`C4`/`rest`）→ 24 kHz 干声（DiffSinger master/MIDI-B + PE），可再接 song_convert 换音色 |
| `song_produce` | 一条命令出歌：SVS 唱 → DDSP 换声 → ACE-Step 伴奏 → 三轨对齐 → 混音母带 → 五门验收 |
| `song_verify` | 五门技术验收 |

配置全部可留空，自动发现顺序：`AI_ROOT` → `E:/AI-Song` → `D:/AI-Song` → `C:/AudioWork`；
`coverRuntime` 默认 `$DSH_HOME/plugins/dsh-cover-pipeline/runtime`；`voiceModel` 扫描 `03_音色模型_*`。

## 端到端实测（2026-10-27，RTX 5060 Laptop 8 GB）

用插件工具本身跑完整链路，参数：中文流行 / 96 BPM / 60 s / Pallas 音色。

| 步骤 | 工具 | 耗时 | 结果 |
|---|---|---|---|
| 生成 | `song_generate` | 43.7 s（DiT 加载 9.8 s + LM 加载 18 s + 生成） | 60.0 s WAV |
| 分离 | `song_separate(karaoke=true)` | 约 1–2 min | vocals/instrumental + 主唱/和声 |
| 换声 | `song_convert(key=0, pilot)` | 约 1 min | `lead_pilot_k0.wav` |
| 混音 | `song_mix` | 约 5 s | master.wav |
| 验收 | `song_verify` | 约 2 s | **5/5 PASS**：−14.07 LUFS / −1.00 dBTP / crest 15.65 / LRA 7.25 / 相关 0.892 |

旁证：对母带做 ASR 试点，转写出的片段与歌词对得上（如“都唱成光”“深海的鲸，也在跟着唱”虽然字有错，但能对应），分轨统计人声有实质能量。

## 边界

- `song_plan` 是模板，不是歌词 AI；要更好的词可以用 ACE-Step 的 LM 或自己写。
- 8 GB 显存放不下 XL 4B DiT；生成与换声串行跑，别同时占用显存。
- 技术验收 ≠ 听感验收；审美判断必须由人做（`docs/07`）。


## song_produce：一条命令走完（实测 2026-10-27）

调用示例（7.45 s 中文两句 + ACE 生成伴奏）：

```json
song_produce({
  "score": [{"text": "SP 深 海 里 的 鲸 鱼 SP 把 心 事 说 给 夜 色 听 SP",
             "notes": "rest|C4|D4|E4|G4|A4|G4|rest|A4|G4|A4|C5|A4|G4|E4|G4|rest",
             "notesDuration": "0.3|0.4|0.4|0.4|0.5|0.5|0.6|0.25|0.4|0.4|0.45|0.7|0.4|0.4|0.45|0.5|0.4"}],
  "caption": "warm Chinese pop ballad instrumental, piano and soft strings, gentle beat, no vocals",
  "bpm": 96, "key": 0, "outDir": "…/produce-test-01"
})
```

实测：全链路 **209 s**（ACE 伴奏生成占大头），六步全绿，技术验收 **5/5 PASS**
（−14.31 LUFS / −1.00 dBTP / crest 15.79 / 立体声相关 0.241）。产物目录结构：

```
produce-test-01/
├── svs.wav              # SVS 干声（24 kHz）
├── svs-input.json       # 谱面参数（可复现）
├── conv/lead.wav        # DDSP 换声后主唱（44.1 kHz）
├── ace/*.wav            # ACE-Step 生成的伴奏（含 params.json）
├── work/{lead,inst,harm}.wav   # 对齐后的三轨（harm 为等长静音轨）
├── master.wav           # 母带
└── master.verify.json   # 五门验收原始数据
```
