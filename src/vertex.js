import * as THREE from 'three';
import { ed } from './state.js';

// Modo Vértices: mostra um ponto por posição única da malha. Arrastar um ponto move todos os
// vértices que compartilham aquela posição (e, com raio suave, os vizinhos com intensidade menor).

const $ = (id) => document.getElementById(id);
let mesh = null;
let groups = [];        // [{ idx: number[], pos: Vector3 (local) }]
let points = null;      // pontos laranja
let marker = null;      // ponto selecionado
const handle = new THREE.Object3D();
let active = -1;
let drag = null;        // { start: Vector3 local, affected: [{ g, w, from: Vector3 }] }

const POINT_COLOR = 0xf2a33a;

function prepareGeometry(m) {
  // Parâmetros não se aplicam mais depois de mexer nos pontos; a malha passa a ser livre.
  if (m.geometry.type !== 'BufferGeometry') {
    const g = new THREE.BufferGeometry().copy(m.geometry);
    m.geometry.dispose();
    m.geometry = g;
  }
}

function buildGroups() {
  const pos = mesh.geometry.attributes.position;
  const map = new Map();
  groups = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = `${x.toFixed(4)}|${y.toFixed(4)}|${z.toFixed(4)}`;
    let g = map.get(key);
    if (!g) {
      g = { idx: [], pos: new THREE.Vector3(x, y, z) };
      map.set(key, g);
      groups.push(g);
    }
    g.idx.push(i);
  }
}

function buildPoints() {
  const arr = new Float32Array(groups.length * 3);
  groups.forEach((g, i) => g.pos.toArray(arr, i * 3));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  points = new THREE.Points(geo, new THREE.PointsMaterial({
    color: POINT_COLOR, size: groups.length > 3000 ? 5 : 8, sizeAttenuation: false,
    depthTest: false, transparent: true, opacity: 0.9,
  }));
  points.renderOrder = 10;
  points.matrixAutoUpdate = false;
  marker = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3)),
    new THREE.PointsMaterial({ color: 0xffffff, size: 13, sizeAttenuation: false, depthTest: false }));
  marker.renderOrder = 11;
  marker.matrixAutoUpdate = false;
  marker.visible = false;
  ed.scene.add(points, marker, handle);
  ed.helpers.push(points, marker);
}

function syncHelpers() {
  if (!mesh) return;
  mesh.updateMatrixWorld();
  points.matrix.copy(mesh.matrixWorld);
  marker.matrix.copy(mesh.matrixWorld);
  points.matrixWorldNeedsUpdate = marker.matrixWorldNeedsUpdate = true;
}

export function enter(m) {
  mesh = m;
  prepareGeometry(mesh);
  buildGroups();
  buildPoints();
  active = -1;
  ed.frameHooks.push(syncHelpers);
  $('vName').textContent = mesh.name;
  $('vCount').textContent = `${groups.length.toLocaleString('pt-BR')} pontos`;
  if (groups.length > 20000) ed.toast('Esta malha tem muitos pontos. Para mudanças orgânicas, o modo Esculpir funciona melhor.');
}

export function exit() {
  ed.tc.detach();
  ed.frameHooks.splice(ed.frameHooks.indexOf(syncHelpers), 1);
  for (const o of [points, marker]) {
    ed.scene.remove(o);
    o.geometry.dispose();
    o.material.dispose();
    ed.helpers.splice(ed.helpers.indexOf(o), 1);
  }
  ed.scene.remove(handle);
  points = marker = mesh = null;
  groups = [];
  drag = null;
}

// Escolhe o ponto mais próximo do clique na tela (até 14 px), preferindo o mais perto da câmera.
export function onClick(e) {
  const rect = ed.renderer.domElement.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const v = new THREE.Vector3();
  const camPos = ed.camera.position;
  let best = -1, bestScore = Infinity;
  mesh.updateMatrixWorld();
  for (let i = 0; i < groups.length; i++) {
    v.copy(groups[i].pos).applyMatrix4(mesh.matrixWorld);
    const depth = v.distanceTo(camPos);
    v.project(ed.camera);
    if (v.z > 1) continue;
    const sx = (v.x + 1) / 2 * rect.width, sy = (1 - v.y) / 2 * rect.height;
    const d = Math.hypot(sx - mx, sy - my);
    if (d > 14) continue;
    const score = d + depth * 0.5;
    if (score < bestScore) { bestScore = score; best = i; }
  }
  setActive(best);
}

function setActive(i) {
  active = i;
  if (i < 0) {
    ed.tc.detach();
    marker.visible = false;
    return;
  }
  marker.geometry.attributes.position.array.set(groups[i].pos.toArray());
  marker.geometry.attributes.position.needsUpdate = true;
  marker.visible = true;
  handle.position.copy(groups[i].pos).applyMatrix4(mesh.matrixWorld);
  handle.updateMatrixWorld();
  ed.tc.attach(handle);
}

function mirrorIndex(i) {
  const p = groups[i].pos;
  if (Math.abs(p.x) < 1e-4) return -1;
  let best = -1, bestD = 1e-3;
  for (let j = 0; j < groups.length; j++) {
    const q = groups[j].pos;
    const d = Math.abs(q.x + p.x) + Math.abs(q.y - p.y) + Math.abs(q.z - p.z);
    if (d < bestD) { bestD = d; best = j; }
  }
  return best;
}

export function onDragStart() {
  if (active < 0) return;
  const s = mesh.scale;
  const avgScale = (Math.abs(s.x) + Math.abs(s.y) + Math.abs(s.z)) / 3 || 1;
  const radius = parseFloat($('vRadius').value) / avgScale;
  const center = groups[active].pos.clone();
  const affected = [];
  const collect = (c, sign) => {
    groups.forEach((g, j) => {
      const d = g.pos.distanceTo(c);
      let w = 0;
      if (d < 1e-6) w = 1;
      else if (radius > 0 && d < radius) { const t = 1 - d / radius; w = t * t * (3 - 2 * t); }
      if (w > 0 && !affected.some((a) => a.g === j)) affected.push({ g: j, w, sign, from: g.pos.clone() });
    });
  };
  collect(center, 1);
  if ($('vMirror').checked) {
    const m = mirrorIndex(active);
    if (m >= 0) collect(groups[m].pos, -1);
  }
  drag = { start: center, affected };
}

export function onDrag() {
  if (!drag) return;
  const local = mesh.worldToLocal(handle.position.clone());
  const delta = local.sub(drag.start);
  const pos = mesh.geometry.attributes.position;
  const pts = points.geometry.attributes.position;
  for (const a of drag.affected) {
    const g = groups[a.g];
    g.pos.set(a.from.x + delta.x * a.w * a.sign, a.from.y + delta.y * a.w, a.from.z + delta.z * a.w);
    for (const i of g.idx) pos.setXYZ(i, g.pos.x, g.pos.y, g.pos.z);
    pts.setXYZ(a.g, g.pos.x, g.pos.y, g.pos.z);
  }
  pos.needsUpdate = true;
  pts.needsUpdate = true;
  marker.geometry.attributes.position.array.set(groups[active].pos.toArray());
  marker.geometry.attributes.position.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
}

export function onDragEnd() {
  if (!drag) return;
  drag = null;
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
  points.geometry.computeBoundingSphere();
  ed.markCustom(mesh);
}

$('vRadius').addEventListener('input', (e) => {
  $('oRadius').value = `${Number(e.target.value).toFixed(2).replace('.', ',')} m`;
});
