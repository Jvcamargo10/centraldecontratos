/* ===================================================================
   testes/baseContratos.test.js

   A Base de Contratos é pensada para virar base de dados. O que precisa
   ser garantido aqui é a regra que a define: leitura automática não se
   mistura com dado conferido, e a exportação não carrega nada que
   possa virar fórmula na planilha de quem abrir.
=================================================================== */

const { test } = require('node:test');
const assert = require('node:assert');
const { montarBase, gerarCsv } = require('../integrations/baseContratos');
// A neutralização de fórmula e o escape de célula vivem em planilhaCsv.js
// (usados também pela Base de Termos) — testados em planilhaCsv.test.js.
const _paraTeste = { neutralizarFormula: require('../integrations/planilhaCsv').neutralizarFormula, celulaCsv: require('../integrations/planilhaCsv').celula };

/* Cenário baseado no estado real de 21/09/2026: o 096/2025 foi aprovado
   de forma conservadora (só a razão social mudou; vigência e valor do
   SGC foram mantidos), e existe uma proposta pendente de outro contrato. */
function cenario() {
  return {
    contratos: [{
      id: 24, numero: '096/2025', empresa: 'AURORA TECNOLOGIA LTDA',
      cnpjEmpresa: '11253441000111', inicio: '2025-12-05', termino: '2027-01-22',
      valor: 2075.07, objeto: 'Objeto completo do SGC', origemExterna: true
    }],
    importacoesPendentes: [
      { id: 13, status: 'aprovado', contratoId: 24, criadoEm: '2026-09-18T17:00:00Z',
        aprovadoPor: 'Revisão assiseteca', aprovadoEm: '2026-09-18T18:00:00Z',
        campos: { numero: '096/2025', inicio: '2025-03-01', valor: 26100000 },
        camposSobrescritos: [{ campo: 'empresa', de: 'Atlas', para: 'AURORA TECNOLOGIA LTDA' }],
        arquivosFonte: [{ nome: 'Contrato Comercial Nº 096_2025.pdf' }] },
      { id: 14, status: 'pendente', criadoEm: '2026-09-19T10:00:00Z',
        campos: { numero: '110/2024', empresa: 'ACME LTDA', inicio: '2024-02-01', valor: 5000 },
        procedencia: { numero: 'busca_local', empresa: 'ia', inicio: 'inferido', valor: 'ia' },
        arquivosFonte: [{ nome: 'Contrato 110.pdf' }] },
      // Aprovada cujo contrato foi removido (o caso do contrato 46) — fica de fora.
      { id: 9, status: 'aprovado', contratoId: 46, criadoEm: '2026-09-17T12:00:00Z', campos: {} },
      // Rejeitada e sem texto nunca entram.
      { id: 12, status: 'rejeitado', criadoEm: '2026-09-18T16:00:00Z', campos: { numero: '303' } },
      { id: 4, status: 'sem_texto', criadoEm: '2026-09-16T12:00:00Z', campos: {} }
    ]
  };
}

test('aprovada mostra o registro CONFIRMADO, não a leitura da IA', () => {
  /* A IA leu início 01/03/2025 e valor R$ 26.100.000 — ambos errados; na
     aprovação o revisor manteve os valores do SGC. A base tem que refletir
     o que foi confirmado, não o palpite original. */
  const base = montarBase(cenario());
  const l = base.linhas.find(x => x.valores.numero === '096/2025');
  assert.equal(l.situacao, 'aprovada');
  assert.equal(l.valores.inicio, '2025-12-05');
  assert.strictEqual(l.valores.valor, 2075.07);
  assert.equal(l.procedencia.empresa, 'atualizado_na_aprovacao', 'o campo que a aprovação trocou fica marcado');
  assert.equal(l.procedencia.inicio, 'confirmado');
});

test('pendente mostra a leitura da IA com procedência campo a campo', () => {
  const base = montarBase(cenario());
  const l = base.linhas.find(x => x.valores.numero === '110/2024');
  assert.equal(l.situacao, 'pendente');
  assert.equal(l.valores.empresa, 'ACME LTDA');
  assert.deepEqual(l.camposInferidos, ['inicio']);
  assert.equal(l.procedencia.numero, 'busca_local');
});

test('só entram propostas aprovadas/pendentes com número e contrato existente', () => {
  const base = montarBase(cenario());
  assert.deepEqual(base.linhas.map(l => l.valores.numero).sort(), ['096/2025', '110/2024']);
  assert.deepEqual(base.totais, { contratos: 2, aprovadas: 1, pendentes: 1, camposInferidos: 1 });
});

test('o mesmo contrato lido duas vezes aparece uma vez, com a leitura mais recente', () => {
  const db = cenario();
  db.importacoesPendentes.push({
    id: 15, status: 'pendente', criadoEm: '2026-09-20T09:00:00Z',
    campos: { numero: '110/2024', empresa: 'ACME COMÉRCIO LTDA' }
  });
  const linhas = montarBase(db).linhas.filter(l => l.valores.numero === '110/2024');
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].valores.empresa, 'ACME COMÉRCIO LTDA');
});

test('proposta antiga, sem procedência gravada, não inventa procedência', () => {
  /* Propostas anteriores a 21/09/2026 não têm o campo `procedencia`. A
     base reconstrói só o que foi gravado (correções da busca local) e
     marca o resto como leitura da IA — nunca como "confirmado". */
  const db = { contratos: [], importacoesPendentes: [{
    id: 1, status: 'pendente', criadoEm: '2026-09-18T00:00:00Z',
    campos: { numero: '096/2025', empresa: 'ATLAS' },
    camposCorrigidosPorRegex: [{ campo: 'numero', daIa: '96', daRegex: '096/2025' }]
  }] };
  const l = montarBase(db).linhas[0];
  assert.equal(l.procedencia.numero, 'busca_local_corrigiu_ia');
  assert.equal(l.procedencia.empresa, 'ia');
});

test('CSV: por padrão exporta só as aprovadas', () => {
  const csv = gerarCsv(montarBase(cenario()));
  assert.ok(csv.includes('096/2025'));
  assert.ok(!csv.includes('110/2024'), 'leitura não conferida não pode entrar na exportação padrão');
});

test('CSV: exportar todas inclui pendentes, com a situação e os campos inferidos', () => {
  const csv = gerarCsv(montarBase(cenario()), 'todas');
  const linha = csv.split('\r\n').find(l => l.startsWith('110/2024'));
  assert.ok(linha.includes('Pendente de revisão'));
  assert.ok(linha.includes('Início da vigência'), 'o campo inferido precisa estar nomeado na linha');
});

test('CSV: formato do Excel em português (BOM, ";", data e valor brasileiros)', () => {
  const csv = gerarCsv(montarBase(cenario()));
  assert.ok(csv.startsWith('﻿'), 'sem BOM o Excel quebra a acentuação');
  const linha = csv.split('\r\n').find(l => l.startsWith('096/2025'));
  assert.ok(linha.includes('05/12/2025'));
  assert.ok(linha.includes('2075,07'));
});

test('CSV: texto do documento não vira fórmula no Excel', () => {
  /* O conteúdo vem de documento de terceiro lido por IA. Um objeto como
     `=HYPERLINK(...)` viraria link clicável na planilha de quem abrir. */
  assert.equal(_paraTeste.neutralizarFormula('=HYPERLINK("http://x")'), '\'=HYPERLINK("http://x")');
  assert.equal(_paraTeste.neutralizarFormula('-1+2'), "'-1+2");
  assert.equal(_paraTeste.neutralizarFormula('Objeto normal'), 'Objeto normal');
  const db = cenario();
  db.contratos[0].objeto = '=CMD|" /C calc"!A0';
  const csv = gerarCsv(montarBase(db));
  assert.ok(!/;=CMD/.test(csv), 'a célula não pode começar com "="');
});

test('CSV: ponto e vírgula e aspas no texto não quebram as colunas', () => {
  assert.equal(_paraTeste.celulaCsv('Fornecimento; instalação "turnkey"'), '"Fornecimento; instalação ""turnkey"""');
});
