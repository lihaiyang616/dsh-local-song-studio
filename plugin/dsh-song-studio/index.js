/**
 * dsh-song-studio —— 本地歌曲工作室插件
 *
 * 把已经在本机验证过的四个引擎串成 DSH 工具：
 *   ACE-Step 1.5（整曲生成）→ MSST（分离/分轨）→ DDSP-SVC 6.2（换声）→ mix/verify（母带+五门验收）
 *
 * 契约与 dsh-cover-pipeline 一致：export name / inject / apply(ctx, config)，
 * tools.register({ name, description, parameters, output, execute })。
 * 零运行时 npm 依赖，只用 node: 内置模块。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join as pjoin, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const name = 'song-studio';
export const inject = ['tools'];

const HERE = dirname(fileURLToPath(import.meta.url));
const textOut = (schema, fn) => ({ schema, render: (_a, v) => [{ type: 'text', text: fn(v) }] });

// ───────────────────────────────────────────────────────────────────────────
// 配置发现
// ───────────────────────────────────────────────────────────────────────────
function firstExisting(list) {
  for (const p of list) if (p && existsSync(p)) return p;
  return '';
}

function resolveConfig(config = {}) {
  const dshHome = process.env.DSH_HOME || pjoin(process.env.USERPROFILE || process.env.HOME || '.', '.dsh');
  const aiRoot = config.aiRoot
    || process.env.AI_ROOT
    || firstExisting(['E:/AI-Song', 'D:/AI-Song', 'C:/AudioWork'])
    || 'E:/AI-Song';
  const aceDir = config.aceDir || pjoin(aiRoot, 'songgen/ace-step');
  const cfg = {
    aiRoot,
    aceDir,
    acePy: config.acePy || pjoin(aceDir, '.venv/Scripts/python.exe'),
    aceCheckpoints: config.aceCheckpoints || pjoin(aceDir, 'checkpoints'),
    outRoot: config.outRoot || pjoin(aiRoot, 'songgen/out'),
    coverRuntime: config.coverRuntime || pjoin(dshHome, 'plugins/dsh-cover-pipeline/runtime'),
    msstDir: config.msstDir || pjoin(aiRoot, '01_人声分离_MSST-GUI'),
    msstEnv: config.msstEnv || pjoin(aiRoot, '01_人声分离_MSST-GUI/env/Scripts/python.exe'),
    ddspDir: config.ddspDir || pjoin(aiRoot, '02_模型推理_DDSP-SVC-6.2/DDSP-barbara-6.2'),
    ddspEnv: config.ddspEnv || pjoin(aiRoot, '02_模型推理_DDSP-SVC-6.2/DDSP-barbara-6.2/env/Scripts/python.exe'),
    voiceModel: config.voiceModel || '',
    ffmpeg: config.ffmpeg || 'ffmpeg',
    defaultLufs: Number(config.defaultLufs ?? -14),
    generateTimeoutMs: Number(config.generateTimeoutMs ?? 900000),
    convertTimeoutMs: Number(config.convertTimeoutMs ?? 900000),
    maxOutputChars: Number(config.maxOutputChars ?? 6000),
    aceScript: pjoin(HERE, 'lib/ace_generate.py'),
  };
  if (!cfg.voiceModel) cfg.voiceModel = discoverVoice(aiRoot);
  return cfg;
}

function discoverVoice(aiRoot) {
  try {
    for (const lib of readdirSync(aiRoot, { withFileTypes: true })) {
      if (!lib.isDirectory() || !/^03[_-]/.test(lib.name)) continue;
      const libPath = pjoin(aiRoot, lib.name);
      for (const vd of readdirSync(libPath, { withFileTypes: true })) {
        if (!vd.isDirectory()) continue;
        const vPath = pjoin(libPath, vd.name);
        for (const exp of readdirSync(vPath, { withFileTypes: true })) {
          if (!exp.isDirectory() || !/^exp/i.test(exp.name)) continue;
          const expPath = pjoin(vPath, exp.name);
          const walk = [expPath];
          while (walk.length) {
            const cur = walk.pop();
            for (const g of readdirSync(cur, { withFileTypes: true })) {
              const p = pjoin(cur, g.name);
              if (g.isDirectory()) walk.push(p);
              else if (/^model_\d+\.pt$/.test(g.name) && existsSync(pjoin(cur, 'config.yaml'))) return p;
            }
          }
        }
      }
    }
  } catch { /* 无音色库 */ }
  return '';
}

// ───────────────────────────────────────────────────────────────────────────
// 进程执行
// ───────────────────────────────────────────────────────────────────────────
function runProcess(cmd, args, opts = {}) {
  const { cwd, env = {}, timeoutMs = 600000, maxChars = 6000 } = opts;
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* noop */ }
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}\n${e.message}`, cmdline: [cmd, ...args].join(' ') });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        code,
        stdout,
        stderr,
        timedOut: code === null,
        cmdline: [cmd, ...args].join(' '),
        stdoutTail: stdout.slice(-maxChars),
        stderrTail: stderr.slice(-maxChars),
      });
    });
  });
}

function lastJsonLine(text) {
  const lines = String(text || '').trim().split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (line.startsWith('{') && line.endsWith('}')) {
      try { return JSON.parse(line); } catch { /* continue */ }
    }
  }
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// 文案模板（song_plan 用；不调用模型，确定性可复现）
// ───────────────────────────────────────────────────────────────────────────
const STRUCTURES = {
  '30s': ['[Intro]', '[Verse]', '[Chorus]'],
  '60s': ['[Intro]', '[Verse]', '[Pre-Chorus]', '[Chorus]', '[Outro]'],
  '180s': ['[Intro]', '[Verse 1]', '[Pre-Chorus]', '[Chorus]', '[Verse 2]', '[Chorus]', '[Bridge]', '[Outro]'],
};

const STYLE_WORDS = {
  流行: 'modern Chinese pop', 民谣: 'acoustic folk', 摇滚: 'pop rock', 电子: 'synth pop',
  古风: 'Chinese traditional pop', 摇滚乐: 'hard rock', 爵士: 'jazz pop', 说唱: 'hip hop',
  儿歌: 'children song', 治愈: 'lo-fi chill',
};

function buildPlan(args) {
  const lang = args.language || 'zh';
  const style = args.style || '流行';
  const theme = args.theme || '深海里的鲸鱼与夜晚的陪伴';
  const duration = Number(args.duration || 30);
  const bpm = Number(args.bpm || (style === '电子' ? 120 : 96));
  const key = args.keyscale || '';
  const vocab = STYLE_WORDS[style] || style;
  const hook = args.hook || theme.split(/[，,。\s]/)[0].slice(0, 12);
  const structure = STRUCTURES[duration >= 180 ? '180s' : duration >= 60 ? '60s' : '30s'];

  const lyricsByLang = {
    zh: [
      structure[0],
      '',
      '[Verse]',
      `${hook}，我把心事说给夜色听`,
      '那些没说完的话，都藏进风里',
      '',
      '[Chorus]',
      '如果世界太吵，就听我唱',
      '把没说完的话，都唱成光',
    ].join('\n'),
    en: [
      structure[0], '', '[Verse]',
      `${hook}, I whisper to the night`,
      'All the words I never said, I keep them out of sight', '',
      '[Chorus]', 'If the world gets loud, just hear me sing',
      'Every word I never said becomes a golden string',
    ].join('\n'),
    ja: [
      structure[0], '', '[Verse]',
      `${hook}、夜にそっと呟く`,
      '言えなかった言葉を、風に預けて', '',
      '[Chorus]', '世界が騒がしければ、私の歌を聴いて',
      '言えなかった言葉を、光に変えて',
    ].join('\n'),
  };

  const caption = [
    `A ${style === '流行' ? 'warm' : 'characterful'} ${vocab} song`,
    `at ${bpm} BPM${key ? ` in ${key}` : ''}.`,
    'Clear lead vocal, upfront in the mix, supported by piano and soft strings,',
    'with a gentle beat, emotional but not overdone, radio-friendly production.',
  ].join(' ');

  return {
    theme,
    style,
    language: lang,
    bpm,
    duration,
    keyscale: key,
    structure,
    caption,
    lyrics: args.lyrics || lyricsByLang[lang] || lyricsByLang.zh,
    notes: [
      '歌词是模板草稿，请按你的主题改词（尤其副歌的钩子句）。',
      'caption 用英文风格描述，模型对英文风格词的遵循更稳；结构标签保留方括号写法。',
      '改完直接喂给 song_generate：先出 2–3 个 seed 的候选，再按听审迭代（repaint/换音色）。',
    ],
  };
}

// ───────────────────────────────────────────────────────────────────────────
// 插件主体
// ───────────────────────────────────────────────────────────────────────────
export async function apply(ctx, config) {
  const logger = ctx.logger ?? console;
  const cfg = resolveConfig(config || {});
  const tools = ctx.get('tools');
  if (!tools) {
    logger.warn('[song-studio] tools 服务不可用，插件未注册任何工具');
    return;
  }
  const registered = [];

  // 1 · 体检
  tools.register({
    name: 'song_status',
    description:
      '歌曲工作室体检：检查 ACE-Step 引擎/权重、MSST 分离环境、DDSP 换声环境、cover runtime 的 mix/verify 脚本、'
      + '目标音色与 ffmpeg；并列出最近的生成产物。任何生成/换声任务前先跑它。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: textOut({ type: 'object', properties: { ok: { type: 'boolean' }, rendered: { type: 'string' } }, required: ['ok', 'rendered'] },
      (v) => String(v?.rendered ?? '')),
    execute: async () => {
      const rows = [];
      const check = (label, path, isDir = false) => {
        const ok = !!path && existsSync(path);
        let size = null;
        try { if (ok && !isDir) size = statSync(path).size; } catch { /* noop */ }
        rows.push({ label, path, ok, size });
        return ok;
      };
      const acePy = check('ACE-Step python', cfg.acePy);
      const aceCk = check('ACE-Step checkpoints', cfg.aceCheckpoints, true);
      check('ACE-Step 源码', pjoin(cfg.aceDir, 'pyproject.toml'));
      check('生成脚本', cfg.aceScript);
      const msst = check('MSST python', cfg.msstEnv);
      const ddsp = check('DDSP python', cfg.ddspEnv);
      check('mix_master.py', pjoin(cfg.coverRuntime, 'mix_master.py'));
      check('verify_mix.py', pjoin(cfg.coverRuntime, 'verify_mix.py'));
      check('convert.py', pjoin(cfg.coverRuntime, 'convert.py'));
      check('目标音色', cfg.voiceModel);
      let ckSize = 0;
      try {
        if (aceCk) {
          const stack = [cfg.aceCheckpoints];
          while (stack.length) {
            const cur = stack.pop();
            for (const e of readdirSync(cur, { withFileTypes: true })) {
              const p = pjoin(cur, e.name);
              if (e.isDirectory()) stack.push(p);
              else ckSize += statSync(p).size;
            }
          }
        }
      } catch { /* noop */ }
      const recent = [];
      try {
        if (existsSync(cfg.outRoot)) {
          for (const e of readdirSync(cfg.outRoot, { withFileTypes: true })
            .filter((d) => d.isFile() && /\.(wav|mp3|flac)$/i.test(d.name))
            .map((d) => ({ name: d.name, mtime: statSync(pjoin(cfg.outRoot, d.name)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime).slice(0, 5)) {
            recent.push({ name: e.name, path: pjoin(cfg.outRoot, e.name) });
          }
        }
      } catch { /* noop */ }
      const ok = acePy && aceCk && msst && ddsp && existsSync(pjoin(cfg.coverRuntime, 'mix_master.py'));
      const lines = ['【歌曲工作室 · 体检】', ''];
      for (const r of rows) {
        lines.push(`${r.ok ? '✅' : '❌'} ${r.label.padEnd(20)} ${r.path || '(空)'}${r.size ? `  ${(r.size / 1048576).toFixed(1)} MB` : ''}`);
      }
      lines.push('', `ACE 权重合计: ${(ckSize / 1073741824).toFixed(1)} GB`, `输出目录: ${cfg.outRoot}`);
      if (recent.length) { lines.push('', '最近产物:'); for (const r of recent) lines.push(`  ${r.name}`); }
      lines.push('', ok ? '✅ 核心组件齐全：可以 song_plan → song_generate → song_separate → song_convert → song_mix → song_verify' : '⚠️ 有缺失，见上（docs/02 与 docs/04 有安装脚本）');
      return { ok, rows, recent, rendered: lines.join('\n') };
    },
  });

  // 2 · 规划
  tools.register({
    name: 'song_plan',
    description:
      '把一句需求变成可执行的歌曲计划：主题/风格/语言/时长 → 结构标签、英文风格 caption、歌词草稿、BPM 建议。'
      + '纯模板、确定性、不调用模型；产出直接喂 song_generate。改词后重跑即可。',
    parameters: {
      type: 'object',
      properties: {
        theme: { type: 'string', description: '主题/一句话情绪，如「深海里的鲸鱼与夜晚的陪伴」' },
        style: { type: 'string', description: '风格：流行/民谣/摇滚/电子/古风/爵士/说唱/儿歌/治愈' },
        language: { type: 'string', enum: ['zh', 'en', 'ja'] },
        duration: { type: 'integer', description: '目标时长（秒），常用 30/60/180' },
        bpm: { type: 'integer' },
        keyscale: { type: 'string', description: '如 C Major / A minor；留空由模型判定' },
        lyrics: { type: 'string', description: '已有歌词（给了就不再生成模板）' },
        hook: { type: 'string', description: '副歌钩子句/关键词' },
      },
      additionalProperties: false,
    },
    output: textOut({ type: 'object', properties: { ok: { type: 'boolean' }, plan: { type: 'object' }, rendered: { type: 'string' } }, required: ['ok'] },
      (v) => String(v?.rendered ?? '')),
    execute: async (args) => {
      const plan = buildPlan(args || {});
      const rendered = [
        '【歌曲计划】', '',
        `主题: ${plan.theme}`,
        `风格: ${plan.style}  ·  语言: ${plan.language}  ·  时长: ${plan.duration}s  ·  BPM: ${plan.bpm}  ·  调: ${plan.keyscale || '自动'}`,
        '', '── caption（英文风格提示）──', plan.caption,
        '', '── 结构 ──', plan.structure.join(' → '),
        '', '── 歌词草稿 ──', plan.lyrics,
        '', '── 注意 ──', ...plan.notes.map((n, i) => `${i + 1}. ${n}`),
        '', '下一步: song_generate(caption, lyrics, duration, bpm, language, seed=…)，建议一次出 2–3 个 seed。',
      ].join('\n');
      return { ok: true, plan, rendered };
    },
  });

  // 3 · 生成
  tools.register({
    name: 'song_generate',
    description:
      '用 ACE-Step 1.5 生成整首带唱的歌（本地、离线）。一次调用出一个候选；建议同参数换 2–3 个 seed。'
      + '首次调用会加载 DiT（约 14 s）与 LM（约 22 s）；30 秒歌约 40 s，2 分钟歌约 1–2 分钟。',
    parameters: {
      type: 'object',
      properties: {
        caption: { type: 'string', description: '英文风格描述（song_plan 产出）' },
        lyrics: { type: 'string', description: '歌词，含 [Verse]/[Chorus] 结构标签' },
        duration: { type: 'integer', description: '秒，10–600' },
        bpm: { type: 'integer' },
        keyscale: { type: 'string' },
        language: { type: 'string', description: 'zh/en/ja…' },
        seed: { type: 'integer', description: '随机种子；-1 = 随机' },
        steps: { type: 'integer', description: 'turbo 默认 8' },
        outDir: { type: 'string', description: '输出目录；默认 outRoot 下按时间建目录' },
        noLm: { type: 'boolean', description: '只用 DiT（更快，但结构/歌词遵循更弱）' },
        timeoutMs: { type: 'integer' },
      },
      required: ['caption', 'lyrics'],
      additionalProperties: false,
    },
    output: textOut({ type: 'object', properties: { ok: { type: 'boolean' }, audio: { type: 'string' }, rendered: { type: 'string' } }, required: ['ok'] },
      (v) => String(v?.rendered ?? '')),
    execute: async (args) => {
      const outDir = args.outDir || pjoin(cfg.outRoot, `gen-${new Date().toISOString().replace(/[:.]/g, '-')}`);
      mkdirSync(outDir, { recursive: true });
      const paramsPath = pjoin(outDir, 'params.json');
      writeFileSync(paramsPath, JSON.stringify({
        ace_dir: cfg.aceDir,
        out_dir: outDir,
        caption: args.caption,
        lyrics: args.lyrics,
        duration: args.duration ?? 30,
        bpm: args.bpm ?? null,
        keyscale: args.keyscale ?? '',
        language: args.language ?? 'zh',
        seed: args.seed ?? -1,
        steps: args.steps ?? 8,
        no_lm: !!args.noLm,
        offload: true,
      }, null, 2), 'utf8');
      const r = await runProcess(cfg.acePy, [cfg.aceScript, '--params', paramsPath], {
        cwd: cfg.aceDir,
        env: { HF_ENDPOINT: process.env.HF_ENDPOINT || 'https://hf-mirror.com' },
        timeoutMs: args.timeoutMs ?? cfg.generateTimeoutMs,
        maxChars: cfg.maxOutputChars,
      });
      const parsed = lastJsonLine(r.stdout);
      const ok = !!parsed?.ok;
      const rendered = [
        ok ? '✅ 生成完成' : '❌ 生成失败',
        `命令: ${r.cmdline}`,
        `退出码: ${r.code}${r.timedOut ? '（超时被杀）' : ''}`,
        parsed?.audio ? `音频: ${parsed.audio}` : '',
        parsed?.generate_seconds ? `耗时: DiT 加载 ${parsed.dit_seconds}s / LM 加载 ${parsed.lm_seconds}s / 生成 ${parsed.generate_seconds}s` : '',
        parsed?.error ? `错误: ${parsed.error}` : '',
        !ok ? `输出尾部:\n${r.stderrTail || r.stdoutTail}` : '',
      ].filter(Boolean).join('\n');
      return { ok, audio: parsed?.audio, params: paramsPath, ...parsed, cmdline: r.cmdline, rendered };
    },
  });

  // 4 · 分离 / 分轨
  tools.register({
    name: 'song_separate',
    description:
      'MSST 人声/伴奏分离（kim）；karaoke=true 时再做一次主唱/和声分离。用于把生成的歌拆成人声与伴奏，'
      + '便于换声或单独处理。输入目录里只放要处理的音频。',
    parameters: {
      type: 'object',
      properties: {
        inputFolder: { type: 'string', description: '只含待处理音频的目录' },
        outDir: { type: 'string' },
        karaoke: { type: 'boolean' },
        timeoutMs: { type: 'integer' },
      },
      required: ['inputFolder', 'outDir'],
      additionalProperties: false,
    },
    output: textOut({ type: 'object', properties: { ok: { type: 'boolean' }, outputs: { type: 'array' }, rendered: { type: 'string' } }, required: ['ok'] },
      (v) => String(v?.rendered ?? '')),
    execute: async (args) => {
      const msstCwd = cfg.msstDir;
      const sep = await runProcess(cfg.msstEnv, [
        'inference.py', '--model_type', 'mel_band_roformer',
        '--config_path', 'configs/config_vocals_mel_band_roformer_kim.yaml',
        '--start_check_point', 'pretrain/MelBandRoformer_kim.ckpt',
        '--input_folder', args.inputFolder, '--store_dir', args.outDir,
        '--extract_instrumental', '--disable_detailed_pbar',
      ], { cwd: msstCwd, timeoutMs: args.timeoutMs ?? 900000, maxChars: cfg.maxOutputChars });
      let outputs = [];
      try { outputs = listWavs(args.outDir); } catch { /* noop */ }
      let karaOk = null;
      if (args.karaoke && sep.code === 0) {
        const vocals = outputs.find((p) => /vocals\.wav$/i.test(p));
        const karaIn = pjoin(args.outDir, `.kara-in-${randomUUID()}`);
        const karaOut = pjoin(args.outDir, 'kara');
        if (vocals) {
          mkdirSync(karaIn, { recursive: true });
          const { copyFileSync } = await import('node:fs');
          copyFileSync(vocals, pjoin(karaIn, basename(vocals).replace(/vocals/i, 'lead') || 'lead.wav'));
          const kara = await runProcess(cfg.msstEnv, [
            'inference.py', '--model_type', 'bs_roformer',
            '--config_path', 'configs/config_karaoke_frazer_becruily.yaml',
            '--start_check_point', 'pretrain/bs_roformer_karaoke_frazer_becruily.ckpt',
            '--input_folder', karaIn, '--store_dir', karaOut,
            '--extract_instrumental', '--disable_detailed_pbar',
          ], { cwd: msstCwd, timeoutMs: args.timeoutMs ?? 900000, maxChars: cfg.maxOutputChars });
          karaOk = kara.code === 0;
          outputs = outputs.concat(listWavs(karaOut));
        }
      }
      const ok = sep.code === 0 && (args.karaoke ? karaOk !== false : true);
      const rendered = [
        ok ? '✅ 分离完成' : '❌ 分离失败',
        `退出码: ${sep.code}`,
        '产物:',
        ...outputs.map((p) => `  ${p}`),
        '',
        '下一步: 人声可用于 song_convert；伴奏/和声用于 song_mix。',
      ].join('\n');
      return { ok, outputs, karaoke: karaOk, stderrTail: sep.stderrTail, rendered };
    },
  });

  // 5 · 换声
  tools.register({
    name: 'song_convert',
    description:
      'DDSP-SVC 6.2 换声：保留源人声的 f0/节奏/音量，只换音色。默认用自动发现的目标音色。'
      + '长音频自动分块；先 mode=pilot 出 20–35 秒试听，确认后再 full。',
    parameters: {
      type: 'object',
      properties: {
        src: { type: 'string', description: '源人声 wav' },
        outDir: { type: 'string' },
        key: { type: 'integer', description: '移调半音，0 = 不变' },
        mode: { type: 'string', enum: ['pilot', 'full'] },
        start: { type: 'number' },
        duration: { type: 'number' },
        step: { type: 'integer' },
        method: { type: 'string', enum: ['euler', 'rk4'] },
        tStart: { type: 'number' },
        model: { type: 'string', description: '音色权重路径；默认配置里的 voiceModel' },
        timeoutMs: { type: 'integer' },
      },
      required: ['src', 'outDir'],
      additionalProperties: false,
    },
    output: textOut({ type: 'object', properties: { ok: { type: 'boolean' }, lead: { type: 'string' }, rendered: { type: 'string' } }, required: ['ok'] },
      (v) => String(v?.rendered ?? '')),
    execute: async (args) => {
      const model = args.model || cfg.voiceModel;
      if (!model) return { ok: false, rendered: '❌ 没有可用音色模型：把 DDSP-SVC 6.2 模型放进 <aiRoot>/03_音色模型_*/.../exp/reflow-test/，或在配置里指定 voiceModel。' };
      mkdirSync(args.outDir, { recursive: true });
      const out = pjoin(args.outDir, `lead_${args.mode || 'pilot'}_k${args.key ?? 0 >= 0 ? '+' : ''}${args.key ?? 0}.wav`);
      const argv = [
        pjoin(cfg.coverRuntime, 'convert.py'),
        '--src', args.src, '--out', out, '--model', model, '--ddsp-dir', cfg.ddspDir,
        '--backend', 'baseline', '--mode', args.mode ?? 'pilot', '--key', String(args.key ?? 0),
        '--start', String(args.start ?? 0), '--duration', String(args.duration ?? 25),
        '--step', String(args.step ?? 50), '--method', args.method ?? 'euler',
        '--t-start', String(args.tStart ?? 0),
      ];
      const r = await runProcess(cfg.ddspEnv, argv, {
        cwd: cfg.ddspDir, timeoutMs: args.timeoutMs ?? cfg.convertTimeoutMs, maxChars: cfg.maxOutputChars,
      });
      const ok = r.code === 0 && existsSync(out);
      const rendered = [
        ok ? '✅ 换声完成' : '❌ 换声失败',
        `命令: ${r.cmdline}`,
        `退出码: ${r.code}`,
        ok ? `产物: ${out}` : `输出尾部:\n${r.stderrTail || r.stdoutTail}`,
      ].join('\n');
      return { ok, lead: ok ? out : undefined, stderrTail: r.stderrTail, rendered };
    },
  });

  // 6 · 混音母带
  tools.register({
    name: 'song_mix',
    description:
      '混音 + 母带（复用 cover runtime 的 pedalboard 全链：EQ/压缩/去齿音/混响/glue/限幅/LUFS 归一）。'
      + '三轨必须 44.1 kHz、非空、时长差 <30 ms（pilot 时先把伴奏/和声裁到同一区间）。',
    parameters: {
      type: 'object',
      properties: {
        inst: { type: 'string' }, lead: { type: 'string' }, harm: { type: 'string' },
        out: { type: 'string' },
        profile: { type: 'string', enum: ['standard', 'lowband-safe'] },
        targetLufs: { type: 'number' },
        timeoutMs: { type: 'integer' },
      },
      required: ['inst', 'lead', 'harm', 'out'],
      additionalProperties: false,
    },
    output: textOut({ type: 'object', properties: { ok: { type: 'boolean' }, out: { type: 'string' }, rendered: { type: 'string' } }, required: ['ok'] },
      (v) => String(v?.rendered ?? '')),
    execute: async (args) => {
      mkdirSync(dirname(args.out), { recursive: true });
      const r = await runProcess(cfg.msstEnv, [
        pjoin(cfg.coverRuntime, 'mix.py'), '--mix-dir', cfg.coverRuntime,
        '--out', args.out, '--profile', args.profile ?? 'standard',
        '--target', String(args.targetLufs ?? cfg.defaultLufs),
        '--set', `inst=${args.inst}`, '--set', `lead=${args.lead}`, '--set', `harm=${args.harm}`,
      ], { cwd: dirname(args.out), timeoutMs: args.timeoutMs ?? 600000, maxChars: cfg.maxOutputChars });
      const ok = r.code === 0 && existsSync(args.out);
      const rendered = [
        ok ? '✅ 混音完成' : '❌ 混音失败',
        `退出码: ${r.code}`,
        ok ? `产物: ${args.out}` : `输出尾部:\n${r.stderrTail || r.stdoutTail}`,
        ok ? '' : '',
      ].filter((x) => x !== '').join('\n');
      return { ok, out: ok ? args.out : undefined, stderrTail: r.stderrTail, rendered };
    },
  });

  // 7 · 五门验收
  tools.register({
    name: 'song_verify',
    description:
      '五门技术验收：整合响度 −14.0±0.5 LUFS、真峰值 ≤−1.0 dBTP、crest ≥12 dB、LRA 报告项、立体声相关 0.20–0.95。'
      + '只代表技术门结果，不代表听感或商业质量。',
    parameters: {
      type: 'object',
      properties: {
        wav: { type: 'string' },
        targetLufs: { type: 'number' },
        json: { type: 'string' },
        timeoutMs: { type: 'integer' },
      },
      required: ['wav'],
      additionalProperties: false,
    },
    output: textOut({ type: 'object', properties: { ok: { type: 'boolean' }, rendered: { type: 'string' } }, required: ['ok'] },
      (v) => String(v?.rendered ?? '')),
    execute: async (args) => {
      const jsonOut = args.json || `${args.wav}.verify.json`;
      const r = await runProcess(cfg.msstEnv, [
        pjoin(cfg.coverRuntime, 'verify_mix.py'), args.wav,
        '--target-lufs', String(args.targetLufs ?? cfg.defaultLufs), '--json', jsonOut,
      ], { cwd: cfg.coverRuntime, timeoutMs: args.timeoutMs ?? 300000, maxChars: cfg.maxOutputChars });
      const ok = r.code === 0;
      const rendered = [
        ok ? '✅ 技术验收通过' : '⚠️ 技术验收未通过',
        r.stdoutTail.split('\n').filter((l) => l.includes('[PASS]') || l.includes('[FAIL]') || l.includes('成品:')).join('\n'),
        `JSON: ${jsonOut}`,
      ].join('\n');
      return { ok, json: jsonOut, stderrTail: r.stderrTail, rendered };
    },
  });

  registered.push(
    'song_status', 'song_plan', 'song_generate', 'song_separate',
    'song_convert', 'song_mix', 'song_verify',
  );
  logger.info(`[song-studio] 已注册 ${registered.length} 个工具: ${registered.join(', ')}`);
  logger.info(`[song-studio] aiRoot=${cfg.aiRoot}  ACE=${cfg.acePy}  DDSP=${cfg.ddspEnv}`);
}

function listWavs(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const e of readdirSync(cur, { withFileTypes: true })) {
      const p = pjoin(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (/\.wav$/i.test(e.name)) out.push(p);
    }
  }
  return out.sort();
}
