/**
 * 控制面板：预设 / 时间 / 天体参数 / 视觉 / 物理内核 / 守恒诊断 / 导出
 */

import { PRESETS } from '../core/presets.js';
import { BODY_PALETTE } from '../core/constants.js';
import { DriftChart } from './chart.js';

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) node.appendChild(c);
  return node;
}

function fmt(v, span = 3) {
  const a = Math.abs(v);
  if (a === 0) return '0.000';
  if (a < 0.001) return v.toExponential(2);
  if (a < 1) return v.toFixed(4);
  if (a < 10) return v.toFixed(3);
  if (a < 1000) return v.toFixed(2);
  return v.toFixed(1);
}

function section(title, open = true) {
  const d = el('details', { class: 'sect', open: open ? '' : null });
  if (!open) d.removeAttribute('open');
  d.appendChild(el('summary', { text: title }));
  const body = el('div', { class: 'sect-body' });
  d.appendChild(body);
  return { details: d, body };
}

export function createPanel(root, handlers = {}) {
  const h = Object.assign(
    {
      onPreset: () => {},
      onTogglePause: () => {},
      onStep: () => {},
      onReset: () => {},
      onSpeed: () => {},
      onEdit: () => {},
      onToggle: () => {},
      onTrailLength: () => {},
      onTrailOpacity: () => {},
      onBloom: () => {},
      onSoftening: () => {},
      onQuality: () => {},
      onPerturbation: () => {},
      onView: () => {},
      onExportCSV: () => {},
      onScreenshot: () => {},
      onRandomize: () => {},
      onMode: () => {},
      onFps: () => {},
      onMusicToggle: () => {},
      onMusicTrack: () => {},
      onMusicVolume: () => {},
    },
    handlers
  );

  // ── 根结构 ─────────────────────────────────────────────────
  const panel = el('div', { class: 'panel' });
  const head = el('div', { class: 'panel-head' });
  head.appendChild(el('span', { class: 'title', text: 'Control · 控制台' }));
  const collapseBtn = el('button', {
    class: 'btn icon',
    text: '×',
    title: '收起面板 (H)',
    onclick: () => toggleCollapse(),
  });
  head.appendChild(collapseBtn);
  panel.appendChild(head);

  const body = el('div', { class: 'panel-body' });
  panel.appendChild(body);

  const reopen = el('button', { class: 'panel-toggle', text: '☰', title: '展开面板 (H)' });
  reopen.addEventListener('click', () => toggleCollapse());

  const brand = el('div', { class: 'brand' });
  brand.appendChild(el('h1', { text: '三体运动模拟器' }));
  brand.appendChild(el('div', { class: 'sub', text: 'three-body problem · verlet' }));
  const hintBox = el('div', { class: 'hint' });
  brand.appendChild(hintBox);

  const shortcuts = el('div', { class: 'shortcuts' });
  shortcuts.innerHTML = `
    <div><kbd>空格</kbd>暂停 / 继续　<kbd>R</kbd>重置</div>
    <div><kbd>.</kbd>单步　<kbd>H</kbd>面板　<kbd>T</kbd>拖尾</div>
    <div><kbd>G</kbd>网格　<kbd>C</kbd>混沌对照　<kbd>1-9</kbd>预设</div>
    <div><kbd>I</kbd>沉浸观赏　<kbd>M</kbd>音乐　<kbd>Esc</kbd>退出沉浸</div>
    <div>鼠标左键旋转 · 滚轮缩放 · 右键平移</div>
  `;

  const hud = el('div', { class: 'hud' });
  const hudTime = el('span', { html: 't <b>0.00</b>' });
  const hudSep1 = el('span', { class: 'sep' });
  const hudSteps = el('span', { html: '子步 <b>0</b>/帧' });
  const hudSep2 = el('span', { class: 'sep' });
  const hudDt = el('span', { html: 'Δt <b>0</b>' });
  const hudSep3 = el('span', { class: 'sep' });
  const hudFps = el('span', { html: '<b>60</b> fps' });
  const hudSep4 = el('span', { class: 'sep' });
  const hudThrottle = el('span', { html: '', style: 'display:none;color:#ffb454' });
  hud.append(hudTime, hudSep1, hudSteps, hudSep2, hudDt, hudSep3, hudFps, hudSep4, hudThrottle);

  const toast = el('div', { class: 'toast' });

  root.append(brand, shortcuts, hud, panel, reopen, toast);

  function toggleCollapse() {
    panel.classList.toggle('collapsed');
    reopen.classList.toggle('visible', panel.classList.contains('collapsed'));
  }

  let toastTimer = null;
  function showToast(msg, ms = 1800) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), ms);
  }

  // ── 通用控件工厂 ───────────────────────────────────────────
  function sliderRow(label, opts) {
    const { min, max, step, value, onInput, format = (v) => fmt(v, max - min) } = opts;
    const wrap = el('div', { class: 'row' });
    const lab = el('div', { class: 'row-label' });
    lab.appendChild(el('span', { text: label }));
    const val = el('span', { class: 'val', text: format(value) });
    lab.appendChild(val);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);

    const updateFill = () => {
      const p = ((Number(input.value) - min) / (max - min)) * 100;
      input.style.setProperty('--fill', `${p}%`);
    };
    updateFill();

    input.addEventListener('input', () => {
      const v = Number(input.value);
      val.textContent = format(v);
      updateFill();
      onInput(v);
    });

    wrap.append(lab, input);
    return {
      node: wrap,
      input,
      set(v) {
        input.value = String(v);
        val.textContent = format(v);
        updateFill();
      },
      setRange(nmin, nmax, nstep) {
        input.min = String(nmin);
        input.max = String(nmax);
        input.step = String(nstep ?? (nmax - nmin) / 500);
        updateFill();
      },
      get min() {
        return Number(input.min);
      },
      get max() {
        return Number(input.max);
      },
    };
  }

  function toggleRow(label, initial, onChange) {
    const row = el('div', { class: 'toggle-row' + (initial ? ' on' : '') });
    row.appendChild(el('span', { text: label }));
    row.appendChild(el('span', { class: 'switch' }));
    let state = initial;
    row.addEventListener('click', () => {
      state = !state;
      row.classList.toggle('on', state);
      onChange(state);
    });
    return {
      node: row,
      set(v) {
        state = v;
        row.classList.toggle('on', v);
      },
    };
  }

  /** 分段选择行（如模式切换、帧率、音轨） */
  function segmentedRow(label, options, initial, onChange) {
    const wrap = el('div', { class: 'row' });
    const lab = el('div', { class: 'row-label' });
    lab.appendChild(el('span', { text: label }));
    wrap.appendChild(lab);

    const seg = el('div', { class: 'seg' });
    const btnMap = new Map();
    let current = initial;
    options.forEach((opt) => {
      const b = el('button', {
        class: 'seg-btn' + (opt.value === initial ? ' active' : ''),
        text: opt.label,
        title: opt.title || '',
        onclick: () => {
          current = opt.value;
          btnMap.forEach((bb, v) => bb.classList.toggle('active', v === current));
          onChange(opt.value);
        },
      });
      btnMap.set(opt.value, b);
      seg.appendChild(b);
    });
    wrap.appendChild(seg);
    return {
      node: wrap,
      set(v) {
        current = v;
        btnMap.forEach((bb, val) => bb.classList.toggle('active', val === v));
      },
    };
  }

  // ── 0. 宇宙模式 ───────────────────────────────────────────
  const modeRow = segmentedRow(
    '宇宙模式',
    [
      { value: 'threebody', label: '三体问题' },
      { value: 'solar', label: '八大行星' },
    ],
    'threebody',
    (v) => h.onMode(v)
  );
  body.appendChild(modeRow.node);

  // ── 1. 初始构型 ────────────────────────────────────────────
  const secPreset = section('初始构型 · Presets', true);
  const chips = el('div', { class: 'chips' });
  const chipNodes = new Map();
  PRESETS.forEach((p, i) => {
    const chip = el('button', {
      class: 'chip',
      text: `${i + 1}. ${p.name}`,
      title: p.hint,
      onclick: () => h.onPreset(p.id),
    });
    chipNodes.set(p.id, chip);
    chips.appendChild(chip);
  });
  secPreset.body.appendChild(chips);
  const presetNote = el('div', { class: 'chip-note' });
  secPreset.body.appendChild(presetNote);

  const presetExtra = el('div', { class: 'btn-row', style: 'margin-top:8px' });
  const randBtn = el('button', {
    class: 'btn ghost-btn',
    text: '🎲 换一组混沌初值',
    onclick: () => h.onRandomize(),
  });
  presetExtra.appendChild(randBtn);
  secPreset.body.appendChild(presetExtra);

  body.appendChild(secPreset.details);

  // ── 2. 时间 ────────────────────────────────────────────────
  const secTime = section('时间 · Time', true);
  const timeBtns = el('div', { class: 'btn-row' });
  const playBtn = el('button', { class: 'btn primary', text: '⏸ 暂停', onclick: () => h.onTogglePause() });
  const stepBtn = el('button', { class: 'btn icon', text: '⏭', title: '单步 (.)', onclick: () => h.onStep() });
  const resetBtn = el('button', { class: 'btn danger', text: '↺ 重置', onclick: () => h.onReset() });
  timeBtns.append(playBtn, stepBtn, resetBtn);
  secTime.body.appendChild(timeBtns);

  const speedSlider = sliderRow('时间倍率', {
    min: Math.log10(0.05),
    max: Math.log10(8),
    step: 0.01,
    value: 0,
    format: (v) => `${Math.pow(10, v).toFixed(2)}×`,
    onInput: (v) => h.onSpeed(Math.pow(10, v)),
  });
  secTime.body.appendChild(speedSlider.node);

  // 目标帧率（渲染节流；物理仍按真实时间推进）
  const fpsRow = segmentedRow(
    '目标帧率',
    [
      { value: 'unlimited', label: '无限' },
      { value: '90', label: '90' },
      { value: '60', label: '60' },
      { value: '30', label: '30' },
    ],
    'unlimited',
    (v) => h.onFps(v)
  );
  secTime.body.appendChild(fpsRow.node);
  body.appendChild(secTime.details);

  // ── 3. 天体参数 ────────────────────────────────────────────
  const secBodies = section('天体参数 · Mass / r / v', true);
  const bodyCards = [];
  BODY_PALETTE.forEach((pal, i) => {
    const card = el('div', { class: 'body-card' });
    const headRow = el('div', { class: 'head' });
    headRow.appendChild(el('span', { class: 'dot', style: `background:${pal.css};color:${pal.css}` }));
    headRow.appendChild(el('span', { text: pal.label }));
    card.appendChild(headRow);

    // 质量（对数滑块，覆盖 1e-3 ~ 1e4）
    const massS = sliderRow('质量 m', {
      min: -3,
      max: 4,
      step: 0.005,
      value: 0,
      format: (v) => fmt(Math.pow(10, v), 10),
      onInput: (v) => h.onEdit('mass', i, 0, Math.pow(10, v)),
    });
    card.appendChild(massS.node);

    const det = el('details', { class: 'sect' });
    det.appendChild(el('summary', { text: '位置与初速度' }));
    const dbody = el('div', { class: 'sect-body' });
    det.appendChild(dbody);

    const mkVec = (title, kind) => {
      const g = el('div', { class: 'vec-grid' });
      g.appendChild(el('div', { class: 'vec-title', text: title }));
      const arr = [];
      ['x', 'y', 'z'].forEach((axis, k) => {
        arr.push(
          sliderRow(`  ${axis}`, {
            min: -3,
            max: 3,
            step: 0.001,
            value: 0,
            onInput: (v) => h.onEdit(kind, i, k, v),
          })
        );
        g.appendChild(arr[k].node);
      });
      dbody.appendChild(g);
      return arr;
    };

    const posS = mkVec('r 位置', 'position');
    const velS = mkVec('v 初速度', 'velocity');

    card.appendChild(det);
    secBodies.body.appendChild(card);
    bodyCards.push({ mass: massS, pos: posS, vel: velS });
  });
  body.appendChild(secBodies.details);

  // ── 4. 视觉表现 ────────────────────────────────────────────
  const secView = section('视觉 · Visual', false);
  const trailLen = sliderRow('拖尾长度', {
    min: 100,
    max: 8000,
    step: 100,
    value: 2400,
    format: (v) => `${v} 点`,
    onInput: (v) => h.onTrailLength(Math.round(v)),
  });
  const trailOp = sliderRow('拖尾亮度', {
    min: 0,
    max: 1.6,
    step: 0.01,
    value: 0.95,
    format: (v) => v.toFixed(2),
    onInput: (v) => h.onTrailOpacity(v),
  });
  const bloomS = sliderRow('辉光强度', {
    min: 0,
    max: 2.5,
    step: 0.01,
    value: 0.85,
    format: (v) => v.toFixed(2),
    onInput: (v) => h.onBloom(v),
  });
  secView.body.append(trailLen.node, trailOp.node, bloomS.node);

  const tTrail = toggleRow('轨道拖尾', true, (v) => h.onToggle('trails', v));
  const tBloom = toggleRow('泛光 Bloom', true, (v) => h.onToggle('bloom', v));
  const tGrid = toggleRow('参考网格', true, (v) => h.onToggle('grid', v));
  const tStars = toggleRow('星空背景', true, (v) => h.onToggle('stars', v));
  const tFollow = toggleRow('视角跟随天体 α', false, (v) => h.onToggle('followAlpha', v));
  secView.body.append(tTrail.node, tBloom.node, tGrid.node, tStars.node, tFollow.node);

  const viewRow = el('div', { class: 'btn-row', style: 'margin-top:8px' });
  ['默认', '俯视', '侧视', '斜角'].forEach((label, i) => {
    const key = ['default', 'top', 'side', 'oblique'][i];
    viewRow.appendChild(el('button', { class: 'btn ghost-btn', text: label, onclick: () => h.onView(key) }));
  });
  secView.body.appendChild(viewRow);
  body.appendChild(secView.details);

  // ── 5. 物理内核 ────────────────────────────────────────────
  const secPhys = section('物理内核 · Physics', false);
  const softS = sliderRow('引力软化 ε', {
    min: 0,
    max: 0.3,
    step: 0.001,
    value: 0.02,
    format: (v) => v.toFixed(3),
    onInput: (v) => h.onSoftening(v),
  });
  secPhys.body.appendChild(softS.node);

  // 积分精度：滑块值 q ∈ [2,5]，对应 η = 10^(-q)，越往右越精确越慢
  const qualityS = sliderRow('积分精度', {
    min: 2,
    max: 5,
    step: 0.05,
    value: 4,
    format: (v) => `η = 1e-${v.toFixed(1)}`,
    onInput: (v) => h.onQuality(v),
  });
  secPhys.body.appendChild(qualityS.node);

  const tGhost = toggleRow('混沌对照（幽灵宇宙）', false, (v) => h.onToggle('ghost', v));
  secPhys.body.appendChild(tGhost.node);

  const pertS = sliderRow('初始扰动量级', {
    min: -12,
    max: -1,
    step: 0.1,
    value: -9,
    format: (v) => `1e${v.toFixed(1)}`,
    onInput: (v) => h.onPerturbation(Math.pow(10, v)),
  });
  secPhys.body.appendChild(pertS.node);

  const physNote = el('div', {
    class: 'mini',
    html:
      '内核：<b>Velocity Verlet</b>（二阶 · 辛式 · 时间可逆）<br>' +
      '加速度：<b>a = G·Σ m_j·r⃗_ij / (r²+ε²)^{3/2}</b><br>' +
      '步长：<b>自适应</b>，受最近距离与最大速度/加速度约束',
  });
  secPhys.body.appendChild(physNote);
  body.appendChild(secPhys.details);

  // ── 6. 守恒诊断 ────────────────────────────────────────────
  const secDiag = section('守恒诊断 · Diagnostics', true);
  const grid = el('div', { class: 'stat-grid' });
  function stat(key) {
    const s = el('div', { class: 'stat' });
    s.appendChild(el('div', { class: 'k', text: key }));
    const v = el('div', { class: 'v', text: '—' });
    s.appendChild(v);
    grid.appendChild(s);
    return v;
  }
  const vE = stat('总能量 E');
  const vDrift = stat('ΔE / |E₀|');
  const vP = stat('总动量 |P|');
  const vL = stat('角动量 |L|');
  secDiag.body.appendChild(grid);

  const chartWrap = el('div', { class: 'chart-wrap' });
  const canvas = document.createElement('canvas');
  chartWrap.appendChild(canvas);
  secDiag.body.appendChild(chartWrap);
  const legend = el('div', { class: 'legend' });
  legend.innerHTML =
    '<span><i style="background:#57d9a3"></i>能量漂移</span>' +
    '<span><i style="background:#ffc14d"></i>角动量漂移</span>' +
    '<span id="legend-sep" style="display:none"><i style="background:#ff5f4d"></i>幽灵分离</span>';
  secDiag.body.appendChild(legend);
  const legendSep = legend.querySelector('#legend-sep');

  const diagNote = el('div', { class: 'mini' });
  secDiag.body.appendChild(diagNote);
  body.appendChild(secDiag.details);

  const chart = new DriftChart(canvas);

  // ── 6.5 宇宙音景 ──────────────────────────────────────────
  const secSound = section('宇宙音景 · Soundscape', true);
  const tMusic = toggleRow('背景音乐', false, (v) => h.onMusicToggle(v));
  secSound.body.appendChild(tMusic.node);

  const trackRow = segmentedRow(
    '音轨',
    [
      { value: 'void', label: '寂灭' },
      { value: 'stars', label: '远星' },
      { value: 'drift', label: '流浪' },
      { value: 'lunar', label: '广寒' },
      { value: 'entropy', label: '熵' },
    ],
    'void',
    (v) => h.onMusicTrack(v)
  );
  secSound.body.appendChild(trackRow.node);

  const volS = sliderRow('音量', {
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.32,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => h.onMusicVolume(v),
  });
  secSound.body.appendChild(volS.node);

  secSound.body.appendChild(
    el('div', {
      class: 'mini',
      html:
        '全部音轨由 Web Audio 实时合成（无外部文件）：低频呼吸铺底 + 稀疏空灵钟铃 + 长混响。<br>' +
        '切换音轨即时生效，生成式循环、永无接缝。',
    })
  );
  body.appendChild(secSound.details);

  // ── 7. 导出 ────────────────────────────────────────────────
  const secExport = section('导出 · Export', false);
  const expRow = el('div', { class: 'btn-row' });
  expRow.appendChild(el('button', { class: 'btn', text: '轨迹 CSV', onclick: () => h.onExportCSV() }));
  expRow.appendChild(el('button', { class: 'btn', text: '截图 PNG', onclick: () => h.onScreenshot() }));
  secExport.body.appendChild(expRow);
  secExport.body.appendChild(
    el('div', {
      class: 'mini',
      html: 'CSV 列：t, x/y/z（三体）, vx/vy/vz（三体）<br>共 19 列，最多保留最近 3000 帧采样',
    })
  );
  body.appendChild(secExport.details);

  // ── 对外 API ──────────────────────────────────────────────
  const api = {
    showToast,
    toggleCollapse,
    setCollapsed(v) {
      const cur = panel.classList.contains('collapsed');
      if (v !== cur) toggleCollapse();
    },

    setHint(text) {
      hintBox.innerHTML = text;
    },

    setPreset(preset) {
      chipNodes.forEach((n, id) => n.classList.toggle('active', id === preset.id));
      presetNote.textContent = `${preset.name} · ${preset.subtitle} —— ${preset.hint}`;
      randBtn.style.display = preset.randomizable ? '' : 'none';
    },

    setPaused(paused) {
      playBtn.textContent = paused ? '▶ 继续' : '⏸ 暂停';
      playBtn.classList.toggle('primary', !paused);
    },

    setSpeed(v) {
      speedSlider.set(Math.log10(v));
    },

    setSoftening(v) {
      softS.set(v);
    },

    /** 外部（如快捷键）切换模式时，同步分段控件 */
    setMode(v) {
      modeRow.set(v);
    },

    setMusicPlaying(v) {
      tMusic.set(v);
    },

    setMusicTrack(v) {
      trackRow.set(v);
    },

    /** 把当前初始条件同步回所有滑块（载入预设或重置后调用） */
    syncBodies(bodies) {
      bodies.forEach((b, i) => {
        const card = bodyCards[i];
        card.mass.set(Math.log10(Math.max(b.mass, 1e-6)));
        const posSpan = Math.max(2.5, ...b.position.map((v) => Math.abs(v) * 1.8));
        const velSpan = Math.max(2.0, ...b.velocity.map((v) => Math.abs(v) * 1.8));
        for (let k = 0; k < 3; k++) {
          card.pos[k].setRange(-posSpan, posSpan, posSpan / 1000);
          card.pos[k].set(b.position[k]);
          card.vel[k].setRange(-velSpan, velSpan, velSpan / 1000);
          card.vel[k].set(b.velocity[k]);
        }
      });
    },

    setToggle(key, value) {
      const map = { trails: tTrail, bloom: tBloom, grid: tGrid, stars: tStars, followAlpha: tFollow, ghost: tGhost };
      if (map[key]) map[key].set(value);
      if (key === 'ghost') legendSep.style.display = value ? '' : 'none';
    },

    setGhostEnabled(v) {
      api.setToggle('ghost', v);
    },

    /** 每帧刷新读数 */
    update(frame) {
      hudTime.innerHTML = `t <b>${frame.time.toFixed(2)}</b>`;
      hudSteps.innerHTML = `子步 <b>${frame.substeps}</b>/帧`;
      hudDt.innerHTML = `Δt <b>${frame.dt.toExponential(1)}</b>`;
      hudFps.innerHTML = `<b>${Math.round(frame.fps)}</b> fps`;

      // 近距离飞越时积分器会主动降速以保精度，这里如实告知
      const th = frame.throttle ?? 1;
      if (th < 0.95) {
        hudThrottle.style.display = '';
        hudSep4.style.display = '';
        hudThrottle.innerHTML = `⚠ 近距飞越降速 ×${th.toFixed(2)}`;
      } else {
        hudThrottle.style.display = 'none';
        hudSep4.style.display = 'none';
      }

      const d = frame.diag;
      vE.textContent = fmt(d.E, 10);
      const driftPct = frame.drift * 100;
      vDrift.textContent = driftPct < 0.001 ? `${driftPct.toExponential(2)}%` : `${driftPct.toFixed(4)}%`;
      vDrift.className = 'v ' + (driftPct < 0.05 ? 'good' : driftPct < 1 ? 'warn' : 'bad');
      vP.textContent = d.pNorm.toExponential(2);
      vP.className = 'v ' + (d.pNorm < 1e-6 ? 'good' : 'warn');
      vL.textContent = fmt(d.lNorm, 10);

      diagNote.innerHTML =
        `动能 T <b>${fmt(d.kinetic, 10)}</b>　势能 U <b>${fmt(d.potential, 10)}</b><br>` +
        `质心漂移 <b>${Math.hypot(...d.com).toExponential(2)}</b>　` +
        `峰值漂移 <b>${(frame.maxDrift * 100).toFixed(4)}%</b>` +
        (frame.ghost ? `<br>幽灵分离 <b>${fmt(frame.separation, 1)}</b>（峰值 ${fmt(frame.maxSeparation, 1)}）` : '');

      chart.draw(frame.history, { ghost: frame.ghost });
    },
  };

  return api;
}
