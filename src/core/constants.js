/**
 * 物理常数与全局默认参数
 *
 * 单位制：无量纲化（G = 1，质量 ~ 1，长度 ~ 1），
 * 这样周期解预设（如八字形轨道）的初始条件可以直接照搬文献数值。
 */

export const G = 1.0;

/** 三个天体固定的配色（赤 / 青 / 金 —— 致敬「三日凌空」） */
export const BODY_PALETTE = [
  { key: 'alpha', label: '天体 α', color: 0xff5f4d, css: '#ff5f4d' },
  { key: 'beta', label: '天体 β', color: 0x4dc4ff, css: '#4dc4ff' },
  { key: 'gamma', label: '天体 γ', color: 0xffc14d, css: '#ffc14d' },
];

/** 物理积分默认参数 */
export const PHYSICS_DEFAULTS = {
  /** 引力软化长度 ε：加速度分母用 (r² + ε²)^{3/2}，避免近距离奇点导致数值爆炸 */
  softening: 0.02,
  /** 单帧最大子步数（防止近距离飞越时卡死；超限则牺牲精度保帧率） */
  maxSubsteps: 50000,
  /**
   * 自适应步长安全系数：越小越精确越慢。
   * 取 1e-4 / 5e-4 是实测折中：蝴蝶、阴阳这类「近碰撞」轨道（最近距离 ~1e-2）
   * 在该容差下能量漂移可压到 1e-4 量级，而实测开销仅约 0.1 ms/帧。
   */
  etaVelocity: 1e-4,
  etaAcceleration: 5e-4,
  /**
   * 步长上下限。
   * dtMin 必须足够小：近距离飞越时若步长被下限卡住，能量会瞬间爆炸。
   * 实测 dtMin=1e-7 时 goggles 轨道能量漂移达 1e6%，放开到 1e-11 后降到 1e-3%。
   */
  dtMin: 1e-11,
  dtMax: 2e-2,
  /** 有效间距的绝对下限，防止 d_eff 塌缩到 0 */
  minSeparationFloor: 1e-9,
  /** 防卡死：单帧至少推进 minThrottleRate × dtTotal 的模拟时间 */
  minThrottleRate: 0.05,
  /** 子步循环内每隔多少步重估一次步长（防止帧中途突发的近距离飞越被错过） */
  recheckInterval: 16,
  /** 混沌对照（幽灵宇宙）施加在 α 天体 x 坐标上的默认初始扰动 */
  perturbation: 1e-9,
};

/** 渲染默认参数 */
export const RENDER_DEFAULTS = {
  trailCapacity: 2400,
  trailOpacity: 0.95,
  bloomStrength: 0.15,
  bloomRadius: 0.55,
  bloomThreshold: 0.12,
  showTrails: true,
  showBloom: true,
  showGrid: true,
  showStars: true,
  followAlpha: false,
  bodyRadiusScale: 0.11,
};

/** 音景默认参数（面板滑块初值从这里取，保证与实际生效值同源） */
export const AUDIO_DEFAULTS = {
  /** 主音量 0~1 */
  volume: 0.45,
  /** 默认音轨 id，与 CosmicAmbient 内置的首条音轨一致 */
  track: 'void',
};

/** 时间控制默认参数 */
export const TIME_DEFAULTS = {
  /** 每真实秒推进的模拟时间 */
  timeScale: 1.0,
  minScale: 0.05,
  maxScale: 8.0,
  paused: false,
};
