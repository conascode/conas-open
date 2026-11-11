// Pure geometry helpers. No DOM / PixiJS dependency so they can run in Node tests.

export const DEG = Math.PI / 180;

export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function round(v, digits = 2) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export function snapValue(v, step) {
  return step > 0 ? Math.round(v / step) * step : v;
}

// ---------- bounds ----------

export function emptyBounds() {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function boundsOfPoints(points, pad = 0) {
  const b = emptyBounds();
  for (const p of points) {
    if (p.x < b.minX) b.minX = p.x;
    if (p.y < b.minY) b.minY = p.y;
    if (p.x > b.maxX) b.maxX = p.x;
    if (p.y > b.maxY) b.maxY = p.y;
  }
  if (pad) {
    b.minX -= pad; b.minY -= pad; b.maxX += pad; b.maxY += pad;
  }
  return b;
}

export function unionBounds(a, b) {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function boundsIntersect(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function boundsContainsBounds(outer, inner) {
  return inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY;
}

export function boundsCenter(b) {
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

export function rectToBounds(x, y, w, h) {
  return { minX: Math.min(x, x + w), minY: Math.min(y, y + h), maxX: Math.max(x, x + w), maxY: Math.max(y, y + h) };
}

// ---------- polygons ----------

export function polygonArea(points) {
  let a = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    a += (points[j].x * points[i].y) - (points[i].x * points[j].y);
  }
  return a / 2; // signed
}

export function polygonCentroid(points) {
  const a = polygonArea(points);
  if (Math.abs(a) < 1e-9) {
    const b = boundsOfPoints(points);
    return boundsCenter(b);
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const f = (points[j].x * points[i].y) - (points[i].x * points[j].y);
    cx += (points[j].x + points[i].x) * f;
    cy += (points[j].y + points[i].y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function pointInPolygon(p, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x; const yi = points[i].y;
    const xj = points[j].x; const yj = points[j].y;
    if ((yi > p.y) !== (yj > p.y) && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function closestPointOnSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = clamp(t, 0, 1);
  const x = a.x + dx * t;
  const y = a.y + dy * t;
  return { x, y, t, d: Math.hypot(p.x - x, p.y - y) };
}

// Closest point on a polyline (closed when `closed` is true). Returns {x, y, d, index, t}
// where index is the segment start index.
export function closestPointOnPath(p, points, closed = false) {
  let best = null;
  const n = points.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const c = closestPointOnSegment(p, a, b);
    if (!best || c.d < best.d) best = { ...c, index: i };
  }
  if (!best && n === 1) best = { x: points[0].x, y: points[0].y, d: dist(p, points[0]), index: 0, t: 0 };
  return best;
}

export function distanceToPath(p, points, closed = false) {
  const c = closestPointOnPath(p, points, closed);
  return c ? c.d : Infinity;
}

function segmentsIntersect(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y));
  const o1 = o(a, b, c); const o2 = o(a, b, d); const o3 = o(c, d, a); const o4 = o(c, d, b);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

// True if any two non-adjacent edges cross. O(n^2); fine for editor-sized polygons.
export function isSelfIntersecting(points) {
  const n = points.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a = points[i]; const b = points[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = points[j]; const d = points[(j + 1) % n];
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

// Ramer–Douglas–Peucker simplification.
export function simplifyPath(points, tolerance) {
  if (points.length <= 2 || tolerance <= 0) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = -1;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = closestPointOnSegment(points[i], points[s], points[e]).d;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tolerance && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

// Simplify a closed ring. Splits at the point farthest from the first point so the
// ring's start does not get unfairly preserved.
export function simplifyClosed(points, tolerance) {
  if (points.length <= 4) return points.slice();
  let far = 0;
  let fd = -1;
  for (let i = 1; i < points.length; i++) {
    const d = dist(points[0], points[i]);
    if (d > fd) { fd = d; far = i; }
  }
  const a = simplifyPath(points.slice(0, far + 1), tolerance);
  const b = simplifyPath(points.slice(far).concat([points[0]]), tolerance);
  const ring = a.concat(b.slice(1, -1));
  return ring.length >= 3 ? ring : points.slice(0, 3);
}

// ---------- affine matrices: {a, b, c, d, tx, ty} maps (x,y) -> (a*x + c*y + tx, b*x + d*y + ty) ----------

export const IDENTITY = Object.freeze({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });

export function applyMatrix(m, p) {
  return { x: m.a * p.x + m.c * p.y + m.tx, y: m.b * p.x + m.d * p.y + m.ty };
}

export function applyLinear(m, v) {
  return { x: m.a * v.x + m.c * v.y, y: m.b * v.x + m.d * v.y };
}

export function multiply(m1, m2) {
  // m1 * m2 (apply m2 first, then m1)
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    tx: m1.a * m2.tx + m1.c * m2.ty + m1.tx,
    ty: m1.b * m2.tx + m1.d * m2.ty + m1.ty,
  };
}

export function invert(m) {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-12) return { ...IDENTITY };
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    tx: (m.c * m.ty - m.d * m.tx) / det,
    ty: (m.b * m.tx - m.a * m.ty) / det,
  };
}

export function translation(dx, dy) {
  return { a: 1, b: 0, c: 0, d: 1, tx: dx, ty: dy };
}

export function rotationAbout(angleRad, pivot) {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return {
    a: cos, b: sin, c: -sin, d: cos,
    tx: pivot.x - cos * pivot.x + sin * pivot.y,
    ty: pivot.y - sin * pivot.x - cos * pivot.y,
  };
}

export function scaleAbout(sx, sy, pivot) {
  return { a: sx, b: 0, c: 0, d: sy, tx: pivot.x - sx * pivot.x, ty: pivot.y - sy * pivot.y };
}

export function isTranslationOnly(m) {
  return Math.abs(m.a - 1) < 1e-9 && Math.abs(m.d - 1) < 1e-9 && Math.abs(m.b) < 1e-9 && Math.abs(m.c) < 1e-9;
}

// ---------- oriented rectangles (box objects) ----------

// Local rectangle of a box object relative to its anchor point.
export function localRect(w, h, ax = 0.5, ay = 0.5) {
  return { x: -ax * w, y: -ay * h, w, h };
}

export function boxCorners(obj) {
  const r = localRect(obj.width, obj.height, obj.anchorX ?? 0.5, obj.anchorY ?? 0.5);
  const cos = Math.cos((obj.rotation || 0) * DEG);
  const sin = Math.sin((obj.rotation || 0) * DEG);
  const pts = [
    { x: r.x, y: r.y }, { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h },
  ];
  return pts.map((p) => ({ x: obj.x + p.x * cos - p.y * sin, y: obj.y + p.x * sin + p.y * cos }));
}

export function worldToLocal(obj, p) {
  const cos = Math.cos(-(obj.rotation || 0) * DEG);
  const sin = Math.sin(-(obj.rotation || 0) * DEG);
  const dx = p.x - obj.x;
  const dy = p.y - obj.y;
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
}

export function localToWorld(obj, p) {
  const cos = Math.cos((obj.rotation || 0) * DEG);
  const sin = Math.sin((obj.rotation || 0) * DEG);
  return { x: obj.x + p.x * cos - p.y * sin, y: obj.y + p.x * sin + p.y * cos };
}

// ---------- curves ----------

export function cubicPoint(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const a = u * u * u; const b = 3 * u * u * t; const c = 3 * u * t * t; const d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

// Catmull-Rom tangents expressed as cubic Bezier handles (1/6 of the neighbour span).
export function catmullRomHandles(points, closed = false) {
  const n = points.length;
  return points.map((p, i) => {
    const prev = points[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const next = points[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    return { x: (next.x - prev.x) / 6, y: (next.y - prev.y) / 6 };
  });
}

// Sample a chain of anchors with symmetric handles (hx, hy) into a polyline.
export function sampleBezierChain(points, handles, segmentsPerCurve = 16) {
  if (points.length < 2) return points.map((p) => ({ x: p.x, y: p.y }));
  const out = [{ x: points[0].x, y: points[0].y }];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const ha = handles[i];
    const hb = handles[i + 1];
    if (!ha.x && !ha.y && !hb.x && !hb.y) {
      out.push({ x: b.x, y: b.y });
      continue;
    }
    const c1 = { x: a.x + ha.x, y: a.y + ha.y };
    const c2 = { x: b.x - hb.x, y: b.y - hb.y };
    for (let s = 1; s <= segmentsPerCurve; s++) out.push(cubicPoint(a, c1, c2, b, s / segmentsPerCurve));
  }
  return out;
}

export function pathLength(points) {
  let l = 0;
  for (let i = 1; i < points.length; i++) l += dist(points[i - 1], points[i]);
  return l;
}

// Offset a polyline sideways by `offset` (positive = left of travel direction).
export function offsetPath(points, offset) {
  const n = points.length;
  if (n < 2) return points.slice();
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(n - 1, i + 1)];
    let dx = next.x - prev.x;
    let dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    out.push({ x: points[i].x - dy * offset, y: points[i].y + dx * offset });
  }
  return out;
}

// Split a polyline into dash segments: returns arrays of points.
export function dashPath(points, dash, gap) {
  const out = [];
  if (points.length < 2) return out;
  let drawing = true;
  let remain = dash;
  let current = [{ ...points[0] }];
  for (let i = 1; i < points.length; i++) {
    let a = points[i - 1];
    const b = points[i];
    let segLen = dist(a, b);
    while (segLen > 0) {
      const step = Math.min(remain, segLen);
      const t = step / segLen;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (drawing) current.push(p);
      remain -= step;
      segLen -= step;
      a = p;
      if (remain <= 1e-9) {
        if (drawing) { if (current.length > 1) out.push(current); current = []; } else { current = [{ ...p }]; }
        drawing = !drawing;
        remain = drawing ? dash : gap;
      }
    }
  }
  if (drawing && current.length > 1) out.push(current);
  return out;
}

// Convex hull (monotone chain). Used to auto-trace building hitboxes.
export function convexHull(points) {
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length <= 3) return pts;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

// ---------- loop-free curves ----------
// Catmull-Rom style curves whose control points are limited by each segment's own length,
// so two anchors placed close together never make the curve overshoot into a loop.

function unit(v) {
  const l = Math.hypot(v.x, v.y);
  return l > 1e-9 ? { x: v.x / l, y: v.y / l } : { x: 0, y: 0 };
}

// Unit tangent at every anchor (direction from the previous to the next anchor).
export function smoothTangents(points) {
  const n = points.length;
  return points.map((p, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    return unit({ x: b.x - a.x, y: b.y - a.y });
  });
}

// Symmetric handles for a smooth curve (used when converting to editable Bezier handles):
// length = 1/3 of the shorter neighbouring segment.
export function smoothHandles(points) {
  const T = smoothTangents(points);
  return points.map((p, i) => {
    const prev = i > 0 ? dist(points[i - 1], p) : Infinity;
    const next = i < points.length - 1 ? dist(p, points[i + 1]) : Infinity;
    const L = Math.min(prev, next);
    const k = Number.isFinite(L) ? L / 3 : 0;
    return { x: T[i].x * k, y: T[i].y * k };
  });
}

// Per-segment control points. mode: 'Straight' | 'Smooth' | 'Bezier' (handles = [{x,y}] per anchor).
export function curveControls(points, mode, handles) {
  const out = [];
  const T = mode === 'Smooth' ? smoothTangents(points) : null;
  const clampLen = (h, max) => {
    const l = Math.hypot(h.x, h.y);
    return l > max && l > 0 ? { x: (h.x / l) * max, y: (h.y / l) * max } : h;
  };
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]; const b = points[i + 1];
    const L = dist(a, b);
    if (mode === 'Smooth') {
      out.push([{ x: a.x + (T[i].x * L) / 3, y: a.y + (T[i].y * L) / 3 }, { x: b.x - (T[i + 1].x * L) / 3, y: b.y - (T[i + 1].y * L) / 3 }]);
    } else if (mode === 'Bezier' && handles) {
      const ho = clampLen(handles[i], L / 2);
      const hi = clampLen(handles[i + 1], L / 2);
      out.push([{ x: a.x + ho.x, y: a.y + ho.y }, { x: b.x - hi.x, y: b.y - hi.y }]);
    } else out.push(null); // straight segment
  }
  return out;
}

export function sampleCurve(points, controls, segmentsPerCurve = 16) {
  if (points.length < 2) return points.map((p) => ({ x: p.x, y: p.y }));
  const out = [{ x: points[0].x, y: points[0].y }];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]; const b = points[i + 1]; const c = controls[i];
    if (!c) { out.push({ x: b.x, y: b.y }); continue; }
    // fewer samples on short segments
    const n = Math.max(2, Math.min(segmentsPerCurve, Math.ceil(dist(a, b) / 6)));
    for (let s = 1; s <= n; s++) out.push(cubicPoint(a, c[0], c[1], b, s / n));
  }
  return out;
}

// Offset a polyline sideways, dropping pieces that would run backwards at sharp bends
// (which otherwise draw as crossed, tangled lines). Returns an array of polylines.
export function offsetRuns(points, offset) {
  const off = offsetPath(points, offset);
  const runs = [];
  let cur = [];
  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      const dx = points[i].x - points[i - 1].x; const dy = points[i].y - points[i - 1].y;
      const ox = off[i].x - off[i - 1].x; const oy = off[i].y - off[i - 1].y;
      // keep the piece only if it still points the same way and is not wildly stretched
      const ok = dx * ox + dy * oy > 0 && Math.hypot(ox, oy) < Math.hypot(dx, dy) * 3 + Math.abs(offset);
      if (!ok) {
        if (cur.length > 1) runs.push(cur);
        cur = [];
        continue;
      }
      if (!cur.length) cur.push(off[i - 1]);
    }
    if (i === 0) cur.push(off[0]); else cur.push(off[i]);
  }
  if (cur.length > 1) runs.push(cur);
  return runs;
}
