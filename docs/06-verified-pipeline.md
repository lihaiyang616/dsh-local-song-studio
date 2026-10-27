# 06 · 实测记录（S1–S6 翻唱链路）

硬件/环境：Windows 11 · RTX 5060 Laptop **8 GB** · Python 3.10.11 · torch **2.7.1+cu128** · torchaudio 2.7.1+cu128 · DDSP-SVC **6.2 分支** + 本仓库补丁 · MSST `6fdad13`。

测试输入：一段 35.3 s 的「女声 + 伴奏」单声道素材（44.1 kHz，来自本机已有的 TTS 试听材料，不含第三方音乐）。**这段素材的伴奏本身很轻，所以它的意义是验证链路，不代表音色效果。**

## 命令与结果

**S1 人声/伴奏分离（MSST kim）**

```bash
python inference.py --model_type mel_band_roformer \
  --config_path configs/config_vocals_mel_band_roformer_kim.yaml \
  --start_check_point pretrain/MelBandRoformer_kim.ckpt \
  --input_folder <in> --store_dir <out> --extract_instrumental --disable_detailed_pbar
```

- 模型加载 5.7–10.6 s，推理 18.6–69.0 s（首次含 CUDA 预热）
- 产物：`<out>/<曲名>/vocals.wav`、`instrumental.wav`

**S2 主唱/和声二次分离（BS-Roformer karaoke）**

```bash
python inference.py --model_type bs_roformer \
  --config_path configs/config_karaoke_frazer_becruily.yaml \
  --start_check_point pretrain/bs_roformer_karaoke_frazer_becruily.ckpt \
  --input_folder <vocals 所在目录> --store_dir <out> --extract_instrumental --disable_detailed_pbar
```

- 20.0–35.3 s；产物 `Vocals.wav`（主唱）/ `instrumental.wav`（和声）

**S4 换声（DDSP-SVC 6.2 + Pallas 6.2 音色）**

```bash
python runtime/convert.py --src <主唱.wav> --out out/lead_pilot_k+0.wav \
  --model <音色>/model_20000.pt --ddsp-dir <DDSP 目录> \
  --backend baseline --mode pilot --key 0 --start 0 --duration 35.4 \
  --step 50 --method euler --t-start 0
```

- 35.3 s 输入自动分 2 块（每块最长约 21 s），总计 53.9 s
- 产物：`lead_pilot_k+0.wav`（44.1 kHz）+ `.conversion.json`（provenance）

**S5 混音 + 母带**

```bash
python runtime/mix.py --mix-dir <runtime> --out out/master.wav --profile standard --target -14 \
  --set inst=<伴奏> --set lead=<换声后主唱> --set harm=<和声>
```

- 4.2 s；输出 −14.03 LUFS

**S6 五门技术验收**

```bash
python runtime/verify_mix.py out/master.wav --target-lufs -14 --json out/master.verify.json
```

| 门 | 实测 | 判据 | 结果 |
|---|---|---|---|
| 整合响度 | −14.03 LUFS | −14.0 ±0.5 | PASS |
| 真峰值 | −1.03 dBTP | ≤ −1.0 | PASS |
| 波峰因数 crest | 19.31 dB | ≥ 12.0 | PASS |
| 动态范围 LRA | 48.82 dB | 报告项 | PASS |
| 立体声相关 | 0.940 | 0.20–0.95 | PASS |

## 踩过的坑（复现时最省时间的几条）

1. **默认分支是 6.3**：直接 clone 后加载 6.2 音色会 `size mismatch`。必须 checkout `6.2` 分支。
2. **6.2 要 fairseq**：Windows 无 MSVC 装不了 → 用 `patches/` 里补丁 + HF 转换版 ContentVec（`docs/03`）。
3. **还需要 `gin-config`**：6.2 的 `ddsp/unit2control.py` 顶部 `import gin`，6.3 不需要。
4. **pilot 混音必须先裁到同一区间**：`mix.py` 会拒绝时长差 > 30 ms 的三轨。做 pilot 时先裁伴奏/和声再混，别拿 20 s 主唱配整曲伴奏。
5. **pip 换镜像**：`pypi.org` 时通时断时，`-i https://mirrors.aliyun.com/pypi/simple` 稳定；torch cu128 轮子从南京大学镜像（`mirrors.nju.edu.cn/pytorch/whl/cu128`，约 10 MB/s）比阿里云快一个数量级。

## 未纳入本记录的部分

- ACE-Step 1.5 与 DiffSinger 的端到端音频结果：安装脚本已提供，实测结果更新在各自文档顶部。
- 听感/审美结论：本仓库只记录可测量的技术指标；是否"好听"必须人耳判断，技术 PASS 不等于可发布。
- 本仓库不附带任何测试音频、权重或用户素材。
