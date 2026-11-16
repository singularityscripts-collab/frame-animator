# Caça-bugs — Frame Animator (16/11/2026)

## Correções (todos os 9 bugs corrigidos)

Os testes de regressão foram para `test/bugs.test.js` e rodam no `npm test`: 70 testes passando, mais o smoke test do Electron. A prova do B1 (`npx electron bug-hunt/probe-preview.cjs`, com e sem `--navegar`) agora mostra "arquivo gravado: não" e a janela de teste continua na própria página.

- **B1:**
  - A janela de teste usa um preload próprio (`preload-preview.cjs`) que só lê o filme.
  - A navegação dessa janela é bloqueada; links abrem no navegador do sistema, e só se forem http/https.
  - Gravar sem diálogo só vale para arquivos e pastas que o usuário escolheu num diálogo ou abriu (`grant`/`isGranted` em `main.cjs`). Isso cobre salvar, exportar vídeo e exportar HTML5.
- **B2:** ao abrir, os pontos inválidos saem do caminho, e uma forma sem pontos suficientes sai do documento (`cleanPath` em `document.js`).
- **B3:** cenas, camadas e quadros nulos são descartados. Qualquer outro problema de estrutura vira "O arquivo está danificado e não deu para abrir."
- **B4:** matriz com valor que não é número volta à identidade.
- **B5:** o SVG só aceita cor `#hex`, tipo `image/*` e base64 válido. Ao abrir o arquivo, fundo e tipo de imagem também são validados.
- **B6:** forma ligada a ossos ganha "pele" (`el.skin`). Cada ponto segue uma mistura dos ossos próximos (peso 1/(distância + folga)⁴), e o caminho é subdividido para retas poderem dobrar.
  - Na ferramenta, osso dentro de uma forma liga a forma; arrastar a forma posa pelo osso mais perto; Alt+arrastar na forma cria um osso novo.
- **B7:** a cinemática inversa usa só ossos que o esqueleto consegue resolver.
- **B8:** os `DOMFrame` são ordenados por índice; um quadro que se sobrepõe ao anterior é ignorado.
- **B9:** checagem com `path.relative` (`inside()` em `main.cjs`).

Base: commit `6beed0d` no `main`, árvore limpa. Antes de começar: 61 testes e o smoke test passando.

Arquivos da caça (nada do app foi alterado):

- `bug-hunt/regressao.test.mjs`: um teste por bug, **todos falham hoje** (`node --test bug-hunt/regressao.test.mjs`).
- `bug-hunt/probe-entradas.mjs`: bateria de entradas ruins nas funções puras.
- `bug-hunt/probe-preview.cjs` + `probe-page.html`: prova do B1 no Electron (`npx electron bug-hunt/probe-preview.cjs`).

Cada bug foi reproduzido duas vezes.

---

## B1 — Script dentro do arquivo grava qualquer arquivo no disco · **Crítico**

- **Onde:** `main.cjs`, `ipcMain.on('preview:open')` (a janela de teste usa o mesmo `webPreferences` do editor, com o `preload.cjs` inteiro) e `ipcMain.handle('file:save')` (aceita `path` sem perguntar).
- **Reproduzir:**
  1. Num documento, ponha no script do quadro: `window.api.saveFile({ path: 'C:/qualquer/lugar.txt', data: '...' })`.
  2. Aperte Testar filme (Ctrl+Enter).
- **Esperado:** o script do filme só controla o filme.
- **Aconteceu:** o arquivo foi gravado sem nenhuma pergunta. Prova em `probe-preview.cjs`, rodada 2×, gravando só na pasta temporária.
- **Agravantes, também confirmados:**
  - `location.href = 'outra página'` leva a janela de teste para qualquer página, **e ela continua com `window.api`** (`PAGINA api=object`). Valeria para um site da internet.
  - `window.open`/`navigateToURL` abre a página numa janela do próprio app, em vez do navegador.
  - `exportHTML5({ dir })` também grava sem diálogo.
- **Por que é crítico:** um `.fanim` recebido de alguém, ou um `.fla` importado (o ActionScript vira script), pode gravar um `.bat` na pasta Inicializar do Windows assim que você testa o filme.
- **Causa:** a janela de teste herda a ponte completa do editor, e o IPC confia no caminho que vem da página.
- **Correção sugerida:**
  - Dar à janela de teste um preload próprio, só com `getPreviewData`.
  - Na janela de teste, `setWindowOpenHandler` → abrir no navegador com `shell.openExternal` (só http/https), e `will-navigate` → bloquear.
  - No `file:save`, só aceitar `path` igual ao arquivo aberto atualmente; o resto passa pelo diálogo.
  - No `export:html5`, nunca aceitar `dir` vindo de fora sem diálogo.
- **Teste:** B1 (confere a configuração) + `probe-preview.cjs` (prova real).

## B2 — Arquivo com um ponto inválido quebra o palco de vez · **Alto**

- **Onde:** `src/model/document.js` (`validPath` só confere se `pts` é array) → `src/player/render.js:73` (`buildPath2D`).
- **Reproduzir:** abra um `.fanim` com uma forma cujo `pts` tenha `null` (ex.: `[null, [10,10,0,0,0,0], …]`).
- **Esperado:** o ponto é ignorado, ou o arquivo é recusado com mensagem.
- **Aconteceu:** `TypeError: Cannot read properties of null (reading '0')` dentro do `load`. O documento fica carregado, mas **todo desenho do palco falha** (confirmado no navegador: `stage.render()` continua dando o erro).
- **Correção:** no `parseDocument`, descartar pontos que não sejam arrays de números finitos, e formas que fiquem com menos de 2 pontos.
- **Teste:** B2.

## B6 — Ossos não dobram uma forma (o bug do seu print) · **Médio**

- **Onde:** `src/editor/tools-final.js` (`boneTool.up`: só prende se o arraste termina em **outro** objeto) e `src/player/bones.js` (`poseElements`: prende o objeto inteiro a **um** osso).
- **Reproduzir:**
  1. Desenhe uma linha.
  2. Com Ossos (M), puxe um osso de um ponto da linha a outro e continue a corrente pelas pontas.
  3. Arraste a ponta.
- **Esperado:** a linha dobra seguindo a corrente, como o IK de forma do Animate.
- **Aconteceu:** o 1º osso não prende nada. Cada osso seguinte prende a linha inteira e tira a ligação do anterior, então a linha gira em bloco presa ao último osso. No teste, dobrando só o 2º osso, o ponto (200, 300), que fica sobre o 1º osso, foi para (217,5, 243,5).
- **Correção:**
  - Ossos dentro de uma forma: cada ponto do caminho ganha pesos para os ossos próximos (pela distância ao segmento).
  - O caminho mostrado passa a ser o deformado, no mesmo lugar onde já entram os pinos (`shapePath`).
- **Teste:** B6.

## B5 — SVG exportado aceita código injetado pelo arquivo · **Médio**

- **Onde:** `src/export/svg.js`: `fill="${doc.background}"`, `href="data:${b.mime}…"` e `cam.tint`, sem escapar.
- **Reproduzir:** um documento com `background` = `#fff"/><script>…` (ou o `mime` de uma imagem com aspas) → Exportar SVG.
- **Aconteceu:** o SVG sai com `<script>` / `onload=`, que roda ao abrir o SVG no navegador.
- **Correção:**
  - Validar cores como `#rrggbb` e o mime como `image/*` no `parseDocument`.
  - Escapar esses valores no SVG.
- **Teste:** B5.

## B3 — Arquivo com estrutura errada mostra erro técnico · **Médio**

- **Onde:** `src/model/document.js`, `parseDocument`.
- **Reproduzir:** abrir um `.fanim` com cena sem `layers`, `layers: null`, cena `null` ou quadro `null`.
- **Aconteceu:** `TypeError: Cannot read properties of undefined (reading 'length')` (e variações).
- **Esperado:** "O arquivo está danificado…".
- **Correção:** validar `scenes[i]`, `layers` e `frames` (filtrar nulos, exigir arrays) antes de usar.
- **Teste:** B3.

## B4 — Matriz com texto faz o objeto sumir · **Médio**

- **Onde:** `src/model/document.js` (só confere se a matriz tem 6 itens).
- **Reproduzir:** forma com `matrix: ["a",0,0,1,0,0]`.
- **Aconteceu:** abre sem aviso; o objeto some do palco, a caixa de seleção vira `NaN` e os campos X/Y ficam vazios (visto no navegador).
- **Correção:** trocar valores não finitos pela identidade ao abrir.
- **Teste:** B4.

## B7 — Ossos com pais em ciclo quebram a cinemática inversa · **Baixo**

- **Onde:** `src/player/bones.js`, `solveIK` (usa ossos que `solveBones` descartou).
- **Reproduzir:** esqueleto com A filho de B e B filho de A (só por arquivo editado à mão), depois arrastar com a ferramenta de ossos.
- **Aconteceu:** `TypeError … reading 'tail'`.
- **Correção:** no `solveIK`, parar a corrente quando o osso não está no resultado de `solveBones`; no `parseDocument`, quebrar ciclos.
- **Teste:** B7.

## B8 — XFL com quadros fora de ordem troca o conteúdo de lugar · **Baixo**

- **Onde:** `src/model/xfl.js`, `timelineOf`, que assume os `DOMFrame` em ordem.
- **Reproduzir:** `DOMFrame index="5"` antes de `index="0"`.
- **Aconteceu:** o conteúdo do quadro 0 foi parar no quadro 7.
- **Correção:** ordenar os `DOMFrame` por `index` antes de montar.
- **Teste:** B8.

## B9 — Checagem de pasta do export deixa "../" ir para pasta vizinha · **Baixo** (só alcançável junto com o B1)

- **Onde:** `main.cjs`, `export:write`: `target.startsWith(dir)`.
- **Reproduzir:** pasta `C:\saida\pasta` e arquivo `../pasta2/x.txt` → grava em `C:\saida\pasta2\x.txt`.
- **Correção:** `path.relative(dir, target)` não pode começar com `..` nem ser absoluto.
- **Teste:** B9.

---

## Suspeitas não confirmadas (não reproduzi)

- **Importar XFL lê a pasta inteira:** `readDirRec(path.dirname(p))` em `main.cjs`. Um `.xfl` solto dentro de Downloads leria Downloads inteiro para a memória.
- **`.dat` truncado do .fla:** o bitmap vira imagem transparente sem aviso (o cabeçalho diz 100×100, mas não há pixels).
- **Caneta/laço poligonal pela metade:** o caminho continua guardado ao trocar de ferramenta e voltar.

## Testado e não quebrou

- **Lip-sync:** som vazio, cheio de `NaN` ou com fps 0.
- **Vetorizar:** imagem 0×0 ou toda transparente.
- **Sprite sheet:** lista vazia e quadros 0×0.
- **Malha de pinos:** pinos no mesmo ponto.
- **Lottie:** documento vazio.
- **XFL:**
  - sem `DOMDocument`: dá mensagem legível;
  - vazio ou XML truncado: abre com padrões;
  - arestas com lixo;
  - símbolo que contém ele mesmo: não trava, Lottie em 4 ms.
- **Documento com 1 bilhão de quadros:** abre em 0,3 s; a timeline não estoura.
- **Grade com tamanho 0 ou texto:** tem proteção.
- **Página aberta com `window.open` a partir da janela de teste:** não recebe `window.api` (o problema é só a navegação da própria janela, B1).
- **Suíte do projeto:** 61 testes e o smoke test do Electron passam.
