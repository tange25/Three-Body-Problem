/**
 * 经典三体初始条件预设库
 *
 * 约定：G = 1，三体质量默认取 1（除层级系统外）。
 * 平面解（z = 0）直接沿用文献数值；载入时统一做「质心归零 + 总动量为零」归一化，
 * 这样质心不会整体漂移，守恒诊断才有意义。
 */

import { BODY_PALETTE } from './constants.js';

const TAU = Math.PI * 2;

/** 拉格朗日等边三角形解 */
function lagrangeTriangle(R = 1, m = 1) {
  // ω² = G·m / (√3·R³)，即 ω = 3^(-1/4)（取 G=m=R=1）
  const omega = Math.sqrt(m / (Math.sqrt(3) * R * R * R));
  const bodies = [];
  for (let i = 0; i < 3; i++) {
    const th = (TAU * i) / 3;
    bodies.push({
      mass: m,
      position: [R * Math.cos(th), R * Math.sin(th), 0],
      velocity: [-omega * R * Math.sin(th), omega * R * Math.cos(th), 0],
    });
  }
  return bodies;
}

/**
 * Šuvakov–Dmitrašinović 族（等质量 m=1）
 * 初始构型：r₁=(-1,0)，r₂=(1,0)，r₃=(0,0)；v₁=v₂=(vx,vy)，v₃=(-2vx,-2vy)
 */
function suvakov(vx, vy) {
  return [
    { mass: 1, position: [-1, 0, 0], velocity: [vx, vy, 0] },
    { mass: 1, position: [1, 0, 0], velocity: [vx, vy, 0] },
    { mass: 1, position: [0, 0, 0], velocity: [-2 * vx, -2 * vy, 0] },
  ];
}

/** 日–地–月式层级系统：大质量主导 + 卫星子系统 */
function hierarchical() {
  const M = 1000; // 恒星
  const mP = 1; // 行星
  const mM = 0.02; // 卫星
  const aP = 20; // 行星轨道半径
  const aM = 0.45; // 卫星绕行星半径（远小于希尔半径 ≈ 1.39，层级稳定）

  const vP = Math.sqrt((M + mP) / aP); // ≈ 7.07
  const vM = vP + Math.sqrt(mP / aM); // 行星速度 + 相对环绕速度

  return [
    { mass: M, position: [0, 0, 0], velocity: [0, 0, 0] },
    { mass: mP, position: [aP, 0, 0], velocity: [0, vP, 0] },
    { mass: mM, position: [aP + aM, 0, 0], velocity: [0, vM, 0] },
  ];
}

/** 可复现的伪随机（mulberry32），保证「三维混沌」每次同一种子结果一致 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 三维混沌：完全非平面的随机初始条件 */
function chaos3D(seed = 20261017) {
  const rnd = mulberry32(seed);
  const bodies = [];
  for (let i = 0; i < 3; i++) {
    const s = 1.2;
    bodies.push({
      mass: 0.8 + rnd() * 0.6,
      position: [(rnd() - 0.5) * 2 * s, (rnd() - 0.5) * 2 * s, (rnd() - 0.5) * 2 * s],
      velocity: [(rnd() - 0.5) * 0.9, (rnd() - 0.5) * 0.9, (rnd() - 0.5) * 0.9],
    });
  }
  return bodies;
}

/**
 * 注意 softening 字段：
 * 周期解必须取 ε = 0 —— 软化核会改变有效引力，导致轨道不再闭合；
 * 只有混沌 / 层级这类可能出现极近距离飞越的场景才需要 ε > 0 兜底。
 */
export const PRESETS = [
  {
    id: 'figure8',
    name: '八字形轨道',
    subtitle: 'Chenciner–Montgomery · 周期 T≈6.326',
    hint: '三体等质量，沿同一条 8 字曲线首尾相接地追逐，最著名的周期解。',
    timeScale: 1.0,
    softening: 0.0,
    build: () => [
      { mass: 1, position: [0.97000436, -0.24308753, 0], velocity: [0.46620368, 0.43236573, 0] },
      { mass: 1, position: [-0.97000436, 0.24308753, 0], velocity: [0.46620368, 0.43236573, 0] },
      { mass: 1, position: [0, 0, 0], velocity: [-0.93240737, -0.86473146, 0] },
    ],
  },
  {
    id: 'lagrange',
    name: '拉格朗日三角',
    subtitle: '等边三角形刚体式旋转 · 稳定解',
    hint: '三体构成等边三角形绕质心匀速旋转，是少数解析可解且稳定的构型。',
    timeScale: 1.0,
    softening: 0.0,
    build: () => lagrangeTriangle(1, 1),
  },
  {
    id: 'butterfly',
    name: '蝴蝶 I',
    subtitle: 'Šuvakov–Dmitrašinović · 周期解',
    hint: '轨道形如振翅的蝴蝶，属于自由落体三体周期解家族。',
    timeScale: 1.0,
    softening: 0.0,
    build: () => suvakov(0.30689, 0.12551),
  },
  {
    id: 'bumblebee',
    name: '熊蜂',
    subtitle: 'Šuvakov–Dmitrašinović · 周期解',
    hint: '短促而急促的往返运动，形似熊蜂采蜜。',
    timeScale: 1.0,
    softening: 0.0,
    build: () => suvakov(0.18428, 0.58719),
  },
  {
    id: 'moth',
    name: '飞蛾 I',
    subtitle: 'Šuvakov–Dmitrašinović · 周期解',
    hint: '轨迹在中心区反复穿插，像扑火的飞蛾。',
    timeScale: 1.0,
    softening: 0.0,
    build: () => suvakov(0.46444, 0.39606),
  },
  {
    id: 'yinyang',
    name: '阴阳 I',
    subtitle: 'Šuvakov–Dmitrašinović · 周期解',
    hint: '两条轨道互为镜像、首尾缠绕，恰似太极。',
    timeScale: 1.0,
    softening: 0.0,
    build: () => suvakov(0.51394, 0.30474),
  },
  {
    id: 'goggles',
    name: '护目镜',
    subtitle: 'Šuvakov–Dmitrašinović · 周期解',
    hint: '两个大环加一条中缝，轮廓像一副护目镜。',
    timeScale: 1.0,
    softening: 0.0,
    build: () => suvakov(0.0833, 0.12789),
  },
  {
    id: 'solar',
    name: '日 · 地 · 月',
    subtitle: '层级系统 · 质量比 1000 : 1 : 0.02',
    hint: '大质量恒星 + 行星 + 卫星，层级稳定，可观察轨道摄动与希尔球。',
    timeScale: 0.35,
    softening: 0.002,
    build: hierarchical,
  },
  {
    id: 'chaos',
    name: '三维混沌',
    subtitle: '乱纪元 · 不可预测',
    hint: '完全非平面的随机初始条件，天生混沌，配合「幽灵对照」效果最佳。',
    timeScale: 1.0,
    softening: 0.02,
    randomizable: true,
    build: (opts = {}) => chaos3D(opts.seed ?? 20261017),
  },
];

export function getPreset(id) {
  return PRESETS.find((p) => p.id === id) || PRESETS[0];
}

/**
 * 把预设构型的原始初始条件做归一化并贴上身份信息。
 * - 平移到质心系（质心 = 原点）
 * - 扣掉整体动量（总动量 = 0）
 */
export function materializePreset(id, opts = {}) {
  const preset = getPreset(id);
  const raw = preset.build(opts);
  return {
    id: preset.id,
    name: preset.name,
    subtitle: preset.subtitle,
    hint: preset.hint,
    timeScale: preset.timeScale ?? 1,
    softening: preset.softening ?? 0,
    bodies: normalizeBodies(raw),
  };
}

/** 质心归零 + 总动量归零 */
export function normalizeBodies(bodies) {
  let M = 0;
  const com = [0, 0, 0];
  const mom = [0, 0, 0];
  for (const b of bodies) {
    M += b.mass;
    for (let k = 0; k < 3; k++) {
      com[k] += b.mass * b.position[k];
      mom[k] += b.mass * b.velocity[k];
    }
  }
  for (let k = 0; k < 3; k++) {
    com[k] /= M;
    mom[k] /= M;
  }
  return bodies.map((b, i) => {
    const style = BODY_PALETTE[i];
    return {
      name: style.label,
      color: style.color,
      css: style.css,
      mass: b.mass,
      position: [b.position[0] - com[0], b.position[1] - com[1], b.position[2] - com[2]],
      velocity: [b.velocity[0] - mom[0], b.velocity[1] - mom[1], b.velocity[2] - mom[2]],
    };
  });
}
