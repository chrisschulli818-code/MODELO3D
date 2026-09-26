import * as THREE from 'three';
import { ed } from './state.js';

// Cortar e unir (operações booleanas) com three-bvh-csg, carregado só quando é usado.
let lib = null;

function brushFrom(mesh, Brush) {
  let g = mesh.geometry.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  g.clearGroups();
  const b = new Brush(g);
  mesh.updateMatrixWorld(true);
  mesh.matrixWorld.decompose(b.position, b.quaternion, b.scale);
  b.updateMatrixWorld(true);
  return b;
}

// Aplica a operação em `target` usando `tool`. Retorna true se deu certo.
export async function runBoolean(target, tool, op, keepTool = false, { commit = true } = {}) {
  if (!target.isMesh || !tool.isMesh) {
    ed.toast('Cortar e unir só funciona entre peças simples, não com modelos importados em grupo.');
    return false;
  }
  try {
    if (!lib) {
      ed.toast('Carregando a ferramenta de corte…', 1500);
      lib = await import('three-bvh-csg');
    }
    const { Brush, Evaluator, SUBTRACTION, ADDITION, INTERSECTION } = lib;
    const ev = new Evaluator();
    ev.attributes = ['position', 'normal'];
    ev.useGroups = false;
    const a = brushFrom(target, Brush);
    const b = brushFrom(tool, Brush);
    const operation = op === 'subtract' ? SUBTRACTION : op === 'union' ? ADDITION : INTERSECTION;
    const result = ev.evaluate(a, b, operation);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', result.geometry.attributes.position.clone());
    g.setAttribute('normal', result.geometry.attributes.normal.clone());
    if (result.geometry.index) g.setIndex(result.geometry.index.clone());
    if (!g.attributes.position.count) {
      ed.toast(op === 'intersect' ? 'As peças não se sobrepõem, então a interseção ficaria vazia.' : 'O resultado ficou vazio.');
      return false;
    }
    g.computeBoundingBox();
    g.computeBoundingSphere();
    target.geometry.dispose();
    target.geometry = g;
    ed.markCustom(target);
    if (!keepTool) {
      tool.removeFromParent();
      ed.disposeDeep(tool);
    }
    if (commit) {
      ed.select(target);
      ed.commit();
    }
    return true;
  } catch (err) {
    console.error(err);
    ed.toast('Não foi possível combinar essas peças. Tente peças que se sobreponham de forma mais clara.');
    return false;
  }
}
