import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { ed } from './state.js';

// Modo Esculpir: pincel que desloca os vértices perto do cursor. Na primeira pincelada a malha é
// soldada (vértices compartilhados) e subdividida até ter detalhe suficiente para esculpir.

const $ = (id) => document.getElementById(id);
const MIN_TRIS = 24000;
const MAX_TRIS = 400000;

let mesh = null;
let prepared = false;
let neighbors = null;   // CSR: offsets + lista
let bvh = null;         // módulo three-mesh-bvh, carregado sob demanda
let brush = 'draw';
let stroking = false;
let lastDab = null;
let shift = false;
let cursor = null;
let pending = null;

const canvas = () => ed.renderer.domElement;

/* ---------- preparação da malha ---------- */
function triCount(g) { return (g.index ? g.index.count : g.attributes.position.count) / 3; }

function subdivide(g) {
  const src = g.attributes.position.array;
  const P = Array.from(src);
  const idx = g.index.array;
  const mids = new Map();
  const out = new Uint32Array(idx.length * 4);
  const mid = (a, b) => {
    const k = a < b ? a * 4194304 + b : b * 4194304 + a;
    let m = mids.get(k);
    if (m === undefined) {
      m = P.length / 3;
      P.push((P[a * 3] + P[b * 3]) / 2, (P[a * 3 + 1] + P[b * 3 + 1]) / 2, (P[a * 3 + 2] + P[b * 3 + 2]) / 2);
      mids.set(k, m);
    }
    return m;
  };
  let o = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    out.set([a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca], o);
    o += 12;
  }
  const r = new THREE.BufferGeometry();
  r.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  r.setIndex(new THREE.BufferAttribute(out, 1));
  return r;
}

function buildNeighbors(g) {
  const n = g.attributes.position.count;
  const idx = g.index.array;
  const sets = Array.from({ length: n }, () => []);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    sets[a].push(b, c); sets[b].push(a, c); sets[c].push(a, b);
  }
  const offsets = new Uint32Array(n + 1);
  let total = 0;
  for (let i = 0; i < n; i++) { sets[i] = [...new Set(sets[i])]; offsets[i] = total; total += sets[i].length; }
  offsets[n] = total;
  const list = new Uint32Array(total);
  for (let i = 0; i < n; i++) list.set(sets[i], offsets[i]);
  neighbors = { offsets, list };
}

function weld(g, minTris) {
  let w = g.clone();
  for (const k of Object.keys(w.attributes)) if (k !== 'position') w.deleteAttribute(k);
  w = mergeVertices(w, 1e-4);
  while (triCount(w) < minTris && triCount(w) * 4 <= MAX_TRIS) {
    const s = subdivide(w);
    w.dispose();
    w = s;
  }
  w.computeVertexNormals();
  w.computeBoundingBox();
  w.computeBoundingSphere();
  return w;
}

async function ensureBVH() {
  if (!bvh) {
    bvh = await import('three-mesh-bvh');
  }
  if (!mesh.geometry.boundsTree) mesh.geometry.boundsTree = new bvh.MeshBVH(mesh.geometry);
  mesh.raycast = bvh.acceleratedRaycast;
}

async function prepare() {
  if (prepared) return;
  const g = weld(mesh.geometry, MIN_TRIS);
  mesh.geometry.dispose();
  mesh.geometry = g;
  buildNeighbors(g);
  await ensureBVH();
  ed.markCustom(mesh);
  prepared = true;
  updateInfo();
}

function updateInfo() {
  $('sTris').textContent = `${Math.round(triCount(mesh.geometry)).toLocaleString('pt-BR')} triângulos`;
}

/* ---------- pincel ---------- */
const tmp = new THREE.Vector3();
const hitLocal = new THREE.Vector3();
const nLocal = new THREE.Vector3();

function radiusLocal() {
  const s = mesh.scale;
  const avg = (Math.abs(s.x) + Math.abs(s.y) + Math.abs(s.z)) / 3 || 1;
  return parseFloat($('sRadius').value) / avg;
}

function dab(center, normal, invert) {
  const g = mesh.geometry;
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const arr = pos.array;
  const r = radiusLocal();
  const r2 = r * r;
  const strength = parseFloat($('sStrength').value);
  const sign = invert ? -1 : 1;
  const amount = r * 0.12 * strength;
  const touched = [];
  const cx = center.x, cy = center.y, cz = center.z;

  for (let i = 0; i < pos.count; i++) {
    const dx = arr[i * 3] - cx, dy = arr[i * 3 + 1] - cy, dz = arr[i * 3 + 2] - cz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= r2) continue;
    const t = 1 - Math.sqrt(d2) / r;
    touched.push(i, t * t * (3 - 2 * t));
  }
  if (!touched.length) return;

  if (brush === 'smooth') {
    const next = new Float32Array(touched.length / 2 * 3);
    for (let k = 0; k < touched.length; k += 2) {
      const i = touched[k];
      const { offsets, list } = neighbors;
      let sx = 0, sy = 0, sz = 0;
      const n = offsets[i + 1] - offsets[i];
      for (let j = offsets[i]; j < offsets[i + 1]; j++) { const v = list[j]; sx += arr[v * 3]; sy += arr[v * 3 + 1]; sz += arr[v * 3 + 2]; }
      const w = Math.min(1, touched[k + 1] * strength * 1.4);
      next[k / 2 * 3] = arr[i * 3] + (sx / n - arr[i * 3]) * w;
      next[k / 2 * 3 + 1] = arr[i * 3 + 1] + (sy / n - arr[i * 3 + 1]) * w;
      next[k / 2 * 3 + 2] = arr[i * 3 + 2] + (sz / n - arr[i * 3 + 2]) * w;
    }
    for (let k = 0; k < touched.length; k += 2) {
      const i = touched[k];
      arr[i * 3] = next[k / 2 * 3]; arr[i * 3 + 1] = next[k / 2 * 3 + 1]; arr[i * 3 + 2] = next[k / 2 * 3 + 2];
    }
  } else {
    for (let k = 0; k < touched.length; k += 2) {
      const i = touched[k], w = touched[k + 1];
      let x = arr[i * 3], y = arr[i * 3 + 1], z = arr[i * 3 + 2];
      switch (brush) {
        case 'draw':
          x += normal.x * amount * w * sign; y += normal.y * amount * w * sign; z += normal.z * amount * w * sign;
          break;
        case 'dig':
          x -= normal.x * amount * w * sign; y -= normal.y * amount * w * sign; z -= normal.z * amount * w * sign;
          break;
        case 'inflate':
          x += nor.getX(i) * amount * w * sign; y += nor.getY(i) * amount * w * sign; z += nor.getZ(i) * amount * w * sign;
          break;
        case 'flatten': {
          const d = (x - cx) * normal.x + (y - cy) * normal.y + (z - cz) * normal.z;
          const f = Math.min(1, w * strength * 0.8);
          x -= normal.x * d * f; y -= normal.y * d * f; z -= normal.z * d * f;
          break;
        }
        case 'pinch': {
          const f = Math.min(0.5, w * strength * 0.25) * sign;
          x += (cx - x) * f; y += (cy - y) * f; z += (cz - z) * f;
          break;
        }
      }
      arr[i * 3] = x; arr[i * 3 + 1] = y; arr[i * 3 + 2] = z;
    }
  }
}

function applyDab(hit, invert) {
  mesh.worldToLocal(hitLocal.copy(hit.point));
  nLocal.copy(hit.face.normal).normalize();
  dab(hitLocal, nLocal, invert);
  if ($('sMirror').checked && Math.abs(hitLocal.x) > radiusLocal() * 0.05) {
    dab(tmp.set(-hitLocal.x, hitLocal.y, hitLocal.z), new THREE.Vector3(-nLocal.x, nLocal.y, nLocal.z), invert);
  }
  const g = mesh.geometry;
  g.attributes.position.needsUpdate = true;
  g.computeVertexNormals();
  g.boundsTree?.refit();
}

function raycast(e) {
  const rc = ed.setRay(e);
  const hits = rc.intersectObject(mesh, false);
  return hits[0] || null;
}

function onDown(e) {
  if (e.button !== 0) return;
  const hit = raycast(e);
  if (!hit) return;             // fora da peça: a câmera gira normalmente
  e.stopImmediatePropagation();
  ed.orbit.enabled = false;
  stroking = true;
  canvas().setPointerCapture(e.pointerId);
  prepare().then(() => {
    const h = raycast(e);
    if (h && stroking) { applyDab(h, e.shiftKey); lastDab = h.point.clone(); }
  });
}

function onMove(e) {
  shift = e.shiftKey;
  pending = e;
}

function frame() {
  if (!mesh) return;
  const e = pending;
  pending = null;
  if (e) {
    const hit = raycast(e);
    moveCursor(hit);
    if (stroking && prepared && hit) {
      const spacing = parseFloat($('sRadius').value) * 0.25;
      if (!lastDab || hit.point.distanceTo(lastDab) >= spacing) {
        applyDab(hit, e.shiftKey);
        lastDab = hit.point.clone();
      }
    }
  }
}

function onUp(e) {
  if (!stroking) return;
  stroking = false;
  lastDab = null;
  ed.orbit.enabled = true;
  try { canvas().releasePointerCapture(e.pointerId); } catch { /* já liberado */ }
  if (prepared) {
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
    ed.commit();
  }
}

function moveCursor(hit) {
  if (!hit) { cursor.visible = false; return; }
  cursor.visible = true;
  cursor.position.copy(hit.point);
  const n = hit.face.normal.clone().transformDirection(mesh.matrixWorld);
  cursor.lookAt(hit.point.clone().add(n));
  const r = parseFloat($('sRadius').value);
  cursor.scale.setScalar(r);
  cursor.material.color.set(shift ? 0x3e7bfa : 0xf2a33a);
}

/* ---------- entrar e sair ---------- */
export function enter(m) {
  mesh = m;
  prepared = false;
  neighbors = null;
  if (mesh.geometry.type !== 'BufferGeometry') {
    const g = new THREE.BufferGeometry().copy(mesh.geometry);
    mesh.geometry.dispose();
    mesh.geometry = g;
  }
  // Uma malha já soldada e densa pode ser esculpida sem preparação.
  if (mesh.geometry.index && !mesh.geometry.attributes.uv && triCount(mesh.geometry) >= MIN_TRIS / 4) {
    buildNeighbors(mesh.geometry);
    ensureBVH().then(() => { prepared = true; });
  }
  const ring = new THREE.RingGeometry(0.94, 1, 48);
  cursor = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0xf2a33a, depthTest: false, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
  cursor.renderOrder = 12;
  cursor.visible = false;
  ed.scene.add(cursor);
  ed.helpers.push(cursor);
  ed.frameHooks.push(frame);
  canvas().addEventListener('pointerdown', onDown, { capture: true });
  canvas().addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  $('sName').textContent = mesh.name;
  updateInfo();
}

export function exit() {
  canvas().removeEventListener('pointerdown', onDown, { capture: true });
  canvas().removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  ed.frameHooks.splice(ed.frameHooks.indexOf(frame), 1);
  ed.scene.remove(cursor);
  ed.helpers.splice(ed.helpers.indexOf(cursor), 1);
  cursor.geometry.dispose();
  cursor.material.dispose();
  cursor = null;
  if (mesh) {
    mesh.geometry.boundsTree = undefined;
    mesh.raycast = THREE.Mesh.prototype.raycast;
  }
  mesh = null;
  stroking = false;
  ed.orbit.enabled = true;
}

/* ---------- controles do painel ---------- */
document.getElementById('brushes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-brush]');
  if (!b) return;
  brush = b.dataset.brush;
  document.querySelectorAll('[data-brush]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
});
const showRange = (id, out, unit) => {
  const upd = () => { $(out).value = `${Number($(id).value).toFixed(2).replace('.', ',')}${unit}`; };
  $(id).addEventListener('input', upd);
  upd();
};
showRange('sRadius', 'oSRadius', ' m');
showRange('sStrength', 'oSStrength', '');
window.addEventListener('keydown', (e) => { if (e.key === 'Shift') shift = true; });
window.addEventListener('keyup', (e) => { if (e.key === 'Shift') shift = false; });

$('sDetail').addEventListener('click', async () => {
  if (!mesh) return;
  if (!prepared) await prepare();
  if (triCount(mesh.geometry) * 4 > MAX_TRIS) {
    ed.toast('A malha já está no detalhe máximo.');
    return;
  }
  const g = subdivide(mesh.geometry);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  mesh.geometry.dispose();
  mesh.geometry = g;
  buildNeighbors(g);
  mesh.geometry.boundsTree = new bvh.MeshBVH(g);
  updateInfo();
  ed.commit();
});
