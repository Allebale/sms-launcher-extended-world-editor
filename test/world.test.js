'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const sceneBin = require('../src/scene-bin');
const world = require('../src/world');
const { node, actor, str, u32 } = require('./world-fixture');

// Two stages: "home" with an item manager and two coins, "away" with a Toad
// and its manager, and a palm tree.
const managerData = (chara, capacity) => Buffer.concat([str(chara), u32(capacity), u32(0)]);
function stage(managers, objects, npcs = []) {
  return sceneBin.parse(node('GroupObj', 'root', Buffer.alloc(0), [
    node('GroupObj', 'コンダクター初期化用', Buffer.alloc(0), managers),
    node('MarScene', 'scene', u32(0), [
      node('Strategy', 'strategy', Buffer.alloc(0), [
        node('IdxGroup', 'オブジェクトグループ', u32(3), objects),
        node('IdxGroup', 'ＮＰＣグループ', u32(9), npcs),
      ]),
    ]),
  ]));
}
function stages() {
  const home = stage(
    [node('MapObjManager', 'アイテムマネージャー', managerData('items', 2))],
    [actor('Coin', 'coin 0', [0, 0, 0], str('coin')), actor('Coin', 'coin 1', [100, 0, 0], str('coin'))]);
  const away = stage(
    [node('KinopioManager', 'toads', managerData('toad chara', 1))],
    [actor('Palm', 'palm 0', [5, 0, 5], str('palmNormal'))],
    [actor('NPCKinopio', 'toad 0', [9, 0, 9], Buffer.concat([str('toads'), str('(null)')]))]);
  return { home, away };
}
function library() {
  const trees = stages();
  const files = {
    home: new Map([['mapobj/coin.bmd', Buffer.alloc(1)]]),
    away: new Map([['mapobj/palmnormal.bmd', Buffer.alloc(1)], ['mapobj/palmnormal.col', Buffer.alloc(1)], ['kinopio/kinopio_body.bmd', Buffer.alloc(1)], ['kinopio/kinopio_wait.bck', Buffer.alloc(1)], ['map/params/kinopio.prm', Buffer.alloc(1)]]),
  };
  return { sceneTree: scene => trees[scene], files: scene => files[scene], scenes: () => ['home', 'away'],
    context: scene => ({ files: files[scene], tree: trees[scene], charas: new Map() }) };
}
const project = (changes = {}) => world.cleanProject({ format: 'sms-world', name: 'Test', base: 'home', edits: {}, added: [], paint: {}, ...changes }, ['home', 'away']);
const at = (tree, id) => sceneBin.find(tree, id);
const t = (position, rotation = [0, 0, 0], scale = [1, 1, 1]) => ({ position, rotation, scale });

test('actors read their transform, model key and manager', () => {
  const { home, away } = stages();
  const coin = at(home, '1/0/0/1');
  assert.deepEqual(world.readTransform(coin.data), t([100, 0, 0], [0, 90, 0]));
  assert.equal(world.describe(coin).variant, 'coin');
  const toad = world.describe(at(away, '1/0/1/0'));
  assert.deepEqual(toad.names, ['toad 0 chara', 'toads', '(null)']);
  assert.equal(toad.info.family, 'spine');
});

test('edits move and remove the stage\'s own objects', () => {
  const lib = library();
  const { tree } = world.buildScene(lib, project({ edits: { '1/0/0/0': { removed: true }, '1/0/0/1': { transform: t([1, 2, 3], [0, 45, 0], [2, 2, 2]) } } }));
  const objects = at(tree, '1/0/0').children;
  assert.equal(objects.length, 1);
  assert.equal(sceneBin.decodeName(objects[0].nameBytes), 'coin 1');
  assert.deepEqual(world.readTransform(objects[0].data), t([1, 2, 3], [0, 45, 0], [2, 2, 2]));
  // The library's own copy is untouched.
  assert.equal(at(lib.sceneTree('home'), '1/0/0').children.length, 2);
});

test('things from another stage bring their manager and files, and managers grow to fit', () => {
  const lib = library();
  const added = [
    { uid: 'a', source: { scene: 'away', id: '1/0/1/0' }, type: 'NPCKinopio', label: 'Toad', transform: t([7, 0, 7]) },
    { uid: 'b', source: { scene: 'away', id: '1/0/1/0' }, type: 'NPCKinopio', label: 'Toad', transform: t([8, 0, 8]) },
    { uid: 'c', source: { scene: 'away', id: '1/0/0/0' }, type: 'Palm', label: 'Palm tree', transform: t([1, 0, 1]) },
    { uid: 'd', source: { scene: 'home', id: '1/0/0/0' }, type: 'Coin', label: 'Coin', transform: t([3, 0, 3]) },
  ];
  const { tree, needs, raised } = world.buildScene(lib, project({ added }));
  // Toads go to the NPC group, as in their own stage; the palm and the coin to the objects.
  assert.equal(at(tree, '1/0/1').children.length, 2);
  assert.deepEqual(at(tree, '1/0/0').children.map(n => n.type), ['Coin', 'Coin', 'Palm', 'Coin']);
  assert.deepEqual(world.readTransform(at(tree, '1/0/1/1').data).position, [8, 0, 8]);
  // The Toads' manager joins the managers, before any actor, with room for both.
  const managers = at(tree, '0').children;
  assert.deepEqual(managers.map(n => sceneBin.decodeName(n.nameBytes)), ['アイテムマネージャー', 'toads']);
  assert.equal(managers[1].data.readInt32BE(2 + managers[1].data.readUInt16BE(0)), 2);
  assert.equal(managers[0].data.readInt32BE(2 + managers[0].data.readUInt16BE(0)), 3, 'three coins now share the item manager');
  assert.deepEqual(raised.map(r => r.name).sort(), ['toads', 'アイテムマネージャー'].sort());
  assert.deepEqual([...needs.get('away')].sort(), ['kinopio/kinopio_body.bmd', 'kinopio/kinopio_wait.bck', 'map/params/kinopio.prm', 'mapobj/palmnormal.bmd', 'mapobj/palmnormal.col']);
  // And the scene still writes out and reads back.
  assert.equal(sceneBin.parse(sceneBin.serialize(tree)).children.length, 2);
});

test('things that crash the game without another object of their stage need it there', () => {
  // Bowser looks up the bathtub as the stage loads; only his own stage has one.
  const boss = stage(
    [node('KoopaManager', 'koopas', managerData('koopa chara', 1))],
    [actor('Bathtub', 'バスタブ', [0, 0, 0], str('bathtub'))],
    [actor('Koopa', 'クッパ', [0, 0, 500], Buffer.concat([str('koopas'), str('(null)')]))]);
  const base = library();
  const lib = { ...base, sceneTree: scene => scene === 'boss' ? boss : base.sceneTree(scene), files: scene => scene === 'boss' ? new Map() : base.files(scene),
    context: scene => scene === 'boss' ? { files: new Map(), tree: boss, charas: new Map() } : base.context(scene), scenes: () => ['home', 'away', 'boss'] };
  const bowser = { uid: 'k', source: { scene: 'boss', id: '1/0/1/0' }, type: 'Koopa', label: 'Bowser', transform: t([0, 0, 0]) };
  const scenes = ['home', 'away', 'boss'];
  const level = changes => world.cleanProject({ format: 'sms-world', name: 'Test', base: 'home', edits: {}, added: [], paint: {}, ...changes }, scenes);
  assert.throws(() => world.buildScene(lib, level({ added: [bowser] })), /Bowser needs the bathtub, found in Corona Mountain, and the game crashes/);
  // With the bathtub brought along too, or in his own stage, he's fine; without it there, he isn't.
  const bathtub = { uid: 'b', source: { scene: 'boss', id: '1/0/0/0' }, type: 'Bathtub', label: 'Bathtub', transform: t([0, 0, 0]) };
  assert.doesNotThrow(() => world.buildScene(lib, level({ added: [bathtub, bowser] })));
  assert.doesNotThrow(() => world.buildScene(lib, level({ base: 'boss' })));
  assert.throws(() => world.buildScene(lib, level({ base: 'boss', edits: { '1/0/0/0': { removed: true } } })), /needs the bathtub/);
});

test('level files are checked before they are used', () => {
  assert.throws(() => world.cleanProject({ format: 'other' }, ['home']), /isn't a level file from the world editor/);
  assert.throws(() => world.cleanProject({ format: 'sms-world', base: 'gone' }, ['home']), /isn't on your disc/);
  assert.throws(() => world.cleanProject({ format: 'sms-world', base: 'home', added: [{ source: { scene: 'home', id: '../x' }, transform: t([0, 0, 0]) }] }, ['home']), /damaged/);
  assert.throws(() => world.cleanProject({ format: 'sms-world', base: 'home', edits: { 1: { transform: t([NaN, 0, 0]) } } }, ['home']), /damaged/);
  const clean = world.cleanProject({ format: 'sms-world', base: 'home', name: 'x'.repeat(100), edits: { 'not/an/id': { removed: true }, '1/2': { removed: true } }, paint: { 4: 1, 5: 'sand', x: 2, 6: 0x1000000 }, extra: 'dropped' }, ['home']);
  assert.equal(clean.name.length, 60);
  assert.deepEqual(clean.edits, { '1/2': { removed: true } });
  assert.deepEqual(clean.paint, { 4: 1 });
  assert.equal(clean.extra, undefined);
  assert.equal(world.cleanProject({ format: 'sms-world', base: 'home', stamp: '0123456789abcdef' }, ['home']).stamp, '0123456789abcdef');
  assert.equal(world.cleanProject({ format: 'sms-world', base: 'home', stamp: '../x' }, ['home']).stamp, undefined);
});

test('the catalog names and sorts things the way players know them', () => {
  assert.equal(world.labelOf('CoinBlue', 'coin_blue'), 'Blue coin');
  assert.equal(world.labelOf('ResetFruit', 'FruitCoconut'), 'Coconut (comes back)');
  assert.equal(world.labelOf('MapObjBase', 'SkyIsland'), 'Sky island');
  assert.equal(world.labelOf('NPCKinopio', ''), 'Toad');
  assert.equal(world.categoryOf('Palm', 'palmNormal', { category: 'map objects' }), 'nature');
  assert.equal(world.categoryOf('NormalLift', 'normallift', { category: 'map objects' }), 'vehicles');
  assert.equal(world.categoryOf('WoodBox', 'WoodBox', { category: 'map objects' }), 'interactive');
  assert.equal(world.categoryOf('MapObjBase', 'SimiHotel', { category: 'map objects' }), 'buildings');
  assert.equal(world.categoryOf('AnimalBird', '', { category: 'enemies' }), 'nature');
  assert.equal(world.categoryOf('KinopioManager', '', { category: 'managers' }), null);
  assert.equal(world.sceneLabel('bianco3'), 'Bianco Hills · 4');
  assert.equal(world.sceneLabel('coro_ex2'), 'Corona Mountain · Secret 3');
  assert.equal(world.sceneLabel('mystery'), 'mystery');
});

test('NPCs are painted the way the game picks their colours', () => {
  const material = name => ({ name, matColor: [[255, 255, 255, 255], null], tevColors: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] });
  const model = { materials: [material('_hand_mat'), material('_fuku_mat'), material('_hat')] };
  const changes = [
    [{ mode: 1, material: '_hand_mat', buf0: [[10, 20, 30, 255], [40, 50, 60, 255]] }],
    [{ mode: 2, material: '_fuku_mat', buf0: [[1, 1, 1, 255]], buf1: [[2, 2, 2, 255]] }, { mode: 0, material: '_hat', buf0: [[9, 8, 7, 255], [6, 5, 4, 255]] }],
  ];
  world.paintNpc(model, changes, [1, 5]);
  assert.deepEqual(model.materials[0].tevColors[0], [40, 50, 60, 255], 'mode 1: register 0, entry 1');
  assert.deepEqual(model.materials[1].tevColors.slice(1, 3), [[1, 1, 1, 255], [2, 2, 2, 255]], 'mode 2: registers 1 and 2, the last entry when out of range');
  assert.deepEqual(model.materials[2].matColor[0], [6, 5, 4, 255], 'mode 0: material colour');
  world.paintNpc(model, [[{ mode: 1, material: '_hand_mat', buf0: [[99, 99, 99, 255]] }]], [-1]);
  assert.deepEqual(model.materials[0].tevColors[0], [40, 50, 60, 255], 'no colour index leaves it alone');
  assert.deepEqual(world.parseNpcLook('npc:1:9,3:1,255,2:264'), { index: 1, body: [9, 3], parts: [1, 255, 2], mask: 264 });
  assert.equal(world.NPC_TYPES[21], 'NPCKinopio');
});

// With a real disc (SMS_TEST_DISC=path/to/game.iso): every stage loads, and
// an untouched stage exports to the same scene and collision.
test('stages from a real disc load and export unchanged', { skip: !process.env.SMS_TEST_DISC || !fs.existsSync(process.env.SMS_TEST_DISC) }, async () => {
  const lib = new world.Library(process.env.SMS_TEST_DISC);
  const catalog = await world.buildCatalog(lib);
  assert.ok(catalog.items.length > 200);
  for (const scene of ['dolpic0', 'bianco0']) {
    const level = world.loadLevel(lib, scene);
    assert.ok(level.objects.length > 50);
    const plain = world.cleanProject({ format: 'sms-world', base: scene }, lib.scenes());
    assert.ok(sceneBin.serialize(world.buildScene(lib, plain).tree).equals(lib.files(scene).get('map/scene.bin')));
    assert.ok(world.buildCollision(lib, plain).equals(lib.files(scene).get('map/map.col')));
  }
});

test('build pieces face outward, stand where they are put and have floors to walk on', () => {
  const build = require('../src/world-build');
  for (const kind of build.KINDS.filter(k => build.solid({ kind: k.id }))) {
    const faces = build.faces({ kind: kind.id, position: [1000, 200, -500], yaw: 30, size: kind.size, textures: { top: 'a', side: 'b' } });
    assert.ok(faces.length >= 6, kind.id);
    assert.ok(faces.some(f => build.isFloor(f.n) && f.texture === 'a'), `${kind.id} has a floor in its top texture`);
    for (const face of faces) assert.ok(Math.abs(Math.hypot(...face.n) - 1) < 1e-6);
    const lowest = Math.min(...faces.flatMap(f => f.p.map(p => p[1])));
    assert.ok(Math.abs(lowest - (kind.id === 'floor' ? 200 - kind.size[1] : 200)) < 1e-6, `${kind.id} stands on its position`);
  }
  // A block's faces all point away from its middle.
  const block = build.faces({ kind: 'block', position: [0, 0, 0], yaw: 45, size: [400, 400, 400], textures: {} });
  for (const face of block) {
    const c = [0, 1, 2].map(k => (face.p[0][k] + face.p[1][k] + face.p[2][k]) / 3 - (k === 1 ? 200 : 0));
    assert.ok(c[0] * face.n[0] + c[1] * face.n[1] + c[2] * face.n[2] > 0);
  }
  // Textures line up across pieces: laid over the world, not each piece.
  assert.deepEqual(build.planarUv([800, 0, 1600], [0, 1, 0], 800), [1, 2]);
  assert.deepEqual(build.cleanSize('wall', [1e9, -5, 'x']), [build.MAX_SIZE, build.MIN_SIZE, 80]);
});

test('level files keep their pieces, retextured faces and emptied stage, checked', () => {
  const clean = world.cleanProject({
    format: 'sms-world', base: 'home', blank: 1,
    texturePaint: { '3:12': 'delfino-sand', '3:x': 'sand', '4:5': '../bad' },
    pieces: [
      { uid: 'a', kind: 'house', position: [0, 0, 0], yaw: 15, size: [1, 2e9, 300], textures: { top: 'gelato-thatch', side: '<script>' } },
      { uid: 'b', kind: 'prefab', ref: 'prefab|home|-10,-10,10,10', position: [5, 5, 5] },
      { uid: 'c', kind: 'prefab', ref: 'prefab|gone|0,0,1,1', position: [0, 0, 0] },
      { uid: 'd', kind: 'tower', position: [0, 0, 0] },
      { uid: 'e', kind: 'block', position: [NaN, 0, 0] },
    ],
  }, ['home']);
  assert.equal(clean.blank, true);
  assert.deepEqual(clean.texturePaint, { '3:12': 'delfino-sand' });
  assert.deepEqual(clean.pieces.map(p => p.uid), ['a', 'b']);
  assert.deepEqual(clean.pieces[0].size, [20, 40000, 300]);
  assert.equal(clean.pieces[0].textures.top, 'gelato-thatch');
  assert.notEqual(clean.pieces[0].textures.side, '<script>');
  assert.equal(clean.pieces[1].ref, 'prefab|home|-10,-10,10,10');
});

test('stage models from a real disc take painted textures, built pieces and copied buildings', { skip: !process.env.SMS_TEST_DISC || !fs.existsSync(process.env.SMS_TEST_DISC) }, () => {
  const j3d = require('../src/j3d');
  const levelModel = require('../src/level-model');
  const { BmdEdit } = require('../src/bmd-edit');
  const stage = require('../src/world-stage');
  const lib = new world.Library(process.env.SMS_TEST_DISC);
  const original = lib.files('dolpic0').get('map/map/map.bmd');
  // Unchanged, the model reads back the same.
  const same = j3d.parseBmd(new BmdEdit(original).write()), before = j3d.parseBmd(original);
  assert.deepEqual(same.materials, before.materials);
  assert.deepEqual(same.shapes.map(s => [...s.index].length), before.shapes.map(s => [...s.index].length));
  assert.ok(stage.palette(lib).length >= 40);
  const faces = model => levelModel.bake(model).meshes.reduce((n, m) => n + m.index.length / 3, 0);
  const project = world.cleanProject({
    format: 'sms-world', base: 'dolpic0', texturePaint: { '20:0': 'delfino-sand', '20:1': 'bianco-grass' },
    pieces: [
      { uid: 'a', kind: 'house', position: [0, 300, 9000], yaw: 30, size: [1200, 1000, 1000], textures: { top: 'gelato-shingles', side: 'sirena-stucco' } },
      { uid: 'b', kind: 'prefab', ref: stage.prefabs(lib)[0].ref, position: [3000, 300, 12000], yaw: 90 },
    ],
  }, lib.scenes());
  const built = j3d.parseBmd(world.buildModel(lib, project));
  assert.equal(built.shapes.length, built.materials.length, 'every shape has its own material');
  assert.ok(faces(built) > faces(before));
  assert.ok(built.textures.length > before.textures.length, 'textures from other stages come along');
  const ground = require('../src/collision').parse(world.buildCollision(lib, project));
  assert.ok(ground.codes.length > require('../src/collision').parse(lib.files('dolpic0').get('map/map.col')).codes.length);
  // Emptied, only the pieces (and the open sea) are left.
  const empty = world.cleanProject({ ...project, texturePaint: {}, blank: true }, lib.scenes());
  assert.ok(faces(j3d.parseBmd(world.buildModel(lib, empty))) < faces(before) / 4);
  assert.equal(levelModel.bake(j3d.parseBmd(stage.buildSea(lib, empty))).meshes.length, 1);
});

test('edges are laid once over a side or a border, and borders are only a surface', () => {
  const build = require('../src/world-build');
  const fit = id => id === 'bank' ? 1 : 0;
  // A grassy bank keeps its shape: as wide per repeat as the side is tall, top row at the top.
  const sides = build.faces({ kind: 'floor', position: [0, 300, 0], size: [1000, 200, 1000], textures: { top: 'grass', side: 'bank' } }, fit).filter(f => f.uv);
  assert.ok(sides.length >= 8);
  for (const face of sides) face.p.forEach((p, k) => assert.ok(Math.abs(face.uv[k][1] - (0.01 + 0.98 * (300 - p[1]) / 200)) < 1e-9));
  // A border: one quad, its texture running once from the back edge to the front.
  const border = build.faces({ kind: 'border', position: [0, 300, 0], size: [2000, 20, 400], textures: { top: 'bank' } }, fit);
  assert.equal(border.length, 2);
  assert.deepEqual([...new Set(border.flatMap(f => f.uv.map(uv => Math.round(uv[1] * 100) / 100)))].sort(), [0.01, 0.99]);
  assert.equal(build.solid({ kind: 'border' }), false);
  assert.equal(build.solid({ kind: 'floor' }), true);
});

test('levels play in the game: the stage table finds each scene, and exports carry what the game loads', { skip: !process.env.SMS_TEST_DISC || !fs.existsSync(process.env.SMS_TEST_DISC) }, () => {
  const archive = require('../src/archive');
  const lib = new world.Library(process.env.SMS_TEST_DISC);
  assert.deepEqual(world.stageStart(lib, 'dolpic0'), { area: 1, episode: 0 });
  assert.deepEqual(world.stageStart(lib, 'pinnaBeach0'), { area: 5, episode: 0 });
  assert.equal(world.stageStart(lib, 'nowhere'), null);
  // A palm from another stage brings its leaves' collision (TMapObjTree loads them by name);
  // an emptied stage leaves its goop out; Bianco's lamps can't go elsewhere.
  const catalog = { model: 'airport0|mapobj/palmnormal.bmd' };
  const palm = world.cleanProject({ format: 'sms-world', base: 'dolpic0' }, lib.scenes());
  const source = world.loadLevel(lib, 'airport0').objects.find(o => o.type === 'Palm');
  palm.added.push({ uid: 'p', key: source.key, source: { scene: 'airport0', id: source.id }, type: source.type, variant: source.variant, label: 'Palm', category: 'nature', model: catalog.model, note: '', transform: source.transform });
  palm.blank = true;
  const files = archive.rarc(archive.yaz0(world.buildArchive(lib, palm).data));
  assert.ok(files.has('mapobj/palmnormalleaf01.col'));
  assert.ok(!files.has('map/ymap.ymp'));
  const lamp = world.loadLevel(lib, 'bianco0').objects.find(o => o.variant?.toLowerCase() === 'lampbianco');
  const lit = world.cleanProject({ format: 'sms-world', base: 'dolpic0', added: [{ uid: 'l', key: lamp.key, source: { scene: 'bianco0', id: lamp.id }, type: lamp.type, variant: lamp.variant, label: 'Lamp', category: 'decorations', model: null, transform: lamp.transform }] }, lib.scenes());
  assert.throws(() => world.buildScene(lib, lit), /only works in Bianco Hills/);
});

test('a message bank takes a new text for one message, or for all of them, and keeps the rest', () => {
  const head = Buffer.alloc(0x20); head.write('MESGbmg1', 0, 'ascii'); head.writeUInt32BE(2, 12);
  const inf = Buffer.alloc(0x20); inf.write('INF1', 0, 'ascii'); inf.writeUInt32BE(0x20, 4); inf.writeUInt16BE(3, 8); inf.writeUInt16BE(4, 10);
  const text = Buffer.from('\0ONE\0TWO\0THREE\0', 'latin1');
  [1, 5, 9].forEach((offset, i) => inf.writeUInt32BE(offset, 16 + i * 4));
  const dat = Buffer.concat([Buffer.from('DAT1\0\0\0\0', 'latin1'), text, Buffer.alloc(32 - (text.length + 8) % 32)]);
  dat.writeUInt32BE(dat.length, 4);
  const file = Buffer.concat([head, inf, dat]);
  const read = data => {
    const d = 0x40, at = i => data.readUInt32BE(0x30 + i * 4) + d + 8;
    return [0, 1, 2].map(i => data.toString('latin1', at(i), data.indexOf(0, at(i))));
  };
  assert.deepEqual(read(file), ['ONE', 'TWO', 'THREE']);
  const renamed = world.setMessages(file, { 1: 'SUNSET COVE' });
  assert.deepEqual(read(renamed), ['ONE', 'SUNSET COVE', 'THREE']);
  assert.equal(renamed.readUInt32BE(8), renamed.length);
  assert.deepEqual(read(world.setMessages(file, {}, '')), ['', '', '']);
});

test('players\' own textures are kept checked, and written as the game\'s compressed format with smaller levels', () => {
  const stage = require('../src/world-stage');
  const { writePng } = require('../src/texture-image');
  const { decodeBti } = require('../src/j3d');
  // A 64 × 32 picture: red on the left, blue on the right, the right half's top row see-through.
  const w = 64, h = 32, rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgba.set(x < 32 ? [220, 30, 20, 255] : [20, 40, 230, y < 8 ? 0 : 255], (y * w + x) * 4);
  const png = writePng(w, h, rgba).toString('base64');
  const odd = writePng(48, 32, new Uint8Array(48 * 32 * 4)).toString('base64');
  const clean = world.cleanProject({ format: 'sms-world', base: 'home', textures: [
    { id: 'user-0123456789ab', label: 'Bricks', group: 'wall', ground: 'wood', tile: 5, cutout: 1, png },
    { id: 'user-0123456789ab', label: 'Again', png },
    { id: 'user-ffffffffffff', label: 'Not a power of two', png: odd },
    { id: '../evil', label: 'Bad', png },
    { id: 'user-aaaaaaaaaaaa', label: 'Defaults', group: 'sky', ground: '<b>', png },
  ] }, ['home']);
  assert.deepEqual(clean.textures.map(t => t.id), ['user-0123456789ab', 'user-aaaaaaaaaaaa']);
  assert.deepEqual([clean.textures[0].group, clean.textures[0].ground, clean.textures[0].tile, clean.textures[0].cutout, clean.textures[0].width], ['wall', 'wood', 50, true, 64]);
  assert.deepEqual([clean.textures[1].group, clean.textures[1].ground, clean.textures[1].tile], ['ground', 'stone', 800]);
  assert.equal(stage.userEntry({ ...clean.textures[0], group: 'edge' }).fit, 2);

  const bti = stage.userBti({ width: w, height: h, rgba }, { cutout: true });
  assert.equal(bti[0], 14);
  assert.deepEqual([bti.readUInt16BE(2), bti.readUInt16BE(4), bti[0x18], bti[0x17]], [64, 32, 3, 16]);  // 64×32, 32×16, 16×8
  assert.equal(bti.length, 0x20 + (64 * 32 + 32 * 16 + 16 * 8) / 2);
  const back = decodeBti(bti, 0);
  const texel = (x, y) => Array.from(back.rgba.subarray((y * w + x) * 4, (y * w + x) * 4 + 4));
  assert.ok(texel(5, 20)[0] > 180 && texel(5, 20)[2] < 60);
  assert.ok(texel(50, 20)[2] > 180 && texel(50, 20)[3] === 255);
  assert.equal(texel(50, 2)[3], 0);
  // Opaque ones stay opaque, whatever the picture's alpha.
  const solid = decodeBti(stage.userBti({ width: w, height: h, rgba }), 0);
  assert.equal(solid.rgba[(2 * w + 50) * 4 + 3], 255);
  assert.equal(stage.userBti({ width: 8, height: 8, rgba: new Uint8Array(256) })[0x18], 1);
});

// A binary glTF with one node (moved 2 m up, mirrored on x) holding a red 1 × 1 m square.
function squareGlb({ unlit = false, unused = false, ps2 = false } = {}) {
  // `unused`: a far corner no triangle uses, as some exporters leave in
  const positions = Float32Array.from([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, ...(unused ? [50, 50, 50] : [])]), indices = Uint16Array.from([0, 2, 1, 0, 3, 2]);
  const bin = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(indices.buffer)]);
  const json = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, translation: [0, 2, 0], scale: [-1, 1, 1] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [ps2
      // as OpenGOAL exports Jak and Daxter: PS2 textures (128 full) doubled, cut out at its own alpha
      ? { alphaMode: 'MASK', alphaCutoff: 0.15, pbrMetallicRoughness: { baseColorFactor: [2, 2, 2, 2], baseColorTexture: { index: 0 } } }
      : { pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] }, ...(unlit ? { extensions: { KHR_materials_unlit: {} } } : {}) }],
    ...(ps2 ? { images: [{ uri: 'data:image/png;base64,AA==' }], textures: [{ source: 0 }] } : {}),
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }, { buffer: 0, byteOffset: positions.byteLength, byteLength: 12 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3', min: [0, 0, 0], max: unused ? [50, 50, 50] : [1, 0, 1] }, { bufferView: 1, componentType: 5123, count: 6, type: 'SCALAR' }],
  };
  let text = Buffer.from(JSON.stringify(json));
  text = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 0x20)]);
  const chunk = (kind, body) => { const head = Buffer.alloc(8); head.writeUInt32LE(body.length); head.write(kind, 4, 'ascii'); return Buffer.concat([head, body]); };
  const body = Buffer.concat([chunk('JSON', text), chunk('BIN\0', Buffer.concat([bin, Buffer.alloc((4 - bin.length % 4) % 4)]))]);
  const head = Buffer.alloc(12); head.write('glTF'); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + body.length, 8);
  return Buffer.concat([head, body]);
}

test('players\' own models are read in game units, standing where they\'re placed, and kept checked in the level file', () => {
  const models = require('../src/world-model');
  const read = models.readGlb(squareGlb(), () => { throw new Error('no pictures here'); });
  assert.equal(read.triangles, 2);
  assert.deepEqual(read.size, [100, 0, 100]);
  const [part] = read.parts;
  // Centred on x and z, standing on y = 0, the colour as an 8 × 8 texture.
  assert.deepEqual(Array.from(part.position.subarray(0, 3)), [50, 0, -50]);
  assert.deepEqual([part.texture.width, Array.from(part.texture.rgba.subarray(0, 4))], [8, [255, 0, 0, 255]]);
  // Mirrored on x, the faces are turned back to face up.
  const P = part.position, I = part.index;
  const e1 = [0, 1, 2].map(k => P[I[1] * 3 + k] - P[I[0] * 3 + k]), e2 = [0, 1, 2].map(k => P[I[2] * 3 + k] - P[I[0] * 3 + k]);
  assert.ok(e1[2] * e2[0] - e1[0] * e2[2] > 0);
  assert.ok(part.normal[1] > 0.99);

  const stored = models.encodeModel({ id: 'model-0123456789ab', label: 'Square', ...read });
  const clean = world.cleanProject({ format: 'sms-world', base: 'home', models: [stored, { ...stored, id: 'nope' }], pieces: [
    { uid: 'a', kind: 'model', ref: 'model-0123456789ab', position: [1, 2, 3], scale: 900, solid: false },
    { uid: 'b', kind: 'model', ref: 'model-ffffffffffff', position: [0, 0, 0] },
  ] }, ['home']);
  assert.deepEqual(clean.models.map(m => [m.id, m.triangles]), [['model-0123456789ab', 2]]);
  assert.deepEqual(clean.pieces.map(p => [p.uid, p.scale, p.solid, p.ground]), [['a', 50, false, 'stone']]);
  const back = models.decodeModel(clean.models[0]);
  assert.deepEqual(Array.from(back.parts[0].position), Array.from(part.position));
  assert.deepEqual(Array.from(back.parts[0].index), Array.from(part.index));
  // A damaged one says so.
  assert.throws(() => models.decodeModel({ ...clean.models[0], id: 'model-bbbbbbbbbbbb', parts: [{ ...clean.models[0].parts[0], index: Buffer.from(Uint32Array.from([0, 1, 9]).buffer).toString('base64') }] }), /damaged/);
});

test('retextures are checked and written into the stage archive\'s copy of each model file', () => {
  const { writeNames } = require('../src/bmd-edit');
  const { writePng } = require('../src/texture-image');
  const j3d = require('../src/j3d');
  // A model file with just a TEX1: two 8 × 8 textures, "skin" and "eye" (RGBA8, grey).
  const texel = Buffer.alloc(8 * 8 * 4, 0x80);
  const header = at => { const h = Buffer.alloc(0x20); h[0] = 6; h.writeUInt16BE(8, 2); h.writeUInt16BE(8, 4); h[6] = 1; h[7] = 1; h[0x18] = 1; h.writeUInt32BE(at, 0x1c); return h; };
  const names = writeNames(['skin', 'eye']);
  const dataAt = 0x20 + 0x40;
  let tex = Buffer.concat([Buffer.alloc(0x20), header(dataAt - 0x20), header(dataAt + texel.length - 0x40), texel, texel, names]);
  tex.write('TEX1', 0, 'ascii'); tex.writeUInt16BE(2, 8); tex.writeUInt32BE(0x20, 0x0c); tex.writeUInt32BE(dataAt + texel.length * 2, 0x10);
  tex = Buffer.concat([tex, Buffer.alloc((32 - tex.length % 32) % 32)]);
  tex.writeUInt32BE(tex.length, 4);
  const head = Buffer.alloc(0x20); head.write('J3D2bmd3', 0, 'ascii'); head.writeUInt32BE(0x20 + tex.length, 8); head.writeUInt32BE(1, 0x0c);
  const bmd = Buffer.concat([head, tex]);
  const tree = { root: { name: 'scene', entries: [{ dir: { name: 'MonteW', entries: [{ file: { name: 'mow_body.bmd', data: bmd } }] } }] } };

  const red = new Uint8Array(16 * 16 * 4);
  for (let i = 0; i < red.length; i += 4) red.set([230, 20, 20, 255], i);
  const png = writePng(16, 16, red).toString('base64');
  const clean = world.cleanProject({ format: 'sms-world', base: 'home', retextures: {
    'montew/mow_body.bmd|skin': { png }, '../evil.bmd|skin': { png }, 'montew/mow_body.bmd|eye': { png: writePng(12, 8, new Uint8Array(12 * 8 * 4)).toString('base64') },
  } }, ['home']);
  assert.deepEqual(Object.keys(clean.retextures), ['montew/mow_body.bmd|skin']);
  assert.equal(world.applyRetextures(tree, clean.retextures), 1);
  const out = j3d.decodeBti;  // the file's textures, read back
  const written = tree.root.entries[0].dir.entries[0].file.data;
  const sections = require('../src/j3d-write').sections(written);
  const [at] = sections.get('TEX1');
  const skin = out(written, at + written.readUInt32BE(at + 0x0c)), eye = out(written, at + written.readUInt32BE(at + 0x0c) + 0x20);
  assert.deepEqual([skin.width, skin.format, Array.from(skin.rgba.subarray(0, 3)).map(v => v > 150)], [16, 14, [true, false, false]]);
  assert.deepEqual([eye.width, eye.format, eye.rgba[0]], [8, 6, 0x80]);
});

test('ground added to a stage grows the pools its Map entry gives the game for it', () => {
  const collisionFile = require('../src/collision');
  const small = collisionFile.compose(null, { add: [{ p: [[0, 0, 0], [100, 0, 0], [0, 0, 100]], code: 0 }] });
  // A floor 3000 across: 4 × 4 cells of 1024 from where it starts.
  const big = collisionFile.compose(small, { add: [{ p: [[-1500, 0, -1500], [1500, 0, -1500], [-1500, 0, 1500]], code: 0 }] });
  const ints = values => Buffer.concat(values.map(v => { const b = Buffer.alloc(4); b.writeInt32BE(v); return b; }));
  const map = { type: 'Map', nameBytes: Buffer.from('map'), data: ints([1, 1, 7, 8, 16, 16, 100, 300, 10, 0]), children: null };
  const tree = { type: 'GroupObj', nameBytes: Buffer.from('root'), data: Buffer.alloc(0), children: [map] };
  world.growCollisionPools({ files: () => new Map([['map/map.col', small]]) }, { base: 'home' }, tree, big);
  const [triangles, lists] = [map.data.readInt32BE(24), map.data.readInt32BE(28)];
  assert.ok(triangles >= 101 && triangles < 3000, `triangles ${triangles}`);
  assert.ok(lists >= 300 + 9, `lists ${lists}`);
  assert.deepEqual([map.data.readInt32BE(16), map.data.readInt32BE(32), map.data.readInt32BE(36)], [16, 10, 0]);  // the rest as it was
  // Nothing added, nothing grows.
  const same = { ...map, data: ints([0, 16, 16, 100, 300, 10, 0]) };
  world.growCollisionPools({ files: () => new Map([['map/map.col', small]]) }, { base: 'home' }, { ...tree, children: [same] }, small);
  assert.deepEqual([same.data.readInt32BE(12), same.data.readInt32BE(16)], [100, 300]);
});

test('ground past the edge of the stage\'s collision grid widens the grid', () => {
  const collisionFile = require('../src/collision');
  const small = collisionFile.compose(null, { add: [{ p: [[0, 0, 0], [100, 0, 0], [0, 0, 100]], code: 0 }] });
  // 16 cells of 1024 reach 8192 from the middle: this floor runs to 15000 on x, and the far plane is left out.
  const wide = collisionFile.compose(small, { add: [{ p: [[-100, 0, 0], [15000, 0, 0], [0, 0, 3000]], code: 0 },
    { p: [[-65000, -9000, -65000], [65000, -9000, 65000], [65000, -9000, -65000]], code: 0x0800 * 256 }] });
  const ints = values => Buffer.concat(values.map(v => { const b = Buffer.alloc(4); b.writeInt32BE(v); return b; }));
  const map = { type: 'Map', nameBytes: Buffer.from('map'), data: ints([0, 16, 16, 100, 300, 10, 0]), children: null };
  world.growCollisionPools({ files: () => new Map([['map/map.col', small]]) }, { base: 'home' }, { type: 'GroupObj', nameBytes: Buffer.from('root'), data: Buffer.alloc(0), children: [map] }, wide);
  assert.deepEqual([map.data.readInt32BE(4), map.data.readInt32BE(8)], [30, 16]);
});

test('players\' models keep their own texture coordinates and unlit look on any stage material', () => {
  const stage = require('../src/world-stage'), models = require('../src/world-model');
  // A stage material whose texture matrix is scaled, turned about a centre and moved, as many are.
  const material = { texGens: [{ type: 1, source: 4, matrix: 30 }], texMatrices: [{ info: 0, center: [0.5, 0.5, 0], scale: [0.25, 0.5], rotation: 0.7, translation: [0.3, -0.2] }] };
  const [a, b, c, d, e, f] = stage.texAffine(material), back = stage.untexAffine(material);
  for (const uv of [[0, 0], [1, 0], [0.37, 0.81]]) {
    const s = back(uv), out = [a * s[0] + b * s[1] + c, d * s[0] + e * s[1] + f];
    assert.ok(Math.abs(out[0] - uv[0]) < 1e-9 && Math.abs(out[1] - uv[1]) < 1e-9, `${uv} came back as ${out}`);
  }
  // In the editor the matrix is left out: identity.
  const plain = stage.texAffine({ ...material, texMatrices: stage.plainTexMatrices(material) });
  assert.deepEqual(plain.map(v => Math.round(v * 1e9) / 1e9 + 0), [1, 0, 0, 0, 1, 0]);
  assert.equal(stage.untexAffine({}), null);

  // KHR_materials_unlit is kept from the .glb to the level file and back.
  const read = models.readGlb(squareGlb({ unlit: true }), () => { throw new Error('no pictures here'); });
  assert.equal(read.parts[0].unlit, true);
  const stored = models.encodeModel({ id: 'model-00000000000a', label: 'Unlit', ...read });
  const [clean] = models.cleanUserModels([stored]);
  assert.equal(clean.parts[0].unlit, true);
  assert.equal(models.decodeModel(clean).parts[0].unlit, true);
  assert.equal(models.readGlb(squareGlb(), () => null).parts[0].unlit, false);
  // Corners no triangle uses are left out: they'd move and size the model.
  const lean = models.readGlb(squareGlb({ unused: true }), () => null);
  assert.deepEqual([lean.parts[0].position.length / 3, lean.size], [4, [100, 0, 100]]);
  // The colour factor goes into the texture, and a cut-out's alpha is all or nothing at its alphaCutoff.
  const ps2 = models.readGlb(squareGlb({ ps2: true }), () => ({ width: 8, height: 8, rgba: Uint8Array.from({ length: 256 }, (_, i) => i % 4 === 3 ? (i < 128 ? 128 : 10) : 100) }));
  const rgba = ps2.parts[0].texture.rgba;
  assert.deepEqual([rgba[0], rgba[3], rgba[255]], [200, 255, 0]);
  assert.deepEqual(Array.from(ps2.parts[0].color.subarray(0, 4)), [255, 255, 255, 255]);
  // How its texture repeats is kept too (clamped across, mirrored down), and bad values become repeat.
  const wrapped = models.cleanUserModels([{ ...stored, parts: [{ ...stored.parts[0], wrap: [0, 2] }] }, { ...stored, id: 'model-00000000000b', parts: [{ ...stored.parts[0], wrap: [5, 'x'] }] }]);
  assert.deepEqual(wrapped.map(m => m.parts[0].wrap), [[0, 2], [1, 1]]);
  assert.equal(stage.userBti({ width: 8, height: 8, rgba: new Uint8Array(256) }, { wrap: [0, 2] }).readUInt16BE(6), 0x0002);
});

test('a plain level has no sea, only a floor far below that ends a fall', () => {
  const plain = project({ plain: true, pieces: [{ uid: 'f', kind: 'floor', position: [0, -500, 0], yaw: 0, size: [1000, 100, 1000], textures: { top: 'delfino-tiles', side: 'delfino-white-wall' }, ground: 'stone' }] });
  assert.equal(plain.blank, true);
  const ground = require('../src/collision').parse(world.buildCollision(library(), plain));
  const deaths = [...ground.codes.keys()].filter(i => Math.floor(ground.codes[i] / 256) === 0x0800);
  assert.equal(deaths.length, 2);
  // below the lowest built ground, by 2,000
  assert.ok(ground.position[deaths[0] * 9 + 1] <= -2500 - 100 + 1);
});

test('big models go in files of their own: the names the stage leaves free, shown by MapStaticObj objects where each copy stands', () => {
  const stage = require('../src/world-stage');
  const { node: n, actor: a, str: s } = require('./world-fixture');
  const tree = sceneBin.parse(n('GroupObj', 'root', Buffer.alloc(0), [
    n('IdxGroup', 'マップグループ', u32(1), [a('MapStaticObj', 'river', [0, 0, 0], s('MonteRiver'))]),
  ]));
  const lib = { sceneTree: () => tree, scenes: () => ['monte0'] };
  // The stage's own MonteRiver stays its own; Noki Bay keeps Mare5ExGate.
  assert.deepEqual(stage.freeSlots(lib, 'monte0').map(x => x.name), ['mareSeaPollutionS0', 'mareSeaPollutionS12', 'BiancoRiver', 'Mare5ExGate']);
  assert.ok(!stage.freeSlots(lib, 'mare0').some(x => x.name === 'Mare5ExGate'));
  // One name a model, in order; past the free names, the stage model as usual.
  const models = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => ({ id: `model-00000000000${id}`, label: id, separate: true, solid: i < 2 }));
  const pieces = models.map((m, i) => ({ kind: 'model', ref: m.id, position: [i, 0, 0], yaw: 0, scale: 1, solid: m.solid }));
  const chosen = stage.separateModels(lib, { base: 'monte0', models, pieces });
  assert.equal(chosen.length, 4);
  assert.deepEqual(chosen.map(c => c.model.label), ['a', 'b', 'c', 'd']);
});

test('the stage model\'s vertex arrays can be counted and emptied, with positions turned to floats', { skip: !process.env.SMS_TEST_DISC || !fs.existsSync(process.env.SMS_TEST_DISC) }, () => {
  const { BmdEdit } = require('../src/bmd-edit');
  const lib = new world.Library(process.env.SMS_TEST_DISC);
  const edit = new BmdEdit(lib.files('dolpic0').get('map/map/map.bmd'));
  assert.ok(edit.usage()[9] > 1000);
  for (let s = 0; s < edit.shapes.length; s++) edit.removeTriangles(s, edit.shapeTriangles(s).map((_, i) => i));
  edit.clearVertices([9]);
  assert.equal(edit.usage()[9], 0);
  assert.equal(edit.addVertex(9, [123456.5, 0, -99999]), 0);
  const again = new BmdEdit(edit.write());
  assert.equal(again.usage()[9], 1);
});

test('on a real disc, a model in a file of its own exports its model, its ground and an object for each copy', { skip: !process.env.SMS_TEST_DISC || !fs.existsSync(process.env.SMS_TEST_DISC) }, () => {
  const archive = require('../src/archive'), models = require('../src/world-model'), j3d = require('../src/j3d');
  const lib = new world.Library(process.env.SMS_TEST_DISC);
  const read = models.readGlb(squareGlb(), () => null);
  const stored = { ...models.encodeModel({ id: 'model-0123456789ab', label: 'Square', ...read }), separate: true };
  const level = world.cleanProject({ format: 'sms-world', base: 'dolpic0', models: [stored], pieces: [
    { uid: 'a', kind: 'model', ref: stored.id, position: [0, 500, 0], yaw: 45, scale: 2, solid: true },
    { uid: 'b', kind: 'model', ref: stored.id, position: [900, 500, 0], yaw: 0, scale: 1, solid: true },
  ] }, lib.scenes());
  const files = archive.rarc(archive.yaz0(world.buildArchive(lib, level).data));
  const slot = require('../src/world-stage').freeSlots(lib, 'dolpic0').find(s => s.ground).name;
  // the game finds archive files by their lower-case names
  const own = j3d.parseBmd(files.get(`map/map/${slot.toLowerCase()}.bmd`));
  assert.ok(own.textures.every(t => t.width <= 8 || t.name.startsWith('model-')));
  assert.ok(files.has(`map/map/${slot.toLowerCase()}.col`));
  const scene = sceneBin.parse(files.get('map/scene.bin'));
  let copies = 0;
  sceneBin.walk(scene, node => { if (node.type === 'MapStaticObj' && node.data.includes(Buffer.from(slot))) copies++; });
  assert.equal(copies, 2);
  const budget = world.levelBudget(lib, level);
  assert.equal(budget.separate.length, 1);
  assert.ok(budget.model.positions > 1000);
});

test('OBJ models come in as a binary glTF: faces fanned, v counted from the top, materials and pictures from beside them', () => {
  const { objToGlb, mapFile } = require('../src/obj-glb');
  const models = require('../src/world-model');
  const obj = ['mtllib box.mtl', 'v 0 0 0', 'v 1 0 0', 'v 1 0 1', 'v 0 0 1', 'vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1', 'vn 0 1 0',
    'usemtl red', 'f 1/1/1 4/4/1 3/3/1 2/2/1', 'usemtl pic', 'f -4/-4 -1/-1 -2/-2'].join('\n');
  const mtl = 'newmtl red\nKd 1 0 0\nnewmtl pic\nmap_Kd -s 1 1 1 tex/wall.png\n';
  const asked = [];
  const glb = objToGlb(obj, name => { asked.push(name); return name === 'box.mtl' ? Buffer.from(mtl) : name === 'tex/wall.png' ? Buffer.from('png') : null; });
  assert.ok(asked.includes('tex/wall.png'));
  const read = models.readGlb(glb, () => ({ width: 8, height: 8, rgba: new Uint8Array(256).fill(200) }));
  assert.equal(read.triangles, 3);
  assert.deepEqual(read.size, [100, 0, 100]);
  const [red, pic] = read.parts;
  assert.deepEqual(Array.from(red.texture.rgba.subarray(0, 4)), [255, 0, 0, 255]);
  assert.equal(pic.texture.rgba[0], 200);
  // vt 0 0 (the bottom left in OBJ) is v = 1 in glTF
  assert.equal(pic.uv[1], 1);
  assert.equal(mapFile(['-clamp', 'on', 'my', 'pic.png']), 'my pic.png');
  assert.throws(() => objToGlb('v 0 0 0', () => null), /no faces/);
});

test('the stage\'s ground stops at the 32,767 corners the game reads', () => {
  const collisionFile = require('../src/collision');
  const strip = n => Array.from({ length: n }, (_, i) => ({ p: [[i * 10, 0, 0], [i * 10 + 5, 0, 0], [i * 10, 0, 5]], code: 0 }));
  assert.ok(collisionFile.compose(null, { add: strip(10922) }));  // 32,766 corners
  assert.throws(() => collisionFile.compose(null, { add: strip(10923) }), /32,767/);
});

test('wires become cubes in the stage\'s wire table, with the wire along the top', () => {
  const sceneBin = require('../src/scene-bin');
  const cube = world.wireCube({ a: [0, 500, 0], b: [0, 500, 1000] }, 0);
  const f = k => cube.data.readFloatBE(k * 4);
  assert.deepEqual([f(0), f(1), f(2)], [0, 250, 500]);          // stands below the middle
  assert.equal(Math.round(f(4)), 0);                              // turned so its length runs along Z
  assert.deepEqual([f(7), f(8)], [2.5, 10]);                      // 250 high (the wire on top), 1000 long
  const east = world.wireCube({ a: [0, 0, 0], b: [1000, 0, 0] }, 1);
  assert.equal(Math.round(east.data.readFloatBE(16)), 90);
  // A table is read and written like a scene: the cubes are its children.
  const table = { type: 'CubeGeneralInfoTable', nameBytes: Buffer.from('t'), data: Buffer.alloc(0), children: [cube, east] };
  const root = { type: 'NameRefGrp', nameBytes: Buffer.from('r'), data: Buffer.alloc(0), children: [table] };
  const back = sceneBin.parse(sceneBin.serialize(root));
  assert.equal(back.children[0].children.length, 2);
  assert.ok(back.children[0].children[1].data.equals(east.data));
});

test('the sun turns the stage\'s sun lights, the ones opposite and the sun in the sky', () => {
  const light = (x, y, z) => { const b = Buffer.alloc(20); [x, y, z].forEach((v, k) => b.writeFloatBE(v, k * 4)); return { type: 'Light', nameBytes: Buffer.from('l'), data: b, children: null }; };
  const sun = light(200000, 500000, 200000), below = light(-200000, -500000, -200000), other = light(0, 100, 0);
  const tree = { type: 'GroupObj', nameBytes: Buffer.from('r'), data: Buffer.alloc(0), children: [sun, below, other] };
  world.setSun(tree, [-1, 1, 0]);
  const at = n => [0, 4, 8].map(k => Math.round(n.data.readFloatBE(k) / 100) + 0);
  const r = Math.round(Math.hypot(200000, 500000, 200000) / Math.SQRT2 / 100);
  assert.deepEqual(at(sun), [-r, r, 0]);
  assert.deepEqual(at(below), [r, -r, 0]);
  assert.deepEqual(at(other), [0, 1, 0]);
});

test('a premade level\'s things named by kind are found in the catalog', () => {
  const catalog = { items: [
    { key: 'Coin', type: 'Coin', label: 'Coin', category: 'items', source: { scene: 'bianco0', id: '6/2/3/1' }, model: 'm', scale: [1, 1, 1] },
    { key: 'HamuKuri:x', type: 'HamuKuri', label: 'Strollin\' Stu', category: 'enemies', source: { scene: 'dolpic0', id: '6/2/7/0' }, model: null, scale: [1, 1, 1] },
  ] };
  const t = { position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] };
  const out = world.resolvePremade(catalog, { added: [{ key: 'Coin', transform: t }, { type: 'HamuKuri', transform: t }, { key: 'Nothing', transform: t },
    { source: { scene: 'bianco0', id: '1' }, transform: t }] });
  assert.equal(out.added.length, 3);
  assert.deepEqual(out.added[0].source, { scene: 'bianco0', id: '6/2/3/1' });
  assert.equal(out.added[1].key, 'HamuKuri:x');
  assert.deepEqual(out.added[1].transform.position, [1, 2, 3]);
  assert.deepEqual(out.unresolved, ['Nothing']);
});
