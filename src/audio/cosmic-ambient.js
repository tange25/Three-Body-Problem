/**
 * Cosmic Ambient · 程序化生成的宇宙氛围背景音乐（多音轨）
 * --------------------------------------------------------------------------
 * 不依赖任何外部音频文件，全部由 Web Audio API 实时合成，便于打包成单文件离线运行。
 *
 * 设计意图：宇宙般的「凄凉 · 广阔 · 孤独」。提供 5 首可循环播放的生成式音景，
 * 每首共享同一套合成手法（低频呼吸和弦铺底 + 稀疏空灵钟铃 + 长卷积混响），
 * 但在和弦色彩、音阶、明亮度、混响纵深与呼吸节奏上彼此区分：
 *
 *   1. 寂灭  void      —— 最暗、最低、最空，近乎静止的孤独
 *   2. 远星  stars     —— 稍亮，缓慢星辉闪烁（shimmer 层）
 *   3. 流浪  drift     —— 小调色彩，钟铃更密，像在虚空中漂泊
 *   4. 广寒  lunar     —— 五声明亮，清冷如月光
 *   5. 熵    entropy   —— 最暗、最长混响、含小二度不协和，深渊般下沉
 *
 * 循环方式：生成式调度器每 ~N 秒切换一次和弦并随机散落钟铃，进度无限延伸、永无接缝。
 *
 * 关于「为何程序化而非外部生成」：本产物需作为单文件离线网页运行，且当前环境
 * 未接入可生成真实音频并回传的服务；程序化合成零资源、零网络、天然无缝循环，
 * 最契合「嵌入网页并循环播放」的需求。若后续接入 Suno/Beatra 等服务，可把各音轨
 * 的 caption 与和弦结构直接作为生成提示词复用。
 */

// ── 5 首音轨的配置 ──────────────────────────────────────────
export const TRACKS = [
  {
    id: 'void',
    name: '寂灭',
    chordDur: 24,
    lp: 1150,
    reverbDur: 7.5,
    reverbDecay: 3.2,
    bellGain: 0.42,
    bellRate: [0.6, 1.2], // 每个和弦跨度内钟铃数量区间
    shimmer: false,
    chords: [
      [55.0, 82.4, 110.0, 164.8], // A 低开放（原 A0 上移八度，可听且仍低沉）
      [65.4, 98.0, 130.8, 196.0], // C 暗
      [49.0, 73.4, 98.0, 146.8], // B 低沉
      [58.3, 87.3, 116.5, 174.6], // D 暗
    ],
    scale: [349.2, 392.0, 440.0, 523.3, 587.4], // 中低五声 A C D E G
  },
  {
    id: 'stars',
    name: '远星',
    chordDur: 22,
    lp: 1900,
    reverbDur: 6.5,
    reverbDecay: 2.8,
    bellGain: 0.5,
    bellRate: [1.4, 2.4],
    shimmer: true,
    chords: [
      [110.0, 164.8, 220.0, 329.6], // A 开放五度
      [123.5, 185.0, 246.9, 370.0], // B 暗色
      [98.0, 146.8, 196.0, 293.7], // G 暖
      [130.8, 196.0, 261.6, 392.0], // C 开放
    ],
    scale: [523.3, 587.4, 659.3, 784.0, 880.0, 1046.5], // 中高五声
  },
  {
    id: 'drift',
    name: '流浪',
    chordDur: 20,
    lp: 1650,
    reverbDur: 7.0,
    reverbDecay: 3.0,
    bellGain: 0.55,
    bellRate: [1.8, 3.0],
    shimmer: false,
    chords: [
      [110.0, 130.8, 164.8, 220.0], // Am 色彩
      [98.0, 116.5, 146.8, 196.0], // Gm
      [123.5, 146.8, 185.0, 246.9], // Bm 暗
      [87.3, 110.0, 130.8, 174.6], // Fm 深远
    ],
    scale: [440.0, 523.3, 587.4, 659.3, 784.0, 880.0],
  },
  {
    id: 'lunar',
    name: '广寒',
    chordDur: 18,
    lp: 2300,
    reverbDur: 6.0,
    reverbDecay: 2.6,
    bellGain: 0.6,
    bellRate: [1.6, 2.8],
    shimmer: true,
    chords: [
      [130.8, 196.0, 261.6, 392.0], // C 明亮开放
      [146.8, 220.0, 293.7, 440.0], // D
      [116.5, 174.6, 233.1, 349.2], // Bb 温柔
      [164.8, 246.9, 329.6, 493.8], // E 清冷
    ],
    scale: [587.4, 659.3, 784.0, 880.0, 1046.5, 1174.7], // 明亮五声
  },
  {
    id: 'entropy',
    name: '熵',
    chordDur: 26,
    lp: 900,
    reverbDur: 8.5,
    reverbDecay: 3.6,
    bellGain: 0.38,
    bellRate: [0.5, 1.0],
    shimmer: false,
    chords: [
      [55.0, 82.4, 103.8, 164.8], // A 含小二度（103.8≈Bb）不协和
      [58.3, 87.3, 104.0, 174.6], // B 含小二度
      [49.0, 73.4, 92.4, 146.8], // B 低，小二度
      [65.4, 98.0, 116.5, 196.0], // C 含小二度
    ],
    scale: [293.7, 349.2, 392.0, 440.0, 523.3], // 低沉、压缩
  },
];

function trackById(id) {
  return TRACKS.find((t) => t.id === id) || TRACKS[0];
}

export class CosmicAmbient {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.lp = null;
    this.reverb = null;
    this.wet = null;
    this.dry = null;
    this.playing = false;
    this.muted = false;
    this.volume = 0.45;
    this.trackId = 'void';
    this.cfg = trackById(this.trackId);
    this._schedTimer = null;
    this._nextChord = 0;
    this._chordIndex = 0;
    this._voices = [];
  }

  getTracks() {
    return TRACKS.map((t) => ({ id: t.id, name: t.name }));
  }

  selectTrack(id) {
    this.trackId = id;
    this.cfg = trackById(id);
    if (this.playing) this.start(id); // 立即以新音轨重起
  }

  _ensureContext() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();

    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;

    // 全局低通：把高频削掉，营造「闷而深远」的太空感（音轨可调）
    this.lp = this.ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = this.cfg.lp;
    this.lp.Q.value = 0.4;

    // 长混响：合成脉冲响应（噪声指数衰减），制造浩瀚空间
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this._makeImpulse(this.cfg.reverbDur, this.cfg.reverbDecay);
    this.wet = this.ctx.createGain();
    this.wet.gain.value = 0.6;
    this.dry = this.ctx.createGain();
    this.dry.gain.value = 0.5;

    this.master.connect(this.lp);
    this.lp.connect(this.dry);
    this.dry.connect(this.ctx.destination);
    this.lp.connect(this.reverb);
    this.reverb.connect(this.wet);
    this.wet.connect(this.ctx.destination);
  }

  _makeImpulse(duration, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * duration));
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }

  /** 播放一个缓慢呼吸的和弦铺底，dur 秒后淡出 */
  _playChord(freqs, t0, dur) {
    const ctx = this.ctx;
    const chordGain = ctx.createGain();
    chordGain.gain.value = 0;
    chordGain.connect(this.master);

    const fade = Math.min(2.5, dur * 0.4);
    chordGain.gain.setValueAtTime(0, t0);
    chordGain.gain.linearRampToValueAtTime(0.85, t0 + fade);
    chordGain.gain.setValueAtTime(0.85, t0 + dur - fade);
    chordGain.gain.linearRampToValueAtTime(0, t0 + dur);

    for (const f of freqs) {
      const noteGain = ctx.createGain();
      noteGain.gain.value = 0.11;
      noteGain.connect(chordGain);
      // 两路微失谐锯齿（经全局低通后变柔）
      for (const det of [-5, 5]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = det;
        o.connect(noteGain);
        o.start(t0);
        o.stop(t0 + dur + 2);
      }
      // 极慢呼吸 LFO 调制该音音量
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.04 + Math.random() * 0.05;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.05;
      lfo.connect(lfoGain);
      lfoGain.connect(noteGain.gain);
      lfo.start(t0);
      lfo.stop(t0 + dur + 2);
    }

    // 部分音轨加一层高八度柔光（shimmer），更「星辉」
    if (this.cfg.shimmer) {
      const sh = ctx.createGain();
      sh.gain.value = 0;
      sh.connect(this.master);
      sh.gain.setValueAtTime(0, t0);
      sh.gain.linearRampToValueAtTime(0.05, t0 + fade);
      sh.gain.setValueAtTime(0.05, t0 + dur - fade);
      sh.gain.linearRampToValueAtTime(0, t0 + dur);
      const fo = freqs[freqs.length - 1] * 2;
      const so = ctx.createOscillator();
      so.type = 'triangle';
      so.frequency.value = fo;
      so.connect(sh);
      so.start(t0);
      so.stop(t0 + dur + 2);
    }

    this._voices.push({ gain: chordGain, end: t0 + dur });
  }

  /** 一声空灵钟铃：基频 + 两个泛音，长指数衰减 */
  _bell(freq, t0) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.connect(this.master);
    const decay = 4 + Math.random() * 2.5;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(this.cfg.bellGain, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);

    const partials = [
      { f: freq, a: 1.0 },
      { f: freq * 2.01, a: 0.38 },
      { f: freq * 3.0, a: 0.16 },
    ];
    for (const p of partials) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = p.f;
      const pg = ctx.createGain();
      pg.gain.value = p.a;
      o.connect(pg);
      pg.connect(g);
      o.start(t0);
      o.stop(t0 + decay + 1);
    }
  }

  _scheduler() {
    const ctx = this.ctx;
    if (!ctx) return;
    const cfg = this.cfg;
    const dur = cfg.chordDur;
    const lookahead = 2.5;
    while (this._nextChord < ctx.currentTime + lookahead) {
      const chord = cfg.chords[this._chordIndex % cfg.chords.length];
      this._playChord(chord, this._nextChord, dur);

      // 在此和弦跨度内随机散落若干声钟铃
      const [lo, hi] = cfg.bellRate;
      const n = Math.floor(lo + Math.random() * (hi - lo + 1));
      for (let i = 0; i < n; i++) {
        const base = cfg.scale[Math.floor(Math.random() * cfg.scale.length)];
        const f = Math.random() < 0.32 ? base * 2 : base;
        const tt = this._nextChord + 2 + Math.random() * (dur - 4);
        this._bell(f, tt);
      }

      this._nextChord += dur;
      this._chordIndex++;
    }

    const now = ctx.currentTime;
    if (this._voices.length > 16) {
      this._voices = this._voices.filter((v) => v.end > now - 1);
    }
  }

  /** 开始（或恢复）播放。须在用户手势后调用。 */
  start(trackId) {
    if (trackId && trackId !== this.trackId) this.selectTrack(trackId);
    this._ensureContext();
    // 切换音轨时更新低通 / 混响参数
    if (this.lp) {
      this.lp.frequency.setTargetAtTime(this.cfg.lp, this.ctx.currentTime, 0.6);
      this.reverb.buffer = this._makeImpulse(this.cfg.reverbDur, this.cfg.reverbDecay);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (this.playing) return;
    this.playing = true;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 1.2);
    this._nextChord = this.ctx.currentTime + 0.1;
    this._chordIndex = 0;
    this._scheduler();
    this._schedTimer = setInterval(() => this._scheduler(), 700);
  }

  /** 停止并挂起音频上下文（省电）。 */
  stop() {
    if (!this.playing) return;
    this.playing = false;
    if (this._schedTimer) {
      clearInterval(this._schedTimer);
      this._schedTimer = null;
    }
    if (this.ctx) {
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.8);
      setTimeout(() => {
        if (!this.playing && this.ctx && this.ctx.state === 'running') this.ctx.suspend();
      }, 1600);
    }
  }

  setMuted(m) {
    this.muted = m;
    if (this.ctx) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.4);
    }
  }

  setVolume(v) {
    this.volume = v;
    if (this.ctx && !this.muted) {
      this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.4);
    }
  }
}
