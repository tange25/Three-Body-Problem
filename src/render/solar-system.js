/**
 * 太阳系模式 · 八大行星轨道图
 * --------------------------------------------------------------------------
 * 以太阳为中心，绘制并持续动画呈现水星→海王星的公转轨道与相对运动。
 * 行星按各自真实周期（年）绕日运行；轨道半径做了轻微压缩以便同框观赏，
 * 但「周期比」与「远近次序」严格遵循真实数据。
 *
 * 设计要点：
 *   - 轨道环（LineLoop）与行星同处一个按倾角旋转的 orbitGroup 内，保证对位
 *   - 太阳为自发光球体 + 点光源，行星被其照亮（MeshStandardMaterial）
 *   - 每个 mesh 挂 userData.info，供射线拾取后弹出信息面板
 *   - 时间推进与三体模式共用全局 timeScale：years += dtReal * timeScale * YEARS_PER_UNIT
 */

import * as THREE from 'three';
import { getGlowTexture } from './bodies.js';

/** 1 个「真实秒」（timeScale=1）推进多少「年」——让地球约 10s 跑完一圈 */
const YEARS_PER_UNIT = 0.1;

/* ════════════════════════════════════════════════════════════════════════
 * 彗星视觉 v2：「掠日流光彗星」
 * --------------------------------------------------------------------------
 * 设计主张（旧版「柔性粒子双尾 + 锥形光尾」的渲染逻辑已全部移除）：
 *   1. 外观形态 —— 白热彗核 + 单层呼吸彩色光晕（彗发），尾随一条
 *      「流光丝带」(ribbon)：彗核端白热 → 中段彗星色 → 尾尖淡入深空，
 *      宽度沿尾渐收。替代旧版「离子尾 + 尘埃尾粒子 + streak 锥形光带」。
 *   2. 运动轨迹 —— 太阳仍居椭圆中心，但公转改为开普勒式变速
 *      （角速度 ∝ 1/d²，近日俯冲加速、远日缓行；旧版为匀速扫行），
 *      轨道仍带 inc / node 倾角，各彗星轨道平面互不相同。
 *   3. 拖尾表现 —— 单条丝带沿「背日 → 反速度」方向平滑弯曲（越靠尾尖
 *      弯得越多），片元级流动条纹随时间滚动，模拟等离子体沿尾流失；
 *      附带垂直于丝带的微颤；长度与亮度随日距伸缩
 *      （近日猛烈拉长增亮、远日收缩成暗淡星点）。
 *   4. 与行星轨道的交互 ——
 *      a) 彗星径向穿越某行星轨道半径的瞬间，在该轨道上激起一圈扩散
 *         震波（加色混合圆环，约 1.6s 扩散淡出，用行星自身颜色与轨道呼应）；
 *      b) 彗星进入某行星引力影响半径（3D 距离）时，丝带被向该行星方向
 *         轻微掰弯，近大行星时可见明显牵引。
 */
const COMET_RIBBON_VERT = `
attribute float aAlpha; // 顶点基础透明度（头→尾衰减曲线）
attribute float aV;     // 0 = 彗核端 → 1 = 尾尖
varying float vAlpha;
varying float vV;
void main() {
  vAlpha = aAlpha;
  vV = aV;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const COMET_RIBBON_FRAG = `
precision mediump float;
uniform vec3 uColor;  // 彗星主色
uniform float uFlow;  // 流动时间（真实秒，驱动条纹滚动）
uniform float uGain;  // 活动增益（近日点更高）
varying float vAlpha;
varying float vV;
void main() {
  // 颜色：彗核端白热 → 中段彗星色 → 尾尖向深空淡去
  vec3 col = mix(vec3(1.0, 1.0, 1.0), uColor, clamp(vV * 1.5 - 0.2, 0.0, 1.0));
  // 等离子流动条纹：高频细纹 + 低频涌浪，随 uFlow 向下游滚动
  float stripe = 0.72 + 0.28 * sin(vV * 30.0 - uFlow * 4.2 + sin(vV * 11.0 + uFlow * 1.3) * 2.2);
  // 尾端散逸余辉（缓慢收尾而不是骤断）
  float tail = 0.35 + 0.65 * pow(1.0 - vV, 2.4);
  float a = tail * vAlpha * uGain * stripe;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
}`;
function makeCometRibbonMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uFlow: { value: 0 },
      uGain: { value: 0.6 },
    },
    vertexShader: COMET_RIBBON_VERT,
    fragmentShader: COMET_RIBBON_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}
/** 流光丝带几何：一条三角带，顶点烘焙「基础透明度 + 纵向坐标」，
 *  实际顶点位置每帧由 _updateComets 重算（含弯曲 / 宽度 / 微颤）。 */
function makeCometRibbonGeometry(segments) {
  const n = segments;
  const pos = new Float32Array((n + 1) * 2 * 3);
  const alpha = new Float32Array((n + 1) * 2);
  const vv = new Float32Array((n + 1) * 2);
  const idx = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = Math.pow(1 - t, 1.55) * 0.95; // 基亮尖淡
    for (let s = 0; s < 2; s++) {
      const k = i * 2 + s;
      alpha[k] = a;
      vv[k] = t;
    }
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  geo.setAttribute('aV', new THREE.BufferAttribute(vv, 1));
  geo.setIndex(idx);
  return geo;
}

/* ── 小行星带：软圆边 + 逐粒子尺寸的岩石颗粒（参考示意图的清晰颗粒环带）── */
const BELT_VERT = `
attribute float aSize;
attribute vec3 aColor;
varying vec3 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (300.0 / max(0.001, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;
const BELT_FRAG = `
precision mediump float;
varying vec3 vColor;
void main() {
  float a = smoothstep(0.5, 0.16, length(gl_PointCoord - vec2(0.5)));
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
}`;
function makeBeltMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: BELT_VERT,
    fragmentShader: BELT_FRAG,
    transparent: true,
    depthWrite: false,
  });
}

/* ── 彗星轨道辅助：椭圆相位点与速度方向（见下方 orbitPoint / orbitVel）── */

/** 把「轨道平面内的 (x,z)」按倾角 inc、升交点 node 变换到世界坐标（线性，位置/速度通用） */
function orbitPoint(a, b, phi, inc, node, out) {
  const x = a * Math.cos(phi);
  const z = b * Math.sin(phi);
  const y1 = -z * Math.sin(inc);
  const z1 = z * Math.cos(inc);
  const x2 = x * Math.cos(node) + z1 * Math.sin(node);
  const y2 = y1;
  const z2 = -x * Math.sin(node) + z1 * Math.cos(node);
  return out.set(x2, y2, z2);
}
/** 轨道上某相位处的速度方向（世界系，已归一化）——用于尘埃尾的滞后弯曲 */
function orbitVel(a, b, phi, inc, node, out) {
  const vx = -a * Math.sin(phi);
  const vz = b * Math.cos(phi);
  const y1 = -vz * Math.sin(inc);
  const z1 = vz * Math.cos(inc);
  const x2 = vx * Math.cos(node) + z1 * Math.sin(node);
  const y2 = y1;
  const z2 = -vx * Math.sin(node) + z1 * Math.cos(node);
  out.set(x2, y2, z2);
  const len = out.length() || 1;
  return out.multiplyScalar(1 / len);
}

/**
 * 自转显示系数。自转与公转共用 timeScale，因此暂停时自转也停。
 * 不取真实自转/公转比（地球真实比值约 365，会糊成一片），这里只求「看得见在转」。
 * 地球 spin=1 → 约 2s 转一圈，转动清晰可辨又不至糊成一片。
 */
const SPIN_K = 3.0;

// 真实数据（半径以地球半径 R⊕ 为单位；a 为半长轴 AU；T 为公转周期 年）
const SUN = {
  id: 'sun',
  name: '太阳',
  type: '恒星 · G2V 主序星',
  color: 0xffd27a,
  R: 109.0, // 太阳半径 / 地球半径
  displayRadius: 1.5,
  desc:
    '太阳是太阳系唯一的恒星，质量占整个太阳系的 99.86%。其核心通过氢核聚变释放能量，' +
    '表面温度约 5500℃，是地球上一切光与热、乃至生命的根源。在「三体」的语境之外，' +
    '它却是安静、孤独而恒久的存在——群星环绕，却无星相伴。',
  facts: [
    ['直径', '约 1,391,000 km（109 R⊕）'],
    ['质量占比', '太阳系总质量 99.86%'],
    ['表面温度', '约 5500 ℃'],
    ['核心温度', '约 1500 万 ℃'],
    ['年龄', '约 46 亿年'],
  ],
};

// 注：spin 仅决定「显示用自转快慢」（非真实比例，否则地球一圈公转要自转 365 次会糊成一片）；
//     tilt 取真实转轴倾角（黄赤交角），使天王星「躺着自转」、金星逆向等特征可被看见。
const PLANETS = [
  {
    id: 'mercury', name: '水星', type: '类地行星', color: 0x9c8b7a,
    a: 0.387, T: 0.2408, R: 0.383, inc: 7.0, spin: 0.6, tilt: 0.03, moons: 0,
    desc: '距太阳最近、体积最小的行星。没有真正的大气层，昼夜温差极端，白天可达 430℃、夜晚骤降至 -180℃。它的公转最快，一年只有 88 天。',
    facts: [['直径', '4,879 km'], ['与太阳距离', '0.39 AU（5,790 万 km）'], ['公转周期', '88 天'], ['自转周期', '58.6 天'], ['天然卫星', '0']],
  },
  {
    id: 'venus', name: '金星', type: '类地行星', color: 0xd9b38c,
    a: 0.723, T: 0.6152, R: 0.949, inc: 3.4, spin: -0.3, tilt: 2.64, moons: 0,
    desc: '被浓密的二氧化碳大气包裹，温室效应失控，表面均温高达 465℃，是太阳系最热的行星。它自转方向与多数行星相反，且一天比一年还长。',
    facts: [['直径', '12,104 km'], ['与太阳距离', '0.72 AU（1.08 亿 km）'], ['公转周期', '225 天'], ['自转周期', '243 天（逆向）'], ['天然卫星', '0']],
  },
  {
    id: 'earth', name: '地球', type: '类地行星 · 家园', color: 0x4a90d9,
    a: 1.0, T: 1.0, R: 1.0, inc: 0.0, spin: 1.0, tilt: 23.44, moons: 1,
    desc: '目前已知唯一孕育生命的世界。液态水覆盖七成表面，磁场与大气层共同守护着脆弱而珍贵的生机。在浩瀚星海中，它只是一粒淡蓝的尘埃。',
    facts: [['直径', '12,742 km'], ['与太阳距离', '1.00 AU（1.496 亿 km）'], ['公转周期', '365.25 天'], ['自转周期', '23.9 小时'], ['天然卫星', '1（月球）']],
  },
  {
    id: 'mars', name: '火星', type: '类地行星', color: 0xc1440e,
    a: 1.524, T: 1.881, R: 0.532, inc: 1.85, spin: 0.97, tilt: 25.19, moons: 2,
    desc: '红色的荒漠世界，氧化铁赋予它锈红的外表。远古曾有过液态水与更厚的大气，如今寒冷干燥。它是人类最向往的下一个落脚点。',
    facts: [['直径', '6,779 km'], ['与太阳距离', '1.52 AU（2.28 亿 km）'], ['公转周期', '687 天'], ['自转周期', '24.6 小时'], ['天然卫星', '2（火卫一/二）']],
  },
  {
    id: 'jupiter', name: '木星', type: '气态巨行星', color: 0xd8a47f,
    a: 5.203, T: 11.86, R: 11.21, inc: 1.3, spin: 2.4, tilt: 3.13, moons: 95,
    desc: '太阳系最大的行星，质量是其余七颗行星总和的 2.5 倍。标志性的「大红斑」是一场持续数百年的巨型风暴。它像一位沉默的守护者，用引力清扫着内太阳系。',
    facts: [['直径', '139,820 km'], ['与太阳距离', '5.20 AU（7.78 亿 km）'], ['公转周期', '11.86 年'], ['自转周期', '9.9 小时'], ['天然卫星', '95+']],
  },
  {
    id: 'saturn', name: '土星', type: '气态巨行星', color: 0xe3d2a0, ring: true,
    a: 9.537, T: 29.46, R: 9.45, inc: 2.49, spin: 2.2, tilt: 26.73, moons: 146,
    desc: '以壮丽的行星环著称，环主要由冰粒与岩屑构成。它密度极低，比水还轻。它是太阳系中肉眼可见最遥远、也最令人惊叹的风景。',
    facts: [['直径', '116,460 km'], ['与太阳距离', '9.54 AU（14.3 亿 km）'], ['公转周期', '29.46 年'], ['自转周期', '10.7 小时'], ['天然卫星', '146+']],
  },
  {
    id: 'uranus', name: '天王星', type: '冰巨行星', color: 0x9fd8e0,
    a: 19.19, T: 84.01, R: 4.01, inc: 0.77, spin: -1.4, tilt: 97.77, moons: 27,
    desc: '一颗「躺着自转」的冰巨星，自转轴几乎平躺在轨道面上。大气中的甲烷吸收红光，使它呈现幽冷的青蓝色，孤独地游荡在太阳系的外缘。',
    facts: [['直径', '50,724 km'], ['与太阳距离', '19.19 AU（28.7 亿 km）'], ['公转周期', '84.01 年'], ['自转周期', '17.2 小时（侧躺）'], ['天然卫星', '27']],
  },
  {
    id: 'neptune', name: '海王星', type: '冰巨行星', color: 0x4f6fd9,
    a: 30.07, T: 164.8, R: 3.88, inc: 1.77, spin: 1.5, tilt: 28.32, moons: 14,
    desc: '距太阳最远的行星，深蓝的表面下隐藏着太阳系最猛烈的风暴，风速可超 2000 km/h。它是先由数学计算预言、而后才被观测证实的行星。',
    facts: [['直径', '49,244 km'], ['与太阳距离', '30.07 AU（45 亿 km）'], ['公转周期', '164.8 年'], ['自转周期', '16.1 小时'], ['天然卫星', '14']],
  },
];

/**
 * 月球 · 地球唯一的天然卫星
 * --------------------------------------------------------------------------
 * 说明：真实比例下地月距离仅 0.0026 AU（约 30 个地球直径），在本图的显示尺度里
 * 会小到完全看不见，因此绕地轨道半径做了艺术放大（orbit 字段）；
 * 但「周期 T」「轨道倾角 inc」「相对大小 R」仍严格取真实值。
 */
const MOON = {
  id: 'moon',
  parent: 'earth',
  name: '月球',
  type: '天然卫星 · 地球的独子',
  color: 0xc9ccd4,
  R: 0.273, // 半径 / 地球半径
  displayRadius: 0.13, // 显示半径（相对地球 0.46，约为其 1/3.5）
  orbit: 0.9, // 显示用绕地轨道半径（艺术放大，与相邻行星轨道保持间隙）
  T: 27.32 / 365.25, // 恒星月 ≈ 0.0748 年
  inc: 5.1, // 轨道相对黄道倾角（度）
  desc:
    '地球唯一的天然卫星，也是人类迄今为止唯一踏足过的外星世界。它被潮汐锁定，' +
    '永远以同一面朝向地球，所以我们自古以来只认得它的「正面」。主流理论认为，' +
    '它诞生于 45 亿年前一颗火星大小的天体与原始地球的猛烈撞击。如今它正以每年约 ' +
    '3.8 厘米的速度悄然远去——终有一天，它小到再也遮不住太阳，日全食将成为绝响。',
  facts: [
    ['直径', '3,474 km（约地球的 1/4）'],
    ['与地球距离', '384,400 km（约 30 个地球直径）'],
    ['公转周期', '27.32 天（恒星月）'],
    ['自转周期', '27.32 天（潮汐锁定）'],
    ['表面重力', '1.62 m/s²（地球的 1/6）'],
    ['退行速度', '每年约 3.8 cm'],
  ],
};

/**
 * 小行星带（火星与木星之间）
 * --------------------------------------------------------------------------
 * 真实小行星带约 2.1–3.3 AU。这里在显示半径 14.5–20.5 之间撒大量碎石，
 * 按开普勒规律「内快外慢」绕日公转（角速度 ∝ r^-1.5），用 Points 高效渲染。
 */
const AST_BELT = {
  rIn: 14.5,
  rOut: 20.5,
  count: 3200,    // 颗粒数量（参考示意图：清晰可辨的密集环带）
  thickness: 1.2, // 垂直于轨道面的厚度散布
  spinK: 4.0,     // 公转显示系数（与行星共用 years 时钟）
  refR: 17.0,     // 归一化参考半径
};

/**
 * 彗星 v2（太阳置于椭圆中心的可视化模型）
 * --------------------------------------------------------------------------
 * 用 a（半长轴）/ b（= a·bRatio，半短轴）描述一个以太阳为中心的细长椭圆；
 * 公转为开普勒式变速（见 _cometEpochAngle）：近日快、远日慢。
 * phase = 初始轨道纪元（0..1）；T = 显示周期（年）；inc / node 让各彗星
 * 轨道平面互不相同。
 */
const COMETS = [
  { id: 'c1', name: '彗星 · 掠日者', type: '周期彗星', color: 0x9fd8ff, a: 26, bRatio: 0.12, inc: 18, node: 20, phase: 0.5, T: 14,
    desc: '一颗近日点深入内太阳系的周期彗星。开普勒变速使它俯冲太阳时骤然加速，冰蓝的流光丝带被太阳风拉长；每当径向穿越行星轨道，都会激起一圈扩散的震波。',
    facts: [['远日点', '约天王星轨道'], ['近日点', '金星轨道内侧'], ['显示周期', '14 年']] },
  { id: 'c2', name: '彗星 · 中周期', type: '周期彗星', color: 0xbfe8d8, a: 16, bRatio: 0.38, inc: 32, node: 140, phase: 0.1, T: 9,
    desc: '轨道较「胖」的短周期彗星，倾角更大，常在火星与土星之间往复。青白的丝带在阳光下弯成柔和的弧，偶尔与木星擦肩而过，尾梢被引力牵扯出明显的弧度。',
    facts: [['远日点', '土星轨道附近'], ['近日点', '火星轨道外侧'], ['显示周期', '9 年']] },
  { id: 'c3', name: '彗星 · 远游客', type: '长周期彗星', color: 0xffd9a0, a: 34, bRatio: 0.26, inc: 11, node: 250, phase: 0.0, T: 22,
    desc: '来自太阳系外缘的长周期访客，大部分生命在冰冷幽暗中缓缓漂行；唯接近太阳的短暂时光里骤然明亮，金色的流光丝带在海王星轨道之外徐徐展开。',
    facts: [['远日点', '海王星之外'], ['近日点', '小行星带外侧'], ['显示周期', '22 年']] },
];

/** 显示用轨道半径：轻微压缩，使外行星不至于太远 */
function orbitRadius(a) {
  return 2.0 + 9.5 * Math.pow(a, 0.42);
}
/** 显示用天体半径：避免木星/土星与轨道尺度失衡 */
function bodyRadius(R) {
  return 0.12 + 0.34 * Math.pow(R, 0.45);
}

/**
 * 程序化行星表面纹理
 * --------------------------------------------------------------------------
 * 关键：纯色光滑球即使代码里在转，肉眼也完全看不出来（没有可辨识特征）。
 * 这里用 2D canvas 现画一张贴图，使自转「可见」：
 *   - 类地/岩质行星：基底色 + 随机明暗斑块（撞击坑/地貌）
 *   - 地球：蓝海 + 绿褐大陆 + 极冠 + 薄云
 *   - 气态/冰巨行星：水平条带；木星额外有「大红斑」
 * 全部为同步绘制，无外部资源，单文件离线自包含。
 */
function makePlanetTexture(p) {
  const w = 1024, h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const base = new THREE.Color(p.color);
  const css = (c) => '#' + c.getHexString();
  const lighten = (a) => base.clone().lerp(new THREE.Color(0xffffff), a);
  const darken = (a) => base.clone().lerp(new THREE.Color(0x000000), a);
  const fill = (c) => { ctx.fillStyle = c; ctx.fillRect(0, 0, w, h); };
  const blobs = (color, n, rMin, rMax, alpha) => {
    ctx.globalAlpha = alpha; ctx.fillStyle = color;
    for (let i = 0; i < n; i++) {
      const x = Math.random() * w, y = Math.random() * h;
      const r = rMin + Math.random() * (rMax - rMin);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  };
  // 撞击坑：暗底 + 亮边，高反差，便于追踪自转
  const crater = (x, y, r) => {
    ctx.globalAlpha = 1;
    ctx.fillStyle = css(darken(0.5));
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = css(lighten(0.45)); ctx.lineWidth = Math.max(1.5, r * 0.22);
    ctx.beginPath(); ctx.arc(x, y, r * 0.96, 0, Math.PI * 2); ctx.stroke();
  };
  // 一个醒目的「地标」斑块（高反差），让球体自转一眼可辨
  const landmark = (x, y, r, color, alpha = 0.95) => {
    ctx.globalAlpha = alpha; ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  };

  switch (p.id) {
    case 'earth':
      fill(css(darken(0.12)));                                   // 深蓝海洋，衬托大陆
      blobs(css(new THREE.Color(0x2e7d32)), 40, 26, 64, 1.0);    // 大块绿色大陆
      blobs(css(new THREE.Color(0x6b4f2a)), 22, 14, 34, 0.95);   // 褐色山地
      ctx.globalAlpha = 0.9; ctx.fillStyle = '#eef4ff';          // 极冠
      ctx.fillRect(0, 0, w, 30); ctx.fillRect(0, h - 30, w, 30); ctx.globalAlpha = 1;
      landmark(w * 0.5, h * 0.42, 34, '#ffffff', 0.5);           // 云团地标
      blobs('#ffffff', 30, 10, 30, 0.4);                         // 云带
      break;
    case 'mars':
      fill(css(base));
      blobs(css(darken(0.45)), 50, 12, 40, 0.85);                // 深色月海状地貌
      blobs(css(lighten(0.3)), 30, 8, 26, 0.6);                  // 亮尘埃区
      ctx.globalAlpha = 0.9; ctx.fillStyle = '#f3ece4';          // 极冠（更大更亮）
      ctx.fillRect(0, 0, w, 22); ctx.fillRect(0, h - 22, w, 22); ctx.globalAlpha = 1;
      landmark(w * 0.62, h * 0.55, 26, css(darken(0.55)));       // 暗斑地标
      break;
    case 'venus':
      fill(css(base));
      for (let i = 0; i < 26; i++) {                             // 强对比云纹条带
        const y = (i / 26) * h + (Math.random() - 0.5) * 6;
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = i % 2 ? css(lighten(0.3)) : css(darken(0.22));
        ctx.fillRect(0, y, w, h / 26 + 2);
      }
      ctx.globalAlpha = 1;
      landmark(w * 0.4, h * 0.5, 30, css(darken(0.28)));         // 暗斑地标
      break;
    case 'mercury':
      fill(css(base));
      for (let i = 0; i < 140; i++) {
        crater(Math.random() * w, Math.random() * h, 4 + Math.random() * 16);
      }
      landmark(w * 0.55, h * 0.45, 22, css(lighten(0.4)));       // 亮区地标
      break;
    case 'jupiter': {
      for (let y = 0; y < h; y += 2) {                           // 强振幅条带
        const t = Math.sin(y * 0.085);
        const c = base.clone().lerp(new THREE.Color(0xffffff), 0.22 + 0.3 * Math.abs(t));
        c.lerp(new THREE.Color(0x000000), 0.18 * (1 - Math.abs(t)));
        ctx.fillStyle = css(c); ctx.fillRect(0, y, w, 2);
      }
      ctx.globalAlpha = 0.95; ctx.fillStyle = '#b5391c';          // 大红斑（放大）
      ctx.beginPath(); ctx.ellipse(w * 0.66, h * 0.62, 70, 38, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.5; ctx.fillStyle = '#e9764b';
      ctx.beginPath(); ctx.ellipse(w * 0.66, h * 0.62, 44, 22, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case 'saturn':
      for (let y = 0; y < h; y += 2) {
        const t = Math.sin(y * 0.1);
        const c = base.clone().lerp(new THREE.Color(0xffffff), 0.18 + 0.28 * Math.abs(t));
        c.lerp(new THREE.Color(0x000000), 0.12 * (1 - Math.abs(t)));
        ctx.fillStyle = css(c); ctx.fillRect(0, y, w, 2);
      }
      landmark(w * 0.5, h * 0.5, 24, css(darken(0.3)));          // 暗斑地标
      break;
    case 'uranus':
      fill(css(base));
      for (let y = 0; y < h; y += 4) {
        const t = Math.sin(y * 0.06);
        const c = base.clone().lerp(new THREE.Color(0xffffff), 0.12 + 0.12 * Math.abs(t));
        c.lerp(new THREE.Color(0x000000), 0.08 * (1 - Math.abs(t)));
        ctx.fillStyle = css(c); ctx.fillRect(0, y, w, 4);
      }
      landmark(w * 0.45, h * 0.5, 26, css(darken(0.35)));        // 暗斑地标
      break;
    case 'neptune':
      fill(css(base));
      for (let y = 0; y < h; y += 4) {
        const t = Math.sin(y * 0.05 + 1);
        const c = base.clone().lerp(new THREE.Color(0xffffff), 0.12 + 0.12 * Math.abs(t));
        c.lerp(new THREE.Color(0x000000), 0.08 * (1 - Math.abs(t)));
        ctx.fillStyle = css(c); ctx.fillRect(0, y, w, 4);
      }
      ctx.globalAlpha = 0.9; ctx.fillStyle = '#10204f';          // 大暗斑（放大）
      ctx.beginPath(); ctx.ellipse(w * 0.5, h * 0.46, 46, 26, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      break;
    default:
      fill(css(base));
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/** 太阳表面纹理：明亮的米黄基底 + 颗粒状米粒组织，使自转可见 */
function makeSunTexture() {
  const w = 512, h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffd27a'; ctx.fillRect(0, 0, w, h);
  const blobs = (color, n, rMin, rMax, alpha) => {
    ctx.globalAlpha = alpha; ctx.fillStyle = color;
    for (let i = 0; i < n; i++) {
      const x = Math.random() * w, y = Math.random() * h;
      const r = rMin + Math.random() * (rMax - rMin);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  };
  blobs('#fff0c0', 120, 3, 10, 0.5);  // 亮米粒
  blobs('#e6a23c', 90, 3, 9, 0.4);    // 暗米粒
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/** 月球表面纹理：灰色 + 高反差撞击坑（亮边暗底，便于看清单面朝向） */
function makeMoonTexture() {
  const w = 512, h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#c9ccd4'; ctx.fillRect(0, 0, w, h);
  const crater = (x, y, r) => {
    ctx.fillStyle = '#8c8f99';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#eef0f4'; ctx.lineWidth = Math.max(1.5, r * 0.22);
    ctx.beginPath(); ctx.arc(x, y, r * 0.94, 0, Math.PI * 2); ctx.stroke();
  };
  for (let i = 0; i < 90; i++) {
    crater(Math.random() * w, Math.random() * h, 4 + Math.random() * 16);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

export class SolarSystem {
  constructor(scene, camera = null) {
    this.scene = scene;
    this.camera = camera; // 供穿越震波圆环朝向相机（可缺省）
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    this.pickMeshes = [];
    this.years = 0;
    this.cometClock = 0; // 真实时间累计（驱动丝带流动与光晕呼吸，不受暂停影响）
    this.maxRadius = 1;
    this.objects = []; // { data, orbitGroup, pivot, mesh, baseAngle }
    this.moon = null; // 月球（挂在地球的轨道组内）
    this.belt = null; // 小行星带（Points）
    this.comets = []; // 彗星列表
    this.cometPulses = []; // 彗星穿越行星轨道的扩散震波

    // ── 太阳 ────────────────────────────────────────────────
    const sunGeo = new THREE.SphereGeometry(1, 48, 32);
    const sunMat = new THREE.MeshBasicMaterial({ map: makeSunTexture(), color: 0xffffff });
    this.sunMesh = new THREE.Mesh(sunGeo, sunMat);
    this.sunMesh.scale.setScalar(SUN.displayRadius);
    this.sunMesh.userData.info = this._info(SUN, null);
    const sunGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getGlowTexture(),
        color: SUN.color,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    sunGlow.scale.setScalar(SUN.displayRadius * 5);
    this.sunMesh.add(sunGlow);
    const sunLight = new THREE.PointLight(0xfff0d0, 4.0, 0, 1.4);
    this.sunMesh.add(sunLight);
    this.group.add(this.sunMesh);
    this.pickMeshes.push(this.sunMesh);

    // ── 行星 ────────────────────────────────────────────────
    for (const p of PLANETS) {
      const r = orbitRadius(p.a);
      this.maxRadius = Math.max(this.maxRadius, r);

      const orbitGroup = new THREE.Group();
      orbitGroup.rotation.x = (p.inc * Math.PI) / 180;
      this.group.add(orbitGroup);

      // 轨道环
      const ringPts = [];
      const N = 256;
      for (let i = 0; i <= N; i++) {
        const t = (i / N) * Math.PI * 2;
        ringPts.push(new THREE.Vector3(r * Math.cos(t), 0, r * Math.sin(t)));
      }
      const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
      const ringMat = new THREE.LineBasicMaterial({
        color: p.color,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      });
      const ring = new THREE.LineLoop(ringGeo, ringMat);
      orbitGroup.add(ring);

      // 公转位置组：每帧把本组平移到轨道上的当前位置
      const planetGroup = new THREE.Group();
      orbitGroup.add(planetGroup);

      // 自转轴倾角组：绕 Z 轴倾斜 p.tilt（真实转轴倾角），
      // 球体在组内绕自身 Y 轴自转，于是自转轴随倾角倾斜——天王星近乎横躺。
      const tiltGroup = new THREE.Group();
      tiltGroup.rotation.z = (p.tilt * Math.PI) / 180;
      planetGroup.add(tiltGroup);

      // 行星本体（贴上程序化表面纹理，使自转可见）
      const dr = bodyRadius(p.R);
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 48, 32),
        new THREE.MeshStandardMaterial({
          map: makePlanetTexture(p),
          color: 0xffffff,
          emissive: new THREE.Color(p.color).multiplyScalar(0.10),
          roughness: 0.9,
          metalness: 0.0,
        })
      );
      mesh.scale.setScalar(dr);
      mesh.userData.info = this._info(p, r);
      tiltGroup.add(mesh);

      // 土星环（挂在倾角组内，随行星自转轴一起倾斜，落在赤道面上）
      if (p.ring) {
        const ringGeo2 = new THREE.RingGeometry(dr * 1.4, dr * 2.3, 64);
        const ringMat2 = new THREE.MeshBasicMaterial({
          color: 0xcdbf95,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
        });
        const sgRing = new THREE.Mesh(ringGeo2, ringMat2);
        sgRing.rotation.x = Math.PI / 2; // 环在赤道面内
        tiltGroup.add(sgRing);
      }

      this.objects.push({
        data: p,
        r,
        dr,
        orbitGroup,
        planetGroup,
        tiltGroup,
        mesh,
        baseAngle: Math.random() * Math.PI * 2,
      });
      this.pickMeshes.push(mesh);
    }

    this._buildMoon();
    this._buildBelt();
    this._buildComets();
  }

  /**
   * 建造月球：挂在「地球轨道组」内，因此自动继承地球的公转与轨道倾角，
   * 每帧只需把 pivot 对齐到地球的局部位置即可。
   */
  _buildMoon() {
    const earth = this.objects.find((o) => o.data.id === MOON.parent);
    if (!earth) return;

    const pivot = new THREE.Group();
    pivot.rotation.x = (MOON.inc * Math.PI) / 180;
    earth.orbitGroup.add(pivot);

    // 绕地轨道环（细线，随地球一起平移）
    const N = 128;
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * Math.PI * 2;
      pts.push(new THREE.Vector3(MOON.orbit * Math.cos(t), 0, MOON.orbit * Math.sin(t)));
    }
    pivot.add(
      new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({
          color: 0xdfe6f2,
          transparent: true,
          opacity: 0.34,
          depthWrite: false,
        })
      )
    );

    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 24),
      new THREE.MeshStandardMaterial({
        map: makeMoonTexture(),
        color: 0xffffff,
        // 给一点自发光，避免背光面在暗场里彻底消失
        emissive: new THREE.Color(MOON.color).multiplyScalar(0.08),
        roughness: 0.95,
        metalness: 0.0,
      })
    );
    mesh.scale.setScalar(MOON.displayRadius);
    pivot.add(mesh);

    // 拾取代理：月球本体太小不好点，套一个完全不可见的大球扩大命中范围
    const proxy = new THREE.Mesh(
      new THREE.SphereGeometry(MOON.displayRadius * 2.6, 12, 10),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        colorWrite: false,
      })
    );
    mesh.add(proxy);

    const baseAngle = Math.random() * Math.PI * 2;
    this.moon = { data: MOON, pivot, mesh, proxy, baseAngle, parent: earth };
    proxy.userData.info = this._moonInfo();
    // 只把代理放进拾取集合（本体不放，免得一次点击命中两次）
    this.pickMeshes.push(proxy);
  }

  /**
   * 建造小行星带：火星与木星之间撒大量碎石，绕日公转（内快外慢）。
   * 位置每帧由 years 重新计算，因此重置（years=0）自动归位。
   */
  _buildBelt() {
    const N = AST_BELT.count;
    const positions = new Float32Array(N * 3);
    const colors = new Float32Array(N * 3);
    const sizes = new Float32Array(N);
    const r = new Float32Array(N);
    const phase = new Float32Array(N);
    const speed = new Float32Array(N);
    const yJit = new Float32Array(N);
    const { rIn, rOut, thickness, spinK, refR } = AST_BELT;
    for (let i = 0; i < N; i++) {
      // 略向带中心聚集，并留出天然缝隙（柯克伍德空隙的观感）
      const u = Math.random();
      const rad = rIn + (rOut - rIn) * Math.pow(u, 0.85);
      const ph = Math.random() * Math.PI * 2;
      const sp = spinK * Math.pow(refR / rad, 1.5); // 开普勒：内圈更快
      const y = (Math.random() - 0.5) * thickness;
      r[i] = rad; phase[i] = ph; speed[i] = sp; yJit[i] = y;
      // 暖灰褐岩石色，亮度差异大（少数较亮的大块碎石更醒目，参考示意图）
      const l = 0.38 + Math.pow(Math.random(), 1.6) * 0.55;
      colors[i * 3] = l * (0.92 + Math.random() * 0.13);
      colors[i * 3 + 1] = l * (0.84 + Math.random() * 0.12);
      colors[i * 3 + 2] = l * (0.74 + Math.random() * 0.14);
      // 尺寸差异：多数细小，少数大块
      sizes[i] = 0.16 + Math.pow(Math.random(), 2.2) * 0.5;
      positions[i * 3] = rad * Math.cos(ph);
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = rad * Math.sin(ph);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    const points = new THREE.Points(geo, makeBeltMaterial());
    points.frustumCulled = false;
    this.group.add(points);
    this.belt = { points, r, phase, speed, yJit, count: N };
  }

  /** 每帧推进小行星带公转 */
  _updateBelt() {
    const b = this.belt;
    if (!b) return;
    const pos = b.points.geometry.attributes.position.array;
    const yrs = this.years;
    for (let i = 0; i < b.count; i++) {
      const ang = b.phase[i] + b.speed[i] * yrs;
      pos[i * 3] = b.r[i] * Math.cos(ang);
      pos[i * 3 + 1] = b.yJit[i];
      pos[i * 3 + 2] = b.r[i] * Math.sin(ang);
    }
    b.points.geometry.attributes.position.needsUpdate = true;
  }

  /**
   * 建造彗星 v2：每颗含
   *   - 白热彗核（小球体，可拾取）+ 呼吸彩色光晕（彗发）
   *   - 流光丝带尾（ribbon：白热→彗星色→淡、流动条纹、随日距伸缩）
   *   - 开普勒变速轨道查找表（角速度 ∝ 1/d²，近日快、远日慢）
   * 每帧在 _updateComets 里按日距重算丝带顶点、活动增益与轨道穿越震波。
   */
  _buildComets() {
    const RIBBON_N = 56; // 流光丝带段数
    for (const c of COMETS) {
      const a = c.a;
      const b = c.a * c.bRatio;
      const inc = (c.inc * Math.PI) / 180;
      const node = (c.node * Math.PI) / 180;

      // 白热彗核（可被射线拾取）
      const nucleus = new THREE.Mesh(
        new THREE.SphereGeometry(1, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      );
      nucleus.scale.setScalar(0.09);
      this.group.add(nucleus);

      // 呼吸彩色光晕（彗发）
      const halo = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: getGlowTexture(), color: c.color, transparent: true,
          opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
        })
      );
      this.group.add(halo);

      // 流光丝带尾
      const ribbonMat = makeCometRibbonMaterial(c.color);
      const ribbon = new THREE.Mesh(makeCometRibbonGeometry(RIBBON_N), ribbonMat);
      ribbon.frustumCulled = false;
      this.group.add(ribbon);

      // 开普勒变速查找表：dt ∝ d²·dφ，归一化后按纪元二分 → φ，
      // 于是角速度 ∝ 1/d²（近日点俯冲、远日点缓行）
      const TABLE_N = 512;
      const table = new Float32Array(TABLE_N + 1);
      {
        const p = new THREE.Vector3();
        let acc = 0;
        table[0] = 0;
        for (let i = 1; i <= TABLE_N; i++) {
          const phi0 = ((i - 1) / TABLE_N) * Math.PI * 2;
          const phi1 = (i / TABLE_N) * Math.PI * 2;
          const d0 = orbitPoint(a, b, phi0, inc, node, p).length();
          acc += (phi1 - phi0) * d0 * d0;
          table[i] = acc;
        }
        for (let i = 0; i <= TABLE_N; i++) table[i] /= acc;
      }

      const info = this._cometInfo(c);
      nucleus.userData.info = info;

      this.comets.push({
        data: c, a, b, inc, node, nucleus, halo, ribbon, ribbonMat,
        RIBBON_N, table, info, epoch: 0, _prevDist: null,
      });
      this.pickMeshes.push(nucleus);
    }
  }

  /** 开普勒变速映射：均匀推进的轨道纪元 e(0..1) → 相位 φ(rad)。 */
  _cometEpochAngle(o, e) {
    const table = o.table;
    const N = table.length - 1;
    let lo = 0, hi = N;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (table[mid] < e) lo = mid + 1; else hi = mid;
    }
    const i = Math.min(lo, N);
    const seg =
      i === 0
        ? 0
        : i - 1 + (e - table[i - 1]) / Math.max(1e-9, table[i] - table[i - 1]);
    return (seg / N) * Math.PI * 2;
  }

  /** 彗星专用信息对象 */
  _cometInfo(c) {
    const p = new THREE.Vector3();
    return {
      name: c.name,
      subtitle: c.type,
      color: c.color,
      radius: 0.6,
      desc: c.desc,
      staticRows: c.facts || [],
      live: () => {
        const obj = this.comets.find((o) => o.data.id === c.id);
        if (!obj) return [];
        obj.nucleus.getWorldPosition(p);
        const d = p.length();
        const dPeri = obj.a * obj.data.bRatio; // 近日点距离
        const speed = Math.pow(dPeri / Math.max(d, 1e-6), 1.5); // ∝ 1/d^1.5
        return [
          ['到太阳距离', d.toFixed(2)],
          ['公转相位', `${(obj.epoch * 100).toFixed(1)} %`],
          ['轨道速率', `${speed.toFixed(2)} ×近日点`],
        ];
      },
      getPos: () =>
        this.comets.find((o) => o.data.id === c.id)
          ? this.comets.find((o) => o.data.id === c.id).nucleus.getWorldPosition(new THREE.Vector3())
          : new THREE.Vector3(),
    };
  }

  /**
   * 每帧推进彗星 v2：
   *   开普勒变速轨道位置 → 光晕呼吸 → 流光丝带顶点重算
   *   （弯曲 / 宽度 / 微颤 / 行星引力掰弯）→ 径向穿越行星轨道时激起扩散震波。
   */
  _updateComets(dtReal, timeScale) {
    if (!this.comets.length) return;
    this.cometClock += dtReal; // 真实时间，驱动丝带流动与光晕呼吸
    const REF_DIST = 7.5; // 活动度参考日距（≈火星轨道外侧）
    const PLANET_PROBE = 9; // 行星引力影响半径（3D 距离）
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const antiSun = new THREE.Vector3();
    const vel = new THREE.Vector3();
    const antiVel = new THREE.Vector3();
    const side = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const pull = new THREE.Vector3();
    const cur = new THREE.Vector3();
    const wp = new THREE.Vector3();

    // 行星当前世界位置（用于引力摄动）
    const planetWorld = [];
    for (const o of this.objects) {
      wp.copy(o.planetGroup.position);
      o.orbitGroup.localToWorld(wp);
      planetWorld.push(wp.clone());
    }

    for (const o of this.comets) {
      // ── 开普勒变速轨道位置 ─────────────────────────────
      const epoch = (((o.data.phase + this.years / o.data.T) % 1) + 1) % 1;
      o.epoch = epoch;
      const phi = this._cometEpochAngle(o, epoch);
      orbitPoint(o.a, o.b, phi, o.inc, o.node, pos);
      o.nucleus.position.copy(pos);
      o.halo.position.copy(pos);

      const dist = pos.length();
      // 升华活动度 ∝ (REF/距离)²：近日点剧烈增亮拉长，远日点收缩成暗淡星点
      const activity = THREE.MathUtils.clamp(Math.pow(REF_DIST / dist, 2) * 0.9, 0.18, 1.7);

      // ── 光晕呼吸：白热彗核 + 彩色晕随日距与时间微胀缩 ──
      const breath = 0.9 + 0.1 * Math.sin(this.cometClock * 2.2 + phi * 3);
      o.halo.scale.setScalar(1.5 * (0.45 + 0.8 * activity) * breath);
      o.halo.material.opacity = 0.85 * Math.min(1, 0.35 + activity) * breath;
      o.nucleus.material.color.setScalar(0.55 + 0.45 * Math.min(1, activity));

      // ── 方向基：背日（丝带主方向）+ 反速度（弯曲目标）──
      antiSun.copy(pos).multiplyScalar(-1 / (dist || 1));
      orbitVel(o.a, o.b, phi, o.inc, o.node, vel);
      antiVel.copy(vel).multiplyScalar(-1);
      side.crossVectors(antiSun, up);
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0); else side.normalize();

      // ── 行星引力摄动：影响半径内最近的行星 ──────────────
      let grav = null, gravD = Infinity;
      for (const w of planetWorld) {
        const dd = w.distanceTo(pos);
        if (dd < PLANET_PROBE && dd < gravD) { gravD = dd; grav = w; }
      }
      const gravWeight = grav ? Math.pow(1 - gravD / PLANET_PROBE, 1.6) : 0;

      // ── 流光丝带顶点重算 ───────────────────────────────
      const tailLen = 15 * activity;
      const arr = o.ribbon.geometry.attributes.position.array;
      cur.copy(pos);
      const stepLen = tailLen / o.RIBBON_N;
      for (let i = 0; i <= o.RIBBON_N; i++) {
        const t = i / o.RIBBON_N;
        if (i > 0) {
          // 背日 → 反速度平滑弯曲，越靠尾尖弯得越多
          const bend = Math.pow(t, 1.15) * 0.85;
          dir.copy(antiSun).lerp(antiVel, bend);
          if (grav) {
            // 引力掰弯：把丝带朝行星方向再拉一点（近端弱、远端强）
            pull.copy(grav).sub(cur).normalize();
            dir.addScaledVector(pull, gravWeight * (0.35 + 0.65 * t));
          }
          dir.normalize();
          cur.addScaledVector(dir, stepLen);
        }
        // 微颤：垂直于丝带方向的等离子体抖动（尾尖更明显）
        const flutter = 0.14 * Math.sin(this.cometClock * 3.0 + i * 1.7) * (0.2 + t);
        const halfW = (0.5 * Math.pow(1 - t, 0.85) + 0.06) * (0.55 + 0.45 * activity);
        const k = i * 2;
        arr[k * 3] = cur.x + side.x * (halfW + flutter);
        arr[k * 3 + 1] = cur.y + side.y * (halfW + flutter);
        arr[k * 3 + 2] = cur.z + side.z * (halfW + flutter);
        arr[(k + 1) * 3] = cur.x - side.x * (halfW - flutter * 0.6);
        arr[(k + 1) * 3 + 1] = cur.y - side.y * (halfW - flutter * 0.6);
        arr[(k + 1) * 3 + 2] = cur.z - side.z * (halfW - flutter * 0.6);
      }
      o.ribbon.geometry.attributes.position.needsUpdate = true;
      o.ribbonMat.uniforms.uFlow.value = this.cometClock * (0.6 + 0.4 * activity);
      o.ribbonMat.uniforms.uGain.value = 0.65 * Math.min(1.4, activity);

      // ── 径向穿越行星轨道 → 激起扩散震波 ────────────────
      const prev = o._prevDist;
      for (const pl of this.objects) {
        const rp = pl.r;
        if (prev != null && (prev - rp) * (dist - rp) < 0) {
          this._spawnCometPulse(pos, rp, pl.data.color);
        }
      }
      o._prevDist = dist;
    }

    this._updateCometPulses(dtReal);
  }

  /** 在彗星径向穿越行星轨道处激起一圈扩散震波（加色混合圆环，朝向相机） */
  _spawnCometPulse(fromPos, rp, color) {
    const p = new THREE.Vector3().copy(fromPos).normalize().multiplyScalar(rp);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.62, 48),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    ring.position.copy(p);
    ring.frustumCulled = false;
    this.group.add(ring);
    this.cometPulses.push({ ring, t: 0, life: 1.6 });
  }

  /** 推进并回收扩散震波（扩散放大 + 淡出） */
  _updateCometPulses(dtReal) {
    for (let i = this.cometPulses.length - 1; i >= 0; i--) {
      const pu = this.cometPulses[i];
      pu.t += dtReal;
      const k = Math.min(1, pu.t / pu.life);
      pu.ring.scale.setScalar(0.3 + k * 1.7);
      pu.ring.material.opacity = 0.85 * (1 - k);
      if (this.camera) pu.ring.quaternion.copy(this.camera.quaternion);
      if (k >= 1) {
        this.group.remove(pu.ring);
        pu.ring.geometry.dispose();
        pu.ring.material.dispose();
        this.cometPulses.splice(i, 1);
      }
    }
  }

  /** 月球专用信息对象（不在 this.objects 里，需要单独的 live 取值逻辑） */
  _moonInfo() {
    const p = new THREE.Vector3();
    const e = new THREE.Vector3();
    return {
      name: MOON.name,
      subtitle: MOON.type,
      color: MOON.color,
      // 聚焦半径取「地–月间距」量级，点击后能把地月系统一起框进画面
      radius: 0.34,
      desc: MOON.desc,
      staticRows: MOON.facts,
      live: () => {
        if (!this.moon) return [];
        this.moon.mesh.getWorldPosition(p);
        this.moon.parent.mesh.getWorldPosition(e);
        const d = p.distanceTo(e);
        const f = (v) => (Math.abs(v) < 0.001 ? v.toFixed(3) : v.toFixed(2));
        const phi =
          ((this.moon.baseAngle + (2 * Math.PI * this.years) / MOON.T) % (Math.PI * 2) +
            Math.PI * 2) %
          (Math.PI * 2);
        return [
          ['与地球距离', d.toFixed(2)],
          ['公转角速度', `${((2 * Math.PI) / MOON.T).toFixed(2)} rad / 年`],
          ['轨道相位', `${((phi / (Math.PI * 2)) * 100).toFixed(1)} %`],
          ['已运行', `${(this.years / MOON.T).toFixed(1)} 个恒星月`],
          ['位置 (x, y, z)', `${f(p.x)}, ${f(p.y)}, ${f(p.z)}`],
        ];
      },
      getPos: () =>
        this.moon ? this.moon.mesh.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(),
    };
  }

  /** 把月球对齐到地球当前位置并推进绕地相位 */
  _updateMoon() {
    const mo = this.moon;
    if (!mo) return;
    mo.pivot.position.copy(mo.parent.planetGroup.position);
    const phi = mo.baseAngle + (2 * Math.PI * this.years) / mo.data.T;
    mo.mesh.position.set(mo.data.orbit * Math.cos(phi), 0, mo.data.orbit * Math.sin(phi));
    // 潮汐锁定：自转周期 = 公转周期，永远同一面朝向地球
    mo.mesh.rotation.y = phi;
  }

  /** 把数据包装成信息面板所需的 info 对象 */
  _info(data, r) {
    const staticRows = data.facts ? [...data.facts] : [];
    if (data.tilt != null) staticRows.push(['转轴倾角', `${data.tilt}°`]);
    return {
      name: data.name,
      subtitle: data.type,
      color: data.color,
      radius: data.displayRadius || bodyRadius(data.R),
      desc: data.desc,
      staticRows,
      // 实时坐标 / 速度（太阳系模式）——返回供信息面板渲染的行数组
      live: r == null
        ? () => []
        : () => {
            const m = this.objects.find((o) => o.data.id === data.id);
            const pos = m ? m.mesh.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
            const f = (v) => (Math.abs(v) < 0.001 ? v.toFixed(3) : v.toFixed(2));
            return [
              ['位置 (x, y, z)', `${f(pos.x)}, ${f(pos.y)}, ${f(pos.z)}`],
              ['公转角速度', `${((2 * Math.PI) / m.data.T).toFixed(3)} rad / 年`],
              ['轨道半径', `${m.r.toFixed(2)}`],
            ];
          },
      getPos: () => {
        if (data.id === 'sun') return this.sunMesh.position.clone();
        const m = this.objects.find((o) => o.data.id === data.id);
        return m ? m.mesh.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
      },
    };
  }

  setVisible(v) {
    this.group.visible = v;
  }

  /** 时间推进：years 由外部按真实时间累加，保证「各自周期」准确 */
  setYears(years) {
    this.years = years;
    for (const o of this.objects) {
      const ang = o.baseAngle + (2 * Math.PI * years) / o.data.T;
      o.planetGroup.position.set(o.r * Math.cos(ang), 0, o.r * Math.sin(ang));
    }
    this._updateMoon();
  }

  /** 每帧：推进公转（位置）+ 自转（绕各自倾斜的自转轴），二者共用 timeScale */
  update(dtReal, timeScale) {
    if (!this.group.visible) return;
    this.years += dtReal * timeScale * YEARS_PER_UNIT;
    // 太阳缓慢自转（视觉点缀）
    this.sunMesh.rotation.y += dtReal * timeScale * 0.4;
    for (const o of this.objects) {
      const ang = o.baseAngle + (2 * Math.PI * this.years) / o.data.T;
      o.planetGroup.position.set(o.r * Math.cos(ang), 0, o.r * Math.sin(ang));
      o.mesh.rotation.y += dtReal * timeScale * o.data.spin * SPIN_K;
    }
    this._updateMoon();
    this._updateBelt();
    this._updateComets(dtReal, timeScale);
  }

  /** 供相机取景：返回需要框住的最大半径 */
  getFrameRadius() {
    return this.maxRadius;
  }
}
