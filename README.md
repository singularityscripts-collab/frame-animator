# Frame Animator

Editor de animação 2D vetorial (Electron), com as funções clássicas de um editor de animação quadro a quadro.

## Rodar

```bash
npm install
npm start
```

Outros comandos:

- `npm test`: testes do modelo, da timeline e do desfazer (Node, sem janela).
- `npm run smoke`: abre o Electron, salva um arquivo, abre a janela de teste, exporta MP4/MOV/GIF/PNG,
  confere os arquivos com o ffmpeg e fecha sozinho.
- `npm run serve`: abre o editor no navegador em http://localhost:5178 (sem salvar em disco nem exportar vídeo).

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

## Fase 2 (pronta)

- **Símbolos:** converter em símbolo (F8), novo símbolo (Ctrl+F8), gráfico (loop, tocar uma vez,
  quadro único, primeiro quadro) e movie clip (toca sozinho no teste e no export).
  Duplo clique numa instância edita no lugar, com a cena desbotada atrás; duplo clique em área vazia,
  Ctrl+E ou o caminho "Cena › Símbolo" no topo do palco voltam.
- **Biblioteca** (Ctrl+L): pastas, busca, contagem de usos, prévia, arrastar para o palco,
  arrastar para pastas, renomear, duplicar, mudar o tipo e apagar (com aviso se estiver em uso).
- **Tween clássico:** clique direito num quadro → Criar tween clássico. Interpola posição, escala,
  rotação, inclinação e efeito de cor; easing de −100 a +100; rotação automática, horária ou
  anti-horária com voltas extras. F6 no meio do tween cria keyframe na pose interpolada, e mexer
  num quadro interpolado cria o keyframe sozinho.
- **Efeitos de cor** nas instâncias: brilho, tom, alfa e avançado.
- **Exportar** (Ctrl+Alt+Shift+S): MP4 (H.264), MOV (ProRes, com transparência), GIF animado e
  sequência PNG, com tamanho em %, intervalo de quadros e fundo transparente. Usa o ffmpeg embutido.
- **Histórico:** aba que lista os passos; clicar num passo volta até ele.
- Arquivos da Fase 1 abrem normalmente (são atualizados para o formato novo ao abrir).

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
- **Modelo:** documento → cenas → camadas → trechos (keyframe + duração + tween) → elementos
  (formas com matriz e caminho Bézier, ou instâncias de símbolo). A biblioteca guarda símbolos, que
  têm camadas próprias como uma cena. Tudo JSON.
- **Tween e símbolos no player:** `src/player/tween.js` calcula a interpolação; o editor, a janela
  de teste e o export usam o mesmo cálculo, então o que aparece no palco é o que sai no vídeo.
- **Comandos:** toda edição passa por um objeto com `do`/`undo` (`src/editor/commands.js`).
- **Renderização:** Canvas 2D próprio, sem dependências. O Paper.js entra na Fase 3 só para a
  geometria pesada (booleanos), sem virar o renderer.
- **Atalhos:** todos num lugar só (`src/editor/actions.js`), usados pelo teclado, menu e botões.
