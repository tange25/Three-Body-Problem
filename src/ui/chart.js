/**
 * 守恒诊断曲线（对数纵轴）
 * history 每行：[t, 能量相对漂移, |P|, 角动量相对漂移, 幽灵分离距离]
 */

const LOG_MIN = -12; // 1e-12
const LOG_MAX = 1; // 1e1

export class DriftChart {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio, 2);
  }

  _resize() {
    const w = this.canvas.clientWidth || 300;
    const h = this.canvas.clientHeight || 96;
    const tw = Math.round(w * this.dpr);
    const th = Math.round(h * this.dpr);
    if (this.canvas.width !== tw || this.canvas.height !== th) {
      this.canvas.width = tw;
      this.canvas.height = th;
    }
    return { w, h };
  }

  /**
   * @param {object} history RingLog(stride=5)
   * @param {object} opts { ghost:boolean }
   */
  draw(history, opts = {}) {
    const { w, h } = this._resize();
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const padL = 4;
    const padR = 4;
    const padT = 6;
    const padB = 4;
    const iw = w - padL - padR;
    const ih = h - padT - padB;

    // 背景
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 0, w, h);

    const toY = (v) => {
      if (!(v > 0)) v = 1e-14;
      const lv = Math.log10(v);
      const t = (Math.min(Math.max(lv, LOG_MIN), LOG_MAX) - LOG_MIN) / (LOG_MAX - LOG_MIN);
      return padT + ih * (1 - t);
    };

    // 十进制网格
    ctx.strokeStyle = 'rgba(120,165,255,0.10)';
    ctx.fillStyle = 'rgba(139,155,189,0.55)';
    ctx.font = '8px monospace';
    ctx.lineWidth = 1;
    for (let e = LOG_MIN; e <= LOG_MAX; e += 1) {
      const y = toY(Math.pow(10, e));
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
      if ((e - LOG_MIN) % 4 === 0) {
        ctx.fillText(`1e${e}`, padL + 2, y - 1);
      }
    }

    if (!history || history.count < 2) {
      ctx.fillStyle = 'rgba(139,155,189,0.6)';
      ctx.font = '10px monospace';
      ctx.fillText('采样中…', padL + 6, padT + 12);
      return;
    }

    const n = history.count;
    const toX = (i) => padL + (iw * i) / (n - 1);


    const series = [
      { col: 1, color: '#57d9a3', width: 1.6 },
      { col: 3, color: '#ffc14d', width: 1.1 },
    ];
    if (opts.ghost) series.push({ col: 4, color: '#ff5f4d', width: 1.4 });

    // 直接按环形索引取值，避免每帧产生上千个 subarray 临时对象
    for (const s of series) {
      ctx.beginPath();
      let started = false;
      for (let k = 0; k < n; k++) {
        const v = history.read(k, s.col);
        if (!isFinite(v)) continue;
        const x = toX(k);
        const y = toY(Math.max(v, 1e-13));
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.globalAlpha = 0.9;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // 当前值点
    for (const s of series) {
      const y = toY(Math.max(history.read(n - 1, s.col), 1e-13));
      ctx.beginPath();
      ctx.arc(padL + iw, y, 2, 0, Math.PI * 2);
      ctx.fillStyle = s.color;
      ctx.fill();
    }
  }
}
