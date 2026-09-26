import * as THREE from 'three';
import { ed } from './state.js';
import { SHAPES } from './shapes.js';
import { runBoolean } from './csg.js';

// "Criar com IA": envia descrição + imagens de referência ao Claude e recebe uma lista de peças
// (formas do editor com posição, tamanho, cor e parâmetros), que vira a cena.

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.128.0/+esm';
const MODEL = 'claude-opus-5';
const KEY_STORE = 'modelo3d.anthropic-key';
const MAX_IMAGES = 6;
const MAX_SIDE = 1568;

const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;
let refs = [];            // [{ url, data, type }]
let running = null;       // stream em andamento

/* ---------- formato da resposta ---------- */
const vec3 = { type: 'array', items: { type: 'number' } };
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['titulo', 'observacoes', 'pecas'],
  properties: {
    titulo: { type: 'string' },
    observacoes: { type: 'string' },
    pecas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['nome', 'forma', 'cor', 'metalico', 'aspereza', 'posicao', 'rotacao', 'tamanho', 'parametros', 'corta'],
        properties: {
          nome: { type: 'string' },
          forma: { type: 'string', enum: Object.keys(SHAPES) },
          cor: { type: 'string' },
          metalico: { type: 'number' },
          aspereza: { type: 'number' },
          posicao: vec3,
          rotacao: vec3,
          tamanho: vec3,
          parametros: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['nome', 'valor'],
              properties: { nome: { type: 'string' }, valor: { type: 'number' } },
            },
          },
          corta: { type: 'string' },
        },
      },
    },
  },
};

function shapeCatalog() {
  return Object.entries(SHAPES).map(([key, s]) => {
    const ps = Object.entries(s.p)
      .map(([k, [label, min, max, , def, unit]]) => `${k} (${label}; ${min}–${max}${unit === '°' ? '°' : unit ? ' ' + unit : ''}; default ${def})`)
      .join(', ');
    return `- ${key}: ${s.about}. Parameters: ${ps || 'none'}.`;
  }).join('\n');
}

const SYSTEM = `You are the modeling assistant inside Modelo3D, a browser 3D editor that builds models by combining parametric primitive shapes. From the user's description and/or reference images, produce the complete list of parts that recreates the object as faithfully as these primitives allow. The user will refine the result by hand afterwards, so a clean, well-proportioned, well-named blockout is worth more than excessive detail.

Coordinate system and units:
- Meters, Y is up, the ground is the plane y = 0 and the object rests on it (its lowest point at y ≈ 0).
- Center the object on x = 0, z = 0. Its front faces +Z; the object's own left side is +X.
- Use real-world scale (a mug is about 0.1 m tall, a chair about 0.9 m, a car about 4.5 m long).

Each part:
- forma: one of the shape keys below.
- posicao: center of the part's bounding box, in meters.
- tamanho: the part's dimensions along its own X, Y, Z axes before rotation, in meters. The shape is stretched to exactly this box.
- rotacao: Euler angles in degrees (three.js "XYZ" order). Prefer zero or single-axis rotations.
- parametros: optional list of {nome, valor} using only the parameter names listed for that shape; omit a parameter to keep its default.
- cor: hex color like #3a6ea5 matching the reference; metalico and aspereza from 0 to 1.
- corta: empty string for a normal part. To make a hole, opening, window or cavity, add a part whose corta is the exact nome of the part it cuts; it is subtracted from that part and then removed. A cutter must overlap the region to remove completely. Use at most 8 cutters.
- nome: short, unique name in Brazilian Portuguese (for example "Perna dianteira esquerda").

Shapes:
${shapeCatalog()}

Guidelines:
- Usually 8 to 60 parts; more only when the object truly needs it. Every clearly visible feature should be its own part.
- Parts that are physically attached must touch or overlap slightly so the model reads as one solid; avoid floating gaps that the real object doesn't have.
- For symmetric objects, list both sides explicitly: mirror the X position and negate the Y and Z rotations.
- When images are given, take proportions and colors from them and combine the views if there are several. If the description and the images disagree, follow the description.
- titulo: the object's name in Portuguese. observacoes: one or two sentences in Portuguese saying what was simplified and what is worth refining by hand.`;

/* ---------- imagens de referência ---------- */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('imagem inválida')); };
    img.src = url;
  });
}
async function addFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    if (refs.length >= MAX_IMAGES) { ed.toast(`Use no máximo ${MAX_IMAGES} imagens.`); break; }
    try {
      const { img, url } = await loadImage(file);
      const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      const g = c.getContext('2d');
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      const dataUrl = c.toDataURL('image/jpeg', 0.88);
      refs.push({ url, data: dataUrl.split(',')[1], type: 'image/jpeg' });
    } catch {
      ed.toast(`Não foi possível abrir ${file.name}.`);
    }
  }
  renderRefs();
}
function renderRefs() {
  const box = $('aiRefs');
  box.querySelectorAll('.ref').forEach((n) => n.remove());
  refs.forEach((r, i) => {
    const d = document.createElement('div');
    d.className = 'ref';
    d.innerHTML = `<img alt="Referência ${i + 1}"><button type="button" aria-label="Remover imagem"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
    d.querySelector('img').src = r.url;
    d.querySelector('button').onclick = () => { URL.revokeObjectURL(r.url); refs.splice(i, 1); renderRefs(); };
    box.insertBefore(d, $('aiAdd'));
  });
  $('aiAdd').hidden = refs.length >= MAX_IMAGES;
}

/* ---------- cena atual como ponto de partida ---------- */
const r3 = (v) => Math.round(v * 1000) / 1000;
function currentParts() {
  const editable = [];
  const fixed = [];
  for (const o of ed.world.children) {
    if (o.isMesh && SHAPES[o.userData.shape] && o.userData.params) {
      const base = o.geometry.boundingBox.getSize(new THREE.Vector3());
      const mat = [].concat(o.material)[0];
      editable.push({
        nome: o.name,
        forma: o.userData.shape,
        cor: '#' + mat.color.getHexString(),
        metalico: r3(mat.metalness ?? 0),
        aspereza: r3(mat.roughness ?? 1),
        posicao: o.position.toArray().map(r3),
        rotacao: [o.rotation.x, o.rotation.y, o.rotation.z].map((a) => r3(a / DEG)),
        tamanho: base.multiply(o.scale).toArray().map((v) => r3(Math.abs(v))),
        parametros: Object.entries(o.userData.params).map(([nome, valor]) => ({ nome, valor })),
        corta: '',
      });
    } else {
      const b = new THREE.Box3().setFromObject(o);
      fixed.push({ nome: o.name, centro: b.getCenter(new THREE.Vector3()).toArray().map(r3), tamanho: b.getSize(new THREE.Vector3()).toArray().map(r3) });
    }
  }
  return { editable, fixed };
}

/* ---------- montar a cena a partir da resposta ---------- */
const PALETTE = ['#f2a33a', '#3e7bfa', '#46a758', '#e5484d', '#a78bfa', '#3fb6a8'];
function vec(a, def, min = -Infinity) {
  const v = Array.isArray(a) ? a.slice(0, 3).map(Number) : [];
  return [0, 1, 2].map((i) => (Number.isFinite(v[i]) ? Math.max(min, v[i]) : def[i]));
}
const clamp01 = (v, d) => (Number.isFinite(Number(v)) ? Math.min(1, Math.max(0, Number(v))) : d);

export async function buildFromSpec(spec, mode) {
  if (!Array.isArray(spec.pecas) || !spec.pecas.length) throw new Error('A resposta veio sem peças.');
  const temp = new THREE.Group();
  if (mode === 'edit') {
    for (const o of [...ed.world.children]) {
      if (!(o.isMesh && SHAPES[o.userData.shape] && o.userData.params)) temp.add(o);
    }
  }
  const made = [];
  spec.pecas.forEach((p, i) => {
    const params = {};
    for (const { nome, valor } of p.parametros || []) params[nome] = valor;
    const mesh = ed.makeMesh(SHAPES[p.forma] ? p.forma : 'cubo', {
      name: String(p.nome || `Peça ${i + 1}`).slice(0, 60),
      color: /^#[0-9a-f]{6}$/i.test(p.cor) ? p.cor : PALETTE[i % PALETTE.length],
      metal: clamp01(p.metalico, 0.05),
      rough: clamp01(p.aspereza, 0.45),
      pos: vec(p.posicao, [0, 0.5, 0]),
      rot: vec(p.rotacao, [0, 0, 0]),
      size: vec(p.tamanho, [0.3, 0.3, 0.3], 0.002),
      params,
    });
    temp.add(mesh);
    made.push({ p, mesh });
  });

  const byName = new Map(made.filter((m) => !m.p.corta).map((m) => [m.mesh.name.trim().toLowerCase(), m.mesh]));
  let failed = 0;
  for (const { p, mesh } of made) {
    if (!p.corta) continue;
    const target = byName.get(String(p.corta).trim().toLowerCase());
    if (!target) { mesh.removeFromParent(); ed.disposeDeep(mesh); failed++; continue; }
    const ok = await runBoolean(target, mesh, 'subtract', false, { commit: false });
    if (!ok) { mesh.removeFromParent(); ed.disposeDeep(mesh); failed++; }
  }

  // Apoia o conjunto no chão sem mexer nas posições relativas.
  temp.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(temp);
  if (!box.isEmpty() && mode === 'new') temp.children.forEach((c) => (c.position.y -= box.min.y));

  ed.replaceWorld([...temp.children]);
  ed.focusOn(null);
  return { count: ed.world.children.length, failed };
}

/* ---------- chamada à API ---------- */
function setStatus(kind, html) {
  const s = $('aiStatus');
  s.hidden = !kind;
  s.className = 'ai-status' + (kind === 'error' ? ' error' : kind === 'ok' ? ' ok' : '');
  s.innerHTML = (kind === 'busy' ? '<span class="spin"></span>' : '') + `<div>${html}</div>`;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

function getKey() {
  const k = $('aiKey').value.trim();
  if (k) return k;
  try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; }
}
function refreshKeyState() {
  let stored = '';
  try { stored = localStorage.getItem(KEY_STORE) || ''; } catch { /* sem armazenamento */ }
  $('aiKeyState').textContent = $('aiKey').value.trim() ? 'informada' : stored ? 'lembrada neste navegador' : 'necessária';
  $('aiRemember').checked = !!stored;
}

async function generate() {
  const text = $('aiText').value.trim();
  if (!text && !refs.length) { setStatus('error', 'Descreva o objeto ou adicione pelo menos uma imagem.'); return; }
  const apiKey = getKey();
  if (!apiKey) {
    $('aiKeyBox').open = true;
    $('aiKey').focus();
    setStatus('error', 'Cole a sua chave da API da Anthropic para gerar o modelo.');
    return;
  }
  try {
    if ($('aiRemember').checked) localStorage.setItem(KEY_STORE, apiKey);
    else localStorage.removeItem(KEY_STORE);
  } catch { /* sem armazenamento */ }

  const mode = document.querySelector('input[name="aiMode"]:checked').value;
  const content = refs.map((r) => ({ type: 'image', source: { type: 'base64', media_type: r.type, data: r.data } }));
  let prompt = text ? `Object to model: ${text}` : 'Recreate the object shown in the reference images.';
  if (refs.length) prompt += `\n${refs.length} reference image(s) attached.`;
  if (mode === 'edit') {
    const { editable, fixed } = currentParts();
    prompt += `\n\nAdjust the current model instead of starting over. Return the complete updated parts list, keeping unchanged parts identical (same names and values).\nCurrent parts:\n${JSON.stringify(editable)}`;
    if (fixed.length) prompt += `\nThese sculpted or imported parts stay in the scene and cannot be changed; fit the new parts around them:\n${JSON.stringify(fixed)}`;
  }
  content.push({ type: 'text', text: prompt });

  $('aiGo').disabled = true;
  $('aiCancel').textContent = 'Cancelar';
  setStatus('busy', refs.length ? 'Analisando as referências…' : 'Planejando o modelo…');

  let Anthropic;
  try {
    ({ default: Anthropic } = await import(SDK_URL));
  } catch {
    setStatus('error', 'Não foi possível carregar a biblioteca da Anthropic. Verifique a conexão.');
    $('aiGo').disabled = false;
    return;
  }

  try {
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content }],
    });
    running = stream;
    let acc = '';
    stream.on('text', (delta) => {
      acc += delta;
      const n = (acc.match(/"forma"/g) || []).length;
      setStatus('busy', n ? `Montando as peças… ${n} até agora` : 'Montando as peças…');
    });
    const msg = await stream.finalMessage();
    running = null;

    if (msg.stop_reason === 'refusal') {
      setStatus('error', 'O pedido foi recusado pelos filtros de segurança da Anthropic. Tente descrever o objeto de outra forma.');
      return;
    }
    if (msg.stop_reason === 'max_tokens') {
      setStatus('error', 'O modelo ficou grande demais e a resposta foi cortada. Peça algo mais simples ou divida em partes.');
      return;
    }
    const json = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const spec = JSON.parse(json);
    setStatus('busy', 'Colocando as peças na cena…');
    const { count, failed } = await buildFromSpec(spec, mode);
    const extra = failed ? ` ${failed} corte(s) não puderam ser aplicados.` : '';
    setStatus('ok', `<strong>${esc(spec.titulo || 'Modelo')}</strong> pronto com ${count} peças.${extra}<br>${esc(spec.observacoes || '')}`);
    ed.toast('Modelo criado. Ajuste as peças à vontade; Ctrl+Z desfaz.');
  } catch (err) {
    running = null;
    console.error(err);
    if (err instanceof Anthropic.APIUserAbortError) setStatus(null);
    else if (err instanceof Anthropic.AuthenticationError) setStatus('error', 'A chave da API foi recusada. Confira se ela foi copiada inteira em console.anthropic.com.');
    else if (err instanceof Anthropic.PermissionDeniedError) setStatus('error', 'A chave não tem permissão para usar este modelo. Verifique a conta em console.anthropic.com.');
    else if (err instanceof Anthropic.RateLimitError) setStatus('error', 'Limite de uso atingido. Espere um minuto e tente de novo.');
    else if (err instanceof Anthropic.APIConnectionError) setStatus('error', 'Sem conexão com a Anthropic. Verifique a internet e tente de novo.');
    else if (err instanceof Anthropic.BadRequestError && /credit|billing/i.test(err.message)) setStatus('error', 'A conta da Anthropic está sem créditos. Adicione créditos em console.anthropic.com.');
    else if (err instanceof Anthropic.APIError) setStatus('error', `A Anthropic respondeu com erro ${err.status ?? ''}: ${esc(err.message)}`);
    else if (err instanceof SyntaxError) setStatus('error', 'A resposta veio num formato inesperado. Tente gerar de novo.');
    else setStatus('error', esc(err.message || 'Algo deu errado ao gerar o modelo.'));
  } finally {
    $('aiGo').disabled = false;
    $('aiCancel').textContent = 'Fechar';
  }
}

/* ---------- diálogo ---------- */
export function initAI() {
  const dlg = $('aiDialog');
  const close = () => { if (running) running.abort(); else dlg.close(); };
  $('aiOpen').addEventListener('click', () => {
    refreshKeyState();
    $('aiKeyBox').open = !getKey();
    if (!running) setStatus(null);
    dlg.showModal();
    $('aiText').focus();
  });
  $('aiClose').addEventListener('click', () => { if (running) running.abort(); dlg.close(); });
  $('aiCancel').addEventListener('click', close);
  $('aiForm').addEventListener('submit', (e) => { e.preventDefault(); if (!running) generate(); });
  $('aiKey').addEventListener('input', refreshKeyState);
  $('aiRemember').addEventListener('change', () => {
    if (!$('aiRemember').checked) { try { localStorage.removeItem(KEY_STORE); } catch { /* ignora */ } }
  });
  $('aiFiles').addEventListener('change', (e) => { addFiles([...e.target.files]); e.target.value = ''; });
  $('aiAdd').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('aiFiles').click(); } });
  const zone = $('aiRefs');
  dlg.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  dlg.addEventListener('dragleave', (e) => { if (e.target === dlg) zone.classList.remove('over'); });
  dlg.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); addFiles([...e.dataTransfer.files]); });
  dlg.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); addFiles(files); }
  });
  renderRefs();
}
