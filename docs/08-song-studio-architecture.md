# 08 · 把它们组合成「Suno 式」流水线（设计说明）

本仓库装的是零件。要得到接近 Suno 的产品化能力，还需要一层编排与判定。下面是设计，供二次开发参考。

## 能力对照

| Suno 能力 | 本地方案 | 现状 |
|---|---|---|
| 文字→整首带唱 | ACE-Step 1.5（`docs/04`） | 安装脚本就绪 |
| 歌词/结构控制 | prompt 里写 `[Verse]/[Chorus]`；或先用 DiffSinger 谱面精确控旋律（`docs/05`） | 可做 |
| Extend 续写 | ACE-Step 长曲能力 / 分段生成后拼接 | 可做 |
| Repaint 重唱某句 | ACE-Step Repaint & Edit | 可做 |
| Cover 换风格 | ACE-Step Cover Generation | 可做 |
| 分轨 | ACE-Step stems 或 MSST | 可做 |
| 换音色 | DDSP-SVC 6.2（`docs/02`） | **已实测** |
| 混音母带 | `dsh-cover-pipeline` 的 `runtime/mix.py`（−14 LUFS 等） | **已实测** |
| 技术验收 | 同上 `runtime/verify_mix.py`（五门） | **已实测** |
| 试听/版本管理 | 自建：项目目录 + 修订号 + A/B 候选矩阵 | 待做 |
| 「好不好听」 | **只能人来听**：模型能测量，不能审美 | 人工 |

## 建议的编排层（DSH 插件形态）

沿用 `dsh-cover-pipeline` 已有的工具约定（`cordis.patch.yml` + `tools.register` + 项目目录 + `revision`）：

```
song_plan       歌词/结构/风格/BPM/调性 → song 计划（可人工改）
song_generate   ACE-Step 生成候选（N 个 seed），落盘 + 记录 prompt/seed/cfg
song_repaint    对指定区间重生成（接 ACE-Step repaint）
song_extend     续写 / 拼接，校验接缝
song_stems      分轨（ACE-Step stems 或 MSST）
song_convert    用 DDSP-SVC 把主唱换成目标音色（复用 cover 链路）
song_mix        复用 mix_master.py（standard 配方，单次归一化）
song_verify     复用 verify_mix.py（五门）+ BPM/调性/歌词 CER 报告
song_deliver    WAV（可选 MP3），写交付清单与 provenance
```

## 判定层能自动做什么（以及不能）

能：
- 响度/真峰值/crest/LRA/立体声相关（已有实现）
- BPM、调性、拍号（ACE-Step audio understanding / MSST 环境里的 librosa）
- 歌词与音频的对齐程度：faster-whisper 转写后与原始歌词算 CER（需要词的文本对齐，中文要分词）
- 分轨能量占比、静音段、削波统计

不能：
- 判断"旋律好不好听""这个音色像不像角色"——这类判断必须人耳；不要用任何单一数值冒充听审。

## 迭代协议（经验值）

1. 一次出 **3 个候选**（不同 seed / 稍微不同的风格词），人耳选一个；
2. 只对不满意的那一段用 repaint，不要整首重抽；
3. 结构问题（段落太长/太短）先改 prompt 的结构标签，不要靠 repaint 硬修；
4. 每次改参数都记录 prompt/seed/cfg，形成可回溯的版本表；
5. 技术验收通过 ≠ 可发布，听审单独记录。

## 边界

- 8 GB 显存：ACE-Step 只能 2B turbo；DiffSinger 与 DDSP 串行跑，避免同时占用显存。
- 长曲（>3 分钟）按段生成再拼，拼接处要检查相位/电平/接缝。
- 音色与词曲授权见 `docs/07`。
