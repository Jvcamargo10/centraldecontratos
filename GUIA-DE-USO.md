# Central de Contratos — Guia de uso

Para a equipe da SETEC que usa a Central no dia a dia. A parte técnica
(instalação, regras de leitura, configuração) está no [README](README.md) e no
[SERVIDOR.md](SERVIDOR.md).

## O que é

A Central acompanha os contratos da Secretaria a partir dos **documentos da
pasta de rede** de cada processo. Ela lê os arquivos (contrato, aditivos,
apostilamentos, Ordem de Início, relatórios, apólices), monta o cadastro e
avisa o que vence, o que falta e o que mudou.

Duas regras valem para tudo:

1. **Nada entra no cadastro sem alguém conferir.** O que a Central lê vira uma
   proposta na Fila de importação; só depois de aprovada vira contrato.
2. **Nada é inventado.** Dado que não está escrito no documento fica em branco
   e aparece em Pendências de leitura.

Em toda tela há o botão **Como funciona**, no alto, à direita.

## Quem pode fazer o quê

| Papel | Pode |
|---|---|
| **Consulta** | Ver tudo. |
| **Fiscal** | Ver tudo; registrar no histórico do contrato, comentar, reportar leitura errada, ler relatórios mensais e analisar requisições. |
| **Gestor** | O do fiscal; varrer as pastas, aprovar ou rejeitar propostas, resolver pendências, confirmar encerramentos e mudanças, gerar mapa de risco e ficha, mudar os prazos de alerta de um contrato. |
| **Administrador** | Tudo; contas de acesso, perfis de prazo, UFM, trilha de auditoria. |

Contas: **Configurações > Contas de acesso** (só administrador).

## Rotina sugerida

**Todo dia**
1. **Início** — leia os avisos do topo (pedidos com prazo de resposta,
   requisições do TCE, termos novos para confirmar) e a lista de vencimentos.
2. Número em **amarelo** ao lado de um item do menu = alguma coisa esperando
   ação ali.

**Toda semana** (ou quando arquivarem documento novo na pasta)
1. **Fila de importação > Varrer pastas agora** — lê só o que é novo ou mudou.
2. Revise cada proposta: os campos vêm com a origem (de qual documento saiu).
   **Aprovar** grava no cadastro; **Revisar e aprovar** abre o formulário
   quando algum campo vai mudar um dado que já existe.
3. **Pendências de leitura** — resolva o que ficou sem término, início ou
   valor (quase sempre falta a data da Ordem de Início) e confirme
   encerramentos e mudanças vindas de termos novos.

**Todo mês**
- **Relatórios mensais > Ler as pastas agora** — mostra que mês está sem relatório.
- **Mapa de risco** — atualize as análises dos contratos que mudaram.

## As telas

**Contratos** — a lista, com situação (cor pelo prazo), risco, término, valor
mensal e **valor total**. Clique numa linha para abrir o contrato: visão geral
(risco, relatórios, requisições, garantia), cadastro, aditivos e
apostilamentos, histórico administrativo e comentários.

- **Valor total** = valor da contratação + aditivos e apostilamentos de valor.
- **Valor mensal** = valor total ÷ (meses da contratação + prorrogações).

**Aditivos** e **Apostilamentos** — os termos de cada contrato, com os campos
do formulário do SGC. O ícone de folha abre a **ficha do SGC**: os campos já
preenchidos, para copiar e cadastrar lá. A data mostrada é a da assinatura do
termo (no SGC, o campo é a data do extrato publicado).

**Mapa de risco** — o risco de cada contrato (conteúdo, prazo, financeiro,
gestão), o registro de riscos e problemas e as ações da semana.

**Relatórios mensais** — que meses têm relatório na pasta do processo.

**Requisições** — as do Tribunal de Contas (com prazo de resposta) e as do
SisFin. **Analisar requisição recebida** lê o PDF do Tribunal e aponta, item a
item, a pasta do processo onde está a resposta.

**UFM e gratificação** — o valor de cada contrato em UFM, a faixa e a
gratificação do gestor (GFE). Mudança no valor da UFM vira versão nova; a
anterior fica no histórico.

**Base de dados** — tudo o que foi lido, com a origem de cada campo. É daqui
que se exporta a planilha completa.

**Busca nos documentos** — procura uma palavra em todos os documentos já lidos.

## Histórico administrativo do contrato (treino)

Cada contrato tem um histórico com tudo o que aconteceu com ele: solicitações
do TCE e de diretores, ofícios recebidos e enviados, despachos, notificações à
contratada, reuniões e tratativas internas. É o que responde "o que foi feito
neste contrato e quem fez".

**Registrar**
1. Abra o contrato (Contratos > clique na linha) e use **Registrar no
   histórico** (ou o lápis na lista do Início).
2. Escolha o **tipo** (Solicitação do TCE, Ofício recebido, Despacho...),
   descreva o que foi pedido ou feito e, se houver, o número do documento e
   quem pediu.
3. Se é um pedido que precisa de resposta, informe o **prazo de resposta**: a
   Central avisa no Início quando faltarem 5 dias e quando atrasar.
4. Quando responder, use **Marcar como respondida**.

**O sino na lista de Contratos**
- **Vermelho** — há registro em andamento (pedido sem resposta).
- **Verde** — tudo registrado está encerrado.
- **Neutro** — nada registrado ainda.

**Corrigir** — use **Corrigir** no próprio registro. Nada se apaga: a versão
anterior fica guardada e aparece em "Correções", no próprio registro.

A Central também acrescenta sozinha ao histórico o que lê das pastas
(aditivos, apostilamentos, requisições), para a linha do tempo ficar completa.

**Exercício para a equipe:** escolha um contrato em vigência e registre a
última solicitação do TCE que ele recebeu, com o prazo de resposta. Confira o
sino vermelho na lista e o aviso no Início; depois marque como respondida e
veja o sino ficar verde.

## Prazos de alerta (perfis de trâmite)

Cada contrato entra em **Crítico**, **Atenção** e **Próximo** a um certo
número de dias do término. O **Padrão** é 15 / 30 / 90 dias. Como uma
prorrogação leva menos tempo que uma licitação nova, há perfis com mais
antecedência (Configurações > Alertas de vencimento):

| Perfil | Crítico / Atenção / Próximo | Para |
|---|---|---|
| Padrão | 15 / 30 / 90 dias | todo contrato sem perfil escolhido |
| Prorrogação por aditivo | 30 / 60 / 120 dias | contrato que ainda pode ser prorrogado |
| Nova licitação | 90 / 180 / 365 dias | contrato no limite legal de prorrogação |

Para usar um perfil num contrato: abra o contrato > **Prazos de alerta >
alterar** e diga o motivo (fica na Auditoria). A tela Mapa de risco mostra quais contratos estão no limite de prorrogação.

## Quando algo parece errado

- **Um campo foi lido errado** — clique na bandeirinha **⚑** ao lado do campo
  (Base de dados e Requisições) e registre o valor certo. O administrador
  acompanha em Configurações > Leituras reportadas.
- **Falta um dado** — Pendências de leitura mostra os trechos dos documentos
  que falam do assunto; informe o dado ali (fica marcado como "informado à
  mão", com quem e quando).
- **Um termo novo mudou o término, o valor ou o gestor** — aparece em
  Pendências de leitura para confirmar; o contrato só muda depois disso.
- **Tudo o que foi feito** fica na **Trilha de auditoria** (administrador).
