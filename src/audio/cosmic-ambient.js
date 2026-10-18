/**
 * Cosmic Ambient · 程序化生成的宇宙氛围背景音乐
 * --------------------------------------------------------------------------
 * 不依赖任何外部音频文件，全部由 Web Audio API 实时合成，便于打包成单文件离线运行。
 *
 * 设计意图：宇宙般的「凄凉 · 广阔 · 孤独」
 *   - 低频开放和弦铺底（drone），两个微失谐振荡器叠加取暖，经低通 + 长混响营造「深远」
 *   - 缓慢呼吸（LFO 调制音量）让铺底像在「活着」地起伏
 *   - 稀疏的钟铃泛音（bell），在五声音阶上随机散落，空灵、辽远、孤独
 *   - 和弦每 ~20s 极慢切换，整体无明确终止，生成式循环、永无接缝
 *
 * 浏览器自动播放策略：AudioContext 必须在用户手势后创建 / 恢复，
 * 因此 start() 只在点击 / 按键触发的回调里被调用。
 */

// 低频开放和弦进行（空、暗、广阔）：根音约在 F1–A1
const CHORDS = [
  [55.0, 82.41, 110.0, 164.81], // A 开放五度（极空的孤独感）
  [73.42, 110.0, 146.83, 174.61], // D 小调色彩
  [43.65, 65.41, 87.31, 130.81], // F 开放铺底
  [82.41, 123.47, 164.81, 196.0], // E 小调
];

// 高空灵五声音阶（A C D E G 跨两个八度），用于钟铃
const PENTATONIC = [
  220.0, 261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25,
];

const CHORD_DURATION = 20; // 秒，极慢

export class CosmicAmbient {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.lp = null;
    this.reverb = null;
    this.playing = false;
    this.muted = false;
    this.volume = 0.3;
    this._schedTimer = null;
    this._nextChord = 0;
    this._chordIndex = 0;
    this._voices = [];
  }

  _ensureContext() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();

    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;

    // 全局低通：把高频削掉，营造「闷而深远」的太空感
    this.lp = this.ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 1700;
    this.lp.Q.value = 0.5;

    // 长混响：合成脉冲响应（噪声指数衰减），制造浩瀚空间
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this._makeImpulse(7.0, 3.0);
    this.wet = this.ctx.createGain();
    this.wet.gain.value = 0.62;
    this.dry = this.ctx.createGain();
    this.dry.gain.value = 0.5;

    // 链路：master → lp → (dry → dest) 与 (reverb → wet → dest)
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

    const fade = Math.min(6, dur * 0.4);
    chordGain.gain.setValueAtTime(0, t0);
    chordGain.gain.linearRampToValueAtTime(0.9, t0 + fade);
    chordGain.gain.setValueAtTime(0.9, t0 + dur - fade);
    chordGain.gain.linearRampToValueAtTime(0, t0 + dur);

    for (const f of freqs) {
      const noteGain = ctx.createGain();
      noteGain.gain.value = 0.13;
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

    this._voices.push({ gain: chordGain, end: t0 + dur });
  }

  /** 一声空灵钟铃：基频 + 两个泛音，长指数衰减 */
  _bell(freq, t0) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.connect(this.master);
    const decay = 4 + Math.random() * 2.5;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.5, t0 + 0.02);
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
    const lookahead = 2.5;
    while (this._nextChord < ctx.currentTime + lookahead) {
      const chord = CHORDS[this._chordIndex % CHORDS.length];
      this._playChord(chord, this._nextChord, CHORD_DURATION);

      // 在此和弦跨度内随机散落 1–2 声钟铃
      const n = 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < n; i++) {
        const base = PENTATONIC[Math.floor(Math.random() * PENTATONIC.length)];
        const f = Math.random() < 0.35 ? base * 2 : base; // 偶尔更亮
        const tt = this._nextChord + 2 + Math.random() * (CHORD_DURATION - 4);
        this._bell(f, tt);
      }

      this._nextChord += CHORD_DURATION;
      this._chordIndex++;
    }

    // 清理已结束的和弦引用
    const now = ctx.currentTime;
    if (this._voices.length > 16) {
      this._voices = this._voices.filter((v) => v.end > now - 1);
    }
  }

  /** 开始（或恢复）播放。须在用户手势后调用。 */
  start() {
    this._ensureContext();
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
