/* Base de termos, lida dos documentos da pasta (desde 23/09/2026, quando
   a integração com o SGC foi desligada). A regra protegida aqui é a mesma
   da Base de Contratos: termo no cadastro (aprovado) não se mistura com
   termo só lido (pendente), e o mesmo termo não aparece duas vezes. */
const { test } = require('node:test');
const assert = require('node:assert');
const baseTermos = require('../integrations/baseTermos');

function bd(extra) {
  return { aditivos: [], apostilamentos: [], importacoesPendentes: [], ...extra };
}

const termoLido = (extra) => ({
  especie: 'Aditivo', termo: '147', ano: 2023, numero: '147/2023', data: '2023-08-04',
  tipo: 'Prorrogação', natureza: 'prorrogação', valor: 17781900, meses: 12,
  gestor: null, suplente: null, objeto: 'Fica prorrogado...', documento: 'Termo 147_2023.pdf', ...extra
});

function pendente(numero, termosLidos, extra) {
  return { id: 7, status: 'pendente', criadoEm: '2026-09-22T10:00:00Z', campos: { numero, empresa: 'TecLoc' }, termosLidos, ...extra };
}

test('termo lido de proposta pendente aparece como "pendente de revisão"', () => {
  const base = baseTermos.montarBase(bd({ importacoesPendentes: [pendente('066/2020', [termoLido()])] }));
  assert.strictEqual(base.linhas.length, 1);
  const l = base.linhas[0];
  assert.strictEqual(l.situacao, 'pendente');
  assert.strictEqual(l.fonte, 'Documento');
  assert.strictEqual(l.valores.contrato, '066/2020');
  assert.strictEqual(l.valores.tipo, 'Prorrogação');
  assert.strictEqual(l.valores.meses, 12);
  assert.strictEqual(base.totais.pendentes, 1);
});

test('termo no cadastro aparece como aprovado', () => {
  const base = baseTermos.montarBase(bd({
    aditivos: [{ id: 1, contrato: '066/2020', contratoId: 5, numero: '147/2023', tipo: 'Prorrogação', data: '2023-08-04', valor: 17781900, meses: 12, origem: 'documento', documento: 'Termo 147_2023.pdf' }]
  }));
  assert.strictEqual(base.linhas[0].situacao, 'aprovado');
  assert.strictEqual(base.linhas[0].fonte, 'Documento');
  assert.strictEqual(base.totais.aprovados, 1);
});

test('contrato já com termos no cadastro não repete a leitura pendente', () => {
  /* Aprovado o contrato, os termos lidos viram cadastro. Se sobrar uma
     proposta pendente do mesmo número (lida de novo), o termo não pode
     aparecer duas vezes. */
  const base = baseTermos.montarBase(bd({
    aditivos: [{ id: 1, contrato: '066/2020', numero: '147/2023', tipo: 'Prorrogação', origem: 'documento' }],
    importacoesPendentes: [pendente('066/2020', [termoLido()])]
  }));
  assert.strictEqual(base.linhas.length, 1);
  assert.strictEqual(base.linhas[0].situacao, 'aprovado');
});

test('duas propostas do mesmo contrato: vale a mais recente', () => {
  const base = baseTermos.montarBase(bd({
    importacoesPendentes: [
      pendente('066/2020', [termoLido({ numero: '999/2020' })], { id: 1, criadoEm: '2026-09-01T00:00:00Z' }),
      pendente('066/2020', [termoLido()], { id: 2, criadoEm: '2026-09-20T00:00:00Z' })
    ]
  }));
  assert.deepStrictEqual(base.linhas.map(l => l.valores.numero), ['147/2023']);
});

test('apostilamento de gestão mostra quem passou a constar', () => {
  const base = baseTermos.montarBase(bd({
    importacoesPendentes: [pendente('066/2020', [
      termoLido({ especie: 'Apostilamento', numero: '005/2025', tipo: 'Alteração de gestor/suplente', valor: null, meses: null, gestor: 'Vanessa Ferreira Costa' })
    ])]
  }));
  assert.strictEqual(base.linhas[0].valores.gestor, 'Vanessa Ferreira Costa');
  assert.strictEqual(base.totais.comGestao, 1);
  assert.strictEqual(base.totais.apostilamentos, 1);
});

test('proposta lida antes da leitura de termos é contada, para pedir o recálculo', () => {
  const base = baseTermos.montarBase(bd({ importacoesPendentes: [pendente('066/2020', undefined)] }));
  assert.strictEqual(base.linhas.length, 0);
  assert.strictEqual(base.totais.propostasSemLeituraDeTermos, 1);
});

test('registro que ainda veio do SGC aparece com a fonte "SGC" até a remoção', () => {
  const base = baseTermos.montarBase(bd({ apostilamentos: [{ id: 41, contrato: '066/2020', numero: '046/2023', tipo: 'Alteração do Gestor', origemExterna: true }] }));
  assert.strictEqual(base.linhas[0].fonte, 'SGC');
  assert.strictEqual(base.totais.doSgc, 1);
});

test('CSV: filtra por espécie e traz situação, fonte e documento', () => {
  const base = baseTermos.montarBase(bd({
    importacoesPendentes: [pendente('066/2020', [
      termoLido(),
      termoLido({ especie: 'Apostilamento', numero: '005/2025', gestor: 'Ana Paula Souza' })
    ])]
  }));
  const linhas = baseTermos.gerarCsv(base, 'apostilamentos').trim().split('\r\n');
  assert.strictEqual(linhas.length, 2, 'cabeçalho + 1 apostilamento');
  assert.ok(linhas[0].includes('Passou a constar como gestor'));
  assert.ok(linhas[0].includes('Fonte'));
  assert.ok(linhas[1].includes('Ana Paula Souza'));
});

test('texto do termo que começa com "=" não vira fórmula na planilha', () => {
  const base = baseTermos.montarBase(bd({ importacoesPendentes: [pendente('A', [termoLido({ objeto: '=HYPERLINK("http://x")' })])] }));
  const csv = baseTermos.gerarCsv(base, 'todas');
  assert.ok(!/;=HYPERLINK/.test(csv));
});
