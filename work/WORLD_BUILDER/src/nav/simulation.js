// Drive simulation along a computed route: converts route legs into a timed track and
// answers "where is the vehicle at time t". Pure module (testable in Node).

/**
 * legs: array of findRoute() results (one per start→waypoint→…→destination leg).
 * Returns a track with per-point cumulative distance (px) and time (s).
 */
export function buildTrack(legs, mpp = 0.5) {
  const points = [];
  const segs = [];
  const legEnds = [];
  for (const leg of legs) {
    leg.points.forEach((p, i) => {
      if (i === 0 && points.length) return; // leg start == previous leg end
      points.push({ x: p.x, y: p.y });
    });
    segs.push(...leg.segs);
    legEnds.push(points.length - 1);
  }
  const cumPx = [0];
  const cumSec = [0];
  segs.forEach((s, i) => {
    cumPx.push(cumPx[i] + s.len);
    const mps = Math.max(0.1, (s.speed * 1000) / 3600);
    cumSec.push(cumSec[i] + (s.len * mpp) / mps);
  });
  return {
    points, segs, cumPx, cumSec, legEnds, mpp,
    totalPx: cumPx[cumPx.length - 1] || 0,
    totalSec: cumSec[cumSec.length - 1] || 0,
  };
}

// Index of the segment active at time t (binary search on cumSec).
export function segmentAt(track, t) {
  const c = track.cumSec;
  if (t <= 0) return 0;
  if (t >= track.totalSec) return Math.max(0, track.segs.length - 1);
  let lo = 0; let hi = c.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (c[mid] <= t) lo = mid; else hi = mid;
  }
  return lo;
}

/** State of the vehicle at simulated time t (seconds). */
export function stateAt(track, t) {
  if (!track.segs.length) {
    const p = track.points[0] || { x: 0, y: 0 };
    return { x: p.x, y: p.y, heading: 0, seg: 0, speedKmh: 0, distPx: 0, done: true, leg: 0 };
  }
  const tt = Math.max(0, Math.min(t, track.totalSec));
  const i = segmentAt(track, tt);
  const a = track.points[i]; const b = track.points[i + 1];
  const segT = track.cumSec[i + 1] - track.cumSec[i];
  const f = segT > 0 ? (tt - track.cumSec[i]) / segT : 1;
  const x = a.x + (b.x - a.x) * f;
  const y = a.y + (b.y - a.y) * f;
  let leg = track.legEnds.findIndex((end) => i < end);
  if (leg < 0) leg = track.legEnds.length - 1;
  return {
    x, y,
    heading: Math.atan2(b.y - a.y, b.x - a.x),
    seg: i,
    speedKmh: tt >= track.totalSec ? 0 : track.segs[i].speed,
    distPx: track.cumPx[i] + track.segs[i].len * f,
    done: t >= track.totalSec,
    leg,
  };
}

export function formatDistance(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

export function formatDuration(sec) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

export function toCSV(rows) {
  const cols = ['t_sec', 'clock', 'x', 'y', 'speed_kmh', 'heading_deg', 'road', 'event'];
  const esc = (v) => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}
