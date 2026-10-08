/**
 * graph-layout.js — a small deterministic 3D force layout plus the camera maths.
 * No libraries. Positions are seeded from each node's id, so the same vault
 * always lays out the same way (calm, predictable, testable).
 */

export function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rand(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const REST = { topic: 112, commitment: 84, support: 92 };
const BASE_RADIUS = { person: 11, topic: 8, commitment: 8, support: 7 };

export function nodeRadius(n) {
  return BASE_RADIUS[n.type] * (1 + Math.min(1.1, Math.log2(1 + (n.weight ?? 1)) * 0.28));
}

/**
 * @param {{nodes:object[],links:object[]}} graph
 * @param {Map<string,{x:number,y:number,z:number}>} [prev] positions to warm-start from
 */
export function createLayout(graph, prev = null) {
  const idx = new Map();
  const P = graph.nodes.map((n, i) => {
    idx.set(n.id, i);
    const old = prev?.get(n.id);
    if (old) return { id: n.id, x: old.x, y: old.y, z: old.z, vx: 0, vy: 0, vz: 0 };
    const r = rand(hash32(n.id));
    const u = r() * 2 - 1, th = r() * Math.PI * 2, rad = 90 + r() * 140, s = Math.sqrt(1 - u * u);
    return { id: n.id, x: rad * s * Math.cos(th), y: rad * u, z: rad * s * Math.sin(th), vx: 0, vy: 0, vz: 0 };
  });
  const L = graph.links.map((l) => ({ a: idx.get(l.source), b: idx.get(l.target), w: l.weight ?? 1, rest: REST[graph.nodes[idx.get(l.target)]?.type] ?? 70 })).filter((l) => l.a !== undefined && l.b !== undefined);
  const mass = graph.nodes.map((n) => 1 + Math.log2(1 + (n.weight ?? 1)) * 0.5);

  let alpha = 1;
  function step() {
    const n = P.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = P[i].x - P[j].x, dy = P[i].y - P[j].y, dz = P[i].z - P[j].z;
        let d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 0.01) { dx = 0.1; dy = 0.1; dz = 0.1; d2 = 0.03; }
        const d = Math.sqrt(d2);
        const f = (6200 * mass[i] * mass[j]) / d2 / d;
        const fx = dx * f, fy = dy * f, fz = dz * f;
        P[i].vx += fx; P[i].vy += fy; P[i].vz += fz;
        P[j].vx -= fx; P[j].vy -= fy; P[j].vz -= fz;
      }
    }
    for (const l of L) {
      const A = P[l.a], B = P[l.b];
      const dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.01;
      const f = (0.06 * (d - l.rest)) / d * Math.min(2, 0.6 + l.w * 0.2);
      A.vx += dx * f; A.vy += dy * f; A.vz += dz * f;
      B.vx -= dx * f; B.vy -= dy * f; B.vz -= dz * f;
    }
    for (const p of P) {
      p.vx -= p.x * 0.007; p.vy -= p.y * 0.007; p.vz -= p.z * 0.007; // gentle gravity to centre
      p.x += Math.max(-30, Math.min(30, p.vx * alpha)); p.y += Math.max(-30, Math.min(30, p.vy * alpha)); p.z += Math.max(-30, Math.min(30, p.vz * alpha));
      p.vx *= 0.55; p.vy *= 0.55; p.vz *= 0.55;
    }
    alpha = Math.max(0.02, alpha * 0.985);
    return alpha;
  }
  return {
    positions: P,
    index: idx,
    step,
    get alpha() { return alpha; },
    settle(iterations = 260) { for (let i = 0; i < iterations; i++) step(); },
    reheat(a = 0.6) { alpha = a; },
    snapshot() { return new Map(P.map((p) => [p.id, { x: p.x, y: p.y, z: p.z }])); },
  };
}

// ── camera ──
export function makeView() {
  return { mode: "3d", yaw: 0.55, pitch: -0.28, zoom: 1, panX: 0, panY: 0 };
}

const CAMERA = 900;

/** Project a 3D point to the screen. depth: bigger = further away. */
export function project(p, view, w, h) {
  if (view.mode === "flat") {
    return { x: w / 2 + view.panX + p.x * view.zoom, y: h / 2 + view.panY + p.y * view.zoom, scale: view.zoom, depth: 0 };
  }
  const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
  const x1 = p.x * cy + p.z * sy;
  const z1 = -p.x * sy + p.z * cy;
  const y1 = p.y * cp - z1 * sp;
  const z2 = p.y * sp + z1 * cp;
  const s = CAMERA / Math.max(200, CAMERA + z2);
  return { x: w / 2 + view.panX + x1 * s * view.zoom, y: h / 2 + view.panY + y1 * s * view.zoom, scale: s * view.zoom, depth: z2 };
}

/**
 * Zoom and pan so the graph, as currently rotated, fills about `fill` of the canvas and sits centred.
 * Uses the real projected bounding box (not a worst-case radius), so small graphs aren't left tiny.
 */
export function fitView(positions, view, w, h, fill = 0.8) {
  if (!positions.length) return { zoom: 1, panX: 0, panY: 0 };
  const probe = { ...view, zoom: 1, panX: 0, panY: 0 };
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of positions) {
    const s = project(p, probe, w, h);
    x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y);
  }
  const bw = Math.max(60, x1 - x0), bh = Math.max(60, y1 - y0);
  const zoom = Math.max(0.35, Math.min(3.2, Math.min((w * fill) / bw, (h * fill) / bh)));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return { zoom, panX: -(cx - w / 2) * zoom, panY: -(cy - h / 2) * zoom };
}
