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
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    this.pickMeshes = [];
    this.years = 0;
    this.maxRadius = 1;
    this.objects = []; // { data, orbitGroup, pivot, mesh, baseAngle }
    this.moon = null; // 月球（挂在地球的轨道组内）

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
  }

  /** 供相机取景：返回需要框住的最大半径 */
  getFrameRadius() {
    return this.maxRadius;
  }
}
