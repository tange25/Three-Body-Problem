/**
 * 三体运动模拟器 · 入口
 *
 * 装配：物理世界（World）↔ 渲染舞台（Stage / Environment / BodyView / Trail）↔ 控制台（Panel）
 *
 * 本次新增：
 *   - 宇宙模式切换（三体问题 / 八大行星）
 *   - 点击天体 → 相机平滑聚焦 + 信息面板（实时属性 + 文字介绍）
 *   - 多音轨宇宙氛围乐（程序化生成、可循环、可切换）
 *   - 目标帧率控制（渲染节流，物理仍按真实时间推进）
 */

import './styles.css';

import * as THREE from 'three';
import { Stage } from './render/scene.js';
import { Environment } from './render/environment.js';
import { BodyView, radiusFromMass } from './render/bodies.js';
import { Trail } from './render/trails.js';
import { SolarSystem } from './render/solar-system.js';
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
const solar = new SolarSystem(stage.scene);

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
let currentMode = 'threebody';
let targetFps = 'unlimited';

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

// 三体天体的「信息面板」数据（点击拾取用）
const THREE_BODY_DESC = [
  '三体世界的第一颗恒星，炽烈如血。在「三日凌空」的浩劫里，它往往是最先灼烤大地的那一个——红日当空，生灵涂炭。',
  '三体世界的第二颗恒星，清冷幽蓝。它行踪飘忽，轨道难以捉摸，常与另外两颗恒星上演混沌的引力之舞。',
  '三体世界的第三颗恒星，温润如金。它不像前两者那般暴烈，却同样身陷那场永无规律的三体乱局之中。',
];
bodyViews.forEach((b, i) => {
  b.mesh.userData.info = {
    name: BODY_PALETTE[i].label,
    subtitle: '三体恒星',
    color: BODY_PALETTE[i].color,
    radius: b.radius,
    desc: THREE_BODY_DESC[i],
    staticRows: [['类型', '三体恒星'], ['编号', BODY_PALETTE[i].label]],
    getPos: () => {
      const s = world.main.state;
      return new THREE.Vector3(s.pos[i * 3], s.pos[i * 3 + 1], s.pos[i * 3 + 2]);
    },
    live: () => {
      const s = world.main.state;
      const x = s.pos[i * 3], y = s.pos[i * 3 + 1], z = s.pos[i * 3 + 2];
      const vx = s.vel[i * 3], vy = s.vel[i * 3 + 1], vz = s.vel[i * 3 + 2];
      const m = s.mass[i];
      const f = (v) => (Math.abs(v) < 0.001 ? v.toExponential(2) : v.toFixed(3));
      return [
        ['质量 m', f(m)],
        ['视觉半径', radiusFromMass(m).toFixed(3)],
        ['位置 (x, y, z)', `${f(x)}, ${f(y)}, ${f(z)}`],
        ['速度 (vx, vy, vz)', `${f(vx)}, ${f(vy)}, ${f(vz)}`],
        ['速率 |v|', Math.hypot(vx, vy, vz).toFixed(3)],
      ];
    },
  };
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

// ── 拾取目标集合（随模式切换）───────────────────────────────
let pickables = bodyViews.map((b) => b.mesh);

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
    // 天体跳回初始点的瞬间，若留着旧锚点会把相机一起甩飞
    followAnchor = null;
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
      if (currentMode === 'threebody') env.setGridVisible(value);
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
  onMode: (m) => setMode(m),
  onFps: (v) => {
    targetFps = v;
  },
  onMusicToggle: (v) => setMusicPlaying(v),
  onMusicTrack: (id) => selectTrack(id),
  onMusicVolume: (v) => audio.setVolume(v),
});

// ── 沉浸观赏模式 + 程序化背景音乐 ───────────────────────────
const audio = new CosmicAmbient();
let immersive = false;
let userWantsMusic = false;
let immersiveAutoMusic = false;
let revealTimer = null;
let musicAutoStarted = false;
let currentTrack = 'void'; // 当前音轨（与 CosmicAmbient 默认音轨一致）

// 首次用户手势后自动起乐：浏览器的自动播放策略要求 AudioContext 必须在
// 用户手势（点击 / 按键）内创建或 resume，因此不能在页面加载时直接播。
// 用户打开网页后的第一次点击或按键（非控制簇按钮）即触发背景音乐。
function firstGestureAutoMusic(e) {
  if (musicAutoStarted || audio.playing || userWantsMusic) return;
  const t = e.target;
  // 让右上控制簇的按钮（沉浸 / 音乐 / 全屏）自行决定，不在此拦截
  if (t && t.closest && t.closest('.immersive-controls')) return;
  musicAutoStarted = true;
  setMusicPlaying(true);
}
window.addEventListener('pointerdown', firstGestureAutoMusic, true);
window.addEventListener('keydown', firstGestureAutoMusic, true);

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
btnMusic.addEventListener('click', () => setMusicPlaying(!userWantsMusic));
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

// ── 天体信息面板（点击拾取后弹出）──────────────────────────
const infoCard = document.createElement('div');
infoCard.className = 'info-card';
infoCard.style.display = 'none';
uiRoot.appendChild(infoCard);
let infoLive = null; // 当前信息对象的 live() 函数

function buildInfoCard(info) {
  infoLive = info.live || null;
  const f = (v) => (Math.abs(v) < 0.001 ? v.toExponential(2) : v.toFixed(3));
  const rows = (info.staticRows || []).map(([k, v]) => `<div class="ic-row"><span>${k}</span><b>${v}</b></div>`).join('');
  infoCard.innerHTML = `
    <div class="ic-head">
      <span class="ic-dot" style="background:${'#' + new THREE.Color(info.color).getHexString()};box-shadow:0 0 12px #${new THREE.Color(info.color).getHexString()}"></span>
      <div class="ic-titles">
        <div class="ic-title">${info.name}</div>
        <div class="ic-sub">${info.subtitle}</div>
      </div>
      <button class="ic-close" title="关闭 / 解除聚焦">✕</button>
    </div>
    <div class="ic-desc">${info.desc}</div>
    <div class="ic-facts">${rows}</div>
    <div class="ic-live"></div>
  `;
  infoCard.querySelector('.ic-close').addEventListener('click', () => {
    infoCard.style.display = 'none';
    clearFocus();
  });
}

function updateInfoCardLive() {
  if (infoCard.style.display === 'none' || !infoLive) return;
  const rows = infoLive();
  const liveEl = infoCard.querySelector('.ic-live');
  if (!liveEl) return;
  const html = rows.map(([k, v]) => `<div class="ic-row"><span>${k}</span><b>${v}</b></div>`).join('');
  if (liveEl.dataset.sig !== html) {
    liveEl.innerHTML = html;
    liveEl.dataset.sig = html;
  }
}

function updateMusicBtn() {
  const on = audio.playing && !audio.muted;
  btnMusic.textContent = on ? '♪ 音乐 开' : '♪ 音乐 关';
  btnMusic.classList.toggle('off', !on);
}

function setMusicPlaying(p) {
  userWantsMusic = p;
  if (p) audio.start(currentTrack);
  else audio.stop();
  updateMusicBtn();
  panel.setMusicPlaying(p);
}

function selectTrack(id) {
  currentTrack = id;
  audio.selectTrack(id);
  panel.setMusicTrack(id);
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
  stage.controls.autoRotate = true;
  stage.controls.autoRotateSpeed = 0.32;
  env.setGridVisible(false);
  env.setComVisible(false);
  if (view.bloom) stage.setBloom(true, Math.min(1.6, bloomStrength + 0.18), bloomRadius, bloomThreshold);
  if (!userWantsMusic && !audio.playing) {
    setMusicPlaying(true);
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
  if (currentMode === 'threebody') {
    env.setGridVisible(view.grid);
    env.setComVisible(true);
  }
  if (view.bloom) stage.setBloom(true, bloomStrength, bloomRadius, bloomThreshold);
  if (immersiveAutoMusic && audio.playing) {
    setMusicPlaying(false);
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

// ── 相机聚焦（点击天体）────────────────────────────────────
const camTween = {
  active: false,
  fromP: new THREE.Vector3(),
  toP: new THREE.Vector3(),
  fromT: new THREE.Vector3(),
  toT: new THREE.Vector3(),
  t: 0,
  dur: 0.95,
};
let followFocus = null; // { getPos, radius, _last }

function smoothstep(x) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

function focusOn(getPos, radius) {
  const tp = getPos();
  const dist = Math.max(radius * 4.2, 0.6);
  const dir = new THREE.Vector3().subVectors(stage.camera.position, stage.controls.target);
  if (dir.lengthSq() < 1e-6) dir.set(0.5, 0.4, 0.9);
  dir.normalize();
  camTween.fromP.copy(stage.camera.position);
  camTween.toP.copy(tp).addScaledVector(dir, dist);
  camTween.fromT.copy(stage.controls.target);
  camTween.toT.copy(tp);
  camTween.t = 0;
  camTween.active = true;
  stage.controls.autoRotate = false;
  stage.controls.enabled = false;
  followFocus = { getPos, radius, _last: tp.clone() };
}

function clearFocus() {
  camTween.active = false;
  followFocus = null;
  stage.controls.enabled = true;
  stage.controls.autoRotate = immersive;
}

function closeInfoCard() {
  infoCard.style.display = 'none';
  infoCard.classList.remove('show');
  infoLive = null;
}

/**
 * 把「观察态」一次性归零，回到当前构型的默认取景。
 *
 * 不做这一步的话，切换构型会原封不动地继承上一构型的：
 *   ① 点击聚焦留下的 followFocus（相机继续追着旧天体跑）
 *   ② 视角跟随 α 留下的 followAnchor（新构型首帧会被旧坐标拉出一次瞬移）
 *   ③ 右键平移 / 跟随造成的 controls.target 偏移（新构型直接飞出画面）
 *   ④ 还挂着的天体信息卡（显示的是上一构型的天体）
 * 表象即「换了构型，却还是上一个构型最后的样子」。
 */
function resetViewpoint(radius) {
  clearFocus();
  closeInfoCard();
  followAnchor = null;
  stage.setView('default', radius);
  stage.frameRadius(radius);
}

// ── 射线拾取 ─────────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let downX = 0, downY = 0, downT = 0;

function pointerDown(e) {
  downX = e.clientX; downY = e.clientY; downT = performance.now();
}
function pointerUp(e) {
  // 过滤拖拽与长按，仅响应「点击」
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;
  if (performance.now() - downT > 450) return;
  pickAt(e.clientX, e.clientY);
}
function pickAt(cx, cy) {
  const rect = stage.renderer.domElement.getBoundingClientRect();
  ndc.x = ((cx - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((cy - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, stage.camera);
  const hits = raycaster.intersectObjects(pickables, false);
  if (hits.length === 0) return;
  const info = hits[0].object.userData.info;
  if (!info) return;
  buildInfoCard(info);
  infoCard.style.display = 'block';
  infoCard.classList.add('show');
  focusOn(info.getPos, info.radius);
}
stage.renderer.domElement.addEventListener('pointerdown', pointerDown);
stage.renderer.domElement.addEventListener('pointerup', pointerUp);

// ── 模式切换 ─────────────────────────────────────────────────
function setMode(mode) {
  if (mode === currentMode) return;
  currentMode = mode;
  clearFocus();
  closeInfoCard();

  if (mode === 'solar') {
    bodyViews.forEach((b) => b.setVisible(false));
    ghostViews.forEach((b) => b.setVisible(false));
    trails.forEach((t) => (t.line.visible = false));
    ghostTrails.forEach((t) => (t.line.visible = false));
    env.setGridVisible(false);
    env.setComVisible(false);
    solar.setVisible(true);
    pickables = solar.pickMeshes;

    const fr = solar.getFrameRadius();
    sceneRadius = fr;
    env.setScale(fr);
    resetViewpoint(fr);

    panel.setHint(
      '太阳系模式 · 太阳居中，水星→海王星按真实周期绕日运行，<b>地球带着月球</b>同行。<br>' +
        '<b>点击任意天体</b>（含月球）查看资料，或用右上控制簇进入沉浸观赏。'
    );
  } else {
    solar.setVisible(false);
    bodyViews.forEach((b) => b.setVisible(true));
    trails.forEach((t) => (t.line.visible = view.trails));
    env.setGridVisible(view.grid);
    env.setComVisible(!immersive);
    pickables = bodyViews.map((b) => b.mesh);
    resetViewpoint(sceneRadius);

    panel.setHint(
      `当前：<b>${PRESETS.find((p) => p.id === currentPresetId)?.name || ''}</b><br>` +
        '拖动右侧滑块可实时改写质量 / 位置 / 初速度；勾选「混沌对照」看初值敏感性。'
    );
  }
  panel.setMode(mode);
}

// ── 载入预设 ─────────────────────────────────────────────────
function loadPreset(id, presetOpts = {}) {
  const preset = materializePreset(id, presetOpts);
  currentPresetId = preset.id;

  // 若此刻停在太阳系模式，先切回三体——否则新构型「载入成功却根本看不见」
  if (currentMode !== 'threebody') setMode('threebody');

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

  let maxR = 0;
  for (const b of preset.bodies) {
    for (const v of b.position) maxR = Math.max(maxR, Math.abs(v));
  }
  sceneRadius = Math.max(maxR * 1.4, 1.2);
  env.setScale(sceneRadius);
  // 切构型即回到该构型的默认取景：清空聚焦 / 跟随锚点 / 视线偏移 / 旧信息卡
  resetViewpoint(sceneRadius);

  panel.setHint(
    `当前：<b>${preset.name}</b>　${preset.hint}<br>` +
      '拖动右侧滑块可实时改写质量 / 位置 / 初速度；勾选「混沌对照」看初值敏感性。'
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
    if (infoCard.style.display !== 'none') {
      infoCard.style.display = 'none';
      clearFocus();
    }
  } else if (k === 'i') {
    toggleImmersive();
  } else if (k === 'm') {
    setMusicPlaying(!userWantsMusic);
  } else if (k === 'r') {
    world.reset(opts.softening);
    clearTrails();
    followAnchor = null;
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
    if (currentMode === 'threebody') env.setGridVisible(view.grid);
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
let lastRender = 0;
let lastPanel = 0;
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

  if (currentMode === 'solar') {
    solar.update(dtReal, paused ? 0 : timeScale);
  } else if (advance > 0) {
    const r = world.step(advance, opts, sampleTrails);
    lastDrift = r.drift;
    lastThrottle = r.throttle;
    trails.forEach((t) => t.commit());
    ghostTrails.forEach((t) => t.commit());
  }

  syncBodyViews();
  env.update(dtReal);
  env.faceCamera(stage.camera);

  // 质心标记（仅三体模式）
  if (currentMode === 'threebody') {
    const d = world.peek();
    env.setComPosition(d.com[0], d.com[1], d.com[2]);
  }

  // 视角跟随天体 α（三体模式，且未被点击聚焦时）
  if (currentMode === 'threebody' && view.followAlpha && !followFocus) {
    const cur = tmpVec.set(world.main.state.pos[0], world.main.state.pos[1], world.main.state.pos[2]);
    if (followAnchor) {
      const delta = cur.clone().sub(followAnchor);
      stage.controls.target.add(delta);
      stage.camera.position.add(delta);
    } else {
      followAnchor = cur.clone();
    }
    followAnchor.copy(cur);
  } else if (!(currentMode === 'threebody' && view.followAlpha)) {
    followAnchor = null;
  }

  // 相机聚焦补间 / 跟随
  if (camTween.active) {
    camTween.t += dtReal / camTween.dur;
    const e = smoothstep(camTween.t);
    stage.camera.position.lerpVectors(camTween.fromP, camTween.toP, e);
    stage.controls.target.lerpVectors(camTween.fromT, camTween.toT, e);
    if (camTween.t >= 1) {
      camTween.active = false;
      stage.controls.enabled = true;
      stage.controls.autoRotate = immersive;
      followFocus._last = followFocus.getPos().clone();
    }
  } else if (followFocus) {
    const p = followFocus.getPos();
    const d = p.clone().sub(followFocus._last);
    stage.camera.position.add(d);
    stage.controls.target.copy(p);
    followFocus._last.copy(p);
  }

  // 渲染节流：按目标帧率决定是否真正绘制（物理与逻辑始终按真实时间推进）
  const doRender =
    targetFps === 'unlimited' || now - lastRender >= 1000 / Number(targetFps) - 1;
  if (doRender) {
    lastRender = now;
    stage.render();
  }

  // UI 面板与信息卡节流刷新
  if (now - lastPanel > 60) {
    lastPanel = now;
    if (currentMode === 'threebody') {
      const dd = world.peek();
      panel.update({
        time: world.main.state.time,
        substeps: world.stats.substeps,
        dt: world.stats.dt,
        fps,
        diag: dd,
        drift: lastDrift,
        throttle: lastThrottle,
        maxDrift: world.maxDrift,
        separation: world.separation,
        maxSeparation: world.maxSeparation,
        ghost: view.ghost,
        history: world.history,
      });
    } else {
      panel.update({
        time: solar.years,
        substeps: 0,
        dt: 0,
        fps,
        diag: { E: 0, pNorm: 0, lNorm: 0, kinetic: 0, potential: 0, com: [0, 0, 0] },
        drift: 0,
        throttle: 1,
        maxDrift: 0,
        separation: 0,
        maxSeparation: 0,
        ghost: false,
        history: null,
      });
    }
    updateInfoCardLive();
  }
}

// ── 启动 ─────────────────────────────────────────────────────
loadPreset('figure8');
stage.setBloom(view.bloom, bloomStrength, bloomRadius, bloomThreshold);
panel.setPaused(false);
requestAnimationFrame(tick);

// 移动端（窄屏）默认折叠控制面板，避免遮挡画面；用户点 ☰ 可重新展开
if (window.matchMedia('(max-width: 640px)').matches) panel.setCollapsed(true);

// 深链：#solar 直接进入八大行星模式（便于分享 / 调试）
if (location.hash === '#solar') setMode('solar');

requestAnimationFrame(() => {
  boot.classList.add('hide');
  setTimeout(() => boot.remove(), 600);
});

// 调试入口
window.__threeBody = { world, stage, env, panel, solar, loadPreset, setMode, view, opts };
