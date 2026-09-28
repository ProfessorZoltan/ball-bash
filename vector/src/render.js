// Vector's renderer: WebGL2, written out by hand like everything else here.
// The level's still solids and scenery are baked once into chunks that are
// culled against the view; what moves is drawn from a list the art (art.js)
// fills each frame, from a few shapes turned and scaled by a matrix. Through
// each open wormhole end the scene is drawn again from the twin's side, into
// a texture the mouth then shows, so a wormhole is a window.
import { createGL, program, mesh, freeMesh, target, freeTarget, lin } from './gl.js';
import { WORLD_VS, WORLD_FS, SKY_VS, SKY_FS, POINT_VS, POINT_FS, MOUTH_FS } from './shaders.js';
import { MeshData, MAT, solidFaces, unitBox, sphere, cylinder, cone, torus, polyhedron, mouth, throat, STRIDE } from './meshes.js';
import { perspective, viewFromBasis, mul4, mat4, camBasis, dot, sub, norm } from './math.js';
import { through, turn, CORNER } from './wormholes.js';
import { WORM } from './config.js';
import { buildProp } from './props.js';

const CHUNK = 32; // m: the still scenery is cut into squares this big, culled whole
const FOV = (68 * Math.PI) / 180;
const NEAR = 0.05;
const FAR = 520;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = createGL(canvas);
    if (!gl) throw new Error('This game needs WebGL2, and this browser has none.');
    this.gl = gl;
    this.world = program(gl, WORLD_VS, WORLD_FS);
    this.sky = program(gl, SKY_VS, SKY_FS);
    this.points = program(gl, POINT_VS, POINT_FS);
    this.mouthProg = program(gl, WORLD_VS, MOUTH_FS);
    this.skyVao = gl.createVertexArray();
    this.shapes = new Map(); // "shape:mat" -> mesh
    this.chunks = [];
    this.dyn = new Map(); // solid id -> mesh for solids that move
    this.list = []; // what art.js asks to be drawn this frame
    this.glassList = [];
    this.pts = [];
    this.lights = [];
    this.quality = 'high';
    this.theme = null;
    this.targets = [null, null, null, null];
    this.pointBuf = gl.createBuffer();
    this.pointVao = gl.createVertexArray();
    gl.bindVertexArray(this.pointVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16);
    gl.bindVertexArray(null);
    this.mouthMesh = mesh(gl, mouth(WORM.a, WORM.b, CORNER));
    this.throatMesh = mesh(gl, throat(WORM.a, WORM.b, CORNER, 1.2));
    this.w = 1;
    this.h = 1;
    this.resize();
  }

  // ---------------------------------------------------------------- set-up

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality === 'low' ? 1 : 1.5);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (w === this.w && h === this.h && this.targets[0]) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.w = w;
    this.h = h;
    const gl = this.gl;
    for (let i = 0; i < this.targets.length; i++) {
      freeTarget(gl, this.targets[i]);
      this.targets[i] = null;
    }
  }

  portalTarget(i) {
    // The view through a mouth is drawn at half the screen's resolution: it is
    // a window, seen smaller than the screen almost always.
    const w = Math.max(64, Math.round(this.w / 2));
    const h = Math.max(64, Math.round(this.h / 2));
    let t = this.targets[i];
    if (!t || t.w !== w || t.h !== h) {
      freeTarget(this.gl, t);
      t = this.targets[i] = target(this.gl, w, h);
    }
    return t;
  }

  /** A shape to draw with a matrix, built once per material. */
  shape(name, mat = 0) {
    const key = `${name}:${mat}`;
    let m = this.shapes.get(key);
    if (m) return m;
    const W = [1, 1, 1];
    let d;
    if (name === 'box') d = unitBox(W, mat);
    else if (name === 'sphere') d = sphere(18, 12, W, mat);
    else if (name === 'ball') d = sphere(10, 6, W, mat);
    else if (name === 'cyl') d = cylinder(18, W, mat);
    else if (name === 'cyl6') d = cylinder(6, W, mat);
    else if (name === 'cone') d = cone(18, W, mat);
    else if (name === 'torus') d = torus(28, 8, 0.08, W, mat);
    else if (name === 'ring') d = torus(36, 6, 0.03, W, mat);
    else if (name === 'tetra') d = polyhedron(4, W, mat);
    else if (name === 'octa') d = polyhedron(8, W, mat);
    else if (name === 'ico') d = polyhedron(20, W, mat);
    else throw new Error(`no shape ${name}`);
    m = mesh(this.gl, d);
    this.shapes.set(key, m);
    return m;
  }

  /**
   * A level: its still solids and scenery baked into chunks, each moving
   * solid into a mesh of its own, and the theme's light and sky.
   */
  setLevel(bp, world) {
    const gl = this.gl;
    for (const c of this.chunks) freeMesh(gl, c.mesh);
    for (const m of this.dyn.values()) freeMesh(gl, m);
    this.chunks = [];
    this.dyn.clear();
    this.theme = themeUniforms(bp.theme);
    this.bp = bp;
    this.worldRef = world;
    const bins = new Map();
    const bin = (x, z) => {
      const k = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
      let b = bins.get(k);
      if (!b) bins.set(k, (b = { m: new MeshData(), glass: new MeshData(), min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }));
      return b;
    };
    const grow = (b, min, max) => {
      for (let i = 0; i < 3; i++) {
        b.min[i] = Math.min(b.min[i], min[i]);
        b.max[i] = Math.max(b.max[i], max[i]);
      }
    };
    for (const s of world.solids) {
      if (s.invisible) continue;
      const look = this.look(s);
      if (world.dynamic.includes(s)) {
        const m = new MeshData();
        solidFaces(m, s, look.col, look.mat, look.glow, look.top);
        // Built where it is now, drawn offset by how far it has moved since.
        this.dyn.set(s.id, { mesh: mesh(gl, m), at: [...s.min], glass: !!s.glass });
        continue;
      }
      const b = bin((s.min[0] + s.max[0]) / 2, (s.min[2] + s.max[2]) / 2);
      solidFaces(s.glass ? b.glass : b.m, s, look.col, look.mat, look.glow, look.top);
      grow(b, s.min, s.max);
    }
    for (const p of bp.props || []) {
      const b = bin(p.p[0], p.p[2]);
      const box = buildProp(b.m, p, this.theme.real);
      if (box) grow(b, box.min, box.max);
    }
    for (const b of bins.values()) {
      const c = { min: b.min, max: b.max };
      if (b.m.count) c.mesh = mesh(gl, b.m);
      if (b.glass.count) c.glass = mesh(gl, b.glass);
      this.chunks.push(c);
    }
  }

  /** How a solid looks: its colour (linear), material and glow, from its own props or its role in the theme. */
  look(s) {
    const T = this.bp.theme;
    const role = (s.role && T.roles && T.roles[s.role]) || {};
    const hex = s.color || role.color || '#8899aa';
    const top = s.top || role.top;
    const matName = s.mat || role.mat || 'panel';
    return { col: lin(hex), top: top ? lin(top) : null, mat: MAT[matName] ?? MAT.panel, glow: s.glow ?? role.glow ?? 0 };
  }

  // ------------------------------------------------------------ the frame's list

  /** Ask for a shape drawn with model matrix `m`, in colour `col` (hex or linear), with options. */
  draw(shape, m, col, o = {}) {
    const c = typeof col === 'string' ? lin(col) : col;
    const e = { mesh: this.shape(shape, o.mat ? MAT[o.mat] ?? o.mat : 0), m, col: c, glow: o.glow || 0, alpha: o.alpha ?? 1, onlyPortal: !!o.onlyPortal, notPortal: !!o.notPortal };
    if (e.alpha < 1) this.glassList.push(e);
    else this.list.push(e);
  }

  /** A soft glowing point (sparks, the aim line, charges' halos). */
  point(p, size, col, alpha = 1) {
    const c = typeof col === 'string' ? lin(col) : col;
    this.pts.push(p[0], p[1], p[2], size, c[0], c[1], c[2], alpha);
  }

  /** A lamp that lights what is near it this frame: a charge, a muzzle, an explosion. */
  light(p, col, radius) {
    if (this.lights.length >= 8) return;
    const c = typeof col === 'string' ? lin(col) : col;
    this.lights.push([p[0], p[1], p[2], radius, c[0], c[1], c[2]]);
  }

  clearList() {
    this.list.length = 0;
    this.glassList.length = 0;
    this.pts.length = 0;
    this.lights.length = 0;
  }

  // ----------------------------------------------------------------- drawing

  /**
   * The whole frame. `cam` is { eye, yaw, pitch }; `ends` the open wormhole
   * ends ({ c, n, u, v, twin, color }); `view` holds the viewmodel's
   * draw callback and the time.
   */
  frame(cam, ends, view) {
    const gl = this.gl;
    this.resize();
    const aspect = this.w / this.h;
    const proj = perspective(FOV, aspect, NEAR, FAR);
    const B = camBasis(cam.yaw, cam.pitch);
    const main = { eye: cam.eye, right: B.right, up: B.up, fwd: B.fwd };
    this.time = view.time;
    // Each end we can see through, drawn from its twin's side first.
    const live = new Map();
    if (this.quality !== 'low') {
      let slot = 0;
      for (const e of ends) {
        if (!e.twin || slot >= this.targets.length) continue;
        const toEye = sub(cam.eye, e.c);
        if (dot(toEye, e.n) < -0.05 && Math.hypot(...toEye) > 1.5) continue; // behind it
        if (Math.hypot(...toEye) > 90) continue;
        if (!this.visible(proj, main, e)) continue;
        const t = this.portalTarget(slot++);
        const vcam = {
          eye: through(e, e.twin, cam.eye),
          right: turn(e, e.twin, B.right),
          up: turn(e, e.twin, B.up),
          fwd: turn(e, e.twin, B.fwd),
        };
        const T = e.twin;
        const clip = [T.n[0], T.n[1], T.n[2], -dot(T.n, T.c) - 0.005];
        gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
        gl.viewport(0, 0, t.w, t.h);
        this.scene(proj, vcam, clip, ends, null, true, view);
        live.set(e, t);
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    this.scene(proj, main, [0, 0, 0, 1], ends, live, false, view);
    if (view.viewmodel) {
      gl.clear(gl.DEPTH_BUFFER_BIT);
      const vproj = perspective((52 * Math.PI) / 180, aspect, 0.01, 10);
      const ident = viewFromBasis([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, -1]);
      this.list.length = 0;
      this.glassList.length = 0;
      view.viewmodel(this);
      this.useWorld(vproj, ident, [0, 0, 0], [0, 0, 0, 1], true);
      this.drawList(this.list, false);
    }
  }

  /** Is an end's mouth anywhere in the view? */
  visible(proj, cam, e) {
    const vp = mul4(proj, viewFromBasis(cam.eye, cam.right, cam.up, cam.fwd));
    const r = Math.max(WORM.a, WORM.b) + 0.1;
    return sphereInFrustum(vp, e.c, r);
  }

  useWorld(proj, view, eye, clip, flatLight = false) {
    const gl = this.gl;
    const P = this.world;
    const T = this.theme;
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u.u_proj, false, proj);
    gl.uniformMatrix4fv(P.u.u_view, false, view);
    gl.uniform3fv(P.u.u_eye, eye);
    gl.uniform1f(P.u.u_time, this.time || 0);
    gl.uniform1f(P.u.u_real, T.real);
    gl.uniform3fv(P.u.u_sunDir, T.sunDir);
    gl.uniform3fv(P.u.u_sunCol, flatLight ? [0.9, 0.9, 0.9] : T.sunCol);
    gl.uniform3fv(P.u.u_skyCol, flatLight ? [0.5, 0.5, 0.55] : T.skyCol);
    gl.uniform3fv(P.u.u_gndCol, flatLight ? [0.2, 0.2, 0.22] : T.gndCol);
    gl.uniform3fv(P.u.u_fogCol, T.fogCol);
    gl.uniform1f(P.u.u_fogDen, flatLight ? 0 : T.fogDen);
    gl.uniform3fv(P.u.u_edgeCol, T.edgeCol);
    gl.uniform4fv(P.u.u_clip, clip);
    gl.uniform1f(P.u.u_rain, T.rain);
    const n = flatLight ? 0 : this.lights.length;
    gl.uniform1i(P.u.u_nl, n);
    if (n) {
      const lp = new Float32Array(32);
      const lc = new Float32Array(32);
      this.lights.forEach((l, i) => {
        lp.set([l[0], l[1], l[2], l[3]], i * 4);
        lc.set([l[4], l[5], l[6], 1], i * 4);
      });
      gl.uniform4fv(P.u.u_lp, lp);
      gl.uniform4fv(P.u.u_lc, lc);
    }
    this.setDraw(null, [1, 1, 1], 0, 0, 1);
  }

  setDraw(m, tint, tintAmt, glow, alpha) {
    const gl = this.gl;
    const u = this.world.u;
    gl.uniformMatrix4fv(u.u_model, false, m || IDENT);
    gl.uniform3fv(u.u_tint, tint);
    gl.uniform1f(u.u_tintAmt, tintAmt);
    gl.uniform1f(u.u_glowAdd, glow);
    gl.uniform1f(u.u_alpha, alpha);
  }

  drawList(list, portal) {
    const gl = this.gl;
    for (const e of list) {
      if ((portal && e.notPortal) || (!portal && e.onlyPortal)) continue;
      this.setDraw(e.m, e.col, 1, e.glow, e.alpha);
      gl.bindVertexArray(e.mesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, e.mesh.count);
    }
  }

  /**
   * The scene from one camera: sky, still chunks, moving solids, the list,
   * the mouths, then what is see-through. `clip` keeps a wormhole's view to
   * what is in front of the twin. `live` maps ends to their drawn views (null
   * inside a wormhole's view, where mouths show only their swirl).
   */
  scene(proj, cam, clip, ends, live, portal, view) {
    const gl = this.gl;
    const T = this.theme;
    const viewM = viewFromBasis(cam.eye, cam.right, cam.up, cam.fwd);
    const vp = mul4(proj, viewM);
    gl.clearColor(T.fogCol[0], T.fogCol[1], T.fogCol[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);
    // Sky.
    gl.depthMask(false);
    const S = this.sky;
    gl.useProgram(S.p);
    gl.uniformMatrix4fv(S.u.u_invVP, false, invert(vp));
    gl.uniform3fv(S.u.u_top, T.skyTop);
    gl.uniform3fv(S.u.u_hor, T.skyHor);
    gl.uniform3fv(S.u.u_low, T.skyLow);
    gl.uniform3fv(S.u.u_sunDir, T.sunDir);
    gl.uniform3fv(S.u.u_sunCol, T.sunDisc);
    gl.uniform3fv(S.u.u_edgeCol, T.edgeCol);
    gl.uniform1f(S.u.u_time, this.time || 0);
    gl.uniform1f(S.u.u_stars, T.stars);
    gl.uniform1f(S.u.u_clouds, T.clouds);
    gl.uniform1f(S.u.u_gridSky, T.gridSky);
    gl.uniform1f(S.u.u_real, T.real);
    gl.uniform1f(S.u.u_sunSize, T.sunSize);
    gl.bindVertexArray(this.skyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);
    // Opaque.
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    this.useWorld(proj, viewM, cam.eye, clip);
    for (const c of this.chunks) {
      if (!c.mesh || !boxInFrustum(vp, c.min, c.max)) continue;
      gl.bindVertexArray(c.mesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, c.mesh.count);
    }
    const W = this.worldRef;
    const glassDyn = [];
    for (const s of W.dynamic) {
      const d = this.dyn.get(s.id);
      if (!d || s.gone) continue;
      if (s.hidden) continue;
      const m = translation(s.min[0] - d.at[0], s.min[1] - d.at[1], s.min[2] - d.at[2]);
      if (d.glass || s.warn) {
        glassDyn.push([d, m, s]);
        continue;
      }
      if (s.switchRef) {
        // A switch: amber while its door is shut, green once open.
        this.setDraw(m, s.switchRef.on ? SWITCH_ON : SWITCH_OFF, 1, 1.2, 1);
      } else this.setDraw(m, [1, 1, 1], 0, 0, 1);
      gl.bindVertexArray(d.mesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, d.mesh.count);
    }
    this.drawList(this.list, portal);
    // The mouths: a view through each, or a swirl inside another wormhole's view.
    gl.disable(gl.CULL_FACE);
    const M = this.mouthProg;
    gl.useProgram(M.p);
    gl.uniformMatrix4fv(M.u.u_proj, false, proj);
    gl.uniformMatrix4fv(M.u.u_view, false, viewM);
    gl.uniform1f(M.u.u_time, this.time || 0);
    gl.uniform4fv(M.u.u_clip, clip);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(-2, -4);
    for (const e of ends) {
      const t = live && live.get(e);
      gl.uniform3fv(M.u.u_tint, lin(e.color || '#ffffff'));
      gl.uniform1f(M.u.u_live, t ? 1 : 0);
      gl.uniform1f(M.u.u_open, 1);
      gl.uniform2f(M.u.u_res, this.w, this.h);
      if (t) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, t.tex);
        gl.uniform1i(M.u.u_view2, 0);
      }
      const mm = endMatrix(e);
      gl.uniformMatrix4fv(M.u.u_model, false, mm);
      gl.bindVertexArray(this.mouthMesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, this.mouthMesh.count);
      // Close to it, the throat behind the surface keeps the view whole as the camera passes the plane.
      if (t && Math.hypot(...sub(cam.eye, e.c)) < 2.5) {
        gl.bindVertexArray(this.throatMesh.vao);
        gl.drawArrays(gl.TRIANGLES, 0, this.throatMesh.count);
      }
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);
    // See-through: glass, flickering floors, beams, then glowing points.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    this.useWorld(proj, viewM, cam.eye, clip);
    for (const c of this.chunks) {
      if (!c.glass || !boxInFrustum(vp, c.min, c.max)) continue;
      this.setDraw(null, [1, 1, 1], 0, 0, 1);
      gl.bindVertexArray(c.glass.vao);
      gl.drawArrays(gl.TRIANGLES, 0, c.glass.count);
    }
    for (const [d, m, s] of glassDyn) {
      const a = s.warn ? (Math.sin((this.time || 0) * 40) > 0 ? 0.85 : 0.25) : 1;
      this.setDraw(m, [1, 1, 1], 0, 0, a);
      gl.bindVertexArray(d.mesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, d.mesh.count);
    }
    this.drawList(this.glassList, portal);
    if (this.pts.length) {
      gl.blendFunc(gl.ONE, gl.ONE);
      const P = this.points;
      gl.useProgram(P.p);
      gl.uniformMatrix4fv(P.u.u_proj, false, proj);
      gl.uniformMatrix4fv(P.u.u_view, false, viewM);
      gl.uniform1f(P.u.u_scale, (this.h / 2) / Math.tan(FOV / 2));
      gl.uniform4fv(P.u.u_clip, clip);
      gl.bindVertexArray(this.pointVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.pts), gl.STREAM_DRAW);
      gl.drawArrays(gl.POINTS, 0, this.pts.length / 8);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  /** Where a screen point looks, for the tools. */
  info() {
    return { w: this.w, h: this.h, chunks: this.chunks.length, shapes: this.shapes.size, verts: this.chunks.reduce((n, c) => n + (c.mesh ? c.mesh.count : 0), 0) };
  }
}

const IDENT = mat4();
const SWITCH_ON = lin('#6dff7a');
const SWITCH_OFF = lin('#ffb347');

function translation(x, y, z) {
  const m = mat4();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}

/** An end's mouth as a model matrix: x across, y along, z out of the surface. */
function endMatrix(e) {
  const m = new Float32Array(16);
  m.set([e.u[0], e.u[1], e.u[2], 0, e.v[0], e.v[1], e.v[2], 0, e.n[0], e.n[1], e.n[2], 0, e.c[0], e.c[1], e.c[2], 1]);
  return m;
}

function themeUniforms(t) {
  const L = (h) => lin(h);
  const sun = norm(t.sun || [0.4, 0.6, 0.3]);
  return {
    real: t.real ?? 0,
    sunDir: sun,
    sunCol: L(t.sunCol || '#ffffff').map((c) => c * (t.sunAmt ?? 1)),
    sunDisc: L(t.sunDisc || t.sunCol || '#ffffff'),
    sunSize: t.sunSize ?? 1,
    skyCol: L(t.skyLight || t.sky[1]).map((c) => c * (t.amb ?? 0.6)),
    gndCol: L(t.gndLight || t.sky[2]).map((c) => c * (t.amb ?? 0.6) * 0.6),
    fogCol: L(t.fog || t.sky[1]),
    fogDen: t.fogDen ?? 0.01,
    edgeCol: L(t.edge || '#7fe9ff'),
    skyTop: L(t.sky[0]),
    skyHor: L(t.sky[1]),
    skyLow: L(t.sky[2]),
    stars: t.stars ?? 0,
    clouds: t.clouds ?? 0,
    gridSky: t.gridSky ?? 0,
    rain: t.rain ?? 0,
  };
}

// ----------------------------------------------------------------- frustum

function planesOf(vp) {
  const r = (i) => [vp[i], vp[4 + i], vp[8 + i], vp[12 + i]];
  const r0 = r(0);
  const r1 = r(1);
  const r2 = r(2);
  const r3 = r(3);
  const ps = [];
  for (const [a, s] of [[r0, 1], [r0, -1], [r1, 1], [r1, -1], [r2, 1], [r2, -1]]) ps.push([r3[0] + s * a[0], r3[1] + s * a[1], r3[2] + s * a[2], r3[3] + s * a[3]]);
  return ps;
}

function boxInFrustum(vp, min, max) {
  for (const p of planesOf(vp)) {
    const x = p[0] >= 0 ? max[0] : min[0];
    const y = p[1] >= 0 ? max[1] : min[1];
    const z = p[2] >= 0 ? max[2] : min[2];
    if (p[0] * x + p[1] * y + p[2] * z + p[3] < 0) return false;
  }
  return true;
}

function sphereInFrustum(vp, c, r) {
  for (const p of planesOf(vp)) {
    const l = Math.hypot(p[0], p[1], p[2]);
    if ((p[0] * c[0] + p[1] * c[1] + p[2] * c[2] + p[3]) / l < -r) return false;
  }
  return true;
}

function invert(m) {
  const inv = new Float32Array(16);
  const a = m;
  inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
  inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
  inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
  inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
  inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
  inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
  inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
  inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
  inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
  inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
  inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
  inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
  inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
  inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
  inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
  inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
  let det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
  det = det ? 1 / det : 0;
  for (let i = 0; i < 16; i++) inv[i] *= det;
  return inv;
}

export { STRIDE };
