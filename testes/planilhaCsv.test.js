/* Formato das planilhas exportadas — e a regra de segurança que vale
   para TODAS elas: conteúdo lido de documento de terceiro não pode virar
   fórmula na planilha de quem abrir (injeção de fórmula em CSV). Ficava
   duplicado em baseContratos.js e baseTermos.js até 23/09/2026. */
const { test } = require('node:test');
const assert = require('node:assert');
const csv = require('../integrations/planilhaCsv');

test('célula que começaria com fórmula é neutralizada', () => {
  assert.strictEqual(csv.neutralizarFormula('=HYPERLINK("http://x")'), '\'=HYPERLINK("http://x")');
  assert.strictEqual(csv.neutralizarFormula('-1+2'), "'-1+2");
  assert.strictEqual(csv.neutralizarFormula('+55 11 0000'), "'+55 11 0000");
  assert.strictEqual(csv.neutralizarFormula('@usuario'), "'@usuario");
  assert.strictEqual(csv.neutralizarFormula('Objeto normal'), 'Objeto normal');
});

test('ponto e vírgula, aspas e quebra de linha não quebram as colunas', () => {
  assert.strictEqual(csv.celula('Fornecimento; instalação "turnkey"'), '"Fornecimento; instalação ""turnkey"""');
  assert.strictEqual(csv.celula('primeira\r\nsegunda'), 'primeira segunda');
  assert.strictEqual(csv.celula(null), '');
  assert.strictEqual(csv.celula(0), '0', 'zero é valor, não vazio');
});

test('data e valor saem no formato que o Excel em português entende', () => {
  assert.strictEqual(csv.formatarValor({ tipo: 'data' }, '2025-12-05'), '05/12/2025');
  assert.strictEqual(csv.formatarValor({ tipo: 'data' }, 'sem data'), 'sem data');
  assert.strictEqual(csv.formatarValor({ tipo: 'valor' }, 2075.069), '2075,07');
  assert.strictEqual(csv.formatarValor({ tipo: 'valor' }, 'x'), 'x');
  assert.strictEqual(csv.formatarValor({}, 'texto'), 'texto');
});

test('planilha sai com BOM, separador ";" e CRLF', () => {
  const saida = csv.montar(['A', 'B'], [['1', '2']]);
  assert.ok(saida.startsWith('﻿'), 'sem BOM o Excel quebra a acentuação');
  assert.strictEqual(saida.slice(1), 'A;B\r\n1;2\r\n');
});
