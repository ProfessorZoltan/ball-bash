// Scenery: what a level stands among but never touches. Trees of wire and
// then of bark and leaf, server racks, street lamps, cars, bookshelves, far
// mountains. Each is baked into the level's still mesh once, from the same
// few shapes the renderer draws moving things with. DOM-free.
import { MeshData, MAT, unitBox, sphere, cylinder, cone, polyhedron, pyramid, STRIDE } from './meshes.js';
import { lin } from './gl.js';
import { rng } from './math.js';

const PRIM = {};
function prim(name) {
  if (PRIM[name]) return PRIM[name];
  const W = [1, 1, 1];
  const d = {
    box: () => unitBox(W),
    sphere: () => sphere(10, 7, W),
    cyl: () => cylinder(10, W),
    cyl6: () => cylinder(6, W),
    cone: () => cone(10, W),
    cone6: () => cylinder(6, W, 0, 0, 0),
    pyramid: () => pyramid(7, W),
    tetra: () => polyhedron(4, W),
    octa: () => polyhedron(8, W),
    ico: () => polyhedron(20, W),
  }[name];
  PRIM[name] = d();
  return PRIM[name];
}

/**
 * Append a shape to m: scaled by s ([x, y, z]), turned by yaw about y, moved
 * to p; coloured col (linear), in material mat, glowing glow.
 */
export function put(m, name, p, s, yaw, col, mat, glow = 0, bounds = null) {
  const src = prim(name);
  const v = src.v;
  const c = Math.cos(yaw);
  const sn = Math.sin(yaw);
  const matId = typeof mat === 'string' ? MAT[mat] : mat;
  for (let i = 0; i < v.length; i += STRIDE) {
    const x = v[i] * s[0];
    const y = v[i + 1] * s[1];
    const z = v[i + 2] * s[2];
    const px = p[0] + x * c + z * sn;
    const py = p[1] + y;
    const pz = p[2] - x * sn + z * c;
    // Normals scaled by the inverse, so a flattened sphere still lights as a flattened sphere.
    let nx = v[i + 3] / s[0];
    let ny = v[i + 4] / s[1];
    let nz = v[i + 5] / s[2];
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    m.v.push(px, py, pz, nx * c + nz * sn, ny, -nx * sn + nz * c, col[0], col[1], col[2], v[i + 9] * (v[i + 11] < 0 ? 1 : s[0]), v[i + 10] * (v[i + 11] < 0 ? 1 : s[1]), v[i + 11] < 0 ? -1 : v[i + 11] * s[0], v[i + 12] < 0 ? -1 : v[i + 12] * s[1], matId, glow);
    m.count++;
    if (bounds) {
      bounds.min[0] = Math.min(bounds.min[0], px);
      bounds.min[1] = Math.min(bounds.min[1], py);
      bounds.min[2] = Math.min(bounds.min[2], pz);
      bounds.max[0] = Math.max(bounds.max[0], px);
      bounds.max[1] = Math.max(bounds.max[1], py);
      bounds.max[2] = Math.max(bounds.max[2], pz);
    }
  }
}

const L = (hex) => lin(hex);

/** Bake one prop into m. Returns its bounds. */
export function buildProp(m, pr, real = 0) {
  const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  const [x, y, z] = pr.p;
  const k = pr.s || 1;
  const yaw = pr.yaw || 0;
  const r = rng(pr.seed || Math.floor(x * 131 + z * 71));
  const c1 = L(pr.color || '#7fe9ff');
  const c2 = L(pr.color2 || pr.color || '#ffb347');
  const P = (name, px, py, pz, sx, sy, sz, col, mat, glow = 0, ya = yaw) => {
    const cy = Math.cos(yaw);
    const sy2 = Math.sin(yaw);
    put(m, name, [x + (px * cy + pz * sy2) * k, y + py * k, z + (-px * sy2 + pz * cy) * k], [sx * k, sy * k, sz * k], ya, col, mat, glow, b);
  };
  switch (pr.kind) {
    case 'wiretree': {
      // The grid's idea of a tree: stacked polyhedra, all edge.
      const h = 3 + r() * 3;
      P('cyl6', 0, h / 2, 0, 0.15, h, 0.15, c1, 'wire', 0.2);
      P('octa', 0, h + 0.6, 0, 2.6, 2.4, 2.6, c1, 'wire', 0.1);
      P('tetra', 0, h + 2.1, 0, 1.7, 1.7, 1.7, c2, 'wire', 0.1);
      break;
    }
    case 'tree': {
      const h = 2.5 + r() * 2.5;
      const bark = L(pr.bark || '#5a3d26');
      P('cyl', 0, h / 2, 0, 0.35, h, 0.35, bark, 'bark');
      for (let i = 0; i < 4; i++) {
        const a = r() * 6.28;
        const d = r() * 0.9;
        const s = 1.8 + r() * 1.4;
        P('sphere', Math.cos(a) * d, h + 0.3 + r() * 1.3, Math.sin(a) * d, s, s * 0.85, s, c1, 'leaf');
      }
      break;
    }
    case 'pine': {
      const h = 5 + r() * 5;
      const bark = L(pr.bark || '#4a3322');
      P('cyl', 0, h * 0.3, 0, 0.35, h * 0.6, 0.35, bark, 'bark');
      for (let i = 0; i < 4; i++) {
        const w = (1 - i / 4) * h * 0.42 + 0.6;
        P('cone', 0, h * 0.3 + i * h * 0.17 + w * 0.35, 0, w, w * 0.9, w, c1, real > 0.8 && pr.snow ? 'snow' : 'leaf');
      }
      break;
    }
    case 'rock': {
      const s = 1 + r() * 2;
      P('ico', 0, s * 0.3, 0, s * (1.2 + r() * 0.6), s * (0.7 + r() * 0.4), s * (1 + r() * 0.5), c1, 'rock', 0, yaw + r() * 3);
      break;
    }
    case 'mountain': {
      // Far off, big and plain: wire in the grid, rock and snow in the world.
      const h = 40 + r() * 60;
      const w = h * (1.4 + r() * 0.8);
      P(real < 0.3 ? 'pyramid' : 'cone6', 0, h / 2, 0, w, h, w * (0.8 + r() * 0.4), c1, real < 0.3 ? 'wire' : 'rock', 0, yaw + r());
      if (real > 0.5 && pr.snow) P('cone6', 0, h * 0.82, 0, w * 0.36, h * 0.36, w * 0.3, L('#f4f8ff'), 'snow', 0, yaw + r());
      break;
    }
    case 'monolith': {
      const h = 6 + r() * 14;
      P('box', 0, h / 2, 0, 2 + r() * 3, h, 2 + r() * 3, c1, 'panel', 0.05);
      break;
    }
    case 'rack': {
      // A server rack, lights running down its face.
      const h = 2.2;
      P('box', 0, h / 2, 0, 0.9, h, 1.1, L(pr.body || '#1b1f26'), 'metal');
      for (let i = 0; i < 9; i++) {
        const lit = r() < 0.7;
        P('box', 0, 0.25 + i * 0.22, 0.56, 0.7, 0.05, 0.02, lit ? c1 : L('#333a44'), lit ? 'lamp' : 'metal', lit ? 0.4 : 0);
      }
      break;
    }
    case 'lamp': {
      const h = pr.h || 6;
      const pole = L(pr.body || '#3a3f46');
      P('cyl', 0, h / 2, 0, 0.14, h, 0.14, pole, 'metal');
      P('box', 0, h, 0.7, 0.3, 0.12, 1.5, pole, 'metal');
      P('box', 0, h - 0.08, 1.2, 0.35, 0.06, 0.5, c1, 'lamp', 1);
      break;
    }
    case 'car': {
      const body = c1;
      P('box', 0, 0.55, 0, 1.8, 0.7, 4.2, body, 'metal');
      P('box', 0, 1.15, -0.3, 1.6, 0.55, 2.2, L('#1c2530'), 'glass');
      for (const [wx, wz] of [[-0.85, 1.3], [0.85, 1.3], [-0.85, -1.3], [0.85, -1.3]]) P('cyl', wx, 0.35, wz, 0.7, 0.3, 0.7, L('#111111'), 'plain', 0, yaw + Math.PI / 2);
      P('box', 0.6, 0.6, 2.11, 0.35, 0.15, 0.02, L('#fff6d8'), 'lamp', 1);
      P('box', -0.6, 0.6, 2.11, 0.35, 0.15, 0.02, L('#fff6d8'), 'lamp', 1);
      P('box', 0.6, 0.65, -2.11, 0.35, 0.12, 0.02, L('#ff3030'), 'lamp', 1);
      P('box', -0.6, 0.65, -2.11, 0.35, 0.12, 0.02, L('#ff3030'), 'lamp', 1);
      break;
    }
    case 'building': {
      // A block of the skyline, windows lit here and there.
      const w = pr.w || 12;
      const d = pr.d || 12;
      const h = pr.h || 30;
      P('box', 0, h / 2, 0, w, h, d, c1, pr.mat || 'concrete');
      const rows = Math.floor(h / 3.2);
      const cols = Math.max(1, Math.floor(w / 2.6));
      for (let i = 1; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
          if (r() < 0.45) continue;
          const wx = -w / 2 + (j + 0.5) * (w / cols);
          P('box', wx, i * 3.2, d / 2 + 0.02, 1.2, 1.4, 0.04, r() < 0.8 ? c2 : L('#9fd8ff'), 'lamp', 0.6);
        }
      }
      break;
    }
    case 'sign': {
      const w = pr.w || 4;
      const h = pr.h || 1.4;
      P('box', 0, 0, 0, w, h, 0.18, c1, 'screen', 0.5);
      P('box', 0, 0, -0.12, w + 0.2, h + 0.2, 0.06, L('#15171c'), 'metal');
      break;
    }
    case 'shelf': {
      // A bookshelf in the Creator's house.
      const wood = L(pr.body || '#6b4a2e');
      P('box', 0, 1.1, 0, 2, 2.2, 0.5, wood, 'wood');
      for (let s = 0; s < 4; s++) {
        let bx = -0.9;
        while (bx < 0.85) {
          const bw = 0.05 + r() * 0.07;
          const bh = 0.3 + r() * 0.16;
          const col = L(['#8a2f2f', '#2f4f8a', '#3f6b3a', '#c9a45a', '#5a3f6b', '#d8d2c0'][Math.floor(r() * 6)]);
          P('box', bx + bw / 2, 0.18 + s * 0.52 + bh / 2, 0.02, bw, bh, 0.34, col, 'paper');
          bx += bw + 0.005;
        }
      }
      break;
    }
    case 'desk': {
      const wood = L(pr.body || '#7a5536');
      P('box', 0, 0.76, 0, 2.2, 0.06, 1, wood, 'wood');
      for (const [lx, lz] of [[-1, -0.42], [1, -0.42], [-1, 0.42], [1, 0.42]]) P('box', lx, 0.37, lz, 0.07, 0.74, 0.07, wood, 'wood');
      P('box', 0.5, 0.8, 0.1, 0.5, 0.01, 0.7, L('#f2ecdc'), 'paper');
      P('box', -0.4, 1.05, -0.3, 0.9, 0.55, 0.05, c1, 'screen', 0.3);
      break;
    }
    case 'pylon': {
      const h = pr.h || 18;
      P('box', 0, h / 2, 0, 0.5, h, 0.5, c1, real < 0.3 ? 'wire' : 'metal');
      P('box', 0, h - 1, 0, 7, 0.3, 0.3, c1, real < 0.3 ? 'wire' : 'metal');
      break;
    }
    case 'crane': {
      const h = pr.h || 34;
      const col = c1;
      for (const [lx, lz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) P('box', lx, h / 2, lz, 0.6, h, 0.6, col, 'metal');
      P('box', 0, h, 6, 2, 2, 40, col, 'metal');
      P('box', 0, h + 3, -2, 3, 6, 3, L('#dde3e8'), 'metal');
      break;
    }
    case 'buoy': {
      P('cyl', 0, 0.4, 0, 1, 1.2, 1, c1, 'metal');
      P('sphere', 0, 1.3, 0, 0.3, 0.3, 0.3, c2, 'lamp', 1);
      break;
    }
    case 'rackface': {
      // The front of a server rack, flush to the wall, lights running down it.
      P('box', 0, 1.15, 0, 1.2, 2.3, 0.3, L(pr.body || '#1b1f26'), 'metal');
      for (let i = 0; i < 10; i++) {
        const lit = r() < 0.75;
        P('box', (r() - 0.5) * 0.5, 0.25 + i * 0.2, 0.16, 0.4 + r() * 0.3, 0.04, 0.02, lit ? (r() < 0.8 ? c1 : L('#9dff5c')) : L('#333a44'), lit ? 'lamp' : 'metal', lit ? 0.3 : 0);
      }
      break;
    }
    case 'pipes': {
      for (let i = 0; i < 3; i++) P('cyl', 0, 1.2 + i * 0.9, 0, 0.3 - i * 0.05, 3.2, 0.3 - i * 0.05, i === 1 ? c2 : c1, 'metal', 0, yaw + Math.PI / 2 + Math.PI / 2);
      break;
    }
    case 'furnace': {
      P('box', 0, 1.3, 0, 2.2, 2.6, 0.5, L(pr.body || '#5a3226'), 'brick');
      P('box', 0, 0.9, 0.2, 1.3, 1, 0.2, L('#ff7a1a'), 'lamp', 1.4);
      break;
    }
    case 'poster': {
      P('box', 0, 1.9, 0, 1.6, 1.1, 0.05, c1, 'screen', 0.1);
      P('box', 0, 1.9, -0.02, 1.75, 1.25, 0.03, L('#2a2622'), 'metal');
      break;
    }
    case 'tileband': {
      P('box', 0, 2.8, 0, 3, 0.4, 0.04, c1, 'tile');
      break;
    }
    case 'painting': {
      P('box', 0, 2, 0, 1.1, 0.8, 0.05, L('#6a4a22'), 'wood');
      P('box', 0, 2, 0.03, 0.95, 0.65, 0.02, c1, 'paper');
      break;
    }
    case 'window': {
      P('box', 0, 2.2, 0, 1.4, 1.8, 0.06, L('#3a2a1a'), 'wood');
      P('box', 0, 2.2, 0.04, 1.2, 1.6, 0.02, c1, 'lamp', 0.6);
      break;
    }
    case 'clock': {
      P('cyl', 0, 2.6, 0, 1.2, 0.08, 1.2, L('#f2ecdc'), 'paper', 0, yaw);
      P('box', 0, 2.75, 0.06, 0.04, 0.35, 0.02, L('#1a1410'), 'metal');
      P('box', 0.1, 2.6, 0.06, 0.25, 0.03, 0.02, L('#1a1410'), 'metal');
      break;
    }
    case 'column': {
      const h = pr.h || 8;
      P('cyl', 0, h / 2, 0, 0.9, h, 0.9, c1, pr.mat || 'concrete');
      break;
    }
    case 'plane': {
      // A flat of ground far out past the level, to stand the scenery on.
      P('box', 0, -0.5, 0, pr.w || 600, 1, pr.d || 600, c1, pr.mat || 'grass');
      break;
    }
    default:
      return null;
  }
  return b;
}

export { MeshData };
