import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const DEG = Math.PI / 180;

// Tudo vira BufferGeometry simples: assim a malha pode ser deformada, esculpida ou cortada
// e continua sendo salva corretamente (os parâmetros ficam em mesh.userData.params).
function plain(g) {
  const b = new THREE.BufferGeometry().copy(g);
  g.dispose();
  // Centraliza pela caixa envolvente: a posição de toda peça é o centro dela.
  b.computeBoundingBox();
  const c = b.boundingBox.getCenter(new THREE.Vector3());
  if (c.lengthSq() > 1e-12) b.translate(-c.x, -c.y, -c.z);
  b.computeBoundingBox();
  b.computeBoundingSphere();
  return b;
}

function extrude(shape, depth, bevel = 0) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 24,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">${d}</svg>`;

// p: { chave: [rótulo, mín, máx, passo, padrão, unidade] }
export const SHAPES = {
  cubo: {
    label: 'Cubo',
    icon: I('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>'),
    about: 'caixa 1×1×1; "cantos" arredonda as arestas',
    p: { cantos: ['Cantos arredondados', 0, 0.5, 0.01, 0, 'm'], divisoes: ['Subdivisões', 1, 16, 1, 1, ''] },
    build: (p) => (p.cantos > 0
      ? new RoundedBoxGeometry(1, 1, 1, Math.max(2, p.divisoes * 2), Math.min(p.cantos, 0.5))
      : new THREE.BoxGeometry(1, 1, 1, p.divisoes, p.divisoes, p.divisoes)),
  },
  esfera: {
    label: 'Esfera',
    icon: I('<circle cx="12" cy="12" r="8.5"/><ellipse cx="12" cy="12" rx="8.5" ry="3"/>'),
    about: 'esfera; "abertura" corta em gomos, "cobertura" corta de cima para baixo',
    p: { detalhe: ['Detalhe', 6, 96, 1, 40, ''], abertura: ['Abertura', 10, 360, 1, 360, '°'], cobertura: ['Cobertura', 10, 180, 1, 180, '°'] },
    build: (p) => new THREE.SphereGeometry(0.5, p.detalhe, Math.max(4, Math.round(p.detalhe * 0.66)), 0, p.abertura * DEG, 0, p.cobertura * DEG),
  },
  cilindro: {
    label: 'Cilindro',
    icon: I('<ellipse cx="12" cy="6" rx="7" ry="2.6"/><path d="M5 6v12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6"/>'),
    about: 'cilindro em pé no eixo Y; raios relativos permitem troncos de cone',
    p: { topo: ['Raio do topo', 0, 1, 0.01, 1, '×'], base: ['Raio da base', 0, 1, 0.01, 1, '×'], lados: ['Lados', 3, 96, 1, 48, ''], abertura: ['Abertura', 10, 360, 1, 360, '°'] },
    build: (p) => new THREE.CylinderGeometry(p.topo * 0.5, p.base * 0.5, 1, p.lados, 1, false, 0, p.abertura * DEG),
  },
  cone: {
    label: 'Cone',
    icon: I('<path d="M12 3L5 18M12 3l7 15"/><path d="M5 18c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6"/>'),
    about: 'cone em pé no eixo Y, ponta para cima',
    p: { ponta: ['Largura da ponta', 0, 1, 0.01, 0, '×'], lados: ['Lados', 3, 96, 1, 48, ''] },
    build: (p) => new THREE.CylinderGeometry(p.ponta * 0.5, 0.5, 1, p.lados),
  },
  piramide: {
    label: 'Pirâmide',
    icon: I('<path d="M12 3L3.5 17 12 21l8.5-4z"/><path d="M12 3v18"/>'),
    about: 'pirâmide em pé no eixo Y, ponta para cima',
    p: { lados: ['Lados da base', 3, 12, 1, 4, ''], ponta: ['Largura da ponta', 0, 1, 0.01, 0, '×'] },
    build: (p) => new THREE.CylinderGeometry(p.ponta * 0.7, 0.7, 1, p.lados),
  },
  prisma: {
    label: 'Prisma',
    icon: I('<path d="M7.5 3.5h9L20 6l-3.5 2.5h-9L4 6z"/><path d="M4 6v12l3.5 2.5h9L20 18V6M7.5 8.5v12M16.5 8.5v12"/>'),
    about: 'prisma em pé no eixo Y (lápis, porca, coluna facetada)',
    p: { lados: ['Lados', 3, 12, 1, 6, ''] },
    build: (p) => new THREE.CylinderGeometry(0.5, 0.5, 1, p.lados),
  },
  toro: {
    label: 'Toro',
    icon: I('<ellipse cx="12" cy="12" rx="9" ry="5.5"/><path d="M8 11.5c2.2 1.6 5.8 1.6 8 0M9 12.6c1.8-1 4.2-1 6 0"/>'),
    about: 'argola no plano XY (furo voltado para +Z); gire 90° em X para deitar',
    p: { espessura: ['Espessura', 0.02, 0.45, 0.01, 0.15, 'm'], abertura: ['Abertura', 10, 360, 1, 360, '°'], lados: ['Detalhe', 8, 128, 1, 64, ''] },
    build: (p) => new THREE.TorusGeometry(0.4, p.espessura, 24, p.lados, p.abertura * DEG),
  },
  arco: {
    label: 'Arco',
    icon: I('<path d="M3.5 19V13a8.5 8.5 0 0117 0v6"/><path d="M7.5 19V13a4.5 4.5 0 019 0v6"/><path d="M3.5 19h4M16.5 19h4"/>'),
    about: 'meia argola em pé no plano XY, abertura para baixo (alças, pontes, arcos)',
    p: { espessura: ['Espessura', 0.02, 0.4, 0.01, 0.12, 'm'], abertura: ['Abertura', 10, 360, 1, 180, '°'] },
    build: (p) => new THREE.TorusGeometry(0.5, p.espessura, 20, 48, p.abertura * DEG),
  },
  capsula: {
    label: 'Cápsula',
    icon: I('<rect x="7" y="2.5" width="10" height="19" rx="5"/><path d="M7 12h10"/>'),
    about: 'cápsula em pé no eixo Y (membros, dedos, pílulas)',
    p: { comprimento: ['Parte reta', 0, 3, 0.01, 0.6, 'm'], lados: ['Lados', 6, 64, 1, 32, ''] },
    build: (p) => new THREE.CapsuleGeometry(0.3, p.comprimento, 12, p.lados),
  },
  cupula: {
    label: 'Cúpula',
    icon: I('<path d="M3.5 17a8.5 8.5 0 0117 0"/><ellipse cx="12" cy="17" rx="8.5" ry="2.8"/>'),
    about: 'meia esfera com a base plana embaixo',
    p: { cobertura: ['Cobertura', 10, 180, 1, 90, '°'], detalhe: ['Detalhe', 6, 96, 1, 48, ''] },
    build: (p) => new THREE.SphereGeometry(0.5, p.detalhe, Math.max(4, Math.round(p.detalhe / 2)), 0, Math.PI * 2, 0, p.cobertura * DEG),
  },
  tubo: {
    label: 'Tubo',
    icon: I('<ellipse cx="12" cy="6" rx="7" ry="2.6"/><ellipse cx="12" cy="6" rx="3.5" ry="1.2"/><path d="M5 6v12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6"/>'),
    about: 'cano oco em pé no eixo Y (copos, canos, anéis grossos)',
    p: { parede: ['Parede', 0.01, 0.49, 0.01, 0.18, 'm'], lados: ['Lados', 3, 96, 1, 48, ''] },
    build: (p) => {
      const r = 0.5 - p.parede;
      const prof = [[r, -0.5], [0.5, -0.5], [0.5, 0.5], [r, 0.5], [r, -0.5]].map(([x, y]) => new THREE.Vector2(x, y));
      return new THREE.LatheGeometry(prof, p.lados);
    },
  },
  placa: {
    label: 'Placa',
    icon: I('<path d="M3 13l7-4.5h11L14 13z"/><path d="M3 13v2h11l7-4.5v-2M14 13v2"/>'),
    about: 'chapa fina deitada (tampos, paredes, telas)',
    p: { espessura: ['Espessura', 0.005, 0.5, 0.005, 0.05, 'm'], cantos: ['Cantos arredondados', 0, 0.25, 0.005, 0, 'm'] },
    build: (p) => (p.cantos > 0
      ? new RoundedBoxGeometry(1, p.espessura, 1, 4, Math.min(p.cantos, p.espessura / 2))
      : new THREE.BoxGeometry(1, p.espessura, 1)),
  },
  cunha: {
    label: 'Cunha',
    icon: I('<path d="M4 19V8l9 4v7zM4 8l7-4 9 8-7 0M13 19l7-7"/>'),
    about: 'rampa: perfil triangular no plano XY (lado alto em -X), estendido ao longo de Z',
    p: { topo: ['Largura do topo', 0, 0.95, 0.01, 0, '×'] },
    build: (p) => {
      const s = new THREE.Shape();
      s.moveTo(-0.5, -0.5); s.lineTo(0.5, -0.5);
      if (p.topo > 0.001) s.lineTo(-0.5 + p.topo, 0.5);
      s.lineTo(-0.5, 0.5); s.closePath();
      return extrude(s, 1);
    },
  },
  estrela: {
    label: 'Estrela',
    icon: I('<path d="M12 3l2.6 5.6 6.1.6-4.6 4.1 1.3 6-5.4-3.1-5.4 3.1 1.3-6-4.6-4.1 6.1-.6z"/>'),
    about: 'estrela em pé no plano XY, espessura ao longo de Z',
    p: { pontas: ['Pontas', 3, 16, 1, 5, ''], interno: ['Raio interno', 0.1, 0.95, 0.01, 0.44, '×'], espessura: ['Espessura', 0.02, 1, 0.01, 0.2, 'm'], bisel: ['Bisel', 0, 0.08, 0.005, 0, 'm'] },
    build: (p) => {
      const s = new THREE.Shape();
      const n = p.pontas * 2;
      for (let i = 0; i < n; i++) {
        const r = i % 2 ? 0.5 * p.interno : 0.5;
        const a = (i / n) * Math.PI * 2 + Math.PI / 2;
        i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      s.closePath();
      return extrude(s, p.espessura, p.bisel);
    },
  },
  icosaedro: {
    label: 'Icosaedro',
    icon: I('<path d="M12 2.5l8.5 5v9L12 21.5l-8.5-5v-9z"/><path d="M12 7.5l5 8.2H7zM12 2.5v5M3.5 7.5L12 7.5l8.5 0M7 15.7l-3.5.8M17 15.7l3.5.8M7 15.7L12 21.5l5-5.8"/>'),
    about: 'poliedro facetado (pedras, gemas, low-poly); detalhe alto vira esfera facetada',
    p: { detalhe: ['Detalhe', 0, 5, 1, 0, ''] },
    build: (p) => new THREE.IcosahedronGeometry(0.55, p.detalhe),
  },
};

export function defaultParams(key) {
  const out = {};
  for (const [k, d] of Object.entries(SHAPES[key].p)) out[k] = d[4];
  return out;
}

export function cleanParams(key, given = {}) {
  const out = defaultParams(key);
  for (const [k, d] of Object.entries(SHAPES[key].p)) {
    const v = Number(given[k]);
    if (!Number.isFinite(v)) continue;
    const [, min, max, step] = d;
    let c = Math.min(max, Math.max(min, v));
    if (step >= 1) c = Math.round(c);
    out[k] = c;
  }
  return out;
}

// mirror: a peça foi espelhada em X (Espelhar X), então a malha é refletida.
export function buildGeometry(key, params, mirror = false) {
  const g = plain(SHAPES[key].build(cleanParams(key, params)));
  if (mirror) {
    g.scale(-1, 1, 1);
    flipWinding(g);
    g.computeVertexNormals();
    g.computeBoundingBox();
  }
  return g;
}

// Inverte a ordem dos vértices de cada triângulo (necessário depois de refletir uma malha).
export function flipWinding(g) {
  if (g.index) {
    const a = g.index.array;
    for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
    g.index.needsUpdate = true;
    return;
  }
  for (const attr of Object.values(g.attributes)) {
    const s = attr.itemSize, arr = attr.array;
    for (let i = 0; i + 2 < attr.count; i += 3) {
      for (let k = 0; k < s; k++) {
        const t = arr[(i + 1) * s + k];
        arr[(i + 1) * s + k] = arr[(i + 2) * s + k];
        arr[(i + 2) * s + k] = t;
      }
    }
    attr.needsUpdate = true;
  }
}
