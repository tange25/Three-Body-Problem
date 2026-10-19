/**
 * 世界：主宇宙 + 幽灵宇宙（混沌对照）+ 历史记录
 */

import { Simulation, computeDiagnostics } from './simulation.js';
import { verletStep, suggestTimeStep, computeAccelerations, integrateAdaptive } from './integrator.js';
import { PHYSICS_DEFAULTS } from './constants.js';

class RingLog {
  constructor(capacity, stride) {
    this.capacity = capacity;
    this.stride = stride;
    this.data = new Float64Array(capacity * stride);
    this.count = 0;
    this.head = 0;
  }
  clear() {
    this.count = 0;
    this.head = 0;
  }
  push(values) {
    const o = this.head * this.stride;
    for (let i = 0; i < this.stride; i++) this.data[o + i] = values[i];
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }
  /** 读取第 k 条（0 = 最旧）的第 col 列，零分配 */
  read(k, col) {
    const start = (this.head - this.count + this.capacity) % this.capacity;
    const idx = (start + k) % this.capacity;
    return this.data[idx * this.stride + col];
  }

  /** 按时间顺序遍历（最旧 → 最新）。仅用于低频场景（CSV 导出） */
  forEach(fn) {
    const start = (this.head - this.count + this.capacity) % this.capacity;
    for (let k = 0; k < this.count; k++) {
      const idx = (start + k) % this.capacity;
      fn(this.data.subarray(idx * this.stride, idx * this.stride + this.stride), k);
    }
  }
}

export class World {
  constructor() {
    this.main = new Simulation();
    this.ghost = new Simulation();
    this.ghostEnabled = false;
    /** 施加在 α 天体 x 坐标上的初始扰动量级 */
    this.perturbation = PHYSICS_DEFAULTS.perturbation;

    /** 用户设定的「初始条件」（重置即回到这里） */
    this.initial = null;
    /** 载入预设时的原始初始条件（永不因编辑被污染；重置恢复到此） */
    this.presetOriginal = null;

    this.history = new RingLog(1200, 5); // t, 能量漂移, |P|, 角动量漂移, 幽灵分离
    this.trace = new RingLog(3000, 19); // t + pos(9) + vel(9) —— 供 CSV 导出

    this.stats = { substeps: 0, dt: 0 };
    this.maxDrift = 0;
    this.maxSeparation = 0;
    this.separation = 0;
  }

  /** 载入一组已归一化的 bodies */
  load(bodies, softening) {
    this.presetOriginal = cloneBodies(bodies);
    this.initial = cloneBodies(bodies);
    this._applyInitial(softening);
  }

  _applyInitial(softening) {
    this.main.setBodies(cloneBodies(this.initial), softening);
    this.syncGhost(softening);
    this.history.clear();
    this.trace.clear();
    this.maxDrift = 0;
    this.maxSeparation = 0;
    this.separation = 0;
  }

  /** 重置到当前预设的原始初始条件（清除用户在面板上的所有编辑） */
  reset(softening) {
    this.initial = cloneBodies(this.presetOriginal);
    this._applyInitial(softening);
  }

  /** 用初始条件 + 微扰重建幽灵宇宙 */
  syncGhost(softening) {
    const g = cloneBodies(this.initial);
    g[0].position[0] += this.perturbation;
    this.ghost.setBodies(g, softening);
  }

  /**
   * UI 修改初始参数：同时写回 initial 与实时状态
   * @returns {boolean} 是否产生轨迹跳变（需要清空拖尾）
   */
  editInitial(kind, index, axis, value, softening) {
    const b = this.initial[index];
    if (kind === 'mass') b.mass = value;
    else if (kind === 'position') b.position[axis] = value;
    else if (kind === 'velocity') b.velocity[axis] = value;

    this.main.setValue(kind, index, axis, value);
    this.main.rebaseline();
    this.syncGhost(softening);
    this.history.clear();
    this.maxDrift = 0;
    this.maxSeparation = 0;
    return kind !== 'mass';
  }

  /**
   * 推进一帧。
   * 主宇宙与幽灵宇宙使用**完全相同的步长序列**，
   * 这样两者的分离才纯粹来自初始扰动，而非积分误差差异。
   *
   * @param {number} dtTotal 本帧需要推进的模拟时间
   * @param {object} params  积分参数
   * @param {Function} sampler 每个采样子步后回调 (isLast)
   */
  step(dtTotal, params, sampler) {
    const ghostOn = this.ghostEnabled;
    if (ghostOn) this.ghost.softening = params.softening;

    const res = integrateAdaptive({
      dtTotal,
      params,
      suggest: (remaining) =>
        suggestTimeStep(this.main.state, params, params.minSeparationFloor, remaining),
      step: (h) => {
        verletStep(this.main.state, h, params.softening);
        // 幽灵宇宙使用**完全相同**的步长序列，分离才纯粹来自初始扰动
        if (ghostOn) verletStep(this.ghost.state, h, params.softening);
      },
      onSample: sampler || undefined,
    });

    const after = this.main.diagnostics();
    const base = this.main.baseline;

    const drift = Math.abs((after.E - base.E) / (Math.abs(base.E) + 1e-12));
    const lDrift = Math.abs((after.lNorm - base.L) / (Math.abs(base.L) + 1e-12));

    let separation = 0;
    if (this.ghostEnabled) {
      for (let i = 0; i < 9; i += 3) {
        const d = Math.hypot(
          this.main.state.pos[i] - this.ghost.state.pos[i],
          this.main.state.pos[i + 1] - this.ghost.state.pos[i + 1],
          this.main.state.pos[i + 2] - this.ghost.state.pos[i + 2]
        );
        if (d > separation) separation = d;
      }
    }
    this.separation = separation;
    if (drift > this.maxDrift) this.maxDrift = drift;
    if (separation > this.maxSeparation) this.maxSeparation = separation;

    this.stats.substeps = res.substeps;
    this.stats.dt = res.dt;
    this.stats.throttle = res.throttle;

    this.history.push([this.main.state.time, drift, after.pNorm, lDrift, separation]);

    const s = this.main.state;
    const row = [s.time];
    for (let i = 0; i < 9; i++) row.push(s.pos[i]);
    for (let i = 0; i < 9; i++) row.push(s.vel[i]);
    this.trace.push(row);

    return { diagnostics: after, drift, separation, throttle: res.throttle };
  }

  /** 质量变化后需要重算加速度 */
  refreshAccelerations() {
    computeAccelerations(this.main.state.pos, this.main.state.mass, this.main.softening, this.main.state.acc);
  }

  peek() {
    return this.main.diagnostics();
  }
}

export function cloneBodies(bodies) {
  return bodies.map((b) => ({
    name: b.name,
    color: b.color,
    css: b.css,
    mass: b.mass,
    position: [...b.position],
    velocity: [...b.velocity],
  }));
}

export { computeDiagnostics };
