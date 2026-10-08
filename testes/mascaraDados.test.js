/* ===================================================================
   testes/mascaraDados.test.js

   Máscara de CPF com as variações reais do OCR e da assinatura digital
   (24/09/2026). Os números abaixo são inventados.
=================================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const { mascararCpf, MARCA } = require('../integrations/mascaraDados');

test('formato perfeito, como antes', () => {
  assert.strictEqual(mascararCpf('inscrito no CPF 123.456.789-01, ocupante'), `inscrito no CPF ${MARCA}, ocupante`);
});

test('variações de pontuação do OCR', () => {
  for (const v of ['123,456.789-01', '123.456,789-01', '123.456 789-01', '123 .456.789-01', '123.456.789-\n01', '123.456.789.01', '123456789-01', '12345678901']) {
    assert.strictEqual(mascararCpf(`x ${v} y`), `x ${MARCA} y`, v);
  }
});

test('CPF colado ao nome na assinatura digital', () => {
  assert.strictEqual(mascararCpf('Assinado de forma digital por FULANO DE TAL:12345678901 Dados: 2025'), `Assinado de forma digital por FULANO DE TAL:${MARCA} Dados: 2025`);
});

test('depois de "CPF", mesmo com ruído do OCR', () => {
  assert.strictEqual(mascararCpf('CPF: 213.891 .698-71 À'), `CPF: ${MARCA} À`);
  assert.strictEqual(mascararCpf('inscrito no CPF/MF sob o nº 123.456.789-01.'), `inscrito no CPF/MF sob o nº ${MARCA}.`);
});

test('valor em reais com a mesma forma NÃO é mascarado', () => {
  assert.strictEqual(mascararCpf('valor global de R$ 139.000.000,00 (cento e trinta'), 'valor global de R$ 139.000.000,00 (cento e trinta');
});

test('CNPJ, NIRE, datas e números de processo não são mascarados', () => {
  const texto = 'CNPJ 11.256.774/0001-02, NIRE nº 35300012345, Processo Administrativo nº 01.275/2025, em 05/12/2025, R$ 1.964.340,00';
  assert.strictEqual(mascararCpf(texto), texto);
});

test('texto já mascarado continua igual (pode rodar de novo)', () => {
  const t = mascararCpf('CPF 123.456.789-01');
  assert.strictEqual(mascararCpf(t), t);
});

test('a marca "[CPF removido]" não é rótulo: data e IP do carimbo ficam intactos', () => {
  const t = 'Assinado por FULANO DE TAL:12345678901 Dados: 2025.09.12 14:30:15 -03\'00\'. CPF informado: 123.456.789-01, IP: 200.18.45.10.';
  const uma = mascararCpf(t);
  assert.match(uma, /Dados: 2025\.09\.12 14:30:15/);
  assert.match(uma, /IP: 200\.18\.45\.10/);
  assert.strictEqual(mascararCpf(uma), uma, 'segunda passada não muda nada');
});
