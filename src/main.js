/**
 * 三体运动模拟器 · 入口
 *
 * 装配：物理世界（World）↔ 渲染舞台（Stage / Environment / BodyView / Trail）↔ 控制台（Panel）
 */

import './styles.css';

import * as THREE from 'three';
import { Stage } from './render/scene.js';
import { Environment } from './render/environment.js';
import { BodyView } from './render/bodies.js';
import { Trail } from './render/trails.js';
import { World } from './core/world.js';
import { materializePreset, PRESETS } from './core/presets.js';
import { PHYSICS_DEFAULTS, RENDER_DEFAULTS, BODY_PALETTE } from './core/constants.js';
import { createPanel } from './ui/panel.js';
import { CosmicAmbient } from './audio/cosmic-ambient.js';
import { buildTraceCSV, downloadText, downloadDataURL, timestampName } from './utils/exporter.js';

// ── 启动遮罩 ─────────────────────────────────────────────────
const boot = document.createElement('div');
boot.className = 'boot';
boot.innerHTML = '<div class="ring"></div><div>INITIALIZING THREE-BODY UNIVERSE</div>';
document.body.appendChild(boot);

// ── 舞台 ─────────────────────────────────────────────────────
/** 兜底：万一宿主页面没准备好对应的挂载点，就地创建 */
function ensureRoot(id) {
  let node = document.getElementById(id);
  if (!node) {
    node = document.createElement('div');
    node.id = id;
    document.body.appendChild(node);
  }
  return node;
}
const sceneRoot = ensureRoot('scene-root');
const uiRoot = ensureRoot('ui-root');

const stage = new Stage(sceneRoot);
const env = new Environment(stage.scene);
const world = new World();

const opts = {
  softening: PHYSICS_DEFAULTS.softening,
  maxSubsteps: PHYSICS_DEFAULTS.maxSubsteps,
  etaVelocity: PHYSICS_DEFAULTS.etaVelocity,
  etaAcceleration: PHYSICS_DEFAULTS.etaAcceleration,
  dtMin: PHYSICS_DEFAULTS.dtMin,
  dtMax: PHYSICS_DEFAULTS.dtMax,
  minSeparationFloor: PHYSICS_DEFAULTS.minSeparationFloor,
};

const view = {
  trails: RENDER_DEFAULTS.showTrails,
  bloom: RENDER_DEFAULTS.showBloom,
  grid: RENDER_DEFAULTS.showGrid,
  stars: RENDER_DEFAULTS.showStars,
  followAlpha: RENDER_DEFAULTS.followAlpha,
  ghost: false,
};

let bloomStrength = RENDER_DEFAULTS.bloomStrength;
let bloomRadius = RENDER_DEFAULTS.bloomRadius;
let bloomThreshold = RENDER_DEFAULTS.bloomThreshold;
let trailCapacity = RENDER_DEFAULTS.trailCapacity;
let trailOpacity = RENDER_DEFAULTS.trailOpacity;

let timeScale = 1.0;
let paused = false;
let stepOnce = false;
let sceneRadius = 3;
let currentPresetId = 'figure8';

// ── 天体与拖尾 ───────────────────────────────────────────────
const bodyViews = BODY_PALETTE.map((p) => new BodyView({ color: p.color }));
const ghostViews = BODY_PALETTE.map((p) => new BodyView({ color: p.color, ghost: true }));
const trails = BODY_PALETTE.map(
  (p) => new Trail({ capacity: trailCapacity, color: p.color, opacity: trailOpacity })
);
const ghostTrails = BODY_PALETTE.map(
  (p) => new Trail({ capacity: trailCapacity, color: p.color, opacity: trailOpacity * 0.4, fadePower: 1.1 })
);

bodyViews.forEach((b) => stage.scene.add(b.group));
ghostViews.forEach((b) => {
  b.setVisible(false);
  stage.scene.add(b.group);
});
trails.forEach((t) => {
  t.line.visible = view.trails;
  stage.scene.add(t.line);
});
ghostTrails.forEach((t) => {
  t.line.visible = false;
  stage.scene.add(t.line);
});

function clearTrails() {
  trails.forEach((t) => t.clear());
  ghostTrails.forEach((t) => t.clear());
}

function resizeTrails(capacity) {
  trails.forEach((t) => t.resize(capacity));
  ghostTrails.forEach((t) => t.resize(capacity));
}

function sampleTrails() {
  const p = world.main.state.pos;
  for (let i = 0; i < 3; i++) trails[i].push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
  if (view.ghost) {
    const g = world.ghost.state.pos;
    for (let i = 0; i < 3; i++) ghostTrails[i].push(g[i * 3], g[i * 3 + 1], g[i * 3 + 2]);
  }
}

// ── 控制台 ───────────────────────────────────────────────────
const panel = createPanel(uiRoot, {
  onPreset: (id) => loadPreset(id),
  onTogglePause: () => {
    paused = !paused;
    panel.setPaused(paused);
  },
  onStep: () => {
    stepOnce = true;
    paused = true;
    panel.setPaused(true);
  },
  onReset: () => {
    world.reset(opts.softening);
    clearTrails();
    panel.syncBodies(world.initial);
    panel.showToast('已重置到当前初始条件');
  },
  onSpeed: (v) => {
    timeScale = v;
  },
  onEdit: (kind, index, axis, value) => {
    const needClear = world.editInitial(kind, index, axis, value, opts.softening);
    if (needClear) clearTrails();
  },
  onToggle: (key, value) => {
    view[key] = value;
    if (key === 'trails') {
      trails.forEach((t) => (t.line.visible = value));
      ghostTrails.forEach((t) => (t.line.visible = value && view.ghost));
    } else if (key === 'bloom') {
      stage.setBloom(value, bloomStrength, bloomRadius, bloomThreshold);
    } else if (key === 'grid') {
      env.setGridVisible(value);
    } else if (key === 'stars') {
      env.setStarsVisible(value);
    } else if (key === 'followAlpha') {
      followAnchor = null;
    } else if (key === 'ghost') {
      world.ghostEnabled = value;
      ghostTrails.forEach((t) => {
        t.clear();
        t.line.visible = value && view.trails;
      });
      ghostViews.forEach((g) => g.setVisible(value));
      if (value) {
        world.syncGhost(opts.softening);
        panel.showToast('幽灵宇宙已生成：初始扰动 1e' + Math.log10(world.perturbation).toFixed(0));
      }
    }
  },
  onTrailLength: (v) => {
    trailCapacity = v;
    resizeTrails(v);
  },
  onTrailOpacity: (v) => {
    trailOpacity = v;
    trails.forEach((t) => t.setOpacity(v));
    ghostTrails.forEach((t) => t.setOpacity(v * 0.4));
  },
  onBloom: (v) => {
    bloomStrength = v;
    stage.setBloom(view.bloom, bloomStrength, bloomRadius, bloomThreshold);
  },
  onSoftening: (v) => {
    opts.softening = v;
    world.main.softening = v;
    world.ghost.softening = v;
    world.refreshAccelerations();
    world.main.rebaseline();
    world.ghost.rebaseline();
    world.history.clear();
    world.maxDrift = 0;
  },
  onQuality: (q) => {
    const eta = Math.pow(10, -q);
    opts.etaVelocity = eta;
    opts.etaAcceleration = eta * 5;
  },
  onPerturbation: (v) => {
    world.perturbation = v;
    world.syncGhost(opts.softening);
    ghostTrails.forEach((t) => t.clear());
  },
  onView: (name) => stage.setView(name, sceneRadius),
  onExportCSV: () => {
    if (world.trace.count === 0) {
      panel.showToast('暂无轨迹数据');
      return;
    }
    downloadText(timestampName('three-body-trace', 'csv'), buildTraceCSV(world));
    panel.showToast(`已导出 ${world.trace.count} 帧轨迹`);
  },
  onScreenshot: () => {
    stage.render();
    const url = stage.renderer.domElement.toDataURL('image/png');
    downloadDataURL(timestampName('three-body', 'png'), url);
    panel.showToast('画面已保存');
  },
  onRandomize: () => loadPreset('chaos', { seed: Math.floor(Math.random() * 1e9) }),
});

// ── 沉浸观赏模式 + 程序化背景音乐 ───────────────────────────
const audio = new CosmicAmbient();
let immersive = false;
let userWantsMusic = false;
let immersiveAutoMusic = false;
let revealTimer = null;

// 常驻控制簇（沉浸模式下随鼠标唤醒、闲置淡出）
const controlsEl = document.createElement('div');
controlsEl.className = 'immersive-controls';
const btnImmerse = document.createElement('button');
btnImmerse.className = 'ibtn';
btnImmerse.textContent = '⛶ 沉浸观赏';
btnImmerse.title = '沉浸观赏模式 (I)';
btnImmerse.addEventListener('click', toggleImmersive);
const btnMusic = document.createElement('button');
btnMusic.className = 'ibtn';
btnMusic.textContent = '♪ 音乐 关';
btnMusic.title = '背景音乐 开关 (M)';
btnMusic.addEventListener('click', toggleMusic);
const btnFull = document.createElement('button');
btnFull.className = 'ibtn';
btnFull.textContent = '⤢ 全屏';
btnFull.title = '全屏切换';
btnFull.addEventListener('click', toggleFullscreen);
controlsEl.append(btnImmerse, btnMusic, btnFull);
uiRoot.appendChild(controlsEl);

// 进入沉浸时短暂浮现的提示语
const hintEl = document.createElement('div');
hintEl.className = 'immersive-hint';
hintEl.innerHTML = '沉浸模式 · 仅余宇宙<br>移动鼠标唤醒控制　·　Esc 退出　·　M 切换音乐';
uiRoot.appendChild(hintEl);

function updateMusicBtn() {
  const on = audio.playing && !audio.muted;
  btnMusic.textContent = on ? '♪ 音乐 开' : '♪ 音乐 关';
  btnMusic.classList.toggle('off', !on);
}

function toggleMusic() {
  userWantsMusic = !userWantsMusic;
  immersiveAutoMusic = false;
  if (userWantsMusic) audio.start();
  else audio.stop();
  updateMusicBtn();
}

function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  } catch (_) {
    /* 不支持的环境静默忽略 */
  }
}

function revealControls() {
  if (!immersive) return;
  controlsEl.classList.add('reveal');
  clearTimeout(revealTimer);
  revealTimer = setTimeout(() => controlsEl.classList.remove('reveal'), 2600);
}

function showHint() {
  hintEl.classList.add('show');
  setTimeout(() => hintEl.classList.remove('show'), 4200);
}

function enterImmersive() {
  if (immersive) return;
  immersive = true;
  document.body.classList.add('immersive');
  stage.controls.autoRotate = true; // 相机缓慢自转，营造观赏感
  stage.controls.autoRotateSpeed = 0.32;
  // 隐藏分析性叠层，只留核心画面（天体 + 拖尾 + 星空 / 星云）
  env.setGridVisible(false);
  env.setComVisible(false);
  if (view.bloom) stage.setBloom(true, Math.min(1.6, bloomStrength + 0.18), bloomRadius, bloomThreshold);
  // 进入即起乐（除非用户此前主动关掉）
  if (!userWantsMusic && !audio.playing) {
    audio.start();
    immersiveAutoMusic = true;
  }
  btnImmerse.textContent = '⤢ 退出沉浸';
  btnImmerse.title = '退出沉浸 (Esc)';
  showHint();
  revealControls();
}

function exitImmersive() {
  if (!immersive) return;
  immersive = false;
  document.body.classList.remove('immersive');
  stage.controls.autoRotate = false;
  env.setGridVisible(view.grid);
  env.setComVisible(true);
  if (view.bloom) stage.setBloom(true, bloomStrength, bloomRadius, bloomThreshold);
  if (immersiveAutoMusic && audio.playing) {
    audio.stop();
    immersiveAutoMusic = false;
  }
  btnImmerse.textContent = '⛶ 沉浸观赏';
  btnImmerse.title = '沉浸观赏模式 (I)';
  controlsEl.classList.remove('reveal');
}

function toggleImmersive() {
  if (immersive) exitImmersive();
  else enterImmersive();
}

window.addEventListener('mousemove', revealControls);

// ── 载入预设 ─────────────────────────────────────────────────
function loadPreset(id, presetOpts = {}) {
  const preset = materializePreset(id, presetOpts);
  currentPresetId = preset.id;

  // 每个预设自带合适的软化因子（周期解 ε=0，混沌场景 ε>0 兜底）
  opts.softening = preset.softening;
  world.load(preset.bodies, opts.softening);

  timeScale = preset.timeScale;
  panel.setPreset(preset);
  panel.setSpeed(timeScale);
  panel.setSoftening(opts.softening);
  panel.syncBodies(world.initial);

  clearTrails();
  syncBodyViews();
  sampleTrails();

  // 自动取景
  let maxR = 0;
  for (const b of preset.bodies) {
    for (const v of b.position) maxR = Math.max(maxR, Math.abs(v));
  }
  sceneRadius = Math.max(maxR * 1.4, 1.2);
  env.setScale(sceneRadius);
  stage.frameRadius(sceneRadius);

  panel.setHint(
    `当前：<b>${preset.name}</b>　${preset.hint}<br>` +
      `拖动右侧滑块可实时改写质量 / 位置 / 初速度；勾选「混沌对照」看初值敏感性。`
  );
}

function syncBodyViews() {
  const s = world.main.state;
  for (let i = 0; i < 3; i++) {
    bodyViews[i].setMass(s.mass[i]);
    bodyViews[i].setPosition(s.pos[i * 3], s.pos[i * 3 + 1], s.pos[i * 3 + 2]);
  }
  if (view.ghost) {
    const g = world.ghost.state;
    for (let i = 0; i < 3; i++) {
      ghostViews[i].setMass(g.mass[i]);
      ghostViews[i].setPosition(g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2]);
    }
  }
}

// ── 键盘快捷键 ───────────────────────────────────────────────
window.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;

  const k = e.key.toLowerCase();
  if (k === ' ' || e.code === 'Space') {
    e.preventDefault();
    paused = !paused;
    panel.setPaused(paused);
  } else if (e.key === 'Escape') {
    exitImmersive();
  } else if (k === 'i') {
    toggleImmersive();
  } else if (k === 'm') {
    toggleMusic();
  } else if (k === 'r') {
    world.reset(opts.softening);
    clearTrails();
    panel.syncBodies(world.initial);
    panel.showToast('已重置');
  } else if (k === '.') {
    stepOnce = true;
    paused = true;
    panel.setPaused(true);
  } else if (k === 'h') {
    panel.toggleCollapse();
  } else if (k === 't') {
    panel.setToggle('trails', !view.trails);
    view.trails = !view.trails;
    trails.forEach((t) => (t.line.visible = view.trails));
    ghostTrails.forEach((t) => (t.line.visible = view.trails && view.ghost));
  } else if (k === 'g') {
    view.grid = !view.grid;
    env.setGridVisible(view.grid);
    panel.setToggle('grid', view.grid);
  } else if (k === 'c') {
    const v = !view.ghost;
    panel.setToggle('ghost', v);
    view.ghost = v;
    world.ghostEnabled = v;
    ghostTrails.forEach((t) => {
      t.clear();
      t.line.visible = v && view.trails;
    });
    ghostViews.forEach((g) => g.setVisible(v));
    if (v) world.syncGhost(opts.softening);
  } else if (k >= '1' && k <= '9') {
    const idx = Number(k) - 1;
    if (idx < PRESETS.length) loadPreset(PRESETS[idx].id);
  }
});

// ── 主循环 ───────────────────────────────────────────────────
let lastTime = performance.now();
let fps = 60;
let lastDrift = 0;
let lastThrottle = 1;
let followAnchor = null;
const tmpVec = new THREE.Vector3();

function tick(now) {
  requestAnimationFrame(tick);

  const rawDt = (now - lastTime) / 1000;
  lastTime = now;
  const dtReal = Math.min(Math.max(rawDt, 1e-5), 1 / 25);
  fps = fps * 0.9 + (1 / dtReal) * 0.1;

  let advance = 0;
  if (paused) {
    if (stepOnce) {
      advance = (1 / 60) * timeScale;
      stepOnce = false;
    }
  } else {
    advance = dtReal * timeScale;
  }

  if (advance > 0) {
    const r = world.step(advance, opts, sampleTrails);
    lastDrift = r.drift;
    lastThrottle = r.throttle;
    trails.forEach((t) => t.commit());
    ghostTrails.forEach((t) => t.commit());
  }

  syncBodyViews();
  env.update(dtReal);
  env.faceCamera(stage.camera);

  // 质心标记
  const d = world.peek();
  env.setComPosition(d.com[0], d.com[1], d.com[2]);

  // 视角跟随天体 α
  if (view.followAlpha) {
    const cur = tmpVec.set(world.main.state.pos[0], world.main.state.pos[1], world.main.state.pos[2]);
    if (followAnchor) {
      const delta = cur.clone().sub(followAnchor);
      stage.controls.target.add(delta);
      stage.camera.position.add(delta);
    } else {
      followAnchor = cur.clone();
    }
    followAnchor.copy(cur);
  } else {
    followAnchor = null;
  }

  stage.render();

  panel.update({
    time: world.main.state.time,
    substeps: world.stats.substeps,
    dt: world.stats.dt,
    fps,
    diag: d,
    drift: lastDrift,
    throttle: lastThrottle,
    maxDrift: world.maxDrift,
    separation: world.separation,
    maxSeparation: world.maxSeparation,
    ghost: view.ghost,
    history: world.history,
  });
}

// ── 启动 ─────────────────────────────────────────────────────
loadPreset('figure8');
stage.setBloom(view.bloom, bloomStrength, bloomRadius, bloomThreshold);
panel.setPaused(false);
requestAnimationFrame(tick);

requestAnimationFrame(() => {
  boot.classList.add('hide');
  setTimeout(() => boot.remove(), 600);
});

// 调试入口（便于在控制台里把玩）
window.__threeBody = { world, stage, env, panel, loadPreset, view, opts };
