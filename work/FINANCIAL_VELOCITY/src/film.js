// CONAS — FINANCIAL VELOCITY
// Deterministic 15-second 3D film. Every frame is a pure function of time t (seconds), so the
// renderer can step through it frame by frame (tools/render.cjs) and encode a real MP4.
import {
  THREE, EffectComposer, RenderPass, UnrealBloomPass, ShaderPass, OutputPass, RoomEnvironment,
} from '../lib/vendor.js';
import { panelTexture, textTexture, gridTexture, streakTexture, glowTexture } from './textures.js';

const params = new URLSearchParams(location.search);
const W = Number(params.get('w')) || window.innerWidth;
const H = Number(params.get('h')) || window.innerHeight;
const BLUR = Math.max(1, Number(params.get('blur')) || 1); // motion-blur sub-frames
const FPS = 60;
const DURATION = 15;

// ---------------------------------------------------------------- palette & helpers
const RED = new THREE.Color('#E5242B');
const WHITE = new THREE.Color('#F5F5F5');
const BG = new THREE.Color('#050505');

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261111);
const R = (a, b) => a + (b - a) * rand();
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const seg = (t, a, b) => clamp((t - a) / (b - a));
const lerp = (a, b, k) => a + (b - a) * k;
const ease = {
  inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2),
  outCubic: (x) => 1 - (1 - x) ** 3,
  inCubic: (x) => x * x * x,
  outExpo: (x) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x)),
  inExpo: (x) => (x <= 0 ? 0 : 2 ** (10 * x - 10)),
  outQuart: (x) => 1 - (1 - x) ** 4,
  inOutQuint: (x) => (x < 0.5 ? 16 * x ** 5 : 1 - (-2 * x + 2) ** 5 / 2),
};
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

// key points in the world (camera travels along -Z)
const TUNNEL_START = -800;
const TUNNEL_END = -2900;
const C = v3(0, 0, -3250); // collision centre
const P = v3(0, 0, -3620); // convergence / logo centre

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = BG.clone();
scene.fog = new THREE.FogExp2(0x050505, 0.0016);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.75;

const camera = new THREE.PerspectiveCamera(60, W / H, 0.3, 9000);
scene.add(camera);

// lights
scene.add(new THREE.AmbientLight(0x2a2c30, 0.6));
const key = new THREE.DirectionalLight(0xffffff, 3.2);
key.position.set(-1, 1.4, 0.6);
scene.add(key);
const rim = new THREE.DirectionalLight(0xff3a3a, 1.2);
rim.position.set(1, -0.6, -1);
scene.add(rim);
const redLights = [0, 1, 2].map(() => {
  const l = new THREE.PointLight(0xff2a2a, 0, 260, 1.6);
  scene.add(l);
  return l;
});
const whiteSpot = new THREE.PointLight(0xffffff, 0, 400, 1.4);
scene.add(whiteSpot);

// ---------------------------------------------------------------- materials
const M = {
  metal: new THREE.MeshStandardMaterial({ color: 0xc4c8ce, metalness: 1, roughness: 0.24 }),
  metalDark: new THREE.MeshStandardMaterial({ color: 0x4a4e55, metalness: 1, roughness: 0.38 }),
  charcoal: new THREE.MeshStandardMaterial({ color: 0x1b1d21, metalness: 0.6, roughness: 0.5 }),
  red: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.55, 0.17, 0.2), toneMapped: false }),
  redSoft: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.1, 0.12, 0.14), toneMapped: false, transparent: true, opacity: 0.9 }),
  white: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.15, 1.15, 1.15), toneMapped: false }),
  glass: new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.1, roughness: 0.04, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 2 }),
  wire: new THREE.LineBasicMaterial({ color: 0xdfe3e8, transparent: true, opacity: 0.55 }),
  wireRed: new THREE.LineBasicMaterial({ color: 0xe5242b, transparent: true, opacity: 0.8 }),
};

// Points never grow larger than maxPx on screen (otherwise particles next to the lens wash out the frame).
function clampPoints(material, maxPx) {
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uMaxPx = { value: maxPx };
    sh.vertexShader = sh.vertexShader.replace('#include <fog_vertex>', 'gl_PointSize = min(gl_PointSize, uMaxPx);\n#include <fog_vertex>').replace('uniform float size;', 'uniform float size;\nuniform float uMaxPx;');
  };
  return material;
}

// ---------------------------------------------------------------- animated registry
const anims = []; // (t) => void
const groups = {};
function group(name, from, to) {
  const g = new THREE.Group();
  g.userData.window = [from, to];
  scene.add(g);
  groups[name] = g;
  return g;
}

// text plane (texture from the real Pretendard font, rendered with canvas)
function textPlane(text, height, opts = {}) {
  const { tex, aspect } = textTexture(text, opts);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: opts.toneMapped ?? true, opacity: opts.opacity ?? 1 });
  if (opts.boost) mat.color.setScalar(opts.boost);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(height * aspect, height), mat);
  m.userData.baseOpacity = mat.opacity;
  return m;
}

// --------------------------------------------- 3D type from real glyph outlines
let GLYPHS = null;
const glyphGeoCache = new Map();
function glyphGeometry(word, depth = 0.18, bevel = 0.012) {
  const k = `${word}|${depth}`;
  if (glyphGeoCache.has(k)) return glyphGeoCache.get(k);
  const g = GLYPHS.words[word];
  const sp = new THREE.ShapePath();
  for (const c of g.cmds) {
    if (c[0] === 'M') sp.moveTo(c[1], c[2]);
    else if (c[0] === 'L') sp.lineTo(c[1], c[2]);
    else if (c[0] === 'Q') sp.quadraticCurveTo(c[1], c[2], c[3], c[4]);
    else if (c[0] === 'C') sp.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]);
  }
  // decide winding from the largest sub-path so holes (O, A, ㅇ…) come out right
  let largest = null; let area = 0;
  for (const p of sp.subPaths) {
    const pts = p.getPoints(4);
    const a = Math.abs(THREE.ShapeUtils.area(pts));
    if (a > area) { area = a; largest = pts; }
  }
  const shapes = sp.toShapes(!THREE.ShapeUtils.isClockWise(largest));
  const geo = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 3, curveSegments: 10 });
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  geo.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -depth / 2);
  geo.computeVertexNormals();
  glyphGeoCache.set(k, geo);
  return geo;
}
function solidWord(word, size, mat = M.metal, depth = 0.2) {
  const m = new THREE.Mesh(glyphGeometry(word, depth), mat);
  m.scale.setScalar(size);
  return m;
}

// ---------------------------------------------------------------- data
const KO = ['자본', '시장', '가치', '성장', '연결', '혁신', '미래', '변화', '질서', '확장', '전략', '신뢰'];
const EN = ['CAPITAL', 'GLOBAL', 'FINANCE', 'VELOCITY', 'EQUITY', 'MARKET', 'INVESTMENT', 'STRATEGY', 'INDEX', 'ASSET'];
const JAMO = ['ㅈ', 'ㅏ', 'ㅂ', 'ㅗ', 'ㄴ', 'ㅎ', 'ㅕ', 'ㄱ', 'ㅅ', 'ㅣ', 'ㅇ', 'ㄹ', 'ㅁ', 'ㅐ', 'ㅊ', 'ㅜ', 'ㅡ', 'ㅓ', 'ㅍ', 'ㅌ'];
function numberString() {
  const k = rand();
  if (k < 0.2) return `${rand() < 0.5 ? '+' : '-'}${R(0.1, 14).toFixed(2)}%`;
  if (k < 0.35) return R(10, 999).toFixed(2);
  if (k < 0.5) return Math.round(R(1000, 99999)).toLocaleString('en-US');
  if (k < 0.6) return `${pick(['USD/KRW', 'EUR/USD', 'USD/JPY', 'GBP/USD', 'USD/CNY'])} ${R(0.9, 1500).toFixed(2)}`;
  if (k < 0.7) return `${pick(['KR', 'US', 'DE', 'JP'])} ${pick(['2Y', '5Y', '10Y', '30Y'])} ${R(0.4, 5.2).toFixed(3)}%`;
  if (k < 0.8) return `${pick(['KOSPI', 'NASDAQ', 'S&P 500', 'NIKKEI', 'DAX', 'FTSE', 'HSI'])} ${R(1800, 42000).toFixed(2)}`;
  if (k < 0.88) return `${pick(['VOL', 'β', 'σ', 'Δ', 'IV'])} ${R(0.1, 60).toFixed(2)}`;
  if (k < 0.94) return `${Math.round(R(2000, 2030))}`;
  return `0x${Math.floor(R(0, 0xffffff)).toString(16).toUpperCase().padStart(6, '0')}`;
}

// ---------------------------------------------------------------- environment builders

function addPanel(parent, pos, w, opts = {}) {
  const kind = opts.kind;
  const tex = panelTexture(kind, Math.floor(rand() * 1e9));
  const h = w * 0.625;
  const g = new THREE.Group();
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.96 }));
  g.add(face);
  // glass back + metallic edge frame
  const back = new THREE.Mesh(new THREE.BoxGeometry(w * 1.03, h * 1.04, w * 0.02), M.glass);
  back.position.z = -w * 0.02;
  g.add(back);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w * 1.03, h * 1.04, w * 0.02)), rand() < 0.25 ? M.wireRed : M.wire);
  edges.position.z = -w * 0.02;
  g.add(edges);
  // scan line sweeping the panel
  const scan = new THREE.Mesh(new THREE.PlaneGeometry(w, h * 0.012), rand() < 0.5 ? M.red : M.white);
  scan.position.z = 0.02;
  g.add(scan);
  g.position.copy(pos);
  g.rotation.set(opts.rx ?? R(-0.4, 0.4), opts.ry ?? R(-0.6, 0.6), opts.rz ?? R(-0.12, 0.12));
  parent.add(g);
  const base = g.rotation.clone();
  const spin = v3(R(-0.08, 0.08), R(-0.15, 0.15), R(-0.04, 0.04));
  const drift = v3(R(-1.5, 1.5), R(-1, 1), R(-2, 2));
  const p0 = pos.clone();
  const phase = rand();
  g.userData.anim = (t) => {
    if (opts.static) return;
    g.rotation.set(base.x + spin.x * t, base.y + spin.y * t + Math.sin(t * 0.7 + phase * 6) * 0.04, base.z + spin.z * t);
    g.position.set(p0.x + drift.x * t, p0.y + drift.y * t, p0.z + drift.z * t);
    scan.position.y = h * (0.5 - ((t * (0.35 + phase * 0.5) + phase) % 1));
  };
  anims.push(g.userData.anim);
  return g;
}

function addRing(parent, radius, tube, opts = {}) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 12, Math.round(80 + radius)), opts.mat || M.metal);
  g.add(ring);
  // tick marks / mechanical teeth (instanced)
  const n = opts.ticks ?? Math.round(radius * 1.2);
  if (n) {
    const tick = new THREE.InstancedMesh(new THREE.BoxGeometry(tube * 0.7, tube * 2.4, tube * 1.6), M.metalDark, n);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const long = i % 6 === 0 ? 1.8 : 1;
      m4.compose(v3(Math.cos(a) * (radius + tube * 2.2), Math.sin(a) * (radius + tube * 2.2), 0), new THREE.Quaternion().setFromAxisAngle(v3(0, 0, 1), a + Math.PI / 2), v3(1, long, 1));
      tick.setMatrixAt(i, m4);
    }
    g.add(tick);
  }
  if (opts.arc) {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(radius * opts.arc.r, Math.max(0.12, tube * 0.18), 6, 120, opts.arc.len), opts.arc.white ? M.white : M.red);
    arc.rotation.z = R(0, Math.PI * 2);
    arc.userData.spin = opts.arc.spin ?? -0.8;
    g.add(arc);
    g.userData.arc = arc;
  }
  parent.add(g);
  return g;
}

function addSquareFrame(parent, size, thick, mat = M.metal) {
  const g = new THREE.Group();
  const s = size / 2;
  for (const [x, y, w, h] of [[0, s, size + thick, thick], [0, -s, size + thick, thick], [s, 0, thick, size], [-s, 0, thick, size]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, thick), mat);
    b.position.set(x, y, 0);
    g.add(b);
  }
  parent.add(g);
  return g;
}

function addWireCube(parent, size, red = false) {
  const g = new THREE.Group();
  g.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size, size, size)), red ? M.wireRed : M.wire));
  const inner = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size * 0.55, size * 0.55, size * 0.55)), M.wire);
  inner.rotation.set(0.6, 0.4, 0);
  g.add(inner);
  parent.add(g);
  return g;
}

function addPrism(parent, w, h, d) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M.glass));
  g.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)), M.wire));
  parent.add(g);
  return g;
}

// 3D candlestick formation (instanced bodies + wicks)
function addCandles(parent, n, scale = 1) {
  const g = new THREE.Group();
  const bodyUp = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xe8eaed, metalness: 0.3, roughness: 0.3, emissive: 0x222222 }), n);
  const bodyDn = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.05, 0.1, 0.12), toneMapped: false }), n);
  const wicks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 1, 0.12), M.metalDark, n);
  let price = 0; let up = 0; let dn = 0;
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    const o = price; price += R(-1.4, 1.5); const c = price;
    const hi = Math.max(o, c) + R(0.2, 1.2); const lo = Math.min(o, c) - R(0.2, 1.2);
    const x = (i - n / 2) * 1.5;
    m4.compose(v3(x, (o + c) / 2, 0), new THREE.Quaternion(), v3(0.9, Math.max(0.15, Math.abs(c - o)), 0.9));
    if (c >= o) bodyUp.setMatrixAt(up++, m4); else bodyDn.setMatrixAt(dn++, m4);
    m4.compose(v3(x, (hi + lo) / 2, 0), new THREE.Quaternion(), v3(1, hi - lo, 1));
    wicks.setMatrixAt(i, m4);
  }
  bodyUp.count = up; bodyDn.count = dn;
  g.add(bodyUp, bodyDn, wicks);
  // base rail
  const rail = new THREE.Mesh(new THREE.BoxGeometry(n * 1.5 + 2, 0.15, 1.2), M.metalDark);
  rail.position.y = -8;
  g.add(rail);
  g.scale.setScalar(scale);
  parent.add(g);
  return g;
}

// line chart as a tube in 3D
function addLineChart(parent, n, w, h, red) {
  const pts = [];
  let y = 0;
  for (let i = 0; i < n; i++) { y += R(-1, 1.1); pts.push(v3((i / (n - 1) - 0.5) * w, y * (h / n) * 2, Math.sin(i * 0.4) * 0.6)); }
  const curve = new THREE.CatmullRomCurve3(pts);
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, n * 3, Math.max(0.08, w * 0.004), 6), red ? M.red : M.white));
  // drop lines
  const drops = new THREE.InstancedMesh(new THREE.BoxGeometry(w * 0.003, 1, w * 0.003), M.metalDark, n);
  const m4 = new THREE.Matrix4();
  pts.forEach((p, i) => { const hh = p.y + h; m4.compose(v3(p.x, p.y - hh / 2, p.z), new THREE.Quaternion(), v3(1, Math.max(0.01, hh), 1)); drops.setMatrixAt(i, m4); });
  g.add(drops);
  parent.add(g);
  return g;
}

// volume histogram
function addHistogram(parent, n, w, h) {
  const g = new THREE.Group();
  const bars = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), M.metal, n);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    const bh = R(0.1, 1) * h;
    m4.compose(v3((i / n - 0.5) * w, bh / 2, 0), new THREE.Quaternion(), v3((w / n) * 0.7, bh, (w / n) * 0.7));
    bars.setMatrixAt(i, m4);
  }
  g.add(bars);
  parent.add(g);
  return g;
}

// light trail: long thin additive streak
function addTrail(parent, len, width, red) {
  const mat = new THREE.MeshBasicMaterial({ map: streakTexture(), color: red ? new THREE.Color(1.6, 0.18, 0.21) : new THREE.Color(1.1, 1.1, 1.1), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, len), mat);
  m.rotation.x = Math.PI / 2;
  parent.add(m);
  return m;
}

function addGrid(parent, w, d, step, opacity, y) {
  const pts = [];
  for (let x = -w / 2; x <= w / 2; x += step) pts.push(x, 0, -d / 2, x, 0, d / 2);
  for (let z = -d / 2; z <= d / 2; z += step) pts.push(-w / 2, 0, z, w / 2, 0, z);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x8a9099, transparent: true, opacity, depthWrite: false }));
  lines.position.y = y;
  parent.add(lines);
  return lines;
}

// ---------------------------------------------------------------- build the world
async function build() {
  GLYPHS = await (await fetch(new URL('./glyphs.json', import.meta.url))).json();
  const KINDS = ['candle', 'line', 'volume', 'table', 'bond', 'ticker', 'index', 'heat', 'gauge', 'stats', 'fx', 'orderbook'];

  // ---------- global background: grids, coordinate walls, particles ----------
  const bg = group('background', 0, 12.25);
  addGrid(bg, 900, 4600, 30, 0.12, -80).position.z = -1900;
  addGrid(bg, 900, 4600, 90, 0.07, 110).position.z = -1900;
  for (let i = 0; i < 10; i++) {
    const tex = gridTexture(Math.floor(rand() * 1e9));
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(260, 160), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.55 }));
    const side = i % 2 ? 1 : -1;
    wall.position.set(side * R(240, 330), R(-20, 30), -200 - i * 380);
    wall.rotation.y = -side * R(0.9, 1.25);
    bg.add(wall);
  }
  {
    const n = 5200;
    const pos = new Float32Array(n * 3); const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = R(-320, 320); pos[i * 3 + 1] = R(-140, 160); pos[i * 3 + 2] = R(200, -3800);
      const red = rand() < 0.14; const b = R(0.5, 1.3);
      col[i * 3] = b * (red ? 1.6 : 1); col[i * 3 + 1] = b * (red ? 0.15 : 1); col[i * 3 + 2] = b * (red ? 0.18 : 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(geo, clampPoints(new THREE.PointsMaterial({ size: 1.1, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, toneMapped: false }), 7 * (H / 1080)));
    bg.add(pts);
  }

  // ---------- SCENE 01: data universe ----------
  const uni = group('universe', 0, 6.4);
  const corridor = (x, y) => Math.abs(x) < 15 && Math.abs(y) < 9;
  for (let i = 0; i < 42; i++) {
    let x; let y;
    do { x = R(-170, 170); y = R(-70, 80); } while (corridor(x, y));
    if (i < 8) { x = (i % 2 ? 1 : -1) * R(17, 26); y = R(-8, 8); } // close passes
    addPanel(uni, v3(x, y, R(120, -760)), R(14, 42), { kind: KINDS[i % KINDS.length] });
  }
  for (let i = 0; i < 170; i++) {
    let x; let y;
    do { x = R(-180, 180); y = R(-80, 90); } while (corridor(x, y) && rand() < 0.85);
    const red = rand() < 0.22;
    const m = textPlane(numberString(), R(1.2, 7), { weight: rand() < 0.5 ? 800 : 600, color: red ? '#E5242B' : '#F5F5F5', boost: red ? 1.25 : 1, toneMapped: !red, opacity: R(0.55, 1) });
    m.position.set(x, y, R(160, -780));
    m.rotation.set(R(-0.3, 0.3), R(-0.7, 0.7), 0);
    uni.add(m);
    const sp = R(-0.25, 0.25); const r0 = m.rotation.y; const fl = rand();
    anims.push((t) => { m.rotation.y = r0 + Math.sin(t * sp * 4 + fl * 6) * 0.35; m.material.opacity = m.userData.baseOpacity * (0.75 + 0.25 * Math.sin(t * (6 + fl * 10) + fl * 20)); });
  }
  for (let i = 0; i < 36; i++) {
    const w = rand() < 0.5 ? pick(KO) : pick(EN);
    const m = textPlane(w, R(1.4, 4), { weight: 600, color: '#F5F5F5', opacity: R(0.4, 0.8) });
    let x; let y;
    do { x = R(-150, 150); y = R(-70, 70); } while (corridor(x, y));
    m.position.set(x, y, R(100, -760));
    m.rotation.y = R(-0.5, 0.5);
    uni.add(m);
  }
  // huge numbers that fly past (solid 3D type, partially cropped)
  const bigNums = [['2026', v3(-14, 6, -130), 26, M.metal], ['98.42', v3(19, -9, -330), 20, M.metal], ['+12.8%', v3(-12, -7, -520), 22, M.red], ['145.82', v3(15, 10, -700), 24, M.metal]];
  for (const [w, p, s, mat] of bigNums) {
    const m = solidWord(w, s, mat, 0.22);
    m.position.copy(p);
    m.rotation.set(R(-0.2, 0.2), R(-0.5, 0.5), R(-0.1, 0.1));
    uni.add(m);
    const r0 = m.rotation.clone(); const sp = R(0.15, 0.35) * (rand() < 0.5 ? -1 : 1);
    anims.push((t) => { m.rotation.y = r0.y + Math.sin(t * 0.9) * sp * 1.6; m.rotation.x = r0.x + sp * 0.3 * Math.sin(t * 0.7); });
  }
  for (let i = 0; i < 12; i++) {
    const c = addCandles(uni, Math.floor(R(18, 40)), R(0.6, 1.4));
    c.position.set(R(-150, 150), R(-60, 60), R(80, -760));
    if (corridor(c.position.x, c.position.y)) c.position.x += 60;
    c.rotation.set(R(-0.3, 0.3), R(-0.8, 0.8), 0);
    const r0 = c.rotation.y; const sp = R(-0.2, 0.2);
    anims.push((t) => { c.rotation.y = r0 + sp * t; });
  }
  for (let i = 0; i < 10; i++) {
    const l = addLineChart(uni, 40, R(20, 50), R(6, 14), rand() < 0.4);
    l.position.set(R(-160, 160), R(-50, 60), R(80, -760));
    if (corridor(l.position.x, l.position.y)) l.position.y += 30;
    l.rotation.y = R(-0.6, 0.6);
  }
  for (let i = 0; i < 6; i++) {
    const hgm = addHistogram(uni, 30, R(18, 34), R(4, 10));
    hgm.position.set(R(-160, 160), R(-60, -20), R(60, -760));
  }
  for (let i = 0; i < 12; i++) {
    const c = addWireCube(uni, R(4, 16), rand() < 0.3);
    c.position.set(R(-120, 120), R(-60, 60), R(100, -760));
    if (corridor(c.position.x, c.position.y)) c.position.x += 40;
    const s = v3(R(-0.6, 0.6), R(-0.6, 0.6), 0);
    anims.push((t) => { c.rotation.set(s.x * t, s.y * t, 0); });
  }
  for (let i = 0; i < 8; i++) {
    const f = addSquareFrame(uni, R(18, 50), R(0.5, 1.2), rand() < 0.5 ? M.metal : M.metalDark);
    f.position.set(R(-140, 140), R(-50, 60), R(60, -740));
    if (corridor(f.position.x, f.position.y)) f.position.y += 40;
    const sp = R(-0.3, 0.3); const r0 = v3(R(-0.5, 0.5), R(-0.8, 0.8), R(0, 1));
    anims.push((t) => { f.rotation.set(r0.x, r0.y + sp * t, r0.z + sp * 0.5 * t); });
  }
  for (let i = 0; i < 6; i++) {
    const p = addPrism(uni, R(4, 10), R(14, 40), R(4, 10));
    p.position.set(R(-140, 140), R(-40, 40), R(60, -740));
    if (corridor(p.position.x, p.position.y)) p.position.x -= 45;
    const sp = R(-0.2, 0.2);
    anims.push((t) => { p.rotation.y = sp * t; });
  }
  // universe rings (outside the path)
  for (let i = 0; i < 5; i++) {
    const r = addRing(uni, R(16, 40), R(0.4, 0.9), { ticks: 40, arc: { r: 0.86, len: Math.PI * R(0.4, 1.2), spin: R(-1, 1) } });
    r.position.set(pick([-1, 1]) * R(50, 120), R(-40, 50), R(40, -700));
    r.rotation.set(R(-1, 1), R(-1.2, 1.2), 0);
    const sp = R(-0.6, 0.6); const r0 = r.rotation.clone();
    anims.push((t) => { r.rotation.z = r0.z + sp * t; if (r.userData.arc) r.userData.arc.rotation.z = r.userData.arc.userData.spin * t; });
  }
  // light trails (move along z)
  const trails = [];
  for (let i = 0; i < 34; i++) {
    const red = rand() < 0.45;
    const tr = addTrail(uni, R(40, 160), R(0.12, 0.45), red);
    const ang = R(0, Math.PI * 2); const rad = R(18, 90);
    trails.push({ m: tr, x: Math.cos(ang) * rad, y: Math.sin(ang) * rad * 0.6, z0: R(150, -800), v: R(160, 520) * (rand() < 0.8 ? 1 : -1), span: [150, -820] });
  }
  // the massive geometric opening at the tunnel mouth
  {
    const gate = new THREE.Group();
    gate.position.set(0, 0, TUNNEL_START + 10);
    uni.add(gate);
    const oct = new THREE.Group();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const b = new THREE.Mesh(new THREE.BoxGeometry(94, 5, 6), M.metal);
      b.position.set(Math.cos(a) * 113, Math.sin(a) * 113, 0);
      b.rotation.z = a + Math.PI / 2;
      oct.add(b);
    }
    gate.add(oct);
    const r1 = addRing(gate, 98, 2.2, { ticks: 140, arc: { r: 0.93, len: Math.PI * 0.9, spin: 0.9 } });
    const r2 = addRing(gate, 84, 1.2, { ticks: 90, mat: M.metalDark, arc: { r: 1.04, len: Math.PI * 0.5, spin: -1.3, white: true } });
    const sq = addSquareFrame(gate, 150, 3, M.metalDark);
    sq.rotation.z = Math.PI / 4;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      addPanel(gate, v3(Math.cos(a) * 70, Math.sin(a) * 70, 8), 24, { kind: KINDS[(i + 3) % KINDS.length], rx: 0, ry: 0, rz: a + Math.PI / 2, static: true });
    }
    anims.push((t) => {
      oct.rotation.z = t * 0.12;
      r1.rotation.z = -t * 0.25; r1.userData.arc.rotation.z = t * 0.9;
      r2.rotation.z = t * 0.4; r2.userData.arc.rotation.z = -t * 1.3;
      sq.rotation.z = Math.PI / 4 - t * 0.08;
    });
  }

  // ---------- SCENE 02: velocity tunnel ----------
  const tun = group('tunnel', 1.8, 6.6);
  const stations = 19;
  for (let i = 0; i < stations; i++) {
    const z = TUNNEL_START - 40 - i * 110;
    const st = new THREE.Group();
    st.position.z = z;
    tun.add(st);
    const ring = addRing(st, 56, 1.4, { ticks: 72, arc: { r: 0.9, len: Math.PI * R(0.5, 1.3), spin: R(0.6, 1.6) * (i % 2 ? 1 : -1) } });
    const inner = addRing(st, R(40, 46), 0.45, { ticks: 0, mat: M.metalDark, arc: { r: 1.02, len: Math.PI * 0.35, spin: -2, white: i % 3 === 0 } });
    let frame = null;
    if (i % 2 === 0) { frame = addSquareFrame(st, 118, 1.8, M.metalDark); frame.rotation.z = Math.PI / 4; }
    let tilt = null;
    if (i % 3 === 1) { tilt = addRing(st, 48, 0.8, { ticks: 30 }); tilt.rotation.x = 0.42; }
    // rectangular data frame
    const rect = addSquareFrame(st, 90, 0.6, M.metal);
    rect.scale.set(1.25, 0.72, 1);
    const sp = R(0.15, 0.5) * (i % 2 ? 1 : -1);
    anims.push((t) => {
      ring.rotation.z = sp * t;
      if (ring.userData.arc) ring.userData.arc.rotation.z = ring.userData.arc.userData.spin * t;
      inner.rotation.z = -sp * 1.7 * t;
      if (inner.userData.arc) inner.userData.arc.rotation.z = -2 * t;
      if (frame) frame.rotation.z = Math.PI / 4 + sp * 0.4 * t;
      if (tilt) { tilt.rotation.z = sp * 2 * t; tilt.rotation.y = Math.sin(t + i) * 0.2; }
      rect.rotation.z = -sp * 0.25 * t;
    });
    // wall panels facing inward
    for (let k = 0; k < 2; k++) {
      const a = R(0, Math.PI * 2);
      const r = R(32, 40);
      const pnl = addPanel(tun, v3(Math.cos(a) * r, Math.sin(a) * r, z - 55 + R(-15, 15)), R(15, 22), { kind: KINDS[(i * 2 + k) % KINDS.length], rx: 0, ry: 0, rz: 0, static: true });
      pnl.lookAt(0, 0, pnl.position.z + 18);
      const base = pnl.quaternion.clone(); const wob = R(0.1, 0.3); const ph = rand() * 6;
      anims.push((t) => { pnl.quaternion.copy(base); pnl.rotateZ(Math.sin(t * 1.3 + ph) * wob * 0.3); pnl.rotateY(Math.sin(t * 0.9 + ph) * wob); });
    }
    if (i % 2 === 1) {
      const c = addCandles(tun, 28, 0.9);
      const a = R(0, Math.PI * 2);
      c.position.set(Math.cos(a) * 46, Math.sin(a) * 46, z - 30);
      c.rotation.set(0, Math.PI / 2, a);
    }
  }
  // longitudinal rails (static architecture → strong parallax against rotating rings)
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const rail = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, TUNNEL_START - TUNNEL_END), k % 2 ? M.metalDark : M.charcoal);
    rail.position.set(Math.cos(a) * 64, Math.sin(a) * 64, (TUNNEL_START + TUNNEL_END) / 2);
    rail.rotation.z = a;
    tun.add(rail);
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, TUNNEL_START - TUNNEL_END), k % 2 ? M.red : M.white);
    light.position.set(Math.cos(a) * 61.5, Math.sin(a) * 61.5, (TUNNEL_START + TUNNEL_END) / 2);
    tun.add(light);
  }
  // suspended Korean typography + 3D words
  KO.forEach((w, i) => {
    const m = textPlane(w, R(9, 16), { weight: 900, color: '#F5F5F5', boost: 1.1 });
    const a = (i / KO.length) * Math.PI * 2 * 3.1;
    const r = R(22, 30);
    m.position.set(Math.cos(a) * r, Math.sin(a) * r, TUNNEL_START - 90 - i * 165);
    m.rotation.set(0, 0, R(-0.2, 0.2));
    tun.add(m);
    const sp = R(-0.3, 0.3); const ry = R(-0.6, 0.6);
    anims.push((t) => { m.rotation.y = ry + sp * t; });
  });
  ['자본', '혁신', '연결', '미래'].forEach((w, i) => {
    const m = solidWord(w, 13, i % 2 ? M.metal : M.metalDark, 0.24);
    const side = i % 2 ? 1 : -1;
    m.position.set(side * R(10, 16), R(-8, 8), TUNNEL_START - 260 - i * 470);
    m.rotation.set(R(-0.3, 0.3), side * -0.5, 0);
    tun.add(m);
    const edge = solidWord(w, 13.1, M.redSoft, 0.03);
    edge.position.copy(m.position).add(v3(0, 0, -1.8));
    edge.rotation.copy(m.rotation);
    tun.add(edge);
    const sp = R(0.25, 0.5) * side;
    anims.push((t) => { m.rotation.y = side * -0.5 + sp * t; edge.rotation.y = m.rotation.y; });
  });
  EN.forEach((w, i) => {
    const m = textPlane(w, R(3, 6), { weight: 800, color: i % 3 === 0 ? '#E5242B' : '#F5F5F5', boost: i % 3 === 0 ? 1.25 : 1, toneMapped: i % 3 !== 0, opacity: 0.85 });
    const a = R(0, Math.PI * 2);
    m.position.set(Math.cos(a) * 34, Math.sin(a) * 34, TUNNEL_START - 60 - i * 205);
    m.lookAt(0, 0, m.position.z + 30);
    tun.add(m);
  });
  for (let i = 0; i < 110; i++) {
    const red = rand() < 0.25;
    const m = textPlane(numberString(), R(1.2, 4.5), { weight: 800, color: red ? '#E5242B' : '#F5F5F5', boost: red ? 1.3 : 1, toneMapped: !red, opacity: R(0.5, 1) });
    const a = R(0, Math.PI * 2); const r = R(14, 52);
    m.position.set(Math.cos(a) * r, Math.sin(a) * r, R(TUNNEL_START - 20, TUNNEL_END + 40));
    m.rotation.set(0, R(-0.6, 0.6), a + Math.PI / 2 + R(-0.3, 0.3));
    tun.add(m);
  }
  for (let i = 0; i < 36; i++) {
    const red = rand() < 0.5;
    const tr = addTrail(tun, R(60, 220), R(0.15, 0.5), red);
    const ang = R(0, Math.PI * 2); const rad = R(20, 58);
    trails.push({ m: tr, x: Math.cos(ang) * rad, y: Math.sin(ang) * rad, z0: R(TUNNEL_START, TUNNEL_END), v: R(300, 900), span: [TUNNEL_START, TUNNEL_END] });
  }
  anims.push((t) => {
    for (const tr of trails) {
      const [a, b] = tr.span; const len = a - b;
      const z = a - ((((a - tr.z0) + tr.v * t) % len) + len) % len;
      tr.m.position.set(tr.x, tr.y, z);
    }
  });

  // ---------- SCENE 03/04: collision swarm that later converges ----------
  const sw = group('swarm', 5.95, 12.3);
  const swarm = [];
  const addSwarm = (obj, opts = {}) => {
    const dir = v3(R(-1, 1), R(-0.7, 0.7), R(-0.8, 0.8)).normalize();
    const R0 = opts.radius ?? R(20, 170);
    const target = v3(R(-1, 1), R(-1, 1), R(-1, 1)).normalize().multiplyScalar(R(5, 16)).add(P);
    const spin = v3(R(-2, 2), R(-2, 2), R(-1.5, 1.5));
    const delay = R(0, 0.5);
    obj.position.copy(C);
    sw.add(obj);
    const s0 = obj.scale.x;
    if (opts.text) obj.rotation.set(R(-0.3, 0.3), R(-0.5, 0.5), R(-0.3, 0.3));
    swarm.push({ obj, dir, R0, target, spin, delay, s0, rot0: obj.rotation.clone(), text: !!opts.text });
  };
  for (let i = 0; i < 36; i++) {
    const p = addPanel(sw, C.clone(), R(10, 28), { kind: KINDS[i % KINDS.length], static: true });
    addSwarm(p);
  }
  for (let i = 0; i < 120; i++) {
    const red = rand() < 0.3;
    addSwarm(textPlane(numberString(), R(1.5, 6), { weight: 800, color: red ? '#E5242B' : '#F5F5F5', boost: red ? 1.3 : 1, toneMapped: !red }), { text: true });
  }
  for (let i = 0; i < 56; i++) {
    const red = rand() < 0.3;
    addSwarm(textPlane(pick(JAMO), R(3, 12), { weight: 900, color: red ? '#E5242B' : '#F5F5F5', boost: red ? 1.3 : 1, toneMapped: !red }), { radius: R(14, 90), text: true });
  }
  for (let i = 0; i < 14; i++) addSwarm(textPlane(pick(KO), R(6, 14), { weight: 900, color: '#F5F5F5' }), { radius: R(30, 120), text: true });
  for (let i = 0; i < 18; i++) addSwarm(addWireCube(sw, R(3, 12), rand() < 0.4));
  for (let i = 0; i < 12; i++) addSwarm(addPrism(sw, R(3, 8), R(10, 28), R(3, 8)));
  for (let i = 0; i < 8; i++) addSwarm(addCandles(sw, 24, R(0.6, 1.2)));
  for (let i = 0; i < 6; i++) addSwarm(addLineChart(sw, 32, R(18, 36), R(5, 10), rand() < 0.5));
  ['2026', '98.42', '-3.41%', '145.82', 'CAPITAL', 'VELOCITY', 'EQUITY', '가치', '성장'].forEach((w, i) => {
    const m = solidWord(w, R(8, 14), i === 2 ? M.red : M.metal, 0.22);
    addSwarm(m, { radius: R(25, 70), text: true });
  });
  // luminous fragments the swarm turns into
  const fragCount = 1400;
  const fragGeo = new THREE.BufferGeometry();
  const fragPos = new Float32Array(fragCount * 3);
  const fragCol = new Float32Array(fragCount * 3);
  const fragData = [];
  for (let i = 0; i < fragCount; i++) {
    const red = rand() < 0.3;
    fragCol.set(red ? [1.5, 0.17, 0.2] : [1.1, 1.1, 1.1], i * 3);
    fragData.push({ dir: v3(R(-1, 1), R(-0.8, 0.8), R(-1, 1)).normalize(), r: R(30, 220), tr: R(2, 22), a: R(0, Math.PI * 2), sp: R(0.5, 2.5) });
  }
  fragGeo.setAttribute('position', new THREE.BufferAttribute(fragPos, 3));
  fragGeo.setAttribute('color', new THREE.BufferAttribute(fragCol, 3));
  const frags = new THREE.Points(fragGeo, clampPoints(new THREE.PointsMaterial({ size: 1.4, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), 9 * (H / 1080)));
  frags.frustumCulled = false;
  sw.add(frags);

  // collision trails crossing the screen
  const xTrails = [];
  for (let i = 0; i < 26; i++) {
    const m = addTrail(sw, R(80, 260), R(0.2, 0.6), rand() < 0.55);
    const dir = v3(R(-1, 1), R(-0.5, 0.5), R(-1, 1)).normalize();
    m.lookAt(m.position.clone().add(dir));
    m.rotateX(Math.PI / 2);
    xTrails.push({ m, dir, off: v3(R(-40, 40), R(-30, 30), R(-40, 40)), v: R(200, 600), t0: R(6, 8.6) });
  }

  anims.push((t) => {
    for (const s of swarm) {
      const burst = ease.outExpo(seg(t, 6.0, 7.4));
      const drift = Math.max(0, t - 7.4) * 0.12;
      const r = s.R0 * (0.02 + 0.98 * burst) * (1 + drift);
      const out = C.clone().addScaledVector(s.dir, r);
      const c = ease.inOutCubic(seg(t, 9.0 + s.delay, 11.4 + s.delay * 0.4));
      s.obj.position.lerpVectors(out, s.target, c);
      const spinK = t - 6 + c * 2;
      if (s.text) s.obj.rotation.set(s.rot0.x + Math.sin(spinK * s.spin.x) * 0.35, s.rot0.y + Math.sin(spinK * s.spin.y * 0.8) * 0.75, s.rot0.z + Math.sin(spinK * s.spin.z) * 0.25);
      else s.obj.rotation.set(s.rot0.x + s.spin.x * spinK, s.rot0.y + s.spin.y * spinK, s.rot0.z + s.spin.z * spinK);
      const shrink = 1 - 0.85 * ease.inCubic(seg(t, 10.4 + s.delay, 11.9));
      s.obj.scale.setScalar(s.s0 * Math.max(0.001, (t < 6 ? 0.001 : 1) * shrink));
      s.obj.visible = t >= 6.0 && shrink > 0.16;
    }
    // fragments: scattered with the burst, then spiral into the core
    const conv = ease.inOutCubic(seg(t, 9.2, 11.8));
    const glow = seg(t, 9.0, 10.0);
    for (let i = 0; i < fragCount; i++) {
      const f = fragData[i];
      const burst = ease.outExpo(seg(t, 6.0, 7.6));
      const rr = lerp(f.r * burst, f.tr, conv);
      const a = f.a + f.sp * t * (1 + conv * 2);
      const base = C.clone().lerp(P, conv);
      const d = f.dir;
      fragPos[i * 3] = base.x + (d.x * Math.cos(a) - d.z * Math.sin(a) * conv) * rr;
      fragPos[i * 3 + 1] = base.y + d.y * rr * (1 - conv * 0.7);
      fragPos[i * 3 + 2] = base.z + (d.z * Math.cos(a) + d.x * Math.sin(a) * conv) * rr;
    }
    fragGeo.attributes.position.needsUpdate = true;
    frags.material.size = 0.8 + glow * 0.7;
    frags.visible = t >= 6.0;
    for (const x of xTrails) {
      const k = t - x.t0;
      x.m.visible = k > 0 && k < 1.2;
      x.m.position.copy(C).add(x.off).addScaledVector(x.dir, -150 + k * x.v);
    }
  });

  // ---------- SCENE 04: the central structure ----------
  const core = group('core', 8.6, 12.4);
  core.position.copy(P);
  const coreRings = [];
  for (let i = 0; i < 9; i++) {
    const r = addRing(core, 30 + i * 9, 0.6 + i * 0.12, { ticks: 50 + i * 8, mat: i % 3 === 2 ? M.metalDark : M.metal, arc: { r: 0.94, len: Math.PI * R(0.3, 0.9), spin: R(1, 3) * (i % 2 ? 1 : -1), white: i % 4 === 0 } });
    r.rotation.set(R(-1.2, 1.2), R(-1.2, 1.2), 0);
    coreRings.push({ r, base: r.rotation.clone(), sp: R(0.4, 1.4) * (i % 2 ? 1 : -1), rad: 30 + i * 9, k: i });
  }
  const corePanels = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const pnl = addPanel(core, v3(Math.cos(a) * 60, Math.sin(a) * 60, R(-20, 20)), R(12, 18), { kind: KINDS[i % KINDS.length], static: true });
    corePanels.push({ pnl, a, r: 60 });
  }
  const lattice = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const f = addSquareFrame(lattice, 14 + i * 3, 0.35, i % 2 ? M.metal : M.metalDark);
    f.rotation.set(i * 0.5, i * 0.8, i * 0.3);
  }
  const coreCube = addWireCube(lattice, 9, true);
  core.add(lattice);
  // red spiral trails
  const spirals = [];
  for (let s = 0; s < 3; s++) {
    const pts = [];
    for (let i = 0; i <= 240; i++) {
      const u = i / 240;
      const a = u * Math.PI * 8 + (s / 3) * Math.PI * 2;
      const r = lerp(90, 8, u);
      pts.push(v3(Math.cos(a) * r, Math.sin(a) * r * 0.55, lerp(80, 0, u) + Math.sin(a) * 6));
    }
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 480, 0.16, 6), s === 1 ? M.white : M.red);
    core.add(tube);
    spirals.push(tube);
  }
  anims.push((t) => {
    const contract = ease.inOutCubic(seg(t, 9.0, 11.7));
    const open = ease.outExpo(seg(t, 12.0, 12.35));
    for (const cr of coreRings) {
      const scale = lerp(1.9, 0.32 + cr.k * 0.035, contract) * (1 + open * 6);
      cr.r.scale.setScalar(scale);
      cr.r.rotation.set(cr.base.x + cr.sp * t * 0.6 * (1 - contract * 0.8), cr.base.y + cr.sp * 0.4 * t, cr.sp * t * (1 + contract * 2));
      if (cr.r.userData.arc) cr.r.userData.arc.rotation.z = cr.r.userData.arc.userData.spin * t;
    }
    for (const cp of corePanels) {
      const r = lerp(150, 26, contract) * (1 + open * 5);
      const a = cp.a + t * 0.25 + contract * 1.2;
      cp.pnl.position.set(Math.cos(a) * r, Math.sin(a) * r * 0.8, Math.sin(a * 2) * 10 * (1 - contract));
      cp.pnl.lookAt(core.position.x, core.position.y, core.position.z);
      cp.pnl.rotateY(Math.PI * (1 - contract) * 0.5);
    }
    lattice.rotation.set(t * 0.5, t * 0.8, t * 0.2);
    lattice.scale.setScalar(lerp(0.4, 1.4, contract) * (1 + open * 3));
    coreCube.rotation.set(-t * 1.2, t, 0);
    const draw = ease.outCubic(seg(t, 9.3, 11.7));
    spirals.forEach((sp, i) => {
      const total = sp.geometry.index.count;
      sp.geometry.setDrawRange(0, Math.floor(total * draw / 6) * 6);
      sp.rotation.z = t * (0.9 + i * 0.3) * (i % 2 ? 1 : -1);
      sp.scale.setScalar(1 + open * 4);
    });
  });

  // ---------- SCENE 05: CONAS wordmark ----------
  const logo = group('logo', 12.0, 15.01);
  logo.position.copy(P);
  const logoMat = new THREE.MeshStandardMaterial({ color: 0xeef0f3, metalness: 1, roughness: 0.16, envMapIntensity: 1.3 });
  const letters = ['C', 'O', 'N', 'A', 'S'];
  const size = 9.2; // world units per em
  const gap = 0.085; // em, constant gap between glyph outlines (optical spacing for heavy caps)
  const widths = letters.map((l) => GLYPHS.words[l].width);
  const total = widths.reduce((a, b) => a + b, 0) + gap * (letters.length - 1);
  let cursor = -total / 2;
  const starts = [v3(-90, 40, -140), v3(-20, -70, 60), v3(0, 10, -320), v3(40, 70, -60), v3(110, -30, 20)];
  const spins = [v3(0, Math.PI * 1.5, 0.4), v3(Math.PI * 1.2, 0, 0), v3(0, 0, Math.PI * 2), v3(-Math.PI, Math.PI * 0.6, 0), v3(0, -Math.PI * 1.8, -0.5)];
  const capMid = (GLYPHS.words.N.minY + GLYPHS.words.N.maxY) / 2; // baseline-relative centre of a flat cap
  const letterObjs = letters.map((l, i) => {
    const g = GLYPHS.words[l];
    const m = new THREE.Mesh(glyphGeometry(l, 0.24, 0.016), logoMat);
    m.scale.setScalar(size);
    const center = cursor + widths[i] / 2;
    cursor += widths[i] + gap;
    // geometry is centred on its own box; shift so all letters share one baseline
    const final = v3(center * size, ((g.minY + g.maxY) / 2 - capMid) * size + 2.0, 0);
    logo.add(m);
    return { m, final, start: final.clone().add(starts[i]), spin: spins[i], t0: 12.12 + i * 0.075 };
  });
  // capital height for vertical centering (letters are centred on their own boxes)
  const tag1 = textPlane('BEYOND THE CONVENTIONAL', 1.25, { weight: 600, color: '#F5F5F5', tracking: 0.42 });
  const tag2 = textPlane('GLOBAL HOLDING GROUP', 0.85, { weight: 500, color: '#9A9EA5', tracking: 0.5 });
  tag1.position.set(0, -5.9, 0);
  tag2.position.set(0, -8.0, 0);
  logo.add(tag1, tag2);
  const hair = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.07), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.26, 0.3), toneMapped: false, transparent: true }));
  hair.position.set(0, -3.7, 0);
  logo.add(hair);
  const streak = new THREE.Mesh(new THREE.PlaneGeometry(70, 0.5), new THREE.MeshBasicMaterial({ map: streakTexture(true), color: new THREE.Color(1.9, 0.2, 0.24), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  streak.position.set(0, 2.0, -6);
  logo.add(streak);
  const logoLight = new THREE.PointLight(0xffffff, 0, 120, 1.2);
  logo.add(logoLight);
  anims.push((t) => {
    for (const L of letterObjs) {
      const u = seg(t, L.t0, L.t0 + 1.05);
      const e = 1 - (1 - u) ** 5; // strong deceleration
      L.m.position.lerpVectors(L.start, L.final, e);
      L.m.rotation.set(L.spin.x * (1 - e), L.spin.y * (1 - e), L.spin.z * (1 - e));
      // lock: a tiny settle pulse when the letter arrives
      const lock = seg(t, L.t0 + 1.0, L.t0 + 1.18);
      const pulse = lock > 0 && lock < 1 ? Math.sin(lock * Math.PI) * 0.025 : 0;
      L.m.scale.setScalar(size * (1 + pulse));
      L.m.visible = t >= L.t0;
    }
    const st = ease.inOutCubic(seg(t, 12.55, 13.55));
    streak.position.x = lerp(-95, 95, st);
    streak.material.opacity = Math.sin(st * Math.PI) * (t < 13.6 ? 1 : 0);
    streak.visible = t > 12.55 && t < 13.6;
    const hw = ease.outCubic(seg(t, 13.2, 13.85));
    hair.scale.x = 30 * hw + 0.0001;
    hair.material.opacity = hw;
    const tg = ease.outCubic(seg(t, 13.3, 13.9));
    tag1.material.opacity = tg; tag1.position.y = -5.9 - (1 - tg) * 1.0;
    const tg2 = ease.outCubic(seg(t, 13.42, 13.95));
    tag2.material.opacity = tg2; tag2.position.y = -8.0 - (1 - tg2) * 1.0;
    // a controlled highlight glides across the metal, settles before the hold
    const sh = ease.inOutCubic(seg(t, 12.9, 13.9));
    logoLight.position.set(lerp(-40, 18, sh), 16, 22);
    logoLight.intensity = t > 12.4 ? 520 * (0.4 + 0.6 * (1 - Math.abs(sh - 0.5) * 2)) : 0;
  });
}

// ---------------------------------------------------------------- camera choreography
// Returns { pos, look, roll, fov, shake, cut } for time t.
function cameraAt(t) {
  const out = { pos: v3(0, 0, 0), look: v3(0, 0, -1), roll: 0, fov: 60, shake: 0 };
  if (t < 3) {
    // SCENE 01 — already travelling fast through the data universe
    const u = t / 3;
    const z = 140 - (300 * u + 600 * u * u);
    out.pos.set(Math.sin(u * Math.PI * 2.2) * 10 * (1 - u * 0.75), Math.sin(u * Math.PI * 1.7 + 1) * 4.5 * (1 - u * 0.6) + 1, z);
    out.look.set(out.pos.x * 0.3, out.pos.y * 0.2, z - 120);
    out.roll = Math.sin(u * Math.PI * 1.5) * 0.09;
    out.fov = lerp(64, 74, u);
    out.shake = 0.15;
  } else if (t < 6) {
    // SCENE 02 — accelerating through the tunnel, slowly rolling
    const u = (t - 3) / 3;
    const z = -760 - (1420 * u + 700 * u ** 3);
    const orbit = 7 * ease.inOutCubic(Math.min(1, u * 1.4));
    out.pos.set(Math.cos(u * Math.PI * 1.3) * orbit, Math.sin(u * Math.PI * 1.3) * orbit * 0.8, z);
    out.look.set(0, 0, z - 160);
    out.roll = ease.inOutCubic(u) * 0.95 + Math.sin(u * 9) * 0.02;
    out.fov = lerp(74, 86, ease.inCubic(u));
    out.shake = 0.25 + u * 0.35;
  } else if (t < 6.75) {
    // SCENE 03a — burst out of the tunnel, hard braking
    const u = ease.outExpo((t - 6) / 0.75);
    out.pos.set(0, lerp(0, 6, u), lerp(-2900, C.z + 150, u));
    out.look.copy(C).add(v3(0, 0, -40));
    out.roll = lerp(0.95, 0.05, u);
    out.fov = lerp(86, 70, u);
    out.shake = (1 - u) * 1.2;
  } else if (t < 7.45) {
    // 03b — lateral tracking past rotating numbers
    const u = (t - 6.75) / 0.7;
    out.pos.set(lerp(-150, -40, ease.outCubic(u)), lerp(14, 4, u), C.z + 70 - u * 20);
    out.look.copy(C).add(v3(lerp(-10, 25, u), 0, -10));
    out.roll = -0.08;
    out.fov = 58;
    out.shake = 0.4;
  } else if (t < 8.2) {
    // 03c — macro typography: Hangul components breaking apart
    const u = (t - 7.45) / 0.75;
    out.pos.copy(C).add(v3(lerp(16, 4, u), lerp(6, 1, u), lerp(46, 16, ease.outCubic(u))));
    out.look.copy(C).add(v3(0, 0, -20));
    out.roll = lerp(0.12, -0.05, u);
    out.fov = 38;
    out.shake = 0.25;
  } else if (t < 9) {
    // 03d — wide-angle, everything expanding
    const u = (t - 8.2) / 0.8;
    out.pos.copy(C).add(v3(lerp(80, 40, u), lerp(70, 44, u), lerp(190, 140, u)));
    out.look.copy(C).add(v3(0, -10, -60));
    out.roll = lerp(-0.2, -0.1, u);
    out.fov = 78;
    out.shake = 0.3;
  } else if (t < 12) {
    // SCENE 04 — sudden calm, slow drift, then a rapid push into the core
    const drift = ease.outCubic(seg(t, 9, 11));
    const push = ease.inExpo(seg(t, 11, 12));
    const z = lerp(P.z + 300, P.z + 230, drift) - push * 160;
    out.pos.set(lerp(-26, -8, drift) * (1 - push), lerp(18, 8, drift) * (1 - push), z);
    out.look.copy(P);
    out.roll = lerp(0.08, 0, drift) + push * 0.25;
    out.fov = lerp(52, 46, drift) + push * 22;
    out.shake = push * 0.6;
  } else {
    // SCENE 05 — reveal; brakes and locks before the hold
    const u = ease.outQuart(seg(t, 12, 13.8));
    out.pos.set(0, 0, P.z + lerp(78, 62, u));
    out.look.set(0, 0, P.z);
    out.fov = 35;
  }
  return out;
}

// deterministic camera shake (sum of sines)
const shakeVec = (t, amp) => v3(
  (Math.sin(t * 47.1) * 0.6 + Math.sin(t * 93.7) * 0.4) * amp,
  (Math.sin(t * 53.3 + 1) * 0.6 + Math.sin(t * 101.9) * 0.4) * amp,
  0,
);

// ---------------------------------------------------------------- post-processing
const rtOpts = { type: THREE.HalfFloatType, samples: Number(params.get('msaa') ?? 4) };
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(W, H, rtOpts));
composer.setPixelRatio(1);
composer.setSize(W, H);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.32, 0.45, 0.9);
composer.addPass(bloom);
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uFlash: { value: 0 }, uCA: { value: 0 }, uVig: { value: 0.32 }, uSeed: { value: 0 }, uFade: { value: 1 }, uRes: { value: new THREE.Vector2(W, H) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uFlash, uCA, uVig, uSeed, uFade; uniform vec2 uRes; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uSeed) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      float d = length(c);
      vec2 off = c * uCA * d;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv - off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv + off).b;
      col *= 1.0 - uVig * smoothstep(0.25, 0.85, d);
      col = mix(col, vec3(6.0), uFlash);
      col *= uFade;
      col += (hash(vUv * uRes) - 0.5) * 0.018;
      gl_FragColor = vec4(col, 1.0);
    }`,
});
composer.addPass(grade);
composer.addPass(new OutputPass());
composer.renderToScreen = false;

// motion-blur accumulation (averages BLUR sub-frames inside a 180° shutter)
const accum = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType });
const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const accumMat = new THREE.ShaderMaterial({
  uniforms: { tex: { value: null }, w: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: 'uniform sampler2D tex; uniform float w; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(tex, vUv).rgb * w, 1.0); }',
  blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
});
const copyMat = new THREE.ShaderMaterial({
  uniforms: { tex: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: 'uniform sampler2D tex; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(tex, vUv).rgb, 1.0); }',
  depthTest: false, depthWrite: false,
});
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), accumMat);
const quadScene = new THREE.Scene();
quadScene.add(quad);

// ---------------------------------------------------------------- frame state
const prevCam = v3();
function setState(t) {
  for (const [name, g] of Object.entries(groups)) {
    const [a, b] = g.userData.window;
    g.visible = t >= a && t < b;
  }
  for (const f of anims) f(t);
  const cs = cameraAt(t);
  const sh = shakeVec(t, cs.shake);
  camera.position.copy(cs.pos).add(sh);
  camera.up.set(Math.sin(cs.roll), Math.cos(cs.roll), 0);
  camera.lookAt(cs.look);
  camera.fov = cs.fov;
  camera.updateProjectionMatrix();
  // speed-dependent chromatic aberration
  const ahead = cameraAt(t + 1 / 120).pos;
  const speed = ahead.distanceTo(cs.pos) * 120;
  grade.uniforms.uCA.value = clamp(speed / 1800, 0, 1) * 0.012;
  // flashes: collision impact, cut punches, and the reveal
  let flash = 0;
  flash += 0.3 * Math.exp(-((t - 6.02) ** 2) / 0.003);
  for (const c of [6.75, 7.45, 8.2]) flash += 0.12 * Math.exp(-((t - c - 0.02) ** 2) / 0.0012);
  if (t >= 11.96) flash += t < 12.06 ? seg(t, 11.96, 12.06) : Math.exp(-(t - 12.06) * 9) * (1 - seg(t, 12.25, 12.5));
  if (flash < 0.002) flash = 0;
  grade.uniforms.uFlash.value = clamp(flash, 0, 1);
  grade.uniforms.uSeed.value = Math.floor(t * FPS) * 1.37;
  grade.uniforms.uFade.value = 1;
  // fog & exposure per scene
  scene.fog.density = t < 3 ? 0.0019 : t < 6 ? 0.0024 : t < 9 ? 0.0021 : t < 12 ? 0.0026 : 0;
  scene.background.copy(BG);
  bloom.strength = t < 12 ? 0.34 : 0.22;
  // moving red lights travel with the camera (metal highlights in the tunnel)
  redLights.forEach((l, i) => {
    const a = t * (1.6 + i * 0.7) + i * 2.1;
    l.position.set(Math.cos(a) * 40, Math.sin(a) * 40, camera.position.z - 60 - i * 70);
    l.intensity = t < 12 ? 4200 : 0;
  });
  whiteSpot.position.copy(camera.position).add(v3(20, 30, -40));
  whiteSpot.intensity = t < 12 ? 1800 : 0;
  key.intensity = t < 12 ? 3.2 : 2.4;
  rim.intensity = t < 12 ? 1.2 : 0.5;
  prevCam.copy(cs.pos);
}

// Render one output frame at time t (seconds). With BLUR>1, sub-frames are averaged across a
// 180° shutter (half a frame) for photographic motion blur. Sub-frames never straddle a cut.
const CUTS = [6, 6.75, 7.45, 8.2, 9, 12];
// Sub-pixel jitter (Halton 2,3) per sub-frame: accumulating jittered sub-frames also anti-aliases.
const halton = (i, b) => { let f = 1; let r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
// Sub-frames per output frame: more where the camera is fastest.
function samplesAt(t) {
  if (BLUR <= 1) return 1;
  if (t >= 3.0 && t < 6.8) return BLUR + 1;
  return BLUR;
}
function renderFrame(t) {
  const shutter = 0.5 / FPS; // 180-degree shutter
  const n = samplesAt(t);
  renderer.setRenderTarget(accum);
  renderer.setClearColor(0x000000, 1);
  renderer.clear();
  for (let k = 0; k < n; k++) {
    let ts = n === 1 ? t : t - shutter / 2 + (shutter * k) / (n - 1);
    for (const c of CUTS) if (t >= c && ts < c) ts = c; // keep sub-frames inside the current shot
    ts = clamp(ts, 0, DURATION - 1e-6);
    setState(ts);
    if (n > 1) camera.setViewOffset(W, H, halton(k + 1, 2) - 0.5, halton(k + 1, 3) - 0.5, W, H);
    else camera.clearViewOffset();
    composer.render();
    accumMat.uniforms.tex.value = composer.readBuffer.texture;
    accumMat.uniforms.w.value = 1 / n;
    quad.material = accumMat;
    renderer.setRenderTarget(accum);
    renderer.render(quadScene, quadCam);
  }
  camera.clearViewOffset();
  quad.material = copyMat;
  copyMat.uniforms.tex.value = accum.texture;
  renderer.setRenderTarget(null);
  renderer.render(quadScene, quadCam);
}

// ---------------------------------------------------------------- boot
async function boot() {
  await Promise.all([900, 800, 600, 500].map((w) => document.fonts.load(`${w} 64px Pretendard`, '자본시장가치CAPITAL0123')));
  const ok = document.fonts.check('900 64px Pretendard', '자본');
  if (!ok) throw new Error('Pretendard font failed to load');
  await build();
  // compile everything once
  for (const t of [0.5, 4, 7, 10.5, 13]) { setState(t); renderer.compile(scene, camera); }
  window.FILM = { renderFrame, setState, duration: DURATION, fps: FPS, width: W, height: H, blur: BLUR, stats: () => ({ objects: countObjects(), textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries }) };
  document.title = 'ready';
  if (params.get('preview')) {
    const hud = document.getElementById('hud');
    const start = performance.now();
    const loop = () => {
      const t = ((performance.now() - start) / 1000) % DURATION;
      renderFrame(t);
      hud.textContent = `${t.toFixed(2)}s`;
      requestAnimationFrame(loop);
    };
    loop();
  } else if (params.get('t')) renderFrame(Number(params.get('t')));
}

function countObjects() {
  const c = { meshes: 0, instances: 0, points: 0, lines: 0, text: 0 };
  scene.traverse((o) => {
    if (o.isInstancedMesh) { c.instances += o.count; c.meshes++; } else if (o.isMesh) { c.meshes++; if (o.material?.map && o.geometry.type === 'PlaneGeometry') c.text++; } else if (o.isPoints) c.points += o.geometry.attributes.position.count; else if (o.isLineSegments) c.lines++;
  });
  return c;
}

boot().catch((e) => { document.title = `error: ${e.message}`; console.error(e); });
