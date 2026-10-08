/* ===================================================================
   testes/ufm.test.js

   UFM e gratificação dos gestores (06/10/2026): o mesmo resultado da
   planilha "cálculo de pag. GFE" (abas GERAL e Calculo), as bordas das
   faixas como na fórmula SE(...) da planilha, e a tabela com histórico —
   cada alteração é uma versão nova, com data de vigência, e nada se apaga.
=================================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const U = require('../integrations/ufm');

const novoDb = contratos => { const db = { contratos }; U.garantirTabela(db); return db; };

test('tabela inicial = aba Calculo da planilha (UFM 5,00; 150,00 / 390,00 / 750,00 / 1.500,00)', () => {
  const db = novoDb([]);
  const v = U.versaoEm(db, '2026-10-06');
  assert.strictEqual(v.valorUfm, 5);
  assert.deepStrictEqual(v.faixas.map(f => f.valor), [150, 390, 750, 1500]);
  assert.strictEqual(U.garantirTabela(db), false, 'não recria a tabela');
});

test('mesmos números da aba GERAL da planilha', () => {
  // [valor mensal, UFM da planilha, gratificação da planilha]
  const casos = [
    [73833.91333333333, 14766.782666666666, 390],
    [581141.1233333334, 116228.22466666668, 1500],
    [219101.85185185185, 43820.37037037037, 750],
    [33300, 6660, 390],
    [0.01, 0, 150]
  ];
  const v = U.versaoEm(novoDb([]), '2026-10-06');
  for (const [mensal, ufm, gfe] of casos) {
    const r = U.calcular({ valor: mensal }, v);
    if (ufm) assert.ok(Math.abs(r.valorEmUfm - ufm) < 0.1, `${mensal}: ${r.valorEmUfm} x ${ufm}`);
    assert.strictEqual(r.gratificacao, gfe, `valor mensal ${mensal}`);
  }
  assert.ok(U.calcular({ valor: null }, v).semValor);
});

test('bordas das faixas como a fórmula da planilha (< 4.001, < 20.001, < 80.001)', () => {
  const v = U.versaoEm(novoDb([]), '2026-10-06');
  const faixaDeUfm = u => U.faixaDe(v, u) + 1;
  assert.deepStrictEqual([4000, 4000.99, 4001, 20000.9, 20001, 80000.9, 80001, 1e9].map(faixaDeUfm), [1, 1, 2, 2, 3, 3, 4, 4]);
});

test('avisa que 390,00 não é 12,5% da base das outras faixas (3.000,00)', () => {
  const avisos = U.montar(novoDb([]), '2026-10-06').avisos;
  assert.strictEqual(avisos.length, 1);
  assert.match(avisos[0], /Faixa 2.*seria R\$ 375,00/);
});

test('alteração vira versão nova: vale a partir da data, a anterior continua no histórico', () => {
  const db = novoDb([{ id: 1, numero: '001/2026', empresa: 'A', responsavel: 'Ana', status: 'Ativo', valor: 105000 }]);
  assert.strictEqual(U.montar(db, '2027-01-15').linhas[0].gratificacao, 750); // 105.000 / 5 = 21.000 UFM → faixa 3
  assert.match(U.registrarVersao(db, { valorUfm: '5,5', vigenteDesde: '2027-01-01' }, 'Bia').erro, /ato/);
  assert.match(U.registrarVersao(db, { valorUfm: '0', vigenteDesde: '2027-01-01', fundamento: 'x' }, 'Bia').erro, /valor da UFM/);
  const r = U.registrarVersao(db, { valorUfm: '5,5', vigenteDesde: '2027-01-01', fundamento: 'Decreto 1/2027' }, 'Bia', '2026-12-20T10:00:00Z');
  assert.strictEqual(r.versao.valorUfm, 5.5);
  assert.deepStrictEqual(r.versao.faixas.map(f => f.valor), [150, 390, 750, 1500], 'sem faixas no pedido, copia as da tabela');
  // antes da data, vale a antiga (agendada); depois, a nova
  const antes = U.montar(db, '2026-12-31'), depois = U.montar(db, '2027-01-15');
  assert.strictEqual(antes.versao.valorUfm, 5);
  assert.strictEqual(antes.versoes.find(x => x.id === r.versao.id).situacao, 'agendada');
  assert.strictEqual(depois.versao.valorUfm, 5.5);
  assert.strictEqual(depois.linhas[0].gratificacao, 390, '105.000 / 5,5 = 19.091 UFM → faixa 2');
  assert.strictEqual(depois.versoes.length, 2);
  assert.strictEqual(depois.versoes.find(x => x.id === 1).situacao, 'anterior');
});

test('mesma data registrada de novo: vale a última (corrige sem apagar)', () => {
  const db = novoDb([]);
  U.registrarVersao(db, { valorUfm: '4,70', vigenteDesde: '2027-01-01', fundamento: 'Decreto 1/2027' }, 'Bia');
  U.registrarVersao(db, { valorUfm: '4,71', vigenteDesde: '2027-01-01', fundamento: 'Decreto 1/2027 (valor corrigido)' }, 'Bia');
  assert.strictEqual(U.versaoEm(db, '2027-02-01').valorUfm, 4.71);
  assert.strictEqual(db.ufm.versoes.length, 3);
});

test('faixas alteradas: aceita 12,5 / 12.5 / 1.500,00 e confere a ordem dos limites', () => {
  const db = novoDb([]);
  const faixas = [{ ate: '4000', percentual: '5', valor: '170,00', limiteContratos: '10' }, { ate: '20000', percentual: '12.5', valor: '440', limiteContratos: 8 },
    { ate: '80.000', percentual: '25', valor: '850,5' }, { percentual: '50', valor: '1.700,30' }];
  const r = U.registrarVersao(db, { valorUfm: '4.8', vigenteDesde: '2027-01-01', fundamento: 'Decreto 2/2027', faixas }, 'Bia');
  assert.deepStrictEqual(r.versao.faixas.map(f => [f.ate, f.percentual, f.valor]), [[4000, 5, 170], [20000, 12.5, 440], [80000, 25, 850.5], [null, 50, 1700.3]]);
  const ruim = U.registrarVersao(db, { valorUfm: '4.8', vigenteDesde: '2027-01-01', fundamento: 'x', faixas: [{ ate: 5000, valor: 1 }, { ate: 4000, valor: 2 }, { valor: 3 }] }, 'Bia');
  assert.match(ruim.erro, /maior que o da faixa anterior/);
});

test('por gestor: total mensal e aviso acima do limite de contratos da faixa', () => {
  const contratos = [1, 2, 3].map(i => ({ id: i, numero: `00${i}/2026`, responsavel: 'Ana', status: 'Ativo', valor: 600000 })) // faixa 4 (limite 2)
    .concat([{ id: 9, numero: '009/2020', responsavel: 'Ana', status: 'Encerrado', valor: 600000 }]);
  const t = U.montar(novoDb(contratos), '2026-10-06');
  assert.deepStrictEqual(t.porGestor, [{ gestor: 'Ana', contratos: 3, porFaixa: [0, 0, 0, 3], total: 4500, acimaDoLimite: [4] }]);
  const csv = U.gerarCsv(t);
  assert.match(csv, /001\/2026;;Ana;;Ativo;600000,00;120000,0;4 \(acima de 80\.000\);1500,00/);
});

test('por gestor: o mesmo nome com e sem acento vira uma linha, com a grafia acentuada', () => {
  const t = U.montar(novoDb([
    { id: 1, numero: '001/2026', responsavel: 'Daniel Ribeiro Dias', status: 'Ativo', valor: 30000 },
    { id: 2, numero: '002/2026', responsavel: 'Daniel Ribeiro Dias', status: 'Ativo', valor: 30000 }
  ]), '2026-10-06');
  assert.deepStrictEqual(t.porGestor.map(g => [g.gestor, g.contratos]), [['Daniel Ribeiro Dias', 2]]);
});
