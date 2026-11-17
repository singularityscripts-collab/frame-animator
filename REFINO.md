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
| 2 | Desenho e seleção | **pronta** (esperando "próxima etapa") |
| 3 | Timeline e animação | pendente |
| 4 | Interface e atalhos | pendente |
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

## Etapa 3: Timeline e animação

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

## Etapa 4: Interface e atalhos

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
  - Ainda sem commit.
- **Etapa 2:** pincel e lápis com estabilizador e pressão certa; palco congelado durante o traço; seleção com Alt, destaque e arraste pelo vão; alças com girar visível e medidas; borracha só na camada ativa e respeitando ossos; conta-gotas sem trocar de ferramenta.
  - 92 testes passando (5 novos em `test/drawing.test.js`), `npm run check` ok e `npm run smoke` (Electron) ok.
  - Testado com mouse e caneta simulada no app.
  - Ainda sem commit.
