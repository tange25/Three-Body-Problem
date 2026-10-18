/**
 * 仿真状态与守恒诊断
 */

import { G } from './constants.js';
import { computeAccelerations, verletStep, suggestTimeStep, integrateAdaptive } from './integrator.js';

export function createState() {
  return {
    pos: new Float64Array(9),
    vel: new Float64Array(9),
    mass: new Float64Array(3),
    acc: new Float64Array(9),
    time: 0,
    steps: 0,
  };
}

export class Simulation {
  constructor() {
    this.state = createState();
    this.softening = 0.02;
    this.baseline = null; // 初始守恒量基准
  }

  /** 从归一化后的 bodies（数组长度 3）载入 */
  setBodies(bodies, softening = this.softening) {
    const s = this.state;
    this.softening = softening;
    for (let i = 0; i < 3; i++) {
      const b = bodies[i];
      s.mass[i] = b.mass;
      for (let k = 0; k < 3; k++) {
        s.pos[i * 3 + k] = b.position[k];
        s.vel[i * 3 + k] = b.velocity[k];
      }
    }
    s.time = 0;
    s.steps = 0;
    computeAccelerations(s.pos, s.mass, softening, s.acc);
    this.rebaseline();
    return this;
  }

  /** 重新设定守恒基准（载入预设或用户手动改参数后调用） */
  rebaseline() {
    const d = this.diagnostics();
    // 注意：必须存**标量模长**而非矢量，否则后续做 (当前值 − 基准值) 会得到 NaN
    this.baseline = { E: d.E, P: d.pNorm, L: d.lNorm };
    return d;
  }

  /**
   * 单帧推进：按自适应步长切成若干子步。
   *
   * 关键设计：当所需子步数超过 maxSubsteps 时，**不**通过放大步长来凑够 dtTotal
   * （那会在近距离飞越时直接把能量打飞），而是只推进 maxSubsteps × suggested 的时间，
   * 让模拟时间「主动降速」。宁可慢放，不可失真。
   *
   * @returns {{substeps:number, dt:number, advanced:number, throttle:number}}
   */
  advance(dtTotal, params) {
    return integrateAdaptive({
      dtTotal,
      params,
      suggest: (remaining) =>
        suggestTimeStep(this.state, params, params.minSeparationFloor, remaining),
      step: (h) => verletStep(this.state, h, params.softening),
    });
  }

  /** 供「幽灵对照」使用：跟随主世界完全相同的步长序列 */
  advanceFixed(dtTotal, n) {
    const h = dtTotal / n;
    for (let k = 0; k < n; k++) verletStep(this.state, h, this.softening);
  }

  diagnostics() {
    return computeDiagnostics(this.state, this.softening);
  }

  /** 导出为可编辑的 bodies 结构 */
  toBodies() {
    const s = this.state;
    const out = [];
    for (let i = 0; i < 3; i++) {
      out.push({
        mass: s.mass[i],
        position: [s.pos[i * 3], s.pos[i * 3 + 1], s.pos[i * 3 + 2]],
        velocity: [s.vel[i * 3], s.vel[i * 3 + 1], s.vel[i * 3 + 2]],
      });
    }
    return out;
  }

  /** 直接写入某个标量（供 UI 滑块实时修改） */
  setValue(kind, index, axis, value) {
    const s = this.state;
    if (kind === 'mass') s.mass[index] = value;
    else if (kind === 'position') s.pos[index * 3 + axis] = value;
    else if (kind === 'velocity') s.vel[index * 3 + axis] = value;
    // 位置/速度变动后加速度需要重算；质量变动后同样
    if (kind !== 'velocity') computeAccelerations(s.pos, s.mass, this.softening, s.acc);
  }
}

/**
 * 计算全部守恒量。
 * 注意：势能同样使用软化核 U = −G·m_i·m_j / √(r² + ε²)，
 * 与加速度使用的软化力严格互为梯度关系，因此能量守恒判定才自洽。
 */
export function computeDiagnostics(state, eps) {
  const { pos, vel, mass } = state;

  let T = 0;
  let M = 0;
  const P = [0, 0, 0];
  const L = [0, 0, 0];
  const com = [0, 0, 0];

  for (let i = 0; i < 3; i++) {
    const ix = i * 3;
    const m = mass[i];
    const x = pos[ix], y = pos[ix + 1], z = pos[ix + 2];
    const vx = vel[ix], vy = vel[ix + 1], vz = vel[ix + 2];

    M += m;
    T += 0.5 * m * (vx * vx + vy * vy + vz * vz);

    P[0] += m * vx;
    P[1] += m * vy;
    P[2] += m * vz;

    L[0] += m * (y * vz - z * vy);
    L[1] += m * (z * vx - x * vz);
    L[2] += m * (x * vy - y * vx);

    com[0] += m * x;
    com[1] += m * y;
    com[2] += m * z;
  }

  let U = 0;
  const e2 = eps * eps;
  for (let i = 0; i < 2; i++) {
    const ix = i * 3;
    for (let j = i + 1; j < 3; j++) {
      const jx = j * 3;
      const dx = pos[jx] - pos[ix];
      const dy = pos[jx + 1] - pos[ix + 1];
      const dz = pos[jx + 2] - pos[ix + 2];
      U -= (G * mass[i] * mass[j]) / Math.sqrt(dx * dx + dy * dy + dz * dz + e2);
    }
  }

  return {
    kinetic: T,
    potential: U,
    E: T + U,
    P,
    L,
    com: [com[0] / M, com[1] / M, com[2] / M],
    M,
    pNorm: Math.hypot(P[0], P[1], P[2]),
    lNorm: Math.hypot(L[0], L[1], L[2]),
  };
}

export function norm3(v) {
  return Math.hypot(v[0], v[1], v[2]);
}
