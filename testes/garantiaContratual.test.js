/* ===================================================================
   testes/garantiaContratual.test.js

   Validade da garantia contratual lida do ofício ou da apólice
   (28/09/2026), com os textos dos casos reais: 006/2025 (ofício digitado)
   e 118/2022 (OCR da apólice leu 2028 onde o ofício diz 2025).
=================================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const { lerGarantia } = require('../integrations/garantiaContratual');

const OFICIO = 'Encaminhamos a apólice nº 1007500012345 do seguro garantia, com vigência entre 13/02/2025 até 13/02/2026, referente ao Contrato nº 006/2025, firmado com a Prefeitura.';

test('ofício que encaminha a apólice: início, fim e a frase como prova', () => {
  const g = lerGarantia(OFICIO, '006/2025');
  assert.strictEqual(g.inicio, '2025-02-13');
  assert.strictEqual(g.fim, '2026-02-13');
  assert.strictEqual(g.confianca, 3);
  assert.match(g.citacao, /vigência entre 13\/02\/2025 até 13\/02\/2026/);
});

test('documento de outro contrato não vale', () => {
  assert.strictEqual(lerGarantia(OFICIO, '118/2022'), null);
});

test('ofício vence a apólice lida por OCR com dígito errado (118/2022)', () => {
  const texto = 'Contrato nº 118/2022. Vigência do seguro a partir das 09:00h do dia 03/06/2024 até 23:59h do dia 03/06/2028. '
    + 'Ofício: segue apólice com vigência de 03/06/2024 a 03/06/2025, referente ao Contrato nº 118/2022.';
  const g = lerGarantia(texto, '118/2022');
  assert.strictEqual(g.fim, '2025-06-03', 'a fonte mais confiável ganha, mesmo com data menor');
});

test('apólice sozinha, com a barra comida pelo OCR ("1302/2026")', () => {
  const texto = 'Seguro Garantia — Contrato nº 006/2025. Vigência do seguro a partir das 09:00h do dia 13/02/2025 até 23:59h do dia 1302/2026.';
  const g = lerGarantia(texto, '006/2025');
  assert.strictEqual(g.fim, '2026-02-13');
  assert.strictEqual(g.confianca, 2);
});

test('sem período legível: null', () => {
  assert.strictEqual(lerGarantia('Apólice de seguro garantia referente ao Contrato nº 006/2025.', '006/2025'), null);
  assert.strictEqual(lerGarantia('', '006/2025'), null);
});
