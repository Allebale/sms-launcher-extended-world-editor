'use strict';

// Players' own 3D models for the world editor: a binary glTF (.glb, as Blender
// exports it) read into a few parts, one per material, each with its texture
// (or a plain colour), and kept in the level file. They're placed like the
// stage pieces and exported into the stage's model and ground, standing
// still: scenery to look at and walk on, not things that move.

const { Glb, nodeLocal } = require('./glb');
const { readPng, writePng } = require('./texture-image');

const MODEL_ID = /^model-[0-9a-f]{12}$/;
const isUserModel = id => MODEL_ID.test(String(id));
const MAX_TRIANGLES = 20000, MAX_PARTS = 32, MAX_MODELS = 16;
// glTF's metres in the game's units (Mario is about 160 tall).
const UNITS = 100;

const mul = (a, b) => {
  const out = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) out[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c];
  return out;
};
const I4 = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
// Normals turn with the inverse transpose of the matrix's 3×3.
function normalMatrix(m) {
  const [a, b, c, d, e, f, g, h, i] = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
  const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g;
  const det = a * A + b * B + c * C || 1;
  return [A / det, (c * h - b * i) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, (c * d - a * f) / det, C / det, (b * g - a * h) / det, (a * e - b * d) / det];
}

// A plain colour as a small texture, for materials without one.
function swatch([r, g, b, a]) {
  const rgba = new Uint8Array(8 * 8 * 4);
  for (let i = 0; i < rgba.length; i += 4) rgba.set([r, g, b, a].map(v => Math.round(Math.max(0, Math.min(1, v)) * 255)), i);
  return { width: 8, height: 8, rgba };
}

// The model from a .glb: { parts: [{ texture, cutout, position, normal, uv, color, index }], size }.
// `decodeImage(bytes)` turns an embedded picture into { width, height, rgba }
// with sides a power of two (the main process does it with Chromium).
// Positions are in game units, standing on y = 0 and centred on x and z;
// corners go counter-clockwise seen from outside.
function readGlb(data, decodeImage) {
  const glb = new Glb(data), g = glb.json, nodes = g.nodes;
  const parent = new Array(nodes.length).fill(-1);
  nodes.forEach((n, i) => (n.children || []).forEach(c => { parent[c] = i; }));
  const local = nodes.map(nodeLocal), world = [];
  const worldOf = i => world[i] || (world[i] = parent[i] >= 0 ? mul(worldOf(parent[i]), local[i]) : local[i]);
  const byMaterial = new Map();  // glTF material -> { position: [], normal: [], uv: [], color: [], index: [] }
  let triangles = 0;
  nodes.forEach((node, ni) => {
    if (node.mesh === undefined) return;
    const M = mul([UNITS, 0, 0, 0, 0, UNITS, 0, 0, 0, 0, UNITS, 0, 0, 0, 0, 1], worldOf(ni)), N = normalMatrix(M);
    for (const prim of g.meshes[node.mesh]?.primitives || []) {
      const mode = prim.mode ?? 4, A = prim.attributes || {};
      if (![4, 5, 6].includes(mode) || A.POSITION === undefined) continue;
      const p = glb.accessor(A.POSITION), count = p.length / 3;
      let index = prim.indices !== undefined ? Array.from(glb.accessor(prim.indices)) : Array.from({ length: count }, (_, i) => i);
      if (mode === 5) { const t = []; for (let i = 2; i < index.length; i++) t.push(...(i & 1 ? [index[i - 1], index[i - 2], index[i]] : [index[i - 2], index[i - 1], index[i]])); index = t; }
      if (mode === 6) { const t = []; for (let i = 2; i < index.length; i++) t.push(index[0], index[i - 1], index[i]); index = t; }
      triangles += index.length / 3;
      if (triangles > MAX_TRIANGLES)
        throw new Error(`The model has more than ${MAX_TRIANGLES.toLocaleString()} triangles: simplify it (in Blender, a Decimate modifier) and try again.`);
      let n = A.NORMAL !== undefined ? glb.accessor(A.NORMAL) : null;
      if (!n) {  // flat-ish normals from the faces, where the model has none
        n = new Float64Array(p.length);
        for (let t = 0; t < index.length; t += 3) {
          const [a, b, c] = [index[t], index[t + 1], index[t + 2]];
          const e1 = [0, 1, 2].map(k => p[b * 3 + k] - p[a * 3 + k]), e2 = [0, 1, 2].map(k => p[c * 3 + k] - p[a * 3 + k]);
          const f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
          for (const v of [a, b, c]) for (let k = 0; k < 3; k++) n[v * 3 + k] += f[k];
        }
      }
      const st = A.TEXCOORD_0 !== undefined ? glb.accessor(A.TEXCOORD_0) : null;
      const colorWidth = A.COLOR_0 !== undefined ? (g.accessors[A.COLOR_0].type === 'VEC4' ? 4 : 3) : 0;
      const colors = colorWidth ? glb.accessor(A.COLOR_0) : null;
      const material = prim.material ?? -1;
      if (!byMaterial.has(material)) {
        if (byMaterial.size >= MAX_PARTS) throw new Error(`The model has more than ${MAX_PARTS} materials: join some (one texture can cover several) and try again.`);
        byMaterial.set(material, { position: [], normal: [], uv: [], color: [], index: [] });
      }
      const part = byMaterial.get(material), base = part.position.length / 3;
      for (let v = 0; v < count; v++) {
        const x = p[v * 3], y = p[v * 3 + 1], z = p[v * 3 + 2];
        part.position.push(M[0] * x + M[1] * y + M[2] * z + M[3], M[4] * x + M[5] * y + M[6] * z + M[7], M[8] * x + M[9] * y + M[10] * z + M[11]);
        const nx = n[v * 3], ny = n[v * 3 + 1], nz = n[v * 3 + 2];
        const t = [N[0] * nx + N[3] * ny + N[6] * nz, N[1] * nx + N[4] * ny + N[7] * nz, N[2] * nx + N[5] * ny + N[8] * nz];
        const l = Math.hypot(...t) || 1;
        part.normal.push(t[0] / l, t[1] / l, t[2] / l);
        part.uv.push(st ? st[v * 2] : 0.5, st ? st[v * 2 + 1] : 0.5);
        part.color.push(...(colors ? [0, 1, 2].map(k => colors[v * colorWidth + k]).concat(colorWidth === 4 ? colors[v * 4 + 3] : 1) : [1, 1, 1, 1]));
      }
      // A mirrored node (negative scale) turns its faces inside out: put them back.
      const det = M[0] * (M[5] * M[10] - M[6] * M[9]) - M[1] * (M[4] * M[10] - M[6] * M[8]) + M[2] * (M[4] * M[9] - M[5] * M[8]);
      for (let t = 0; t + 2 < index.length; t += 3)
        part.index.push(...(det < 0 ? [index[t], index[t + 2], index[t + 1]] : [index[t], index[t + 1], index[t + 2]]).map(v => v + base));
    }
  });
  if (!byMaterial.size || !triangles) throw new Error('The model has no meshes to show.');

  // Standing on the ground, centred where it's placed.
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const part of byMaterial.values()) for (let i = 0; i < part.position.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], part.position[i + k]); max[k] = Math.max(max[k], part.position[i + k]); }
  const shift = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2];
  const images = new Map();
  const parts = [...byMaterial].map(([material, part]) => {
    for (let i = 0; i < part.position.length; i++) part.position[i] -= shift[i % 3];
    const m = g.materials[material] || {}, pbr = m.pbrMetallicRoughness || {};
    const factor = pbr.baseColorFactor || [1, 1, 1, 1];
    const source = pbr.baseColorTexture !== undefined ? g.textures[pbr.baseColorTexture.index]?.source : undefined;
    let texture = null;
    if (source !== undefined) {
      if (!images.has(source)) images.set(source, decodeImage(glb.image(source).bytes));
      texture = images.get(source);
    }
    // The colour goes into the vertex colours over a texture, else becomes the texture.
    const color = Uint8Array.from(part.color.map((v, i) => Math.round(Math.max(0, Math.min(1, v * (texture ? factor[i % 4] : 1))) * 255)));
    return {
      texture: texture || swatch(factor), cutout: m.alphaMode === 'MASK' || m.alphaMode === 'BLEND',
      position: Float32Array.from(part.position), normal: Float32Array.from(part.normal), uv: Float32Array.from(part.uv),
      color, index: Uint32Array.from(part.index),
    };
  });
  return { parts, triangles, size: [0, 1, 2].map(k => Math.round(max[k] - min[k])) };
}

// --- In the level file ------------------------------------------------------------

const b64 = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength).toString('base64');
function typed(text, Type) {
  const bytes = Buffer.from(String(text || ''), 'base64');
  if (bytes.length % Type.BYTES_PER_ELEMENT) return null;
  const copy = new Uint8Array(bytes);  // aligned
  return new Type(copy.buffer, 0, bytes.length / Type.BYTES_PER_ELEMENT);
}
// A read model as the level keeps it: arrays and pictures as base64.
function encodeModel({ id, label, parts, triangles, size }) {
  return {
    id, label, triangles, size,
    parts: parts.map(part => ({
      png: writePng(part.texture.width, part.texture.height, part.texture.rgba).toString('base64'), cutout: part.cutout,
      position: b64(part.position), normal: b64(part.normal), uv: b64(part.uv), color: b64(part.color), index: b64(part.index),
    })),
  };
}

const powerOfTwo = v => Number.isInteger(v) && v >= 8 && v <= 512 && (v & (v - 1)) === 0;
// Models in a level file, checked (not read: that's left to decodeModel).
function cleanUserModels(input) {
  const out = [], seen = new Set();
  for (const model of (Array.isArray(input) ? input : []).slice(0, MAX_MODELS * 2)) {
    if (!model || !isUserModel(model.id) || seen.has(model.id) || !Array.isArray(model.parts) || !model.parts.length || model.parts.length > MAX_PARTS) continue;
    const parts = model.parts.map(part => part && ['png', 'position', 'normal', 'uv', 'color', 'index'].every(k => typeof part[k] === 'string')
      ? { png: part.png, cutout: Boolean(part.cutout), position: part.position, normal: part.normal, uv: part.uv, color: part.color, index: part.index } : null);
    if (parts.some(p => !p)) continue;
    const triangles = parts.reduce((n, p) => n + Buffer.from(p.index, 'base64').length / 12, 0);
    if (!(triangles > 0) || triangles > MAX_TRIANGLES) continue;
    seen.add(model.id);
    const size = Array.isArray(model.size) && model.size.length === 3 && model.size.every(v => Number.isFinite(v)) ? model.size.map(v => Math.round(v)) : [0, 0, 0];
    out.push({ id: model.id, label: String(model.label || 'My model').slice(0, 40), triangles: Math.round(triangles), size, parts });
    if (out.length >= MAX_MODELS) break;
  }
  return out;
}

// A level's model as arrays, read once and checked: corners within their part, pictures as the game needs.
const decoded = new Map();
function decodeModel(model) {
  if (decoded.has(model.id)) return decoded.get(model.id);
  if (decoded.size > 32) decoded.delete(decoded.keys().next().value);
  const parts = model.parts.map(part => {
    const position = typed(part.position, Float32Array), normal = typed(part.normal, Float32Array), uv = typed(part.uv, Float32Array);
    const color = typed(part.color, Uint8Array), index = typed(part.index, Uint32Array), count = position ? position.length / 3 : 0;
    if (!position || position.length % 3 || normal?.length !== position.length || uv?.length !== count * 2 || color?.length !== count * 4 || !index || index.length % 3
      || index.some(v => v >= count) || !position.every(Number.isFinite) || !uv.every(Number.isFinite))
      throw new Error(`${model.label}: the model in this level file is damaged.`);
    const texture = readPng(Buffer.from(part.png, 'base64'));
    if (!powerOfTwo(texture.width) || !powerOfTwo(texture.height)) throw new Error(`${model.label}: its textures' sides must be powers of two from 8 to 512.`);
    return { texture, cutout: part.cutout, position, normal, uv, color, index };
  });
  const out = { ...model, parts };
  decoded.set(model.id, out);
  return out;
}

module.exports = { MODEL_ID, MAX_MODELS, MAX_TRIANGLES, isUserModel, readGlb, encodeModel, cleanUserModels, decodeModel };
