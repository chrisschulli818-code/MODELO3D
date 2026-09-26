# Modelo3D

Editor 3D que roda direto no navegador. Monte qualquer objeto combinando formas, esculpa, fure e una peças, peça um rascunho para a IA a partir de fotos e exporte para impressão 3D, jogos ou outros programas.

**Site:** https://chrisschulli818-code.github.io/MODELO3D/

## O que dá para fazer

- **Criar com IA:** mande fotos de referência (até 6) e/ou descreva o objeto. O Claude monta um primeiro modelo com as formas do editor, já com cores, furos e peças simétricas. Também dá para pedir ajustes no modelo atual.
- **15 formas com parâmetros:** cubo (cantos arredondados), esfera e cúpula (aberturas), cilindro (raios de topo e base), cone, pirâmide e prisma (número de lados), toro e arco (espessura e abertura), cápsula, tubo (parede), placa, cunha, estrela (pontas e bisel) e icosaedro.
- **Modo Vértices (`2`):** clique nos pontos da malha e arraste. O raio suave leva os vizinhos junto e a opção de espelho mexe nos dois lados.
- **Modo Esculpir (`3`):** pincéis Puxar, Afundar, Inflar, Suavizar, Achatar e Afinar, com raio, força, espelho em X e botão para aumentar o detalhe da malha. `Shift` inverte o pincel.
- **Cortar e unir:** fure uma peça com outra, funda duas peças numa só ou mantenha só a interseção.
- **Mover, girar e redimensionar** com as setas na tela ou digitando valores exatos em metros e graus, com encaixe na grade de 0,25 m e 15°.
- **Material:** cor, metálico, aspereza, opacidade e modo arame.
- **Desfazer e refazer**, e a cena fica salva no navegador.
- **Importar** `.glb`, `.gltf`, `.obj` e `.stl`; **exportar** `.glb`, `.stl`, `.obj`, imagem `.png` e o projeto `.json`.

## Criar com IA: chave da API

A geração usa o modelo `claude-opus-5` pela API da Anthropic, chamada direto do navegador com a sua própria chave:

1. Crie uma chave em [console.anthropic.com](https://console.anthropic.com) e adicione créditos.
2. No site, clique em **Criar com IA**, abra **Chave da API da Anthropic** e cole a chave.
3. Marque **Lembrar a chave neste navegador** se não quiser colar de novo.

A chave só vai do seu navegador para `api.anthropic.com`. Cada geração costuma custar entre US$ 0,05 e US$ 0,40. Os pedidos usam o `fallbacks: "default"` da API: se um filtro de segurança recusar o pedido por engano, ele é refeito automaticamente em outro modelo.

## Atalhos

| Tecla | Ação |
| --- | --- |
| `1` / `2` / `3` | Modo Objeto / Vértices / Esculpir |
| `W` / `E` / `R` | Mover / girar / tamanho |
| `Ctrl+D` | Duplicar |
| `M` | Espelhar em X |
| `F` | Focar na peça |
| `Del` | Excluir |
| `Ctrl+Z` / `Ctrl+Y` | Desfazer / refazer |
| `G` | Liga/desliga a grade |
| `Esc` | Sair do modo / cancelar / tirar a seleção |

Na câmera: arraste para girar, botão direito para deslocar e a roda do mouse para zoom.

## Rodar no computador

Não tem build. Sirva a pasta com qualquer servidor estático (módulos ES não abrem direto do disco):

```bash
python -m http.server 5173
```

e abra http://localhost:5173.

## Código

| Arquivo | Conteúdo |
| --- | --- |
| `index.html` | Interface e import map das bibliotecas |
| `src/editor.js` | Cena, seleção, histórico, propriedades, arquivos |
| `src/shapes.js` | As 15 formas e seus parâmetros |
| `src/vertex.js` | Modo Vértices |
| `src/sculpt.js` | Modo Esculpir |
| `src/csg.js` | Cortar e unir (three-bvh-csg) |
| `src/ai.js` | Criar com IA (SDK da Anthropic) |

Bibliotecas carregadas do jsDelivr: [three.js](https://threejs.org) 0.186, three-mesh-bvh 0.9, three-bvh-csg 0.0.18 e `@anthropic-ai/sdk` 0.128.
