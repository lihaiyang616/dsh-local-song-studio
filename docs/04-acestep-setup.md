# 04 · ACE-Step 1.5：本地「一句话出一首歌」

上游：https://github.com/ace-step/ACE-Step-1.5 （**MIT**，14k+ star）
权重：https://huggingface.co/ACE-Step/Ace-Step1.5 （国内用 `HF_ENDPOINT=https://hf-mirror.com`）

## 它能做什么（对应 Suno 的能力）

- Text2Music：歌词 + 风格 → 整首带唱的歌（50+ 语言）
- Cover：参考音频定风格；Repaint：局部重绘；Track Separation：出分轨
- Audio Understanding：从音频反推 BPM / 调性 / 拍号 / 描述
- 5Hz LM 做 planner；支持 LoRA 风格微调

## 显存档位（官方 README）

| 显存 | DiT | LM | 后端 | 说明 |
|---|---|---|---|---|
| ≤6 GB | 2B turbo | 关闭 | — | INT8 量化 + 全 CPU offload |
| **6–8 GB** | **2B turbo/sft** | **0.6B** | `pt` | **本项目实测档位**（8 GB 卡自动判为 tier3） |
| 8–16 GB | 2B turbo/sft | 0.6B / 1.7B | `vllm` | Windows 上 vllm 麻烦，仍用 `pt` |
| ≥12 GB（XL） | 4B xl-* | — | — | 4B DiT，不适用于 8 GB |

## Windows 上实际装法（实测能走通的顺序）

`pyproject.toml` 把 torch 指向 `download.pytorch.org/whl/cu128`（国内常连不上），`uv sync` 还会去解整个依赖图并重写锁文件，实测又慢又容易卡。**改走 uv pip + 本地轮子**：

```bash
export AI_ROOT=/path/to/AI-Song
export HF_ENDPOINT=https://hf-mirror.com
export PYTORCH_MIRROR=https://mirrors.nju.edu.cn/pytorch/whl/cu128   # 实测 3–10 MB/s
export PIP_MIRROR=https://mirrors.aliyun.com/pypi/simple
bash scripts/setup_acestep.sh
```

脚本等价于：

1. `codeload.github.com/ace-step/ACE-Step-1.5/tar.gz/refs/heads/main` 拿源码；
2. 从 NJU 镜像下 cp312 的 `torch/torchvision/torchaudio==2.7.1+cu128`；
3. `python -m uv venv -p <python312> .venv`，再 `uv pip install <3 个本地轮子>`；
   ⚠️ **`uv venv` 建出来的 .venv 里没有 pip**，所以不要 `python -m pip`，一律用 `uv pip install --python .venv/Scripts/python.exe`；
4. 生成过滤后的 requirements（去掉 `--extra-index-url`、`torch*` 钉死行、`triton*`、`flash-attn`），再 `uv pip install -r`；
5. 权重用仓库自带的下载器：
   ```python
   from acestep.model_downloader import download_main_model, download_submodel
   download_main_model(prefer_source="huggingface")          # 28 个文件，约 9 GB
   download_submodel("acestep-5Hz-lm-0.6B", prefer_source="huggingface")
   ```

## 跑

```bash
cd "$ACE_DIR"
# 桌面 UI（127.0.0.1:7860）
.venv/Scripts/python.exe -m uv run acestep
# REST API（127.0.0.1:8001）
.venv/Scripts/python.exe -m uv run acestep-api
# 无头脚本（本仓库提供一个最小可跑的例子）
HF_ENDPOINT=https://hf-mirror.com .venv/Scripts/python.exe smoke_generate.py --duration 30
```

无头脚本的核心调用（`acestep/inference.py`）：

```python
from acestep.handler import AceStepHandler
from acestep.llm_inference import LLMHandler
from acestep.inference import GenerationParams, GenerationConfig, generate_music

dit = AceStepHandler()
dit.initialize_service(project_root=ROOT, config_path="acestep-v15-turbo",
                       device="auto", offload_to_cpu=True)   # 8 GB 卡务必开 offload
llm = LLMHandler()
llm.initialize(checkpoint_dir=os.path.join(ROOT, "checkpoints"),
               lm_model_path="acestep-5Hz-lm-0.6B", backend="pt", device="auto",
               offload_to_cpu=True)

params = GenerationParams(task_type="text2music", thinking=True,
                          caption="Chinese pop ballad, warm piano, intimate female vocal",
                          lyrics="[Verse]\n深海里的鲸鱼游过我的窗\n[Chorus]\n如果世界太吵 就听我唱",
                          bpm=96, timesignature="4", vocal_language="zh",
                          duration=30, inference_steps=8, guidance_scale=1.0, seed=1234)
result = generate_music(dit, llm, params=params,
                        config=GenerationConfig(batch_size=1, audio_format="wav"),
                        save_dir="out")
```

启动时会自动探测显存并打印档位（本机 7.93 GiB → tier3 / LM 0.6B / auto CPU offload）。

## 状态与注意（本机实测 2026-10-27）

RTX 5060 Laptop **7.9 GB** 实测：

| 项 | 结果 |
|---|---|
| 自动档位 | tier3 → DiT `acestep-v15-turbo` + LM `acestep-5Hz-lm-0.6B`，`pt` 后端，CPU offload |
| 权重体积 | `checkpoints/` 约 11 GB（主仓库 28 文件 + LM 0.6B） |
| DiT 加载 | 14.1 s |
| LM 加载 | 22.4 s |
| 30 s 歌曲生成 | **37.5 s**（LM phase1 18.6 s + phase2 6.8 s + DiT 8 步 + VAE 解码） |
| 输出 | 44.1→48 kHz 立体声 WAV，30.0 s，峰值归一化到 −1 dB |
| 客观指标 | BPM 实测 97（请求 96）、C major（未指定自动判定） |

复现命令（本仓库提供的最小无头脚本）：

```bash
cd "$ACE_DIR"
HF_ENDPOINT=https://hf-mirror.com .venv/Scripts/python.exe smoke_generate.py --duration 30 --bpm 96 --language zh
# -> out/<uuid>.wav + out/smoke_params.json
```

注意：

- 这个 30 s 样例里**人声存在但歌词听不清**（ASR 未转写出词）。这是质量层的事，不是安装问题；改善方向：明确写"lead female vocal, clearly sung, upfront"、把歌词写长到覆盖整段、或换 seed/结构标签重抽。技术可用性已验证（模型加载、推理、VAE、归一化、落盘）。
- 8 GB 卡不要碰 XL 4B；`vllm` 后端在 Windows 不走，用 `pt`。
- 中文歌词建议带结构标签（`[Intro]/[Verse]/[Chorus]`），模型对结构的遵循比自然语言描述更稳。
- 生成质量与提示词遵循度因语言/风格差异大；技术指标（LUFS/峰值）可测，"好不好听"必须人听。
- 商用：ACE-Step 模型卡声明 MIT 且"商业可用"；若生成内容复刻了受版权保护的旋律/风格，风险仍由使用者承担。

