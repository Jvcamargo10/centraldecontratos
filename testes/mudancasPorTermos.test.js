/* Mudança no contrato vinda de termo novo (07/10/2026): a releitura que
   difere do cadastro vira pendência; o cadastro só muda quando alguém
   confirma. Também: o valor total do contrato (inicial + termos de valor). */
const { test } = require('node:test');
const assert = require('node:assert');
const mudancas = require('../integrations/mudancasPorTermos');
const valorTotal = require('../integrations/valorTotalContrato');

const AGORA = '2026-10-07T12:00:00.000Z';
const contrato = extra => ({ id: 6, numero: '006/2025', empresa: 'ITD', status: 'Ativo', termino: '2026-02-12', valor: 932500, responsavel: 'Daniel Ribeiro Dias', suplente: 'Bruno', ...extra });
const proposta = extra => ({ id: 30, status: 'aprovado', contratoId: 6, aprovadoEm: '2026-09-30T10:00:00Z', procedencia: {}, campos: {}, ...extra });
const vigencia = { termino: '2027-02-13', periodos: [
  { origem: 'contrato', meses: 12, inicio: '2025-02-12', fim: '2026-02-12' },
  { origem: 'termo 016', meses: 12, inicio: '2026-02-13', fim: '2027-02-13', base: 'contada de 13/02/2026 (Termo de Aditamento Nº 016_2026 assinado.pdf)' }
] };

test('prorrogação nova: término relido diferente vira pendência, com o termo e o documento', () => {
  const c = contrato();
  const novas = mudancas.detectar(c, proposta(), { campos: { termino: '2027-02-13' }, calculoVigencia: vigencia }, AGORA);
  assert.strictEqual(novas.length, 1);
  assert.strictEqual(c.termino, '2026-02-12', 'o cadastro não muda sozinho');
  const m = c.mudancasDetectadas[0];
  assert.deepStrictEqual([m.campo, m.de, m.para], ['termino', '2026-02-12', '2027-02-13']);
  assert.match(m.motivo, /termo 016 \(12 meses\)/);
  assert.strictEqual(m.documento, 'Termo de Aditamento Nº 016_2026 assinado.pdf');
});

test('igual ao cadastro, vazio na releitura ou informado à mão: não sugere nada', () => {
  const c = contrato();
  mudancas.detectar(c, proposta({ procedencia: { valor: 'manual' } }), { campos: {
    termino: '2026-02-12', valor: 1000, responsavel: 'DANIEL RIBEIRO DIAS', suplente: null
  } }, AGORA);
  assert.strictEqual(c.mudancasDetectadas, undefined);
});

test('valor: diferença de centavo é arredondamento; acima disso vira pendência', () => {
  const c = contrato();
  mudancas.detectar(c, proposta(), { campos: { valor: 932500.01 } }, AGORA);
  assert.strictEqual(c.mudancasDetectadas, undefined);
  mudancas.detectar(c, proposta(), { campos: { valor: 950000 }, calculoValor: { memoria: '(x) ÷ (y)' } }, AGORA);
  assert.strictEqual(c.mudancasDetectadas[0].campo, 'valor');
});

test('confirmar grava no contrato e o cálculo na proposta; fica no histórico do contrato', () => {
  const c = contrato();
  const p = proposta();
  const db = { contratos: [c], importacoesPendentes: [p] };
  mudancas.detectar(c, p, { campos: { termino: '2027-02-13' }, calculoVigencia: vigencia }, AGORA);
  const r = mudancas.decidir(db, 6, 'termino', 'confirmar', 'Ana', AGORA);
  assert.strictEqual(c.termino, '2027-02-13');
  assert.strictEqual(p.calculoVigencia, vigencia);
  assert.strictEqual(c.mudancasDetectadas, undefined);
  assert.strictEqual(c.mudancasConfirmadas[0].por, 'Ana');
  assert.strictEqual(r.de, '2026-02-12');
});

test('descartar: o cadastro não muda e o mesmo valor não volta a ser sugerido', () => {
  const c = contrato();
  const p = proposta();
  const db = { contratos: [c], importacoesPendentes: [p] };
  mudancas.detectar(c, p, { campos: { responsavel: 'Eduarda Teixeira Lima' } }, AGORA);
  mudancas.decidir(db, 6, 'responsavel', 'descartar', 'Ana', AGORA);
  assert.strictEqual(c.responsavel, 'Daniel Ribeiro Dias');
  assert.strictEqual(mudancas.detectar(c, p, { campos: { responsavel: 'Eduarda Teixeira Lima' } }, AGORA).length, 0);
  assert.strictEqual(c.mudancasDetectadas, undefined);
  // valor diferente do descartado volta a ser sugerido
  assert.strictEqual(mudancas.detectar(c, p, { campos: { responsavel: 'Outra Pessoa' } }, AGORA).length, 1);
});

test('mesma mudança na próxima releitura não conta como nova (nem perde a data)', () => {
  const c = contrato();
  mudancas.detectar(c, proposta(), { campos: { termino: '2027-02-13' } }, AGORA);
  const novas = mudancas.detectar(c, proposta(), { campos: { termino: '2027-02-13' } }, '2026-10-08T09:00:00.000Z');
  assert.strictEqual(novas.length, 0);
  assert.strictEqual(c.mudancasDetectadas[0].detectadoEm, AGORA);
});

test('contrato encerrado não recebe sugestão', () => {
  const c = contrato({ status: 'Encerrado' });
  assert.strictEqual(mudancas.detectar(c, proposta(), { campos: { termino: '2027-02-13' } }, AGORA).length, 0);
});

test('proposta nova na Fila para contrato já cadastrado: lista o que a aprovação muda', () => {
  const c = contrato();
  const db = { contratos: [c], importacoesPendentes: [
    { id: 41, status: 'pendente', contratoExistenteId: 6, criadoEm: '2026-10-07T08:00:00Z', campos: { termino: '2027-02-13', valor: 932500, responsavel: 'Daniel Ribeiro Dias' }, origemRegra: {} }
  ] };
  const l = mudancas.listar(db);
  assert.strictEqual(l.length, 1);
  assert.strictEqual(l[0].naFila, true);
  assert.deepStrictEqual(l[0].mudancas.map(m => m.campo), ['termino']);
});

test('ação inválida e campo sem pendência dão erro claro', () => {
  const c = contrato();
  const db = { contratos: [c], importacoesPendentes: [] };
  assert.throws(() => mudancas.decidir(db, 6, 'termino', 'confirmar', 'Ana', AGORA), /Não há mudança pendente/);
  mudancas.detectar(c, null, { campos: { termino: '2027-02-13' } }, AGORA);
  assert.throws(() => mudancas.decidir(db, 6, 'termino', 'apagar', 'Ana', AGORA), /Ação inválida/);
});

/* ---------- Valor total ---------- */
const calc = { valorInicial: 3600000, mesesIniciais: 24, aditivos: [{ valor: 3600000, meses: 24 }] };

test('valor total = inicial + termos de valor; só quando fecha com o valor mensal', () => {
  const p = proposta({ calculoValor: calc });
  assert.deepStrictEqual(valorTotal.doContrato(null, { id: 6, valor: 150000 }, p), { valor: 7200000, meses: 48 });
  // valor mensal mudado à mão: o total desta conta não é o do contrato
  assert.strictEqual(valorTotal.doContrato(null, { id: 6, valor: 160000 }, p), null);
});

test('valor total: sem valor inicial ou sem meses, fica em branco', () => {
  assert.strictEqual(valorTotal.doCalculo({ valorInicial: null, mesesIniciais: 24, aditivos: [] }), null);
  assert.strictEqual(valorTotal.doCalculo({ valorInicial: 1000, mesesIniciais: 0, aditivos: [] }), null);
  assert.strictEqual(valorTotal.doCalculo(null), null);
});

test('valor total usa a aprovação mais recente do contrato', () => {
  const db = { contratos: [{ id: 6, valor: 150000 }], importacoesPendentes: [
    proposta({ id: 1, aprovadoEm: '2025-01-01T00:00:00Z', calculoValor: { valorInicial: 3600000, mesesIniciais: 24, aditivos: [] } }),
    proposta({ id: 2, aprovadoEm: '2026-01-01T00:00:00Z', calculoValor: calc })
  ] };
  assert.deepStrictEqual(valorTotal.porContrato(db), { 6: { valor: 7200000, meses: 48 } });
});

/* ---------- Termos relidos mantêm o id (links #/aditivo/ID estáveis) ---------- */
test('releitura dos termos mantém id e data da primeira leitura; termo novo ganha id novo', () => {
  const { sincronizarTermosDoContrato } = require('../integrations/ingestaoContratos');
  const nextId = lista => (lista || []).reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;
  const c = { id: 6, numero: '006/2025', empresa: 'ITD' };
  const db = { aditivos: [{ id: 826, contratoId: 6, numero: '016/2026', origem: 'documento', lidoEm: '2026-09-30', documento: 'Termo 016.pdf' }], apostilamentos: [] };
  sincronizarTermosDoContrato(db, nextId, c, { id: 30, termosLidos: [
    { especie: 'Aditivo', numero: '016/2026', tipo: 'Prorrogação', documento: 'Termo 016.pdf' },
    { especie: 'Aditivo', numero: '020/2026', tipo: 'Acréscimo', documento: 'Termo 020.pdf' }
  ] });
  const [a, b] = db.aditivos;
  assert.deepStrictEqual([a.id, a.lidoEm], [826, '2026-09-30']);
  assert.strictEqual(b.id, 827);
  assert.notStrictEqual(b.lidoEm, '2026-09-30');
});
