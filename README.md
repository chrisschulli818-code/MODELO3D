# Modelo3D

Editor 3D que roda direto no navegador. Monte qualquer objeto combinando formas básicas, ajuste cor e material e exporte para impressão 3D, jogos ou outros programas.

**Site:** https://chrisschulli818-code.github.io/MODELO3D/

## O que dá para fazer

- **15 formas prontas:** cubo, esfera, cilindro, cone, pirâmide, prisma, toro, arco, cápsula, cúpula, tubo, placa, cunha, estrela e icosaedro.
- **Mover, girar e redimensionar** com as setas na tela ou digitando valores exatos em metros e graus.
- **Encaixe na grade** de 0,25 m e 15° (liga e desliga com `G`).
- **Espelhar em X** para peças simétricas (braços, olhos, rodas).
- **Material:** cor, metálico, aspereza, opacidade e modo arame.
- **Desfazer e refazer** ilimitados na sessão, e a cena fica salva no navegador.
- **Importar** modelos `.glb`, `.gltf`, `.obj` e `.stl` (também arrastando o arquivo para a tela).
- **Exportar** `.glb`, `.stl` (impressão 3D), `.obj`, imagem `.png` e o projeto em `.json` para continuar depois.

## Atalhos

| Tecla | Ação |
| --- | --- |
| `W` / `E` / `R` | Mover / girar / tamanho |
| `Ctrl+D` | Duplicar |
| `M` | Espelhar em X |
| `F` | Focar no objeto |
| `Del` | Excluir |
| `Ctrl+Z` / `Ctrl+Y` | Desfazer / refazer |
| `G` | Liga/desliga a grade |
| `Esc` | Tirar a seleção |

Na câmera: arraste para girar, botão direito para deslocar e a roda do mouse para zoom.

## Rodar no computador

É um único arquivo `index.html` sem build. Sirva a pasta com qualquer servidor estático:

```bash
python -m http.server 5173
```

e abra http://localhost:5173. Usa [three.js](https://threejs.org) 0.169 carregado do jsDelivr.
