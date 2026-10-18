/**
 * 数值积分内核
 *
 * 采用 Velocity Verlet（速度 Verlet）——二阶精度、显式、时间可逆、辛式（symplectic）。
 * 相比同阶方法，辛式积分器能在长时间积分中把能量误差限制在 bounded oscillation，
 * 而不是像 RK4 那样随时间单向漂移。这一点对三体模拟至关重要：
 * 轨道不会「假性衰变」，恒纪元得以延长。
 *
 * 步骤：
 *   1. v ← v + ½·a(x)·dt
 *   2. x ← x + v·dt
 *   3. a ← a(x)        （用新位置重算加速度）
 *   4. v ← v + ½·a·dt
 */

import { G } from './constants.js';

/**
 * 计算三体各自的引力加速度，写入 out（长度 9 的 Float64Array）。
 *
 * 使用软化引力（Plummer softening）：
 *   a_i = G · Σ_{j≠i} m_j · (r_j − r_i) / (|r_ij|² + ε²)^{3/2}
 * ε > 0 时抹平 r → 0 的奇点，避免两体极近距离飞越时速度被甩到天文数字。
 */
export function computeAccelerations(pos, mass, eps, out) {
  out[0] = out[1] = out[2] = 0;
  out[3] = out[4] = out[5] = 0;
  out[6] = out[7] = out[8] = 0;

  const e2 = eps * eps;

  for (let i = 0; i < 2; i++) {
    const ix = i * 3;
    for (let j = i + 1; j < 3; j++) {
      const jx = j * 3;
      const dx = pos[jx] - pos[ix];
      const dy = pos[jx + 1] - pos[ix + 1];
      const dz = pos[jx + 2] - pos[ix + 2];

      const r2 = dx * dx + dy * dy + dz * dz + e2;
      const invR3 = 1 / (r2 * Math.sqrt(r2)); // 1 / (r² + ε²)^{3/2}

      const fi = G * invR3 * mass[j];
      const fj = G * invR3 * mass[i];

      out[ix] += fi * dx;
      out[ix + 1] += fi * dy;
      out[ix + 2] += fi * dz;

      out[jx] -= fj * dx;
      out[jx + 1] -= fj * dy;
      out[jx + 2] -= fj * dz;
    }
  }
  return out;
}

/**
 * 单步 Velocity Verlet。state 需含 pos / vel / mass / acc（均为 Float64Array(9) / (3)）。
 */
/**
 * 自适应步长主循环。
 *
 * 为什么要在循环**内部**周期性重估步长：
 * 若只在帧首算一次，当时间倍率被拉高（单帧要推进的模拟时间很长）时，
 * 帧中途突然发生的近距离飞越会用「帧首那个偏大的步长」硬闯过去，
 * 能量瞬间被打飞。每 recheckInterval 个子步重估一次即可廉价地规避。
 *
 * @param {object} o
 * @param {number} o.dtTotal    本帧目标推进量
 * @param {object} o.params     积分参数
 * @param {Function} o.suggest  (remaining) => 推荐步长
 * @param {Function} o.step      (h) => 推进一个子步（可同时推进多个宇宙）
 * @param {Function} [o.onSample] 采样回调，约每帧 8 次
 * @returns {{substeps:number, dt:number, advanced:number, throttle:number}}
 */
export function integrateAdaptive({ dtTotal, params, suggest, step, onSample }) {
  const recheck = params.recheckInterval ?? 16;
  const sampleInterval = dtTotal / 8;
  let remaining = dtTotal;
  let used = 0;
  let since = 0;
  let acc = 0;
  let dt = suggest(remaining);
  let hLast = dt;

  while (remaining > 1e-15 && used < params.maxSubsteps) {
    if (since >= recheck) {
      dt = suggest(remaining);
      since = 0;
    }
    const h = Math.min(dt, remaining);
    step(h);
    hLast = h;
    remaining -= h;
    used++;
    since++;
    if (onSample) {
      acc += h;
      if (acc >= sampleInterval) {
        onSample(false);
        acc = 0;
      }
    }
  }
  if (onSample) onSample(true);

  const advanced = dtTotal - remaining;
  return {
    substeps: used,
    dt: hLast,
    advanced,
    throttle: dtTotal > 0 ? advanced / dtTotal : 1,
  };
}

export function verletStep(state, dt, eps) {
  const { pos, vel, mass, acc } = state;

  // 半步速度推进 + 全步位置推进
  const half = 0.5 * dt;
  for (let i = 0; i < 9; i++) {
    vel[i] += acc[i] * half;
    pos[i] += vel[i] * dt;
  }

  // 用新位置重算加速度
  computeAccelerations(pos, mass, eps, acc);

  // 第二个半步速度推进
  for (let i = 0; i < 9; i++) {
    vel[i] += acc[i] * half;
  }

  state.time += dt;
  state.steps += 1;
}

/**
 * 依据当前状态自适应推荐积分步长。
 *
 * 两个约束取小：
 *   - 速度约束：dt ≲ η_v · d_eff / v_max（一个子步内位移远小于间距）
 *   - 加速度约束：dt ≲ η_a · √(d_eff / a_max)（特征动力学时间的分数）
 *
 * 关键：这里的间距用**有效间距** d_eff = √(d_min² + ε²)，
 * 即把软化长度计入。否则当两体近乎相撞、d → 0 时步长会被逼到 0，
 * 进而触发子步上限导致能量爆炸（实测 goggles 轨道在 dtMin=1e-7 下
 * 能量漂移可达 1e6%，而放开下限后降到 1e-3%）。
 *
 * @param {number} floorSeparation 绝对下限，防止 d_eff 塌缩到 0
 * @param {number} dtTotal 本帧目标推进量，用于计算「防卡死步长下限」
 */
export function suggestTimeStep(state, params, floorSeparation, dtTotal = 0) {
  const { pos, vel, acc } = state;
  const eps = params.softening || 0;

  let dmin = Infinity;
  for (let i = 0; i < 2; i++) {
    const ix = i * 3;
    for (let j = i + 1; j < 3; j++) {
      const jx = j * 3;
      const dx = pos[jx] - pos[ix];
      const dy = pos[jx + 1] - pos[ix + 1];
      const dz = pos[jx + 2] - pos[ix + 2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < dmin) dmin = d2;
    }
  }
  const dEff = Math.max(Math.sqrt(dmin + eps * eps), floorSeparation);

  let vmax = 0;
  let amax = 0;
  for (let i = 0; i < 9; i++) {
    const v = Math.abs(vel[i]);
    const a = Math.abs(acc[i]);
    if (v > vmax) vmax = v;
    if (a > amax) amax = a;
  }
  vmax = Math.max(vmax, 1e-12);
  amax = Math.max(amax, 1e-12);

  const dtV = (params.etaVelocity * dEff) / vmax;
  const dtA = params.etaAcceleration * Math.sqrt(dEff / amax);

  let dt = Math.min(params.dtMax, Math.min(dtV, dtA));
  dt = Math.max(dt, params.dtMin);

  // 防卡死：极端近距离飞越时步长可能小到让画面「冻住」，
  // 这里保证每帧至少推进 minThrottleRate × dtTotal 的模拟时间（宁可略降精度）
  if (dtTotal > 0 && params.maxSubsteps > 0) {
    const rate = params.minThrottleRate ?? 0.05;
    dt = Math.max(dt, (dtTotal * rate) / params.maxSubsteps);
  }
  return dt;
}
