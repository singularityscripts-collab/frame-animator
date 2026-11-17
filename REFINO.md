# REFINO — Frame Animator a nível de estúdio

Objetivo: deixar as funções que já existem fáceis, previsíveis e gostosas de usar (referência: Toon Boom Harmony e Moho). **Nada de funções novas.**

## Regras

- Uma etapa por vez. No fim de cada etapa, parar e esperar "próxima etapa".
- Atualizar este arquivo no fim de cada etapa: status, o que foi feito e o que ficou pendente.
- Numa conversa nova, ler este arquivo primeiro e continuar de onde parou.
- Não quebrar a arquitetura:
  - toda ação passa por comandos (desfazer/refazer);
  - o documento continua em JSON;
  - o player continua separado do editor.
- No fim de cada etapa: rodar o app, testar o fluxo como um animador faria e entregar o que mudou, como testar e o que não deu para resolver.

## Status

| Etapa | Tema | Status |
|---|---|---|
| 0 | Auditoria | **pronta** |
| 1 | Rigging | **pronta** |
| 2 | Desenho e seleção | **pronta** |
| 3 | Timeline e animação | **pronta** |
| 4 | Interface e atalhos (+ atualização automática e instalador novo) | **pronta** (esperando "próxima etapa") |
| 5 | Desempenho e estabilidade | pendente |
| 6 | Polimento visual | pendente |

**Falta do usuário:** a seção "O que mais me incomoda hoje" do pedido veio com os campos em branco ("[descreva o que acontece]"). Os problemas que você descrever entram no topo da etapa certa.

---

## Etapa 0: Auditoria (pronta)

### Como foi feita

- Rodei o editor (mesmo código do app, servido no navegador interno) e usei com mouse e teclado, como um animador:
  1. Desenhei um boneco: tronco, cabeça, braço e perna.
  2. Riggei com a ferramenta Ossos.
  3. Estendi a camada até o quadro 12.
  4. Posei nos quadros 1 e 7 e copiei o quadro 1 para o 12.
  5. Criei os tweens e reproduzi em loop.
- Salvar e reabrir: o documento foi serializado e aberto de novo. Poses, tweens, pele e quadros voltaram idênticos.
- Desempenho: documento sintético com 20 camadas × 300 quadros, todos com tween clássico.

### O que já funciona bem

- Desenhar formas, criar ossos e posar arrastando a forma (IK): o ponto agarrado fica sob o cursor.
- Ao posar num quadro sem keyframe, ele cria o keyframe de pose sozinho, e o tween entre poses interpola certo.
- Copiar/colar quadros com Ctrl+Alt+C / Ctrl+Alt+V.
- Reprodução em loop e salvar/reabrir sem perda.
- Desfazer: um arraste vira uma entrada só, e "pose + keyframe novo" também.
- Já existem:
  - Shift para proporção e Alt para escalar a partir do centro, nas alças de transformação;
  - duplo clique para entrar em grupo/símbolo;
  - layout dos painéis salvo entre sessões;
  - editor de atalhos.

### Problemas encontrados, por impacto, já distribuídos nas etapas

Legenda de impacto: **A** = trava o fluxo ou causa erro sem perceber · **M** = atrapalha sempre · **B** = incômodo.

---

## Etapa 1: Rigging (pronta)

### O que foi feito

Todos os itens R1–R12 abaixo foram resolvidos. Arquivos novos:
- `src/editor/rig.js`: o rig no editor (esqueleto, vínculo, poses).
- `src/editor/tools-rig.js`: a ferramenta Ossos e o desenho do esqueleto.
- `src/editor/rig-ui.js`: o painel Esqueleto.
- `test/rig.test.js`: 13 testes.

**Modos.**
- **Editar rig** (laranja) e **Posar** (azul), alternando com **M** ou pela faixa no alto do palco.
- A faixa mostra o modo e explica o que cada arraste faz.
- O modo nunca troca sozinho no meio do trabalho. Ao abrir um arquivo já riggado, começa em Posar.

**Montar o rig.**
- Arrastar desenha o osso; arrastar da ponta continua a cadeia.
- As juntas atraem o cursor e acendem ao passar o mouse.
- Um osso que começa em cima de outro osso, dentro de uma parte já presa ou na cabeça da raiz vira **galho** desse osso. Exemplo: o braço sai do ombro do tronco e acompanha o tronco. Dado novo do osso: `offset`.
- O primeiro osso pode começar em qualquer lugar.
- Alt+arrastar uma junta move a junta, para a camada inteira.
- Delete apaga o osso: os filhos e a arte passam para o pai, sem sair do lugar.

**Rig único por camada.** Criar, apagar, mover junta, renomear, pino e limite valem para todos os keyframes da camada. Cada keyframe guarda só a própria pose, e o documento continua o mesmo JSON.

**Vínculo da arte.**
- Automático: o osso prende a parte que está embaixo do meio dele.
- Uma forma presa a um osso só gira inteira. Presa a dois ou mais ossos, ela dobra (`skinBones`). Antes, a pele usava todos os ossos da camada.
- Ajuste manual: Ctrl+clique numa parte prende ou solta a parte do osso selecionado.
- "Prender arte" prende cada parte solta ao osso mais perto.
- No palco: cada osso tem uma cor; uma linha tracejada liga cada parte ao osso dela, e o osso selecionado ganha uma moldura na parte presa.

**Posar.**
- O IK é estável: o ponto agarrado segue o cursor e não há tremedeira com o alvo em cima da junta.
- A perna esticada dobra o joelho (antes travava).
- Puxar o pé mexe só a perna, não o tronco: a cadeia para no quadril e no ombro.
- Ctrl+arrastar gira só aquele osso (FK).
- O quadrado da raiz move o esqueleto inteiro.
- Posar depois do fim da camada estende a camada.

**Pino e limites.**
- Duplo clique na junta, tecla P ou botão "fixar" na lista. Um pé fixado fica parado quando o corpo desce e o joelho dobra.
- Limites de ângulo: arrastando as bolinhas do arco no palco (osso selecionado, em Editar rig) ou pelos campos do painel.

**Auto-key.** Ligado por padrão, com indicador na faixa e moldura vermelha no palco. Desligado, a pose vai para o keyframe que segura o quadro.

**Painel Esqueleto.**
- Lista dos ossos em árvore, com seleção por nome.
- Nome, pino e limites do osso selecionado.
- Copiar, colar, espelhar (pelos nomes esq/dir ou pelos dois galhos iguais) e zerar pose.

**Alças.** Tamanho fixo na tela em qualquer zoom, com "Ocultar alças" na faixa e no painel. Com as outras ferramentas, o esqueleto continua visível, em versão discreta.

**Correções que apareceram no caminho.**
- **R11 e corrupção da forma:** a Seleção mexia numa cópia já posada, então "Mover" não movia nada. Pior: mudar a cor (ou qualquer propriedade) de uma forma com pele gravava a forma **dobrada** por cima da original. Agora as edições vão para o original, levadas de volta pela pose.
- **Keyframe no meio do tween:** a pose criada ali usava interpolação linear e pulava quando havia easing. Agora usa o easing.
- **"Tirar ossos":** agora também solta a pele.

### Como testar

1. Desenhe tronco, coxas, canelas, braço e antebraço em retângulos separados.
2. Aperte **M**: entra em Editar rig, com a faixa laranja no alto.
3. Desenhe os ossos:
   - do quadril ao pescoço, dentro do tronco;
   - de dentro do tronco, perto do quadril, até o joelho;
   - do joelho até o pé, a partir da ponta;
   - de dentro do tronco, no ombro, até o cotovelo, e dali até a mão.
   Cada osso prende sozinho a parte embaixo dele: veja as linhas tracejadas.
4. Renomeie as pernas no painel para "Coxa esq", "Canela esq", "Coxa dir" e "Canela dir".
5. Aperte **M** para Posar e arraste os pés e a mão.
6. Vá ao quadro 7 e clique em **Espelhar pose**.
7. No quadro 1, clique em Copiar pose. No quadro 13, clique em Colar pose.
8. Crie o tween clássico nos dois trechos e aperte Enter.
9. Extra: duplo clique nos pés para fixar e arraste o quadrado do quadril para baixo.

### Pendências da etapa

- **Editar pontos fora da pose de descanso:** editar os pontos (Subseleção, pinos, largura) de uma forma presa a osso, num quadro posado, não grava nada. Antes gravava errado. Para editar os pontos, use um quadro com a pose zerada.
- **Para onde dobra o joelho:** com a cadeia totalmente reta, o IK escolhe o lado pelo limite de ângulo (ou pela dobra atual). Sem limite, dobra para o lado positivo. Ponha limite no joelho para garantir o lado.
- **Ciclo de 12 quadros:** o fechamento repete a pose do quadro 1 no quadro 13. Falta a faixa de reprodução (T8, Etapa 3).

### Problemas da auditoria (todos resolvidos)

| # | Imp. | Problema (visto no teste) |
|---|---|---|
| R1 | A | **Sem modos Editar rig / Posar.** Com a ferramenta Ossos:<br>• arrastar a ponta de um osso **cria um osso novo** em vez de posar (aconteceu no teste ao tentar dobrar o braço);<br>• arrastar a forma posa;<br>• Alt+arrastar na forma cria osso.<br>Tudo isso fica na mesma ferramenta, sem indicação. |
| R2 | A | **O esqueleto mora dentro de cada keyframe.** Um osso criado no quadro 7 só existe no keyframe 7 (no teste ficaram 2 / 3 / 2 ossos). Mexer no rig depois de animar deixa as poses inconsistentes. Precisa de **um rig por camada** e só a pose por keyframe, com conversão automática de arquivos antigos (continua JSON). |
| R3 | A | **O esqueleto some** quando você troca para Seleção ou outra ferramenta, e não há como ver o rig enquanto anima. |
| R4 | M | **Vínculo implícito e invisível.**<br>• A peça presa é o objeto onde o osso *termina*, e uma forma ligada vira "pele" automaticamente.<br>• Nada mostra qual parte segue qual osso.<br>• A pele usa os pesos de **todos** os ossos da camada, não só os do membro. |
| R5 | M | O primeiro osso precisa começar **em cima de um objeto**. No vazio aparece só um aviso. |
| R6 | M | Não dá para:<br>• apagar **um** osso;<br>• mover uma junta depois de criada;<br>• renomear ossos;<br>• ver a hierarquia.<br>Só existem "Tirar ossos" (apaga todos) e "Soltar do osso". |
| R7 | M | Sem fixar (pin) juntas, sem limites de ângulo e sem tecla para FK: todo arraste é IK. |
| R8 | M | Sem copiar/colar, espelhar ou resetar pose. Para fechar o ciclo tive que copiar o quadro inteiro. |
| R9 | M | Auto-key sempre ligado e **sem indicador**: todo arraste cria keyframe e não há como desligar. |
| R10 | B | **Alças minúsculas.**<br>• Juntas de 4 px e haste com tolerância de 5 px.<br>• Nenhum destaque ao passar o mouse.<br>• Cursor sempre em cruz, então não dá para saber o que o clique vai fazer. |
| R11 | B | Com Seleção, arrastar uma forma com pele grava "Mover" no histórico, **mas nada se mexe**. |
| R12 | B | A dica da ferramenta é um parágrafo longo no painel; o fluxo em si não ensina nada. |

---

## Etapa 2: Desenho e seleção (pronta)

### O que foi feito

**Pincel e lápis**
- **Estabilizador "corda" (D1):** o ponto que desenha só anda quando o cursor passa do comprimento da corda.
  - Tira a tremedeira da mão sem atrasar o traço no tempo.
  - O rastro ao vivo **é** o traço final: nada pula ao soltar.
  - Uma linha tracejada mostra a corda.
  - O controle é o "Estabilizar" nas propriedades do pincel e (novo) do lápis.
- **Pressão (D2):**
  - O toque inicial da caneta com pressão 0 não vira mais bolinha: o começo do traço usa a primeira pressão que chegar.
  - A pressão passa por uma curva (expoente 0,7) e por suavização, então a largura não muda aos degraus.
  - Mouse e toque desenham sempre com a largura cheia.
- **Traço sem atraso (D3):** durante um traço de pincel, lápis ou borracha, o palco fica congelado numa imagem e só o rastro é redesenhado. Isso leva menos de 0,1 ms por quadro, em qualquer cena.

**Seleção (D4)**
- **Modificadores:** Shift soma (Shift numa peça já selecionada tira). Alt+clique tira da seleção, e Alt+arrastar faz um retângulo que tira (vermelho).
- **Destaque antes de clicar:** passar o mouse sobre uma peça mostra o contorno do que o clique vai pegar.
- **Retângulo de seleção:** enquanto você arrasta, as peças que vão entrar (ou sair) da seleção já aparecem destacadas.
- **Arrastar pelo vão:** clicar dentro da moldura da seleção, entre as peças ou numa linha fina, arrasta a seleção.
- **Clique simples numa seleção múltipla:** clicar (sem arrastar) numa peça de uma seleção com várias deixa só ela selecionada.
- **Duplo clique:** numa forma, entra na edição dos pontos (Subseleção); num símbolo, entra no símbolo (como antes).

**Alças de transformação**
- Alças maiores, que acendem quando o mouse passa por cima.
- Alça de girar visível acima da moldura. Os cantos continuam girando por fora, como antes.
- Medidas ao lado do cursor:
  - mover: x e y;
  - escalar: largura × altura e %;
  - girar: graus.
- Shift mantém a proporção e Alt escala a partir do centro. As duas coisas já existiam; agora foram testadas juntas.

**Balde, borracha e conta-gotas (D6)**
- **Borracha:** por padrão só apaga na **camada ativa**; antes apagava em todas as camadas destravadas. A opção "Apagar em todas as camadas destravadas" fica nas propriedades.
- **Borracha com ossos:**
  - Numa parte presa a osso, num quadro posado, apaga onde a parte aparece e guarda o corte no desenho original. Antes gravava a forma deslocada.
  - Uma forma que dobra com vários ossos não é apagada e aparece um aviso.
- **Conta-gotas:** não troca mais de ferramenta sozinho (antes pulava para o balde). Shift+clique manda a cor para o traço.
- **Alt+clique:** no pincel e no balde pega a cor do preenchimento; no lápis, a cor do traço. Não cria passo no histórico.

**Grupo de formas (D5):** não mudou. O botão já mostra o ícone e a dica da variante escolhida, e R e O escolhem direto. É o comportamento padrão do Animate.

### Como testar

1. **Pincel (B):** use Estabilizar em 40, faça um traço tremido devagar e veja a corda tracejada. Ao soltar, o traço fica igual ao que estava na tela. Com mesa digitalizadora, o começo do traço sai fino.
2. **Seleção:**
   - Desenhe três retângulos e passe o mouse sobre um: aparece o contorno tracejado.
   - Arraste um retângulo de seleção sobre os três.
   - Alt+clique no do meio para tirá-lo.
   - Arraste pelo vão entre os outros dois: os dois andam juntos.
3. **Transformar:** puxe a bolinha de cima com Shift para girar em passos de 15°, ou um canto com Shift+Alt para escalar a partir do centro. As medidas aparecem ao lado do cursor.
4. **Borracha:** com duas camadas desenhadas, apague na de cima: a de baixo fica intacta.
5. **Cores:** use o conta-gotas (I) numa forma: a ferramenta continua o conta-gotas. No balde (K), Alt+clique pega a cor.

### Pendências da etapa

- **Retângulo de seleção:** pega pela caixa da peça. Uma linha em L pode entrar sem o retângulo encostar no traço em si.
- **Editar pontos fora da pose de descanso:** continua igual à Etapa 1. Os pontos de forma presa a osso só se editam com a pose zerada.

### Problemas da auditoria (resolvidos, menos D5, que ficou como está)

| # | Imp. | Problema |
|---|---|---|
| D1 | M | **Pincel:** a suavização só é aplicada **ao soltar**. O rastro ao vivo é o traço bruto, e o traço "pula" quando você termina. |
| D2 | M | **Pressão:** quando a caneta manda pressão 0 no primeiro ponto, ele vira largura **máxima** (bolinha no começo do traço). Também não há curva de pressão. |
| D3 | M | O rastro do pincel redesenha o traço inteiro a cada movimento, então traços longos ficam pesados. |
| D4 | M | **Seleção:** não existe Alt para subtrair (Shift alterna peça a peça; o retângulo de seleção só soma). |
| D5 | B | **Grupo de formas:** escolher Oval no menu troca o botão do Retângulo. Clicar nele de novo continua fazendo oval (no teste, braço e perna saíram ovais), e nada avisa. |
| D6 | — | Balde, borracha e conta-gotas: testar a fundo nesta etapa (não entraram na caminhada). |

---

## Etapa 3: Timeline e animação (pronta)

### O que foi feito

**Selecionar intervalos (T1, T2)**
- Clique num quadro e Shift+clique em outro seleciona o intervalo, também entre camadas. Antes só funcionava se já houvesse um intervalo arrastado.
- O clique direito dentro da seleção mantém a seleção e não move a agulha.
- O menu de clique direito age no intervalo inteiro: "Criar tween clássico (2 trechos)", "Remover tween (2 trechos)" e assim por diante.

**Arrastar (T3)**
- **Keyframe:** arrastar um keyframe move o keyframe.
  - O trecho de antes estica ou encolhe e o fim do trecho fica no lugar.
  - Ele não passa por cima de outro keyframe.
  - O primeiro keyframe arrastado para a direita deixa quadros vazios antes.
- **Intervalo selecionado:** arrastar move os quadros, que substituem o destino e deixam vazio na origem. Com **Alt**, copia.
- **Durante o arraste:** um fantasma amarelo (verde na cópia) mostra onde os quadros vão parar, com "+3 → quadro 10", e a agulha acompanha.
- **Seleção a partir de um keyframe:** Ctrl+arrastar começa uma seleção mesmo em cima de um keyframe.
- **Cursor:** vira "mão" quando o arraste vai mover alguma coisa.

**Colar (T4)**
- "Colar quadros" (Ctrl+Alt+V) agora **substitui** a partir do quadro (ou do começo da seleção). Colar no último quadro não cria mais um quadro a mais.
- "Colar inserindo" (Ctrl+Alt+Shift+V) empurra o resto, como antes.
- O que foi colado fica selecionado.

**Tween e easing (T5)**
- **Ctrl+T** cria tween clássico no quadro ou no intervalo. Se todos já têm tween, tira.
- Motion e shape tween também valem para o intervalo.
- **Easing visual:** quatro botões com a curva desenhada (constante, entrada suave, saída suave, suave nos dois) e uma prévia da curva atual. O seletor completo e o editor de curva continuam.

**Onion skin (T6)**
- Alças na régua: arrastar muda quantos quadros aparecem antes e depois.
- O clique direito na régua liga e desliga o onion skin.

**Zoom da timeline (T7)**
- Ctrl+roda do mouse sobre os quadros ou a régua, mantendo o quadro sob o cursor, ou o controle deslizante na barra.
- O zoom vai de 6 a 32 px por quadro e fica guardado neste computador.

**Faixa de reprodução (T8)**
- **Como definir:**
  - clique direito na régua: "Início da faixa" / "Fim da faixa";
  - no menu de quadros: "Tocar só estes quadros";
  - arrastando os colchetes verdes na régua.
- **No uso:**
  - Play e loop ficam só na faixa, inclusive o som.
  - Fora da faixa, a grade fica escurecida, e o contador mostra "faixa 1–12".
- A faixa vale só no editor (não vai para o arquivo) e é zerada ao abrir outro arquivo.

**Correções no caminho**
- O painel Propriedades não atualizava o texto "Intervalo: quadros X a Y" ao mudar a seleção da timeline.
- Ao abrir outro arquivo, o modo dos ossos e o osso selecionado voltam ao padrão.

### Como testar

1. Desenhe uma bola e aperte F6 nos quadros 7 e 13. Mova a bola nos keyframes.
2. Clique no quadro 1, Shift+clique no 12 e aperte **Ctrl+T**: tween nos dois trechos.
3. Clique direito dentro da seleção e escolha "Tocar só estes quadros". Aperte Enter: o loop fica em 1–12.
4. Arraste o keyframe do quadro 7 para o 9.
5. Selecione os quadros 1–4 e arraste com Alt para a frente: cópia.
6. Ligue o onion skin e arraste as alças coloridas embaixo da régua.
7. Ctrl+roda do mouse sobre a timeline para dar zoom.
8. Num quadro com tween, clique em "Saída suave" no painel.

### Pendências da etapa

- **Seleção que começa num keyframe:** arrastar a partir de um keyframe move o keyframe. Para selecionar começando num keyframe, use Ctrl+arrastar ou Shift+clique. É o mesmo comportamento do Animate, mas pode pegar alguém de surpresa.
- **Duração de um trecho:** ainda não dá para arrastar o fim de um trecho sem keyframe depois para mudar a duração. Isso continua com F5 / Shift+F5.
- **Atalhos com modificador:** o navegador de teste não mandou o Ctrl junto com a roda nem o Alt junto com o arraste. Testei com eventos que levam a tecla e funcionou; vale conferir no app com o mouse.

### Problemas da auditoria (todos resolvidos)

| # | Imp. | Problema (visto no teste) |
|---|---|---|
| T1 | A | **Shift+clique depois de um clique simples não seleciona o intervalo.** Só funciona se já houver um intervalo arrastado. No teste, o tween acabou criado só no trecho sob o mouse. |
| T2 | A | **Clique direito fora da seleção descarta a seleção**, e "Criar tween" age só no trecho do cursor, não no intervalo selecionado. |
| T3 | M | Não dá para **arrastar keyframes** (arrastar só seleciona). |
| T4 | M | "Colar quadros" **insere e empurra**: colar no quadro 12 criou um 13. O esperado é substituir o que está selecionado. |
| T5 | M | Criar tween não tem atalho. |
| T6 | M | Onion skin tem só o botão e campos numéricos. Faltam marcadores arrastáveis na régua. |
| T7 | B | Largura dos quadros fixa (12 px), sem zoom da timeline. |
| T8 | B | Sem faixa de reprodução (entrada/saída). No ciclo, o quadro 12 é igual ao 1, então a pose repete no loop. |

---

## Etapa 4: Interface e atalhos (pronta)

### O que foi feito

- **Menu de clique direito no palco (I1)**
  - Sobre uma peça: editar símbolo ou pontos, recortar, copiar, colar, duplicar, apagar, converter em símbolo, separar, distribuir, ordem, motion tween e soltar do osso.
  - No vazio: colar, colar no lugar, selecionar tudo, zoom, réguas, grade, guias e propriedades do documento.
  - Cada item mostra o atalho.
- **Barra de status (I2)**
  - Embaixo do palco: o nome e o atalho da ferramenta, e o que cada ação e modificador faz.
  - Muda conforme o que está sob o mouse: sobre uma alça, "Arraste escala · Shift mantém a proporção · Alt a partir do centro"; sobre uma peça, as opções de mover e selecionar.
  - Mostra o modo dos ossos (Editar rig / Posar).
  - À direita: posição do cursor, quantos objetos estão selecionados e o zoom.
- **Folha de atalhos (I3)**
  - Tecla **?** ou **F1**, ou Ajuda › Atalhos de teclado.
  - Todos os atalhos (inclusive os personalizados) em grupos, com busca, mais os gestos de mouse (Espaço, Ctrl+roda, Shift+clique, Alt+arraste).
  - O botão "Personalizar…" abre o editor de atalhos.
- **Scrub nos campos numéricos (I4)**
  - Arrastar o nome de qualquer campo numérico (X, Y, L, A, rotação, limites dos ossos…) muda o valor ao vivo.
  - Shift multiplica por 10, Alt divide por 10.
  - O arraste inteiro é um passo só de desfazer.
- **Cursores (I5):** cursores próprios para balde, conta-gotas, caneta e lápis. Os ossos já tinham cursor por estado desde a Etapa 1.
- **Dicas (I6):** conferido que nenhum botão de ícone ficou sem dica.
- **Mensagens de erro**
  - Toda falha de ação diz qual ação falhou, o motivo e que Ctrl+Z desfaz.
  - Erros de arquivo viram explicação (arquivo em uso, disco cheio, sem permissão) com o que fazer.
  - Os avisos longos ficam mais tempo na tela.

### Pedido junto com esta etapa: atualização automática e instalador novo

- **Atualização automática pelo GitHub**
  - Ao abrir o app (no máximo a cada 6 horas) ou em Ajuda › Procurar atualizações, o app consulta a última release.
  - Um cartão animado no canto do palco mostra a versão e as novidades e oferece "Atualizar agora".
  - O download tem barra de progresso e pode ser cancelado, e o SHA-256 é conferido; sem conferência, não instala.
  - "Instalar e reiniciar" pergunta antes se há alterações não salvas.
  - Dá para pular uma versão ou desligar a procura automática.
  - Só aceita downloads https do GitHub.
- **Instalador novo, no lugar do NSIS**
  - Janela escura com cantos arredondados e manchas de luz que flutuam.
  - No topo, uma bola quicando com onion skin, como no exercício clássico.
  - Troca de telas com deslize, botões que reagem ao mouse e ao clique, barra de progresso com brilho e marca de "pronto" que se desenha.
  - Instala para o usuário, sem pedir administrador, em cerca de 8 segundos, com atalhos e entrada em "Aplicativos instalados".
  - Remove o 0.1.x antigo.
  - Troca os arquivos de uma vez, com volta atrás se algo falhar.
  - Avisa se o app estiver aberto ou se faltar espaço no disco.
- **Desinstalador:** mesmo visual, com a opção de apagar as configurações. As animações nunca são apagadas.
- **Ícone novo do app:** bola com onion skin em degradê azul-violeta.
- **Tamanho:** o app empacotado leva só os idiomas pt-BR e en-US, e o instalador ficou com 169,6 MB.

### Como testar

1. Passe o mouse no palco e veja a barra de status embaixo.
2. Clique direito numa peça e no vazio.
3. Aperte **?**.
4. Selecione uma peça e arraste a palavra "X" no painel Propriedades para os lados.
5. Instale com `dist/Frame-Animator-Setup-0.2.0.exe`.
6. Em Ajuda › Procurar atualizações, deve aparecer "Você está na versão mais nova".

### Testado

- 101 testes passando (3 novos: nomes das ações, comparação de versões e endereços aceitos no download).
- `npm run check` ok.
- No app instalado:
  - instalação silenciosa (arquivos, atalhos e registro conferidos);
  - teste completo de fumaça;
  - atualização simulada: esperou o processo fechar, trocou a pasta e não deixou sobra;
  - desinstalação: pasta, atalhos e registro removidos, configurações mantidas, sem cópia temporária sobrando.
- Telas do instalador e do desinstalador conferidas por imagem.

### Pendências da etapa

- **Assinatura digital:** o instalador não tem assinatura, então o Windows SmartScreen ainda avisa "editor desconhecido" no primeiro download.
- **Primeira atualização real:** a atualização só funciona de verdade a partir da release 0.2.0 publicada. Quem tem o 0.1.0 instala o 0.2.0 pela página da release, uma vez só, porque o 0.1.0 não tinha atualizador.

### Problemas da auditoria (todos resolvidos)

| # | Imp. | Problema |
|---|---|---|
| I1 | M | **Sem menu de clique direito no palco.** Ele só bloqueia o menu do navegador. Timeline e biblioteca já têm o seu. |
| I2 | M | Sem barra de status explicando a ação atual e os modificadores. |
| I3 | M | Sem folha de atalhos na tecla `?`. Hoje há uma lista no painel de propriedades e o editor de atalhos. |
| I4 | M | Campos numéricos sem scrub (arrastar para mudar o valor). |
| I5 | B | Quase todas as ferramentas usam o cursor de cruz, sem cursor por estado (posar, criar osso, mover junta…). |
| I6 | B | A barra de ferramentas já mostra nome + atalho. Falta conferir os botões dos painéis. |

---

## Etapa 5: Desempenho e estabilidade

| # | Imp. | Achado |
|---|---|---|
| P1 | A | **Sem autosave e sem recuperação depois de travamento.** |
| P2 | M | **Desempenho com 20 camadas × 300 quadros:**<br>• Palco: 0,9 ms por quadro (mediana) e 2,4 ms nos 5% piores.<br>• Troca de quadro completa (palco + timeline + painéis): 7 ms (mediana) e 21 ms no pior caso, no limite para 60 fps.<br>A medição foi feita com o painel oculto. Repetir no Electron, com perfil e arte pesada (pincel, bitmaps, filtros, pele). |
| P3 | B | Desfazer agrupado já funciona em arrastos no palco. Falta conferir campos numéricos e sliders (cada passo do slider pode virar uma entrada). |
| P4 | B | Hoje só pede confirmação ao fechar ou abrir com alterações. Revisar ações em massa: "Tirar ossos" e apagar da biblioteca. |

---

## Etapa 6: Polimento visual

- Avaliar nesta etapa: espaçamento, ícones, cores e estados de hover, ativo e desativado.
- Observações da auditoria:
  - textos de ajuda longos nos painéis;
  - o layout dos painéis já é salvo;
  - o menu de contexto apareceu com atraso nas capturas (confirmar no Electron).

---

## Histórico

- **Etapa 0:** auditoria feita e este arquivo criado. Nenhum código foi alterado.
- **Etapa 1:** rigging refeito, com modos, rig único por camada, vínculo visível, IK estável com FK, pinos e limites, auto-key, ações de pose e painel de hierarquia.
  - 87 testes passando, `npm run check` ok e `npm run smoke` (Electron) ok.
  - Testado com mouse no app: boneco de 8 ossos e ciclo de caminhada com espelhar e copiar/colar pose.
  - Commit e6a1b6d (junto com a Etapa 2), enviado ao GitHub.
- **Etapa 2:** pincel e lápis com estabilizador e pressão certa; palco congelado durante o traço; seleção com Alt, destaque e arraste pelo vão; alças com girar visível e medidas; borracha só na camada ativa e respeitando ossos; conta-gotas sem trocar de ferramenta.
  - 92 testes passando (5 novos em `test/drawing.test.js`), `npm run check` ok e `npm run smoke` (Electron) ok.
  - Testado com mouse e caneta simulada no app.
  - Commit e6a1b6d (junto com a Etapa 1), enviado ao GitHub.
- **Etapa 3:** Shift+clique e menu agindo no intervalo; arrastar keyframes e quadros (Alt copia); colar substituindo; Ctrl+T e easing com um clique; alças do onion skin na régua; zoom da timeline; faixa de reprodução.
  - 98 testes passando (6 novos em `test/timeline.test.js`), `npm run check` ok e `npm run smoke` (Electron) ok.
  - Testado com mouse no app: bola com 3 keyframes, tween no intervalo, faixa 1–12 em loop, keyframe arrastado e cópia por arraste.
  - Commit 81d1b78, enviado ao GitHub.
- **Etapa 4:** menu do palco, barra de status, folha de atalhos (?), scrub nos campos, cursores e mensagens de erro claras.
  - Mais, a pedido: atualização automática pelo GitHub, instalador e desinstalador novos com animações e ícone novo. Versão 0.2.0.
  - 101 testes passando, instalação, atualização e desinstalação testadas no Windows.
