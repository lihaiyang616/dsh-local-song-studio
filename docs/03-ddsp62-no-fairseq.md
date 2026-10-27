# 03 · 关键补丁：让 DDSP-SVC 6.2 在 Windows 上不需要 fairseq

## 问题

DDSP-SVC 的 `6.2` 分支（训练/推理参数与 6.2 系音色模型匹配）在 `ddsp/vocoder.py` 顶部写着：

```python
from transformers import HubertModel, Wav2Vec2FeatureExtractor
from fairseq import checkpoint_utils          # ← 这里
```

`fairseq` 在 PyPI 上只有源码包，装它要 Cython + MSVC。Windows 机器没装 Visual Studio Build Tools 时 `pip install fairseq` 直接失败，于是整个 DDSP 6.2 导入链断在第一步：

```
ModuleNotFoundError: No module named 'fairseq'
```

官方"整合包"能跑，是因为打包者已经替他编好了 fairseq。

## 为什么不能改用 6.3 代码

6.3 分支不再用 fairseq（改成 transformers 加载 HF 格式 ContentVec），但它的 **Conformer 层结构变了**（`expansion_factor=1` + `Linear` 前馈，6.2 是 `expansion_factor=2` + 1×1 卷积前馈）。拿 6.3 代码加载 6.2 系音色模型会刷一屏 `size mismatch`，权重加载不进去。

结论：**保留 6.2 的模型结构，只替换 ContentVec 的加载方式**。

## 补丁做了什么

`patches/ddsp-svc-6.2-contentvec-transformers.patch` 只改 `ddsp/vocoder.py`：

1. 把 `from transformers import HubertModel, Wav2Vec2FeatureExtractor` 扩成带 `HubertConfig`；
2. 把 `from fairseq import checkpoint_utils` 包进 `try/except ImportError`（其余老编码器 hubertbase 等才需要它，本路线不用）；
3. 新增 `HubertModelWithFinalProj`（与 6.3 分支同款：HF HubertModel + `final_proj` 线性层）；
4. 把 `Audio2ContentVec768L12` / `Audio2ContentVec768L12TTA2X` 的 `__init__` 从"fairseq 加载 ensemble"改成"`torch.load` 转换版 state_dict 后 `load_state_dict`"；`TTA2X` 的 `__call__` 换成 6.3 的等价张量实现（数学不变：pad 160 采样做二次前向再拼接）。

## 配套权重

补丁要求 ContentVec 是 **HF 格式 state_dict**（键名形如 `feature_extractor.conv_layers.*`、`encoder.layers.*`、`final_proj.*`），不是 fairseq 原始 checkpoint。用：

```
https://hf-mirror.com/lengyue233/content-vec-best/resolve/main/pytorch_model.bin
```

放到 `02_模型推理_DDSP-SVC-6.2/DDSP-barbara-6.2/pretrain/contentvec/checkpoint_best_legacy_500.pt`（文件名保持插件期望的名字）。实测该文件 378,342,945 字节，`final_proj.weight/bias` 齐全。

## 应用

```bash
# 在已 clone 的 6.2 分支 DDSP 目录里
git apply /path/to/dsh-local-song-studio/patches/ddsp-svc-6.2-contentvec-transformers.patch
# 或：patch -p0 < ...  （补丁是相对仓库根的普通 diff）
```

然后补一个 6.2 代码需要、6.3 不需要的依赖：

```bash
env/Scripts/python.exe -m pip install gin-config
```

验证（应输出 `ok` 而不是 ModuleNotFoundError）：

```bash
env/Scripts/python.exe -c "import sys; sys.path.insert(0,'.'); import ddsp.vocoder as v; print('ok', hasattr(v,'HubertModelWithFinalProj'))"
```

## 已知边界

- 只覆盖 `contentvec768l12` / `contentvec768l12tta2x` 两种编码器；`hubertsoft`、`hubertbase*`、`cnhubertsoftfish` 仍需 fairseq（本补丁没有替换它们）。
- 补丁不改推理参数、不改模型结构、不做任何数值近似，仅更换加载器与等价张量实现。换声结果已实测通过（见 `docs/06`）。
- 如果以后要跑 `hubertbase` 系音色，正路还是装 MSVC Build Tools 再 `pip install fairseq`。
