/**
 * 物理内核自检（纯 Node，无需浏览器）
 *
 * 验证三件事：
 *   1. 周期解能否「闭合」——积分一个周期后是否回到初始构型
 *   2. 能量 / 动量 / 角动量在时间推进中是否守恒
 *   3. 退化到二体时是否还原出正确的圆轨道
 *
 * 用法：node scripts/verify-physics.mjs
 */

import { Simulation } from '../src/core/simulation.js';
import { materializePreset } from '../src/core/presets.js';
import { PHYSICS_DEFAULTS } from '../src/core/constants.js';

const params = { ...PHYSICS_DEFAULTS };

function integrate(sim, totalTime, frame = 1 / 200) {
  let t = 0;
  let maxSubsteps = 0;
  let frames = 0;
  let minThrottle = 1;
  while (t < totalTime && frames < 2_000_000) {
    const step = Math.min(frame, totalTime - t);
    const r = sim.advance(step, { ...params, softening: sim.softening });
    maxSubsteps = Math.max(maxSubsteps, r.substeps);
    minThrottle = Math.min(minThrottle, r.throttle);
    t += r.advanced;
    frames++;
  }
  return { maxSubsteps, frames, minThrottle, reached: t };
}

function dist(a, b) {
  let s = 0;
  for (let i = 0; i < 9; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

const results = [];
function report(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name.padEnd(34)} ${detail}`);
}

function makeSim(presetId, softeningOverride) {
  const p = materializePreset(presetId);
  const eps = softeningOverride ?? p.softening;
  const sim = new Simulation();
  sim.setBodies(p.bodies, eps);
  return { sim, preset: p, init: { pos: Float64Array.from(sim.state.pos), vel: Float64Array.from(sim.state.vel) } };
}

console.log('\n═══ 三体模拟器 · 物理内核自检 ═══\n');

// ── 1. 八字形轨道周期闭合性 ──────────────────────────────────
{
  const T = 6.32591398; // Chenciner–Montgomery 八字解周期
  const { sim, init } = makeSim('figure8');
  const E0 = sim.baseline.E;
  integrate(sim, T);
  const err = dist(sim.state.pos, init.pos);
  const vErr = dist(sim.state.vel, init.vel);
  const d = sim.diagnostics();
  const drift = Math.abs((d.E - E0) / E0);
  report('八字形 · 一周期后位置闭合', err < 5e-3, `误差 ${err.toExponential(2)}（阈值 5e-3）`);
  report('八字形 · 一周期后速度闭合', vErr < 5e-3, `误差 ${vErr.toExponential(2)}`);
  report('八字形 · 单周期能量漂移', drift < 1e-5, `${(drift * 100).toExponential(2)}%`);

  // 长时积分（100 个周期）
  integrate(sim, T * 99);
  const d2 = sim.diagnostics();
  const drift2 = Math.abs((d2.E - E0) / E0);
  report('八字形 · 100 周期能量漂移', drift2 < 1e-3, `${(drift2 * 100).toExponential(2)}%`);
  report('八字形 · 总动量守恒', d2.pNorm < 1e-10, `|P| = ${d2.pNorm.toExponential(2)}`);
  report('八字形 · 质心不漂移', Math.hypot(...d2.com) < 1e-8, `|R_com| = ${Math.hypot(...d2.com).toExponential(2)}`);
}

// ── 2. 拉格朗日等边三角形 ────────────────────────────────────
{
  const omega = Math.pow(3, -0.25); // ω = 3^(-1/4)（G=m=R=1）
  const T = (2 * Math.PI) / omega;
  const { sim, init } = makeSim('lagrange');
  const R0 = Math.hypot(init.pos[0], init.pos[1], init.pos[2]);
  const E0 = sim.baseline.E;
  integrate(sim, T);
  const err = dist(sim.state.pos, init.pos);
  const R1 = Math.hypot(sim.state.pos[0], sim.state.pos[1], sim.state.pos[2]);
  const d = sim.diagnostics();
  const drift = Math.abs((d.E - E0) / E0);
  report('拉格朗日 · 一周期后闭合', err < 5e-3, `误差 ${err.toExponential(2)}`);
  report('拉格朗日 · 轨道半径恒定', Math.abs(R1 - R0) < 1e-6, `R: ${R0.toFixed(6)} → ${R1.toFixed(6)}`);
  report('拉格朗日 · 能量漂移', drift < 1e-6, `${(drift * 100).toExponential(2)}%`);
}

// ── 3. Šuvakov–Dmitrašinović 族：周期闭合 + 长时守恒 ─────────
// 这些是「近碰撞」自由落体轨道（最近距离 ~1e-2），对步长极其敏感
const SUV_PERIOD = {
  butterfly: 6.2356,
  bumblebee: 63.5345,
  moth: 14.8939,
  yinyang: 17.3284,
  goggles: 10.4668,
};
for (const [id, T] of Object.entries(SUV_PERIOD)) {
  const { sim, init } = makeSim(id);
  const E0 = sim.baseline.E;
  const L0 = sim.baseline.L;
  const r = integrate(sim, T);
  const closure = dist(sim.state.pos, init.pos);
  const d1 = sim.diagnostics();
  const drift1 = Math.abs((d1.E - E0) / (Math.abs(E0) + 1e-12));
  // 注：文献初值只给到 5 位小数，闭合误差存在约 1e-3 的固有下界
  report(
    `周期解 ${id.padEnd(10)} · 闭合`,
    closure < 5e-3,
    `误差 ${closure.toExponential(2)}　ΔE/E₀ = ${(drift1 * 100).toExponential(2)}%　子步≤${r.maxSubsteps}`
  );

  const r2 = integrate(sim, Math.max(5, 60 - T));
  const d = sim.diagnostics();
  const drift = Math.abs((d.E - E0) / (Math.abs(E0) + 1e-12));
  const lDrift = Math.abs((d.lNorm - L0) / (Math.abs(L0) + 1e-12));
  report(
    `周期解 ${id.padEnd(10)} · t=60`,
    drift < 1e-2 && isFinite(d.E),
    `ΔE/E₀ = ${(drift * 100).toExponential(2)}%　ΔL/L₀ = ${(lDrift * 100).toExponential(2)}%　子步≤${r2.maxSubsteps}`
  );
}

// ── 4. 退化到二体：圆轨道检验 ────────────────────────────────
{
  // 两个等质量天体相距 d = 1，各绕质心做半径 0.5 的圆运动
  // v = sqrt(G·m / (2d)) = 1/√2 ；第三个天体质量取 1e-12 且远离，作为旁观者
  const v = Math.sqrt(1 / 2);
  const sim = new Simulation();
  sim.setBodies(
    [
      { mass: 1, position: [-0.5, 0, 0], velocity: [0, -v, 0] },
      { mass: 1, position: [0.5, 0, 0], velocity: [0, v, 0] },
      { mass: 1e-12, position: [0, 200, 0], velocity: [0, 0, 0] },
    ],
    0
  );
  const T = (2 * Math.PI * 0.5) / v;
  integrate(sim, T * 10);
  const R = Math.hypot(sim.state.pos[0], sim.state.pos[1], sim.state.pos[2]);
  const d = sim.diagnostics();
  const drift = Math.abs((d.E - sim.baseline.E) / sim.baseline.E);
  report('二体退化 · 10 圈后半径恒定', Math.abs(R - 0.5) < 1e-5, `R = ${R.toFixed(8)}（期望 0.5）`);
  report('二体退化 · 能量守恒', drift < 1e-8, `${(drift * 100).toExponential(2)}%`);
}

// ── 5. 混沌场景：数值稳定性（不允许出现 NaN / 爆炸）──────────
{
  const { sim } = makeSim('chaos');
  const r = integrate(sim, 200);
  const d = sim.diagnostics();
  const finite =
    isFinite(d.E) && [...sim.state.pos, ...sim.state.vel].every((x) => isFinite(x));
  const drift = Math.abs((d.E - sim.baseline.E) / (Math.abs(sim.baseline.E) + 1e-12));
  report(
    '三维混沌 · t=200 数值有限',
    finite,
    `ΔE/E₀ = ${(drift * 100).toExponential(2)}%　单帧子步 ≤ ${r.maxSubsteps}`
  );
}

// ── 5.5 层级系统（日 · 地 · 月）─────────────────────────────
{
  const { sim } = makeSim('solar');
  const E0 = sim.baseline.E;
  const r = integrate(sim, 30, 1 / 60);
  const d = sim.diagnostics();
  const drift = Math.abs((d.E - E0) / (Math.abs(E0) + 1e-12));
  const sep = Math.hypot(
    sim.state.pos[6] - sim.state.pos[3],
    sim.state.pos[7] - sim.state.pos[4],
    sim.state.pos[8] - sim.state.pos[5]
  );
  report(
    '日地月 · t=30 能量守恒',
    drift < 1e-3,
    `ΔE/E₀ = ${(drift * 100).toExponential(2)}%　子步≤${r.maxSubsteps}　最低推进率 ${r.minThrottle.toFixed(2)}`
  );
  report('日地月 · 卫星仍在希尔球内', sep < 1.4, `行星–卫星间距 ${sep.toFixed(4)}（初始 0.45，希尔半径 ≈1.39）`);
}

// ── 6. 时间可逆性（辛式积分器的标志）────────────────────────
{
  const { sim, init } = makeSim('figure8');
  integrate(sim, 5);
  // 速度取反 → 再积分同样的时间 → 应回到出发点
  for (let i = 0; i < 9; i++) sim.state.vel[i] *= -1;
  integrate(sim, 5);
  const err = dist(sim.state.pos, init.pos);
  report('时间可逆性 · 往返 t=5', err < 1e-2, `回到初始位置误差 ${err.toExponential(2)}`);
}

// ── 汇总 ─────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
if (failed.length) {
  console.log('\n未通过：');
  failed.forEach((f) => console.log(`  · ${f.name} → ${f.detail}`));
  process.exitCode = 1;
} else {
  console.log('全部通过：运动符合万有引力定律与守恒律。\n');
}
