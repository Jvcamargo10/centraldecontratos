/* Mapeamento do registro do SGC: as parcelas do valor (valor total,
   aditivos de valor, vigência), no formato confirmado na API real em
   21/09/2026, vão para `sgcValores` — é delas que a Conferência SGC tira
   a explicação das divergências. */
const test = require('node:test');
const assert = require('node:assert');
const { mapearContratoExterno } = require('../integrations/contratosApi')._paraDiagnostico;

test('parcelas do valor do SGC são guardadas junto com a média', () => {
  const m = mapearContratoExterno({
    numero_contrato: '086/2021',
    valorContrato: [
      { valor_contrato: 3240000, valor_media_mensal: 108000, status: false, status_inicial: true },
      { valor_contrato: 4818813.84, valor_media_mensal: 114733.66, status: true, status_inicial: false }
    ],
    aditivoValorContrato: [{ valor_do_aditivo: 1409102.64 }],
    vigenciaContrato: [{ vigencia_em_meses: 12, status: true, aditivo_id: 'x' }]
  });
  assert.strictEqual(m.valor, 114733.66);
  assert.deepStrictEqual(m.sgcValores, {
    valorContrato: 4818813.84, valorMediaMensal: 114733.66, somenteInicial: false,
    aditivosDeValor: [1409102.64], vigenciaMeses: 12, vigenciaDeAditivo: true
  });
});

test('contrato sem valor cadastrado no SGC não ganha parcelas', () => {
  assert.strictEqual(mapearContratoExterno({ numero_contrato: '001/2026' }).sgcValores, undefined);
});
