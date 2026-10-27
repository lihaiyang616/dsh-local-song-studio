# dsh-local-song-studio

**面向 DeepSeek Harness（DSH）的本地「翻唱 / 歌声合成 / 整曲生成」环境搭建套件 —— 全程不碰百度网盘、不需要任何账号登录。**

这个仓库只包含**原创胶水代码、安装脚本、一份关键补丁和实测记录**，不包含任何第三方源码、模型权重或音频。它解决一个很具体的问题：`dsh-cover-pipeline` 这类 DSH 插件的官方材料包（MSST 整合包 / DDSP 6.2 整合包 / 8 人音色包，共约 5 GB）只放在百度网盘，下载慢且必须登录。本仓库把其中**可以从公开源获得的部分全部换成脚本化安装**，并补上了 Windows 上最容易卡住的一刀（见下）。

## 能搭出什么

| 能力 | 组件 | 来源 | 许可 |
|---|---|---|---|
| 人声/伴奏分离 + 主唱/和声二次分离 | MSST (Music-Source-Separation-Training) + MelBandRoformer-kim + BS-Roformer-karaoke | GitHub / HuggingFace 镜像 | MIT / 模型各自许可 |
| 换声（保留 f0/节奏，只换音色） | DDSP-SVC **6.2** + ContentVec + PC-NSF-HiFiGAN + RMVPE | GitHub / HF 镜像 | MIT |
| 谱面歌声合成（SVS） | OpenVPI/DiffSinger + 公开中文声库检查点 | GitHub / HF 镜像 | Apache-2.0 |
| 整曲生成（文字→带唱的歌） | ACE-Step 1.5 | GitHub / HF 镜像 | MIT |

## 三个关键结论（实测后写的，不是猜的）

1. **翻唱链路可以完全不用网盘**：MSST 权重、DDSP 权重、ContentVec、HiFiGAN、RMVPE 在公开源上都能拿到，且 kim / karaoke 两个权重的 sha256 与官方材料清单**完全一致**（`87201f4d…` / `eb90ee24…`）。
2. **Windows 上 DDSP-SVC 6.2 的 fairseq 依赖必须绕开**：6.2 分支 `ddsp/vocoder.py` 顶部 `from fairseq import checkpoint_utils`，而 fairseq 在 Windows 上没有成品轮子、要 MSVC 自行编译。本仓库的补丁把它换成 transformers 加载 HF 格式的 ContentVec（`lengyue233/content-vec-best`），**换声实测通过**，不需要装 MSVC。见 [`docs/03-ddsp62-no-fairseq.md`](docs/03-ddsp62-no-fairseq.md)。
3. **8 GB 显存够跑**：MSST 分离 35 s 音频约 19–69 s；DDSP 换声 35 s 音频分 2 块约 54 s；整条 S1→S6 在 RTX 5060 Laptop 8 GB 上跑通，成品 −14.03 LUFS、五门技术验收 5/5 PASS。

## 快速开始

```bash
# 0) 约定：所有东西装在 $AI_ROOT（默认 ./AI-Song），Python 3.10 + torch 2.7.1+cu128
export AI_ROOT=/path/to/AI-Song
export PY310=/path/to/python310/python.exe        # 3.10.x
export TORCH_WHEEL=/path/to/torch-2.7.1+cu128-cp310-cp310-win_amd64.whl
export WHEELS_DIR=/path/to/wheels                 # 可选：其他本地 wheel 缓存

# 1) 翻唱链路（MSST + DDSP 6.2），不需要百度网盘
bash scripts/setup_msst.sh
bash scripts/setup_ddsp.sh
bash scripts/apply_ddsp62_patch.sh                # 关键：去掉 fairseq

# 2) 歌声合成（SVS，可选）
bash scripts/setup_diffsinger.sh

# 3) 整曲生成（可选，8 GB 显存档位见 docs）
bash scripts/setup_acestep.sh

# 4) 校验
python scripts/verify_layout.py --root "$AI_ROOT"
```

装完后把 `configs/cover.local.example.json` 拷成插件的 `cover.local.json`（改成本机路径），重启 DSH，`cover_doctor` 应当全绿。

## 实测记录（RTX 5060 Laptop 8 GB / Python 3.10.11 / torch 2.7.1+cu128）

| 阶段 | 输入 | 耗时 | 结果 |
|---|---|---|---|
| S1 MSST kim 分离 | 35.3 s 人声+伴奏 | 18.6–69 s | vocals / instrumental |
| S2 karaoke 二次分离 | 同上（vocals） | 20–35 s | 主唱 / 和声 |
| S4 DDSP 6.2 换声 | 35.3 s（自动 2 块） | 53.9 s | 44.1 kHz 干声 + provenance |
| S5 混音+母带 | 三轨 | 4.2 s | −14.03 LUFS |
| S6 五门验收 | master.wav | 1.5 s | **5/5 PASS**（−1.03 dBTP / crest 19.31 / LRA 48.82 / 相关 0.940） |
| ACE-Step 1.5 生成 | 中文歌词 + 风格提示，30 s | 37.5 s（另有 DiT 加载 14.1 s / LM 加载 22.4 s） | 48 kHz 立体声 30.0 s，BPM 实测 97（请求 96）；人声存在但歌词听清度一般，需人耳评判 |
| **插件全链路**（`plugin/dsh-song-studio`） | 中文流行 60 s → 生成 → 分离（含和声）→ Pallas 换声 → 母带 | 生成 43.7 s + 分离约 2 min + 换声约 1 min + 混音/验收约 7 s | **5/5 PASS**：−14.07 LUFS / −1.00 dBTP / crest 15.65 / LRA 7.25 / 相关 0.892 |
| **SVS 唱歌**（`song_sing` / `scripts/svs_sing.py`） | 「深海的鲸鱼 / 把心事说给夜色听」+ 自写旋律 | 7.5 s 干声 ≈ 2 s 采样（100 步） | 24 kHz 干声；ASR 转写对得上歌词；再接 DDSP 换成 Pallas 成功 |
| **`song_produce` 一条命令出歌** | 同一条词+旋律 + ACE-Step 生成的伴奏 | 全链路 **209 s** | SVS ✅ → DDSP ✅ → 伴奏 ✅ → 对齐 ✅ → 混音 ✅ → 验收 **5/5 PASS**（−14.31 LUFS / −1.00 dBTP / crest 15.79 / 相关 0.241） |

细节与命令见 [`docs/06-verified-pipeline.md`](docs/06-verified-pipeline.md)、[`docs/04-acestep-setup.md`](docs/04-acestep-setup.md)、[`docs/09-plugin-song-studio.md`](docs/09-plugin-song-studio.md)。

## 插件（`plugin/dsh-song-studio`）

把上面这套串成 7 个 DSH 工具，安装后就能用自然语言驱动：

```bash
dsh plugin --profile desktop add "$(pwd)/plugin/dsh-song-studio"
# 重启 DSH → song_status → song_plan → song_generate → song_separate → song_convert → song_mix → song_verify
```

| 工具 | 作用 |
|---|---|
| `song_status` | 体检全部组件与权重 |
| `song_plan` | 需求 → 结构/caption/歌词草稿/BPM（模板、确定性） |
| `song_generate` | ACE-Step 整曲生成（一个 seed 一个候选） |
| `song_separate` | MSST 分离，`karaoke=true` 出主唱/和声 |
| `song_convert` | DDSP-SVC 6.2 换声（pilot/full、移调、分块） |
| `song_mix` | 混音 + 母带（−14 LUFS） |
| `song_sing` | SVS 唱歌：歌词 + 音符（`C4`/`rest`）→ 24 kHz 干声（DiffSinger master/MIDI-B + PE） |
| `song_produce` | **一条命令出歌**：SVS 唱 → DDSP 换声 → ACE-Step 伴奏 → 三轨对齐 → 混音母带 → 五门验收 |
| `song_verify` | 五门技术验收 |

## 仓库结构

```
docs/       原理、各组件安装、补丁说明、实测、合规边界、插件说明
scripts/    安装/校验脚本（PowerShell-free，Git Bash 可跑）
patches/    ddsp-svc-6.2-contentvec-transformers.patch（唯一代码改动，MIT 上游）
configs/    cover.local / training.local / 音色 config 的脱敏示例
plugin/     dsh-song-studio（7 个 DSH 工具，零运行时 npm 依赖）
verified/   实测产生的报表与哈希清单（不含任何音频）
```

## 边界与免责

- **不含权重、不授权音色**：任何模型权重（MSST / DDSP / DiffSinger 声库 / ACE-Step / 目标音色）都不随仓库分发，脚本只负责从公开源下载到本机。音色使用权归你自行确认；用 AI 翻唱公开作品时，词曲著作权仍属权利人。
- **不承诺商业质量**：技术指标通过（LUFS/真峰值/crest/LRA/相关）不等于听感通过或商业可用。
- **未验证项**：DiffSinger 的公开声库与现行代码版本不兼容（`docs/05` 有完整诊断与三条后续路线）；其余链路（分离/换声/混音/验收/生成/插件）均已在上述硬件实测。
- **许可证**：本仓库原创部分 MIT（见 LICENSE）；引用的上游项目许可见 NOTICE.md。
