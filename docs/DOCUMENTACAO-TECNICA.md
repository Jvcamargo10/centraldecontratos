# Central de Contratos — documentação técnica

Sistema interno da Secretaria Municipal de Tecnologia para acompanhar os contratos da secretaria. Os dados saem dos
**documentos da pasta de rede** de cada processo (contrato, aditivos,
apostilamentos, Ordem de Início, relatórios, apólices): a Central lê os
arquivos por regras, propõe o cadastro na **Fila de importação** e só grava
depois que alguém da equipe revisa e aprova. Nada é inventado: campo não
encontrado fica em branco e vai para **Pendências de leitura**.

Telas (menu lateral):

- **Início** e **Painel de indicadores** — vencimentos, avisos e números.
- **Contratos**, **Aditivos** e **Apostilamentos** — o cadastro, com o
  valor mensal, o valor total e o histórico administrativo de cada contrato.
- **Mapa de risco**, **Relatórios mensais**, **Requisições** (TCE-SP e
  SisFin) e **UFM e gratificação** (GFE dos gestores).
- **Fila de importação**, **Base de dados**, **Busca nos documentos** e
  **Pendências de leitura** — de onde vem cada dado e o que falta conferir.
- **Configurações** (recolhível): alertas de vencimento, alertas por e-mail,
  contas de acesso, trilha de auditoria e leituras reportadas.

Outras decisões que valem para o projeto inteiro:

- **Integração com o SGC desligada** desde 23/09/2026: a Central não
  consulta nem grava nada no SGC. A **ficha do SGC** (contrato, aditivo,
  apostilamento, empresa, requisição) traz os campos do formulário
  "Cadastrar" já preenchidos, para conferir e digitar lá.
- **Sem inteligência artificial** desde 01/10/2026: toda leitura é por
  regras, com testes (versão antiga com IA na tag `com-ia` do git).
- Sistema **interno**: não indexado por buscadores (`noindex` e
  `robots.txt`).

Para quem vai usar no dia a dia: **[GUIA-DE-USO.md](../GUIA-DE-USO.md)**.
Para instalar num servidor: **[SERVIDOR.md](../SERVIDOR.md)**.

## Requisitos

- [Node.js](https://nodejs.org) 18 ou mais recente (inclui o `npm`).

## Como rodar

Abra um terminal na pasta do projeto e rode:

```bash
npm install
npm start
```

Depois abra o navegador em:

```
http://localhost:3001
```

(Porta 3001 por padrão — veja "Mudar a porta" mais abaixo se precisar de outra.)

## Login

- **Usuário:** `admin`
- **Senha:** `itaverde2026`

Isso está com o valor fixo em `db.js` (função `seed`) só para a demonstração
funcionar de imediato. Antes de qualquer uso além de um teste local, troque
essa senha (apague `data.json`, edite o `bcrypt.hashSync(...)` em `db.js` e
rode `npm start` de novo) e, se for expor o app numa rede, defina a variável
de ambiente `SESSION_SECRET` com um valor aleatório.

### Login com a conta da Prefeitura (Entra ID / Azure AD) — 06/10/2026

Com o Entra ID ligado, a tela de login mostra **"Entrar com a conta da
Prefeitura"** — a mesma conta do e-mail, do Teams e do SGC. A Central não
guarda senha dessas pessoas; quem tem a conta desativada no AD perde o
acesso aqui na hora. Código: `integrations/loginEntra.js` (OpenID Connect
com PKCE, sem pacote novo); testes: `testes/loginEntra.test.js`.

- **Quem pode o quê continua aqui**, em Administração › Contas de acesso:
  cada conta tem papel (admin, gestor, fiscal, consulta) e, agora, o
  **e-mail da Prefeitura**. A conta é ligada pelo e-mail (ou pelo usuário
  igual ao e-mail ou ao que vem antes do @) e, no primeiro login, fica
  presa ao identificador fixo da pessoa no AD.
- **Sem conta na Central** (padrão `ENTRA_SEM_CADASTRO=bloquear`): a pessoa
  não entra e aparece em **Pedidos de acesso** na tela Contas de acesso;
  "Liberar acesso" cria a conta já ligada, só escolhendo o papel. Com
  `ENTRA_SEM_CADASTRO=consulta`, entra direto só para consulta.
- **Contas com senha continuam valendo**, para acesso de emergência (a
  Microsoft ou a internet fora do ar). Deixe pelo menos um admin com senha
  forte — e troque a senha padrão do `admin`.
- Sair da Central encerra só a sessão da Central; a conta Microsoft
  continua logada no navegador, como em qualquer sistema da Prefeitura.

**O que a TI precisa fazer (uma vez), no portal do Entra ID:**

1. *Registros de aplicativo › Novo registro*: nome "Central de Contratos", só
   contas deste diretório (locatário único).
2. *Autenticação › Adicionar plataforma › Web*, com o endereço de retorno
   (URI de redirecionamento):
   - nesta máquina: `http://localhost:3001/auth/entra/retorno`;
   - no servidor: `https://<endereço da Central>/auth/entra/retorno` (a
     Microsoft exige HTTPS fora do localhost).
3. *Certificados e segredos › Novo segredo do cliente*: copiar o **valor**.
4. Permissões: as padrão (`openid`, `profile`, `email`, `User.Read`)
   bastam — não precisam de consentimento de administrador.
5. Opcional, para limitar quem pode tentar: em *Aplicativos empresariais ›
   Central de Contratos › Propriedades*, "Atribuição necessária" = Sim, e atribuir
   o grupo da SETEC.
6. Passar para quem cuida da Central: **ID do diretório (tenant)**, **ID
   do aplicativo (cliente)** e o **segredo**. No `.env`:

```
ENTRA_TENANT_ID=<ID do diretório>
ENTRA_CLIENT_ID=<ID do aplicativo>
ENTRA_CLIENT_SECRET=<valor do segredo>
# No servidor, o endereço exato cadastrado no passo 2:
# ENTRA_REDIRECT_URI=https://<endereço da Central>/auth/entra/retorno
```

Reinicie o servidor; no console aparece "Login com a conta da Prefeitura
(Entra ID): ligado". O segredo do cliente vence (a TI escolhe: 6 a 24
meses) — quando vencer, o login pela Microsoft para de funcionar e as
contas com senha continuam entrando; peça um segredo novo e troque no
`.env`.

**Modo de teste (temporário):** aberta no próprio computador
(`localhost`), a tela de login vem com essa conta já preenchida; aberta
pela rede, de outra máquina, vem vazia. Para desligar, ponha
`LOGIN_PREENCHIDO_EM_TESTE=0` no `.env` — e troque a senha padrão em
"Contas de acesso" antes de liberar o uso.

## Interface (sistema de design)

Revisada em 22/09/2026. Decisões, para manter a consistência:

- **Identidade visual (07/10/2026)**: azul institucional `#345a88`
  (escuro `#1a3a5c` no menu lateral, claro `#457aa3`), verde-água `#70c7aa`
  de destaque (item ativo do menu), fundo `#f0f5fb`, cantos de 10 px, topo de
  64 px e a fonte **Inter**. A marca fica no menu (recolhido, só o ícone) e
  no login: painel azul com a marca à esquerda e o cartão "Bem-vindo" à
  direita; com o Entra ID ligado, o botão é "Entrar com conta institucional".
  - `public/img/logo.svg`, `public/img/marca.svg` e `public/favicon.svg`:
    a marca da Central (texto branco, para fundo escuro).
  - `public/fonts/inter-latin-wght.woff2`: Inter variável (pesos 100 a 900,
    só caracteres latinos, 48 KB), servida pelo próprio sistema — não
    depende de internet. Licença OFL em `LICENSE-Inter-OFL.txt`.
- **Tokens de design** em `public/css/tokens.css`: paleta (marca, neutros
  e semântica ok/aviso/erro/info, cada uma com texto, fundo e borda),
  raios, sombras, foco, fonte e o degradê da marca. Cor nova entra como
  token, não como hexadecimal solto no JS.
- **Código da interface (07/10/2026)**: JavaScript moderno em módulos ES
  (`<script type="module">`, `import`/`export`), sem framework e sem etapa
  de build — o navegador carrega os arquivos de `public/js/` como estão.
  Os botões chamam `app.algumaCoisa()` no HTML: função nova usada assim
  precisa entrar no objeto `window.app` (fim do `js/app.js`), porque o
  que fica dentro do módulo não é global.
- **Tabelas de trabalho** (Base de contratos, Mapa de risco): filtro em
  botões com a contagem de cada opção (`segmentos()`); cartões de resumo
  clicáveis que aplicam o filtro; título da coluna ordena (`thOrdenavel()`,
  número do contrato ordena por ano e número); linha inteira abre o
  detalhe; em tabela larga, a coluna "Contrato" e o botão "Ver" ficam
  fixos nas bordas; valores alinhados à direita; CNPJ formatado; filtro
  sem resultado oferece "limpar filtros". Ação principal com nome
  ("Gerar análise", "Ver análise"), não só ícone.
- **Fila de importação** (layout aprovado em 22/09/2026): lista das
  propostas à esquerda (busca, seletor de situação Pendentes / Com problema /
  Aprovadas / Rejeitadas / Todas, e etiquetas do que pede atenção:
  inferidos, "muda N campos do contrato", poucos dados, campos
  encontrados/14) e a proposta aberta à direita, com os campos agrupados
  e a origem de cada um (texto, cálculo, à mão). "Muda" compara o
  valor, não a grafia (CNPJ com/sem pontos, maiúsculas, sigla no fim da
  secretaria). **Aprovar** direto só aparece quando não há campo inferido
  nem campo que troque o cadastro, e mantém a grafia do cadastro nos campos
  iguais. Nos outros casos aparece **Revisar e aprovar**, que abre o
  formulário. Depois de decidir, abre a próxima pendente. Teclado: ↑/↓, A, R.
  "Selecionar arquivos manualmente" e "Recalcular" ficam em "Mais ações".
- **Número no menu**: âmbar é pendência (propostas esperando revisão) e
  neutro é quantidade (contratos cadastrados). Cor diferente para sentido
  diferente — senão todo número vira alerta.
- **Filtro em botão** (`seletorDeFiltro`): cada opção tem ícone, cor,
  contagem e uma linha explicando o que é. O ícone carrega o significado;
  a cor só reforça — quem não distingue cores continua entendendo.
- **Menu lateral recolhível**: o botão redondo no meio da borda direita do menu (ou a tecla `[`) recolhe o menu para só os ícones; o nome aparece ao passar o mouse. A escolha fica guardada no navegador. No celular o menu abre pelo botão ☰ e fecha ao escolher uma tela, ao tocar no fundo escuro ou com a tecla Esc; enquanto está aberto, a página de trás não rola. Sem escolha guardada, em telas médias (tablet, notebook pequeno, até 1180 px) o menu já começa recolhido.
- **Telas em qualquer largura**: nenhuma tela rola a página para o lado. Tabelas largas rolam dentro do próprio quadro; no celular (até 640 px) cada linha vira um cartão "coluna: valor", e o cabeçalho vira uma fila de botões para ordenar. Os botões do topo das telas quebram linha. Para leitor de tela, as tabelas mantêm os papéis de tabela, linha e célula. Conferido de 320 px a 1280 px em todas as telas do menu.
- **Tabela de Contratos** no modelo da Base de dados: clique no título de uma coluna para ordenar, clique na linha para abrir os detalhes; o número do contrato fica fixo à esquerda e as ações ("Ver" e histórico de tratativas) fixas à direita. Em todas as tabelas a coluna "Ações" tem o título visível.
- **Fora dos buscadores**: é um sistema interno da Prefeitura. A página traz `<meta name="robots" content="noindex, nofollow">` e o `public/robots.txt` bloqueia tudo — por isso a nota de SEO do Lighthouse fica baixa de propósito.
- **Respostas comprimidas (gzip)**: a página, os CSS e JS e as respostas da API saem comprimidos para o navegador (integrations/compressao.js, sem pacote novo). No Lighthouse (02/10/2026): Desempenho 99 no celular e 100 no computador; Acessibilidade e Boas práticas 100. Se o Lighthouse do navegador mostrar "!" em Desempenho com o aviso de limpeza de cache, é falha da própria medição: rode de novo numa janela anônima.
- **Janelas (modais)**: cabeçalho fixo (título + subtítulo `.modal-sub` +
  fechar) e rodapé de ações fixo, corpo rolando entre os dois; seções com
  `.modal-secao` + `<h4>`; resumos em `.resumo-blocos`. Esc fecha, o foco
  vai para a janela ao abrir e volta ao fechar, e a página de fundo não
  rola. Tamanhos: padrão, `.wide` e `.xl`.
- **Menu por tarefa**: Visão geral · Contratos · Documentos ·
  Qualidade de dados · Administração. O título de cada tela é o mesmo
  nome do menu. A Fila de importação mostra no menu quantas propostas
  estão pendentes.
- **Revelação progressiva**: explicação de "como a tela funciona" e
  detalhes técnicos (variáveis de ambiente, IDs) ficam recolhidos
  (`ajuda()` em `js/ui.js`); a tela abre direto no que interessa.
- **Avisos padronizados** (`.callout-info/ok/warn/err`): amarelo só para o
  que pede atenção (ex.: aprovação que vai sobrescrever dado oficial do SGC).
- **Proposta da Fila** em cartão compacto: título pelo número do contrato,
  campos em grade, ações ao lado da situação; origem dos dados, cálculos e
  arquivos lidos recolhidos. O valor lido não mostra "confiança": a regra
  só preenche quando o padrão inteiro está no texto.
- **Datas curtas** (dd/mm/aaaa) em todo o app; números alinhados à direita.
- **Carregamento** com esqueleto no formato do conteúdo, não "Carregando...".
- **Teclado e acessibilidade**: foco visível, `/` vai para a busca, `Esc`
  fecha janelas, menu navegável por teclado, avisos anunciados a leitores
  de tela e com o texto escapado; animações respeitam "reduzir movimento".

## Módulo 1 — Alertas de Vencimento de Contratos

O que já funciona:

- **Painel "Início"** com contagem de contratos por faixa de urgência
  (Vencido, Crítico, Atenção, Próximo, Confortável), gráfico de distribuição
  e uma seção de **Avisos** agrupando os contratos que pedem atenção, do mais
  urgente ao menos urgente.
- **Contratos** — lista com busca e filtros (por situação e por tipo de
  serviço) e **exportação da lista para CSV**. Os dados do contrato em si
  (empresa, tipo, início, término, valor, status) vêm do SGC via
  sincronização — não há mais cadastro, edição nem exclusão manual aqui; o
  acompanhamento interno é feito pelo histórico de tratativas.
- **Tratativas** — cada contrato tem um histórico de acompanhamento próprio:
  é possível registrar uma nota (com status "Em andamento" ou "Resolvido") e
  consultar tudo o que já foi registrado, direto a partir da lista de
  contratos ou do painel de avisos.
- **Configurações de alerta** — os limiares de dias que definem as faixas
  Crítico / Atenção / Próximo são ajustáveis pela própria interface, sem
  precisar mexer em código.
- Login com sessão real no servidor, validação no back-end, toasts em vez de
  alertas do navegador, confirmação de exclusão num modal próprio, e menu
  lateral responsivo (vira um menu "hambúrguer" em telas estreitas).

## Módulo 2 — Painel de Indicadores de Contratos

Painel consolidado, complementar ao de Alertas: valor mensal total
contratado, distribuição por secretaria e por tipo de serviço, evolução de
contratos por ano de início e top empresas por valor contratado — uma visão
de indicadores para quem acompanha o conjunto dos contratos, não só os que
estão vencendo.

## Módulos removidos

Para não confundir quem lê este documento com telas que não existem mais
(o `db.js` apaga os dados deles de um `data.json` antigo na primeira
gravação — e, desde 08/10/2026, só se estiverem vazios):

- **Central de apoio a ETP/TR**, **Biblioteca de Modelos**, **Documentos**,
  **Onboarding / Offboarding** e **Minhas pendências** — protótipo do ERP,
  sem uso na Central.
- **Cadastros genéricos do ERP** (08/10/2026): funcionários, empresas, IOM,
  portarias, secretarias, grupos, unidades, usuários, políticas, termos de
  aceite e banner de aviso, com o visualizador genérico de registros e o
  item de menu "Em breve". Nenhum tinha registro nem tela.

## Aditivos e Apostilamentos (07/10/2026)

Duas telas no menu Contratos, no mesmo formato da tela de Contratos e com
os campos do formulário "Cadastrar aditivo / apostilamento" do SGC
(sgc.itaverde.gov.br/cadastrar), lidos no SGC só para consulta:

- **Lista**: cartões (total, de contratos em vigência, prorrogações ou
  mudanças de gestor, empresa com mais termos em vigência), busca, filtro
  por tipo e pela situação do contrato, colunas ordenáveis e CSV.
- **Página de cada termo** (`#/aditivo/ID`, `#/apostilamento/ID`), nos
  grupos do formulário do SGC: termo (número, tipo, data, objeto, contrato,
  IOM, portaria), vigência (meses prorrogados e nova data de término),
  valores, gestor e suplente, e arquivo. Traz também os outros termos do
  mesmo contrato e o botão da ficha do SGC (os campos já preenchidos, para
  conferir e cadastrar lá).
- O detalhe do contrato lista os aditivos e apostilamentos dele, e a busca
  do topo também procura termos.

De onde vêm: os termos lidos dos documentos da pasta de rede e aprovados
na Fila de importação (`db.aditivos` e `db.apostilamentos`). Não há
cadastro manual — a escolha foi manter a pasta como fonte única. Termos de
propostas ainda pendentes aparecem só como contagem.

Diferenças em relação ao SGC, ditas na própria tela:

- a **data** é a da assinatura do termo; no SGC é a do extrato publicado;
- **IOM e portaria** não são lidos dos documentos e ficam em branco;
- a **garantia** fica na visão do contrato (apólice), não no termo.

Servidor: `GET /api/termos/aditivos` e `GET /api/termos/apostilamentos`
(`integrations/listaTermos.js`, testes em `testes/listaTermos.test.js`).
O termo relido mantém o id (os links `#/aditivo/ID` não mudam a cada
recálculo).

### Valor total do contrato

Definição (usuário, 07/10/2026), a mesma do SGC:

- **valor total** = valor da contratação + aditivos e apostilamentos de valor;
- **valor mensal** = valor total ÷ (meses da contratação + aditivos e
  apostilamentos de prazo).

O valor total aparece em Contratos (coluna ordenável, detalhe do contrato e
CSV) e na Base de dados (coluna e planilha). O rodapé das duas tabelas soma o
valor total dos contratos listados (e, em Contratos, o mensal dos que estão
em vigência). Sai do cálculo guardado na proposta aprovada
(`integrations/valorTotalContrato.js`) e só é mostrado quando a média desse
cálculo é o valor mensal gravado — senão fica "—" (por exemplo, valor
mensal informado à mão). Conferido em 07/10/2026: 43 dos 49 contratos têm o
total, e em todos a média fecha com o mensal ao centavo.

### Mudanças vindas de termos novos

Término, valor mensal e gestor/suplente de um contrato aprovado só mudam
com confirmação. Aparecem em Pendências de leitura (com contador no menu e
aviso no Início):

1. **termo novo arquivado na pasta**: a varredura cria uma proposta nova
   para o contrato; a pendência mostra o que muda e leva à Fila — aprovar é
   a confirmação;
2. **regra de leitura melhorada**: o "Recalcular pelas regras" relê o
   contrato aprovado (só a aprovação mais recente) e o que diferir vira
   pendência para confirmar ou descartar campo a campo; a decisão vai para
   a Auditoria e descartar não volta a sugerir o mesmo valor.

Não sugere apagar dado, trocar dado informado à mão, nem mexer em contrato
encerrado. Ver `integrations/mudancasPorTermos.js` e
`testes/mudancasPorTermos.test.js`.

## Onde ficam os dados

Na primeira execução, o servidor cria um arquivo `data.json` nesta mesma
pasta, com dados fictícios de exemplo para todos os módulos — incluindo 18
contratos propositalmente distribuídos entre vencidos, críticos, em atenção,
próximos e confortáveis, para que o painel de alertas já nasça com o que
mostrar — e o usuário de login padrão. A partir daí, qualquer alteração feita
pela interface é salva automaticamente nesse arquivo, de forma atômica (grava
num arquivo temporário e só então substitui o `data.json`), para reduzir o
risco de corromper o arquivo se o processo cair no meio de uma gravação.

## Levar para um servidor

A estrutura para sair desta máquina está pronta (30/09/2026): tudo o que
muda é configuração no `.env`, com o comportamento de hoje como padrão.
Roteiro, lista do que muda e cuidados em **[SERVIDOR.md](../SERVIDOR.md)**.
Peças: `integrations/configServidor.js` (configuração num lugar só),
`integrations/sessoesArquivo.js` (sessões que sobrevivem a reinício),
`integrations/trocaDeRaiz.js` + `npm run trocar-raiz` (caminhos de `F:\`
para `\\servidor-arquivos...`, no `data.json` e no cache), `npm run verificar-servidor`
(diagnóstico) e `ferramentas/servidor/instalar-servico.ps1` (modelo de
serviço do Windows).

## Mudar a porta

Por padrão o servidor sobe na porta **3001** (já ajustado em `server.js` para
não conflitar com outros projetos seus rodando na 3000). Se precisar de outra
porta, defina a variável de ambiente `PORT` antes de `npm start`:

```powershell
# PowerShell (Windows)
$env:PORT=3002; npm start
```

```bash
# macOS/Linux
PORT=3002 npm start
```

## Como resetar para o estado inicial

Com o servidor parado, apague o arquivo `data.json` e rode `npm start`
novamente.

## Estrutura do projeto

```
central-contratos-app/
├── package.json     # dependências e scripts "start" e "test"
├── server.js         # servidor Express + rotas da API (/api/...) + login/sessão
├── db.js              # estrutura inicial e leitura/gravação do data.json (com backup)
├── data.json          # criado automaticamente na primeira execução
├── backups/           # cópia diária do data.json, feita antes da 1ª gravação do dia
├── .env.example       # modelo de configuração (copie para .env)
├── integrations/
│   ├── contratosApi.js        # conector plugável para a API real de contratos (SGC)
│   ├── servidorArquivos.js    # varredura das pastas de rede, agrupada por contrato
│   ├── extratorDocumento.js   # texto de PDF/DOCX, com OCR quando é digitalização
│   ├── leituraPorRegra.js     # campos do contrato lidos por regra (número, CNPJ, vigência, valor...)
│   ├── ingestaoContratos.js   # Ferramenta 1: orquestra arquivo -> regras -> fila de revisão
│   ├── mapaRiscoContratos.js  # Ferramenta 2: mapa de risco por contrato
│   ├── fichaCadastroContrato.js / fichaCadastroPdf.js  # Ferramenta 3: ficha do SGC em PDF
│   ├── graphMail.js / resumoAlertas.js  # resumo diário de vencimentos por e-mail
│   └── fichas-cadastro/       # PDFs gerados pela Ferramenta 3 (fora de public/, de propósito)
├── testes/            # regressão das falhas que já aconteceram (node --test, sem dependência)
├── public/
│   ├── index.html      # só o esqueleto: liga os CSS e o js/app.js
│   ├── css/            # estilo em arquivos, na ordem da cascata (a ordem dos <link> importa):
│   │                   #   tokens, base, layout, componentes, telas, interacao, paginas, acesso, responsivo
│   ├── js/             # módulos ES (import/export), sem etapa de build:
│   │   ├── app.js      #   telas, rotas e estado da interface (ponto de entrada)
│   │   ├── api.js      #   conversa com o servidor (/api/...)
│   │   ├── ui.js       #   peças de interface: ícones, cards, tabelas, filtros, ajuda
│   │   └── util.js     #   funções puras: escape de HTML, datas, dinheiro, comparação
│   ├── img/            # logo e brasão da Prefeitura
│   ├── fonts/          # fonte Inter (OFL)
│   └── favicon.png
└── README.md
```

### Avaliação da extração contra o SGC

Mede, campo por campo, quanto cada método de extração acerta, usando o
**SGC como gabarito**. É a base para construir um extrator especializado
nos contratos da Prefeitura: sem essa medição, melhorar a extração vira
tentativa e erro.

```bash
npm run avaliacao:extrair
npm run avaliacao
```

O primeiro comando lê (com OCR, quando o PDF é digitalizado) os
documentos da pasta **"3. Contratos, Aditivos e Termos"** de cada processo
que tem contrato no SGC — é demorado, mas roda uma vez; depois só processa
o que for novo ou alterado. O texto fica em `ferramentas/avaliacao/cache/`
(com CPF mascarado, fora do controle de versão). O segundo comando compara
em segundos.

Como o casamento funciona: cada processo tem uma pasta "P.A. 01.275_2025 -
..." na rede, e os contratos do SGC têm o número do processo no campo `pa`.
Em 21/09/2026 eram **24 processos casados**, com **221 documentos**.

Para cada campo, além de acerto/erro/vazio, a avaliação mostra se o valor
do SGC **aparece escrito nos documentos** — o teto de qualquer método. Se
a vigência do SGC não está nos PDFs, nenhum extrator vai achá-la: a solução
aí é outra fonte, não um extrator melhor.

### Testes

```bash
npm test
```

Roda sem rede e sem dependência externa (`node --test`), com um `db` em
memória. **Não é cobertura por
cobertura** — cada teste corresponde a uma falha que já aconteceu de
verdade neste projeto, e o comentário de cada um descreve o sintoma que
o usuário viu. Quando um deles quebrar, leia o comentário antes de
"consertar".

## Segurança (revisada em 24/09/2026)

**O que o sistema tem:**

- **Acesso só desta máquina por padrão.** O servidor escuta em
  `127.0.0.1`; da rede, nem responde. Para abrir na rede da Prefeitura:
  `HOST=0.0.0.0` no `.env` — só depois de trocar a senha padrão e, de
  preferência, com HTTPS na frente (proxy reverso). Antes desta revisão,
  o servidor escutava em todas as interfaces com a senha padrão ativa.
- **Contas com perfis** (admin, gestor, fiscal, consulta), senhas com
  bcrypt, mínimo de **10 caracteres** para senha nova. "Consulta" é só
  leitura: não registra tratativa nem comentário (o servidor recusa e a
  tela esconde os botões). Sincronização com o SGC: só admin.
- **Login protegido:** 5 senhas erradas para o mesmo usuário (ou 20 do
  mesmo computador) bloqueiam por 15 minutos; sessão nova a cada login;
  usuário inexistente leva o mesmo tempo para responder (não revela quem
  existe); entradas, falhas e bloqueios vão para a Trilha de auditoria.
- **Segredo da sessão** (`SESSION_SECRET`) aleatório no `.env`, gerado em
  24/09/2026. Cookie de sessão `HttpOnly` e `SameSite=Lax` (e `Secure`
  com `NODE_ENV=production`); expira em 8 horas.
- **Cabeçalhos de segurança** (`integrations/seguranca.js`): a página só
  carrega o que vem do próprio servidor (CSP), não pode ser embutida em
  outro site, respostas da API sem cache no navegador.
- **Requisições de outra origem recusadas** (CSRF): POST/PUT/DELETE vindo
  de página de outro site recebe 403.
- **Erros sem vazamento:** erro inesperado responde "Erro interno do
  servidor" e só o console registra o detalhe (antes, o Express devolvia o
  rastro do código ao navegador).
- **Dependências sem vulnerabilidade conhecida** (`npm audit` em
  24/09/2026, depois de atualizar o `qs` do Express).
- **Texto digitado nunca vira código na página** (revisado em
  29/09/2026): tratativa, comentário, nomes e todo dado lido dos
  documentos passam por escape antes de ir para a tela. A tratativa não
  passava — um fiscal podia gravar um texto que rodaria no navegador de
  quem abrisse o histórico.
- **LGPD:** CPF mascarado em todo texto guardado (ver "Máscara de CPF
  reforçada"); nenhum texto de contrato sai desta máquina (a leitura é
  toda por regra, local); exportações registradas na auditoria; planilhas exportadas com
  fórmulas neutralizadas.

**O que ainda depende de decisão ou de infraestrutura:**

- **Trocar a senha padrão do admin** (o servidor avisa ao iniciar enquanto
  ela estiver ativa). O login preenchido automaticamente é o modo de
  teste pedido pelo usuário e só acontece quando o sistema é aberto na
  própria máquina — para desligar, `LOGIN_PREENCHIDO_EM_TESTE=0` no
  `.env`.
- **HTTPS**, se o sistema for aberto na rede.
- **Sessão em memória:** reiniciar o servidor desconecta todo mundo.
- **Backups antigos** em `backups/` guardam o texto de antes da máscara
  reforçada e os dados do SGC; a retenção é decisão da Prefeitura.
- **Dados em disco sem criptografia** (`data.json`, `.texto-cache`):
  proteja a pasta do projeto com as permissões do Windows.

## Integração com uma API real de contratos

A Central de Contratos já vem com um conector "plugável" pronto para importar
contratos de um sistema real (por exemplo, o SGC da Prefeitura, ou qualquer
outro sistema que exponha uma API de contratos) — módulo
`integrations/contratosApi.js`. Ele fica **totalmente inativo** enquanto as
variáveis de ambiente abaixo não forem definidas; até lá, o app continua
funcionando 100% com os dados locais, exatamente como hoje.

Existe uma tela **Integração de Contratos** no menu (grupo "Integrações")
que mostra se a integração está configurada, quando foi a última
sincronização e um botão para sincronizar sob demanda.

### O que a Prefeitura precisa fornecer

- A URL da API de contratos.
- O método de autenticação usado (token Bearer, chave de API num header, ou
  usuário/senha) e a credencial correspondente.
- A confirmação de que essa máquina (ou a rede onde ela roda) tem acesso a
  essa API — se for uma API interna, pode exigir estar na rede da Prefeitura
  ou numa VPN.

### Como configurar

A forma mais simples: copie `.env.example` (nesta mesma pasta) para um
arquivo chamado `.env`, e preencha os valores reais nele. O servidor lê
esse arquivo sozinho ao iniciar — não precisa digitar nada no terminal toda
vez, e o `.env` nunca é commitado nem sai desta máquina (já está no
`.gitignore`).

```bash
CONTRATOS_API_URL=https://sistema-real.itaverde.gov.br/api/contratos
CONTRATOS_API_AUTH_TYPE=bearer        # none | bearer | apikey | basic | azuread
CONTRATOS_API_TOKEN=coloque-o-token-aqui
# ou, para autenticação por chave de API num header:
# CONTRATOS_API_AUTH_TYPE=apikey
# CONTRATOS_API_KEY=coloque-a-chave-aqui
# CONTRATOS_API_KEY_HEADER=x-api-key   # nome do header esperado pela API (padrão: x-api-key)
# ou, para usuário/senha:
# CONTRATOS_API_AUTH_TYPE=basic
# CONTRATOS_API_USER=usuario
# CONTRATOS_API_PASSWORD=senha
```

### Caso específico: SGC (autenticação via Azure AD)

O SGC exige um token Bearer emitido pelo Azure AD (Entra ID), obtido pelo
fluxo *client credentials* (tenant + client_id + client_secret). O conector
já sabe buscar esse token sozinho — e cachear até perto de expirar, para
não pedir um novo a cada sincronização:

```bash
CONTRATOS_API_URL=https://sgc.itaverde.gov.br/api-node/contrato/todos
CONTRATOS_API_AUTH_TYPE=azuread
CONTRATOS_API_AZURE_TENANT_ID=11111111-2222-4333-8444-555555555555
CONTRATOS_API_AZURE_CLIENT_ID=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee
CONTRATOS_API_AZURE_CLIENT_SECRET=coloque-o-client-secret-aqui
# Escopo do token (normalmente "api://<client_id-da-API>/.default"):
CONTRATOS_API_AZURE_SCOPE=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/.default
```

O `tenant_id` e o `client_id` acima não são segredo (são identificadores
públicos do App Registration) — quem tem é o **client_secret**, que
precisa ser gerado por quem administra esse App Registration no Azure AD
(gera-se em "Certificados e segredos" do registro do aplicativo). Cole o
valor só no `.env` local; se o escopo configurado não for aceito, a
mensagem de erro do Azure AD aparece na tela "Integração de Contratos" e
ajuda a identificar o escopo correto.

### Aditivos, Apostilamentos, Requisições e Gratificações

Além de Contratos, o mesmo conector também sabe importar Aditivos,
Apostilamentos, Requisições e Gratificações — cada um com sua própria
variável de URL, usando a mesma autenticação já configurada acima:

```bash
CONTRATOS_API_URL_ADITIVOS=https://sgc.itaverde.gov.br/api-node/aditivo/todos
CONTRATOS_API_URL_APOSTILAMENTOS=https://sgc.itaverde.gov.br/api-node/apostilamento/todos
CONTRATOS_API_URL_REQUISICOES=https://sgc.itaverde.gov.br/api-node/requisicao/todos
CONTRATOS_API_URL_GRATIFICACOES=https://sgc.itaverde.gov.br/api-node/gratificacao/todos
```

Cada uma fica inativa até sua URL ser definida — pode ligar uma de cada
vez, sem afetar as outras nem a de Contratos. O botão "Sincronizar agora"
da tela **Integração de Contratos** dispara todas de uma vez; a tela
mostra o status (ativo/aguardando configuração) e o resultado da última
sincronização de cada uma separadamente.

**Antes de ligar cada uma, o mesmo ajuste de role já feito duas vezes no
SGC precisa ser repetido na rota correspondente** (`AditivoRoute.js`,
`ApostilamentoRouter.js`, `RequisicaoRouter.js`, `GratificacaoRouter.js`),
adicionando `"Contratos.Read.All"` à lista de roles aceitas — do
contrário a sincronização falha com 401 mesmo com a URL certa. É o mesmo
processo (branch + merge request + deploy) usado para liberar
`/contrato/todos` e a rota de usuários.

Os nomes dos campos usados no mapeamento de cada uma (`mapearAditivoOu
ApostilamentoExterno`, `mapearRequisicaoExterna`, `mapearGratificacaoExterna`,
em `integrations/contratosApi.js`) ainda são um "chute" a partir dos nomes
mais comuns — nenhuma dessas 4 rotas foi testada com dados reais ainda
(diferente de Contratos, cujo formato real já foi confirmado). Assim que
uma URL for ligada, rode uma sincronização e confira `resumo.erros` /
`resumo.ignorados` na tela de Integração — se algum registro não bater,
ajuste a função de mapeamento correspondente para os nomes de campo reais
daquela rota, do mesmo jeito que foi feito para `mapearContratoExterno`.

Se preferir, também dá para definir essas mesmas variáveis diretamente no
terminal antes de `npm start` (útil se estiver usando um gerenciador de
processos como PM2, que já tem seu próprio jeito de passar variáveis de
ambiente) — o `.env` é só a forma mais prática para rodar localmente.

### O que a sincronização faz (e o que ela nunca toca)

Ao clicar em "Sincronizar agora" (ou chamar `POST
/api/integracoes/contratos/sincronizar`), o servidor busca os contratos na
API externa e, para cada um:

- se o **número do contrato já existe** localmente, atualiza só os campos
  "oficiais" (empresa, tipo de serviço, início, término, valor, status);
- se **não existe**, cria um novo contrato marcado como importado, com os
  campos próprios da Central de Contratos (secretaria, responsável, e-mail do
  responsável, observações) em branco, para alguém completar depois.

Importante: **secretaria, responsável, e-mail do responsável e observações
nunca são sobrescritos pela sincronização**, mesmo em contratos já
importados — são campos que só existem aqui e continuam sendo mantidos por
quem usa a Central de Contratos, não pela API externa.

### Ajustando ao formato real da API

Como o formato exato de resposta de cada sistema é diferente, o conector já
tenta alguns nomes de campo comuns (`numero`/`numeroContrato`,
`empresa`/`razaoSocial`, datas em ISO ou `dd/mm/aaaa` etc.) — mas o
recomendado é, assim que a documentação da API real estiver disponível,
abrir `integrations/contratosApi.js` e ajustar as funções
`extrairListaDeContratos()` (onde fica a lista de contratos dentro da
resposta) e `mapearContratoExterno()` (o "de-para" dos nomes de campo) para
o formato exato. Nenhuma outra parte do sistema precisa mudar.

## Ingestão automatizada de contratos a partir da pasta de rede (Ferramenta 1)

Além da integração por API acima, a Central de Contratos também sabe ler os arquivos
de contrato (PDF/DOCX) direto de uma ou mais pastas de rede da Prefeitura,
propor os campos automaticamente e deixá-los prontos para alguém revisar e
aprovar — pensado para os casos em que não existe (ainda) uma API de
contratos, só os arquivos na rede mesmo. Módulos envolvidos:
`integrations/servidorArquivos.js` (varredura das pastas),
`integrations/extratorDocumento.js` (extração de texto do PDF/DOCX),
`integrations/leituraPorRegra.js` (leitura dos campos por regra) e
`integrations/ingestaoContratos.js` (orquestrador + fila de revisão). Assim
como a integração por API, fica **totalmente inativa** enquanto
`CONTRATOS_ARQUIVOS_PASTAS` não for definida no `.env`.

**Regra mais importante deste recurso: a extração automática nunca escreve
direto em Contratos.** Todo arquivo encontrado vira uma *proposta* na tela
**Fila de Importação** (menu "Integrações"), com status "Pendente de
revisão" — só vira contrato de verdade quando alguém com papel **Gestor**
ou **Administrador** abre a proposta, confere (e corrige, se precisar) cada
campo e clica em "Aprovar". Uma proposta rejeitada ou com erro fica
registrada (não é apagada), para dar para auditar depois o que a extração
errou e por quê — veja também a **Trilha de auditoria**, que registra quem
aprovou ou rejeitou cada proposta e quando.

Desde 22/09/2026 a Fila de Importação é **uma tela só** para o fluxo
inteiro:

- no topo, uma linha de **estado da varredura** — em andamento (processo
  X de Y), concluída (quantas propostas, sem texto, com erro) ou com erro
  (a mensagem fica guardada e aparece mesmo depois de recarregar a
  página). A configuração (pastas, extensões) saiu da
  tela: fica no `.env` e neste README. Uma varredura que já estava
  rodando no servidor (agendada, ou iniciada antes de recarregar a
  página) é acompanhada sozinha;
- a **ficha de cadastro do SGC** (Ferramenta 3) deixou de ter tela
  própria: na proposta **aprovada** (filtro "Aprovadas") ficam os botões
  "Gerar ficha de cadastro", "Baixar ficha (PDF)" e "Ver ficha". Faz
  sentido juntar porque a ficha é o passo seguinte da aprovação — ela só
  existe para contrato que veio de uma proposta aprovada.

### Como configurar as pastas

```bash
CONTRATOS_ARQUIVOS_PASTAS=\\servidor\contratos;\\servidor\contratos-antigos
# CONTRATOS_ARQUIVOS_EXTENSOES=pdf,docx                      # opcional, esse já é o padrão
# CONTRATOS_ARQUIVOS_PROFUNDIDADE_MAX=10                     # opcional, esse já é o padrão
# CONTRATOS_ARQUIVOS_PADROES_NOME=contrato,aditivo,apostilamento  # opcional — ver abaixo
```

Pode ser um caminho UNC (`\\servidor\pasta`) ou uma letra de unidade já
mapeada (`Z:\Contratos`) — o que já funcionar pelo Explorer/Finder na
máquina onde o servidor roda, funciona aqui. Múltiplas pastas são
separadas por `;` (não por vírgula, que pode aparecer em nome de pasta).
Cada **grupo de arquivos** novo ou alterado desde a última varredura é
reprocessado; um grupo já visto e sem mudança em nenhum dos seus arquivos
é ignorado (a "assinatura" usada é tamanho + data de modificação de cada
arquivo, para não precisar ler o conteúdo inteiro pela rede a cada
varredura) — ver "Agrupamento por pasta" logo abaixo para o que é um
"grupo".

`CONTRATOS_ARQUIVOS_PADROES_NOME` é opcional e serve para pastas de rede
muito grandes: filtra pelo **nome do arquivo** (não faz distinção entre
maiúsculas/minúsculas, e é uma comparação "contém", não uma regra
rígida), então só arquivos com um dos termos configurados no nome viram
candidatos — o resto (foto de reunião, planilha de custo, ata avulsa)
nem entra na varredura. Deixe em branco (padrão) para aceitar qualquer
nome com a extensão configurada, igual ao comportamento original.

`CONTRATOS_ARQUIVOS_SUBPASTA` (desde 21/09/2026) é o filtro feito para a
pasta de rede da SETEC, onde cada processo ("P.A. 01.275_2025 - ...") tem
21 subpastas numeradas e os documentos do contrato ficam só em
"3. Contratos, Aditivos e Termos". Configurado assim:

```bash
CONTRATOS_ARQUIVOS_PASTAS=F:\Contratos da Secretaria\9. Gestão de Contratos
CONTRATOS_ARQUIVOS_SUBPASTA=Contratos, Aditivos e Termos
```

**Raiz "9. Gestão de Contratos" (25/09/2026).** Antes a raiz era só
"3. Processos Administrativos - Contratos em Vigência". Agora entram
também "4. ... Contratos Encerrados" e "5. Processos de Outras
Secretarias". Como a raiz subiu um nível:
- só pasta **"P.A. ..."** é processo; "1. Controle de Contratos", "Pasta
  demo" etc. não geram proposta, e o pulo das subpastas numeradas
  (edital, NF, empenho) vale só **dentro** de um processo — senão "3.",
  "4." e "5." seriam puladas;
- a subpasta de contratos é reconhecida nos nomes encontrados na pasta:
  "3. Contratos, Aditivos e Termos", "3. Contrato, Aditivos e Termos",
  "2. Contrato e Aditivos", "2. Contratos e Termos", "Contrato, aditivos e
  OI" e uma pasta por contrato ("Contrato nº 53_2022 - Vertex", P.A.
  13.389 — dois contratos, dois grupos). "Link Gestão de Contratos" e
  "Entregas Previstas em Contrato" não contam; pasta de contrato fora de
  processo ("Arquivos para Excluir\Contrato Nº 061_2024") também não;
- a varredura **avisa** processo sem subpasta de contrato (8, quase todos
  de outras secretarias) e subpasta de contrato vazia (10);
- proposta vinda de "Contratos Encerrados" aparece com a etiqueta
  "encerrado" na Fila e, aprovada, entra com status **Encerrado**: fica
  fora dos ativos, do Mapa de risco e do lote "Atualizar todas";
- medido: os 31 grupos de vigência continuam os mesmos; entram 17 de
  encerrados e 5 de outras secretarias. A primeira varredura desses 22
  faz OCR de ~580 arquivos (o 12.291 sozinho tem 266) — rode no fim do
  expediente, ou importe um processo por vez pela Fila.

Word: `.docx` é lido; o `.doc` antigo (Word 97-2003) não — medido, só 1
arquivo `.doc` nas subpastas de contrato de toda a raiz.

a varredura entra só nessa subpasta de cada processo (as outras 20 nem
são abertas — 239 documentos em vez de 6.451; listar tudo leva ~2 s) e
trata a subpasta **inteira** como um grupo: contrato, aditivos e
apostilamentos, mesmo em subpastas diferentes, viram **uma** proposta por
processo. O mapa de risco lê a mesma subpasta inteira. Atenção: a
primeira varredura com essa configuração processa todos os ~31 processos
com documento (o OCR dos digitalizados leva tempo) — prefira deixá-la para a
varredura agendada da madrugada.

A varredura roda sob demanda, pelo botão "Varrer pastas agora" na tela
**Fila de Importação** (visível a Gestores e Administradores) — não há,
por enquanto, varredura automática agendada.

### Agrupamento por pasta — quando a informação está espalhada em vários arquivos

Na estrutura real observada na rede da Prefeitura, um contrato normalmente
tem **vários arquivos na mesma subpasta** — por exemplo, dentro de
`...\Contrato Nº 096_2025\`: o contrato principal, um extrato/resumo, às
vezes um aditivo. A informação de um único contrato pode estar espalhada
entre esses arquivos (um CNPJ que só aparece no extrato, uma data que só
aparece no aditivo).

Por isso, a varredura agrupa automaticamente os arquivos candidatos pela
**pasta imediata** que os contém: todo arquivo de uma mesma pasta vira
**uma única proposta** na Fila de Importação, com o texto de todos eles
combinado antes de ler os campos — em vez de uma
proposta por arquivo que exigiria depois reconciliar manualmente qual
arquivo tinha qual dado. Isso é automático a partir da estrutura de
pastas já existente; não precisa configurar nada para ligar.

Cada proposta mostra, na tela, a lista completa dos arquivos usados
("Campos combinados de N arquivos desta pasta") — inclusive marcando
quando um arquivo específico não teve texto legível (nem com OCR) ou
precisou de OCR para ser lido — para quem revisa saber exatamente de onde
os dados vieram antes de aprovar. Quando uma pasta só tem um arquivo (o
caso mais simples), o comportamento é idêntico ao de antes do
agrupamento existir: uma proposta, um arquivo.

**Limitação conhecida:** se, por algum motivo fora do padrão observado,
dois contratos diferentes dividirem a mesma pasta, eles seriam tratados
como um grupo só — a lista de arquivos-fonte na proposta deixa isso
visível na revisão, mas vale ficar atento se a organização de pastas da
Prefeitura tiver essa exceção em algum lugar.

O texto de todos os arquivos do grupo é lido **inteiro** (o principal
primeiro), sem orçamento de caracteres: a regra roda em milissegundos.
Arquivo que não pôde ser lido (corrompido, com senha) fica anotado na
proposta, e o grupo segue com os outros.

### OCR para PDF escaneado (imagem, sem camada de texto)

Boa parte dos arquivos reais testados neste projeto (contratos e extratos
digitalizados por scanner) não tinham nenhuma camada de texto — só uma
imagem da página. Por padrão, quando isso acontece, o sistema agora tenta
**OCR automaticamente** antes de desistir:

1. Rasteriza cada página do PDF em uma imagem (usando a mesma biblioteca
   que já faz a extração de texto normal — `pdfjs-dist` —, então não
   precisa instalar nenhum programa externo tipo Poppler ou Ghostscript).
2. Roda reconhecimento de texto (Tesseract, via `tesseract.js`) em
   português em cada imagem.

Os dados de idioma do Tesseract vêm de um pacote npm
(`@tesseract.js-data/por`) instalado junto com o resto do projeto — ou
seja, depois de rodar `npm install` isso funciona **100% offline**, sem
baixar nada de nenhum servidor externo em tempo de execução. Nenhuma
imagem do documento sai desta máquina para fazer OCR.

OCR não é perfeito — pode errar um caractere aqui e ali (ex: confundir
"1" com "l", ou um carimbo/marca d'água pode virar ruído), então uma
proposta cujo texto veio de OCR merece uma conferência um pouco mais
cuidadosa na revisão antes de aprovar. A tela sinaliza com uma marcação
"via OCR" quando isso acontece.

**Quando o OCR entra** (25/09/2026): quando o PDF não tem texto, e também
quando tem uma camada de texto **rala** — menos de 120 caracteres por
página em média (carimbo de assinatura digital sobre páginas
digitalizadas). O contrato 125/2023 tinha 485 caracteres em 12 páginas e
nunca ia para o OCR. Leitura guardada no cache sem o OCR que hoje seria
feito (pulada pelo limite antigo, ou camada rala) não vale mais como
leitura: o arquivo é lido de novo no próximo pedido (importação ou
"Atualizar a análise" do contrato). OCR que **falhou** não é refeito a
cada pedido.
Página única com menos de 300 caracteres também conta como digitalizada:
recorte da Imprensa Oficial em que só o cabeçalho do jornal é texto e a
portaria (designação de gestor e fiscal) é imagem.

**JPEG 2000** (25/09/2026): o OCR passou a carregar o decodificador
OpenJPEG do pdfjs (`wasmUrl` em `ocrTrabalhador.js`). Sem ele, imagem
JPX virava página em branco e o OCR não lia nada — caso do recorte da
IOM "Alteração de Gestor e Suplente" do 20.032 (162 → 1.147 caracteres).
As 28 páginas marcadas "em branco" em 9 documentos foram relidas com a
correção: todas eram brancas de verdade (versos de digitalização).

**Limites de segurança** (configuráveis, ver `.env.example`): um arquivo
maior que `CONTRATOS_OCR_MAX_TAMANHO_MB` (padrão 120MB), ou com mais de
`CONTRATOS_OCR_MAX_MB_POR_PAGINA` (padrão 8MB) por página — o que pesa no
OCR é a imagem de cada página, não o arquivo inteiro. O teto antigo, de
40MB, pulava o OCR de 4 contratos principais (43 a 66MB, ~2,5MB por
página); medido em 25/09/2026, o de 42,9MB leu 17 páginas em 82 s, com
pico de ~690MB de memória. Ou
com mais páginas que `CONTRATOS_OCR_MAX_PAGINAS` (padrão 5 — só as
primeiras são processadas, com aviso — este sim é o limite que de fato
protege contra demora/travamento) tem o OCR pulado ou parcial. Além disso, existe um
orçamento de tempo total por arquivo (`CONTRATOS_OCR_TIMEOUT_MS`, padrão
45 segundos) — se o OCR de um arquivo específico passar desse tempo, ele
para no meio (mantém o que já conseguiu ler até ali, com um aviso) em vez
de continuar rodando indefinidamente. Esses três limites existem pelo
mesmo motivo já documentado no histórico deste projeto de um arquivo de
207MB ter travado a máquina durante testes — e foram confirmados na
prática: numa máquina real da Prefeitura (RAM em canal único, a mesma
limitação de hardware que derrubou a IA local, retirada em 01/10/2026), OCR na
escala/páginas mais altas testadas inicialmente (2.0 / 15 páginas) deixou
a máquina extremamente lenta durante uma varredura real, o que motivou
baixar os padrões acima e adicionar o orçamento de tempo. Nunca vale a
pena arriscar travar a varredura inteira por causa de um único arquivo
fora do padrão — se a máquina em que o servidor roda for mais robusta,
esses valores podem ser aumentados com cautela, testando um arquivo por
vez antes de rodar numa pasta inteira. Para desligar OCR completamente
(volta ao comportamento antigo, tudo escaneado cai em "sem texto
extraível"): `CONTRATOS_OCR_ATIVADO=false`.

**Nota técnica (bug real corrigido neste projeto):** o rendering das
páginas antes do OCR usa `pdfjs-dist`, que trata os caminhos internos de
fontes/cMaps como se fossem URLs — exige barra "/" mesmo rodando local,
nunca a barra invertida "\" que o Windows usa. Isso só quebrava em
produção (Windows), nunca no ambiente de desenvolvimento (Linux), o que
escondeu o bug até o primeiro teste real numa máquina da Prefeitura, com
o erro "Invalid factory url: ... must include trailing slash". Corrigido
convertendo esses caminhos pra barra "/" sempre, independente do sistema
operacional — ver `comoUrlDeAsset` em `integrations/extratorDocumento.js`.

**Indicador de progresso da varredura:** como o OCR numa máquina
modesta pode legitimamente levar alguns minutos por pasta, a tela consulta `GET /api/integracoes/arquivos/progresso`
periodicamente enquanto "Varrer pastas agora" está em andamento, e mostra
qual pasta está sendo processada e em qual etapa (lendo arquivos/OCR,
lendo os campos). Isso existe especificamente pra nunca mais
ser preciso adivinhar se uma varredura demorada travou ou só está
demorando — antes disso, o único feedback era um botão "Varrendo..."
parado, sem nenhuma indicação de progresso real.

### Um arquivo problemático não derruba o grupo inteiro

Um arquivo corrompido, protegido por senha, ou de alguma forma ilegível
dentro de uma pasta com vários arquivos NÃO faz o grupo inteiro virar um
"erro" sem solução — só aquele arquivo específico vira uma entrada "sem
texto" com o motivo anexado (visível na lista de arquivos-fonte da
proposta, com um selo "erro de leitura"), e os outros arquivos boa-fé da
mesma pasta continuam sendo combinados e propostos normalmente. Antes
desta correção, um único arquivo problemático descartava o trabalho (às
vezes caro, quando envolvia OCR) já feito nos outros arquivos do grupo.

### Duas varreduras ao mesmo tempo

Se duas pessoas com papel Gestor/Administrador clicarem em "Varrer pastas
agora" quase ao mesmo tempo (ou a mesma pessoa em duas abas), a segunda
tentativa é recusada com uma mensagem clara em vez de rodar em paralelo —
sem essa trava, as duas veriam os mesmos arquivos como "novos" (nenhuma
marcou nada como visto ainda) e processariam a mesma pasta em dobro,
desperdiçando tempo de OCR e podendo até gerar duas propostas para o
mesmo grupo.

### Varredura automática agendada (de madrugada, sem ninguém esperando)

Numa máquina modesta, uma varredura real (principalmente com OCR) pode
legitimamente levar minutos — o indicador de progresso (acima)
deixa isso visível, mas não faz o processo em si ser mais rápido. Quando
ninguém precisa acompanhar o resultado na hora, a alternativa mais simples
é tirar a espera do caminho: rodar a varredura de madrugada, e revisar as
propostas prontas na fila de manhã.

Defina `CONTRATOS_VARREDURA_AUTOMATICA_HORA` no `.env` com um número de 0
a 23 (ex: `2` para 2h da manhã) — a cada hora o servidor confere se já
passou desse horário e se ainda não rodou hoje; se sim, dispara a mesma
varredura do botão "Varrer pastas agora", automaticamente. Fica desligado
por padrão (variável não definida). Mesmo mecanismo (um `setInterval` de
hora em hora, sem depender de `node-cron`) já usado pelo resumo diário de
alertas por e-mail (`ALERTA_EMAIL_HORA`, ver acima).

**A pegadinha:** isso só dispara se o processo do Node (este servidor)
estiver DE PÉ na hora marcada. O hábito usado até aqui neste projeto —
abrir um terminal, rodar `npm start`, e fechar o terminal (ou desligar o
computador) mais tarde — faz esse agendamento nunca disparar, porque o
processo já não existe mais de madrugada. Pra funcionar de verdade, uma
destas é necessária:

- **Mais simples (sem instalar nada novo):** deixar o computador ligado, o
  terminal aberto e o servidor rodando durante a madrugada, e ajustar as
  configurações de energia do Windows pra nunca suspender/hibernar
  enquanto estiver assim (Configurações → Sistema → Energia → "Nunca" em
  suspensão). Funciona, mas depende de ninguém fechar o terminal por
  engano, e o computador fica preso ligado a noite toda por causa disso.
- **Mais robusto:** rodar o servidor como um serviço do Windows (via
  [NSSM](https://nssm.cc/) ou similar) ou com [PM2](https://pm2.keymetrics.io/)
  configurado pra iniciar com o Windows — nesse caso o processo sobrevive
  a logoff/reinício e não depende de ninguém deixar um terminal aberto.
  Isso não está implementado neste projeto (é configuração do
  ambiente/infra, não código) — perguntar se vale a pena configurar antes
  de depender disso pra valer.

Enquanto o servidor não ficar de pé a noite toda (por qualquer um dos
dois motivos acima), a varredura automática simplesmente não vai
acontecer — o botão manual "Varrer pastas agora" continua funcionando
normalmente nesse meio tempo, sem depender de nada disso.

### Seleção manual de arquivos (escolher exatamente o quê processar)

Além da varredura (automática ou agendada) — que decide sozinha quais
pastas são "novas/alteradas" a partir de `CONTRATOS_ARQUIVOS_PASTAS` —
existe uma segunda forma de usar a Ferramenta 1, pensada pra quando você
já sabe exatamente qual(is) arquivo(s) quer processar agora, sem esperar
nem depender do que a varredura decidiria sozinha.

Na tela "Fila de Importação", o botão **"Selecionar arquivos
manualmente"** abre um navegador de pastas dentro da própria tela — as
mesmas pastas configuradas em `CONTRATOS_ARQUIVOS_PASTAS`, com um
breadcrumb pra ir entrando/saindo de subpastas. Desde 21/09/2026 dá para
partir do **Explorer do Windows**, sem navegar pasta por pasta:

- **"Escolher arquivos…" / "Escolher pasta…"**, ou **arrastar** arquivos
  e pastas do Explorer para a área tracejada. O navegador, por
  segurança, não entrega à página o caminho dos arquivos — só nome,
  tamanho, data de modificação e, numa pasta escolhida inteira, o caminho
  dentro dela. O servidor procura cada um na pasta de rede por esses
  dados e marca o arquivo de lá. **Nenhum arquivo é enviado**: o sistema
  continua lendo o original na rede. Se a mesma cópia estiver em dois
  lugares (caso real: o edital em "1. Edital..." e em "21. Cronograma..."),
  vale a da subpasta de contratos; se não der para decidir, a tela
  pergunta qual. Arquivo de fora da pasta de rede (da área de trabalho,
  por exemplo) é recusado com aviso. A primeira busca indexa a pasta de
  processos inteira (alguns segundos, sem travar o servidor; começa ao
  abrir o painel) e vale por 5 minutos.
- **Colar o caminho** de uma pasta ou arquivo — da barra de endereço do
  Explorer ou de "Copiar como caminho" (com aspas, tanto faz). A pasta
  abre no navegador da tela; um arquivo já fica marcado. Aceita a letra de
  unidade (F:\...) e também o caminho de rede por trás dela
  (\\SERVARQUIVOS01...\Depto - DTI\...), e não diferencia maiúsculas.

Os arquivos marcados, de qualquer pasta, aparecem numa lista
"selecionados", de onde dá para tirar um a um. Marque um ou mais
arquivos e clique em "Extrair campos". Diferenças
importantes em relação à varredura automática:

- **Sempre processa o que foi marcado**, mesmo que aqueles arquivos já
  tenham virado proposta antes (não olha `arquivosVistos` — o pedido
  aqui é explícito, feito por alguém agora, não uma decisão automática
  de "isso mudou desde a última vez").
- Os arquivos marcados **não precisam estar na mesma pasta** — todos
  entram numa única proposta, com o texto combinado da mesma forma que
  um grupo da varredura automática (ver "Agrupamento por pasta" acima).
- Reaproveita a mesma trava de concorrência da varredura automática: só
  uma coisa de cada vez (varredura OU extração manual), nunca as duas ao
  mesmo tempo.
- Por segurança, o navegador de pastas e a extração só aceitam caminhos
  **dentro** de uma das pastas configuradas em `CONTRATOS_ARQUIVOS_PASTAS`
  — um caminho fora dali é sempre recusado pelo servidor, mesmo que
  alguém tente mandar um diretamente pra API.

Precisa do mesmo papel (Gestor ou Administrador) que já era exigido para
"Varrer pastas agora".

### Leitura dos campos — por regra

Os 14 campos do cadastro são lidos por **regra** (`integrations/leituraPorRegra.js`
e `integrations/camposPorRegra.js`), nesta máquina: nenhum texto de
contrato sai para serviço externo. Uma regra só preenche quando o padrão
inteiro está no texto — número ("CONTRATO Nº 096/2025"), CNPJ da contratada
(nunca o do Município), razão social do preâmbulo, processo
administrativo, modalidade, secretaria, objeto, gestor e suplente pelo ato
mais recente, preposto; valor e vigência são **calculados** (abaixo). O que
a regra não acha fica **em branco** e vai para "Pendências de leitura" —
nunca um palpite. Cada campo mostra de que documento veio.

Até 01/10/2026 havia também uma IA local (Ollama), desligada desde 24/09
porque travava a máquina e, medida nos documentos reais, não acertava nada
que a regra não acerte. Foi retirada do código — ver "A IA foi retirada",
mais abaixo.

#### Valor mensal: a regra do SGC

A avaliação contra o SGC mostrou que o documento quase nunca traz a data
de término nem o valor mensal escritos. O valor é a **média mensal**, a
mesma regra do SGC:

    (valor inicial + aditivos/apostilamentos de valor)
      ÷ (vigência inicial em meses + aditivos/apostilamentos de prazo)

calculada pela busca local a partir do contrato **e dos termos aditivos
da pasta** (`integrations/valorContratual.js`): o contrato dá o valor
global e a vigência; cada prorrogação soma o valor do novo período e os
meses; cada acréscimo soma o valor (supressão subtrai). Alteração de
CNPJ, de fiscal, termo de referência e extrato do Diário Oficial de outros
contratos ficam fora. Exemplo real, 072/2020:

    (2.780.000,00 + 784.074,48 + 392.037,24) ÷ (24 + 24 + 12) = 65.935,20  ← igual ao SGC

Também entram:
- **reajuste** (apostilamento "para que seja reajustado ..., correspondendo
  ao valor mensal contratual de R$ X"): (novo mensal − mensal anterior) ×
  meses que restavam do período inicial, contando reajuste anual — o
  086/2021 fecha com o SGC exatamente assim (9.428,40 × 18);
- **retificação** ("Fica retificado o Termo de Aditamento nº 137/2022 ...
  para que conste o valor de R$ ..."): o termo retificado vale com o valor
  novo;
- **prorrogação que só escreve o valor mensal** ("O valor mensal ...
  permanece em R$ 1.481.825,00, perfazendo, pelo período de 12 meses, o
  montante de R$ 17.781.900,00"): vale o montante do período, ou mensal ×
  meses. Com as três regras, o 066/2020 — 31 documentos, reajuste,
  acréscimo retificado e duas prorrogações — bate ao centavo com o SGC.

Resultado na avaliação: **17 de 24** médias iguais às do SGC (eram 4 só
com o contrato original). Os 7 restantes são erro ou atraso do próprio
SGC — ver "Conferência SGC", que explica cada um (o 066/2020 saiu da
lista dos que conferem em 22/09/2026, quando a prorrogação "excepcional"
176/2025 passou a ser reconhecida: o SGC atualizou a data de término com
ela, mas não o valor). A proposta na Fila de Importação e a ficha de
cadastro mostram a **memória de cálculo** ("Como o valor mensal foi
calculado"), com cada termo considerado e os avisos: termo arquivado na
pasta errada, prorrogação sem valor legível (fica fora da conta em vez de
derrubar a média).

#### Vigência: meses contados de um marco, não datas soltas

Desde 22/09/2026 (`integrations/vigenciaContratual.js`), início e término
são **calculados**, nunca "achados" soltos no texto. A regra:

- a vigência é contada em **meses** a partir de um **marco**: a
  assinatura do contrato ou a Ordem de Início, conforme a cláusula de
  vigência disser ("contados da data de assinatura" / "contados do
  recebimento da Ordem de Início");
- cada **prorrogação** soma os meses dela a partir da data que o termo
  indicar ("por mais 12 meses, contada de 29 de setembro de 2024");
  quando o termo escreve o fim ("até 06 de agosto de 2024"), vale o que
  está escrito;
- o prazo vence no **dia de mesmo número** do mês final (Código Civil,
  art. 132, §3º — e é o que o SGC faz): 12 meses de 29/09/2024 terminam
  em 29/09/2025;
- **Início** = data de assinatura do contrato — do fecho "Itaverde, 05 de
  dezembro de 2025" ou de "DATA DA ASSINATURA:" no Termo de Ciência
  (nunca a de um termo aditivo). Para achar o fecho, o OCR passou a ler
  também as **2 últimas páginas** de PDF longo
  (`CONTRATOS_OCR_PAGINAS_FINAIS`) — antes lia só as 10 primeiras;
- **verificação antes de gravar**: sem o marco (contrato que conta da
  Ordem de Início sem a ordem na pasta; data de assinatura ilegível), o
  término fica **vazio, com aviso** — não se chuta data. Cada prorrogação
  que diz de quando conta é conferida com o fim do período anterior;
  divergência vira aviso. A **Ordem de Início**, quando está entre os
  documentos, é reconhecida e usada como marco.

**Mudanças de 24/09/2026 (regra do usuário):**

- **De onde vem a Ordem de Início.** Além de "3. Contratos, Aditivos e
  Termos", o sistema lê a subpasta **"4. Ordem de Início de Serviço"** do
  mesmo processo (só ela). Vale também a **Ordem de Fornecimento** (os
  contratos de fornecimento contam dela) e o campo "Data da Emissão".
  Rascunho sem data ("XX de xxxxx"), modelo, ofício e certificado de
  assinatura não contam. Ordem digitalizada em que o OCR não leu o número
  do contrato vale se estiver na pasta do processo e não citar outro
  contrato — com aviso para conferir (096/2025: O.F. de 22/01/2026,
  término 22/01/2027).
- **Sem Ordem de Início, conta da assinatura.** Se a Ordem não está nos
  documentos (nem foi informada à mão), os meses são contados da **data de
  assinatura** do contrato — para todos os contratos, e também quando a
  cláusula não diz de quando conta. A memória do cálculo diz "contado da
  assinatura", o Registro de riscos mostra "Término calculado a partir da
  assinatura" (criticidade 6, aceitar e monitorar) e "Pendências de
  leitura" lista o contrato em "Confirmar: término contado da assinatura",
  para quem tiver a data real da Ordem corrigir. Só sem Ordem **e** sem
  assinatura o término fica vazio.
- **Ordem de preferência do marco:** data informada à mão > Ordem de
  Início nos documentos > assinatura (presumida).
- **Campo Início = o marco da cláusula.** Se o contrato conta da Ordem de
  Início e ela foi lida, o Início é a data da Ordem; se conta da
  assinatura, é a assinatura; se conta da Ordem mas ela não foi achada (ou
  não deu para ler a data), é a assinatura, com o aviso de que a data
  correta seria a da Ordem de Início. A data de assinatura aparece à parte
  no "Como a vigência foi calculada".

Resultado: início **12 de 24** e término **9 de 24** iguais ao SGC (eram
0). Os términos em branco são quase todos de contratos que contam da
Ordem de Início sem a ordem na pasta. Onde a conta difere do SGC, costuma
ser o SGC: 130/2023 tem término em 2033 no SGC e 09/10/2027 pelos termos;
009/2023 não tem no SGC a prorrogação 193/2025.

**Recalcular valores e vigências** (botão na Fila de Importação): regra
nova não chega sozinha às propostas já lidas — a varredura não reprocessa
pasta cujos arquivos não mudaram. O botão reaplica as regras às propostas
pendentes com o texto já guardado (sem OCR, segundos), apaga palpite antigo
da IA que a regra não confirma, e a proposta mostra o que mudou.

#### A regra lê o documento inteiro

A leitura por regra roda sobre o texto **sem corte** de todos os
documentos da pasta, o principal primeiro (é o que evita pegar a razão
social de outro contrato publicado na mesma página do Diário Oficial).
É também o que faz subir `CONTRATOS_OCR_MAX_PAGINAS` valer a pena: cada
página a mais lida pelo OCR chega à regra.

### Limitações conhecidas

- **PDF escaneado (imagem, sem camada de texto)** agora passa primeiro
  pelo OCR automático (ver seção "OCR para PDF escaneado" acima) antes de
  desistir. Só cai como "Sem texto extraível" na fila se o OCR também não
  conseguir ler nada (ex: imagem ilegível, arquivo corrompido, ou fora dos
  limites de tamanho/páginas configurados). A proposta fica registrada
  mesmo assim (para não "sumir" da fila), esperando alguém arquivar/rejeitar
  ou completar os dados manualmente.
- Um contrato cujo **número já existe** localmente é reconhecido e a
  aprovação **mescla** os campos nele (em vez de duplicar) — útil para um
  aditivo ou uma revisão do mesmo arquivo. Campos próprios da Central de Contratos
  que não vêm do arquivo (comentários internos, tratativas) nunca são
  tocados por essa mesclagem.
- A varredura pode ser sob demanda (botão na tela), agendada de madrugada
  (`CONTRATOS_VARREDURA_AUTOMATICA_HORA`, ver acima) ou manual por
  seleção de arquivos — ver "Seleção manual de arquivos" acima.

## Mapa de risco por contrato (Ferramenta 2)

Gera, sob demanda, um mapa de risco por contrato combinando **dois tipos
de risco** — o que é calculado a partir de prazo, valor, aditivos,
garantia e tratativas (eixos **Prazo**, **Financeiro** e **Gestão**) e a
conferência do **conteúdo** dos documentos do contrato contra o que a lei
exige (multa, reajuste, garantia, extinção, renovação automática etc.).
Módulo: `integrations/mapaRiscoContratos.js`, com a extração de texto da
Ferramenta 1 (`extratorDocumento.js`) e o checklist por regra
(`checklistRisco.js`, `checklistPorRegra.js`). Tela **Mapa de risco** no
menu (grupo "Documentos").

**Importante — hoje só funciona para contratos que têm um arquivo de
origem**, ou seja, contratos que vieram (ou foram atualizados) pela
Ferramenta 1 (`arquivoOrigem` preenchido). Um contrato sincronizado só da
API do SGC, sem nunca ter passado por uma importação de arquivo, ainda não
aparece na lista — é a limitação mais importante deste recurso hoje (ver
"Limitações conhecidas" abaixo).

**Quando o mapa é gerado:**

- **Ao aprovar o contrato na Fila de importação** (desde 01/10/2026): o
  contrato ativo — novo ou atualizado — já entra no Mapa com a análise.
  Usa só o texto lido na varredura (sem OCR novo, menos de um segundo);
  documento lido em parte não vira "cláusula não localizada". A tela avisa
  o risco geral, e a geração fica na Trilha de auditoria. Contrato
  encerrado também ganha a análise, na aba "Encerrados" (abaixo). Uma
  falha aqui não desfaz a aprovação.
- **"Gerar/Atualizar análise"**, na tela ou no detalhe do contrato: lê os
  documentos **inteiros** (com OCR, se precisar) — é o que confirma
  ausência de cláusula.
- **"Atualizar todas as análises"** (administrador): refaz todos, em
  vigência e encerrados, com o texto já lido, depois de uma mudança nas
  regras.

**Aba "Encerrados" (02/10/2026).** A tela tem duas abas: **Em vigência** (a
carteira, com os quatro eixos) e **Encerrados** — os contratos da pasta
"Contratos Encerrados" e os marcados como encerrados. Num encerrado,
**Prazo e Financeiro não se aplicam** ("vencido" daria Alto para todos);
ficam o **Conteúdo** (as cláusulas que a lei exige estavam no contrato?) e
a **Gestão** (gestor, suplente, preposto, termos, relatórios mensais), e o
risco é o pior entre os dois. Serve para responder a uma requisição do
Tribunal sobre um contrato antigo. Os encerrados continuam fora dos
números da carteira, do Painel e de "O que fazer agora". A planilha de
lacunas ganhou a coluna "Situação do contrato".

**A geração leva minutos e roda em segundo plano no servidor.** O botão só
dispara; a tela acompanha o andamento ("lendo documento 2 de 3...",
"conferindo item 4 de 9 do checklist...") e dá para fechar a janela e
continuar usando o sistema. O que leva tempo é o OCR dos documentos
digitalizados; a conferência em si leva milissegundos.

### Como o eixo Conteúdo funciona (desde 21/09/2026)

Os documentos de um contrato não trazem "apontamentos de risco". A régua
está **escrita no sistema** (`integrations/checklistRisco.js`), como um
checklist das cláusulas que a lei exige em todo contrato (art. 92 da Lei
14.133; art. 55 da 8.666): penalidades e multas, reajuste, pagamento,
garantia, vigência e prorrogação, extinção, gestão e fiscalização,
obrigações das partes e matriz de riscos (quando for o caso). Para cada
item o sistema:

1. **Localiza o trecho** que trata daquilo — de preferência pelo título da
   cláusula ("CLÁUSULA OITAVA — DAS PENALIDADES") — em **todos os
   documentos da pasta do contrato**: contrato, aditivos, apostilamentos,
   extratos. Um aditivo que prorroga a vigência é conferido junto com a
   cláusula de vigência original.
2. **Confere por regra** se o que a lei pede está escrito (percentual e
   base da multa; índice, periodicidade e data-base do reajuste; prazo e
   atesto do pagamento...) e mostra a frase encontrada como prova.
3. **Alerta só com a frase como prova** (renovação automática, pagamento
   antecipado, multa só por remissão a decreto): a citação é conferida
   contra o texto, com documento e página.
4. **O que a regra não conclui fica para conferência manual**, com o que
   ela achou e o que faltou — nunca um veredito sem prova. (Até 01/10/2026
   esses itens iam a uma IA local; ela foi retirada — ver "A IA foi
   retirada".)

**Leitura completa.** Como roda para um contrato só, o OCR lê o documento
**inteiro** (não as 10 páginas da varredura em lote). Isso importa por
causa da regra mais delicada da ferramenta: **ausência só é afirmada com
leitura completa**. "Não há cláusula de garantia" com base em 10 de 17
páginas lidas seria um falso positivo — e do tipo que tira a credibilidade
da ferramenta na primeira vez. Se algum documento foi lido parcialmente, o
item aparece como "não localizado — leitura incompleta", sem apontamento.

**Validação jurídica pendente.** O checklist é um ponto de partida técnico:
os itens, as referências ao art. 92 e o que se considera risco em cada um
precisam ser validados pelo jurídico da Prefeitura antes de uso oficial. A
tela diz isso junto do checklist.

### O que cada eixo mede

Desde 28/09/2026 **Prazo, Financeiro e Gestão saem do Registro de riscos**
(um motor só — antes o Mapa tinha pontos próprios e o Registro,
probabilidade × impacto, e os dois podiam discordar). Cada eixo é a maior
criticidade (P×I, 1 a 25) dos riscos automáticos e registrados do
contrato naquele eixo: **15 ou mais Alto, 8 a 14 Médio, abaixo Baixo** —
os mesmos cortes do critério de aceitação do SGC (Evitar / Mitigar). A
tela mostra, para cada risco, "P×I = N" e o critério.

- **Conteúdo** — ver a seção acima (checklist e pontos de risco das
  cláusulas).
- **Prazo** — vencimento (vencido 5×5; até 15 dias 5×4; até 30 4×4; até
  90 3×4; até 180 2×3 — limiares de Configurações de alerta) e **limite
  legal de duração com antecedência**: 72 meses na 8.666 (ou prorrogação
  excepcional) é 5×5 "não pode mais ser prorrogado"; 60 meses é 4×4, e
  5×4 quando o fim está a até 180 dias; 48 meses é "planejar a próxima
  contratação". O 066/2020 está nos 72 meses; 072/2020 e 086/2021 nos 60.
- **Financeiro** — acréscimos acima de 25% (5×5) ou a partir de 20% (3×4);
  valor mensal não cadastrado (3×3); **reajuste pelo aniversário**: 12
  meses sem termo de reajuste na pasta é 2×2 (só registrar), 24 meses 2×3,
  36 meses ou mais 3×3 (verificar pedido ou renúncia — passivo
  retroativo); **garantia contratual** (ver abaixo). Materialidade (valor
  entre os 25% maiores) só informa. Cooperação sem repasse: não se aplica.
- **Gestão** (eixo novo) — gestor ou suplente sem ato de designação,
  preposto não indicado, termo só com extrato, tratativas em andamento
  (3×3; 4×3 a partir de 3) e os riscos lançados à mão pelo gestor no
  Registro.

**Garantia contratual.** "Recalcular pelas regras" procura, na pasta do
processo, arquivos de apólice / seguro garantia / caução / fiança /
endosso (não os de devolução nem modelos) e lê a validade, nesta ordem de
confiança: o ofício que encaminha a apólice ("vigência entre X até Y,
referente ao Contrato nº N"), a própria apólice, qualquer "vigência de X
a Y". Só vale documento que cita o número do contrato; data lida por OCR
fica marcada para conferência (no 118/2022 o OCR da apólice leu 2028 onde
o ofício diz 2025). Riscos: garantia vencida com o contrato em vigor
(4×4) — com o contrato **já terminado**, vira só o registro do período
que ficou sem garantia (2×3, sem "cobrar a renovação"; 29/09/2026) —,
garantia que termina antes do contrato (3×3; 4×3 a até 90 dias),
documento sem validade legível (2×3) e garantia exigida no contrato sem
cópia na pasta (2×3 — o original costuma ir para a Secretaria de
Finanças; só 8 dos 37 processos guardam cópia). Se a pasta do processo
não estiver acessível na hora do recálculo (unidade F: desconectada), a
leitura anterior é mantida — antes, ela seria apagada.

**Análise de um contrato mostra o dia de hoje** (29/09/2026): prazo,
financeiro e gestão são recalculados ao abrir (a lista já era); o
conteúdo (cláusulas) é o da análise gerada, com a data dela.

**O que fazer agora.** No topo da tela, os riscos da carteira agrupados
pela ação que resolve, do mais urgente ao menos: confirmar encerramento
(leva a Pendências de leitura), iniciar nova contratação, regularizar
vencido, decidir prorrogação, cobrar garantia, designar gestor, planejar
contratação, controlar acréscimo, reajuste, arquivar documentos,
preposto. Cada contrato aparece uma vez por ação; clicar abre a análise.

**Tendência.** Ao lado do risco de cada contrato, ▲ (subiu) ou ▼ (desceu)
comparando o risco de hoje com o da última análise gerada; a análise
também avisa quando o risco mudou desde que foi gerada.

Regras antigas, até 27/09/2026 (para comparar com análises anteriores):

- **Prazo** — dias até o vencimento (mesmos limiares de Configurações de
  alerta: vencido +40, até 15 dias +30, até 30 +15, até 90 +5, sem data
  de término +15) mais +10 por tratativa em andamento (até 30). Alto a
  partir de 35 pontos, Médio a partir de 15. Vencido diz a data e pede
  para conferir se há termo de prorrogação ainda não arquivado.
- **Financeiro** (recalibrado em 25/09/2026) — o que indica problema:
  acréscimos de valor acima do limite legal de 25% do valor inicial
  (+40; Lei 8.666, art. 65, §1º; Lei 14.133, art. 125) ou perto dele, a
  partir de 20% (+20); valor mensal não cadastrado (+20 — sem dado não é
  "sem risco"); valor entre os 25% maiores da carteira (+10, agrava mas
  não cria risco). Prorrogação é o ciclo normal e não pontua. Mesma
  régua: Alto a partir de 35, Médio a partir de 15. Antes, todo contrato
  com valor mensal a partir de R$ 20 mil ganhava +20 e cada aditivo
  (prorrogação inclusive) +8, com Alto a partir de 18: 25 dos 27
  contratos saíam "Alto", 20 deles só por isso. Com a régua nova: 5 Alto
  (todos por prazo vencido), 10 Médio, 12 Baixo; o 045/2022 aparece com
  os acréscimos em 24% do valor inicial.
- **Como chegamos a este nível** — a análise de cada contrato mostra a
  conta: cada ponto de cada eixo com o motivo e o dado (data, valor,
  termo). Análise gerada antes da recalibração pede "Atualizar análise".
- **Risco geral** — o **pior** nível entre os eixos disponíveis (quatro desde 28/09/2026; não
  uma média): um contrato com prazo confortável mas uma cláusula de multa
  ambígua ainda deveria chamar atenção. Quando o eixo Conteúdo **não foi
  analisado** (sem arquivo ou sem texto legível), o rótulo
  sai como "**Baixo (parcial)**", em cinza: sem isso, um contrato cujo
  conteúdo ninguém leu aparecia como "Risco geral: Baixo" em verde —
  lido como seguro.

### Atualizar todas as análises (25/09/2026)

Botão **"Atualizar todas as análises"** no topo da tela Mapa de risco,
só para **administrador**. Refaz a análise de todos os contratos com
documentos usando as regras atuais — útil depois de uma mudança nas
regras do checklist, que só aparece nos mapas gerados de novo.

- **Só o texto já lido** (cache). Nenhum PDF é lido de novo, nenhum OCR
  roda. Documento que ainda não foi lido fica anotado no mapa, e nenhum
  item é dado como "não localizado" naquele contrato (a cláusula pode
  estar no documento que faltou). A leitura dele fica para "Atualizar a
  análise" do contrato.
- **Um contrato por vez**, com a mesma trava da geração individual.
  Medido com os dados reais: 27 contratos em 2,8 s; itens para
  conferência manual 51 → 15.
- Cada mapa novo vai para o histórico com `modo: "lote"`. O histórico
  guarda as **5 análises mais recentes** de cada contrato
  (`MAPA_RISCO_HISTORICO`); sem limite, o data.json crescia a cada lote.
  A Auditoria registra quem pediu e quantos foram atualizados.

### Um risco só: Painel, Contratos e Mapa (25/09/2026)

O Painel e a tabela de Contratos tinham uma fórmula própria (valor
mensal a partir de R$ 20 mil pesando muito): **17 dos 27 contratos**
apareciam com um risco no Painel e outro no Mapa. Agora os três mostram
o mesmo nível (`mapaRiscoContratos.riscoAtualDoContrato`): o conteúdo da
análise mais recente com o prazo e o financeiro calculados na hora. O
motivo aparece ao passar o mouse no selo; "(parcial)" quando as
cláusulas ainda não foram analisadas.

### Acordos e termos de cooperação (25/09/2026)

Acordo ou termo de cooperação, convênio, termo de fomento ou de
colaboração (pelo caminho do arquivo, pelo objeto ou pelo início do
texto) **sem repasse de recursos**: multa, reajuste, pagamento,
garantia, matriz de riscos e o eixo Financeiro saem como **"Não se
aplica"** (Lei 14.133/2021, art. 184 — a lei vale para esses ajustes "no
que couber"); vigência, extinção, gestão e obrigações continuam sendo
conferidas. Caso real: 002/2024 (Nove Tecnologia) e 102/2022 (IFTEC) saíam
com risco Médio por cláusulas de pagamento que não existem neles.

### Planilha das lacunas

Botão **"Exportar lacunas (CSV)"** na tela Mapa de risco: as cláusulas
exigidas que não atendem, atendem em parte, não foram localizadas ou
ficaram para conferência, e os apontamentos com a frase citada, da
análise mais recente de cada contrato — para levar à Procuradoria ou ao
gestor. Mesmo formato das outras planilhas (Excel em português).

### Citações sem cabeçalho de página

A frase mostrada como prova não traz mais o cabeçalho que o OCR joga no
meio dela ("PREFEITURA DE ITAVERDE | Procuradoria Geral do Município |
CIDADE QUE CUIDA DE TODOS", número de página) e termina no fim da
frase que contém o achado. A regra continua lendo o texto inteiro.

## Correções de cadastro aplicadas ao iniciar (25/09/2026)

Ao subir, o servidor corrige uma vez (e registra na Auditoria como
"Sistema (correção automática)"):
- **arquivo principal que é um modelo em branco** ("Termo de
  Encerramento Contrato Nº xx_xxxx.docx", "Ordem de início_Contrato
  XXX") — volta a ser escolhido entre os arquivos da proposta aprovada.
  Era o caso do 002/2024: o Mapa de risco lia só os modelos da pasta da
  Ordem de Início. A importação também não escolhe mais modelo, termo de
  encerramento ou ordem de início como arquivo principal;
- **CNPJ da empresa igual ao da Prefeitura** (11.256.774/0001-02) —
  relido do texto já guardado com a regra que descarta o da Prefeitura
  (002/2024 → 11.251.219/0001-80; 061/2025 → 11.253.441/0001-11); sem
  texto, fica em branco;
- **razão social e objeto com a acentuação estragada** (29/09/2026) —
  "LAGO AZUL TECNOLOGIA DA INFORMAcAO", "IMPoRTAcAo", "SERVIOS",
  "LICENAS": letra minúscula perdida no meio de palavra em maiúsculas,
  onde havia Ç/Ã/Ó (erro de OCR). Vale a grafia de outro documento do
  processo que traga o mesmo trecho limpo (a razão social letra a letra;
  o objeto palavra a palavra, tolerando 1 ou 2 letras de diferença e com
  80% das palavras batendo). Sem trecho limpo em documento nenhum, só o
  conserto seguro: "c" minúsculo entre maiúsculas vira Ç, e "ÇAO/ÇOES"
  viram "ÇÃO/ÇÕES". Medido: 045/2022 e 045/2023 (razão social) e
  086/2021, 045/2023, 108/2024 (objeto, pelo documento); 045/2022 e
  009/2023 (objeto, só o conserto — ainda restam "SEGURANA" e
  "ATWIDADES", que o OCR leu assim e nenhum documento traz limpo).

"Recalcular pelas regras" (Fila) também **preenche início e término em
branco dos contratos aprovados**, calculados pelo texto e pela Ordem de
Início — nunca sobrescreve data que já existe. Caso: 015/2024, que só
ganhou texto depois do OCR dos PDFs grandes (término 28/03/2027).

**Termo de encerramento → pendência para confirmar** (25/09/2026). O
termo fica na subpasta "20. Termo de Encerramento" do processo, fora da
subpasta de contratos, e não era lido. Medido: 072/2020, 066/2020 e
045/2022 — ainda na pasta de vigência, cadastrados como Ativo e com
prazo "vencido" (risco Alto) — já tinham o termo preenchido, com a mesma
data do vencimento. Agora, "Recalcular pelas regras" lê o termo
(`termoEncerramento.js`; o `.docx` quando houver, modelo em branco
nunca) e, se ele citar o número do contrato, cria a pendência
**"Confirmar encerramento"** em Pendências de leitura, com a data (o fim
do último período citado), o motivo e a frase do termo. **O cadastro não
muda sozinho** (decisão do usuário): quem confirma põe o contrato como
Encerrado (sai do Mapa de risco e dos ativos); quem descarta faz o termo
não voltar a ser sugerido enquanto o arquivo for o mesmo. As duas
decisões ficam na Auditoria.

**Backup fora desta máquina:** com `BACKUP_COPIA_PASTA` no `.env` (pasta
de rede com acesso restrito), o backup diário do data.json também é
copiado para lá, com a mesma retenção de 30 dias.

## Conferência SGC

Tela **Conferência SGC** no grupo "Integrações" (Gestores e
Administradores). Para cada contrato do SGC com pasta de processo na rede,
recalcula a média mensal pelos documentos (contrato + termos aditivos,
mesma regra do SGC) e confere o CNPJ. Quando não bate, diz o porquê
provável. Módulo: `integrations/conferenciaSgc.js`. É só um relatório:
não altera o SGC nem o `data.json`.

Resultado em 21/09/2026, 24 contratos com pasta:

| Situação | Qtd. | Exemplo |
|---|---|---|
| Confere | 18 | 072/2020, 045/2022, 066/2020, 130/2023... |
| SGC desatualizado | 4 | 010/2024, 009/2023, 108/2024 — batem ao centavo **sem** o último acréscimo, que o SGC tem cadastrado em Aditivos (268/2025, 278/2025, 107/2026): a média é que não foi atualizada. 086/2021 — o SGC não tem as prorrogações 040/2025 e 194/2025 |
| Erro de digitação no SGC | 2 | 096/2025 — o próprio SGC tem R$ 26.100.000 em 12 meses, mas a média gravada é R$ 2.075,07 (seria 2.175.000). 006/2025 — média = 11.190.000 ÷ **120** meses (12 digitado como 120) |
| Diverge sem explicação | 0 | — |
| CNPJ inválido | 1 | 010/2024 — 11 dígitos no SGC |

As explicações que usam as **parcelas do SGC** (valor total, aditivos de
valor, vigência) dependem da sincronização guardá-las, o que ela faz
desde 21/09/2026 (campo `sgcValores` do contrato): depois de atualizar,
sincronize uma vez com o SGC (tela Integração de Contratos). Sem isso, a
tela avisa e 096/2025 e 086/2021 aparecem como "diverge".

**Exportar correções para o SGC** gera uma planilha (Excel) só com os
contratos a corrigir: média no SGC, média pelos documentos, memória de
cálculo e o que corrigir — pronta para encaminhar a quem mantém o SGC. A
exportação fica registrada na auditoria.

Matriz × filial (mesma raiz de CNPJ) e troca de CNPJ registrada em
aditivo de alteração subjetiva são reconhecidas e não contam como erro.

A tela abre em segundos porque só lê documentos que já estão no **cache
de texto** — nunca dispara OCR. Documento ainda não lido aparece na
contagem e entra depois da próxima varredura.

## Desempenho: OCR com a máquina ociosa (24/09/2026)

Medido numa página real escaneada: o OCR leva ~2,5 s por página e usa
**um** núcleo. Dos 239 documentos da pasta, 123 precisaram de OCR (644
páginas, já no cache); os demais têm texto próprio e não custam nada.

1. **Servidor com prioridade baixa** (`integrations/prioridadeProcesso.js`).
   Ao iniciar, o servidor se coloca "abaixo do normal" no Windows (e o
   processo do OCR, na mínima): os programas do usuário têm a vez, e o
   OCR anda quando a máquina está ociosa. `SERVIDOR_PRIORIDADE=normal` volta ao comportamento anterior.
2. **Leitura noturna — DESCONTINUADA em 25/09/2026** (decisão da
   equipe; a tarefa só rodava com alguém logado). O OCR de um documento
   acontece na importação e em "Atualizar a análise" do contrato. A
   ferramenta continua no projeto; para remover a tarefa agendada:
   `Unregister-ScheduledTask -TaskName "Central de Contratos - leitura noturna" -Confirm:$false`.
   Descrição original, para referência: (`ferramentas/leituraNoturna.js`). Lê, fora do
   expediente e com prioridade mínima, o que ainda não está pronto no
   cache — nesta ordem: documentos nunca lidos, leituras incompletas
   (lidas por inteiro, como o Mapa de risco precisa) e escaneados lidos
   com nitidez menor. Para às 07:00 (ou `--ate HH:MM`), entre um
   documento e outro; não roda duas vezes ao mesmo tempo; só escreve no
   cache de texto (gravação atômica), então pode rodar com o servidor
   ligado. Resumo de cada noite em `logs/leitura-noturna.log`.

   ```bash
   npm run leitura-noturna -- --simular
   ```

   Para agendar (todos os dias às 22h; o computador precisa estar ligado),
   no **PowerShell** — o `schtasks` com aspas escapadas (`\"`) só funciona
   no Prompt de Comando, e no PowerShell dá "Argumento/opção inválido":

   ```powershell
   Register-ScheduledTask -TaskName "Central de Contratos - leitura noturna" -Action (New-ScheduledTaskAction -Execute "C:\Users\cgjoao\Prefeitura de Itaverde\central-contratos-app\ferramentas\leitura-noturna.cmd") -Trigger (New-ScheduledTaskTrigger -Daily -At 22:00) -Settings (New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries) -Description "Le os documentos novos da pasta de contratos fora do expediente"
   ```

   Conferir: `Get-ScheduledTask -TaskName "Central de Contratos - leitura noturna"`.
   Remover: `Unregister-ScheduledTask -TaskName "Central de Contratos - leitura noturna"`.

3. **Nitidez maior — testada e não adotada.** Numa página, a confiança
   do OCR subia de 91% para 93%. Mas, relendo 139 páginas de 6 contratos
   a 144 dpi (contra 94 dpi), as regras deram o mesmo resultado em 4,
   melhoraram um acento em 1 e pioraram 1 (a garantia do 108/2024 deixou
   de ser reconhecida), com ~60% a mais de tempo por página. A leitura
   noturna usa a nitidez normal; `LEITURA_NOTURNA_ESCALA=2.0` religa a
   releitura, se quiser testar de novo.

Não adotado (por ora): Tesseract instalado no Windows ou OCRmyPDF em
Python. São mais rápidos porque usam vários núcleos de uma vez — o que
esta máquina não tem sobrando — e exigem instalar programas. Valem se o
servidor for para uma máquina própria.

Melhor ainda que qualquer OCR: digitalizar como **PDF pesquisável** (a
copiadora faz o OCR na hora). Esses arquivos não passam por OCR aqui.

### Leitura de PDF e OCR fora do servidor (24/09/2026)

A leitura do texto dos PDFs, o desenho das páginas escaneadas e o OCR
rodam num **processo separado** (`integrations/ocrTrabalhador.js`), com
prioridade **mínima** no Windows. Medido com documentos reais — maior
tempo em que o servidor ficou sem responder:

| Situação | Antes | Agora |
|---|---|---|
| PDF com texto próprio de 348 páginas | ~3.000 ms | ~13 ms |
| PDF escaneado (por página) | ~200 ms, a cada página | ~13 ms no total |
| Varredura da pasta de rede (239 arquivos) | ~1.700 ms | ~15 ms (agora assíncrona) |

- **Um documento por vez** (fila): duas leituras simultâneas dobrariam
  memória e processador.
- **Memória devolvida:** o processo do OCR é encerrado depois de 60 s sem
  uso (`CONTRATOS_OCR_OCIOSO_MS`); abre de novo quando precisar (~1 s).
- **Trava de segurança:** se uma página emperrar, o processo é encerrado
  depois do tempo do documento + 2 min, e a leitura conta como falha —
  nunca fica pendurada.
- **Páginas em branco** (versos, separadores) não passam pelo OCR — eram
  25 de 644 páginas.
- **Menos trabalho por página:** a checagem de texto invertido do
  Tesseract (que não ocorre em contrato) foi desligada: ~8% mais rápido,
  mesmo texto.
- Por que processo e não "thread": o componente nativo de desenho
  derruba o Node ("Segmentation fault") quando uma thread é
  descarregada. Como processo, ainda ganha prioridade própria.
- A varredura automática agendada (`CONTRATOS_VARREDURA_AUTOMATICA_HORA`,
  desligada por padrão) só dispara nas 4 h seguintes ao horário marcado.
  Antes, marcada para as 2h e com o servidor aberto às 9h, disparava às
  9h, em pleno expediente.

### Uma leitura por página (24/09/2026)

- **Leitura incremental.** O cache guarda quais páginas já passaram pelo
  OCR. Quando alguém pede mais do que foi lido (a varredura lê 10 + 2
  páginas; o Mapa de risco pede o documento inteiro), só as páginas que
  faltam são lidas. Medido no contrato 061/2025: 7 páginas em 10 s, em
  vez de reler as 17 (~31 s). Leitura interrompida pelo tempo continua de
  onde parou — antes ficava no cache como se servisse, e as páginas
  restantes nunca eram lidas.
- **Um contrato escolhido a dedo é lido por inteiro.** A importação
  manual (arquivos selecionados) e a ficha de cadastro usam a mesma
  leitura completa do Mapa de risco (`LEITURA_COMPLETA` em
  `extratorDocumento.js`). Importar um contrato e depois gerar o Mapa
  custa uma leitura de cada página, e o Mapa sai na hora. A varredura da
  pasta inteira continua com o limite menor.
- **Fila única:** pedir a importação e o Mapa ao mesmo tempo não dobra o
  peso — o segundo espera o primeiro, um documento por vez.

### Máscara de CPF reforçada (24/09/2026)

A máscara antiga só reconhecia "123.456.789-01". No texto guardado, 140
CPFs tinham escapado: pontuação trocada pelo OCR ("123,456.789-01",
"123.456 789-01", quebra de linha) e o CPF colado ao nome no carimbo da
assinatura digital ("FULANO DE TAL:12345678901"). A máscara nova
(`integrations/mascaraDados.js`) cobre esses casos e não mexe em valores
em reais, CNPJ, NIRE nem número de processo. Para aplicá-la ao que já
estava guardado (cache de texto, cache da avaliação e propostas no
`data.json`, com backup e só com o servidor desligado):

```bash
node ferramentas/remascararCpf.js --confirmar
```

Já aplicada em 24/09/2026. Os backups diários antigos (`backups/`)
continuam com o texto de antes.

## Páginas no lugar de janelas, limpeza e movimento (07/10/2026)

**Cada tela tem endereço** (`#/contratos`, `#/contrato/24`, `#/analise-risco/33`…):
o "voltar" do navegador, o F5 e o link copiado funcionam. O botão
"‹ Voltar" de cada página volta para onde a pessoa estava (Início, lista…);
aberta direto por link, volta para a lista daquela página.

**Viraram páginas** (antes eram janelas grandes, com tudo espremido): detalhe
do **contrato** (com o histórico administrativo), **leitura do contrato**
(Base de dados), **análise de risco**, **registro de riscos**, **requisição**,
**análise de requisição recebida**, **relatórios do processo** e
**conferência com o SGC**. A mesma função de cada uma monta o conteúdo;
`janela` (js/app.js) decide se ele vai para a página aberta ou para um modal.

**Continuam modais** (tarefas curtas): formulários de registro e edição,
confirmações, aprovar/rejeitar na Fila, perfis e prazos, alteração da UFM,
risco/problema do registro e fichas do SGC.

**Limpeza:** "Como funciona esta tela" virou um botão no cabeçalho (antes,
uma faixa em cada tela); Início com 4 cards e o resto em um resumo; avisos
com a linha inteira abrindo o contrato; Mapa de risco com 4 cards, "O que
fazer agora" recolhido e a linha abrindo a análise; Requisições sem o
quadro grande (o botão "Analisar requisição recebida" foi para o topo) e
com a linha abrindo a requisição; Relatórios mensais com as três
exportações num menu "Exportar"; subtítulos mais curtos.

**Segunda passada (07/10/2026):** Contratos e Base de dados com o número do
contrato como link da linha (sai a lupa e o "Ver" repetidos; a Base perdeu os
3 cards que repetiam a contagem dos filtros e juntou as exportações num menu);
Pendências de leitura sem os 4 cards zerados quando não há pendência; Painel
com os 5 contratos de maior risco e o atalho para o Mapa; UFM com o aviso da
planilha como nota da tabela; Trilha de auditoria e Contas sem cards
repetidos, com ações e entidades em português; etiquetas de procedência da
Fila mais discretas; legendas "clique na linha…" removidas.

**Menu lateral:** 11 itens à vista em vez de 17 — Início e Painel; **Contratos**
(Contratos, Mapa de risco, Relatórios mensais, Requisições, UFM); **Documentos**
(Fila, Base de dados, Busca, Pendências de leitura) — e **Configurações** recolhível
(Alertas de vencimento, Alertas por e-mail e, para admin, Contas, Trilha de
auditoria e Leituras reportadas), que abre sozinho quando a tela aberta é dele e
lembra se ficou aberto. Sem subtítulo nem rodapé; contador só quando pede ação
(Fila); um ícone diferente para cada item. No menu recolhido (só ícones), o grupo
vira uma engrenagem que abre e fecha os seus ícones.

**Movimento:** entrada suave de cada tela, cards em sequência, números que
contam até o valor, elevação ao passar o mouse, resposta ao clique, seções
que abrem com altura animada. Tudo desliga com "reduzir movimento" do
sistema operacional.

## UFM e gratificação dos gestores — GFE (06/10/2026)

Tela **UFM e gratificação** (menu Contratos). Reproduz a planilha
"cálculo de pag. GFE - Gestores de Contratos" (abas GERAL e Calculo),
`integrations/ufm.js`:

- **Valor mensal do contrato** = (contrato + aditivos) ÷ meses de vigência —
  o mesmo valor mensal que a Central já mostra em Contratos.
- **Valor em UFM** = valor mensal ÷ **valor da UFM** (R$ 5,00 na tabela de exemplo).
- A **faixa** dá a gratificação por contrato, com as bordas da fórmula da
  planilha (SE UFM < 4.001; < 20.001; < 80.001). Valores de exemplo:

| Faixa (UFM) | % | Gratificação | Limite de contratos por gestor ("qtde contratos até") |
|---|---|---|---|
| até 4.000 | 5% | R$ 150,00 | 10 |
| 4.001 a 20.000 | 12,5% | R$ 390,00 | 8 |
| 20.001 a 80.000 | 25% | R$ 750,00 | 4 |
| acima de 80.000 | 50% | R$ 1.500,00 | 2 |

A tela mostra a tabela vigente, cada contrato (valor mensal, valor em UFM,
faixa e gratificação; em vigência, encerrados ou todos), o total por gestor
e a planilha para exportar.

**Alterações com histórico:** quando muda o valor da UFM (decreto) ou a
tabela, "Registrar alteração" (só admin) cria uma **versão nova**, com a data
em que passa a valer, o ato que a fundamenta, quem registrou e quando. A
anterior continua no "Histórico de alterações"; nada se apaga. Data futura =
alteração agendada (passa a valer sozinha no dia). Duas versões com a mesma
data: vale a registrada por último (é como se corrige um lançamento errado).
Antes de salvar, a tela mostra quantos contratos mudam de faixa e o novo
total mensal. Tudo na Trilha de auditoria.

**Conferido com a planilha (06/10/2026):** nos 20 contratos que estão nas
duas, a faixa e a gratificação são as mesmas. Em 11 o valor mensal difere
porque a planilha usa um nº de meses que não fecha com as datas dela (ex.:
038/2023, 54 meses de 27/03/2023 a 28/04/2025); a Central conta pela vigência
lida dos documentos. A tela avisa quando o valor de uma faixa não bate com o
percentual da mesma base das outras (na tabela de exemplo, R$ 390,00 não é
12,5% de R$ 3.000,00 — seria R$ 375,00) — o cálculo usa o valor em reais,
como a planilha.

## Criticidade por contrato e Histórico administrativo (06/10/2026)

Duas sugestões da gestão.

### Criticidade individual: perfis de trâmite

Cada contrato tem trâmites diferentes na Prefeitura — uma prorrogação por
aditivo leva um tempo, uma nova licitação leva meses —, então "crítico a
15 dias do fim" não serve para todos.

- Em **Alertas de vencimento** ficam os **perfis de trâmite**: cada um com
  os dias antes do término em que o contrato entra em Crítico, Atenção e
  Próximo. O perfil **Padrão** é o de sempre (os limiares que já existiam).
- No detalhe do contrato, linha **"Prazos de alerta" → alterar**: escolhe-se
  o perfil ou prazos próprios do contrato (com motivo obrigatório). Quem
  pode: admin e gestor. Criar e editar perfis: admin.
- A Central **sugere** um perfil com mais antecedência quando o contrato já
  está no limite legal de prorrogação (o próximo passo é nova licitação).
  Só sugere; quem decide é a pessoa.
- A mesma classificação vale no Início, em Contratos, no Painel, no e-mail
  de alertas e no eixo Prazo do Mapa de risco (`integrations/prazosContrato.js`
  é a única fonte). Mudar um perfil muda todos os contratos dele. Perfil em
  uso não pode ser excluído. Tudo na Trilha de auditoria.

### Histórico administrativo do contrato

O registro de tudo o que aconteceu no contrato no âmbito administrativo
(`integrations/historicoContrato.js`), aberto pelo detalhe do contrato,
pelo ícone de sino em Contratos ou por "Ver histórico" no Início.

- **Tipos:** solicitação do TCE, solicitação de diretor/secretário, ofício
  recebido, ofício enviado, despacho, notificação à contratada, reunião,
  tratativa interna e outro. Cada registro tem data, quem solicitou, nº do
  documento/processo, descrição, prazo de resposta, situação (em aberto,
  respondida, concluída, só registro) e, opcionalmente, o caminho do
  documento na pasta de rede.
- **Nada se apaga.** "Corrigir" guarda a versão anterior, com quem corrigiu,
  quando e por quê (motivo obrigatório para mudar o conteúdo; marcar como
  respondida não pede). As correções ficam visíveis no próprio registro.
- Quem registra: a equipe da SETEC (admin, gestor, fiscal); "consulta" só vê.
- Registro **com prazo** fica em aberto; os atrasados e os que vencem em
  até 5 dias aparecem no **Início**. Registros em aberto contam como risco
  no Registro de riscos (antes: "tratativas em andamento").
- A linha do tempo junta os registros com o que a Central já lê das pastas
  — **aditivos, apostilamentos e requisições do TCE e do SisFin** —,
  marcados "lido da pasta".
- **Exportar:** PDF e planilha do histórico de cada contrato.
- **Tratativas:** viraram registros do tipo "Tratativa interna" (migração
  automática ao iniciar o servidor, uma vez só; a lista antiga fica no
  data.json, sem uso). "Registrar tratativa" passou a "Registrar no
  histórico".

## Varreduras: pastas lidas em paralelo (06/10/2026)

As três varreduras (Fila de importação, Relatórios mensais e
Requisições) liam a pasta de rede **uma pasta por vez**: quase todo o
tempo era espera pela resposta do servidor de arquivos, não
processamento. Agora fazem até **8 pedidos à rede ao mesmo tempo**,
somando todas (`integrations/percursoPastas.js`; ajustável com
`PASTAS_PEDIDOS_SIMULTANEOS`, de 1 a 32 — 16 foi medido e não ganhou
nada). O que cada varredura encontra, e em que ordem, não mudou.

Medido na pasta real, versão antiga × nova, com resultado idêntico:

| Listagem | Antes | Agora |
|---|---|---|
| Fila de importação | 11,9 s | 1,9 s |
| Relatórios mensais | 8,4 s | 2,3 s |
| Requisições | 21,0 s, **com o servidor travado** | 4,5 s, sem travar |

A busca das Requisições lia a rede de forma "bloqueante": durante os
~20 s, nenhuma tela da Central respondia. Agora o servidor continua
atendendo enquanto ela roda. O tempo do OCR e da leitura dos documentos
novos continua o mesmo — a mudança é só em listar as pastas.

## Cache do texto extraído

O OCR custa minutos por PDF digitalizado. Desde 21/09/2026, o texto de
cada documento fica em `.texto-cache/` (fora do controle de versão),
válido enquanto o arquivo não mudar (tamanho + data de modificação).
Varredura, ficha de cadastro, mapa de risco e conferência reaproveitam o
texto; OCR parcial (10 páginas) não serve para o mapa de risco, que pede o
documento inteiro. O texto sai sempre com CPF mascarado — também na
prévia guardada nas propostas, que antes saía sem máscara.
`CONTRATOS_CACHE_TEXTO=false` desliga.

Para não refazer o OCR que a avaliação já fez:

```bash
npm run avaliacao:semear-cache
```

Em 21/09/2026 isso copiou 220 documentos: a primeira varredura da pasta
inteira não precisa refazer o OCR.

## Integração com o SGC: desligada (23/09/2026)

A Central deixou de consultar a API do SGC, e os dados que vieram dela
são removidos do banco local.

- **Chave**: `CONTRATOS_API_DESLIGADA=1` no `.env`. Com ela, nenhuma
  entidade conta como configurada — nem que as URLs voltem ao `.env` por
  engano — e a rota de sincronização responde 410. As URLs estão
  comentadas no `.env` e o segredo do Azure AD foi **retirado** do arquivo.
- **Tela**: o item "Conferência com o SGC" sai do menu (não há mais o que
  comparar) e "Sincronização com o SGC" vira **"Alertas por e-mail"**, só
  com o resumo diário.
- **Dados**: `node ferramentas/removerDadosSgc.js` mostra o que seria
  removido; com `--confirmar`, remove. O script **se recusa a gravar com o
  servidor no ar** (o servidor guarda o banco em memória e devolveria os
  dados ao arquivo) e copia o `data.json` para
  `backups/antes-de-remover-sgc-AAAA-MM-DD-HHMMSS.json` antes de gravar.
  Sai o que tem a marca `origemExterna` (contratos, aditivos,
  apostilamentos, requisições, gratificações) e o que ficaria órfão (mapas
  de risco, fichas, tratativas e comentários desses contratos). Ficam a
  trilha de auditoria e as propostas da Fila — as pendentes perdem o
  vínculo com o contrato removido, e aprovar passa a criar um contrato
  novo.
- **Religar**: apagar a chave, descomentar as linhas, gerar um segredo
  novo no Azure AD e restaurar o backup (com o servidor parado).

## Aditivos e apostilamentos lidos dos documentos

Desde 23/09/2026, com a integração do SGC desligada, os termos vêm da
pasta "3. Contratos, Aditivos e Termos" (`integrations/termosDosDocumentos.js`):
número e ano, data de assinatura (o fecho "Itaverde, ..."), tipo
(prorrogação, acréscimo, supressão, reajuste, retificação, alteração de
gestor, cessão, alteração subjetiva...), efeito no valor e no prazo — os
mesmos do cálculo da média mensal — e, nos termos de gestão, quem passou a
constar. Só entram documentos que citam o número do contrato.

- Leitura (varredura e "Recalcular pelas regras"): `termosLidos` na proposta.
- Aprovação: os termos lidos são gravados em `db.aditivos` /
  `db.apostilamentos` com `origem: 'documento'`; reaprovar ou recalcular
  substitui, não duplica, e o que foi cadastrado à mão fica.
- "Recalcular pelas regras" também relê os termos dos contratos já
  aprovados — termo arquivado depois da aprovação passa a aparecer.
- Base de dados → Aditivos / Apostilamentos: "Aprovado" (no cadastro) ou
  "Pendente" (contrato ainda não aprovado na Fila).

**Contrato sem término:** a aprovação deixou de gravar a data de *hoje*
quando a vigência não foi lida (fazia 17 de 29 contratos aparecerem como
"vence hoje"). O contrato fica "Sem término", com faixa própria em
Início, Contratos e no resumo por e-mail, até a vigência ser resolvida em
"Pendências de leitura".

## Relatórios mensais de todos os contratos (29/09/2026)

Menu **Contratos → Relatórios mensais**. Junta o que está na subpasta
**"Relatórios mensais de atividades"** de cada processo da pasta de rede
(em vigência, encerrados e outras secretarias) e mostra, contrato a
contrato, **quais meses da vigência estão sem relatório**. Módulo:
`integrations/relatoriosMensais.js`. Só lista nomes e datas — não abre
nem altera arquivo; o PDF abre pelo servidor, que só entrega arquivo
achado na última leitura e de dentro das pastas configuradas.

- **Mês de cada arquivo:** prefixo "AAAA_MM" no nome (o padrão:
  "2025_08 - Relatório Mensal (Sigma Cofre de Senhas) - Agosto.pdf"),
  "MM.AAAA" ("ITD - 02.2025"), nome do mês com o ano do nome ou da
  subpasta ("2023/Dezembro"). Quando o prefixo e o nome do mês
  discordam ("2024_07 ... - Junho"), vale o nome do mês, com aviso.
  Cronograma, planilha, "Relatório Pendentes" e entregas aparecem na
  lista, mas não contam como relatório do mês.
- **Meses esperados:** do início ao término do contrato cadastrado, até
  o mês passado; até o dia 10, o mês passado fica "no prazo de
  entrega". Processo sem contrato cadastrado conta do primeiro ao último
  relatório da pasta.
- **Não exige relatório mensal** (gestor/admin, no detalhe): contrato de
  compra, licença ou entrega única — os meses deixam de ser cobrados.
- Tela: faixa dos últimos 12 meses por contrato (✓ com relatório, !
  sem, … no prazo, · fora da vigência), meses com relatório (x de y),
  último relatório, meses faltando; filtros por pasta (em vigência,
  encerrados, outras secretarias) e situação. O detalhe mostra a grade
  por ano e os arquivos de cada mês, com **Abrir** e **Copiar caminho**.
- Planilhas: **meses sem relatório** e **lista de relatórios** (com o mês
  de cada um). Leitura, arquivo aberto, "não exige" e planilhas ficam na
  Trilha de auditoria.
- Medido em 29/09/2026: 2.279 arquivos em 56 processos (leitura em ~8 s;
  a lista vai à tela sem os arquivos — 67 KB, não 1,5 MB); 457 sem mês
  no nome; 17 downloads incompletos (".crdownload") apontados; nos 36
  processos em vigência, 50 meses sem relatório — 12 deles do 061/2025,
  cuja pasta só tem "Relatório de entrega" (candidato a "não exige").

### Falta de relatório vira risco (01/10/2026)

O Registro de riscos ganhou a regra **RELATORIO_MENSAL_FALTANDO** (eixo
Gestão do Mapa; grupo **"Cobrar relatórios mensais"** em "O que fazer
agora", a partir de criticidade 6). O peso vem dos meses que faltam nos
**últimos 6 meses cobrados** (o mês ainda no prazo de entrega não conta):
3 ou mais → 4×3 = 12; 2 → 3×3; 1 → 2×3; só meses antigos → 2×2. Contrato
**encerrado** fica em 2×2 com o título "Contrato encerrado com N mês(es)
sem relatório" — a falta continua registrada (o Tribunal pode pedir), mas
não há mais o que cobrar. "Não exige relatório mensal" tira o risco. O
risco só aparece depois de **Ler as pastas** nesta tela.

### Padrão de nome (01/10/2026)

O padrão é `AAAA_MM - Relatório Mensal - Empresa - Mês.pdf` (detalhes em
[GUIA-DE-NOMES.md](../GUIA-DE-NOMES.md), que vale também para requisições,
contratos, aditivos e apólices). Arquivo fora do padrão ganha o selo
**fora do padrão** e o **nome sugerido**, com botão para copiar; a planilha
**Fora do padrão de nome (CSV)** lista todos para a equipe renomear. A
Central **não renomeia nem move** nada.

### Indicadores do conteúdo (01/10/2026)

No detalhe do processo, **Ler os indicadores** abre os relatórios dos
últimos 12 meses (um por mês, o maior PDF/DOCX) e tira, por regra, o que
aparece de forma reconhecível — sempre com o **trecho** (ao passar o mouse)
e a **página** (o link abre o PDF nela). Módulo:
`integrations/indicadoresRelatorios.js`.

- **Disponibilidade:** percentuais de 50% a 100% de uma tabela de
  disponibilidade (5 ou mais na página) ou logo depois da palavra; mostra
  o menor e a média. Meta do contrato ("disponibilidade mínima de 99,5%"),
  avanço de projeto, consumo e similares não contam.
- **Chamados:** o total declarado ("Chamados Total Encerrados Em
  atendimento 6 6 0"), ou os números listados (INC…, RITM…, "Ticket:
  7159", sem repetir); "não foram registradas ocorrências" vira 0.
- **Horas:** "124 das 600 horas" → 124 de 600 h (20,7%).
- **SLA:** percentuais logo depois de "SLA" / "nível de serviço".
- **Sem OCR:** relatório digitalizado aparece como "sem texto (imagem)" —
  OCR em 2.000 relatórios travaria a máquina. O texto lido fica no cache
  (e entra na Busca nos documentos). Primeira leitura de um processo: 3 a
  8 s; depois, imediata.
- Medido em 01/10/2026 (2 meses de cada um dos 36 processos com relatório):
  Conecta e Conecta Wi-Fi (chamados listados), SIGMA (totais de chamados),
  Vox Telecom e Meridiano (disponibilidade por unidade, menor 83,57%),
  Licencia (horas). Cerca de metade dos fornecedores não traz número
  reconhecível — o relatório é descritivo; para esses, a tela diz isso.

## Requisições: TCE-SP e SisFin (29/09/2026)

Menu **Documentos → Requisições**. Como os contratos e o Mapa de
risco: a Central lê o documento da pasta de rede, extrai os campos por
regra, mostra a frase de onde saiu cada um, e quem confere
corrige e confirma. Código: `integrations/requisicoes.js`.

"Requisição" quer dizer duas coisas, e a tela tem uma aba para cada
(decisão do usuário, depois de ler o SGC):

- **TCE-SP** — o que o SGC chama de requisição (módulo Requisições, 32
  cadastradas em 29/09/2026): a requisição de documentos do Tribunal de
  Contas. O formulário "Cadastrar Requisição" do SGC pede **Contrato\*,
  Requisição (nº), Data\*, Observações, TC, Ofício e Arquivo** — é a
  **ficha de cadastro** que a Central monta (na tela e em PDF, para
  digitar no SGC). No SGC, "Ofício" é o número do **protocolo digital**
  (12 dígitos); sem ele no texto, vai o nº do ofício de resposta.
  Na pasta, esses documentos **não têm lugar fixo** ("16. Outros
  documentos", "Requisições TCE", "Tribunal de Contas", "17.
  Pagamentos"): são achados por pasta ou arquivo com "TCE", "TCESP" ou
  "Tribunal de Contas" no nome. A requisição e os documentos que
  respondem a ela (mesmo nº de requisição ou, sem nº, mesmo TC) viram
  uma linha só. Arquivo que não cita o Tribunal (relatório de
  instalação, termo de encerramento anexado) fica de fora. Medido: 31
  documentos, 11 anexos, 11 requisições — todas de processos
  **encerrados** (as requisições recentes estão só no SGC, com o PDF
  guardado lá). Tipos: requisição de documentos, ofício de resposta,
  relatório de fiscalização, declaração.
  **Data:** a da própria requisição; data do contrato, da vigência, de
  empenho e o **prazo de entrega** (guardado à parte e posto nas
  observações) não contam. Sem data própria no texto, fica em branco —
  é obrigatória no SGC, quem confere preenche.
- **SisFin** — a requisição do sistema contábil, na subpasta **"19.
  Sisfin / 1. Requisição"** de cada processo (texto digital, sem OCR).
  **RC** (requisição de serviços: itens com quantidade, unidade, valor
  unitário e estimado, dotação, elemento da despesa, valor a reservar,
  justificativa) e **AD** (alteração contratual — renovação, reajuste:
  fornecedor, licitação, AF/OS, situação, itens com o tipo de alteração,
  valor total e reservado, programação mensal de pagamento). Versões da
  mesma requisição (a reemissão para o empenho do ano) viram uma linha;
  vale a impressa por último. Medido: 39 documentos, 24 requisições; nas
  39, a soma dos itens bate com o total. O SGC não tem este cadastro.

O contrato de cada requisição sai do **PA da pasta** (o do SisFin, do
"Nro Processo"), ou do nº de contrato citado. O login e o nome de quem
cadastrou no SisFin (rodapé) não são guardados.

**Ler as pastas agora** (gestor/admin) roda em segundo plano, só lê, e
usa o cache de texto (poucos segundos depois da primeira vez).
**Conferir** grava os campos corrigidos (com o valor lido antes na
Trilha de auditoria); **Descartar** tira a linha das listas e da
planilha; as duas podem ser desfeitas. **Exportar CSV** e **Baixar
ficha (PDF)** também ficam na auditoria.

**Onde está a resposta (29/09/2026).** A Central **não responde** a
requisição: lê o documento de pergunta, separa os itens que o Tribunal
pede ("1) Encaminhar as notas de empenho...", "a) Informar...") e aponta,
para cada um, a **pasta do processo** onde costuma estar o documento da
resposta — com a quantidade de arquivos, as subpastas (anos) e um botão
para copiar o caminho e colar no Explorer. Módulo:
`integrations/direcionamentoRequisicao.js`.
- **Assunto → pasta**, pela estrutura padrão dos 65 processos da raiz
  "9. Gestão de Contratos": empenho → "Empenhos" e "Sisfin/Empenho";
  liquidação → "Liquidações"; notas fiscais → "NF, BRM_BRS e
  comprovantes"; pagamento → "Pagamentos"; medições → "Atestados
  técnicos"/"Relatórios mensais"; recebimento → "TRP e TRD"; cronograma,
  treinamento, garantia, sanção, gestor/fiscal, aditivos, edital, ordem
  de início, encerramento, regularidade fiscal, publicação... (29
  assuntos). Vale o NOME da pasta (o número na frente muda).
- Pasta específica ganha da genérica ("Outros Documentos/Treinamento" em
  vez de "Outros Documentos"); pasta vazia aparece com "0 arquivo(s)"
  (documento talvez não arquivado). Citação como "conforme item 13 do
  termo de referência" não conta como pedido do edital.
- **Arquivos com nome relacionado** fora das pastas apontadas — é assim
  que aparece uma resposta anterior (ex.: "Of. 96 2020 - Declaração
  Negativa de Sanção", para o item de sanções).
- Item que pede "Informar...", "declarar" ou "em caso positivo" é marcado
  **"pede manifestação do gestor"**: a resposta é escrita por ele, com
  apoio das pastas indicadas.
- **Requisição que chegou do Tribunal**: botão "Analisar requisição
  recebida" (aba TCE-SP; admin, gestor ou fiscal) — envia o PDF ou Word
  (até 25 MB). O arquivo é lido num temporário, **sem cache**, e apagado;
  fica guardado só o resultado (até 50 análises). O processo é achado
  pelo PA citado, pelo contrato cadastrado na Central ou pelo nome da
  empresa no nome da pasta; quem analisa pode trocar (lista dos
  processos) e "Atualizar pastas" depois de arquivar documentos.
- Requisição já lida da pasta: o detalhe mostra a mesma seção, com o
  processo onde ela está.
- Medido no caso real (DF-5.4 nº 107/2020, Vertex): 9 itens lidos; 8 com
  pasta indicada; o item 6 saiu truncado do OCR ("Fornecer a r
  setembro") e fica marcado "assunto não identificado — leia no
  documento". A data da requisição agora é lida do fim do documento
  ("DF-5.4, 09 de outubro de 2020").

**Máscara de CPF × número do TC.** O processo do TCE ("TC-025938.989.20-9")
tem 11 dígitos, como o CPF, e a máscara apagava — o campo TC da ficha
nunca seria lido. Agora o formato do Tribunal (grupo "989", ano e o
dígito "-D", ou "TC"/"e-TCE" antes) é preservado; CPF continua mascarado.
Textos lidos antes da correção são relidos na próxima leitura.

### Prazo e situação da resposta ao Tribunal (01/10/2026)

Cada requisição do TCE (lida da pasta ou enviada pela tela) mostra a
**situação da resposta**: *respondida* (registrada à mão, ou há "Ofício de
resposta"/"Resposta ao TCE" na pasta), *atrasada há N dias*, *vence em N
dias* (até 5), *no prazo*, *sem prazo no documento* ou *antiga* (prazo
vencido há mais de 90 dias, sem alerta). O **Início** mostra um aviso com
as atrasadas e as que vencem logo. **Registrar resposta** (admin, gestor,
fiscal) guarda a data e o ofício; **Reabrir** desfaz. Ambos ficam na
Trilha de auditoria. A Central continua sem responder requisições: só
acompanha o prazo.

## Visão do contrato (01/10/2026)

O detalhe de um contrato (Contratos → clique na linha) abre com quatro
blocos antes do cadastro: **Risco** (nível e os pontos de criticidade 6
ou mais do Registro), **Relatórios mensais** (faixa dos 12 meses e o que
falta), **Requisições** (TCE com a situação da resposta; SisFin) e
**Garantia e pendências** (validade da apólice, termo de encerramento a
confirmar, tratativas abertas). Só junta o que os outros módulos já
calculam (`integrations/visaoContrato.js`). O nome da empresa tem o link
**ficha da empresa (SGC)**.

## Busca nos documentos (01/10/2026)

Menu **Documentos → Busca nos documentos**. Procura em todos os documentos
que a Central **já leu** (o cache de texto: contratos, aditivos, apólices,
requisições, relatórios cujos indicadores foram lidos): palavras em
qualquer ordem (todas precisam aparecer), "frase entre aspas", CNPJ; sem
diferença de maiúsculas e acentos. Cada resultado traz o processo, o
contrato, as ocorrências e até 3 trechos com a página — um de cada termo
primeiro —, **Abrir** (na página) e **Copiar caminho**. Filtro por pasta
(em vigência, encerrados, outras secretarias). Só abre arquivo que está no
índice **e** dentro das pastas configuradas; cada busca fica na Trilha de
auditoria. Documento que a Central nunca leu (uma nota fiscal) não aparece.
Medido: índice de 921 documentos montado em 0,8 s na primeira busca;
depois, ~80 ms por busca. Módulo: `integrations/buscaDocumentos.js`.

## Leitura errada (01/10/2026)

Ao lado de cada campo lido de documento (Base de dados, detalhe da
requisição), o botão **⚑** registra o que foi lido, o valor certo e o
documento. **Não corrige o dado** — a correção continua na Fila de
importação ou na conferência da requisição: é a lista de casos reais para
ajustar as regras de leitura (cada um vira um caso de teste).
**Administração → Leituras reportadas** lista, marca como resolvida
(admin) e exporta CSV. Módulo: `integrations/leiturasReportadas.js`.

## Fichas do SGC: aditivo, apostilamento e empresa (01/10/2026)

No mesmo modelo da ficha de requisição: os campos do formulário
"Cadastrar" do SGC (tirados do código de referência do SGC) preenchidos
com o que foi lido, para conferir e digitar lá — modal com **copiar** em
cada campo e **Baixar PDF**.

- **Aditivo / apostilamento** (botão **Ficha** em cada termo aprovado da
  Base de dados): contrato, tipo, objeto (resumo: tipo, meses, valor,
  gestor — não o preâmbulo inteiro), número, data do extrato, valor,
  **nova data de término** (o período da vigência que veio daquele termo;
  achada nas 17 prorrogações) e o arquivo.
- **Empresa** (link no detalhe do contrato): nome e CNPJ.
- **Portaria e Iom** ficam de fora: a Central não lê esses números dos
  documentos — a ficha sairia em branco.

Módulo: `integrations/fichasSgc.js`. Rotas
`/api/fichas-sgc/termo/:especie/:id` e `/api/fichas-sgc/empresa/:contratoId`
(`?formato=pdf` baixa o PDF, registrado na Trilha de auditoria).

## Registro de riscos (modelo do SGC)

A planilha "MAPA DE RISCOS EM CONTRATOS DA PM ITAVERDE v.1.1" (SGC, nov/2024)
dentro do sistema — Mapa de risco → botão **Registro** em cada contrato.
Módulo: `integrations/registroRiscos.js`.

- **Metodologia da planilha**: probabilidade e impacto de 1 a 5,
  criticidade = P × I, critério de aceitação idêntico à fórmula da coluna R
  (até 2 Registrar; 3–6 Aceitar e monitorar; 8–14 Mitigar; 15–25 Evitar),
  tipos de risco, classificação interna/externa e categorias da aba
  "Dados". A decisão de aceitar continua sendo do gestor.
- **Painel**: gestor, suplente e fiscal (lidos dos atos de gestão),
  vigência, valor, objeto, P.A. e data da última revisão.
- **Matriz 5 × 5** com a quantidade de riscos ativos por célula.
- **Riscos automáticos**, calculados dos documentos lidos, com fundamento
  legal e a evidência que os disparou:
  vencimento (vencido / 30 / 90 / 180 dias); limite de duração (Lei 8.666:
  60 meses + 12 excepcionais; Lei 14.133: 10 anos); acréscimos acima de
  25% (sem compensar supressões); gestor ou suplente não identificados;
  reajuste há mais de 24 meses; vigência não comprovada pelos documentos;
  concentração em um fornecedor; termo só com extrato; e cláusulas
  obrigatórias ausentes no checklist da Lei 14.133 (Mapa de risco). O
  regime legal (8.666 ou 14.133) é lido do texto; sem citação, presumido
  pela data de início (e dito na evidência).
- **Tratar** um risco automático grava a resposta, a contingência, o
  responsável e o status dele — e, se o gestor discordar, P e I.
- **Riscos e problemas do gestor**: os formulários das abas "Riscos" e
  "Issues", validados pelas listas da planilha; o problema pode apontar o
  risco relacionado. Tudo com auditoria.
- **Exportação** em CSV nas colunas das abas "Riscos" e "Issues", para
  colar no modelo do SGC.

Erros encontrados na planilha (não copiados para o sistema): escala de
impacto do "Leia-me" com "4 - Moderado" no lugar de 3; validação da
coluna Categoria duplicada, uma delas apontando para a linha de baixo
(I8 em vez de I7); nome definido `responseStrategies` apontando para outra
pasta de trabalho que não existe; listas "Interna"/"Externa" incluindo uma
célula vazia; P e I aceitando 0; linha 8 com P e I gravados como 0.

## A IA foi retirada (01/10/2026)

A Central teve uma IA local (Ollama, modelo llama3.2 de 3B) para ler os
campos dos contratos e o checklist do Mapa de risco. Ela foi **desligada
em 24/09/2026** e **retirada do código em 01/10/2026**:

- **Travava a máquina:** 8 GB de RAM, sem placa de vídeo — 6 núcleos por
  ~1 minuto a cada pergunta, 2 a 5 GB de memória presos.
- **Não acertava mais que a regra:** nas 34 propostas medidas, tipo de
  serviço 0 de 23 contra o SGC, preposto 0 de 5, modalidade 0 de 3, e 4 de
  11 gestores errados (o prompt copiado como nome, um cargo no lugar da
  pessoa); no checklist, respondeu "atende" em 16 de 16 itens, inclusive
  onde a regra achou problema. Todos os acertos verificáveis viraram regra.
- **Inventava:** datas de vigência e um valor de R$ 100.000 num contrato de
  R$ 26,1 milhões.

O que mudou com a retirada: nada no resultado. Medido em 01/10/2026 com o
código antes e depois — as 53 propostas aprovadas, os mapas de risco dos
49 contratos e as 49 fichas de cadastro saem **idênticos** (a IA já estava
desligada). Saíram: `integrations/iaProvider.js` (as regras que moravam
nele foram para `integrations/leituraPorRegra.js`), as variáveis
`IA_PROVIDER_*`, os "campos extras" da seleção manual (só a IA os
preenchia) e as telas e testes da IA. O item do checklist que depende de
interpretação fica **para conferência manual**, com o que a regra achou e
o que faltou (38 itens nos 49 contratos).

**LGPD:** nenhum texto de contrato sai desta máquina — a leitura é toda
local. O CPF continua mascarado nas citações do Mapa de risco e da ficha.

**Para voltar atrás:** a versão com IA está no git, na etiqueta `com-ia`
(`git checkout com-ia`). As variáveis `IA_PROVIDER_*` que ainda estiverem
no `.env` são ignoradas e podem ser apagadas.

## Campos lidos por regra

Até 22/09/2026, **objeto**, **tipo de serviço**, **gestor** e **suplente** só
eram preenchidos pela IA. Medido nas 44 propostas daquele dia: dos 303
campos preenchidos, 222 já vinham de regra e 81 da IA — e a IA custava
~66 s por contrato (157 s no modelo anterior). Desses 81, esses quatro
campos eram 66.

Desde 23/09/2026 o módulo `integrations/camposPorRegra.js` lê **objeto** e
**gestor/suplente** de forma determinística. O tipo de serviço foi medido e
**ficou desligado** (veja abaixo).

### Gestor e suplente: o ato mais recente manda

O SGC devolve esses nomes **mascarados** (`***********`), então a única
fonte é o documento. E o documento certo não é o contrato — que traz o
gestor de anos atrás — e sim o **apostilamento ou a portaria mais
recente**, ordenados por ano e número do termo. O nome fica entre o cargo
e a âncora "inscrito no CPF/MF":

> …para que conste como Gestor, o Senhor **FULANO DE TAL**, inscrito no CPF/MF…

O ato precisa citar o número deste contrato — sem essa conferência, um
apostilamento de outro contrato guardado na mesma pasta entrava como
gestor (aconteceu com o 072/2020). O que a regra não consegue ler vira
**aviso** na proposta, em vez de campo errado gravado em silêncio.

Resultado do recálculo sobre as 31 propostas pendentes de 23/09/2026:
objeto 27 → 29, responsável 17 → 20 e suplente 9 → 20, com 24 objetos e 23
nomes trocados. Exemplos de troca: `"gestor"` → `Daniel Nunes Prado`; `"Rodrigo Valente De Ol11.Teira"` → `Wagner Duarte Campos`.

Cada campo lido por regra mostra na Fila **de qual documento veio**.

### Histórico de gestão

O sistema guarda a **cadeia inteira** de gestores e suplentes, e não só o
nome atual (`gestaoHistorico` na proposta). Medido em 23/09/2026: 7 dos 31
contratos já tinham dois ou mais atos de gestão. Sem a cadeia, a resposta
a "quem era o gestor quando isto aconteceu?" sumia a cada apostilamento.

- **Fila de importação** e **"Ver" da Base de dados**: bloco "Histórico de
  gestão", do ato mais recente para o mais antigo, com termo, nomes e
  documento. "vale hoje" marca de onde vem cada nome vigente — o suplente
  pode vir de um ato mais antigo que o do gestor, quando ninguém o trocou.
- **Base de dados → Apostilamentos**: colunas "Gestor" e "Suplente" com
  quem passou a constar em cada ato. Lendo a coluna de cima para baixo,
  vê-se o histórico do contrato; os nomes saem também na planilha.
- O mesmo ato arquivado duas vezes (o PDF e uma cópia, ou a portaria e o
  apostilamento que a publica) entra **uma vez só**.
- Apostilamento de gestão conta como **lido** na Base, mesmo sem mexer em
  valor ou prazo.

O histórico é montado na leitura; para as propostas já na fila, use
"Recalcular pelas regras".

### Tipo de serviço: medido e desligado

O dicionário de palavras-chave concorda com a classificação do SGC em
apenas **8 de 20** contratos — o SGC classifica "Locação de computadores"
como Serviços, e o texto do contrato fala de equipamentos (Hardware). É
julgamento de quem cadastra, não dado do texto. Por isso a regra existe,
tem teste, e vem **desligada** (`REGRAS_CAMPO_TIPO=1` liga).

### Como desfazer

No `.env`:

| Variável | Efeito |
| --- | --- |
| `REGRAS_CAMPOS_EXTRAS=0` | desliga tudo de uma vez |
| `REGRAS_CAMPO_OBJETO=0` | desliga só o objeto |
| `REGRAS_CAMPO_GESTAO=0` | desliga só gestor/suplente |
| `REGRAS_CAMPO_TIPO=1` | liga o tipo de serviço (vem desligado) |

Reinicie o servidor depois de mudar. **Nada já gravado é alterado**: a
regra só vale para a próxima leitura (varredura ou "Recalcular pelas
regras"). Desligado, o campo fica em branco e vai para "Pendências de
leitura".

## Preposto da contratada (24/09/2026)

O contrato só traz a obrigação ("a CONTRATADA deverá manter preposto,
aceito pelo CONTRATANTE" — Lei 14.133, art. 118; Lei 8.666, art. 68). O
nome vem num documento da própria empresa, guardado em qualquer subpasta
do processo: "Ofício ... Apresentação de preposto", "Indicação de
Preposto". A leitura (`acharPreposto` em `camposPorRegra.js`) percorre o
processo atrás de arquivos com **"preposto" no nome** (só eles — é leve)
e da Ordem de Início/Fornecimento, e reconhece "autorizamos FULANO,",
"indicamos como preposto...", "Preposto: FULANO" e a indicação em
**tabela** (nome seguido de telefone; quando há vários, o campo fica com o
primeiro e a origem lista os demais). Telefone, e-mail e documento não são
guardados.

Medido nos 36 processos da pasta: preposto indicado em **3**; em **19** o
contrato exige preposto e a indicação não está nos documentos. Nesses, o
campo diz isso na Fila, e o Registro de riscos mostra "Preposto da
contratada não indicado" (criticidade 6, com o artigo da lei do regime do
contrato).

## Base de dados: contratos, aditivos e apostilamentos

A tela **Base de dados** (grupo "Documentos") tem três abas:

- **Contratos** — o que a Ferramenta 1 leu dos arquivos (ver a seção
  seguinte). Módulo: `integrations/baseContratos.js`.
- **Aditivos** e **Apostilamentos** — os termos do SGC cruzados, termo a
  termo, com o que a leitura dos documentos calculou para cada um.
  Módulo: `integrations/baseTermos.js`.

Nas abas de termos, cada linha junta duas fontes:

- do **SGC** (`db.aditivos` / `db.apostilamentos`): empresa, tipo e data;
- dos **documentos da pasta** (`calculoValor.aditivos` de cada proposta):
  o efeito do termo — quanto somou ao valor e quantos meses prorrogou —,
  que é o mesmo cálculo que alimenta a média mensal da Conferência SGC.

O cruzamento é pelo par contrato + número do termo, normalizando zeros à
esquerda e separador ("156", "156.2022" e "0156/2022" são o mesmo termo;
sem o campo `ano`, o ano sai do nome do arquivo). Daí as três situações:

| Situação | O que significa |
| --- | --- |
| Confere | está no SGC e foi lido nos documentos |
| Documento não lido | está no SGC, mas a pasta não foi varrida (ou o arquivo está fora dela) |
| Fora do SGC | foi lido na pasta e não consta no cadastro — conferir se falta lançar |

Toda exportação em CSV do sistema (Base de Contratos, Base de Termos e
Conferência SGC) passa por `integrations/planilhaCsv.js`: BOM + ";" + CRLF
e, principalmente, a neutralização de fórmula — conteúdo lido de documento
de terceiro nunca pode virar `=HYPERLINK(...)` na planilha de quem abrir.
O texto já lido dos documentos de uma proposta fica em
`integrations/textoDeProposta.js`, usado tanto pela ingestão quanto pelas
telas de leitura.

Exportação em CSV (mesmo formato da Base de Contratos): por espécie ou só
as divergências, para encaminhar a quem mantém o SGC.

## Pendências de leitura

Tela **Pendências de leitura** (grupo "Qualidade de dados"), módulo
`integrations/pendenciasLeitura.js`: as propostas pendentes agrupadas
pelo **motivo** de o término, o início ou o valor não terem sido
calculados. Medido em 22/09/2026, com 31 propostas pendentes: 19 sem
término e 12 sem início — e 13 delas pelo mesmo motivo (o contrato conta
a vigência da Ordem de Início, documento que costuma ficar fora da pasta
de rede).

Cada grupo traz o que resolve o caso, a lista dos contratos e, por
contrato, uma janela com:

- os **trechos dos documentos** que falam do assunto (só do cache de
  texto — nunca dispara OCR), para conferir sem abrir o PDF;
- o **formulário do dado que falta**: a data do marco inicial, a vigência
  em meses ou o valor mensal, conforme o grupo.

O dado informado **não é gravado como data pronta**: ele entra como marco
na mesma regra de vigência (`calcularVigencia(texto, numero, { marcoInformado, mesesInformados })`),
e o término sai de marco + meses + prorrogações. Documento lido sempre
vale mais: se a Ordem de Início estiver na pasta, a data digitada é
ignorada.

O campo preenchido assim fica com procedência **`manual`** ("informado à
mão"), aparece com o selo ✍ na Base de dados e como "à mão" na Fila de
importação, guarda quem informou e quando (`dadosManuais`), entra na
trilha de auditoria e **não é sobrescrito** pelo "Recalcular valores e
vigências".

## Base de Contratos

Tela **Base de dados** (aba Contratos), no grupo "Documentos": os dados que a Ferramenta 1 leu dos arquivos, numa tabela
única pensada para virar base de dados — número, processo administrativo,
empresa, CNPJ, objeto, secretaria, modalidade, vigência e valor mensal.
Módulo: `integrations/baseContratos.js`.

A lupa de cada linha (**Visualizar**) abre tudo o que foi lido e
calculado para o contrato, inclusive o que a tabela não mostra: os 14
campos com a procedência de cada um (lido do documento, informado à mão)
lado a lado com o cadastro atual; a conta do valor mensal e da vigência;
as parcelas do valor no SGC; os aditivos e apostilamentos cadastrados no
SGC; os documentos lidos; e a ficha de cadastro e o mapa de risco, se
houver.

Layout (22/09/2026): as telas ocupam a largura toda da janela, e as
tabelas principais (Contratos, Base, Conferência SGC, Mapa de Risco,
Auditoria) vão até o fim da janela, com rolagem própria e cabeçalho fixo.
Na Base, textos longos ficam em duas linhas (texto inteiro ao passar o
mouse e no Visualizar).

**A regra que define a base: leitura automática não se mistura com dado
conferido.** Uma base que misturasse as duas coisas contaminaria qualquer
relatório construído em cima dela (a IA, quando existia, chegou a inventar
quatro datas e um valor num único contrato). Então:

- **Linha aprovada** mostra o registro **confirmado** por revisão humana —
  que pode ter mantido o dado oficial do SGC nos campos em que a leitura
  estava errada.
- **Linha pendente** mostra a leitura dos documentos, ainda não conferida,
  com a procedência de cada célula (✎ **atualizado na aprovação**; ⚠
  **inferido** só aparece em leitura antiga, da época da IA).
- A coluna **Situação** vem primeiro: é ela que diz se a linha é confiável.

Uma linha por contrato: lido mais de uma vez, vale a leitura mais recente.
Proposta sem número não entra (sem número não há registro identificável).

**Exportação para Excel** — dois botões: "Exportar aprovadas" (padrão, só
dado conferido) e "Exportar todas" (inclui pendentes, identificadas na
coluna Situação e com os campos inferidos nomeados). O CSV sai no formato
que o Excel em português abre direto (BOM, `;`, datas e valores
brasileiros), e **células que começariam com `=`, `+`, `-` ou `@` são
neutralizadas**: o conteúdo vem de documento de terceiro, e
um texto como `=HYPERLINK(...)` viraria fórmula na planilha de quem abrir.
Toda exportação fica registrada na Trilha de auditoria.

**Para a base crescer**, `CONTRATOS_ARQUIVOS_PASTAS` precisa apontar para a
pasta que **contém** as pastas dos contratos, não para a pasta de um
contrato só (hoje, no `.env`, ela aponta só para a do 096/2025). Cada pasta
nova leva alguns minutos na primeira varredura (OCR) — vale rodar
pela varredura automática de madrugada.

### Salvaguardas de LGPD

Contratos têm CPF de gestor, fiscal e preposto. A leitura é toda nesta
máquina — nenhum texto de contrato vai para serviço externo — e:

- **CPF é mascarado** (`integrations/mascaraDados.js`) no texto que vira
  citação do Mapa de risco e da ficha, cobrindo as variações do OCR e o CPF
  colado ao nome na assinatura digital.
- **Toda geração fica registrada na Trilha de auditoria** (quem gerou,
  quando, o resultado resumido), para dar para explicar depois por que o
  sistema chegou naquele risco.

### Limitações conhecidas

- Só funciona para contratos com `arquivoOrigem` (ver acima) — a maioria
  dos contratos hoje sincronizados só via API do SGC ainda não é elegível.
- A régua do eixo Conteúdo (multa/reajuste/garantia/rescisão/renovação) é
  um ponto de partida, não uma lista revisada com jurídico/compliance da
  Prefeitura sobre quais cláusulas realmente importam para Itaverde.
- O item do checklist que depende de interpretação (matriz de riscos,
  multa que só remete a decreto, reajuste sem data-base) fica para
  conferência manual — a regra não dá veredito sem a frase como prova.

## Próximos passos possíveis (não implementados aqui)

- Régua de risco do eixo Conteúdo revisada com jurídico/compliance da
  Prefeitura — quais cláusulas realmente importam para Itaverde, não uma
  lista genérica de "boas práticas contratuais".
- Tornar contratos sincronizados só via API do SGC elegíveis para o mapa de
  risco (hoje só os com `arquivoOrigem` são).
- Notificações por e-mail para etapas de onboarding/offboarding pendentes há
  muito tempo.
- Os pontos de segurança e de migração de banco de dados já descritos nas
  seções acima.
