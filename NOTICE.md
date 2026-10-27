# NOTICE — 第三方组件与许可边界

本仓库**只包含原创脚本、文档与一份补丁**，不包含下列任何项目的源码副本、模型权重或音频。下列内容由脚本在运行时从各自上游下载，使用时请遵守各自许可。

| 组件 | 用途 | 上游 | 许可 |
|---|---|---|---|
| MSST（Music-Source-Separation-Training） | 分离引擎 | https://github.com/ZFTurbo/Music-Source-Separation-Training | MIT |
| MelBandRoformer（kim） | 人声/伴奏权重 | https://huggingface.co/KimberleyJSN/melbandroformer | 见模型页 |
| BS-Roformer karaoke（becruily） | 主唱/和声权重 | https://huggingface.co/becruily/bs-roformer-karaoke | 见模型页 |
| DDSP-SVC | 换声引擎 | https://github.com/yxlllc/DDSP-SVC | MIT（分支 6.2 / 6.3） |
| ContentVec（转换版） | 内容编码器 | https://huggingface.co/lengyue233/content-vec-best | MIT（仓库标注） |
| PC-NSF-HiFiGAN 44.1k 2025.02 | 声码器 | https://github.com/openvpi/vocoders | 见发布页（含非商业条款说明） |
| RMVPE | 音高提取 | https://github.com/yxlllc/RMVPE | 见上游 |
| DiffSinger（OpenVPI） | SVS 引擎 | https://github.com/OpenVPI/DiffSinger | Apache-2.0 |
| 公开声库检查点 | SVS 声库 | https://huggingface.co/PillowTa1k/DiffSinger | Apache-2.0（仓库标注） |
| ACE-Step 1.5 | 整曲生成 | https://github.com/ace-step/ACE-Step-1.5 | MIT |
| dsh-cover-pipeline（被接入的 DSH 插件） | 流水线编排 | https://github.com/InariNGT-Ofiicial/dsh-cover-pipeline | MIT |
| dsh-advanced-training（被接入的 DSH 插件） | 训练入口 | https://github.com/InariNGT-Ofiicial/dsh-advanced-training | UNLICENSED（仓库标注） |

## 明确不授予的权利

- 任何**模型权重**（包括但不仅限于分离权重、声码器、ContentVec、目标音色模型、DiffSinger 声库、ACE-Step 权重）的使用权都不由本仓库授予，也不随仓库分发。
- 任何**音色/角色/表演者**的授权：公开下载的社区音色模型不等于你有权商用或公开传播其生成的表演。
- 任何**词曲与录音**的著作权：用本仓库链路翻唱公开作品时，词曲权利仍属原作者与权利人。

## 关于本仓库里的补丁

`patches/ddsp-svc-6.2-contentvec-transformers.patch` 是对 **MIT 许可** 的 DDSP-SVC 6.2 分支 `ddsp/vocoder.py` 的修改，本身按 MIT 提供。它把 `fairseq` 加载方式替换为 transformers 加载 HF 格式 ContentVec；不改模型结构、不改推理参数。
