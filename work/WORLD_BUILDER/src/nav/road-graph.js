// Road network graph + route finding for the Navigator.
// Pure module (no DOM) so it can be unit-tested in Node.
//
// Every road and bridge becomes a polyline ("line"). The graph is built by:
//  1. inserting a junction wherever two lines cross (optional),
//  2. snapping each line end onto the nearest other line when it is close
//     (bridge ends may reach much further, joining them to the island's roads),
//  3. turning consecutive polyline points into edges (one-way roads only forward).
// Points with identical coordinates (e.g. junctions made in the editor) become one node.
import { sampleRoad } from '../objects/road.js';
import { bridgePath } from '../objects/bridge.js';
import { closestPointOnSegment } from '../utils/geometry.js';

export const ROAD_SPEED_KMH = {
  Highway: 100, 'Main Road': 60, 'Secondary Road': 50, 'Local Road': 30, Alley: 20, 'Pedestrian Road': 5, 'Parking Road': 10,
};
export const BRIDGE_SPEED_KMH = {
  'Road Bridge': 50, 'Highway Bridge': 80, 'Pedestrian Bridge': 5, 'Railway Bridge': 0, 'Suspension Bridge': 60, Drawbridge: 40,
};
export const WALK_KMH = 5;
export const CONNECTOR_KMH = 20;
const ROAD_LINK_TOL = 12; // extra px beyond half road widths for joining road ends
const BRIDGE_LINK_TOL = 800; // px a bridge end may reach to find an island road
const CELL = 256;

function lineList(data, mode) {
  const lines = [];
  for (const r of data.roads) {
    if (mode === 'car' && r.roadType === 'Pedestrian Road') continue;
    const speed = mode === 'walk' ? WALK_KMH : (r.speedLimit > 0 ? r.speedLimit : ROAD_SPEED_KMH[r.roadType] || 30);
    lines.push({
      id: r.id, name: r.name || r.id, kind: 'road', type: r.roadType, width: r.width, speed,
      oneway: mode === 'car' && r.direction === 'One-way',
      pts: sampleRoad(r).map((p) => ({ x: p.x, y: p.y })),
      linkTol: ROAD_LINK_TOL,
    });
  }
  for (const b of data.bridges) {
    if (b.bridgeType === 'Railway Bridge') continue;
    if (mode === 'car' && b.bridgeType === 'Pedestrian Bridge') continue;
    const speed = mode === 'walk' ? WALK_KMH : BRIDGE_SPEED_KMH[b.bridgeType] || 40;
    lines.push({
      id: b.id, name: b.name || b.id, kind: 'bridge', type: b.bridgeType, width: b.width, speed, oneway: false,
      pts: bridgePath(b).map((p) => ({ x: p.x, y: p.y })),
      linkTol: BRIDGE_LINK_TOL,
    });
  }
  return lines.filter((l) => l.pts.length >= 2);
}

// Uniform grid of segments for proximity queries while building.
class SegGrid {
  constructor() { this.cells = new Map(); }
  key(cx, cy) { return `${cx},${cy}`; }
  add(item, minX, minY, maxX, maxY) {
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cy = Math.floor(minY / CELL); cy <= Math.floor(maxY / CELL); cy++) {
        const k = this.key(cx, cy);
        if (!this.cells.has(k)) this.cells.set(k, []);
        this.cells.get(k).push(item);
      }
    }
  }
  near(minX, minY, maxX, maxY) {
    const out = new Set();
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cy = Math.floor(minY / CELL); cy <= Math.floor(maxY / CELL); cy++) {
        for (const it of this.cells.get(this.key(cx, cy)) || []) out.add(it);
      }
    }
    return out;
  }
}

function segIntersection(a, b, c, d) {
  const rX = b.x - a.x; const rY = b.y - a.y;
  const sX = d.x - c.x; const sY = d.y - c.y;
  const den = rX * sY - rY * sX;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * sY - (c.y - a.y) * sX) / den;
  const u = ((c.x - a.x) * rY - (c.y - a.y) * rX) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u, x: a.x + rX * t, y: a.y + rY * t };
}

/**
 * Build the routable graph.
 * @param data project data (runtime form)
 * @param opts.mode 'car' | 'walk'
 * @param opts.crossings treat crossing roads as junctions (default true)
 */
export function buildRoadGraph(data, { mode = 'car', crossings = true } = {}) {
  const lines = lineList(data, mode);
  const grid = new SegGrid();
  lines.forEach((l, li) => {
    l.ins = [];
    for (let si = 0; si < l.pts.length - 1; si++) {
      const a = l.pts[si]; const b = l.pts[si + 1];
      grid.add({ li, si }, Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y));
    }
  });

  // 1. crossings
  let crossingCount = 0;
  if (crossings) {
    const seen = new Set();
    for (const items of grid.cells.values()) {
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const A = items[i]; const B = items[j];
          if (A.li === B.li) continue;
          const key = A.li < B.li ? `${A.li}:${A.si}|${B.li}:${B.si}` : `${B.li}:${B.si}|${A.li}:${A.si}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const la = lines[A.li]; const lb = lines[B.li];
          const hit = segIntersection(la.pts[A.si], la.pts[A.si + 1], lb.pts[B.si], lb.pts[B.si + 1]);
          if (!hit) continue;
          const p = { x: hit.x, y: hit.y };
          la.ins.push({ si: A.si, t: hit.t, p });
          lb.ins.push({ si: B.si, t: hit.u, p });
          crossingCount++;
        }
      }
    }
  }

  // 2. join line ends to nearby lines
  const connectors = [];
  lines.forEach((l, li) => {
    for (const end of [l.pts[0], l.pts[l.pts.length - 1]]) {
      let best = null;
      const reach = l.linkTol + l.width / 2 + 60;
      for (const it of grid.near(end.x - reach, end.y - reach, end.x + reach, end.y + reach)) {
        if (it.li === li) continue;
        const o = lines[it.li];
        if (l.kind === 'bridge' && o.kind === 'bridge') continue; // bridge ends join island roads
        const c = closestPointOnSegment(end, o.pts[it.si], o.pts[it.si + 1]);
        const tol = Math.max(l.linkTol, ROAD_LINK_TOL) + (l.width + o.width) / 2;
        if (c.d <= tol && (!best || c.d < best.c.d)) best = { it, c };
      }
      if (!best) continue;
      const o = lines[best.it.li];
      if (best.c.d <= 1) {
        o.ins.push({ si: best.it.si, t: best.c.t, p: { x: end.x, y: end.y } });
      } else {
        const p = { x: best.c.x, y: best.c.y };
        o.ins.push({ si: best.it.si, t: best.c.t, p });
        connectors.push({ a: { x: end.x, y: end.y }, b: p, len: best.c.d });
      }
    }
  });

  // 3. nodes and edges
  const nodes = [];
  const index = new Map();
  const nodeOf = (p) => {
    const k = `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`;
    let id = index.get(k);
    if (id === undefined) {
      id = nodes.length;
      nodes.push({ x: p.x, y: p.y });
      index.set(k, id);
    }
    return id;
  };
  const adj = [];
  const edges = []; // forward edges, used for snapping
  const addEdge = (u, v, len, line, lineIdx, oneway) => {
    while (adj.length < nodes.length) adj.push([]);
    const e = { u, v, len, speed: line.speed, lineIdx, oneway };
    adj[u].push({ to: v, len, speed: line.speed, lineIdx });
    if (!oneway) adj[v].push({ to: u, len, speed: line.speed, lineIdx });
    edges.push(e);
  };
  lines.forEach((l, li) => {
    const pts = [];
    const ins = l.ins.sort((a, b) => a.si - b.si || a.t - b.t);
    let k = 0;
    for (let si = 0; si < l.pts.length; si++) {
      pts.push(l.pts[si]);
      while (k < ins.length && ins[k].si === si) pts.push(ins[k++].p);
    }
    let prev = nodeOf(pts[0]);
    for (let i = 1; i < pts.length; i++) {
      const cur = nodeOf(pts[i]);
      if (cur === prev) continue;
      const a = nodes[prev]; const b = nodes[cur];
      addEdge(prev, cur, Math.hypot(b.x - a.x, b.y - a.y), l, li, l.oneway);
      prev = cur;
    }
  });
  const connectorLine = { speed: mode === 'walk' ? WALK_KMH : CONNECTOR_KMH };
  for (const c of connectors) addEdge(nodeOf(c.a), nodeOf(c.b), c.len, connectorLine, -1, false);
  while (adj.length < nodes.length) adj.push([]);
  return { mode, lines, nodes, adj, edges, connectors, crossingCount };
}

// Nearest point on the network to p. Returns { edge, t, x, y, d } or null.
export function snapToNetwork(graph, p, maxDist = Infinity) {
  let best = null;
  for (const e of graph.edges) {
    const c = closestPointOnSegment(p, graph.nodes[e.u], graph.nodes[e.v]);
    if (c.d <= maxDist && (!best || c.d < best.d)) best = { edge: e, t: c.t, x: c.x, y: c.y, d: c.d };
  }
  return best;
}

// Binary min-heap keyed by cost.
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(n, c) {
    const a = this.a; a.push([c, n]);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1; const r = l + 1; let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

/**
 * Route between two snapped points (results of snapToNetwork).
 * metric: 'time' (fastest) or 'distance' (shortest). mpp = metres per world pixel.
 * Returns { points, segs, lengthPx, timeSec } or null if unreachable.
 * segs[i] goes from points[i] to points[i+1]: { len, speed, lineIdx }.
 */
export function findRoute(graph, from, to, { metric = 'time', mpp = 0.5 } = {}) {
  const n = graph.nodes.length;
  const S = n; const E = n + 1;
  const nodeXY = (id) => (id === S ? from : id === E ? to : graph.nodes[id]);
  const extra = new Map();
  const add = (u, v, len, speed, lineIdx) => {
    if (!extra.has(u)) extra.set(u, []);
    extra.get(u).push({ to: v, len, speed, lineIdx });
  };
  const fe = from.edge; const te = to.edge;
  add(S, fe.v, (1 - from.t) * fe.len, fe.speed, fe.lineIdx);
  if (!fe.oneway) add(S, fe.u, from.t * fe.len, fe.speed, fe.lineIdx);
  add(te.u, E, to.t * te.len, te.speed, te.lineIdx);
  if (!te.oneway) add(te.v, E, (1 - to.t) * te.len, te.speed, te.lineIdx);
  if (fe === te && (!fe.oneway || from.t <= to.t)) add(S, E, Math.abs(to.t - from.t) * fe.len, fe.speed, fe.lineIdx);

  const cost = (e) => (metric === 'distance' ? e.len : (e.len * mpp) / Math.max(0.1, (e.speed * 1000) / 3600));
  const distArr = new Float64Array(n + 2).fill(Infinity);
  const prev = new Int32Array(n + 2).fill(-1);
  const prevEdge = new Array(n + 2);
  distArr[S] = 0;
  const heap = new Heap();
  heap.push(S, 0);
  while (heap.size) {
    const [c, u] = heap.pop();
    if (c > distArr[u]) continue;
    if (u === E) break;
    const list = u < n ? graph.adj[u] : [];
    const more = extra.get(u) || [];
    for (const e of list.length ? (more.length ? [...list, ...more] : list) : more) {
      const nc = c + cost(e);
      if (nc < distArr[e.to]) {
        distArr[e.to] = nc;
        prev[e.to] = u;
        prevEdge[e.to] = e;
        heap.push(e.to, nc);
      }
    }
  }
  if (!Number.isFinite(distArr[E])) return null;
  const ids = [];
  const segEdges = [];
  for (let v = E; v !== -1; v = prev[v]) {
    ids.push(v);
    if (prevEdge[v]) segEdges.push(prevEdge[v]);
  }
  ids.reverse();
  segEdges.reverse();
  const points = ids.map((id) => ({ x: nodeXY(id).x, y: nodeXY(id).y }));
  const segs = segEdges.map((e) => ({ len: e.len, speed: e.speed, lineIdx: e.lineIdx }));
  // drop zero-length pieces (start exactly on a node)
  const P = [points[0]]; const G = [];
  segs.forEach((s, i) => { if (s.len > 1e-6) { P.push(points[i + 1]); G.push(s); } });
  const lengthPx = G.reduce((a, s) => a + s.len, 0);
  const timeSec = G.reduce((a, s) => a + (s.len * mpp) / ((s.speed * 1000) / 3600 || 0.1), 0);
  return { points: P, segs: G, lengthPx, timeSec };
}

// Group a route into named steps with turn instructions.
export function routeSteps(graph, route) {
  const steps = [];
  const nameOf = (lineIdx) => (lineIdx < 0 ? 'Connector' : graph.lines[lineIdx].name);
  route.segs.forEach((s, i) => {
    const name = nameOf(s.lineIdx);
    const last = steps[steps.length - 1];
    if (last && last.name === name) { last.len += s.len; last.endSeg = i; return; }
    let turn = 'start';
    if (last) {
      const a = route.points[i - 1]; const b = route.points[i]; const c = route.points[i + 1];
      const ang = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x);
      const deg = ((ang * 180) / Math.PI + 540) % 360 - 180;
      turn = Math.abs(deg) < 30 ? 'straight' : deg > 0 ? 'right' : 'left';
    }
    steps.push({ name, kind: s.lineIdx < 0 ? 'connector' : graph.lines[s.lineIdx].kind, turn, len: s.len, startSeg: i, endSeg: i });
  });
  return steps;
}
