/* Varredura da pasta de rede com o filtro de subpasta
   (CONTRATOS_ARQUIVOS_SUBPASTA): só a pasta "3. Contratos, Aditivos e
   Termos" de cada processo entra, e cada processo vira UM grupo. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const servidor = require('../integrations/servidorArquivos');
const CONFIG = servidor._config;

function criarArvore() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'setec-varredura-'));
  const arquivos = [
    'P.A. 01.275_2025 - ATLAS/1. Edital/edital.pdf',
    'P.A. 01.275_2025 - ATLAS/12. Notas Fiscais/nf 001.pdf',
    'P.A. 01.275_2025 - ATLAS/3. Contratos, Aditivos e Termos/Contrato Nº 096_2025/contrato 096_2025.pdf',
    'P.A. 01.275_2025 - ATLAS/3. Contratos, Aditivos e Termos/1º Aditivo/aditivo.pdf',
    'P.A. 01.275_2025 - ATLAS/3. Contratos, Aditivos e Termos/~$rascunho.docx',
    'P.A. 00.659_2023 - FIBRA SUL/3. Contratos, Aditivos e Termos/contrato.docx',
    'P.A. 00.659_2023 - FIBRA SUL/5. Empenhos/empenho.pdf',
    'Modelo/3. Contratos, Aditivos e Termos/Leia-me.txt'
  ];
  for (const rel of arquivos) {
    const c = path.join(raiz, rel);
    fs.mkdirSync(path.dirname(c), { recursive: true });
    fs.writeFileSync(c, 'x');
  }
  return raiz;
}

async function comConfig(pastas, subpasta, fn) {
  const antes = { pastas: CONFIG.pastas, sub: CONFIG.subpastaContratos };
  CONFIG.pastas = pastas;
  CONFIG.subpastaContratos = subpasta;
  try { return await fn(); } finally { CONFIG.pastas = antes.pastas; CONFIG.subpastaContratos = antes.sub; }
}

const DB_VAZIO = { integracoes: { arquivosContratos: { arquivosVistos: {} } } };
const nomes = grupo => grupo.arquivos.map(a => path.basename(a.caminho)).sort();

test('com a subpasta configurada, só os documentos da pasta 3 entram, um grupo por processo', async () => {
  const raiz = criarArvore();
  const r = await comConfig([raiz], 'contratos, aditivos e termos', () => servidor.listarArquivosNovosOuAlterados(DB_VAZIO));
  assert.strictEqual(r.totalCandidatos, 3);
  assert.strictEqual(r.totalGrupos, 2);
  const Atlas = r.novosOuAlterados.find(g => g.pasta.includes('ATLAS'));
  // contrato e aditivo, em subpastas diferentes, caem no MESMO grupo
  assert.strictEqual(path.basename(Atlas.pasta), '3. Contratos, Aditivos e Termos');
  assert.deepStrictEqual(nomes(Atlas), ['aditivo.pdf', 'contrato 096_2025.pdf']);
  assert.ok(r.novosOuAlterados.every(g => !/Edital|Notas|Empenhos/.test(g.pasta)));
});

test('sem a subpasta configurada, o comportamento antigo se mantém (tudo, agrupado pela pasta do arquivo)', async () => {
  const raiz = criarArvore();
  const r = await comConfig([raiz], '', () => servidor.listarArquivosNovosOuAlterados(DB_VAZIO));
  assert.strictEqual(r.totalCandidatos, 6);
  assert.strictEqual(r.totalGrupos, 6);
});

test('a pasta configurada pode ser uma subpasta de dentro da pasta 3', async () => {
  const raiz = criarArvore();
  const dentro = path.join(raiz, 'P.A. 01.275_2025 - ATLAS', '3. Contratos, Aditivos e Termos', 'Contrato Nº 096_2025');
  const r = await comConfig([dentro], 'contratos, aditivos e termos', () => servidor.listarArquivosNovosOuAlterados(DB_VAZIO));
  assert.strictEqual(r.totalCandidatos, 1);
  assert.strictEqual(path.basename(r.novosOuAlterados[0].pasta), '3. Contratos, Aditivos e Termos');
});

test('pastaDoGrupo leva do arquivo do contrato à pasta 3 inteira (usada pelo mapa de risco)', async () => {
  const raiz = criarArvore();
  const arquivo = path.join(raiz, 'P.A. 01.275_2025 - ATLAS', '3. Contratos, Aditivos e Termos', 'Contrato Nº 096_2025', 'contrato 096_2025.pdf');
  const pasta = await comConfig([raiz], 'contratos, aditivos e termos', () => servidor.pastaDoGrupo(arquivo));
  assert.strictEqual(pasta, path.join(raiz, 'P.A. 01.275_2025 - ATLAS', '3. Contratos, Aditivos e Termos'));
});

/* Seleção manual pelo Explorer: caminho colado e arquivos escolhidos no
   computador (que chegam sem caminho — só nome, tamanho e data). */
test('caminho colado do Explorer: aspas, maiúsculas diferentes, arquivo ou pasta', async () => {
  const raiz = criarArvore();
  await comConfig([raiz], 'contratos, aditivos e termos', () => {
    const pasta = path.join(raiz, 'P.A. 01.275_2025 - ATLAS', '3. Contratos, Aditivos e Termos');
    const r = servidor.resolverCaminhoColado(`"${pasta.toUpperCase()}"`);
    assert.strictEqual(r.tipo, 'pasta');
    assert.deepStrictEqual(r.pilha.map(p => p.nome), [raiz, 'P.A. 01.275_2025 - ATLAS', '3. Contratos, Aditivos e Termos']);
    assert.strictEqual(r.pilha[2].caminho, pasta, 'o caminho volta com a grafia real das pastas');
    const arq = servidor.resolverCaminhoColado(path.join(pasta, '1º Aditivo', 'aditivo.pdf'));
    assert.strictEqual(arq.tipo, 'arquivo');
    assert.strictEqual(arq.arquivo.caminho, path.join(pasta, '1º Aditivo', 'aditivo.pdf'));
    assert.throws(() => servidor.resolverCaminhoColado(os.tmpdir()), /fora das pastas configuradas/);
    assert.throws(() => servidor.resolverCaminhoColado(path.join(pasta, 'nao-existe')), /Não encontrei/);
    assert.throws(() => servidor.resolverCaminhoColado('relativo/pasta'), /não é um caminho completo/);
  });
});

test('arquivo escolhido no computador é achado na pasta de rede por nome + tamanho + data', async () => {
  const raiz = criarArvore();
  // A mesma cópia em duas subpastas do processo (caso real do edital).
  const copia1 = path.join(raiz, 'P.A. 01.275_2025 - ATLAS', '1. Edital', 'edital.pdf');
  const copia2 = path.join(raiz, 'P.A. 01.275_2025 - ATLAS', '21. Cronograma', 'edital.pdf');
  fs.mkdirSync(path.dirname(copia2), { recursive: true });
  fs.copyFileSync(copia1, copia2);
  const contrato = path.join(raiz, 'P.A. 01.275_2025 - ATLAS', '3. Contratos, Aditivos e Termos', 'Contrato Nº 096_2025', 'contrato 096_2025.pdf');
  const info = c => { const st = fs.statSync(c); return { nome: path.basename(c), tamanho: st.size, modificadoEm: st.mtimeMs }; };
  const antes = CONFIG.pastas;
  CONFIG.pastas = [raiz];
  try {
    const r = await servidor.localizarArquivos([
      info(contrato),
      info(copia1),
      { ...info(copia1), caminhoRelativo: '21. Cronograma/edital.pdf' },
      { nome: 'contrato 096_2025.pdf', tamanho: 999999 },   // mesmo nome, outro arquivo
      { nome: 'planilha.xlsx', tamanho: 10 }
    ]);
    const s = r.resultado.map(x => x.situacao);
    assert.deepStrictEqual(s, ['encontrado', 'ambiguo', 'encontrado', 'nao_encontrado', 'nao_suportado']);
    assert.strictEqual(r.resultado[0].caminho, contrato);
    assert.strictEqual(r.resultado[2].caminho, copia2, 'o caminho relativo da pasta escolhida desempata');
  } finally { CONFIG.pastas = antes; }
});

/* "Escolher pasta" com a pasta de UM processo (24/09/2026): só entram os
   documentos do contrato, e nenhum arquivo de outra pasta da rede. */
test('pasta do processo inteira: só a subpasta de contratos entra, pelo caminho dentro dela', async () => {
  const raiz = criarArvore();
  // O mesmo nome de arquivo em OUTRO processo (caso real: certidões, "contrato.pdf").
  const outro = path.join(raiz, 'P.A. 09.999_2024 - OUTRA', '3. Contratos, Aditivos e Termos', 'contrato 096_2025.pdf');
  fs.mkdirSync(path.dirname(outro), { recursive: true });
  fs.writeFileSync(outro, 'x');
  const proc = 'P.A. 01.275_2025 - ATLAS';
  const item = rel => { const c = path.join(raiz, ...rel.split('/')); const st = fs.statSync(c); return { nome: path.basename(c), tamanho: st.size, modificadoEm: st.mtimeMs, caminhoRelativo: rel }; };
  const escolhidos = [
    item(`${proc}/1. Edital/edital.pdf`),
    item(`${proc}/12. Notas Fiscais/nf 001.pdf`),
    item(`${proc}/3. Contratos, Aditivos e Termos/Contrato Nº 096_2025/contrato 096_2025.pdf`),
    item(`${proc}/3. Contratos, Aditivos e Termos/1º Aditivo/aditivo.pdf`)
  ];
  const r = await comConfig([raiz], 'contratos, aditivos e termos', () => servidor.localizarArquivos(escolhidos));
  assert.strictEqual(r.foraDaSubpasta, 2, 'edital e nota fiscal ficam de fora');
  assert.deepStrictEqual(r.resultado.map(x => x.situacao), ['encontrado', 'encontrado']);
  assert.ok(r.resultado.every(x => x.caminho.includes(proc)), 'nada de outro processo, mesmo com o mesmo nome e tamanho');
});

test('escolher direto a subpasta de contratos, ou arquivos soltos, não filtra nada', async () => {
  const raiz = criarArvore();
  const c = path.join(raiz, 'P.A. 01.275_2025 - ATLAS', '3. Contratos, Aditivos e Termos', '1º Aditivo', 'aditivo.pdf');
  const st = fs.statSync(c);
  const r = await comConfig([raiz], 'contratos, aditivos e termos', () => servidor.localizarArquivos([
    { nome: 'aditivo.pdf', tamanho: st.size, modificadoEm: st.mtimeMs, caminhoRelativo: '3. Contratos, Aditivos e Termos/1º Aditivo/aditivo.pdf' },
    { nome: 'aditivo.pdf', tamanho: st.size, modificadoEm: st.mtimeMs }
  ]));
  assert.strictEqual(r.foraDaSubpasta, 0);
  assert.deepStrictEqual(r.resultado.map(x => x.situacao), ['encontrado', 'encontrado']);
});

test('acento escrito de outro jeito pelo navegador ainda casa com o nome no disco', async () => {
  const raiz = criarArvore();
  const c = path.join(raiz, 'P.A. 01.275_2025 - ATLAS', '3. Contratos, Aditivos e Termos', 'Alteração CNPJ.pdf');
  fs.writeFileSync(c, 'x');
  const r = await comConfig([raiz], 'contratos, aditivos e termos', () => servidor.localizarArquivos([
    { nome: 'Alteração CNPJ.pdf'.normalize('NFD'), tamanho: 1, caminhoRelativo: '3. Contratos, Aditivos e Termos/Alteração CNPJ.pdf'.normalize('NFD') }
  ]));
  assert.strictEqual(r.resultado[0].situacao, 'encontrado');
});

/* Raiz "9. Gestão de Contratos" (25/09/2026): processos em "3. ... em
   Vigência", "4. ... Encerrados" e "5. ... Outras Secretarias", com a
   subpasta de contratos em nomes diferentes. Casos reais da pasta. */
function criarArvoreGestao() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'setec-gestao-'));
  const arquivos = [
    '1. Controle de Contratos/Controle processos - SETEC.pdf',
    '3. Processos Administrativos - Contratos em Vigência/P.A. 01.275_2025 - ATLAS/1. Edital e Termo de Referência/edital.pdf',
    '3. Processos Administrativos - Contratos em Vigência/P.A. 01.275_2025 - ATLAS/3. Contratos, Aditivos e Termos/Contrato Nº 096_2025/contrato.pdf',
    '3. Processos Administrativos - Contratos em Vigência/Arquivos para Excluir/Contrato Nº 061_2024/velho.pdf',
    '4. Processos Administrativos - Contratos Encerrados/P.A. 00.403_2018 - Microsoft/3. Contrato, Aditivos e Termos/contrato.pdf',
    '4. Processos Administrativos - Contratos Encerrados/P.A. 10.183_2017 - SIGMA/2. Contrato e Aditivos/contrato.pdf',
    '4. Processos Administrativos - Contratos Encerrados/P.A. 13.389_2021 - Parque/Contrato nº 53_2022 - Vertex/contrato.pdf',
    '4. Processos Administrativos - Contratos Encerrados/P.A. 13.389_2021 - Parque/Contrato n° 54_2022 - Sentinela TI/contrato.pdf',
    '4. Processos Administrativos - Contratos Encerrados/P.A. 10.355_2021 - FIA/21. Entregas Previstas em Contrato/entrega.pdf',
    '4. Processos Administrativos - Contratos Encerrados/P.A. 10.355_2021 - FIA/3. Contratos, Aditivos e Termos/contrato.docx',
    '5. Processos de Outras Secretarias/P.A. 09.074_2021 - Faz/2. Contratos e Termos/contrato.pdf',
    '5. Processos de Outras Secretarias/P.A. 08.024_2018 - 156 - ITD/Contrato, aditivos e OI/contrato.pdf',
    '5. Processos de Outras Secretarias/P.A. 17.678_2021 - Predial/16. Link Gestão de Contratos/atalho.pdf',
    '5. Processos de Outras Secretarias/P.A. 17.678_2021 - Predial/3. Contratos, Aditivos e Termos/contrato.pdf',
    '5. Processos de Outras Secretarias/P.A. 05.784_2023 - PABX/TR.pdf',
    'Pasta demo/Livro.pdf'
  ];
  for (const rel of arquivos) {
    const c = path.join(raiz, rel);
    fs.mkdirSync(path.dirname(c), { recursive: true });
    fs.writeFileSync(c, 'x');
  }
  fs.mkdirSync(path.join(raiz, '5. Processos de Outras Secretarias/P.A. 01.427_2026 - Inspeção/3. Contratos, Aditivos e Termos'), { recursive: true });
  return raiz;
}

test('raiz "9. Gestão de Contratos": vigência, encerrados e outras secretarias, com todos os nomes de subpasta de contratos', async () => {
  const raiz = criarArvoreGestao();
  const r = await comConfig([raiz], 'contratos, aditivos e termos', () => servidor.listarArquivosNovosOuAlterados(DB_VAZIO));
  const grupos = r.novosOuAlterados.map(g => path.relative(raiz, g.pasta).split(path.sep).slice(1).join(' / ')).sort();
  assert.deepStrictEqual(grupos, [
    'P.A. 00.403_2018 - Microsoft / 3. Contrato, Aditivos e Termos',
    'P.A. 01.275_2025 - ATLAS / 3. Contratos, Aditivos e Termos',
    'P.A. 08.024_2018 - 156 - ITD / Contrato, aditivos e OI',
    'P.A. 09.074_2021 - Faz / 2. Contratos e Termos',
    'P.A. 10.183_2017 - SIGMA / 2. Contrato e Aditivos',
    'P.A. 10.355_2021 - FIA / 3. Contratos, Aditivos e Termos',
    'P.A. 13.389_2021 - Parque / Contrato n° 54_2022 - Sentinela TI',
    'P.A. 13.389_2021 - Parque / Contrato nº 53_2022 - Vertex',
    'P.A. 17.678_2021 - Predial / 3. Contratos, Aditivos e Termos'
  ], 'um grupo por contrato; "Link Gestão de Contratos", "Entregas Previstas em Contrato", edital, "Arquivos para Excluir" e pastas soltas ficam de fora');
  assert.ok(r.avisos.some(a => /sem subpasta de contrato.*PABX/.test(a)), 'processo sem subpasta de contrato é avisado');
  assert.ok(r.avisos.some(a => /Subpasta de contrato vazia.*01\.427_2026/.test(a)), 'subpasta de contrato vazia é avisada');
});

test('categoria pela pasta: encerrado, outra secretaria, vigência', () => {
  assert.strictEqual(servidor.categoriaDoCaminho('F:\9. Gestão de Contratos\4. Processos Administrativos - Contratos Encerrados\P.A. x\c.pdf'), 'encerrado');
  assert.strictEqual(servidor.categoriaDoCaminho('F:\9. Gestão de Contratos\5. Processos de Outras Secretarias\P.A. x\c.pdf'), 'outra_secretaria');
  assert.strictEqual(servidor.categoriaDoCaminho('F:\9. Gestão de Contratos\3. Processos Administrativos - Contratos em Vigência\P.A. x\c.pdf'), 'vigencia');
});
