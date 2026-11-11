// Canvas-drawn textures. All text is drawn with the real Pretendard font (loaded via @font-face),
// so Korean glyphs are genuine font glyphs, never generated shapes.
import { THREE } from '../lib/vendor.js';

const RED = '#E5242B';
const WHITE = '#F5F5F5';
const GRAY = '#8C9097';
const DIM = 'rgba(245,245,245,0.38)';
const font = (w, px) => `${w} ${px}px Pretendard, sans-serif`;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function finish(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

// ---------------------------------------------------------------- text
const textCache = new Map();
export function textTexture(text, { weight = 800, color = WHITE, tracking = 0, px = 160 } = {}) {
  const key = `${text}|${weight}|${color}|${tracking}|${px}`;
  if (textCache.has(key)) return textCache.get(key);
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = font(weight, px);
  const chars = [...text];
  const trackPx = tracking * px;
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const w = Math.ceil(widths.reduce((a, b) => a + b, 0) + trackPx * (chars.length - 1) + px * 0.3);
  const h = Math.ceil(px * 1.32);
  c.width = Math.min(4096, w); c.height = h;
  const g = c.getContext('2d');
  g.font = font(weight, px);
  g.fillStyle = color;
  g.textBaseline = 'middle';
  let x = px * 0.15;
  chars.forEach((ch, i) => { g.fillText(ch, x, h / 2 + px * 0.04); x += widths[i] + trackPx; });
  const out = { tex: finish(c), aspect: c.width / c.height };
  textCache.set(key, out);
  return out;
}

// ---------------------------------------------------------------- panels
const TITLES = {
  candle: ['KOSPI 200 · 일봉', 'NASDAQ COMP · 15M', 'CONAS GLOBAL EQUITY', '자본 흐름 · CAPITAL FLOW'],
  line: ['시장 지수 · INDEX', 'S&P 500 · INTRADAY', '성장 추세 · GROWTH', 'ASSET VALUE'],
  volume: ['거래량 · VOLUME', 'TURNOVER · KRW bn', 'LIQUIDITY'],
  table: ['포트폴리오 · HOLDINGS', 'EQUITY SCREEN', '전략 · STRATEGY'],
  bond: ['채권 수익률 · YIELDS', 'SOVEREIGN CURVE', 'CREDIT SPREADS'],
  ticker: ['WATCHLIST', '시장 동향 · MOVERS', 'GLOBAL EQUITIES'],
  index: ['KOSPI', 'NIKKEI 225', 'DAX 40', 'HANG SENG', 'FTSE 100'],
  heat: ['SECTOR HEATMAP', '섹터 · SECTORS', 'RISK MATRIX'],
  gauge: ['변동성 · VOLATILITY', 'VIX INDEX', 'RISK APPETITE'],
  stats: ['MARKET STATISTICS', '가치 평가 · VALUATION', 'KEY METRICS'],
  fx: ['환율 · FX RATES', 'CURRENCY MATRIX', 'GLOBAL FX'],
  orderbook: ['호가 · ORDER BOOK', 'DEPTH OF MARKET', 'BID / ASK'],
};
const SYMBOLS = ['CNS', 'SMSG', 'HYND', 'LGCH', 'SKHY', 'NAVR', 'KAKO', 'POSC', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOG', 'TSLA', 'META', 'JPM', 'GS', 'MS', 'BLK', 'HSBC', 'UBS', 'BNP'];

export function panelTexture(kind, seed) {
  const r = rng(seed);
  const R = (a, b) => a + (b - a) * r();
  const pick = (a) => a[Math.floor(r() * a.length)];
  const W = 768; const H = 480;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  // body
  g.fillStyle = 'rgba(10,11,13,0.9)';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(245,245,245,0.22)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, W - 2, H - 2);
  // header
  const title = pick(TITLES[kind] || ['MARKET']);
  g.fillStyle = 'rgba(245,245,245,0.06)';
  g.fillRect(0, 0, W, 58);
  g.fillStyle = r() < 0.5 ? RED : WHITE;
  g.fillRect(0, 0, 8, 58);
  g.font = font(800, 26); g.fillStyle = WHITE; g.textBaseline = 'middle';
  g.fillText(title, 24, 30);
  const chg = R(-4.5, 6.5);
  g.font = font(700, 24); g.textAlign = 'right';
  g.fillStyle = chg >= 0 ? WHITE : RED;
  g.fillText(`${chg >= 0 ? '▲' : '▼'} ${Math.abs(chg).toFixed(2)}%`, W - 22, 30);
  g.textAlign = 'left';
  g.font = font(500, 16); g.fillStyle = DIM;
  g.fillText(`2026.11.11  ${String(Math.floor(R(9, 15))).padStart(2, '0')}:${String(Math.floor(R(0, 59))).padStart(2, '0')}:${String(Math.floor(R(0, 59))).padStart(2, '0')} KST`, 24, H - 18);
  g.textAlign = 'right';
  g.fillText(`ID ${Math.floor(R(100000, 999999))}`, W - 22, H - 18);
  g.textAlign = 'left';
  const X0 = 24; const Y0 = 78; const CW = W - 48; const CH = H - 128;

  const gridLines = (rows, cols) => {
    g.strokeStyle = 'rgba(245,245,245,0.08)'; g.lineWidth = 1;
    for (let i = 0; i <= rows; i++) { const y = Y0 + (CH * i) / rows; g.beginPath(); g.moveTo(X0, y); g.lineTo(X0 + CW, y); g.stroke(); }
    for (let i = 0; i <= cols; i++) { const x = X0 + (CW * i) / cols; g.beginPath(); g.moveTo(x, Y0); g.lineTo(x, Y0 + CH); g.stroke(); }
  };
  const axis = (lo, hi, rows) => {
    g.font = font(500, 14); g.fillStyle = DIM; g.textAlign = 'right';
    for (let i = 0; i <= rows; i++) g.fillText((hi - ((hi - lo) * i) / rows).toFixed(2), X0 + CW - 4, Y0 + (CH * i) / rows - 8);
    g.textAlign = 'left';
  };
  const walk = (n, v0, vol) => { const a = []; let v = v0; for (let i = 0; i < n; i++) { v += R(-vol, vol * 1.08); a.push(v); } return a; };

  switch (kind) {
    case 'candle': {
      gridLines(5, 8);
      const n = 46; let p = 100; const cs = [];
      for (let i = 0; i < n; i++) { const o = p; p += R(-3, 3.2); cs.push([o, p, Math.max(o, p) + R(0.2, 2.5), Math.min(o, p) - R(0.2, 2.5)]); }
      const lo = Math.min(...cs.map((x) => x[3])); const hi = Math.max(...cs.map((x) => x[2]));
      const Y = (v) => Y0 + CH - ((v - lo) / (hi - lo)) * CH * 0.92 - CH * 0.04;
      const bw = (CW - 70) / n;
      cs.forEach(([o, cl, h, l], i) => {
        const x = X0 + i * bw + bw / 2;
        const col = cl >= o ? WHITE : RED;
        g.strokeStyle = col; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(x, Y(h)); g.lineTo(x, Y(l)); g.stroke();
        g.fillStyle = col; g.fillRect(x - bw * 0.32, Math.min(Y(o), Y(cl)), bw * 0.64, Math.max(2, Math.abs(Y(o) - Y(cl))));
      });
      axis(lo, hi, 5);
      break;
    }
    case 'line': {
      gridLines(4, 10);
      const pts = walk(80, 50, 2.2); const lo = Math.min(...pts); const hi = Math.max(...pts);
      const X = (i) => X0 + (i / (pts.length - 1)) * (CW - 70);
      const Y = (v) => Y0 + CH - ((v - lo) / (hi - lo)) * CH * 0.9 - CH * 0.05;
      const grad = g.createLinearGradient(0, Y0, 0, Y0 + CH);
      grad.addColorStop(0, 'rgba(229,36,43,0.35)'); grad.addColorStop(1, 'rgba(229,36,43,0)');
      g.beginPath(); g.moveTo(X(0), Y0 + CH); pts.forEach((v, i) => g.lineTo(X(i), Y(v))); g.lineTo(X(pts.length - 1), Y0 + CH); g.closePath();
      g.fillStyle = grad; g.fill();
      g.beginPath(); pts.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))));
      g.strokeStyle = r() < 0.5 ? RED : WHITE; g.lineWidth = 3; g.stroke();
      const last = pts[pts.length - 1];
      g.fillStyle = WHITE; g.beginPath(); g.arc(X(pts.length - 1), Y(last), 5, 0, Math.PI * 2); g.fill();
      axis(lo, hi, 4);
      break;
    }
    case 'volume': {
      gridLines(4, 6);
      const n = 40; const bw = (CW - 60) / n;
      for (let i = 0; i < n; i++) {
        const h = R(0.08, 1) * CH * 0.9;
        g.fillStyle = r() < 0.3 ? RED : 'rgba(245,245,245,0.85)';
        g.fillRect(X0 + i * bw, Y0 + CH - h, bw * 0.7, h);
      }
      g.font = font(800, 40); g.fillStyle = WHITE; g.fillText(`${R(12, 98).toFixed(1)}M`, X0 + 8, Y0 + 40);
      break;
    }
    case 'table': case 'ticker': case 'bond': case 'fx': {
      const rows = kind === 'bond' ? 8 : 9;
      const rowH = CH / rows;
      g.font = font(600, 15); g.fillStyle = DIM;
      const heads = kind === 'bond' ? ['TENOR', 'YIELD', 'CHG bp', 'SPREAD'] : kind === 'fx' ? ['PAIR', 'BID', 'ASK', 'CHG'] : ['SYMBOL', 'LAST', 'CHG', 'VOL'];
      heads.forEach((h, i) => g.fillText(h, X0 + i * (CW / 4), Y0 + 6));
      for (let i = 0; i < rows - 1; i++) {
        const y = Y0 + rowH * (i + 1) + 6;
        if (i % 2 === 0) { g.fillStyle = 'rgba(245,245,245,0.035)'; g.fillRect(X0 - 8, y - rowH / 2, CW + 16, rowH); }
        const ch = R(-3, 3.5);
        let cols;
        if (kind === 'bond') cols = [`${pick(['KR', 'US', 'DE', 'JP', 'UK'])} ${pick(['2Y', '3Y', '5Y', '10Y', '30Y'])}`, `${R(0.5, 5.4).toFixed(3)}%`, `${ch >= 0 ? '+' : ''}${(ch * 3).toFixed(1)}`, `${R(10, 180).toFixed(0)}`];
        else if (kind === 'fx') { const b = R(0.6, 1450); cols = [pick(['USD/KRW', 'EUR/USD', 'USD/JPY', 'GBP/USD', 'USD/CNH', 'AUD/USD', 'EUR/KRW', 'USD/CHF']), b.toFixed(b > 10 ? 2 : 4), (b * 1.0004).toFixed(b > 10 ? 2 : 4), `${ch >= 0 ? '+' : ''}${(ch / 4).toFixed(2)}%`]; } else cols = [pick(SYMBOLS), R(8, 980).toFixed(2), `${ch >= 0 ? '+' : ''}${ch.toFixed(2)}%`, `${R(0.2, 48).toFixed(1)}M`];
        cols.forEach((t, k) => {
          g.font = font(k === 0 ? 700 : 600, 21);
          g.fillStyle = k === 2 ? (ch >= 0 ? WHITE : RED) : k === 0 ? WHITE : 'rgba(245,245,245,0.75)';
          g.fillText(t, X0 + k * (CW / 4), y);
        });
        if (kind === 'ticker') { // sparkline
          const s = walk(16, 0, 1); const lo = Math.min(...s); const hi = Math.max(...s);
          g.beginPath(); s.forEach((v, j) => { const x = X0 + CW - 110 + j * 7; const yy = y + 8 - ((v - lo) / (hi - lo + 1e-6)) * 18; j ? g.lineTo(x, yy) : g.moveTo(x, yy); });
          g.strokeStyle = ch >= 0 ? WHITE : RED; g.lineWidth = 1.6; g.stroke();
        }
      }
      break;
    }
    case 'index': {
      g.font = font(900, 92); g.fillStyle = WHITE;
      g.fillText(R(1800, 42000).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 }), X0, Y0 + 80);
      g.font = font(700, 30); g.fillStyle = chg >= 0 ? WHITE : RED;
      g.fillText(`${chg >= 0 ? '+' : ''}${(chg * 12).toFixed(2)}  (${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%)`, X0, Y0 + 140);
      const pts = walk(60, 0, 1); const lo = Math.min(...pts); const hi = Math.max(...pts);
      g.beginPath(); pts.forEach((v, i) => { const x = X0 + (i / 59) * CW; const y = Y0 + CH - ((v - lo) / (hi - lo)) * 130; i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.strokeStyle = RED; g.lineWidth = 3; g.stroke();
      break;
    }
    case 'heat': {
      const cols = 8; const rows = 5; const cw = CW / cols; const rh = CH / rows;
      for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
        const v = R(-1, 1);
        g.fillStyle = v < 0 ? `rgba(229,36,43,${0.25 + Math.abs(v) * 0.7})` : `rgba(245,245,245,${0.08 + v * 0.4})`;
        g.fillRect(X0 + j * cw + 2, Y0 + i * rh + 2, cw - 4, rh - 4);
        g.font = font(700, 15); g.fillStyle = WHITE; g.fillText(pick(SYMBOLS), X0 + j * cw + 10, Y0 + i * rh + 20);
        g.font = font(500, 13); g.fillStyle = 'rgba(245,245,245,0.8)'; g.fillText(`${(v * 4).toFixed(2)}%`, X0 + j * cw + 10, Y0 + i * rh + 40);
      }
      break;
    }
    case 'gauge': {
      const cx = X0 + CW * 0.36; const cy = Y0 + CH * 0.86; const rad = CH * 0.72;
      g.lineWidth = 26;
      g.strokeStyle = 'rgba(245,245,245,0.12)'; g.beginPath(); g.arc(cx, cy, rad, Math.PI, 0); g.stroke();
      const v = R(0.2, 0.95);
      g.strokeStyle = RED; g.beginPath(); g.arc(cx, cy, rad, Math.PI, Math.PI + v * Math.PI); g.stroke();
      g.lineWidth = 2; g.strokeStyle = 'rgba(245,245,245,0.5)';
      for (let i = 0; i <= 20; i++) { const a = Math.PI + (i / 20) * Math.PI; g.beginPath(); g.moveTo(cx + Math.cos(a) * (rad - 24), cy + Math.sin(a) * (rad - 24)); g.lineTo(cx + Math.cos(a) * (rad - (i % 5 ? 34 : 44)), cy + Math.sin(a) * (rad - (i % 5 ? 34 : 44))); g.stroke(); }
      g.font = font(900, 64); g.fillStyle = WHITE; g.textAlign = 'center'; g.fillText((v * 60).toFixed(2), cx, cy - 40); g.textAlign = 'left';
      g.font = font(600, 18); g.fillStyle = DIM;
      ['σ 30D', 'IV RANK', 'SKEW', 'TERM'].forEach((t, i) => { g.fillText(t, X0 + CW * 0.74, Y0 + 30 + i * 62); });
      g.font = font(800, 26); g.fillStyle = WHITE;
      ['σ 30D', 'IV RANK', 'SKEW', 'TERM'].forEach((t, i) => { g.fillText(R(0.1, 99).toFixed(2), X0 + CW * 0.74, Y0 + 58 + i * 62); });
      break;
    }
    case 'stats': {
      const items = [['P/E', R(6, 40).toFixed(1)], ['EV/EBITDA', R(4, 22).toFixed(1)], ['ROE', `${R(4, 28).toFixed(1)}%`], ['β', R(0.4, 1.8).toFixed(2)], ['DIV YIELD', `${R(0.2, 6).toFixed(2)}%`], ['MKT CAP', `₩${R(1, 480).toFixed(1)}T`], ['52W HIGH', R(80, 900).toFixed(2)], ['SHARPE', R(0.2, 2.6).toFixed(2)]];
      items.forEach(([k, v], i) => {
        const x = X0 + (i % 2) * (CW / 2); const y = Y0 + Math.floor(i / 2) * (CH / 4) + 12;
        g.font = font(500, 16); g.fillStyle = DIM; g.fillText(k, x, y);
        g.font = font(800, 38); g.fillStyle = i === 2 ? RED : WHITE; g.fillText(v, x, y + 40);
      });
      break;
    }
    case 'orderbook': {
      const rows = 8; const rh = CH / (rows * 2);
      for (let i = 0; i < rows * 2; i++) {
        const ask = i < rows; const y = Y0 + i * rh + rh / 2;
        const size = R(0.1, 1);
        g.fillStyle = ask ? 'rgba(229,36,43,0.28)' : 'rgba(245,245,245,0.12)';
        g.fillRect(X0 + CW * (1 - size * 0.55), y - rh / 2 + 1, CW * size * 0.55, rh - 2);
        g.font = font(700, 17); g.fillStyle = ask ? RED : WHITE;
        g.fillText((100 + (rows - i) * 0.05).toFixed(2), X0, y + 1);
        g.font = font(500, 16); g.fillStyle = 'rgba(245,245,245,0.75)';
        g.fillText(Math.floor(R(100, 99999)).toLocaleString('en-US'), X0 + CW * 0.3, y + 1);
      }
      break;
    }
    default: gridLines(4, 6);
  }
  return finish(c);
}

// background coordinate system wall: grid, axes, tick labels
export function gridTexture(seed) {
  const r = rng(seed);
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 640;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(245,245,245,0.09)'; g.lineWidth = 1;
  for (let x = 0; x <= 1024; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 640); g.stroke(); }
  for (let y = 0; y <= 640; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(1024, y); g.stroke(); }
  g.strokeStyle = 'rgba(245,245,245,0.35)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(64, 20); g.lineTo(64, 600); g.lineTo(1000, 600); g.stroke();
  g.font = font(500, 14); g.fillStyle = 'rgba(245,245,245,0.45)';
  for (let i = 0; i < 9; i++) g.fillText((r() * 200).toFixed(2), 8, 600 - i * 64);
  for (let i = 0; i < 14; i++) g.fillText(`T+${i * 5}`, 64 + i * 66, 622);
  // a plotted series
  g.beginPath();
  let v = 300;
  for (let x = 64; x < 1000; x += 8) { v += (r() - 0.48) * 22; g.lineTo(x, v); }
  g.strokeStyle = r() < 0.5 ? 'rgba(229,36,43,0.8)' : 'rgba(245,245,245,0.6)'; g.lineWidth = 2; g.stroke();
  g.font = font(800, 22); g.fillStyle = 'rgba(245,245,245,0.6)';
  g.fillText(['Y = f(CAPITAL, t)', 'Δ INDEX · 2026', '시장 좌표계', 'YIELD CURVE · 수익률 곡선'][Math.floor(r() * 4)], 90, 50);
  return finish(c);
}

let streakTex = null; let streakTexX = null;
// soft-ended streak: bright core along the length, fading at both ends and edges
export function streakTexture(horizontal = false) {
  if (horizontal ? streakTexX : streakTex) return horizontal ? streakTexX : streakTex;
  const c = document.createElement('canvas');
  c.width = horizontal ? 512 : 32; c.height = horizontal ? 32 : 512;
  const g = c.getContext('2d');
  const img = g.createImageData(c.width, c.height);
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const along = horizontal ? x / (c.width - 1) : y / (c.height - 1);
    const across = horizontal ? y / (c.height - 1) : x / (c.width - 1);
    const a = Math.sin(along * Math.PI) ** 1.5 * Math.exp(-((across - 0.5) ** 2) / 0.02);
    const i = (y * c.width + x) * 4;
    img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255; img.data[i + 3] = Math.round(a * 255);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  if (horizontal) streakTexX = t; else streakTex = t;
  return t;
}

let glowTex = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.25, 'rgba(255,255,255,0.6)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}
