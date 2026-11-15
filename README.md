# Frame Animator

Editor de animação 2D vetorial (Electron), com as funções clássicas de um editor de animação quadro a quadro.

## Rodar

```bash
npm install
npm start
```

Outros comandos:

- `npm test`: testes do modelo, da timeline e do desfazer (Node, sem janela).
- `npm run smoke`: abre o Electron, salva um arquivo, abre a janela de teste e fecha sozinho.
- `npm run serve`: abre o editor no navegador em http://localhost:5178 (sem salvar em disco).

## Fase 1 (pronta)

- **Palco:** retângulo (R), oval (O), linha (N), lápis com suavização (Y); seleção (V) com clique,
  laço retangular, Shift para somar; mover, escalar pelas alças, girar fora dos cantos;
  Shift trava proporção/ângulo, Alt trabalha a partir do centro; setas movem 1 px (Shift: 10 px).
- **Vista:** zoom com Ctrl+roda, ferramenta Zoom (Z), Ajustar (Ctrl+0), 100% (Ctrl+1),
  mão (H ou segurar Espaço), área de trabalho fora do palco.
- **Timeline:** camadas (criar, apagar, renomear com duplo clique, arrastar para reordenar,
  ocultar, travar, contorno), quadros e keyframes (F5, Shift+F5, F6, F7, Shift+F6),
  reprodução com loop (Enter), navegação (`,` `.` Home End).
- **Onion skin:** cores antes/depois, alcance ajustável, modo contorno (Alt+Shift+O).
- **Arquivo:** novo, abrir, salvar, salvar como (`.fanim`, JSON), aviso de alterações não salvas.
- **Desfazer/refazer** ilimitado para todas as edições (Ctrl+Z, Ctrl+Y).
- **Editar:** copiar, recortar, colar, colar no lugar, duplicar, apagar, organizar frente/trás.
- **Testar cena** (Ctrl+Enter): janela separada que usa só o player.

## Arquitetura

```
src/
  player/     motor compartilhado: desenha o documento e toca a animação (sem nada do editor)
  model/      documento JSON, operações puras de timeline, geometria
  editor/     estado, comandos (desfazer), palco, ferramentas, timeline e painéis
  app.js      liga tudo
  preview.*   janela de teste (só player), base do futuro export HTML5
main.cjs      processo principal: janela, menu, diálogos de arquivo
preload.cjs   ponte segura entre a interface e o sistema
```

- **Player separado do editor:** `src/player` não importa nada do editor, então pode ir junto no export.
- **Modelo:** documento → cenas → camadas → trechos (keyframe + duração) → elementos (formas com
  matriz e caminho Bézier). Tudo JSON.
- **Comandos:** toda edição passa por um objeto com `do`/`undo` (`src/editor/commands.js`).
- **Renderização:** Canvas 2D próprio, sem dependências. O Paper.js entra na Fase 3 só para a
  geometria pesada (booleanos), sem virar o renderer.
- **Atalhos:** todos num lugar só (`src/editor/actions.js`), usados pelo teclado, menu e botões.
