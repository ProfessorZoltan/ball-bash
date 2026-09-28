// Vector's shaders. One world shader lights everything solid: it draws the
// grid's look (dark faces, lit edges, lines every metre) and the real world's
// (brick, concrete, wood, grass, water, snow, painted in the shader from the
// surface's position) and mixes them by the level's `real`, so the same wall
// is neon in the first level and brick in the sixth. Colours arrive as
// linear light and leave through a filmic curve. At High quality the sun
// casts shadows (a depth map drawn from the sun, SHADOW_*), and what is
// bright glows (the frame drawn off screen, its bright parts blurred and
// laid back over it, BLOOM_*).

export const WORLD_VS = `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=1) in vec3 a_nrm;
layout(location=2) in vec3 a_col;
layout(location=3) in vec2 a_uv;
layout(location=4) in vec2 a_size;
layout(location=5) in float a_mat;
layout(location=6) in float a_glow;
uniform mat4 u_proj;
uniform mat4 u_view;
uniform mat4 u_model;
uniform mat4 u_shadowVP;
uniform mat4 u_shadowVP1;
uniform float u_shadowBias;
uniform float u_shadowBias1;
out vec3 v_wpos;
out vec4 v_spos;
out vec4 v_spos1;
out vec3 v_nrm;
out vec3 v_col;
out vec2 v_uv;
out vec2 v_size;
flat out int v_mat;
out float v_glow;
out vec3 v_lpos;
void main() {
  vec4 w = u_model * vec4(a_pos, 1.0);
  v_wpos = w.xyz;
  v_lpos = a_pos;
  v_nrm = mat3(u_model) * a_nrm;
  v_col = a_col;
  v_uv = a_uv;
  v_size = a_size;
  v_mat = int(a_mat + 0.5);
  v_glow = a_glow;
  // Where this is in the sun's two views, near and far, pushed a little off its
  // surface along the normal (more for the coarser map) so a face never shades itself.
  vec3 nn = normalize(v_nrm);
  v_spos = u_shadowVP * vec4(w.xyz + nn * u_shadowBias, 1.0);
  v_spos1 = u_shadowVP1 * vec4(w.xyz + nn * u_shadowBias1, 1.0);
  gl_Position = u_proj * u_view * w;
}`;

const COMMON = `
float h31(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float h21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1, 0, 0)), f.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), f.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return s;
}
vec3 film(vec3 x) {
  // A gentle filmic shoulder, so glows roll off instead of clipping.
  x *= 0.9;
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
`;

export const WORLD_FS = `#version 300 es
precision highp float;
in vec3 v_wpos;
in vec3 v_nrm;
in vec3 v_col;
in vec2 v_uv;
in vec2 v_size;
flat in int v_mat;
in float v_glow;
in vec3 v_lpos;
uniform vec3 u_eye;
uniform float u_time;
uniform float u_real;
uniform vec3 u_sunDir;
uniform vec3 u_sunCol;
uniform vec3 u_skyCol;
uniform vec3 u_gndCol;
uniform vec3 u_fogCol;
uniform float u_fogDen;
uniform vec3 u_edgeCol;
uniform vec4 u_clip;
uniform vec3 u_tint;
uniform float u_tintAmt;
uniform float u_glowAdd;
uniform float u_alpha;
uniform float u_rain;
uniform int u_nl;
uniform vec4 u_lp[8];
uniform vec4 u_lc[8];
uniform highp sampler2DShadow u_shadow;
uniform highp sampler2DShadow u_shadow1;
uniform float u_shadowAmt;
uniform float u_shadowTexel;
uniform float u_shadowTexel1;
in vec4 v_spos;
in vec4 v_spos1;
out vec4 o;
${COMMON}
/** Where a point is in a sun's map (x, y from 0 to 1, depth), and how near its edge (0 in the middle, 1 at the edge). */
vec4 inMap(vec4 sp) {
  vec3 p = sp.xyz / sp.w * 0.5 + 0.5;
  vec2 d = abs(p.xy * 2.0 - 1.0);
  return vec4(p, p.z < 1.0 ? max(d.x, d.y) : 2.0);
}
/** A soft look-up: nine looks round the spot, each itself a blend of four texels. */
float soft9(highp sampler2DShadow m, vec3 p, float texel, float bias) {
  float s = 0.0;
  for (int i = -1; i <= 1; i++) {
    for (int j = -1; j <= 1; j++) {
      s += texture(m, vec3(p.xy + vec2(float(i), float(j)) * texel, p.z - bias));
    }
  }
  return s / 9.0;
}
/** The far map's look-up: five looks, a cross, softer for what is far off. */
float soft5(highp sampler2DShadow m, vec3 p, float texel, float bias) {
  float s = texture(m, vec3(p.xy, p.z - bias));
  s += texture(m, vec3(p.xy + vec2(texel, 0.0), p.z - bias));
  s += texture(m, vec3(p.xy - vec2(texel, 0.0), p.z - bias));
  s += texture(m, vec3(p.xy + vec2(0.0, texel), p.z - bias));
  s += texture(m, vec3(p.xy - vec2(0.0, texel), p.z - bias));
  return s / 5.0;
}
/**
 * How much of the sun reaches here: 1 in the open, less in a shadow. Close
 * in, the fine map; across its edge, blended into the coarse one, so there is
 * no seam; and out at the coarse one's edge, faded to none, so there is never
 * a line where shadows stop.
 */
float sunShadow() {
  if (u_shadowAmt <= 0.0) return 1.0;
  vec4 a = inMap(v_spos);
  vec4 b = inMap(v_spos1);
  float near = a.w < 1.0 ? 1.0 - smoothstep(0.8, 1.0, a.w) : 0.0;
  float far = b.w < 1.0 ? 1.0 - smoothstep(0.85, 1.0, b.w) : 0.0;
  float s0 = near > 0.0 ? soft9(u_shadow, a.xyz, u_shadowTexel, 0.00004) : 1.0;
  float s1 = near < 1.0 && far > 0.0 ? mix(1.0, soft5(u_shadow1, b.xyz, u_shadowTexel1, 0.00003), far) : 1.0;
  return mix(1.0, mix(s1, s0, near), u_shadowAmt);
}
vec2 planar(vec3 p, vec3 n) {
  vec3 a = abs(n);
  if (a.y > a.x && a.y > a.z) return p.xz;
  if (a.x > a.z) return p.zy;
  return p.xy;
}
float lines(vec2 q, float w) {
  vec2 d = abs(fract(q - 0.5) - 0.5);
  vec2 fw = fwidth(q);
  vec2 l = 1.0 - smoothstep(vec2(w) * 0.5, vec2(w) * 0.5 + fw * 1.5, d);
  return max(l.x, l.y);
}
float edgeDist() {
  if (v_size.x < 0.0) {
    vec3 b = vec3(v_uv, 1.0 - v_uv.x - v_uv.y);
    return min(min(b.x, b.y), b.z);
  }
  vec2 e = min(v_uv, v_size - v_uv);
  return min(e.x, e.y);
}
void main() {
  if (dot(vec4(v_wpos, 1.0), u_clip) < 0.0) discard;
  vec3 n = normalize(v_nrm);
  if (!gl_FrontFacing) n = -n;
  vec3 base = mix(v_col, u_tint, u_tintAmt);
  vec3 P = v_wpos;
  vec2 q = planar(P, n);
  int m = v_mat;
  vec3 alb = base;
  vec3 emis = vec3(0.0);
  float spec = 0.06;
  float shine = 24.0;
  // How much of the grid shows through: all of it at first, its darkness and its
  // lines gone by six tenths real, its lit edges thinning to a trace by the end.
  float digital = clamp(1.0 - u_real * 1.6, 0.0, 1.0);
  float edgeAmt = (1.0 - u_real) * (1.0 - u_real);
  float gridLines = 0.0;
  float edgeK = 1.0;
  float alpha = u_alpha;

  if (m == 1) {
    // The grid's floor: dark, with lines every metre and brighter every four.
    alb = base * 0.07;
    gridLines = max(lines(q, 0.035) * 0.55, lines(q * 0.25, 0.02));
    emis += base * gridLines * 1.6;
    digital = 1.0;
    spec = 0.3;
    shine = 60.0;
  } else if (m == 2) {
    // A panel: the grid's walls.
    alb = base * 0.12;
    digital = 1.0;
    spec = 0.25;
  } else if (m == 22) {
    // Wire: the grid's trees and hills, all edge.
    alb = base * 0.05;
    digital = 1.0;
    edgeK = 1.6;
  } else if (m == 3) {
    // Armoured glass: a tinted sheen that brightens at a glance.
    vec3 V = normalize(u_eye - P);
    float fr = pow(1.0 - abs(dot(V, n)), 3.0);
    alb = base * 0.4;
    emis += base * (0.15 + fr * 0.8);
    alpha = min(alpha, 0.2 + fr * 0.55);
    float streak = smoothstep(0.93, 1.0, sin((q.x + q.y) * 1.4 + 1.0));
    emis += vec3(streak * 0.15);
    spec = 0.8;
    shine = 80.0;
  } else if (m == 4) {
    // Metal: brushed, seamed every two metres.
    float br = vnoise(vec3(q.x * 30.0, q.y * 1.5, 0.0));
    alb = base * (0.75 + 0.25 * br);
    float seam = lines(q * 0.5, 0.012);
    alb *= 1.0 - seam * 0.5;
    spec = 0.45;
    shine = 40.0;
  } else if (m == 5) {
    float f = fbm(P * 1.3);
    alb = base * (0.72 + 0.4 * f);
    float joint = lines(q * vec2(0.25, 0.333), 0.006);
    alb *= 1.0 - joint * 0.35;
  } else if (m == 6) {
    // Brick: rows of 0.25 m, each row offset half a brick.
    vec2 b = q * vec2(1.0 / 0.5, 1.0 / 0.25);
    b.x += step(1.0, mod(floor(b.y), 2.0)) * 0.5;
    vec2 f = fract(b);
    float mortar = 1.0 - smoothstep(0.0, 0.06, min(min(f.x, 1.0 - f.x) * 0.5, min(f.y, 1.0 - f.y)));
    float tone = 0.8 + 0.35 * h21(floor(b));
    alb = mix(base * tone * (0.85 + 0.2 * vnoise(P * 6.0)), vec3(0.5, 0.48, 0.44), mortar * 0.8);
  } else if (m == 7) {
    // Wood: planks 0.2 m wide with grain along them.
    vec2 w = abs(n.y) > 0.5 ? q : q.yx;
    float plank = floor(w.x / 0.2);
    float grain = vnoise(vec3(w.x * 18.0, w.y * 0.6 + plank * 7.0, plank));
    float gap = 1.0 - smoothstep(0.0, 0.012, abs(fract(w.x / 0.2) - 0.5) * 0.2 - 0.094);
    alb = base * (0.7 + 0.25 * grain + 0.15 * h21(vec2(plank, 3.0)));
    alb *= 1.0 - gap * 0.6;
    spec = 0.12;
  } else if (m == 8) {
    float g = vnoise(P * 3.1) * 0.6 + vnoise(P * 11.0) * 0.4;
    alb = base * (0.6 + 0.6 * g);
    alb = mix(alb, alb * vec3(1.25, 1.1, 0.6), smoothstep(0.6, 0.9, vnoise(P * 0.4)));
  } else if (m == 9) {
    float g = vnoise(P * 9.0);
    alb = base * (0.75 + 0.35 * g);
    spec = 0.1 + u_rain * 0.5;
    shine = 30.0 + u_rain * 60.0;
  } else if (m == 10) {
    // Water: moving ripples that catch the sky.
    float t = u_time;
    n = normalize(n + vec3(sin(P.x * 1.7 + t * 1.3) * 0.06 + sin(P.z * 3.1 - t * 1.7) * 0.03, 0.0, cos(P.z * 1.9 + t) * 0.06 + cos(P.x * 2.7 + t * 2.1) * 0.03));
    vec3 V = normalize(u_eye - P);
    float fr = 0.15 + 0.85 * pow(1.0 - max(dot(V, n), 0.0), 4.0);
    alb = base * 0.5;
    emis += u_skyCol * fr * 0.6;
    spec = 1.0;
    shine = 120.0;
  } else if (m == 11) {
    float s = vnoise(P * 4.0);
    alb = base * (0.9 + 0.1 * s);
    emis += vec3(step(0.985, h31(floor(P * 40.0)))) * 0.4;
    spec = 0.2;
  } else if (m == 12) {
    float f = fbm(P * vec3(0.8, 2.4, 0.8));
    alb = base * (0.55 + 0.6 * f);
    alb *= 0.85 + 0.15 * sin(P.y * 7.0 + f * 5.0);
  } else if (m == 13) {
    float f = vnoise(P * 4.3) * 0.6 + vnoise(P * 13.0) * 0.4;
    alb = base * (0.55 + 0.7 * f);
  } else if (m == 14) {
    // A lamp, a sign, a lit window.
    emis += base * 2.2;
    alb = base * 0.2;
    digital *= 0.3;
  } else if (m == 15) {
    // A crate: the grid's glowing box, then a wooden one.
    vec2 e = min(v_uv, v_size - v_uv);
    float frame = 1.0 - smoothstep(0.1, 0.13, min(e.x, e.y));
    float diag = 1.0 - smoothstep(0.03, 0.06, abs(v_uv.x / max(v_size.x, 0.01) - v_uv.y / max(v_size.y, 0.01)));
    float w = vnoise(vec3(q.x * 14.0, q.y * 1.0, 0.0));
    vec3 wood = base * (0.65 + 0.3 * w) * (1.0 + frame * 0.25 + diag * 0.2);
    alb = mix(base * 0.15, wood, u_real);
    emis += base * (frame + diag * 0.6) * (1.0 - u_real) * 1.2;
  } else if (m == 16) {
    // A cracked cover: its own surface, and a crack in it.
    float f = fbm(P * 1.3);
    alb = base * (0.72 + 0.4 * f);
    float c = abs(vnoise(P * 2.2) - 0.5);
    float crack = 1.0 - smoothstep(0.0, 0.025, c);
    alb *= 1.0 - crack * 0.55;
    emis += base * crack * 0.15 * (1.0 - u_real);
  } else if (m == 17) {
    float s = step(0.5, fract((q.x + q.y) * 1.2));
    alb = mix(vec3(0.02), vec3(0.9, 0.62, 0.05), s);
    emis += vec3(0.9, 0.55, 0.05) * s * 0.15 * (1.0 - u_real);
  } else if (m == 18) {
    alb = base * (0.9 + 0.1 * vnoise(P * 20.0));
    alb *= 1.0 - lines(vec2(q.y * 8.0, 0.0), 0.04) * 0.08;
  } else if (m == 19) {
    // A shipping container: corrugated, a little rusted.
    float rib = sin((abs(n.x) > 0.5 ? P.z : P.x) * 18.0);
    alb = base * (0.8 + 0.12 * rib);
    float rust = smoothstep(0.62, 0.8, fbm(P * 1.7));
    alb = mix(alb, vec3(0.28, 0.1, 0.04), rust * 0.6);
    spec = 0.2;
  } else if (m == 20) {
    vec2 f = fract(q * 2.0);
    float grout = 1.0 - smoothstep(0.0, 0.04, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
    alb = mix(base * (0.9 + 0.12 * h21(floor(q * 2.0))), base * 0.5, grout);
    spec = 0.35;
    shine = 50.0;
  } else if (m == 21) {
    float s = vnoise(vec3(q.x * 24.0, q.y * 2.0, 0.0));
    alb = base * (0.55 + 0.5 * s);
  } else if (m == 23) {
    // A screen: lit, scanned, and faintly alive.
    float scan = 0.85 + 0.15 * sin(q.y * 180.0 + u_time * 8.0);
    float flick = 0.92 + 0.08 * sin(u_time * 23.0 + P.x);
    emis += base * 1.6 * scan * flick;
    alb = base * 0.1;
    digital = 1.0;
  } else if (m == 24) {
    alb = base * (0.8 + 0.2 * vnoise(P * 30.0));
  }

  // The grid showing through: lit edges on everything, and faint lines on the
  // real world's surfaces while the grid is still thin over it.
  float e = edgeDist();
  float fw = fwidth(e);
  float edge = 1.0 - smoothstep(0.0, fw * 1.6 + 0.004, e - 0.006);
  float halo = exp(-e * 10.0) * 0.35;
  vec3 ec = mix(base, u_edgeCol, 0.25);
  bool gridMat = m == 1 || m == 2 || m == 22 || m == 23;
  emis += ec * (edge * 1.9 + halo) * (gridMat ? 1.0 : edgeAmt) * edgeK;
  if (!gridMat && m != 3 && m != 14) {
    float gl2 = lines(q, 0.02) * smoothstep(0.3, 1.0, digital) * 0.5;
    emis += u_edgeCol * gl2;
    alb = mix(alb, base * 0.12, digital * 0.85);
  }
  emis += base * (v_glow + u_glowAdd);

  // Light: the sun, the sky above and the ground below, and a few lamps nearby.
  vec3 V = normalize(u_eye - P);
  float ndl = max(dot(n, u_sunDir), 0.0);
  vec3 amb = mix(u_gndCol, u_skyCol, n.y * 0.5 + 0.5);
  vec3 H = normalize(u_sunDir + V);
  float sp = pow(max(dot(n, H), 0.0), shine) * spec;
  float sun = ndl > 0.0 ? sunShadow() : 1.0;
  vec3 col = alb * (amb + u_sunCol * ndl * sun) + u_sunCol * sp * ndl * sun;
  for (int i = 0; i < 8; i++) {
    if (i >= u_nl) break;
    vec3 L = u_lp[i].xyz - P;
    float d = length(L);
    float att = max(0.0, 1.0 - d / u_lp[i].w);
    att *= att;
    L /= max(d, 1e-4);
    float nd = max(dot(n, L), 0.0) * 0.8 + 0.2;
    col += (alb + 0.08) * u_lc[i].rgb * att * nd;
  }
  col += emis;
  if (u_rain > 0.0 && n.y > 0.7) {
    // Rain on the ground: rings that open and fade.
    vec2 cell = floor(P.xz * 1.5);
    float ph = fract(u_time * 0.9 + h21(cell));
    vec2 c = (cell + vec2(h21(cell + 1.3), h21(cell + 7.1))) / 1.5;
    float r = length(P.xz - c);
    col += vec3(0.5, 0.6, 0.7) * u_rain * (1.0 - smoothstep(0.0, 0.02, abs(r - ph * 0.35))) * (1.0 - ph) * 0.4;
  }
  float dist = length(u_eye - P);
  float fog = 1.0 - exp(-u_fogDen * dist);
  col = mix(col, u_fogCol, clamp(fog, 0.0, 1.0));
  o = vec4(pow(film(col), vec3(1.0 / 2.2)), alpha);
}`;

export const SKY_VS = `#version 300 es
out vec2 v_ndc;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  v_ndc = p * 2.0 - 1.0;
  gl_Position = vec4(v_ndc, 0.9999, 1.0);
}`;

export const SKY_FS = `#version 300 es
precision highp float;
in vec2 v_ndc;
uniform mat4 u_invVP;
uniform vec3 u_top;
uniform vec3 u_hor;
uniform vec3 u_low;
uniform vec3 u_sunDir;
uniform vec3 u_sunCol;
uniform vec3 u_edgeCol;
uniform float u_time;
uniform float u_stars;
uniform float u_clouds;
uniform float u_gridSky;
uniform float u_real;
uniform float u_sunSize;
out vec4 o;
${COMMON}
void main() {
  vec4 a = u_invVP * vec4(v_ndc, -1.0, 1.0);
  vec4 b = u_invVP * vec4(v_ndc, 1.0, 1.0);
  vec3 d = normalize(b.xyz / b.w - a.xyz / a.w);
  float y = d.y;
  vec3 col = y > 0.0 ? mix(u_hor, u_top, pow(clamp(y, 0.0, 1.0), 0.55)) : mix(u_hor, u_low, pow(clamp(-y, 0.0, 1.0), 0.4));
  // The sun: a disc and its glow. In the grid it is banded, as Defector's was.
  float s = max(dot(d, u_sunDir), 0.0);
  float disc = smoothstep(1.0 - 0.0006 * u_sunSize, 1.0 - 0.0004 * u_sunSize, s);
  float bands = mix(step(0.45, fract(d.y * 90.0)), 1.0, clamp(u_real * 2.0, 0.0, 1.0));
  col += u_sunCol * (disc * 3.0 * bands + pow(s, 64.0) * 0.6 + pow(s, 6.0) * 0.12);
  // Stars.
  if (u_stars > 0.0 && y > 0.0) {
    vec3 g = floor(d * 220.0);
    float h = h31(g);
    float tw = 0.6 + 0.4 * sin(u_time * (1.0 + h * 3.0) + h * 40.0);
    col += vec3(step(0.9965, h) * tw * u_stars) * smoothstep(0.0, 0.2, y);
  }
  // Clouds: a layer overhead, drifting.
  if (u_clouds > 0.0 && y > 0.01) {
    vec2 uv = d.xz / (y + 0.08) * 1.6 + vec2(u_time * 0.01, u_time * 0.004);
    float c = smoothstep(0.45, 0.8, fbm(vec3(uv, u_time * 0.01)));
    vec3 cc = mix(u_hor * 1.1, vec3(1.0), 0.5) * (0.7 + 0.5 * s);
    col = mix(col, cc, c * u_clouds * smoothstep(0.0, 0.25, y));
  }
  // The grid's horizon: lines on the void below, running to the vanishing point.
  if (u_gridSky > 0.0 && y < -0.001) {
    vec2 g = d.xz / -y * 4.0;
    vec2 f = abs(fract(g) - 0.5);
    vec2 fw = fwidth(g);
    float l = max(1.0 - smoothstep(0.0, fw.x * 1.5, f.x - 0.47), 1.0 - smoothstep(0.0, fw.y * 1.5, f.y - 0.47));
    col += u_edgeCol * l * u_gridSky * 0.5 * smoothstep(0.0, 0.3, -y);
    col += u_edgeCol * u_gridSky * 0.35 * exp(-abs(y) * 60.0);
  }
  o = vec4(pow(film(col), vec3(1.0 / 2.2)), 1.0);
}`;

export const POINT_VS = `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=1) in float a_size;
layout(location=2) in vec4 a_col;
uniform mat4 u_proj;
uniform mat4 u_view;
uniform float u_scale;
out vec4 v_col;
out vec3 v_wpos;
void main() {
  vec4 vp = u_view * vec4(a_pos, 1.0);
  gl_Position = u_proj * vp;
  gl_PointSize = clamp(a_size * u_scale / max(0.05, -vp.z), 1.0, 256.0);
  v_col = a_col;
  v_wpos = a_pos;
}`;

export const POINT_FS = `#version 300 es
precision highp float;
in vec4 v_col;
in vec3 v_wpos;
uniform vec4 u_clip;
out vec4 o;
void main() {
  if (dot(vec4(v_wpos, 1.0), u_clip) < 0.0) discard;
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = dot(c, c);
  if (r > 1.0) discard;
  float a = exp(-r * 3.0) * v_col.a;
  o = vec4(v_col.rgb * a, a);
}`;

/** A wormhole's mouth: the view through it, drawn from the twin's side, and its rim. */
export const MOUTH_FS = `#version 300 es
precision highp float;
in vec3 v_wpos;
in vec3 v_nrm;
in vec3 v_col;
in vec2 v_uv;
in vec2 v_size;
flat in int v_mat;
in float v_glow;
in vec3 v_lpos;
uniform sampler2D u_view2;
uniform vec2 u_res;
uniform vec3 u_tint;
uniform float u_time;
uniform float u_live;
uniform float u_open;
uniform vec4 u_clip;
out vec4 o;
${COMMON}
void main() {
  if (dot(vec4(v_wpos, 1.0), u_clip) < 0.0) discard;
  // Where in the mouth: 0 at the middle, 1 at the rim.
  vec2 a = v_size;
  vec2 p = v_lpos.xy;
  float k = 0.45;
  vec2 qq = abs(p) - (a - k);
  float sd = length(max(qq, 0.0)) + min(max(qq.x, qq.y), 0.0) - k;
  float edge = exp(min(sd, 0.0) * 9.0);
  vec3 col;
  if (u_live > 0.5) {
    col = texture(u_view2, gl_FragCoord.xy / u_res).rgb;
    col = mix(col, u_tint, edge * 0.8);
  } else {
    float ang = atan(p.y, p.x);
    float r = length(p / a);
    float sw = sin(ang * 3.0 + r * 9.0 - u_time * 4.0) * 0.5 + 0.5;
    col = mix(u_tint * 0.15, u_tint, sw * 0.5 * r + edge);
  }
  col += u_tint * edge * 0.6;
  o = vec4(col, u_open);
}`;

/** The sun's depth map: only where things are, seen down the sun. */
export const SHADOW_VS = `#version 300 es
layout(location=0) in vec3 a_pos;
uniform mat4 u_lvp;
uniform mat4 u_model;
void main() {
  gl_Position = u_lvp * u_model * vec4(a_pos, 1.0);
}`;

export const SHADOW_FS = `#version 300 es
precision mediump float;
void main() {}`;

/** A triangle over the whole target, for the passes that work on the finished frame. */
export const POST_VS = `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/**
 * Bloom's first step: the frame at half size, and of it only what is
 * brighter than the threshold, eased in over a soft knee so nothing pops
 * on. The frame is on the screen's curve; the glow is added in linear light.
 */
export const BLOOM_BRIGHT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_texel;
uniform float u_thresh;
out vec4 o;
void main() {
  vec3 c = texture(u_src, v_uv + u_texel * vec2(-1.0, -1.0)).rgb;
  c += texture(u_src, v_uv + u_texel * vec2(1.0, -1.0)).rgb;
  c += texture(u_src, v_uv + u_texel * vec2(-1.0, 1.0)).rgb;
  c += texture(u_src, v_uv + u_texel * vec2(1.0, 1.0)).rgb;
  c *= 0.25;
  float br = max(c.r, max(c.g, c.b));
  float knee = 0.18;
  float soft = clamp(br - u_thresh + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float w = max(soft, br - u_thresh) / max(br, 1e-4);
  o = vec4(pow(c, vec3(2.2)) * w, 1.0);
}`;

/** Down a size, blurring as it goes (the dual filter's downward step). */
export const BLOOM_DOWN_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_texel;
out vec4 o;
void main() {
  vec3 c = texture(u_src, v_uv).rgb * 4.0;
  c += texture(u_src, v_uv - u_texel).rgb;
  c += texture(u_src, v_uv + u_texel).rgb;
  c += texture(u_src, v_uv + vec2(u_texel.x, -u_texel.y)).rgb;
  c += texture(u_src, v_uv - vec2(u_texel.x, -u_texel.y)).rgb;
  o = vec4(c / 8.0, 1.0);
}`;

/** Up a size, blurring again, added onto what is there (the dual filter's upward step). */
export const BLOOM_UP_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_texel;
out vec4 o;
void main() {
  vec2 h = u_texel;
  vec3 c = texture(u_src, v_uv + vec2(-h.x * 2.0, 0.0)).rgb;
  c += texture(u_src, v_uv + vec2(-h.x, h.y)).rgb * 2.0;
  c += texture(u_src, v_uv + vec2(0.0, h.y * 2.0)).rgb;
  c += texture(u_src, v_uv + vec2(h.x, h.y)).rgb * 2.0;
  c += texture(u_src, v_uv + vec2(h.x * 2.0, 0.0)).rgb;
  c += texture(u_src, v_uv + vec2(h.x, -h.y)).rgb * 2.0;
  c += texture(u_src, v_uv + vec2(0.0, -h.y * 2.0)).rgb;
  c += texture(u_src, v_uv + vec2(-h.x, -h.y)).rgb * 2.0;
  o = vec4(c / 12.0, 1.0);
}`;

/** The frame with its glow laid over it, dithered so a soft glow does not band. */
export const BLOOM_MIX_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform float u_amt;
out vec4 o;
float h21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
void main() {
  vec3 sc = texture(u_scene, v_uv).rgb;
  vec3 b = texture(u_bloom, v_uv).rgb * u_amt;
  vec3 c = pow(pow(sc, vec3(2.2)) + b, vec3(1.0 / 2.2));
  c += (h21(gl_FragCoord.xy) - 0.5) / 255.0;
  o = vec4(c, 1.0);
}`;
