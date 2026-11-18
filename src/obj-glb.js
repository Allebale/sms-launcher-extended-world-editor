'use strict';

// Wavefront OBJ models (with their .mtl materials and texture pictures) as a binary glTF, for the
// world editor's model import: the OBJ is turned into a .glb in memory and read as one
// (world-model.js), so both kinds of file come in the same way.
//
// OBJ: `v x y z [r g b]` positions (with optional vertex colours), `vt u v` texture coordinates
// (v up from the bottom, where glTF counts down from the top), `vn` normals, `f` faces of three
// or more corners (`v`, `v/vt`, `v//vn`, `v/vt/vn`, 1-based, negative counting back from the
// last), `usemtl` and `mtllib`. MTL: `newmtl`, `Kd` colour, `d` or `Tr` opacity, `map_Kd`
// texture (options before the file name skipped), `map_d` see-through mask.

const MAX_FILE = 64 << 20;

function parseMtl(text) {
  const materials = new Map();
  let current = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const [key, ...rest] = line.split(/\s+/);
    const lower = key.toLowerCase();
    if (lower === 'newmtl') { current = { name: rest.join(' '), color: [1, 1, 1], opacity: 1, texture: null, mask: false }; materials.set(current.name, current); continue; }
    if (!current) continue;
    if (lower === 'kd') current.color = rest.slice(0, 3).map(Number).map(v => (Number.isFinite(v) ? v : 1));
    else if (lower === 'd') current.opacity = Number(rest[0]) >= 0 ? Number(rest[0]) : 1;
    else if (lower === 'tr') current.opacity = Number(rest[0]) >= 0 ? 1 - Number(rest[0]) : 1;
    else if (lower === 'map_kd') current.texture = mapFile(rest);
    else if (lower === 'map_d') current.mask = true;
  }
  return materials;
}
// A map statement's file name: what's left after its options (-o 0 0 0, -s 1 1 1, -bm 1, -clamp on…).
function mapFile(tokens) {
  const counts = { '-o': 3, '-s': 3, '-t': 3, '-bm': 1, '-blendu': 1, '-blendv': 1, '-boost': 1, '-cc': 1, '-clamp': 1, '-imfchan': 1, '-mm': 2, '-texres': 1, '-type': 1 };
  let i = 0;
  while (i < tokens.length && tokens[i].startsWith('-') && counts[tokens[i].toLowerCase()] !== undefined) i += 1 + counts[tokens[i].toLowerCase()];
  return tokens.slice(i).join(' ').replace(/\\/g, '/') || null;
}

// `readFile(name)`: a file next to the OBJ (an .mtl, a picture) as a Buffer, or null.
function objToGlb(text, readFile) {
  const v = [], colors = [], vt = [], vn = [];
  const groups = new Map();  // material name -> { faces: [[corner, ...]] }
  let material = '', materials = new Map(), hasColor = false;
  const lines = String(text).split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const parts = line.split(/\s+/), key = parts[0];
    if (key === 'v') {
      v.push(parts.slice(1, 4).map(Number));
      if (parts.length >= 7) { colors.push(parts.slice(4, 7).map(Number)); hasColor = true; } else colors.push([1, 1, 1]);
    } else if (key === 'vt') vt.push([Number(parts[1]) || 0, Number(parts[2]) || 0]);
    else if (key === 'vn') vn.push(parts.slice(1, 4).map(Number));
    else if (key === 'usemtl') material = parts.slice(1).join(' ');
    else if (key === 'mtllib') {
      for (const name of [parts.slice(1).join(' '), ...parts.slice(1)]) {
        const data = name && readFile(name.replace(/\\/g, '/'));
        if (data) { for (const [k, m] of parseMtl(data.toString('utf8'))) materials.set(k, m); break; }
      }
    } else if (key === 'f' && parts.length >= 4) {
      const resolve = (index, list) => { const n = parseInt(index, 10); return !n ? -1 : n < 0 ? list.length + n : n - 1; };
      const corners = parts.slice(1).map(token => {
        const [p, t, n] = token.split('/');
        return [resolve(p, v), t ? resolve(t, vt) : -1, n ? resolve(n, vn) : -1];
      });
      if (corners.some(c => c[0] < 0 || c[0] >= v.length)) continue;
      if (!groups.has(material)) groups.set(material, []);
      groups.get(material).push(corners);
    }
  }
  if (!groups.size) throw new Error('The OBJ model has no faces to show.');

  // One primitive per material, its corners shared where position, texture coordinate and normal match.
  const bin = [], bufferViews = [], accessors = [], gltfMaterials = [], images = [], textures = [], primitives = [];
  let size = 0;
  const addView = (buffer, target) => {
    const aligned = Buffer.concat([buffer, Buffer.alloc((4 - buffer.length % 4) % 4)]);
    bufferViews.push({ buffer: 0, byteOffset: size, byteLength: buffer.length, ...(target ? { target } : {}) });
    bin.push(aligned);
    size += aligned.length;
    return bufferViews.length - 1;
  };
  const addAccessor = (array, type, componentType, extra = {}) => {
    const view = addView(Buffer.from(array.buffer, array.byteOffset, array.byteLength), componentType === 5125 ? 34963 : 34962);
    accessors.push({ bufferView: view, componentType, count: array.length / { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type], type, ...extra });
    return accessors.length - 1;
  };
  const textureOf = new Map();
  for (const [name, faces] of groups) {
    const keyed = new Map(), position = [], uv = [], normal = [], color = [], index = [];
    const anyUv = faces.some(f => f.some(c => c[1] >= 0)), anyNormal = faces.some(f => f.every(c => c[2] >= 0));
    const corner = c => {
      const key = c.join('/');
      if (!keyed.has(key)) {
        keyed.set(key, position.length / 3);
        position.push(...v[c[0]].map(x => (Number.isFinite(x) ? x : 0)));
        const t = vt[c[1]] || [0, 0];
        uv.push(t[0], 1 - t[1]);  // glTF counts v down from the top
        normal.push(...(vn[c[2]] || [0, 1, 0]));
        color.push(...colors[c[0]], 1);
      }
      return keyed.get(key);
    };
    for (const f of faces) for (let i = 2; i < f.length; i++) index.push(corner(f[0]), corner(f[i - 1]), corner(f[i]));
    const attributes = { POSITION: addAccessor(Float32Array.from(position), 'VEC3', 5126, bounds(position)) };
    if (anyNormal) attributes.NORMAL = addAccessor(Float32Array.from(normal), 'VEC3', 5126);
    if (anyUv) attributes.TEXCOORD_0 = addAccessor(Float32Array.from(uv), 'VEC2', 5126);
    if (hasColor) attributes.COLOR_0 = addAccessor(Float32Array.from(color), 'VEC4', 5126);
    const indices = addAccessor(Uint32Array.from(index), 'SCALAR', 5125);

    const m = materials.get(name) || { color: [0.8, 0.8, 0.8], opacity: 1, texture: null, mask: false };
    const pbr = { baseColorFactor: [...m.color.slice(0, 3), Math.max(0, Math.min(1, m.opacity))], metallicFactor: 0 };
    if (m.texture && anyUv) {
      if (!textureOf.has(m.texture)) {
        const data = readFile(m.texture) || readFile(m.texture.split('/').pop());
        if (data && data.length <= MAX_FILE) {
          images.push({ bufferView: addView(data), mimeType: /\.jpe?g$/i.test(m.texture) ? 'image/jpeg' : 'image/png' });
          textures.push({ source: images.length - 1 });
          textureOf.set(m.texture, textures.length - 1);
        } else textureOf.set(m.texture, -1);
      }
      if (textureOf.get(m.texture) >= 0) { pbr.baseColorTexture = { index: textureOf.get(m.texture) }; pbr.baseColorFactor = [1, 1, 1, pbr.baseColorFactor[3]]; }
    }
    gltfMaterials.push({ name: name || 'default', pbrMetallicRoughness: pbr, ...(m.mask || m.opacity < 1 ? { alphaMode: 'MASK' } : {}), doubleSided: true });
    primitives.push({ attributes, indices, material: gltfMaterials.length - 1 });
  }
  const json = {
    asset: { version: '2.0', generator: 'sms-launcher obj' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives }], materials: gltfMaterials, accessors, bufferViews, buffers: [{ byteLength: size }],
    ...(images.length ? { images, textures } : {}),
  };
  return glb(json, Buffer.concat(bin));
}

function bounds(position) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < position.length; i++) { min[i % 3] = Math.min(min[i % 3], position[i]); max[i % 3] = Math.max(max[i % 3], position[i]); }
  return { min, max };
}

function glb(json, bin) {
  let text = Buffer.from(JSON.stringify(json));
  text = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 0x20)]);
  const chunk = (kind, body) => { const head = Buffer.alloc(8); head.writeUInt32LE(body.length); head.write(kind, 4, 'ascii'); return Buffer.concat([head, body]); };
  const body = Buffer.concat([chunk('JSON', text), chunk('BIN\0', Buffer.concat([bin, Buffer.alloc((4 - bin.length % 4) % 4)]))]);
  const head = Buffer.alloc(12);
  head.write('glTF'); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + body.length, 8);
  return Buffer.concat([head, body]);
}

module.exports = { objToGlb, parseMtl, mapFile };
