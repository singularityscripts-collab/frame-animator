# Frame Animator

Editor de animação 2D vetorial (Electron), com as funções clássicas de um editor de animação quadro a quadro.

## Rodar

```bash
npm install
npm start
```

Outros comandos:

- `npm test`: testes do modelo, timeline, desfazer, tween, símbolos, booleanos, borracha, balde, ossos,
  malha de pinos, importação XFL, lip-sync, vetorização, exports (Lottie, SVG, sprite sheet) e o runtime HTML5 (Node, sem janela).
- `npm run smoke`: abre o Electron, salva um arquivo, abre a janela de teste, exporta MP4/MOV/GIF/PNG,
  confere os arquivos com o ffmpeg, gera o pacote HTML5 e clica num botão dentro dele, e fecha sozinho.
- `npm run serve`: abre o editor no navegador em http://localhost:5178 (sem salvar em disco nem exportar vídeo).

Dependências: Electron, ffmpeg-static (export de vídeo) e Paper.js (geometria).

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

## Fase 3 (pronta)

- **Pincel (B):** traço com largura variável; com mesa digitalizadora, a pressão da caneta muda a
  largura. Tamanho, suavizar e pressão ligada/desligada nas propriedades. Vira uma forma preenchida.
- **Balde de tinta (K):** clicar dentro de uma forma troca o preenchimento; clicar numa área cercada
  por linhas cria um preenchimento por baixo delas. "Fechar lacunas" (não fechar, pequenas, médias,
  grandes) deixa passar pequenos buracos no contorno.
- **Borracha (E):** modos normal, só preenchimentos e só linhas. Corta formas e linhas de verdade
  (vetorial), não só esconde.
- **Conta-gotas (I):** copia o preenchimento (e já troca para o balde), o traço, ou a cor do pixel.
- **Cores** (aba, Ctrl+Shift+F9): preenchimento e traço, cor sólida com alfa, gradiente linear e
  radial com paradas arrastáveis (cor, posição e alfa), e amostras salvas no arquivo.
- **Transformar gradiente (F):** mover, esticar, girar, mudar o tamanho e o foco do gradiente na forma.
- **Combinar objetos** (menu Modificar ou painel com 2+ formas): unir, interseção, perfurar e recortar.
- Formas agora podem ter furos e várias partes (caminho composto). O tween clássico também
  interpola gradientes e transparência.

## Fase 4 (pronta)

- **Camadas:** pastas (recolher, arrastar para dentro, travar/ocultar a pasta inteira), máscara
  (o recorte aparece no palco com a máscara travada, e sempre no teste/export), guia (não sai no
  export) e guia de movimento (o tween clássico anda sobre o caminho, com opção de orientar),
  parentesco (a camada filha segue o objeto da mãe) e profundidade (parallax com a câmera).
  Duplo clique no ícone da camada abre as propriedades; clique direito tem o resto.
- **Câmera** (botão na timeline ou ferramenta C): mover arrastando, zoom, giro e tom de cor;
  mudar num quadro cria keyframe, e tween clássico entre keyframes anima a câmera.
- **Motion tween:** mova o objeto em qualquer quadro e as keys são criadas sozinhas; o caminho
  aparece no palco e os pontos dele podem ser arrastados. **Editor de movimento** com curvas por
  propriedade (posição, rotação, inclinação, escala, alfa) e alças Bézier.
- **Shape tween** entre formas, com **dicas de forma** (Ctrl+Shift+H) para dizer qual ponto vira qual.
- **Easing:** presets (suave, forte, seno, voltar, elástico, quicar…) e curva personalizada desenhada
  num gráfico, em todos os tipos de tween. **Presets de movimento** prontos (entrar, cair e quicar,
  aparecer, girar, pulsar, tremer…) e os seus próprios, salvos a partir de um motion tween.
- **Quadros:** arrastar seleciona um intervalo em várias camadas; copiar, recortar, colar (inserindo
  ou substituindo), remover, inverter e converter em keyframes. **Editar vários quadros** ao mesmo tempo.
- **Rótulos** (nome, comentário, âncora) e **cenas** (menu no nome da cena: criar, duplicar,
  renomear, reordenar, apagar). O teste e o export tocam todas as cenas em sequência.
- **Distribuir** para keyframes e para camadas.
- **Áudio:** importar som (WAV, MP3, OGG, M4A, AAC, FLAC), forma de onda na timeline, sincronia
  evento/iniciar/parar/stream, scrub ao arrastar a agulha, repetir, volume, pan e fade in/out.
  O som vai junto no export de MP4 e MOV.

## Fase 5 (pronta) — todas as funções do mapa

- **Desenho:** subseleção (A) para mover pontos e alças e apagar pontos; laço livre e poligonal (L);
  polígono e estrela (Shift+R); caneta Bézier (P) com adicionar (=), remover (-) e converter ponto
  (Shift+C); lápis com os modos suavizar, endireitar (reconhece linha, retângulo e elipse) e tinta;
  ferramenta de largura (U) para engrossar o traço em pontos; pincéis de arte e de padrão (o traço
  segue um símbolo da biblioteca); transformação livre (Q) com inclinar, distorcer e envelope;
  desenho mesclado ou de objeto (J); otimizar curvas e separar (Ctrl+B).
- **Texto (T):** estático, dinâmico e de entrada, editado direto no palco; fontes, tamanho, cor,
  negrito, itálico, alinhamento, espaçamento e largura fixa.
- **Imagens:** importar (Ctrl+Alt+I, ou arrastar do sistema para o palco), biblioteca com prévia,
  vetorizar bitmap (cores, área mínima, precisão e suavização).
- **Palco:** réguas, guias (arrastar da régua), grade, encaixe na grade, nas guias e em objetos (com
  linhas de alinhamento), painel Alinhar (Ctrl+K) e girar a vista (Shift+H).
- **Símbolos:** botão com estados normal, sobre, pressionado e área de clique; seletor de quadro;
  filtros (sombra, desfoque, brilho, chanfro, ajuste de cor); modos de mesclagem; escala de 9 fatias;
  cache como bitmap; rotação e posição 3D de movie clips (G) com perspectiva.
- **Rigging:** ossos (M) com cinemática inversa (cada pose vira keyframe e o tween interpola) e
  malha de pinos (W) em formas e imagens.
- **Lip-sync automático:** analisa a fala e troca a boca (9 visemas) criando keyframes.
- **Interatividade:** painel Ações (F9) com JavaScript por quadro e trechos prontos; componentes
  botão, lista e vídeo; scripts que automatizam o editor (painel Scripts, API `fa`).
- **Exportar e publicar:** HTML5 Canvas interativo (pasta que abre direto no navegador), Lottie,
  sprite sheet + JSON, SVG por quadro; configurações de publicação e Publicar (Shift+F12).
- **Importar do Animate:** `.fla` e XFL (camadas, máscaras, guias, pastas, tweens, rótulos, símbolos,
  formas, gradientes, textos, imagens, sons, filtros e ActionScript convertido para JavaScript).
- **Interface:** painéis encaixáveis à esquerda, à direita ou flutuando, layouts salvos, atalhos
  personalizáveis (também no menu), localizar e substituir (texto e cor) e explorador de cenas.

## Arquitetura

```
src/
  player/     motor compartilhado: desenha o documento e toca a animação (sem nada do editor)
  model/      documento JSON, operações puras de timeline, geometria
  editor/     estado, comandos (desfazer), palco, ferramentas, timeline e painéis
  app.js      liga tudo
  export/     exports vetoriais: achatar quadro, SVG, Lottie e sprite sheet
  preview.*   janela de teste (o mesmo runtime do export HTML5)
main.cjs      processo principal: janela, menu, diálogos de arquivo, leitor de .fla
bundler.cjs   junta src/player num script só para o pacote HTML5
preload.cjs   ponte segura entre a interface e o sistema
```

- **Player separado do editor:** `src/player` não importa nada do editor, então pode ir junto no export.
- **Modelo:** documento → cenas → camadas → trechos (keyframe + duração + tween) → elementos
  (formas com matriz e caminho Bézier, ou instâncias de símbolo). A biblioteca guarda símbolos, que
  têm camadas próprias como uma cena. Tudo JSON.
- **Tween e símbolos no player:** `src/player/tween.js` calcula a interpolação; o editor, a janela
  de teste e o export usam o mesmo cálculo, então o que aparece no palco é o que sai no vídeo.
- **Câmera, parentesco e máscaras no player:** `renderTimeline` monta a matriz de cada camada
  (câmera com profundidade × parentesco) e recorta as camadas mascaradas; o editor usa a mesma
  matriz para selecionar e editar no lugar certo.
- **Áudio:** `src/player/audio.js` monta a agenda dos sons (função pura); a mesma agenda toca no
  editor, na janela de teste e vira o WAV que o ffmpeg junta ao vídeo.
- **Comandos:** toda edição passa por um objeto com `do`/`undo` (`src/editor/commands.js`).
- **Renderização:** Canvas 2D próprio, sem dependências. O Paper.js (`src/model/vector-ops.js`)
  só faz a geometria pesada: booleanos, borracha e contorno do pincel. Ele não vai no player.
- **Balde:** `src/model/raster.js` preenche numa máscara de pixels (com fechamento de lacunas) e
  devolve os contornos, que viram uma forma vetorial.
- **Atalhos:** todos num lugar só (`src/editor/actions.js`), usados pelo teclado, menu e botões.

- **Runtime interativo:** `src/player/runtime.js` roda os scripts dos quadros, botões, componentes e
  texto de entrada. A janela de teste e o pacote HTML5 usam o mesmo arquivo (o `bundler.cjs` junta os
  módulos do player num script clássico, então o HTML5 abre direto do disco).
- **Efeitos no player:** filtros, mesclagem, 3D, 9 fatias e cache em `src/player/effects.js`; ossos em
  `bones.js`; malha de pinos (MLS) em `mesh.js`; imagens, texto e componentes em `assets.js`.
- **Mixins do editor:** `editor.js` (núcleo), `editor-pro.js` (Fase 4) e `editor-final.js` (Fase 5)
  acrescentam métodos ao mesmo `Editor`; as ações novas ficam em `actions-final.js`.
- **Importar XFL:** `src/model/xml.js` lê o XML e `src/model/xfl.js` converte; as arestas do Animate
  (em twips, às vezes em hex) viram laços de preenchimento e traços.
