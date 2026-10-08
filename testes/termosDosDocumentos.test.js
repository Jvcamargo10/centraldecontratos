/* Aditivos e apostilamentos lidos dos documentos da pasta (desde
   23/09/2026, fonte única com a integração do SGC desligada) e a
   gravação deles no cadastro quando o contrato é aprovado. */
const { test } = require('node:test');
const assert = require('node:assert');
const { extrairTermos, _paraTeste } = require('../integrations/termosDosDocumentos');
const { sincronizarTermosDoContrato } = require('../integrations/ingestaoContratos');
const { dataDoTermo, tipoDoTermo } = _paraTeste;

const doc = (nome, texto) => `=== Arquivo: ${nome} ===\n${texto}`;

const PASTA_066 = [
  doc('Contrato 066_2020.pdf', 'Contrato nº 066/2020. O prazo de vigência deste Contrato é de 36 (trinta e seis) meses, contados da assinatura. O valor global é de R$ 36.000.000,00. Itaverde, 07 de agosto de 2020'),
  doc('Termo Aditamento - 147_2023.pdf', 'Fica prorrogada a vigência do Contrato nº 066/2020, por mais 12 (doze) meses, à contar de 07 de agosto de 2023 até 06 de agosto de 2024. Itaverde, 04 de agosto de 2023'),
  doc('Apostilamento Nº 005_2025.pdf', 'ASSUNTO: Alteração de gestor. Fica apostilado o Contrato nº 066/2020, para que conste o novo gestor, Senhor VANESSA FERREIRA COSTA, inscrito no CPF/MF sob o nº 1, ocupante do Cargo de Diretor. Continuam em vigor as demais cláusulas. Itaverde, 22 de janeiro de 2025'),
  doc('Apostilamento Nº 002_2025 - outro contrato.pdf', 'Fica apostilado o Contrato nº 045/2022, para que conste como Gestor, o Senhor FULANO DE TAL SOUZA, inscrito no CPF/MF sob o nº 1.')
].join('\n\n');

test('lê aditivos e apostilamentos da pasta, com número, data e tipo', () => {
  const termos = extrairTermos(PASTA_066, '066/2020');
  const n = t => `${t.especie} ${t.numero}`;
  assert.deepStrictEqual(termos.map(n), ['Aditivo 147/2023', 'Apostilamento 005/2025']);
  const [aditivo, apost] = termos;
  assert.strictEqual(aditivo.data, '2023-08-04');
  assert.strictEqual(aditivo.tipo, 'Prorrogação');
  assert.strictEqual(apost.tipo, 'Alteração de gestor/suplente');
  assert.strictEqual(apost.gestor, 'Vanessa Ferreira Costa');
  assert.strictEqual(apost.data, '2025-01-22');
  assert.match(apost.objeto, /^Fica apostilado/);
  assert.ok(!/Continuam em vigor/.test(apost.objeto), 'o trecho para antes das cláusulas finais');
});

test('termo de outro contrato guardado na mesma pasta não entra', () => {
  const termos = extrairTermos(PASTA_066, '066/2020');
  assert.ok(!termos.some(t => t.numero === '002/2025'));
});

test('data do termo: o fecho de assinatura, não uma data citada no meio', () => {
  assert.strictEqual(dataDoTermo('Considerando a Portaria nº 1938/2025, de 14 de janeiro de 2025 ... Itaverde, 22 de janeiro de 2025'), '2025-01-22');
  assert.strictEqual(dataDoTermo('sem fecho, citando 14 de janeiro de 2025 no meio'), null);
});

test('tipo pelo assunto quando o cálculo do valor não classifica', () => {
  assert.strictEqual(tipoDoTermo('Fica cedida a posição contratual... cessão da posição contratual da empresa', null, null), 'Cessão da posição contratual');
  assert.strictEqual(tipoDoTermo('alteração da razão social da contratada', null, null), 'Alteração subjetiva da contratada');
  assert.strictEqual(tipoDoTermo('texto qualquer', 'acréscimo', null), 'Acréscimo');
  assert.strictEqual(tipoDoTermo('nada reconhecível', null, null), 'Outro');
});

test('aprovar grava os termos lidos no cadastro, e reaprovar não duplica', () => {
  const db = { aditivos: [{ id: 1, contrato: '066/2020', contratoId: 5, numero: '999/2020', origem: 'cadastro manual' }], apostilamentos: [] };
  const nextId = l => (l || []).reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;
  const contrato = { id: 5, numero: '066/2020', empresa: 'TecLoc' };
  const proposta = { id: 9, termosLidos: extrairTermos(PASTA_066, '066/2020') };
  const r1 = sincronizarTermosDoContrato(db, nextId, contrato, proposta);
  assert.deepStrictEqual(r1, { aditivos: 1, apostilamentos: 1 });
  sincronizarTermosDoContrato(db, nextId, contrato, proposta);
  assert.strictEqual(db.aditivos.filter(a => a.origem === 'documento').length, 1, 'rodar de novo substitui, não duplica');
  assert.ok(db.aditivos.some(a => a.origem === 'cadastro manual'), 'o que foi cadastrado à mão fica');
  const apost = db.apostilamentos[0];
  assert.strictEqual(apost.gestor, 'Vanessa Ferreira Costa');
  assert.strictEqual(apost.contratoId, 5);
  assert.strictEqual(apost.propostaId, 9);
});
