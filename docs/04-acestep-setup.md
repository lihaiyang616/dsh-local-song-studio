# 04 · ACE-Step 1.5：本地「一句话出一首歌」

上游：https://github.com/ace-step/ACE-Step-1.5 （**MIT**，14k+ star，模型卡写明训练数据合规、可商用）
权重：https://huggingface.co/ACE-Step/Ace-Step1.5 （国内用 `HF_ENDPOINT=https://hf-mirror.com`）

## 它能做什么（对应 Suno 的能力）

- Text2Music：歌词 + 风格 → 整首带唱的歌（50+ 语言）
- Cover：参考音频定风格；Repaint：局部重绘某几句；Track Separation：出分轨
- Audio Understanding：从音频反推 BPM / 调性 / 拍号 / 描述
- 5Hz LM 做 planner：把一句话扩成歌曲蓝图（结构、歌词、captions）
- 支持 LoRA 风格微调（官方口径：8 首歌、3090 12GB 约 1 小时）

## 显存档位（官方 README 的表）

| 显存 | DiT | LM | 后端 | 说明 |
|---|---|---|---|---|
| ≤6 GB | 2B turbo | 关闭 | — | INT8 量化 + 全 CPU offload |
| **6–8 GB** | **2B turbo/sft** | **0.6B** | `pt` | **本项目目标档位** |
| 8–16 GB | 2B turbo/sft | 0.6B / 1.7B | `vllm` | Windows 上 vllm 麻烦，仍建议 `pt` |
| ≥12 GB（XL） | 4B xl-* | — | — | 4B DiT，质量更高，本项目不适用 |

## 安装（Windows，绕过 pytorch.org）

项目自带 `uv` 工程，`pyproject.toml` 里 torch 明确指向 `download.pytorch.org/whl/cu128`（国内常连不上）。本仓库脚本做三件事：

1. 从**南京大学镜像**（`mirrors.nju.edu.cn/pytorch/whl/cu128`，实测 ~10 MB/s）下载 cp312 的 `torch/torchvision/torchaudio==2.7.1+cu128`；
2. 先手动装进 `.venv`，再用 `uv sync --no-install-package torch --no-install-package torchvision --no-install-package torchaudio` 装其余依赖（只走 PyPI）；
3. `nano-vllm`（仓库内 vendored 的本地包）在 Windows 上可能编译失败，用 `--no-install-package nano-vllm` 跳过，后端选 `pt`。

```bash
export HF_ENDPOINT=https://hf-mirror.com
bash scripts/setup_acestep.sh
```

## 跑

```bash
cd "$ACE_DIR"
# 桌面 UI（浏览器打 127.0.0.1:7860）
.venv/Scripts/python.exe -m uv run acestep
# 或 REST API（127.0.0.1:8001），便于脚本化
.venv/Scripts/python.exe -m uv run acestep-api
# 或命令行
.venv/Scripts/python.exe cli.py --help
```

首次运行会从 HF 下载权重（turbo DiT 4.46 GB + VAE 0.31 GB + 5Hz LM ~1.2 GB + 文本嵌入 1.11 GB，合计约 7 GB）。

## 状态与注意

- **状态：本机安装脚本已就绪，推理结果待验证**（验证后会更新本节：实际档位、30 s 样带耗时、显存峰值）。
- 8 GB 卡跑 XL 4B 不行；本仓库只支持 2B turbo 档。
- 生成质量与提示词遵循度因语言/风格差异大；中文歌词建议在 prompt 里显式给结构（如 `[Verse]`/`[Chorus]`）。
- 商用：ACE-Step 模型卡声明 MIT 且"商业可用"，但生成内容里若复刻了受版权保护的旋律/风格，风险仍由使用者承担。
