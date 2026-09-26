// Estado compartilhado entre os módulos do editor. É preenchido por editor.js na inicialização.
export const ed = {
  mode: 'object',
  pendingPick: null,
  frameHooks: [],
};
