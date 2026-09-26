import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { ed } from './state.js';
import { SHAPES, buildGeometry, cleanParams, defaultParams, flipWinding } from './shapes.js';
import * as vertexMode from './vertex.js';
import * as sculptMode from './sculpt.js';
import { runBoolean } from './csg.js';
import { initAI } from './ai.js';

const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;
const STORE_KEY = 'modelo3d.cena.v2';
const OLD_STORE_KEY = 'modelo3d.cena.v1';
const HISTORY_CHAR_LIMIT = 150e6;
const PALETTE = ['#f2a33a', '#3e7bfa', '#46a758', '#e5484d', '#a78bfa', '#3fb6a8', '#e6e8ec', '#3b4250', '#c9ced6', '#8b5a2b'];

/* ---------- renderizador e cena ---------- */
const view = $('view');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
view.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x15181e);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

const camera = new THREE.PerspectiveCamera(42, 1, 0.02, 1000);
camera.position.set(6.5, 5, 8);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 1.4, 0);
orbit.enableDamping = true;
orbit.dampingFactor = 0.12;

scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3f4a, 0.7));
const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.position.set(6, 12, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 0.5, far: 40 });
sun.shadow.bias = -0.0004;
scene.add(sun);

const grid = new THREE.GridHelper(40, 160, 0x353b47, 0x22262e);
grid.material.transparent = true;
grid.material.opacity = 0.9;
scene.add(grid);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.3 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const world = new THREE.Group();
world.name = 'Cena';
scene.add(world);

const selBox = new THREE.BoxHelper(undefined, 0xf2a33a);
selBox.visible = false;
scene.add(selBox);

const tc = new TransformControls(camera, renderer.domElement);
const tcHelper = tc.getHelper ? tc.getHelper() : tc;
scene.add(tcHelper);
tc.setTranslationSnap(0.25);
tc.setRotationSnap(15 * DEG);
tc.setScaleSnap(0.1);
tc.addEventListener('dragging-changed', (e) => {
  orbit.enabled = !e.value;
  if (ed.mode === 'vertex') {
    if (e.value) vertexMode.onDragStart();
    else vertexMode.onDragEnd();
  }
  if (!e.value) commit();
});
tc.addEventListener('objectChange', () => {
  if (ed.mode === 'vertex') vertexMode.onDrag();
  selBox.update();
  fillProps();
});

new ResizeObserver(() => {
  const w = view.clientWidth, h = view.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}).observe(view);

renderer.setAnimationLoop(() => {
  orbit.update();
  if (selected) selBox.update();
  for (const fn of ed.frameHooks) fn();
  renderer.render(scene, camera);
});

/* ---------- criação de peças ---------- */
let colorIndex = 0;
function makeMesh(key, o = {}) {
  if (!SHAPES[key]) key = 'cubo';
  const params = cleanParams(key, o.params);
  const geo = buildGeometry(key, params, !!o.mirror);
  const mat = new THREE.MeshStandardMaterial({
    color: o.color ?? PALETTE[colorIndex++ % 6],
    metalness: o.metal ?? 0.05,
    roughness: o.rough ?? 0.45,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.name = o.name ?? nextName(SHAPES[key].label);
  mesh.userData.shape = key;
  mesh.userData.params = params;
  if (o.mirror) mesh.userData.mirrorX = true;
  if (o.size) {
    const base = geo.boundingBox.getSize(new THREE.Vector3());
    mesh.scale.set(
      base.x > 1e-6 ? o.size[0] / base.x : 1,
      base.y > 1e-6 ? o.size[1] / base.y : 1,
      base.z > 1e-6 ? o.size[2] / base.z : 1,
    );
  }
  if (o.rot) mesh.rotation.set(o.rot[0] * DEG, o.rot[1] * DEG, o.rot[2] * DEG);
  if (o.pos) mesh.position.set(...o.pos);
  return mesh;
}
function nextName(label) {
  let n = 1;
  const names = new Set(world.children.map((c) => c.name));
  while (names.has(`${label} ${n}`)) n++;
  return `${label} ${n}`;
}
function addShape(key) {
  if (ed.mode !== 'object') setEditMode('object');
  const mesh = makeMesh(key);
  const snap = (v) => (snapOn ? Math.round(v / 0.25) * 0.25 : v);
  mesh.position.set(snap(orbit.target.x), 0, snap(orbit.target.z));
  world.add(mesh);
  dropToFloor(mesh);
  select(mesh);
  commit();
}
function dropToFloor(obj) {
  obj.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(obj);
  if (!b.isEmpty()) obj.position.y -= b.min.y;
}
// Peça deformada, esculpida ou cortada: deixa de ser paramétrica.
function markCustom(mesh) {
  if (mesh.userData.params) {
    delete mesh.userData.params;
    mesh.userData.baseShape = mesh.userData.shape;
    mesh.userData.shape = 'malha';
    paramKey = '';
  }
}

function buildExample() {
  const metal = { color: '#c9ced6', metal: 0.75, rough: 0.28 };
  const dark = { color: '#3b4250', rough: 0.6 };
  const parts = [
    ['cubo', { name: 'Pé esquerdo', size: [0.5, 0.2, 0.7], pos: [-0.35, 0.1, 0.06], params: { cantos: 0.04, divisoes: 2 }, ...dark }],
    ['cubo', { name: 'Pé direito', size: [0.5, 0.2, 0.7], pos: [0.35, 0.1, 0.06], params: { cantos: 0.04, divisoes: 2 }, ...dark }],
    ['cilindro', { name: 'Perna esquerda', size: [0.26, 0.85, 0.26], pos: [-0.35, 0.62, 0], ...metal }],
    ['cilindro', { name: 'Perna direita', size: [0.26, 0.85, 0.26], pos: [0.35, 0.62, 0], ...metal }],
    ['cubo', { name: 'Tronco', size: [1.4, 1.2, 0.9], pos: [0, 1.62, 0], params: { cantos: 0.1, divisoes: 3 }, color: '#f2a33a', rough: 0.4 }],
    ['cubo', { name: 'Painel', size: [0.72, 0.42, 0.06], pos: [0, 1.7, 0.46], color: '#23272f', rough: 0.3 }],
    ['esfera', { name: 'Botão vermelho', size: [0.13, 0.13, 0.13], pos: [-0.16, 1.7, 0.5], color: '#e5484d', rough: 0.25 }],
    ['esfera', { name: 'Botão verde', size: [0.13, 0.13, 0.13], pos: [0.16, 1.7, 0.5], color: '#46a758', rough: 0.25 }],
    ['capsula', { name: 'Braço esquerdo', size: [0.26, 1.0, 0.26], pos: [-0.9, 1.55, 0], rot: [0, 0, -10], ...metal }],
    ['capsula', { name: 'Braço direito', size: [0.26, 1.0, 0.26], pos: [0.9, 1.55, 0], rot: [0, 0, 10], ...metal }],
    ['toro', { name: 'Garra esquerda', size: [0.34, 0.34, 0.12], pos: [-0.99, 0.95, 0], rot: [0, 90, 0], params: { abertura: 290 }, ...dark }],
    ['toro', { name: 'Garra direita', size: [0.34, 0.34, 0.12], pos: [0.99, 0.95, 0], rot: [0, 90, 0], params: { abertura: 290 }, ...dark }],
    ['cilindro', { name: 'Pescoço', size: [0.32, 0.16, 0.32], pos: [0, 2.3, 0], ...metal }],
    ['cubo', { name: 'Cabeça', size: [0.95, 0.72, 0.78], pos: [0, 2.73, 0], params: { cantos: 0.12, divisoes: 3 }, color: '#e6e8ec', rough: 0.35 }],
    ['esfera', { name: 'Olho esquerdo', size: [0.2, 0.2, 0.12], pos: [-0.21, 2.8, 0.39], color: '#1b1f26', rough: 0.15 }],
    ['esfera', { name: 'Olho direito', size: [0.2, 0.2, 0.12], pos: [0.21, 2.8, 0.39], color: '#1b1f26', rough: 0.15 }],
    ['cubo', { name: 'Boca', size: [0.4, 0.06, 0.04], pos: [0, 2.56, 0.4], color: '#3b4250' }],
    ['cilindro', { name: 'Antena', size: [0.04, 0.42, 0.04], pos: [0, 3.29, 0], ...metal }],
    ['esfera', { name: 'Ponta da antena', size: [0.15, 0.15, 0.15], pos: [0, 3.53, 0], color: '#e5484d', rough: 0.25 }],
  ];
  return parts.map(([k, o]) => makeMesh(k, o));
}

/* ---------- seleção ---------- */
let selected = null;
function select(obj) {
  if (ed.mode !== 'object' && obj !== selected) setEditMode('object');
  selected = obj;
  if (obj && ed.mode === 'object') tc.attach(obj);
  else if (!obj) tc.detach();
  if (obj) {
    selBox.setFromObject(obj);
    selBox.visible = ed.mode === 'object';
  } else {
    selBox.visible = false;
  }
  renderOutliner();
  fillProps();
  updateEditButtons();
}

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function setRay(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return raycaster;
}
let down = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY, gizmo: tc.axis !== null && !!tc.object };
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  const onGizmo = down.gizmo;
  down = null;
  if (moved > 4 || onGizmo || e.button !== 0) return;
  if (ed.mode === 'vertex') { vertexMode.onClick(e); return; }
  if (ed.mode === 'sculpt') return;
  const hit = setRay(e).intersectObjects(world.children, true).find((h) => isVisible(h.object));
  const obj = hit ? topLevel(hit.object) : null;
  if (ed.pendingPick) { resolvePick(obj); return; }
  select(obj);
});
function isVisible(o) {
  for (; o && o !== world; o = o.parent) if (!o.visible) return false;
  return true;
}
function topLevel(o) {
  while (o.parent && o.parent !== world) o = o.parent;
  return o;
}

/* ---------- escolher uma segunda peça (cortar/unir) ---------- */
function setBanner(text, onCancel) {
  $('banner').hidden = !text;
  $('bannerText').textContent = text || '';
  $('bannerCancel').onclick = onCancel || null;
}
function cancelPick() {
  ed.pendingPick = null;
  setBanner(null);
}
function resolvePick(obj) {
  const p = ed.pendingPick;
  if (!obj) { toast('Clique numa peça da cena, ou em Cancelar.'); return; }
  if (obj === p.source) { toast('Escolha uma peça diferente da selecionada.'); return; }
  cancelPick();
  p.onPick(obj);
}
const CSG_TEXT = {
  subtract: (n) => `Clique na peça que vai abrir o buraco em “${n}”`,
  union: (n) => `Clique na peça que vai ser unida a “${n}”`,
  intersect: (n) => `Clique na peça que cruza “${n}”`,
};
document.querySelectorAll('[data-csg]').forEach((b) => b.addEventListener('click', () => {
  if (!selected?.isMesh) { toast('Selecione uma peça simples. Modelos importados em grupo não podem ser cortados.'); return; }
  const op = b.dataset.csg;
  const source = selected;
  ed.pendingPick = {
    source,
    onPick: async (other) => {
      const ok = await runBoolean(source, other, op, $('csgKeep').checked);
      if (ok) toast(op === 'subtract' ? 'Buraco aberto.' : op === 'union' ? 'Peças unidas.' : 'Interseção pronta.');
    },
  };
  setBanner(CSG_TEXT[op](source.name), cancelPick);
}));

/* ---------- modos de edição ---------- */
function setEditMode(m) {
  if (m === ed.mode) return;
  if (m !== 'object' && !selected?.isMesh) {
    toast('Selecione uma peça primeiro. Modelos importados em grupo só podem ser movidos.');
    return;
  }
  cancelPick();
  if (ed.mode === 'vertex') vertexMode.exit();
  if (ed.mode === 'sculpt') sculptMode.exit();
  ed.mode = m;
  if (m === 'vertex') {
    tc.detach();
    tc.setMode('translate');
    vertexMode.enter(selected);
  } else if (m === 'sculpt') {
    tc.detach();
    sculptMode.enter(selected);
  } else {
    tc.setMode(toolMode);
    if (selected) tc.attach(selected);
  }
  selBox.visible = m === 'object' && !!selected;
  document.querySelectorAll('[data-edit]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.edit === m)));
  $('objectPanel').hidden = m !== 'object';
  $('vertexPanel').hidden = m !== 'vertex';
  $('sculptPanel').hidden = m !== 'sculpt';
  document.querySelectorAll('#toolGroup button').forEach((b) => (b.disabled = m !== 'object'));
  view.classList.toggle('sculpting', m === 'sculpt');
  if (m === 'object') fillProps();
}
function updateEditButtons() {
  const can = !!selected?.isMesh;
  document.querySelectorAll('[data-edit="vertex"], [data-edit="sculpt"]').forEach((b) => (b.disabled = !can && ed.mode === 'object'));
}
document.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => setEditMode(b.dataset.edit)));
document.querySelectorAll('[data-exit]').forEach((b) => b.addEventListener('click', () => setEditMode('object')));

/* ---------- histórico ---------- */
let history = [];
let hIndex = -1;
const loader = new THREE.ObjectLoader();
const PLACEHOLDER = new THREE.BufferGeometry();

// Peças paramétricas são salvas só com os parâmetros; a malha é refeita ao carregar.
// Malhas livres são salvas sem as normais (recalculadas ao carregar) e com 5 casas decimais.
const round = (k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1e5) / 1e5 : v);
function snapshot() {
  world.updateMatrixWorld(true); // as matrizes só são atualizadas no desenho; sem isto a posição se perde
  const swaps = [];
  const normals = [];
  world.traverse((m) => {
    if (!m.isMesh) return;
    if (SHAPES[m.userData.shape] && m.userData.params) {
      swaps.push([m, m.geometry]);
      m.geometry = PLACEHOLDER;
    } else if (m.userData.shape === 'malha' && m.geometry.attributes.normal) {
      normals.push([m.geometry, m.geometry.attributes.normal]);
      m.geometry.deleteAttribute('normal');
    }
  });
  try { return JSON.stringify(world.toJSON(), round); }
  finally {
    swaps.forEach(([m, g]) => (m.geometry = g));
    normals.forEach(([g, n]) => g.setAttribute('normal', n));
  }
}
function hydrate(json) {
  const group = loader.parse(typeof json === 'string' ? JSON.parse(json) : json);
  group.traverse((m) => {
    if (!m.isMesh) return;
    const key = m.userData.shape;
    if (SHAPES[key]) {
      if (!m.userData.params) m.userData.params = defaultParams(key);
      if (m.geometry.attributes.position === undefined || m.geometry.type !== 'BufferGeometry') {
        m.geometry.dispose();
        m.geometry = buildGeometry(key, m.userData.params, !!m.userData.mirrorX);
      }
    } else if (m.geometry.type !== 'BufferGeometry') {
      const g = new THREE.BufferGeometry().copy(m.geometry);
      m.geometry.dispose();
      m.geometry = g;
    }
    if (!m.geometry.attributes.normal && m.geometry.attributes.position) m.geometry.computeVertexNormals();
  });
  return [...group.children];
}
function commit() {
  history = history.slice(0, hIndex + 1);
  history.push(snapshot());
  let total = history.reduce((s, h) => s + h.length, 0);
  while (history.length > 100 || (total > HISTORY_CHAR_LIMIT && history.length > 1)) total -= history.shift().length;
  hIndex = history.length - 1;
  persist();
  renderOutliner();
  updateUndo();
}
function restore(json) {
  const keep = selected?.uuid;
  const mode = ed.mode;
  if (mode !== 'object') setEditMode('object');
  const objs = hydrate(json);
  clearWorld();
  objs.forEach((c) => world.add(c));
  const again = keep ? world.children.find((c) => c.uuid === keep) ?? null : null;
  select(again);
  if (again && mode !== 'object') setEditMode(mode);
}
function undo() { if (hIndex > 0) { restore(history[--hIndex]); persist(); updateUndo(); } }
function redo() { if (hIndex < history.length - 1) { restore(history[++hIndex]); persist(); updateUndo(); } }
function updateUndo() {
  $('undoBtn').disabled = hIndex <= 0;
  $('redoBtn').disabled = hIndex >= history.length - 1;
}
function clearWorld() {
  tc.detach();
  [...world.children].forEach((c) => { world.remove(c); disposeDeep(c); });
}
function disposeDeep(o) {
  o.traverse((m) => {
    if (m.geometry && m.geometry !== PLACEHOLDER) m.geometry.dispose();
    if (m.material) [].concat(m.material).forEach((mt) => mt.dispose());
  });
}
let warnedStorage = false;
function persist() {
  try {
    localStorage.setItem(STORE_KEY, history[hIndex]);
  } catch {
    if (!warnedStorage) {
      warnedStorage = true;
      toast('A cena ficou grande demais para o salvamento automático. Use Arquivo › Salvar projeto.');
    }
  }
}
function replaceWorld(objects) {
  if (ed.mode !== 'object') setEditMode('object');
  cancelPick();
  clearWorld();
  objects.forEach((o) => world.add(o));
  select(null);
  commit();
}

/* ---------- ações ---------- */
function duplicate() {
  if (!selected || ed.mode !== 'object') return;
  const c = cloneDeep(selected);
  c.name = nextName(selected.name.replace(/\s+\d+$/, ''));
  c.position.x += snapOn ? 0.5 : 0.4;
  world.add(c);
  select(c);
  commit();
}
function mirror() {
  if (!selected || ed.mode !== 'object') return;
  const c = cloneDeep(selected);
  c.name = mirrorName(selected.name);
  c.position.x = -selected.position.x;
  c.rotation.y = -selected.rotation.y;
  c.rotation.z = -selected.rotation.z;
  if (Math.abs(selected.position.x) < 0.01) c.position.x += 1;
  // Reflete a malha também, para peças que não são simétricas (cunha, esculturas, cortes).
  c.traverse((m) => {
    if (!m.isMesh) return;
    if (m.userData.params) {
      m.userData.mirrorX = !m.userData.mirrorX;
      m.geometry.dispose();
      m.geometry = buildGeometry(m.userData.shape, m.userData.params, m.userData.mirrorX);
    } else {
      m.geometry.scale(-1, 1, 1);
      flipWinding(m.geometry);
      m.geometry.computeVertexNormals();
      m.geometry.computeBoundingBox();
    }
  });
  world.add(c);
  select(c);
  commit();
  toast('Cópia espelhada do outro lado do eixo X');
}
function mirrorName(n) {
  if (/esquerd/i.test(n)) return n.replace(/esquerd/i, (s) => (s[0] === 'E' ? 'Direit' : 'direit'));
  if (/direit/i.test(n)) return n.replace(/direit/i, (s) => (s[0] === 'D' ? 'Esquerd' : 'esquerd'));
  return `${n} (espelho)`;
}
function cloneDeep(obj) {
  const c = obj.clone(true);
  c.traverse((m) => {
    if (m.geometry) m.geometry = m.geometry.clone();
    if (m.material) m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
    m.userData = structuredClone(m.userData);
  });
  return c;
}
function removeSelected() {
  if (!selected || ed.mode !== 'object') return;
  const o = selected;
  select(null);
  world.remove(o);
  disposeDeep(o);
  commit();
}
function focusOn(obj) {
  const target = obj ?? world;
  const box = new THREE.Box3().setFromObject(target);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  const dist = (size / 2) / Math.tan((camera.fov * DEG) / 2) * 1.15;
  const dir = camera.position.clone().sub(orbit.target).normalize();
  orbit.target.copy(center);
  camera.position.copy(center).addScaledVector(dir, Math.max(dist, 0.3));
}
const actions = {
  duplicate, mirror, remove: removeSelected,
  floor: () => { if (selected) { dropToFloor(selected); commit(); fillProps(); } },
  focus: () => focusOn(selected),
};
document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => actions[b.dataset.act]()));

/* ---------- ferramentas ---------- */
let snapOn = true;
let toolMode = 'translate';
function setMode(mode) {
  if (ed.mode !== 'object') return;
  toolMode = mode;
  tc.setMode(mode);
  document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
}
function toggleSnap() {
  snapOn = !snapOn;
  tc.setTranslationSnap(snapOn ? 0.25 : null);
  tc.setRotationSnap(snapOn ? 15 * DEG : null);
  tc.setScaleSnap(snapOn ? 0.1 : null);
  $('snapBtn').setAttribute('aria-pressed', String(snapOn));
  $('hudInfo').textContent = snapOn ? 'grade 0,25 m' : 'movimento livre';
}
document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
$('snapBtn').addEventListener('click', toggleSnap);
$('spaceBtn').addEventListener('click', () => {
  const local = tc.space === 'world';
  tc.setSpace(local ? 'local' : 'world');
  $('spaceBtn').setAttribute('aria-pressed', String(local));
});
$('undoBtn').addEventListener('click', undo);
$('redoBtn').addEventListener('click', redo);

window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea, select, dialog')) return;
  const k = e.key.toLowerCase();
  const mod = e.ctrlKey || e.metaKey;
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (mod && k === 'y') { e.preventDefault(); redo(); }
  else if (mod && k === 'd') { e.preventDefault(); duplicate(); }
  else if (mod) return;
  else if (k === '1') setEditMode('object');
  else if (k === '2') setEditMode('vertex');
  else if (k === '3') setEditMode('sculpt');
  else if (k === 'w') setMode('translate');
  else if (k === 'e') setMode('rotate');
  else if (k === 'r') setMode('scale');
  else if (k === 'g') toggleSnap();
  else if (k === 'm') mirror();
  else if (k === 'f') focusOn(selected);
  else if (k === 'delete' || k === 'backspace') { e.preventDefault(); removeSelected(); }
  else if (k === 'escape') {
    if (ed.pendingPick) cancelPick();
    else if (ed.mode !== 'object') setEditMode('object');
    else select(null);
  }
});

/* ---------- formas e lista da cena ---------- */
$('shapes').innerHTML = Object.entries(SHAPES)
  .map(([k, s]) => `<button type="button" class="shape" data-shape="${k}" title="Adicionar ${s.label.toLowerCase()}">${s.icon}${s.label}</button>`)
  .join('');
$('shapes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-shape]');
  if (b) addShape(b.dataset.shape);
});

const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 3l18 18M10.6 5.6A9.6 9.6 0 0112 5.5c6.4 0 10 6.5 10 6.5a17 17 0 01-3.2 3.9M6.4 6.9C3.6 8.6 2 12 2 12s3.6 6.5 10 6.5c1.6 0 3-.4 4.2-1"/></svg>';
function swatchOf(o) {
  let c = null;
  o.traverse((m) => { if (!c && m.material) { const mt = [].concat(m.material)[0]; if (mt.color) c = '#' + mt.color.getHexString(); } });
  return c || '#888';
}
function esc(s) { return String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }
function renderOutliner() {
  const items = world.children;
  $('count').textContent = `${items.length} ${items.length === 1 ? 'peça' : 'peças'}`;
  $('outlinerEmpty').hidden = items.length > 0;
  $('outliner').innerHTML = items.map((o) => `
    <li class="${o === selected ? 'sel' : ''} ${o.visible ? '' : 'off'}" data-id="${o.uuid}">
      <button type="button" class="item"><i style="background:${swatchOf(o)}"></i><span>${esc(o.name || 'Peça')}</span></button>
      <button type="button" class="eye" title="${o.visible ? 'Ocultar' : 'Mostrar'}">${o.visible ? EYE : EYE_OFF}</button>
    </li>`).join('');
}
$('outliner').addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (!li) return;
  const o = world.children.find((c) => c.uuid === li.dataset.id);
  if (!o) return;
  if (e.target.closest('.eye')) {
    o.visible = !o.visible;
    if (!o.visible && o === selected) select(null);
    commit();
  } else if (ed.pendingPick) {
    resolvePick(o);
  } else {
    select(o);
  }
});
$('outliner').addEventListener('dblclick', (e) => {
  const li = e.target.closest('li');
  const o = li && world.children.find((c) => c.uuid === li.dataset.id);
  if (o) focusOn(o);
});

/* ---------- propriedades ---------- */
$('presets').innerHTML = PALETTE.map((c) => `<button type="button" style="background:${c}" data-color="${c}" title="${c}"></button>`).join('');

const f = (id) => $(id);
function meshesOf(o) { const out = []; o.traverse((m) => { if (m.isMesh) out.push(m); }); return out; }
function materialsOf(o) { return meshesOf(o).flatMap((m) => [].concat(m.material)).filter((m) => m.color); }
function baseSize(o) {
  if (!o.isMesh) return null;
  if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
  const s = o.geometry.boundingBox.getSize(new THREE.Vector3());
  return s.x > 1e-6 && s.y > 1e-6 && s.z > 1e-6 ? s : null;
}
function setVal(el, v) {
  if (document.activeElement === el) return;
  el.value = typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : v;
}
const fmt = (v, step, unit) => {
  const d = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  return `${v.toFixed(d).replace('.', ',')}${unit && unit !== '×' ? (unit === '°' ? '°' : ' ' + unit) : unit === '×' ? '×' : ''}`;
};

let paramKey = '';
function renderParams(o) {
  const box = $('paramBox');
  const note = $('paramNote');
  const key = o.userData.shape;
  const def = SHAPES[key];
  if (def && o.userData.params) {
    $('shapeKind').textContent = def.label;
    note.hidden = true;
    const id = `${o.uuid}:${key}`;
    if (paramKey !== id) {
      paramKey = id;
      box.innerHTML = Object.entries(def.p).map(([k, [label, min, max, step]]) => `
        <label class="slider"><span>${label}</span>
          <input type="range" data-param="${k}" id="param-${k}" min="${min}" max="${max}" step="${step}">
          <output data-out="${k}"></output>
        </label>`).join('');
    }
    for (const [k, [, , , step, , unit]] of Object.entries(def.p)) {
      const input = box.querySelector(`[data-param="${k}"]`);
      if (document.activeElement !== input) input.value = o.userData.params[k];
      box.querySelector(`[data-out="${k}"]`).value = fmt(Number(o.userData.params[k]), step, unit);
    }
  } else {
    paramKey = '';
    box.innerHTML = '';
    note.hidden = false;
    if (!o.isMesh) {
      $('shapeKind').textContent = 'Modelo importado';
      note.textContent = 'Modelos importados podem ser movidos, girados, redimensionados e recoloridos.';
    } else {
      $('shapeKind').textContent = o.userData.shape === 'malha' ? 'Malha livre' : 'Malha importada';
      note.textContent = 'Esta peça foi deformada, esculpida ou cortada, então os controles da forma original não se aplicam mais. Continue editando nos modos Vértices e Esculpir.';
    }
  }
}
$('paramBox').addEventListener('input', (e) => {
  const k = e.target.dataset.param;
  if (!k || !selected?.userData.params) return;
  const key = selected.userData.shape;
  selected.userData.params = cleanParams(key, { ...selected.userData.params, [k]: parseFloat(e.target.value) });
  const old = selected.geometry;
  selected.geometry = buildGeometry(key, selected.userData.params, !!selected.userData.mirrorX);
  old.dispose();
  selBox.update();
  fillProps();
});
$('paramBox').addEventListener('change', (e) => { if (e.target.dataset.param) commit(); });

function fillProps() {
  const o = selected;
  $('props').hidden = !o;
  $('propsEmpty').hidden = !!o;
  if (!o || ed.mode !== 'object') return;
  setVal(f('pName'), o.name);
  setVal(f('pPx'), o.position.x); setVal(f('pPy'), o.position.y); setVal(f('pPz'), o.position.z);
  setVal(f('pRx'), o.rotation.x / DEG); setVal(f('pRy'), o.rotation.y / DEG); setVal(f('pRz'), o.rotation.z / DEG);
  const base = baseSize(o);
  $('sizeLabel').textContent = base ? 'Tamanho (m)' : 'Escala (×)';
  const s = base ? new THREE.Vector3().copy(base).multiply(o.scale) : o.scale;
  setVal(f('pSx'), s.x); setVal(f('pSy'), s.y); setVal(f('pSz'), s.z);
  renderParams(o);
  const mat = materialsOf(o)[0];
  if (mat) {
    setVal(f('pColor'), '#' + mat.color.getHexString());
    setVal(f('pMetal'), mat.metalness ?? 0); $('oMetal').value = (mat.metalness ?? 0).toFixed(2);
    setVal(f('pRough'), mat.roughness ?? 1); $('oRough').value = (mat.roughness ?? 1).toFixed(2);
    setVal(f('pOpacity'), mat.opacity); $('oOpacity').value = mat.opacity.toFixed(2);
    f('pWire').checked = !!mat.wireframe;
  }
}
const num = (id) => { const v = parseFloat(f(id).value); return Number.isFinite(v) ? v : 0; };

function applyTransform() {
  const o = selected;
  if (!o) return;
  o.position.set(num('pPx'), num('pPy'), num('pPz'));
  o.rotation.set(num('pRx') * DEG, num('pRy') * DEG, num('pRz') * DEG);
  const base = baseSize(o);
  const sx = Math.max(0.001, num('pSx')), sy = Math.max(0.001, num('pSy')), sz = Math.max(0.001, num('pSz'));
  if (base) o.scale.set(sx / base.x, sy / base.y, sz / base.z);
  else o.scale.set(sx, sy, sz);
  selBox.update();
}
function applyMaterial(patch) {
  if (!selected) return;
  materialsOf(selected).forEach((m) => {
    if (patch.color) m.color.set(patch.color);
    if (patch.metalness != null && 'metalness' in m) m.metalness = patch.metalness;
    if (patch.roughness != null && 'roughness' in m) m.roughness = patch.roughness;
    if (patch.opacity != null) { m.opacity = patch.opacity; m.transparent = patch.opacity < 1; m.depthWrite = patch.opacity >= 1; }
    if (patch.wireframe != null) m.wireframe = patch.wireframe;
    m.needsUpdate = true;
  });
}

['pPx', 'pPy', 'pPz', 'pRx', 'pRy', 'pRz', 'pSx', 'pSy', 'pSz'].forEach((id) => {
  f(id).addEventListener('input', applyTransform);
  f(id).addEventListener('change', () => { applyTransform(); commit(); fillProps(); });
});
f('pName').addEventListener('input', () => { if (selected) { selected.name = f('pName').value; renderOutliner(); } });
f('pName').addEventListener('change', commit);
f('pColor').addEventListener('input', () => { applyMaterial({ color: f('pColor').value }); renderOutliner(); });
f('pColor').addEventListener('change', commit);
[['pMetal', 'metalness', 'oMetal'], ['pRough', 'roughness', 'oRough'], ['pOpacity', 'opacity', 'oOpacity']].forEach(([id, key, out]) => {
  f(id).addEventListener('input', () => { const v = parseFloat(f(id).value); $(out).value = v.toFixed(2); applyMaterial({ [key]: v }); });
  f(id).addEventListener('change', commit);
});
f('pWire').addEventListener('change', () => { applyMaterial({ wireframe: f('pWire').checked }); commit(); });
$('presets').addEventListener('click', (e) => {
  const b = e.target.closest('[data-color]');
  if (!b || !selected) return;
  applyMaterial({ color: b.dataset.color });
  commit();
  fillProps();
  renderOutliner();
});
$('props').addEventListener('submit', (e) => { e.preventDefault(); document.activeElement?.blur(); });

/* ---------- arquivos ---------- */
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(`Arquivo gerado: ${name}`);
}
function withoutHelpers(fn) {
  const hidden = [grid, tcHelper, selBox, ...(ed.helpers || [])].filter((h) => h.visible);
  hidden.forEach((h) => (h.visible = false));
  try { return fn(); } finally { hidden.forEach((h) => (h.visible = true)); }
}
function requireObjects() {
  if (world.children.length) return true;
  toast('A cena está vazia. Adicione uma forma antes de exportar.');
  return false;
}
const commands = {
  new: () => { replaceWorld([]); toast('Cena nova. Use Ctrl+Z para voltar.'); },
  example: () => { replaceWorld(buildExample()); focusOn(null); },
  open: () => $('fileInput').click(),
  save: () => download(new Blob([history[hIndex]], { type: 'application/json' }), 'modelo3d-projeto.json'),
  glb: () => {
    if (!requireObjects()) return;
    new GLTFExporter().parse(world, (res) => download(new Blob([res], { type: 'model/gltf-binary' }), 'modelo3d.glb'),
      (err) => toast('Não foi possível exportar o GLB: ' + err.message), { binary: true, onlyVisible: true });
  },
  stl: () => {
    if (!requireObjects()) return;
    world.updateMatrixWorld(true);
    download(new Blob([new STLExporter().parse(world, { binary: true })], { type: 'model/stl' }), 'modelo3d.stl');
  },
  obj: () => {
    if (!requireObjects()) return;
    download(new Blob([new OBJExporter().parse(world)], { type: 'text/plain' }), 'modelo3d.obj');
  },
  png: () => {
    const url = withoutHelpers(() => { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); });
    fetch(url).then((r) => r.blob()).then((b) => download(b, 'modelo3d.png'));
  },
};
const fileMenu = $('fileMenu');
fileMenu.addEventListener('click', (e) => {
  const b = e.target.closest('[data-cmd]');
  if (!b) return;
  fileMenu.open = false;
  commands[b.dataset.cmd]();
});
document.addEventListener('pointerdown', (e) => { if (!fileMenu.contains(e.target)) fileMenu.open = false; });

$('fileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) importFile(file);
});

async function importFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const base = file.name.replace(/\.[^.]+$/, '');
  try {
    if (ext === 'json') {
      replaceWorld(hydrate(await file.text()));
      focusOn(null);
      toast(`Projeto aberto: ${file.name}`);
      return;
    }
    let obj;
    if (ext === 'glb' || ext === 'gltf') {
      const data = ext === 'glb' ? await file.arrayBuffer() : await file.text();
      obj = await new Promise((res, rej) => new GLTFLoader().parse(data, '', (g) => res(g.scene), rej));
    } else if (ext === 'obj') {
      obj = new OBJLoader().parse(await file.text());
      obj.traverse((m) => { if (m.isMesh) m.material = new THREE.MeshStandardMaterial({ color: '#c9ced6', roughness: 0.5 }); });
    } else if (ext === 'stl') {
      const geo = new STLLoader().parse(await file.arrayBuffer());
      geo.center();
      if (!geo.attributes.normal) geo.computeVertexNormals();
      obj = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#c9ced6', roughness: 0.5, metalness: 0.1 }));
    } else {
      toast('Formato não suportado. Use .json, .glb, .gltf, .obj ou .stl.');
      return;
    }
    // Um grupo com uma única malha vira a própria malha, para poder ser esculpido e cortado.
    const meshes = meshesOf(obj);
    if (!obj.isMesh && meshes.length === 1) {
      const only = meshes[0];
      obj.updateMatrixWorld(true);
      only.geometry = only.geometry.clone().applyMatrix4(only.matrixWorld);
      only.removeFromParent();
      only.position.set(0, 0, 0); only.rotation.set(0, 0, 0); only.scale.set(1, 1, 1);
      obj = only;
    }
    obj.name = base;
    obj.traverse((m) => { if (m.isMesh) m.castShadow = m.receiveShadow = true; });
    const size = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
    const max = Math.max(size.x, size.y, size.z);
    if (max > 20 || max < 0.05) obj.scale.multiplyScalar(2 / max);
    obj.position.set(orbit.target.x, 0, orbit.target.z);
    if (ed.mode !== 'object') setEditMode('object');
    world.add(obj);
    dropToFloor(obj);
    select(obj);
    commit();
    focusOn(obj);
    toast(`Importado: ${file.name}`);
  } catch (err) {
    console.error(err);
    toast(`Não foi possível ler ${file.name}. Arquivos .gltf com texturas externas precisam ser convertidos para .glb.`);
  }
}

['dragenter', 'dragover'].forEach((t) => view.addEventListener(t, (e) => { e.preventDefault(); $('drop').hidden = false; }));
['dragleave', 'drop'].forEach((t) => view.addEventListener(t, (e) => { e.preventDefault(); $('drop').hidden = true; }));
view.addEventListener('drop', (e) => { const file = e.dataTransfer.files[0]; if (file) importFile(file); });

let toastTimer;
function toast(msg, ms = 3400) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

/* ---------- estado compartilhado ---------- */
Object.assign(ed, {
  scene, camera, renderer, orbit, tc, world, view, raycaster,
  select, commit, toast, makeMesh, dropToFloor, focusOn, replaceWorld, markCustom,
  setRay, setBanner, setEditMode, fillProps, renderOutliner, disposeDeep, nextName,
  helpers: [],
  snapshotSize: () => history[hIndex]?.length ?? 0,
});
Object.defineProperty(ed, "selected", { get: () => selected });
window.__modelo3d = ed; // útil para depurar pelo console

initAI();

/* ---------- início ---------- */
let saved = null;
try { saved = localStorage.getItem(STORE_KEY) ?? localStorage.getItem(OLD_STORE_KEY); } catch { /* sem armazenamento */ }
let started = false;
if (saved) {
  try {
    hydrate(saved).forEach((c) => world.add(c));
    started = true;
  } catch (err) { console.warn('Cena salva ilegível, carregando o exemplo.', err); }
}
if (!started) buildExample().forEach((m) => world.add(m));
commit();
select(null);
if (world.children.length) focusOn(null);
