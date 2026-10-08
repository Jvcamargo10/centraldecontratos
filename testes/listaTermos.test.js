/* Telas Aditivos e Apostilamentos (07/10/2026): a lista vem do cadastro
   (termos aprovados na Fila), com a situação do CONTRATO de cada termo e a
   nova data de término calculada da vigência do contrato. */
const { test } = require('node:test');
const assert = require('node:assert');
const listaTermos = require('../integrations/listaTermos');

function bd(extra) {
  return {
    contratos: [
      { id: 5, numero: '066/2020', empresa: 'TecLoc', status: 'Ativo', valor: 1000, termino: '2027-01-10' },
      { id: 6, numero: '030/2018', empresa: 'Redesegura', status: 'Encerrado', valor: 500, termino: '2023-04-04' }
    ],
    aditivos: [], apostilamentos: [], importacoesPendentes: [], ...extra
  };
}
const aditivo = extra => ({ id: 1, contrato: '066/2020', contratoId: 5, numero: '147/2023', tipo: 'Prorrogação', data: '2023-08-04', valor: 12000, meses: 12, origem: 'documento', documento: 'Termo 147_2023.pdf', propostaId: 9, ...extra });

test('espécie desconhecida devolve null (a rota responde 404)', () => {
  assert.strictEqual(listaTermos.listar(bd(), 'termos'), null);
});

test('situação vem do contrato do termo: em vigência, encerrado ou sem contrato', () => {
  const r = listaTermos.listar(bd({ aditivos: [aditivo(), aditivo({ id: 2, contratoId: 6, contrato: '030/2018' }), aditivo({ id: 3, contratoId: 99, contrato: '001/2000' })] }), 'aditivos');
  const sit = Object.fromEntries(r.itens.map(i => [i.id, i.situacaoContrato]));
  assert.deepStrictEqual(sit, { 1: 'vigente', 2: 'encerrado', 3: 'sem_contrato' });
  assert.strictEqual(r.totais.deContratosVigentes, 1);
  assert.strictEqual(r.totais.contratos, 3);
});

test('nova data de término sai do período da vigência que veio do termo', () => {
  const r = listaTermos.listar(bd({
    aditivos: [aditivo()],
    importacoesPendentes: [{ id: 9, status: 'aprovado', contratoId: 5, calculoVigencia: { periodos: [{ origem: 'termo 147/2023', fim: '2024-08-03' }] } }]
  }), 'aditivos');
  assert.strictEqual(r.itens[0].novoTermino, '2024-08-03');
  assert.strictEqual(r.itens[0].valorMensalContrato, 1000);
});

test('apostilamento de gestão: gestor e suplente contam em "mudam gestor"', () => {
  const r = listaTermos.listar(bd({ apostilamentos: [
    { id: 4, contrato: '066/2020', contratoId: 5, numero: '063/2024', tipo: 'Alteração de gestor/suplente', data: '2024-06-07', gestor: 'Ana', suplente: 'Bruno', origem: 'documento' },
    { id: 5, contrato: '066/2020', contratoId: 5, numero: '072/2024', tipo: 'Outro', data: '2024-07-19', origem: 'documento' }
  ] }), 'apostilamentos');
  assert.strictEqual(r.totais.comGestao, 1);
  assert.strictEqual(r.itens[0].numero, '072/2024', 'mais recente primeiro');
  assert.deepStrictEqual(r.totais.porTipo.map(t => t.nome), ['Alteração de gestor/suplente', 'Outro']);
  assert.strictEqual(r.itens[1].novoTermino, null);
});

test('IOM e portaria ficam vazios (não são lidos dos documentos); sem valor não vira zero', () => {
  const r = listaTermos.listar(bd({ aditivos: [aditivo({ valor: null, meses: null })] }), 'aditivos');
  const i = r.itens[0];
  assert.strictEqual(i.iom, null);
  assert.strictEqual(i.portaria, null);
  assert.strictEqual(i.valor, null);
  assert.strictEqual(i.meses, null);
  assert.strictEqual(r.totais.comValor, 0);
});

test('"(sem número)" gravado na aprovação vira número vazio', () => {
  const r = listaTermos.listar(bd({ aditivos: [aditivo({ numero: '(sem número)' })] }), 'aditivos');
  assert.strictEqual(r.itens[0].numero, null);
});

test('empresa com mais termos conta só contratos em vigência', () => {
  const r = listaTermos.listar(bd({ aditivos: [
    aditivo({ id: 1 }),
    aditivo({ id: 2, contratoId: 6, contrato: '030/2018', empresa: 'Redesegura' }),
    aditivo({ id: 3, contratoId: 6, contrato: '030/2018', empresa: 'Redesegura' })
  ] }), 'aditivos');
  assert.deepStrictEqual(r.totais.empresaMaisTermosVigentes, { nome: 'TecLoc', n: 1 });
});

test('termo lido de proposta pendente não entra na lista, só na contagem', () => {
  const r = listaTermos.listar(bd({ importacoesPendentes: [{ id: 7, status: 'pendente', criadoEm: '2026-09-22T10:00:00Z', campos: { numero: '099/2021', empresa: 'X' },
    termosLidos: [{ especie: 'Aditivo', numero: '010/2022', tipo: 'Prorrogação' }, { especie: 'Apostilamento', numero: '011/2022', tipo: 'Outro' }] }] }), 'aditivos');
  assert.strictEqual(r.itens.length, 0);
  assert.strictEqual(r.totais.pendentesNaFila, 1);
});
