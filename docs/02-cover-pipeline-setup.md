# 02 · 翻唱链路：绕开百度网盘的安装方法

目标目录布局（与 `dsh-cover-pipeline` 的自动发现约定一致）：

```
$AI_ROOT/
├── 01_人声分离_MSST-GUI/                 # MSST 引擎（inference.py + configs + pretrain + env）
├── 02_模型推理_DDSP-SVC-6.2/
│   └── DDSP-barbara-6.2/                 # DDSP-SVC 6.2 引擎（batch_infer.py + pretrain + env）
├── 03_音色模型_<名字>/<音色>_步数N/exp/reflow-test/
│   ├── model_<steps>.pt
│   └── config.yaml                       # 音色权重（自备，仓库不分发）
└── cover_runs/                           # 工程数据（混音/中间件）
```

## 组件来源与校验

| 文件 | 来源（可直接 curl / 下载） | 期望大小 | sha256（前 16 位，实测） |
|---|---|---|---|
| `01_.../pretrain/MelBandRoformer_kim.ckpt` | `hf-mirror.com/KimberleyJSN/melbandroformer/resolve/main/MelBandRoformer.ckpt` | 913,106,900 | `87201f4d31afb5bc` |
| `01_.../pretrain/bs_roformer_karaoke_frazer_becruily.ckpt` | `hf-mirror.com/becruily/bs-roformer-karaoke/.../bs_roformer_karaoke_frazer_becruily.ckpt` | 204,436,907 | `eb90ee24c1154d83` |
| `01_.../configs/config_vocals_mel_band_roformer_kim.yaml` | MSST 仓库 `configs/KimberleyJensen/config_vocals_mel_band_roformer_kj.yaml`（改名） | ~2 KB | — |
| `01_.../configs/config_karaoke_frazer_becruily.yaml` | becruily HF 仓库同名文件 | ~2 KB | — |
| `02_.../pretrain/contentvec/checkpoint_best_legacy_500.pt` | `hf-mirror.com/lengyue233/content-vec-best/.../pytorch_model.bin`（**转换版**，见 docs/03） | 378,342,945 | `d8dd400e054ddf4e` |
| `02_.../pretrain/pc_nsf_hifigan_44.1k_hop512_128bin_2025.02/model.ckpt` | `hf-mirror.com/None1145/DDSP-SVC-Base/.../nsf_hifigan/model/vocoder.ckpt`（同目录放 `config.json`） | 56,816,642 | `6512580252c2675b` |
| `02_.../pretrain/rmvpe/model.pt` | `hf-mirror.com/None1145/DDSP-SVC-Base/.../rmvpe/model.pt` | 368,492,925 | `19dc1809cf4cdb0a` |

> 说明：kim / karaoke 两个权重的 sha256 与 `dsh-cover-pipeline` 官方材料清单（`materials/manifest.json`）完全一致，可以认为等价。ContentVec / HiFiGAN / RMVPE 取自公开的 DDSP 预训练集合仓库，内容是同一套上游文件（ContentVec 为**转换后的 HF state_dict**，见 docs/03）。

## 装法（三条命令）

```bash
export AI_ROOT=/path/to/AI-Song
export PY310=/path/to/python310/python.exe
export TORCH_WHEEL=/path/to/torch-2.7.1+cu128-cp310-cp310-win_amd64.whl
export HF_ENDPOINT=https://hf-mirror.com          # 国内直连 huggingface 不通时

bash scripts/setup_msst.sh        # MSST 源码 + 权重 + 独立 venv
bash scripts/setup_ddsp.sh        # DDSP-SVC 6.2 + 预训练件 + 独立 venv
bash scripts/apply_ddsp62_patch.sh # 去掉 fairseq（Windows 必须）
python scripts/verify_layout.py --root "$AI_ROOT"
```

## 接入 DSH 插件

把 `configs/cover.local.example.json` 复制到 `dsh-cover-pipeline` 插件根目录的 `cover.local.json`（该文件已在插件 `.gitignore` 里），改成本机路径即可。插件在**启动时**读配置，所以改完要重启 DSH，然后：

```
cover_doctor   # 应显示 "环境体检通过"
cover_plan     # 出 S0–S9 流程与五道验收门
```

## 关键实现差异（必读）

1. **DDSP 必须用 6.2 分支代码**（`https://github.com/yxlllc/DDSP-SVC` 的 `6.2` 分支）。默认分支是 6.3，Conformer 层的实现变了，6.2 训练的模型加载会报 `size mismatch`。
2. **6.2 的 fairseq 依赖在 Windows 上装不了** —— 见 `docs/03`，用补丁绕开。
3. 混音阶段要求三轨 **44.1 kHz、非空、时长对齐在 30 ms 内**：pilot 试听时要把伴奏/和声裁到同一区间再混，不能拿 20 s 主唱去配整曲伴奏。
4. 音色目录里必须有 `config.yaml`（与 `model_*.pt` 同目录），且 `vocoder.ckpt` / `encoder_ckpt` 指向本机实际路径；示例见 `configs/voice-config.example.yaml`。
