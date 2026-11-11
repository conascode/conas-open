// Draws a small overview image of the world (used for ZIP thumbnails/preview.png).
import { sampleRoad } from '../objects/road.js';
import { bridgePath } from '../objects/bridge.js';
import { boxCorners, boundsOfPoints, unionBounds } from './geometry.js';

const MAT = { Grass: '#5a8a3f', Sand: '#d9c48f', Rock: '#80837f', Concrete: '#a6aaae', Soil: '#7c5b3d', Water: '#2f7193' };

export function renderThumbnail(data, size = 512) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = data.world.background;
  ctx.fillRect(0, 0, size, size);
  let b = null;
  for (const isl of data.islands) b = b ? unionBounds(b, boundsOfPoints(isl.polygon)) : boundsOfPoints(isl.polygon);
  if (!b) b = { minX: 0, minY: 0, maxX: data.world.width, maxY: data.world.height };
  const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.08 + 50;
  const span = Math.max(b.maxX - b.minX, b.maxY - b.minY) + pad * 2;
  const s = size / span;
  const ox = (b.minX + b.maxX) / 2 - span / 2;
  const oy = (b.minY + b.maxY) / 2 - span / 2;
  const T = (p) => [(p.x - ox) * s, (p.y - oy) * s];
  const path = (pts, close) => {
    ctx.beginPath();
    pts.forEach((p, i) => { const [x, y] = T(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    if (close) ctx.closePath();
  };
  for (const isl of data.islands) {
    path(isl.polygon, true);
    ctx.fillStyle = MAT[isl.texture] || '#5a8a3f';
    ctx.fill();
    ctx.lineWidth = Math.max(1, isl.coastline.width * s);
    ctx.strokeStyle = '#e6d3a0';
    ctx.stroke();
  }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const r of data.roads) {
    path(sampleRoad(r), false);
    ctx.lineWidth = Math.max(1, r.width * s);
    ctx.strokeStyle = '#3b4046';
    ctx.stroke();
  }
  for (const br of data.bridges) {
    path(bridgePath(br), false);
    ctx.lineWidth = Math.max(1, br.width * s);
    ctx.strokeStyle = '#6a7178';
    ctx.stroke();
  }
  ctx.fillStyle = '#c9d2db';
  for (const o of [...data.buildings, ...data.facilities]) {
    path(boxCorners(o), true);
    ctx.fill();
  }
  return c;
}

export function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}
