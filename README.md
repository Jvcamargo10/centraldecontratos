# Central de Contratos

Sistema web para a gestão de contratos de uma secretaria municipal. Ele lê os
documentos dos processos numa pasta de rede (contratos, aditivos,
apostilamentos, ordens de início, relatórios mensais, apólices, requisições do
Tribunal de Contas), monta o cadastro por **regras com prova no texto** e
acompanha vencimentos, valores, riscos e pendências. Tudo o que é lido passa
por revisão humana antes de virar dado oficial.

> **Sobre esta versão.** O sistema foi desenvolvido para uso interno numa
> prefeitura. Esta é uma cópia para portfólio: o órgão, a cidade, o sistema de
> contratos de origem, as pessoas, as empresas e os CNPJs foram trocados por
> nomes fictícios ("Prefeitura de Itaverde", "SGC", "Atlas Tecnologia"...), e
> a cópia não traz nenhum dado — o banco começa vazio.

## O problema

A equipe acompanhava dezenas de contratos em planilhas e num sistema de
cadastro manual. Término, valor mensal e gestor de cada contrato mudam a cada
aditivo ou apostilamento, e a informação certa estava nos PDFs dos processos —
muitos escaneados. Erros de digitação passavam despercebidos e os
vencimentos eram descobertos tarde.

## O que o sistema faz

- **Ingestão com revisão humana** — varre a pasta de rede, extrai o texto
  (PDF, DOCX e OCR para escaneados), lê os campos por regra e propõe o
  cadastro numa **fila de revisão**. Cada campo mostra de qual documento veio;
  campo não encontrado fica em branco e vai para **Pendências de leitura**.
- **Regras de negócio conferidas nos documentos**
  - vigência em meses a partir do marco (assinatura ou ordem de início),
    prorrogação a prorrogação;
  - **valor total** = valor da contratação + aditivos e apostilamentos de valor;
    **valor mensal** = valor total ÷ (meses iniciais + prorrogações), com a
    memória de cálculo de cada contrato;
  - gestor e suplente pelo ato de gestão mais recente.
- **Aditivos e apostilamentos** em telas próprias, com os campos do formulário
  do sistema de origem e uma "ficha" pronta para copiar.
- **Mudanças vindas de termos novos** — prorrogação, acréscimo ou troca de
  gestor arquivados depois da aprovação viram pendência para confirmar; o
  cadastro nunca muda sozinho.
- **Alertas de vencimento** com perfis de trâmite (uma prorrogação leva menos
  tempo que uma licitação nova) e resumo diário por e-mail (Microsoft Graph).
- **Mapa de risco** por contrato (conteúdo das cláusulas, prazo, financeiro,
  gestão), com registro de riscos e problemas no modelo de matriz
  probabilidade × impacto.
- **Relatórios mensais** (que mês está sem relatório), **requisições do
  Tribunal de Contas** com prazo de resposta e direcionamento item a item, e
  **gratificação dos gestores** calculada em unidade fiscal, com histórico de
  versões da tabela.
- **Histórico administrativo** de cada contrato (ofícios, despachos,
  solicitações, reuniões) com prazo de resposta e correções versionadas;
  **trilha de auditoria** de tudo o que muda.
- Login local (bcrypt) ou **Microsoft Entra ID** (OpenID Connect com PKCE),
  com papéis administrador, gestor, fiscal e consulta.

## Destaques técnicos

- **Sem framework e sem build:** front-end em JavaScript moderno com módulos
  ES (`import`/`export`), CSS em camadas com tokens de design, roteamento por
  hash com páginas de detalhe, acessível (teclado, ARIA) e responsivo.
- **Back-end Node.js + Express**, persistência em JSON com gravação atômica e
  backup diário; resposta comprimida (gzip) sem pacote extra.
- **Leitura de documentos:** `pdf-parse`/`pdfjs-dist`, `mammoth` (DOCX) e
  `tesseract.js` (OCR em português) num processo separado, com cache por
  arquivo, leitura incremental e prioridade baixa no Windows.
- **Segurança:** CSP e cabeçalhos HTTP, origem conferida nas requisições que
  alteram dados, bloqueio de força bruta no login, cookie de sessão assinado,
  máscara de CPF no texto guardado (LGPD), segredos só no `.env`.
- **Testes:** 405 testes automatizados com `node:test`, sem dependências —
  cada falha que já aconteceu com documentos reais virou um teste.
- A versão de produção usou um modelo de linguagem local para a leitura; ele
  foi retirado depois de medido contra as regras (mais lento e menos preciso
  nos documentos reais) — toda leitura é determinística e explicável.

## Como rodar

Requisitos: [Node.js](https://nodejs.org) 18 ou mais recente.

```bash
npm install
npm start
```

Abra <http://localhost:3001>. Na primeira execução é criada a conta
`admin`, com a senha padrão definida em `db.js` — troque-a em
**Configurações > Contas de acesso**. Para a fila de importação ler documentos,
copie `.env.example` para `.env` e aponte `CONTRATOS_ARQUIVOS_PASTAS` para uma
pasta com processos (uma subpasta "P.A. ..." por processo).

```bash
npm test
```

## Estrutura

```
server.js            rotas da API e páginas
db.js                estrutura e gravação do data.json (com backup)
integrations/        regras de leitura, cálculos, OCR, segurança, e-mail, login
public/              interface (index.html, css/, js/ em módulos ES, img/, fonts/)
testes/              testes automatizados (node --test)
ferramentas/         scripts de manutenção (avaliação das regras, troca de raiz, serviço do Windows)
docs/                documentação técnica completa
```

## Documentação

- [Documentação técnica](docs/DOCUMENTACAO-TECNICA.md) — regras de leitura,
  decisões e medições, módulo a módulo.
- [Guia de uso](GUIA-DE-USO.md) — para a equipe que usa o sistema.
- [Instalação em servidor](SERVIDOR.md) — HTTPS, serviço do Windows, backup.

Fonte Inter sob a licença SIL Open Font License (`public/fonts/`).
