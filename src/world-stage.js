'use strict';

// The world editor's stage building: textures players paint onto a stage's
// own ground or build pieces from, pieces of stages (whole buildings) copied
// elsewhere, and writing all of it into the stage's model (map.bmd) and
// ground (map.col) when a level is exported.
//
// A stage's look and its ground are separate files: map.bmd is what's drawn,
// map.col what Mario stands on. Painting a texture changes the first; the
// ground brush changes the second. Built and copied pieces add to both.

const j3d = require('./j3d');
const levelModel = require('./level-model');
const collisionFile = require('./collision');
const sceneBin = require('./scene-bin');
const build = require('./world-build');
const { BmdEdit, POS, NRM, CLR0, TEX0 } = require('./bmd-edit');
const { cmpr, tex1, assemble, sectionOf } = require('./j3d-write');
const { readPng } = require('./texture-image');
const userModels = require('./world-model');

const MAP = 'map/map/map.bmd', COL = 'map/map.col', SEA = 'map/map/sea.bmd';

// Textures to paint and build with: each is a material of a stage's own
// ground, checked by its texture's name so another version of the game only
// loses the entries it doesn't have. `ground` is the footsteps they go with;
// `tile` (world units per repeat) where the stage stretches it over distant
// hills; `match` a material index where texture names repeat.
const PALETTE = [
  // Ground
  { id: 'delfino-sand', label: 'Delfino sand', group: 'ground', scene: 'dolpic0', texture: 'A_suna_sire02m4', ground: 'sand', tile: 1600 },
  { id: 'gelato-sand', label: 'Beach sand', group: 'ground', scene: 'ricco0', texture: 'A_suna_sire', ground: 'sand', tile: 1500 },
  { id: 'noki-sand', label: 'Shell sand', group: 'ground', scene: 'mare0', texture: 'mare_12', ground: 'sand' },
  { id: 'bianco-grass', label: 'Meadow grass', group: 'ground', scene: 'bianco0', texture: 'D_green_bia2', ground: 'grass', tile: 1500 },
  { id: 'gelato-grass', label: 'Lawn', group: 'ground', scene: 'mamma0', texture: 'D_green_man02', ground: 'grass', tile: 1500 },
  { id: 'sirena-grass', label: 'Short grass', group: 'ground', scene: 'sirena0', texture: 'greenMT_UV3', ground: 'grass', tile: 1200 },
  { id: 'delfino-tiles', label: 'Plaza tiles', group: 'ground', scene: 'dolpic0', texture: 'A_yuka_itimatu01', ground: 'stone' },
  { id: 'delfino-bricks', label: 'Brick paving', group: 'ground', scene: 'dolpic0', texture: 'A_yuka_renga', ground: 'stone' },
  { id: 'delfino-waves', label: 'Wave mosaic', group: 'ground', scene: 'dolpic0', texture: 'A_yuka_nami_n3', ground: 'stone' },
  { id: 'delfino-cobbles', label: 'Sandy cobbles', group: 'ground', scene: 'dolpic0', texture: 'A_dpt_ji03m2', ground: 'stone' },
  { id: 'bianco-rocks', label: 'Stone path', group: 'ground', scene: 'bianco0', texture: 'D_RockGround', ground: 'stone' },
  { id: 'bianco-pebbles', label: 'White pebbles', group: 'ground', scene: 'bianco0', texture: 'D_grey', ground: 'stone' },
  { id: 'ricco-cobbles', label: 'Cobblestones', group: 'ground', scene: 'ricco0', texture: 'A_isiita02', ground: 'stone' },
  { id: 'ricco-checker', label: 'Blue checks', group: 'ground', scene: 'ricco0', texture: 'A_heban2', ground: 'stone' },
  { id: 'gelato-bricks', label: 'Brown bricks', group: 'ground', scene: 'mamma0', texture: 'D_brock_ma', match: 2, ground: 'stone' },
  { id: 'pinna-mosaic', label: 'Round mosaic', group: 'ground', scene: 'pinnabeach0', texture: 'L_pina_', match: 13, ground: 'stone' },
  { id: 'pinna-flagstone', label: 'Flagstones', group: 'ground', scene: 'pinnabeach0', texture: 'L_pina_', match: 18, ground: 'stone', tile: 700 },
  { id: 'pinna-white-tiles', label: 'White tiles', group: 'ground', scene: 'pinnabeach0', texture: 'L_pina_', match: 19, ground: 'stone', tile: 500 },
  { id: 'sirena-pool', label: 'Pool tiles', group: 'ground', scene: 'sirena0', texture: 'TailPool', ground: 'stone', tile: 500 },
  { id: 'sirena-rocks', label: 'Rock tiles', group: 'ground', scene: 'sirena0', texture: 'D_rocktail_', ground: 'stone', tile: 500 },
  { id: 'sirena-diamonds', label: 'Diamond bricks', group: 'ground', scene: 'sirena0', texture: 'D_brock_sir', match: 17, ground: 'stone' },
  { id: 'monte-stones', label: 'Blue stones', group: 'ground', scene: 'monte0', texture: 'D_ishidatami', ground: 'stone' },
  { id: 'noki-checker', label: 'Faded checks', group: 'ground', scene: 'mare0', texture: 'mare_25', ground: 'stone' },
  { id: 'gelato-planks', label: 'Pink planks', group: 'ground', scene: 'mamma0', texture: 'D_woody_mam2', ground: 'wood' },
  { id: 'gelato-boards', label: 'Yellow boards', group: 'ground', scene: 'mamma0', texture: 'D_YellowWoody', ground: 'wood' },
  { id: 'pinna-planks', label: 'Boardwalk', group: 'ground', scene: 'pinnabeach0', texture: 'L_pina_', match: 14, ground: 'wood' },
  { id: 'sirena-wood', label: 'Dark wood', group: 'ground', scene: 'sirena0', texture: 'D_Woody_sir', ground: 'wood' },
  // Walls
  { id: 'delfino-white-wall', label: 'Delfino white wall', group: 'wall', scene: 'dolpic0', texture: 'A_white_wall01', ground: 'stone' },
  { id: 'gelato-brick-wall', label: 'Pink brick wall', group: 'wall', scene: 'mamma0', texture: 'D_wall04mam', ground: 'stone' },
  { id: 'pinna-stone-wall', label: 'Yellow stone wall', group: 'wall', scene: 'pinnabeach0', texture: 'L_pina_', match: 0, ground: 'stone', tile: 600 },
  { id: 'pinna-cobble-wall', label: 'White cobble wall', group: 'wall', scene: 'pinnabeach0', texture: 'L_pina_', match: 11, ground: 'stone' },
  { id: 'pinna-brick-wall', label: 'Orange brick wall', group: 'wall', scene: 'pinnabeach0', texture: 'L_pina_', match: 17, ground: 'stone' },
  { id: 'ricco-brick-wall', label: 'Harbor bricks', group: 'wall', scene: 'ricco0', texture: 'A_tank02', ground: 'stone' },
  { id: 'sirena-stucco', label: 'Stucco', group: 'wall', scene: 'sirena0', texture: 'D_WallHotel', ground: 'stone', tile: 900 },
  { id: 'sirena-plaster', label: 'Plaster', group: 'wall', scene: 'sirena0', texture: 'D_WhiteWall', ground: 'stone' },
  { id: 'sirena-stone-wall', label: 'Hotel stone wall', group: 'wall', scene: 'sirena0', texture: 'D_HotelWall', match: 28, ground: 'stone' },
  { id: 'noki-stone-wall', label: 'Old stone wall', group: 'wall', scene: 'mare0', texture: 'mare_01', ground: 'stone', tile: 900 },
  { id: 'monte-blue-boards', label: 'Blue boards', group: 'wall', scene: 'monte0', texture: 'A_ita01_mip', ground: 'wood' },
  // Roofs
  { id: 'gelato-shingles', label: 'Brown shingles', group: 'roof', scene: 'mamma0', texture: 'D_RoofTHouseB', ground: 'stone' },
  { id: 'gelato-thatch', label: 'Thatch', group: 'roof', scene: 'mamma0', texture: 'D_KayaRoofTHouseA', ground: 'grass' },
  { id: 'sirena-roof', label: 'Yellow roof tiles', group: 'roof', scene: 'sirena0', texture: 'D_RoofHotel', ground: 'stone' },
  { id: 'sirena-thatch', label: 'Straw roof', group: 'roof', scene: 'sirena0', texture: 'D_ShopRoof', ground: 'grass' },
  { id: 'bianco-shingles', label: 'Windmill shingles', group: 'roof', scene: 'bianco0', texture: 'D_roofWindmill', ground: 'stone' },
  // Edges: laid once over a side's height or a border's depth, keeping
  // their shape (`fit`, the texture's width to height); `cutout` ones have
  // see-through parts.
  { id: 'grass-fringe', label: 'Grass fringe', group: 'edge', scene: 'pinnabeach0', texture: 'D_pina_kusa01', ground: 'grass', fit: 2, cutout: true },
  { id: 'grassy-sand-bank', label: 'Grassy sand bank', group: 'edge', scene: 'mamma0', texture: 'D_sunagake_man02', ground: 'sand', fit: 1 },
  { id: 'grassy-rock-bank', label: 'Grassy rock bank', group: 'edge', scene: 'mamma0', texture: 'D_kusagake_man', ground: 'stone', fit: 1 },
  { id: 'grassy-cobble-bank', label: 'Grassy cobble bank', group: 'edge', scene: 'pinnabeach0', texture: 'L_pina_yama01', match: 20, ground: 'stone', fit: 1 },
  { id: 'grassy-stone-wall', label: 'Grassy stone wall', group: 'edge', scene: 'dolpic0', texture: 'A_dptwall03', ground: 'grass', fit: 0.25 },
];
const PALETTE_GROUPS = [{ id: 'ground', label: 'Ground' }, { id: 'wall', label: 'Walls' }, { id: 'roof', label: 'Roofs' }, { id: 'edge', label: 'Edges' }];

// Pieces of stages to copy elsewhere: Delfino's buildings, as boxes over the
// plaza (x0, z0, x1, z1). What's inside, above the ground they stand on, is
// the building, with its walls and roofs as the stage draws them.
const PREFABS = [
  { id: 'delfino-bell-tower', label: 'Bell tower hall', scene: 'dolpic0', box: [-3700, -100, 3200, 2100] },
  { id: 'delfino-shine-gate', label: 'Shine Gate', scene: 'dolpic0', box: [-1700, -8050, 1600, -6950] },
  { id: 'delfino-boathouse', label: 'Boathouse row', scene: 'dolpic0', box: [-7100, -4100, -5900, 1800] },
  { id: 'delfino-green-hall', label: 'Green-roofed hall', scene: 'dolpic0', box: [3050, -9050, 7050, -7250] },
  { id: 'delfino-corner-house', label: 'Brick tower', scene: 'dolpic0', box: [5700, -6400, 7150, -5100] },
  { id: 'delfino-west-house', label: 'Brown-roofed house', scene: 'dolpic0', box: [-4050, -7100, -2950, -3950] },
  { id: 'delfino-south-shop', label: 'Plaza shop', scene: 'dolpic0', box: [-5050, -150, -3950, 2550] },
  { id: 'delfino-green-tower', label: 'Green-roofed tower', scene: 'dolpic0', box: [3950, 1550, 5050, 3250] },
  { id: 'delfino-harbor-house', label: 'Harbor tower', scene: 'dolpic0', box: [5950, 4350, 7050, 5650] },
  { id: 'delfino-bell-house', label: 'Spire tower', scene: 'dolpic0', box: [-7100, 4350, -5000, 5650] },
];

// --- Palette ---------------------------------------------------------------------

// The game's GX texgen matrix scale for a material's first coordinates.
function texScale(material) {
  const gen = material.texGens?.[0];
  const m = gen && gen.matrix >= 30 && gen.matrix <= 57 ? material.texMatrices?.[(gen.matrix - 30) / 3] : null;
  return m ? [Math.abs(m.scale[0]) || 1, Math.abs(m.scale[1]) || 1] : [1, 1];
}

// The game's texture matrix for a material's first coordinates, as u' = a·u + b·v + c, v' = d·u + e·v + f
// (J3DGetTextureMtx: scaled and turned about its centre, then moved); null: none.
function texAffine(material) {
  const gen = material.texGens?.[0];
  const m = gen && gen.matrix >= 30 && gen.matrix <= 57 ? material.texMatrices?.[(gen.matrix - 30) / 3] : null;
  if (!m) return null;
  const [sx, sy] = m.scale, [cx, cy] = m.center, cos = Math.cos(m.rotation), sin = Math.sin(m.rotation);
  const a = sx * cos, b = -sx * sin, d = sy * sin, e = sy * cos;
  return [a, b, m.translation[0] + cx - (a * cx + b * cy), d, e, m.translation[1] + cy - (d * cx + e * cy)];
}
// Coordinates that the matrix turns into `uv`: a model's own, laid exactly as it was made.
function untexAffine(material) {
  const m = texAffine(material);
  if (!m) return null;
  const [a, b, c, d, e, f] = m, det = a * e - b * d;
  if (Math.abs(det) < 1e-9) return null;
  return ([u, v]) => [(e * (u - c) - b * (v - f)) / det, (a * (v - f) - d * (u - c)) / det];
}
// A material's texture matrices left out: the coordinates drawn as they are.
const plainTexMatrices = material => (material.texMatrices || []).map(m => m && { ...m, scale: [1, 1], rotation: 0, translation: [0, 0] });

// How a material is laid on a stage: world units per texture repeat, its
// usual vertex colour (the light baked into the stage) and how much it covers.
function materialUsage(model, material) {
  let area = 0, uvArea = 0, floor = 0;
  const color = [0, 0, 0], count = { n: 0 };
  for (const shape of model.shapes) {
    if (shape.material !== material) continue;
    const P = shape.position, U = shape.uv, I = shape.index, C = shape.color;
    for (let t = 0; t < I.length; t += 3) {
      const [a, b, c] = [I[t], I[t + 1], I[t + 2]];
      const e1 = [0, 1, 2].map(k => P[b * 3 + k] - P[a * 3 + k]), e2 = [0, 1, 2].map(k => P[c * 3 + k] - P[a * 3 + k]);
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const A = Math.hypot(...n) / 2;
      area += A;
      if (A && n[1] / (2 * A) > 0.7) floor += A;
      const u1 = [U[b * 2] - U[a * 2], U[b * 2 + 1] - U[a * 2 + 1]], u2 = [U[c * 2] - U[a * 2], U[c * 2 + 1] - U[a * 2 + 1]];
      uvArea += Math.abs(u1[0] * u2[1] - u1[1] * u2[0]) / 2;
    }
    if (shape.hasColor) for (let i = 0; i < C.length; i += 4) { color[0] += C[i]; color[1] += C[i + 1]; color[2] += C[i + 2]; count.n++; }
  }
  const tile = uvArea > 0 ? Math.sqrt(area / uvArea) : 600;
  return {
    area, floor, tile: Math.max(150, Math.min(6000, tile)),
    base: count.n ? color.map(v => Math.round(Math.min(1, v / count.n) * 255)) : [255, 255, 255],
  };
}

// The material a palette entry uses in its stage, or null where this disc lacks it.
function paletteSource(library, entry) {
  let files;
  try { files = library.files(entry.scene); } catch (_) { return null; }
  const data = files.get(MAP);
  if (!data) return null;
  const model = library.parsed(entry.scene, MAP);
  const want = entry.texture.toLowerCase();
  const candidates = [];
  model.materials.forEach((material, index) => {
    const texture = model.textures[material.textures[0]];
    if (!texture) return;
    const name = texture.name.toLowerCase();
    if (entry.match !== undefined ? index === entry.match && name.startsWith(want) : name === want || name.startsWith(want)) candidates.push(index);
  });
  if (!candidates.length) return null;
  // The material that covers the most of the stage with it.
  let best = null;
  for (const index of candidates) {
    const usage = materialUsage(model, index);
    if (!best || usage.area > best.usage.area) best = { index, usage };
  }
  return { model, data, material: best.index, ...best.usage, scale: texScale(model.materials[best.index]) };
}

function thumbnail(texture, size = 48) {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sx = Math.floor(x * texture.width / size), sy = Math.floor(y * texture.height / size), o = (sy * texture.width + sx) * 4, p = (y * size + x) * 4;
    out[p] = texture.rgba[o]; out[p + 1] = texture.rgba[o + 1]; out[p + 2] = texture.rgba[o + 2]; out[p + 3] = 255;
  }
  return { width: size, height: size, rgba: out };
}

// Light for new faces, as vertex colours: the stages' materials multiply
// their texture by it, and Delfino's open ground carries about this much.
const DAYLIGHT = [235, 238, 242];

// The palette as this disc has it.
function palette(library) {
  if (library.paletteCache) return library.paletteCache;
  const list = [];
  for (const entry of PALETTE) {
    const source = paletteSource(library, entry);
    if (!source) continue;
    const texture = source.model.textures[source.model.materials[source.material].textures[0]];
    list.push({ id: entry.id, label: entry.label, group: entry.group, ground: entry.ground, scene: entry.scene, tile: entry.tile || Math.round(source.tile),
      fit: entry.fit || 0, cutout: Boolean(entry.cutout), base: DAYLIGHT, thumb: thumbnail(texture) });
  }
  library.paletteCache = list;
  return list;
}
const paletteEntry = (library, id) => {
  const entry = PALETTE.find(e => e.id === id);
  return entry ? { entry, info: palette(library).find(p => p.id === id) || null } : null;
};

// A one-quad model drawn with a palette material, for the editor to take the
// material from (its colour combiner and textures) for painted and built faces.
function paletteModel(library, id) {
  const found = paletteEntry(library, id);
  if (!found?.info) throw new Error('That texture isn\'t on your disc.');
  const source = paletteSource(library, found.entry);
  const tile = found.info.tile;
  const quad = {
    position: Float32Array.from([0, 0, 0, tile, 0, 0, tile, 0, tile, 0, 0, tile]),
    normal: Float32Array.from([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
    uv: Float32Array.from([0, 0, 1, 0, 1, 1, 0, 1]), uv1: Float32Array.from([0, 0, 1, 0, 1, 1, 0, 1]),
    color: new Float32Array(16).fill(1), drawIndex: new Uint16Array(4), index: Uint32Array.from([0, 2, 1, 0, 3, 2]),
    hasColor: true, hasNormal: true, hasUv: true, hasUv1: false, material: source.material,
  };
  const model = { ...source.model, joints: [{ scale: [1, 1, 1], rotation: [0, 0, 0], translation: [0, 0, 0], parent: -1 }], draw: [{ weighted: false, index: 0 }], envelopes: [], inverseBind: [], shapes: [quad] };
  return levelModel.bake(model);
}

// --- Players' own textures --------------------------------------------------------

// Pictures players bring (PNG or JPEG, turned into a PNG with sides a power of
// two, 8 to 512, as they're imported), kept in the level file itself so it
// travels with it. They paint and build like the stages' own textures; the
// export writes each into the stage's model once, as the game's own
// compressed format (CMPR) with smaller levels for distance.
const USER_ID = /^user-[0-9a-f]{12}$/;
const USER_MAX = 32, USER_SIDE = [8, 512], USER_BYTES = 1.5e6;
const isUserTexture = id => USER_ID.test(String(id));
const powerOfTwo = v => Number.isInteger(v) && v >= USER_SIDE[0] && v <= USER_SIDE[1] && (v & (v - 1)) === 0;
// A PNG's size from its header, without reading the picture.
function pngSize(data) {
  if (data.length < 24 || data.readUInt32BE(0) !== 0x89504e47 || data.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}
function cleanUserTextures(input) {
  const out = [], seen = new Set();
  for (const texture of (Array.isArray(input) ? input : []).slice(0, USER_MAX * 2)) {
    if (!texture || !isUserTexture(texture.id) || seen.has(texture.id) || typeof texture.png !== 'string' || texture.png.length > USER_BYTES * 1.4) continue;
    const size = pngSize(Buffer.from(texture.png.slice(0, 64), 'base64'));
    if (!size || !powerOfTwo(size.width) || !powerOfTwo(size.height)) continue;
    seen.add(texture.id);
    const tile = Number(texture.tile);
    out.push({
      id: texture.id, label: String(texture.label || 'My texture').slice(0, 40),
      group: PALETTE_GROUPS.some(g => g.id === texture.group) ? texture.group : 'ground',
      ground: /^[a-z-]{1,20}$/.test(texture.ground) ? texture.ground : 'stone',
      tile: Number.isFinite(tile) ? Math.max(50, Math.min(6000, Math.round(tile))) : 800,
      cutout: Boolean(texture.cutout), png: texture.png, width: size.width, height: size.height,
    });
    if (out.length >= USER_MAX) break;
  }
  return out;
}
// A player's texture as RGBA, read once.
const userImages = new Map();
function userImage(texture) {
  if (!userImages.has(texture.id)) {
    if (userImages.size > 64) userImages.delete(userImages.keys().next().value);
    const image = readPng(Buffer.from(texture.png, 'base64'));
    if (!powerOfTwo(image.width) || !powerOfTwo(image.height)) throw new Error(`${texture.label}: its sides must be powers of two from 8 to 512.`);
    userImages.set(texture.id, image);
  }
  return userImages.get(texture.id);
}
// How it's listed with the stages' textures. Edges keep their shape (`fit`).
function userEntry(texture) {
  return { id: texture.id, label: texture.label, group: texture.group, ground: texture.ground, scene: null, tile: texture.tile,
    fit: texture.group === 'edge' ? texture.width / texture.height : 0, cutout: texture.cutout, base: DAYLIGHT, user: true };
}

// Half the size, each texel the mean of four (alpha too, so see-through edges
// stay where they are as it shrinks).
function halve({ width, height, rgba }) {
  const w = width >> 1, h = height >> 1, out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
    const at = (dy, dx) => rgba[((y * 2 + dy) * width + x * 2 + dx) * 4 + c];
    out[(y * w + x) * 4 + c] = (at(0, 0) + at(0, 1) + at(1, 0) + at(1, 1) + 2) >> 2;
  }
  return { width: w, height: h, rgba: out };
}
// The texture as the game's own file format (a BTI: a 0x20-byte header, then
// the picture): CMPR at each size down to 8 texels, see-through where its
// alpha is under half. Edges are laid once down their height, so they don't
// repeat that way (clamped).
function userBti(image, { cutout = false, edge = false, wrap = null } = {}) {
  const levels = [image];
  while (levels.length < 7 && levels[levels.length - 1].width >= 16 && levels[levels.length - 1].height >= 16) levels.push(halve(levels[levels.length - 1]));
  const opaque = !cutout;
  const data = Buffer.concat(levels.map(level => {
    if (!opaque) return cmpr(level);
    const solid = { ...level, rgba: Uint8Array.from(level.rgba) };
    for (let i = 3; i < solid.rgba.length; i += 4) solid.rgba[i] = 255;
    return cmpr(solid);
  }));
  const header = Buffer.alloc(0x20);
  header[0x00] = 14;                    // CMPR
  header[0x01] = cutout ? 1 : 0;        // has see-through texels
  header.writeUInt16BE(image.width, 0x02);
  header.writeUInt16BE(image.height, 0x04);
  header[0x06] = wrap ? wrap[0] : 1;    // repeat across (GX: 0 clamp, 1 repeat, 2 mirror)
  header[0x07] = wrap ? wrap[1] : edge ? 0 : 1;  // and down, unless laid once
  header[0x10] = levels.length > 1 ? 1 : 0;
  header[0x14] = levels.length > 1 ? 5 : 1;  // linear between levels, else linear
  header[0x15] = 1;
  header[0x17] = (levels.length - 1) * 8;    // the smallest level (eighths)
  header[0x18] = levels.length;
  header.writeUInt32BE(0x20, 0x1c);
  return Buffer.concat([header, data]);
}

// The level's own textures for the editor's view: the stage's plainest
// material (as the export draws them with) showing the texture.
// `textures` are the level's, as the editor last sent them.
const userTexturesOf = new WeakMap();  // library -> { base, textures: Map(id -> texture) }
function setUserTextures(library, base, list) {
  const textures = cleanUserTextures(list);
  userTexturesOf.set(library, { base, textures: new Map(textures.map(t => [t.id, t])) });
  return textures.map(userEntry);
}
function userPaletteModel(library, id) {
  const known = userTexturesOf.get(library), texture = known?.textures.get(id);
  if (!texture) throw new Error('That texture isn\'t in this level.');
  let model = null, plain = null;
  for (const candidate of [known.base, 'dolpic0', ...library.scenes()]) {
    try { if (!library.files(candidate).get(MAP)) continue; } catch (_) { continue; }
    model = library.parsed(candidate, MAP);
    plain = plainTemplate(model);
    if (plain) break;
  }
  if (!plain) throw new Error('No stage on your disc has a material to show it with.');
  const image = userImage(texture), material = model.materials[plain.index], slot = material.textures[0];
  const textures = model.textures.slice();
  textures[slot] = { ...textures[slot], name: texture.id, width: image.width, height: image.height, rgba: image.rgba,
    wrapS: 1, wrapT: texture.group === 'edge' ? 0 : 1, mipmapped: true };
  // Its own repeat, not the stage material's (the export undoes that scale too).
  const own = { ...material, texMatrices: (material.texMatrices || []).map(m => m && { ...m, scale: [1, 1] }) };
  if (texture.cutout) own.alphaTest = { comp0: 6, ref0: 128, op: 0, comp1: 3, ref1: 255 };
  const materials = model.materials.slice();
  materials[plain.index] = own;
  const tile = texture.tile;
  const quad = {
    position: Float32Array.from([0, 0, 0, tile, 0, 0, tile, 0, tile, 0, 0, tile]),
    normal: Float32Array.from([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
    uv: Float32Array.from([0, 0, 1, 0, 1, 1, 0, 1]), uv1: Float32Array.from([0, 0, 1, 0, 1, 1, 0, 1]),
    color: new Float32Array(16).fill(1), drawIndex: new Uint16Array(4), index: Uint32Array.from([0, 2, 1, 0, 3, 2]),
    hasColor: true, hasNormal: true, hasUv: true, hasUv1: false, material: plain.index,
  };
  return levelModel.bake({ ...model, textures, materials, joints: [{ scale: [1, 1, 1], rotation: [0, 0, 0], translation: [0, 0, 0], parent: -1 }],
    draw: [{ weighted: false, index: 0 }], envelopes: [], inverseBind: [], shapes: [quad] });
}

// --- Retextures ---------------------------------------------------------------------

// A stage's own model textures given another picture: "file|texture name" ->
// { png }, written into the stage archive's copy of that file on export, so
// every NPC or object using it in the level changes.
const RETEXTURE_KEY = /^(?:(?!\.)[a-z0-9_.-]{1,40}\/){1,2}(?!\.)[a-z0-9_.-]{1,80}\.bmd\|[\x21-\x7b\x7d\x7e][\x20-\x7b\x7d\x7e]{0,63}$/i;
function cleanRetextures(input) {
  const out = {};
  let count = 0;
  for (const [key, texture] of Object.entries(input && typeof input === 'object' ? input : {})) {
    if (!RETEXTURE_KEY.test(key) || typeof texture?.png !== 'string' || texture.png.length > USER_BYTES * 1.4) continue;
    const size = pngSize(Buffer.from(texture.png.slice(0, 64), 'base64'));
    if (!size || !powerOfTwo(size.width) || !powerOfTwo(size.height)) continue;
    out[key] = { png: texture.png, width: size.width, height: size.height };
    if (++count >= 128) break;
  }
  return out;
}
const retextureImage = texture => userImage({ id: `re-${require('node:crypto').createHash('sha1').update(texture.png).digest('hex')}`, label: 'A retexture', png: texture.png });

// --- Players' own models ------------------------------------------------------------

// The level's models, as the editor last sent them, to draw (usermodel|… refs).
const userModelsOf = new WeakMap();  // library -> { base, models: Map(id -> model) }
function setUserModels(library, base, list) {
  const models = userModels.cleanUserModels(list);
  userModelsOf.set(library, { base, models: new Map(models.map(m => [m.id, m])) });
  return models.map(m => ({ id: m.id, label: m.label, triangles: m.triangles, size: m.size }));
}
// A stage's model and its plainest material, to draw players' textures and models with.
function plainStage(library, base) {
  for (const candidate of [base, 'dolpic0', ...library.scenes()]) {
    try { if (!library.files(candidate).get(MAP)) continue; } catch (_) { continue; }
    const model = library.parsed(candidate, MAP), plain = plainTemplate(model);
    if (plain) return { model, plain };
  }
  throw new Error('No stage on your disc has a material to show it with.');
}
// The model drawn in the editor: each part with the stage's plain material
// showing the part's texture, lit by the light baked into its vertex colours.
function userModelBaked(library, id) {
  const known = userModelsOf.get(library), stored = known?.models.get(id);
  if (!stored) throw new Error('That model isn\'t in this level.');
  return bakeModel(library, known.base, userModels.decodeModel(stored), id);
}
// A mod's own model for its marker objects (modmodel|…, read by main.js from the mod's folder), drawn as players' are.
function modModel(library, ref, encoded) {
  return library.cached(ref, () => bakeModel(library, userModelsOf.get(library)?.base || 'dolpic0', userModels.decodeModel(encoded), encoded.id));
}
function bakeModel(library, base, model, id) {
  const { model: stageModelData, plain } = plainStage(library, base);
  const template = stageModelData.materials[plain.index];
  const textures = [], materials = [], shapes = [], position = [], codes = [];
  model.parts.forEach((part, i) => {
    textures.push({ name: `${id}-${i}`, width: part.texture.width, height: part.texture.height, rgba: part.texture.rgba, wrapS: part.wrap[0], wrapT: part.wrap[1], mipmapped: true });
    // its own coordinates as they are: the stage material's matrix (often moved or turned) left out
    const material = { ...template, textures: [i, ...template.textures.slice(1).map(() => -1)], texMatrices: plainTexMatrices(template) };
    if (part.cutout) material.alphaTest = { comp0: 6, ref0: 128, op: 0, comp1: 3, ref1: 255 };
    materials.push(material);
    const count = part.position.length / 3, color = new Float32Array(count * 4);
    for (let v = 0; v < count; v++) {
      const light = part.unlit ? [255, 255, 255] : build.shade([part.normal[v * 3], part.normal[v * 3 + 1], part.normal[v * 3 + 2]], DAYLIGHT);
      for (let k = 0; k < 3; k++) color[v * 4 + k] = light[k] / 255 * part.color[v * 4 + k] / 255;
      color[v * 4 + 3] = part.color[v * 4 + 3] / 255;
    }
    // Counter-clockwise, as models come out of the file reader (j3d.js) and as the editor draws them.
    shapes.push({ position: part.position, normal: part.normal, uv: part.uv, uv1: part.uv, color, drawIndex: new Uint16Array(count), index: part.index,
      hasColor: true, hasNormal: true, hasUv: true, hasUv1: false, material: i });
    for (let t = 0; t < part.index.length; t++) for (let k = 0; k < 3; k++) position.push(part.position[part.index[t] * 3 + k]);
    for (let t = 0; t < part.index.length / 3; t++) codes.push(0);
  });
  const baked = levelModel.bake({ ...stageModelData, textures, materials, joints: [{ scale: [1, 1, 1], rotation: [0, 0, 0], translation: [0, 0, 0], parent: -1 }],
    draw: [{ weighted: false, index: 0 }], envelopes: [], inverseBind: [], shapes });
  // Its ground for walking in the editor, at its own size (the editor scales it).
  baked.ground = { position: Float32Array.from(position), codes: Uint32Array.from(codes) };
  return baked;
}

// --- Copied pieces ------------------------------------------------------------------

// A box over a stage (x0, z0, x1, z1): the ground it stands on (the lowest
// floor inside it) and what's above that.
function prefabFrame(library, scene, box) {
  const [x0, z0, x1, z1] = box;
  const col = library.files(scene).get(COL);
  // The ground the piece stands on: the lowest floor height that covers a
  // fair share of the box (not a drain or an underpass below it).
  const levels = new Map();
  if (col) {
    const { position: p } = collisionFile.parse(col);
    for (let t = 0; t < p.length; t += 9) {
      const cx = (p[t] + p[t + 3] + p[t + 6]) / 3, cz = (p[t + 2] + p[t + 5] + p[t + 8]) / 3;
      if (cx < x0 || cx > x1 || cz < z0 || cz > z1) continue;
      const e1 = [p[t + 3] - p[t], p[t + 4] - p[t + 1], p[t + 5] - p[t + 2]], e2 = [p[t + 6] - p[t], p[t + 7] - p[t + 1], p[t + 8] - p[t + 2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const length = Math.hypot(...n) || 1;
      if (n[1] / length < 0.7) continue;
      const level = Math.round((p[t + 1] + p[t + 4] + p[t + 7]) / 3 / 25) * 25;
      levels.set(level, (levels.get(level) || 0) + length / 2);
    }
  }
  const footprint = (x1 - x0) * (z1 - z0), sorted = [...levels].sort((a, b) => a[0] - b[0]);
  const floor = (sorted.find(([, area]) => area >= footprint * 0.06) || sorted[0] || [0])[0];
  // What's copied stands where it starts: a hall over an underpass sits on
  // the ground it stands on, not on the passage below it.
  const cut = floor + 15;
  let lowest = Infinity;
  for (const mesh of library.model(`${scene}|${MAP}`).meshes) {
    if (!copiedLayer(mesh)) continue;
    const P = mesh.position;
    for (const f of facesInBox(mesh, box, cut)) for (let k = 0; k < 3; k++) lowest = Math.min(lowest, P[mesh.index[f * 3 + k] * 3 + 1]);
  }
  const base = Number.isFinite(lowest) ? Math.max(floor, lowest) : floor;
  // Its ground likewise, without the floors below it.
  return { anchor: [(x0 + x1) / 2, base, (z0 + z1) / 2], cut, groundCut: Math.max(cut, base - 30) };
}
const inBox = (box, cut, x, y, z) => x >= box[0] && x <= box[2] && z >= box[1] && z <= box[3] && y > cut;

// Built-in pieces with their size, for the catalog.
function prefabs(library) {
  return PREFABS.filter(p => library.scenes().includes(p.scene)).map(p => ({ id: p.id, label: p.label, scene: p.scene, box: p.box, ref: prefabRef(p.scene, p.box) }));
}
const prefabRef = (scene, box) => `prefab|${scene}|${box.map(v => Math.round(v)).join(',')}`;
function parsePrefabRef(ref) {
  const [kind, scene, box] = String(ref).split('|');
  const values = String(box || '').split(',').map(Number);
  if (kind !== 'prefab' || values.length !== 4 || !values.every(Number.isFinite) || values[2] <= values[0] || values[3] <= values[1]) return null;
  if ((values[2] - values[0]) * (values[3] - values[1]) > 4e8) return null;
  return { scene, box: values };
}

// The faces of a stage inside a box, as a baked model standing on its anchor.
function prefabModel(library, ref) {
  const parsed = parsePrefabRef(ref);
  if (!parsed || !library.scenes().includes(parsed.scene)) throw new Error('That piece isn\'t on your disc.');
  const { scene, box } = parsed;
  const stage = library.model(`${scene}|${MAP}`);
  const { anchor, cut, groundCut } = prefabFrame(library, scene, box);
  const meshes = [];
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of stage.meshes) {
    if (!copiedLayer(mesh)) continue;
    const faces = facesInBox(mesh, box, cut);
    if (!faces.length) continue;
    const out = subMesh(mesh, faces, anchor);
    for (let i = 0; i < out.position.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], out.position[i + k]); max[k] = Math.max(max[k], out.position[i + k]); }
    meshes.push(out);
  }
  const ground = prefabGround(library, scene, box, anchor, groundCut);
  if (!meshes.length) return { meshes, textures: stage.textures, bounds: { min: [0, 0, 0], max: [0, 0, 0] }, ground };
  return { meshes, textures: stage.textures, bounds: { min, max }, ground };
}
// The piece's ground (collision) triangles, standing on its anchor.
function prefabGround(library, scene, box, anchor, cut) {
  const col = library.files(scene).get(COL), position = [], codes = [];
  if (col) {
    const { position: p, codes: all } = collisionFile.parse(col);
    for (let t = 0; t < p.length; t += 9) {
      if (!inBox(box, cut, (p[t] + p[t + 3] + p[t + 6]) / 3, (p[t + 1] + p[t + 4] + p[t + 7]) / 3, (p[t + 2] + p[t + 5] + p[t + 8]) / 3)) continue;
      for (let k = 0; k < 9; k++) position.push(p[t + k] - anchor[k % 3]);
      codes.push(all[t / 9]);
    }
  }
  return { position: Float32Array.from(position), codes: Uint32Array.from(codes) };
}
// What a copied piece takes from its stage: not shadows and decals, which
// belong to the ground they lay on, nor untextured filler (the dark backs of
// walls no camera sees).
const copiedLayer = mesh => !mesh.translucent && mesh.tev?.stages.some(stage => stage.texMap >= 0);
function facesInBox(mesh, box, cut) {
  const P = mesh.position, I = mesh.index, faces = [];
  for (let f = 0; f < I.length / 3; f++) {
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 3; k++) { const v = I[f * 3 + k]; x += P[v * 3]; y += P[v * 3 + 1]; z += P[v * 3 + 2]; }
    if (inBox(box, cut, x / 3, y / 3, z / 3)) faces.push(f);
  }
  return faces;
}
// Some faces of a baked mesh as their own mesh, moved by -offset.
function subMesh(mesh, faces, offset = [0, 0, 0]) {
  const n = faces.length * 3;
  const out = {
    position: new Float32Array(n * 3), normal: new Float32Array(n * 3), uv: new Float32Array(n * 2), uv1: new Float32Array(n * 2),
    color: mesh.color ? new Float32Array(n * 4) : null, index: new Uint32Array(n),
    translucent: mesh.translucent, blendSrc: mesh.blendSrc, blendDst: mesh.blendDst, doubleSided: mesh.doubleSided, tev: mesh.tev, material: mesh.material,
  };
  faces.forEach((f, i) => {
    for (let k = 0; k < 3; k++) {
      const v = mesh.index[f * 3 + k], o = i * 3 + k;
      for (let c = 0; c < 3; c++) { out.position[o * 3 + c] = mesh.position[v * 3 + c] - offset[c]; out.normal[o * 3 + c] = mesh.normal[v * 3 + c]; }
      for (let c = 0; c < 2; c++) { out.uv[o * 2 + c] = mesh.uv[v * 2 + c]; out.uv1[o * 2 + c] = mesh.uv1[v * 2 + c]; }
      if (out.color) for (let c = 0; c < 4; c++) out.color[o * 4 + c] = mesh.color[v * 4 + c];
      out.index[o] = o;
    }
  });
  return out;
}

// Models the editor asks for by these refs: palette materials and copied pieces.
function stageModel(library, ref) {
  if (isUserTexture(String(ref).slice('palette|'.length)) && String(ref).startsWith('palette|')) {
    // Kept by its contents (the id is their hash) and the settings it's drawn with.
    const id = String(ref).slice('palette|'.length), texture = userTexturesOf.get(library)?.textures.get(id);
    return library.cached(`${ref}|${texture?.cutout ? 1 : 0}|${texture?.group}`, () => userPaletteModel(library, id));
  }
  if (String(ref).startsWith('usermodel|')) {
    const id = String(ref).slice('usermodel|'.length);
    if (!userModels.isUserModel(id)) return null;
    return library.cached(ref, () => userModelBaked(library, id));
  }
  if (String(ref).startsWith('palette|')) return library.cached(ref, () => paletteModel(library, String(ref).slice('palette|'.length)));
  if (String(ref).startsWith('prefab|')) return library.cached(ref, () => prefabModel(library, ref));
  return null;
}

// --- Writing the stage ----------------------------------------------------------------

// The shape of textures laid once over a side or border (build.faces).
const fitOf = (id, project) => PALETTE.find(entry => entry.id === id)?.fit
  || (project?.textures || []).map(userEntry).find(entry => entry.id === id)?.fit || 0;

// Pieces and paint as a project holds them, checked.
const ID = /^[a-z0-9-]{1,40}$/;
const finite = (v, limit = 1e6) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < limit;
function cleanStage(input, scenes) {
  const texturePaint = {};
  let count = 0;
  for (const [key, id] of Object.entries(input?.texturePaint || {})) {
    if (!/^\d{1,4}:\d{1,7}$/.test(key) || !ID.test(String(id)) || ++count > 400000) continue;
    texturePaint[key] = String(id);
  }
  const models = userModels.cleanUserModels(input?.models);
  const pieces = (Array.isArray(input?.pieces) ? input.pieces : []).slice(0, 4000).flatMap(piece => {
    if (!piece || !Array.isArray(piece.position) || piece.position.length !== 3 || !piece.position.every(v => finite(v))) return [];
    const uid = String(piece.uid || '').slice(0, 80), yaw = finite(piece.yaw, 1e4) ? piece.yaw : 0;
    const label = String(piece.label || '').slice(0, 80);
    if (piece.kind === 'prefab') {
      const parsed = parsePrefabRef(piece.ref);
      if (!parsed || !scenes.includes(parsed.scene)) return [];
      return [{ uid, kind: 'prefab', ref: prefabRef(parsed.scene, parsed.box), label, position: [...piece.position], yaw }];
    }
    if (piece.kind === 'model') {
      if (!userModels.isUserModel(piece.ref) || !models.some(m => m.id === piece.ref)) return [];
      const scale = finite(piece.scale, 1e3) && piece.scale > 0 ? Math.max(0.05, Math.min(50, piece.scale)) : 1;
      // hidden: only felt, never drawn (a solid model's collision alone: steps under a roof, a floor under ground
      // drawn without one)
      return [{ uid, kind: 'model', ref: piece.ref, label, position: [...piece.position], yaw, scale, solid: piece.solid !== false, ground: typeof piece.ground === 'string' && ID.test(piece.ground) ? piece.ground : 'stone',
        ...piece.hidden === true && piece.solid !== false ? { hidden: true } : {} }];
    }
    if (!build.KIND[piece.kind]) return [];
    const textures = { top: ID.test(piece.textures?.top) ? piece.textures.top : 'delfino-tiles', side: ID.test(piece.textures?.side) ? piece.textures.side : 'delfino-white-wall' };
    return [{ uid, kind: piece.kind, label, position: [...piece.position], yaw, size: build.cleanSize(piece.kind, piece.size), textures, ground: ID.test(piece.ground) ? piece.ground : null }];
  });
  // Hanging wires Mario can grab: two ends each, in game units
  const wires = (Array.isArray(input?.wires) ? input.wires : []).slice(0, MAX_WIRES).flatMap(wire => {
    const ok = v => Array.isArray(v) && v.length === 3 && v.every(x => finite(x));
    if (!wire || !ok(wire.a) || !ok(wire.b) || Math.hypot(wire.b[0] - wire.a[0], wire.b[2] - wire.a[2]) < 150) return [];
    return [{ uid: String(wire.uid || '').slice(0, 80), a: [...wire.a], b: [...wire.b] }];
  });
  const sun = SUN_TIMES[input?.sun] ? input.sun : '';
  // Files of the level's own for the stage's archive (a character's model, a parameter file): a
  // folder and file name in lower case, not the files the editor makes itself
  const files = {};
  let total = 0;
  for (const [file, data] of Object.entries(input?.files && typeof input.files === 'object' ? input.files : {}).slice(0, OWN_FILES_MAX)) {
    if (!/^[a-z0-9_]+(\/[a-z0-9_.-]+)+$/.test(file) || file.includes('..') || EDITOR_FILES.has(file) || typeof data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) continue;
    total += data.length * 3 / 4;
    if (total > OWN_FILES_BYTES) break;
    files[file] = data;
  }
  // What the stage's characters say: every message of its message file, in turn (each line up to 3 rows)
  const messages = (Array.isArray(input?.messages) ? input.messages : []).slice(0, 64)
    .map(text => String(text ?? '').replace(/\r/g, '').replace(/[^\x20-\x7e\n]/g, '').slice(0, 300)).filter(text => text.trim());
  return { texturePaint, pieces, blank: Boolean(input?.blank || input?.plain), plain: Boolean(input?.plain), textures: cleanUserTextures(input?.textures), models, retextures: cleanRetextures(input?.retextures), wires, sun, messages, files };
}
// A level's own files for the stage's archive: up to 32, 16 MB in all; never the ones the editor writes.
const OWN_FILES_MAX = 32, OWN_FILES_BYTES = 16 * 1024 * 1024;
const EDITOR_FILES = new Set(['map/scene.bin', 'map/map.col', 'map/map/map.bmd', 'map/map/sea.bmd', 'map/tables.bin', 'map/message.bmg']);
// The stage's MapWireManager makes room for 200 wires (bianco0 and the others alike).
const MAX_WIRES = 200;
// Where the sun stands, as the light's direction toward it: [toward +X, up, toward +Z] (any length).
const SUN_TIMES = {
  morning: { label: 'Morning', direction: [0.75, 0.42, 0.5] },
  noon: { label: 'Noon', direction: [0.25, 1, 0.2] },
  afternoon: { label: 'Afternoon (3 pm)', direction: [-0.68, 0.52, 0.5] },
  evening: { label: 'Evening', direction: [-0.85, 0.22, 0.45] },
};
const hasStageEdits = project => project.blank || Object.keys(project.texturePaint || {}).length > 0 || (project.pieces || []).length > 0;

// --- Models in files of their own ------------------------------------------------------

// A stage model holds at most 65,536 of each kind of corner (16-bit indexes), and so does
// its ground. Big models go into model files of their own instead, each with its own
// limits, shown by the game's TMapStaticObj (Map/MapStaticObject.cpp): it loads
// /scene/map/map/<name>.bmd for these names of its table, ones no stage of the game uses
// beyond its own and with nothing special done for them. One model a name, placed as many
// times as wanted. Their ground stays in the stage's: an object's own ground of 350 corners
// or more is used where its file has it, not where the object stands
// (TMapCollisionStatic::setUp), so the names whose table entry loads <name>.col (`ground`)
// get one small triangle far below everything, for the game to find a file.
const SEPARATE_SLOTS = [
  { name: 'mareSeaPollutionS0', ground: true },
  { name: 'mareSeaPollutionS12', ground: true },
  { name: 'MonteRiver', ground: true },
  { name: 'BiancoRiver', ground: false },
  { name: 'Mare5ExGate', ground: false },
];
const SEPARATE_MAX = SEPARATE_SLOTS.length;
// The names the stage itself uses (its scene's MapStaticObj objects; Noki Bay's episode 6 makes its
// Mare5ExGate itself), left to it.
function freeSlots(library, base) {
  const used = new Set();
  sceneBin.walk(library.sceneTree(base), node => {
    if (node.type !== 'MapStaticObj' || node.children) return;
    const names = staticObjName(node.data);
    if (names) used.add(names);
  });
  if (/^mare/.test(base)) used.add('Mare5ExGate');
  return SEPARATE_SLOTS.filter(slot => !used.has(slot.name));
}
// A MapStaticObj's table name: its last string (after TActor's name and light map).
function staticObjName(data) {
  let at = 36;
  const skip = () => { if (at + 2 > data.length) return null; const n = data.readUInt16BE(at), text = data.toString('latin1', at + 2, at + 2 + n); at += 2 + n; return text; };
  if (skip() === null || at + 4 > data.length) return null;
  const lights = data.readInt32BE(at); at += 4;
  for (let i = 0; i < lights && i < 64; i++) { at += 4; if (skip() === null) return null; }
  return skip();
}
// The level's models in files of their own: [{ model, slot, pieces }]; models past the free
// names go into the stage model as usual.
function separateModels(library, project) {
  const wanted = (project.models || []).filter(m => m.separate && (project.pieces || []).some(p => p.kind === 'model' && p.ref === m.id && !p.hidden));
  if (!wanted.length) return [];
  const free = freeSlots(library, project.base), out = [];
  for (const model of wanted) {
    if (!free.length) break;
    out.push({ model, slot: free.shift(), pieces: project.pieces.filter(p => p.kind === 'model' && p.ref === model.id && !p.hidden) });
  }
  return out;
}
const separateIds = (library, project) => new Set(separateModels(library, project).map(s => s.model.id));

// The stage's model with painted ground, built pieces and copied pieces in it. `only`: a model in a
// file of its own instead (separateModels): the stage's materials, its shapes emptied, only that model,
// unplaced. `stats`: filled with the vertex arrays' use.
function buildMap(library, project, { only = null, stats = null } = {}) {
  if (!hasStageEdits(project) && !only) return null;
  const base = project.base, data = library.files(base).get(MAP);
  if (!data) throw new Error('This stage has no model to build into.');
  const edit = new BmdEdit(data);
  const model = library.parsed(base, MAP);
  const draw = levelModel.restPose(model);
  const baked = library.model(`${base}|${MAP}`);
  const plain = plainTemplate(model);
  const textures = new Map();  // palette id or "scene:texture" -> texture index here

  // Where new geometry goes: under the joint holding the most of the stage,
  // drawn with that shape's matrix (positions are in its space).
  const host = model.shapes.reduce((best, shape, i) => shape.index.length > (model.shapes[best]?.index.length || 0) ? i : best, 0);
  const hostShape = edit.shapes[host], hostMatrices = hostShape.packets[0].matrices;
  const toHost = invert(draw[hostMatrices[0]] || identity());

  // The material for a new shape painted or built with a palette texture,
  // and the factor from the editor's coordinates to that material's.
  const materialFor = paletteId => {
    if (isUserTexture(paletteId)) {
      const texture = (project.textures || []).find(t => t.id === paletteId);
      if (!texture || plain === null) return null;
      if (!textures.has(paletteId)) textures.set(paletteId, edit.addTexture(userBti(userImage(texture), { cutout: texture.cutout, edge: texture.group === 'edge' }), 0, texture.id));
      const scale = texScale(model.materials[plain.index]);
      return { material: edit.cloneMaterial(plain.index, { texture: textures.get(paletteId), cutout: texture.cutout }), factor: [1 / scale[0], 1 / scale[1]], base: DAYLIGHT, tile: texture.tile };
    }
    const found = paletteEntry(library, paletteId);
    const source = found?.info && paletteSource(library, found.entry);
    if (!source) return null;
    if (source.data.equals(data)) return { material: edit.cloneMaterial(source.material), factor: [1, 1], base: DAYLIGHT, tile: found.info.tile };
    if (plain === null) return null;
    if (!textures.has(paletteId)) {
      const from = new BmdEdit(source.data), slot = from.materialTexture(source.material);
      textures.set(paletteId, importTexture(edit, from, slot, `${found.entry.id}`));
    }
    const scale = texScale(model.materials[plain.index]);
    return { material: edit.cloneMaterial(plain.index, { texture: textures.get(paletteId), cutout: Boolean(found.entry.cutout) }), factor: [source.scale[0] / scale[0], source.scale[1] / scale[1]], base: DAYLIGHT, tile: found.info.tile };
  };

  const attrsOf = list => [...list].sort((a, b) => a.attr - b.attr);
  const newAttrs = () => attrsOf([{ attr: POS, type: 3 }, ...(edit.hasArray(NRM) ? [{ attr: NRM, type: 3 }] : []), ...(edit.hasArray(CLR0) ? [{ attr: CLR0, type: 3 }] : []), { attr: TEX0, type: 3 }]);
  const bounds = points => {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const p of points) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
    return { min, max };
  };

  // 1. The stage's own faces: all gone on an empty stage, else repainted ones moved to new shapes.
  if (project.blank || only) for (let s = 0; s < edit.shapes.length; s++) edit.removeTriangles(s, edit.shapeTriangles(s).map((_, i) => i));
  else {
    const byShape = new Map();  // shape -> Map(paletteId -> [{ local, face, mesh }])
    for (const [key, paletteId] of Object.entries(project.texturePaint || {})) {
      const [materialIndex, face] = key.split(':').map(Number);
      const mesh = baked.meshes.find(m => m.material === materialIndex);
      if (!mesh || face * 3 >= mesh.index.length) continue;
      let at = face, source = null;
      for (const [shape, count] of mesh.sources) { if (at < count) { source = shape; break; } at -= count; }
      if (source === null) continue;
      if (!byShape.has(source)) byShape.set(source, new Map());
      const groups = byShape.get(source);
      if (!groups.has(paletteId)) groups.set(paletteId, []);
      groups.get(paletteId).push({ local: at, face, mesh });
    }
    for (const [shape, groups] of byShape) {
      const all = edit.shapeTriangles(shape);
      const source = edit.shapes[shape];
      edit.removeTriangles(shape, [...groups.values()].flat().map(g => g.local));
      for (const [paletteId, list] of groups) {
        const look = materialFor(paletteId);
        if (!look) continue;
        const attrs = attrsOf([...source.attrs.filter(a => a.attr !== TEX0).map(a => a.attr === 0 ? a : { ...a, type: a.type === 1 ? 1 : 3 }), { attr: TEX0, type: 3 }]);
        const packets = new Map(), points = [];
        for (const { local, face, mesh } of list) {
          const { packet, tri } = all[local];
          // Baked faces list a triangle's corners as (a, c, b).
          const corner = [0, 2, 1].map(k => mesh.index[face * 3 + k]);
          const record = tri.map((vertex, k) => {
            const v = corner[k], p = [mesh.position[v * 3], mesh.position[v * 3 + 1], mesh.position[v * 3 + 2]];
            points.push(p);
            const uv = build.planarUv(p, faceNormal(mesh, face), look.tile);
            return { ...vertex, [TEX0]: edit.addVertex(TEX0, [uv[0] * look.factor[0], uv[1] * look.factor[1]]) };
          });
          if (!packets.has(packet)) packets.set(packet, []);
          packets.get(packet).push(record);
        }
        edit.addShape({ attrs, packets: [...packets].map(([p, triangles]) => ({ matrices: source.packets[p].matrices, triangles })), joint: source.joint, material: look.material, bounds: bounds(points) });
      }
    }
  }

  // 2. Built pieces, a shape per texture each.
  const addFaces = (faces, look, colorOf) => {
    const triangles = [], points = [];
    for (const face of faces) {
      const records = face.p.map((world, k) => {
        const local = transform(toHost, world), n = rotate(toHost, face.normals ? face.normals[k] : face.n);
        points.push(local);
        const uv = face.uv ? face.uv[k] : build.planarUv(world, face.n, look.tile);
        const record = { [POS]: edit.addVertex(POS, local), [TEX0]: edit.addVertex(TEX0, look.uv ? look.uv(uv) : [uv[0] * look.factor[0], uv[1] * look.factor[1]]) };
        if (edit.hasArray(NRM)) record[NRM] = edit.addVertex(NRM, n);
        if (edit.hasArray(CLR0)) record[CLR0] = edit.addVertex(CLR0, colorOf(face, k));
        return record;
      });
      // Counter-clockwise corners (a, b, c) are drawn by the game as (a, c, b).
      triangles.push([records[0], records[2], records[1]]);
    }
    if (!triangles.length) return;
    edit.addShape({ attrs: newAttrs(), packets: [{ matrices: hostMatrices, triangles }], joint: hostShape.joint, material: look.material, bounds: bounds(points) });
  };
  if (only) {
    // its corners as floats: a model's own size can be past 16-bit fixed point's
    edit.clearVertices([POS, TEX0]);
    addUserModel(edit, { kind: 'model', ref: only, position: [0, 0, 0], yaw: 0, scale: 1 }, project, { plain, model, addFaces, textures });
    if (stats) Object.assign(stats, edit.usage());
    return smallStageTextures(edit.write(), edit);
  }
  const apart = separateIds(library, project);
  for (const piece of project.pieces || []) {
    if (piece.kind === 'model' && apart.has(piece.ref)) continue;  // in a file of its own
    if (piece.kind === 'prefab') { addPrefab(library, edit, piece, { data, materialFor: null, plain, model, addFaces, textures, toHost, hostMatrices, hostShape, bounds }); continue; }
    if (piece.kind === 'model') { if (!piece.hidden) addUserModel(edit, piece, project, { plain, model, addFaces, textures }); continue; }
    const groups = new Map();
    for (const face of build.faces(piece, id => fitOf(id, project))) {
      if (!groups.has(face.texture)) groups.set(face.texture, []);
      groups.get(face.texture).push(face);
    }
    for (const [paletteId, faces] of groups) {
      const look = materialFor(paletteId);
      if (look) addFaces(faces, look, face => build.shade(face.n, look.base));
    }
  }
  if (stats) Object.assign(stats, edit.usage());
  return edit.write();
}

// A model file of the stage's materials with only added shapes: the stage's own textures, which
// nothing draws in it any more, made 8 × 8 so the game doesn't load them a second time.
function smallStageTextures(data, edit) {
  const tiny = { format: 14, width: 8, height: 8, rgba: new Uint8Array(8 * 8 * 4).fill(128) };
  const replacements = {};
  for (let i = 0; i < edit.textureCount; i++) replacements[edit.textureNames[i]] = tiny;
  const added = new Set(edit.addedTextures.map(t => t.name));
  for (const name of added) delete replacements[name];
  return assemble(data, { TEX1: tex1(sectionOf(data, 'TEX1'), replacements) });
}

// The level's models in files of their own: for each, its model file, its ground (unplaced; the game
// sets it where each copy stands) and the scene objects that show it.
// Models in files of their own whose ground goes in their own name's ground file too, not the stage's: a
// solid model with one copy, in a name that has a ground file (SEPARATE_SLOTS). The game reads each ground
// file's corners as signed 16-bit (TMapCollisionBase::setCheckData), so the stage's file holds at most 32,767;
// each of these is a file of its own with its own 32,767, and a big level's ground fits split across them.
// The game puts a MapStaticObj's ground into the stage's grid as fixed ground (TMapCollisionStatic, kind 0 in
// initAllCheckData), moved to where the object stands only when it has under 350 corners (setUp: from 350 it
// takes them as they are), so a big one is written where the copy stands and a small one unplaced.
// model id -> its one copy
function groundApart(library, project) {
  const out = new Map();
  for (const { model, slot, pieces } of separateModels(library, project))
    if (slot.ground && pieces.length === 1 && pieces[0].solid) out.set(model.id, pieces[0]);
  return out;
}
const STATIC_PLACED_UNDER = 350;
function buildSeparate(library, project, SURFACES) {
  const out = [];
  const codeOf = id => { const s = SURFACES.find(x => x.id === id) || SURFACES[0]; return s.type * 256 + s.sound; };
  const apart = groundApart(library, project);
  for (const { model, slot, pieces } of separateModels(library, project)) {
    const stats = {};
    const bmd = buildMap(library, project, { only: model.id, stats });
    let col = null, groundCorners = 0;
    if (apart.has(model.id)) {
      const piece = apart.get(model.id), stored = (project.models || []).find(m => m.id === model.id);
      const faces = where => {
        const add = [];
        for (const part of userModels.decodeModel(stored).parts)
          for (const face of userModelFaces(part, where)) add.push({ p: face.p, code: build.isFloor(face.n) ? codeOf(piece.ground) : codeOf('stone') });
        return add;
      };
      const placedAdd = faces(piece);
      col = collisionFile.compose(null, { add: placedAdd });
      const pos = collisionFile.parse(col).position, seen = new Set();
      for (let k = 0; k < pos.length; k += 3) seen.add(`${pos[k]},${pos[k + 1]},${pos[k + 2]}`);
      groundCorners = seen.size;
      if (groundCorners < STATIC_PLACED_UNDER) col = collisionFile.compose(null, { add: faces({ ...piece, position: [0, 0, 0], yaw: 0, scale: 1 }) });
    } else if (slot.ground) {
      // the file the game looks for: one small floor far below everything, set where each copy stands
      col = collisionFile.compose(null, { add: [{ p: [[0, -200000, 0], [0, -200000, 50], [50, -200000, 0]], code: codeOf('stone') }] });
    }
    out.push({ model, slot, pieces, bmd, col, stats, groundCorners, groundApart: apart.has(model.id) });
  }
  return out;
}
// Each copy's ground of its own where it stands, as the game sets it (for the ground's pools): the
// small floor far below, one triangle a copy.
function separateGround(separate) {
  const out = [];
  for (const { col, pieces } of separate) if (col) for (let i = 0; i < pieces.length; i++) out.push(col);
  return out;
}

// A copied piece: same-stage pieces keep their own materials; pieces from
// another stage take its textures, drawn with this stage's plain material.
function addPrefab(library, edit, piece, context) {
  const parsed = parsePrefabRef(piece.ref);
  if (!parsed) return;
  const { scene, box } = parsed;
  const sourceData = library.files(scene).get(MAP);
  if (!sourceData) return;
  const stage = library.model(`${scene}|${MAP}`);
  const { anchor, cut } = prefabFrame(library, scene, box);
  const yaw = (piece.yaw || 0) * Math.PI / 180, c = Math.cos(yaw), s = Math.sin(yaw);
  const place = p => { const x = p[0] - anchor[0], y = p[1] - anchor[1], z = p[2] - anchor[2]; return [piece.position[0] + x * c + z * s, piece.position[1] + y, piece.position[2] - x * s + z * c]; };
  const turn = n => [n[0] * c + n[2] * s, n[1], -n[0] * s + n[2] * c];
  const same = sourceData.equals(context.data);
  const from = same ? null : new BmdEdit(sourceData);
  const sourceModel = library.parsed(scene, MAP);
  for (const mesh of stage.meshes) {
    if (!copiedLayer(mesh)) continue;
    const faces = facesInBox(mesh, box, cut);
    if (!faces.length || mesh.material === undefined) continue;
    let look;
    if (same) look = { material: edit.cloneMaterial(mesh.material), factor: [1, 1] };
    else {
      const slot = from.materialTexture(mesh.material);
      if (slot < 0 || context.plain === null) continue;
      const key = `${scene}:${slot}`;
      if (!context.textures.has(key)) context.textures.set(key, importTexture(edit, from, slot, `${scene}_${from.textureName(slot)}`.slice(0, 60)));
      const scale = texScale(context.model.materials[context.plain.index]), own = texScale(sourceModel.materials[mesh.material]);
      look = { material: edit.cloneMaterial(context.plain.index, { texture: context.textures.get(key) }), factor: [own[0] / scale[0], own[1] / scale[1]] };
    }
    const list = faces.map(f => {
      const corners = [0, 1, 2].map(k => mesh.index[f * 3 + k]);
      return {
        p: corners.map(v => place([mesh.position[v * 3], mesh.position[v * 3 + 1], mesh.position[v * 3 + 2]])),
        n: turn(faceNormal(mesh, f)),
        uv: corners.map(v => [mesh.uv[v * 2], mesh.uv[v * 2 + 1]]),
        color: corners.map(v => mesh.color ? [0, 1, 2, 3].map(k => mesh.color[v * 4 + k] * 255) : [255, 255, 255, 255]),
      };
    });
    context.addFaces(list, look, (face, k) => face.color[k]);
  }
}

// A player's model where it's placed: each part a shape with the stage's
// plain material showing its texture, lit as built pieces are (times the
// model's own vertex colours).
function placeUserModel(piece) {
  const yaw = (piece.yaw || 0) * Math.PI / 180, c = Math.cos(yaw), s = Math.sin(yaw), k = piece.scale || 1;
  return {
    place: ([x, y, z]) => [piece.position[0] + (x * c + z * s) * k, piece.position[1] + y * k, piece.position[2] + (-x * s + z * c) * k],
    turn: ([x, y, z]) => [x * c + z * s, y, -x * s + z * c],
  };
}
function userModelFaces(part, piece) {
  const { place, turn } = placeUserModel(piece), P = part.position, N = part.normal, U = part.uv, C = part.color, faces = [];
  for (let t = 0; t < part.index.length; t += 3) {
    const corners = [0, 1, 2].map(j => part.index[t + j]);
    const p = corners.map(v => place([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]));
    const e1 = [0, 1, 2].map(j => p[1][j] - p[0][j]), e2 = [0, 1, 2].map(j => p[2][j] - p[0][j]);
    if (Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) < 1e-3) continue;  // no area
    faces.push({ p, n: faceNormal({ position: Float32Array.from(p.flat()), index: [0, 1, 2] }, 0), corners, normals: corners.map(v => turn([N[v * 3], N[v * 3 + 1], N[v * 3 + 2]])),
      uv: corners.map(v => [U[v * 2], U[v * 2 + 1]]), color: corners.map(v => [C[v * 4], C[v * 4 + 1], C[v * 4 + 2], C[v * 4 + 3]]) });
  }
  return faces;
}
function addUserModel(edit, piece, project, { plain, model, addFaces, textures }) {
  const stored = (project.models || []).find(m => m.id === piece.ref);
  if (!stored || plain === null) return;
  // its coordinates through the inverse of the stage material's matrix, so the game lays them as made
  const decoded = userModels.decodeModel(stored), scale = texScale(model.materials[plain.index]), uv = untexAffine(model.materials[plain.index]);
  decoded.parts.forEach((part, i) => {
    const key = `${stored.id}:${i}`;
    if (!textures.has(key)) textures.set(key, edit.addTexture(userBti(part.texture, { cutout: part.cutout, wrap: part.wrap }), 0, `${stored.id}-${i}`));
    const look = { material: edit.cloneMaterial(plain.index, { texture: textures.get(key), cutout: part.cutout }), factor: [1 / scale[0], 1 / scale[1]], uv };
    addFaces(userModelFaces(part, piece), look, (face, k) => {
      if (part.unlit) return face.color[k].slice(0, 4);  // its light is in its texture already
      const light = build.shade(face.normals[k], DAYLIGHT);
      return [0, 1, 2].map(c => light[c] * face.color[k][c] / 255).concat(face.color[k][3]);
    });
  });
}

// An emptied stage's sea: just the open water, without the canals,
// waterfalls and shore foam that went with the stage's land.
function buildSea(library, project) {
  const data = project.blank && library.files(project.base).get(SEA);
  if (!data) return null;
  const edit = new BmdEdit(data), baked = library.model(`${project.base}|${SEA}`);
  const open = openSea(baked);
  // a plain level keeps none of it
  const keep = new Set(project.plain ? [] : baked.meshes[open]?.sources?.map(([shape]) => shape) || []);
  for (let s = 0; s < edit.shapes.length; s++) if (!keep.has(s)) edit.removeTriangles(s, edit.shapeTriangles(s).map((_, i) => i));
  return edit.write();
}
// The sea model's mesh that spreads furthest: the open water.
function openSea(baked) {
  let best = -1, area = -1;
  baked.meshes.forEach((mesh, i) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < mesh.position.length; k += 3) { x0 = Math.min(x0, mesh.position[k]); x1 = Math.max(x1, mesh.position[k]); z0 = Math.min(z0, mesh.position[k + 2]); z1 = Math.max(z1, mesh.position[k + 2]); }
    if ((x1 - x0) * (z1 - z0) > area) { area = (x1 - x0) * (z1 - z0); best = i; }
  });
  return best;
}

// The stage's ground with painted surfaces, built pieces and copied pieces.
function buildGround(library, project, surfaces, defaults) {
  const col = library.files(project.base).get(COL);
  if (!col && !project.blank && !(project.pieces || []).length) throw new Error('This stage has no ground file.');
  const add = [];
  const codeOf = id => { const s = surfaces.find(x => x.id === id) || surfaces[0]; return s.type * 256 + s.sound; };
  const stone = codeOf('stone');
  const apart = groundApart(library, project);
  for (const piece of project.pieces || []) {
    if (piece.kind === 'prefab') {
      const parsed = parsePrefabRef(piece.ref);
      const source = parsed && library.files(parsed.scene).get(COL);
      if (!source) continue;
      const { anchor, groundCut } = prefabFrame(library, parsed.scene, parsed.box);
      const yaw = (piece.yaw || 0) * Math.PI / 180, c = Math.cos(yaw), s = Math.sin(yaw);
      const place = (x, y, z) => { x -= anchor[0]; y -= anchor[1]; z -= anchor[2]; return [piece.position[0] + x * c + z * s, piece.position[1] + y, piece.position[2] - x * s + z * c]; };
      const { position: p, codes } = collisionFile.parse(source);
      for (let t = 0; t < p.length; t += 9) {
        const cx = (p[t] + p[t + 3] + p[t + 6]) / 3, cy = (p[t + 1] + p[t + 4] + p[t + 7]) / 3, cz = (p[t + 2] + p[t + 5] + p[t + 8]) / 3;
        if (!inBox(parsed.box, groundCut, cx, cy, cz)) continue;
        add.push({ p: [0, 3, 6].map(k => place(p[t + k], p[t + k + 1], p[t + k + 2])), code: codes[t / 9] });
      }
      continue;
    }
    if (piece.kind === 'model') {
      // models in files of their own too: their ground stays the stage's (SEPARATE_SLOTS), unless it has a
      // ground file of its own (groundApart)
      if (apart.has(piece.ref)) continue;
      const stored = piece.solid && (project.models || []).find(m => m.id === piece.ref);
      if (!stored) continue;
      for (const part of userModels.decodeModel(stored).parts)
        for (const face of userModelFaces(part, piece)) add.push({ p: face.p, code: build.isFloor(face.n) ? codeOf(piece.ground) : stone });
      continue;
    }
    if (!build.solid(piece)) continue;
    const groundId = piece.ground || palette(library).find(p => p.id === piece.textures.top)?.ground
      || (project.textures || []).find(t => t.id === piece.textures.top)?.ground || 'stone';
    for (const face of build.faces(piece)) add.push({ p: face.p, code: build.isFloor(face.n) ? codeOf(groundId) : stone });
  }
  if (project.plain) {
    // A plain level: no sea, and a floor that ends a fall well below everything (its own, should the
    // stage have none), as wide as the stage's ground can reach.
    let low = -3000;
    for (const { p } of add) for (const [, y] of p) low = Math.min(low, y - 2000);
    const w = 65000, death = 0x0800 * 256;  // the death plane's type, as the stages have it
    add.push({ p: [[-w, low, -w], [w, low, w], [w, low, -w]], code: death }, { p: [[-w, low, -w], [-w, low, w], [w, low, w]], code: death });
    // Mario passes through a death plane and the game looks for ground under it (TMario::checkGroundPlane):
    // with none, the place counts as out of bounds and holds him back like a wall. A floor below it.
    const under = low - 1000;
    add.push({ p: [[-w, under, -w], [w, under, w], [w, under, -w]], code: 0 }, { p: [[-w, under, -w], [-w, under, w], [w, under, w]], code: 0 });
  }
  if (!project.blank && !add.length) return Object.keys(project.paint || {}).length ? collisionFile.paint(col, project.paint, defaults) : null;
  return collisionFile.compose(col || null, { changes: project.paint || {}, defaults, clear: project.blank, keep: project.plain ? keepsOnPlain : keepsOnEmpty, add });
}

// What an emptied stage keeps of its ground: the sea's surface and floor and
// the plane below that ends a fall (camera and shadow bits aside).
const EMPTY_KEEPS = new Set([0x0102, 0x0700, 0x0800]);
const keepsOnEmpty = type => EMPTY_KEEPS.has(type & 0x1fff);
const keepsOnPlain = type => (type & 0x1fff) === 0x0800;

// The stage's plainest material: one texture, one stage, opaque, the most
// ground covered. Textures from other stages are drawn with it.
function plainTemplate(model) {
  let best = null;
  model.materials.forEach((material, index) => {
    if (material.stages.length !== 1 || material.textures[0] < 0 || material.textures.slice(1).some(t => t >= 0) || material.blend.type !== 0) return;
    const usage = materialUsage(model, index);
    if (!best || usage.floor > best.floor) best = { index, floor: usage.floor, base: usage.base };
  });
  return best;
}

// A texture from another model file, added once.
function importTexture(edit, from, slot, name) {
  const headersAt = from.tex.readUInt32BE(0x0c);
  return edit.addTexture(from.tex, headersAt + slot * 0x20, name);
}

function faceNormal(mesh, f) {
  const P = mesh.position, [a, b, c] = [0, 1, 2].map(k => mesh.index[f * 3 + k]);
  const e1 = [0, 1, 2].map(k => P[b * 3 + k] - P[a * 3 + k]), e2 = [0, 1, 2].map(k => P[c * 3 + k] - P[a * 3 + k]);
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const length = Math.hypot(...n) || 1;
  return n.map(v => v / length);
}

const identity = () => Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function transform(m, [x, y, z]) { return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]; }
function rotate(m, [x, y, z]) {
  const v = [m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z], l = Math.hypot(...v) || 1;
  return v.map(c => c / l);
}
// An affine 4×4 (column-major) inverse.
function invert(m) {
  const [a, b, c, d, e, f, g, h, i] = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) return identity();
  const r = [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det, (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det, (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det];
  const t = [m[12], m[13], m[14]];
  const out = identity();
  out[0] = r[0]; out[4] = r[1]; out[8] = r[2]; out[1] = r[3]; out[5] = r[4]; out[9] = r[5]; out[2] = r[6]; out[6] = r[7]; out[10] = r[8];
  out[12] = -(r[0] * t[0] + r[1] * t[1] + r[2] * t[2]); out[13] = -(r[3] * t[0] + r[4] * t[1] + r[5] * t[2]); out[14] = -(r[6] * t[0] + r[7] * t[1] + r[8] * t[2]);
  return out;
}

module.exports = {
  PALETTE, PALETTE_GROUPS, PREFABS, palette, paletteModel, modModel, isUserTexture, cleanUserTextures, userBti, userEntry, setUserTextures, setUserModels, cleanRetextures, retextureImage, prefabs, prefabModel, prefabRef, parsePrefabRef, stageModel,
  cleanStage, hasStageEdits, buildMap, buildGround, buildSea, openSea, plainTemplate, EMPTY_KEEPS, texAffine, untexAffine, plainTexMatrices,
  buildSeparate, separateGround, separateModels, groundApart, freeSlots, SEPARATE_SLOTS, SEPARATE_MAX, MAX_WIRES, SUN_TIMES,
};
