/* Conferência SGC × documentos: diagnóstico da média mensal e do CNPJ,
   com os casos reais que motivaram cada regra. */
const test = require('node:test');
const assert = require('node:assert');
const { cnpjValido, diagnosticarMedia, conferirCnpj, normalizarPa } = require('../integrations/conferenciaSgc')._paraTeste;

test('termo cadastrado no SGC mas fora da média: SGC desatualizado (caso 010/2024)', () => {
  const calc = {
    valorInicial: 2330237.52, mesesIniciais: 36, mediaMensal: 65297.89,
    aditivos: [{ tipo: 'aditivo', termo: '268', natureza: 'acréscimo', valor: 20486.46, meses: 0 }],
    memoria: '(2.330.237,52 + 20.486,46) ÷ (36) = 65.297,89'
  };
  const termosSgc = [{ especie: 'aditivo', numero: '268/2025', numeroSimples: 268, tipo: 'Aditamento', data: '2025-12-15' }];
  const r = diagnosticarMedia(64728.82, calc, termosSgc);
  assert.ok(r.explicado);
  assert.match(r.diagnosticos[0], /não inclui o termo 268.*cadastrado no SGC \(268\/2025, "Aditamento", 15\/12\/2025\)/);
});

test('erro de casa decimal no SGC (caso 006/2025)', () => {
  const calc = { valorInicial: 11190000, mesesIniciais: 12, mediaMensal: 932500, aditivos: [], memoria: '' };
  const r = diagnosticarMedia(93250, calc, []);
  assert.ok(r.explicado);
  assert.match(r.diagnosticos[0], /dividido por 10 — provável erro de digitação/);
});

test('divergência sem explicação fica para conferência manual (caso 096/2025)', () => {
  const calc = { valorInicial: 26100000, mesesIniciais: 12, mediaMensal: 2175000, aditivos: [], memoria: '(26.100.000,00) ÷ (12) = 2.175.000,00' };
  const r = diagnosticarMedia(2075.07, calc, []);
  assert.strictEqual(r.explicado, false);
  assert.match(r.diagnosticos[0], /Sem explicação automática/);
});

test('CNPJ: dígitos, verificadores, matriz/filial e alteração subjetiva', () => {
  assert.ok(cnpjValido('11.253.441/0001-11'));
  assert.ok(!cnpjValido('12.345.678/0001-00'));
  assert.strictEqual(conferirCnpj('11222333000 ', null, []).situacao, 'invalido');           // 010/2024: 11 dígitos
  assert.strictEqual(conferirCnpj('11254552000142', '11.254.552/0004-95', []).situacao, 'filial'); // 006/2025
  const incorporacao = [{ numero: '169/2024', tipo: 'Alteração de CNPJ' }];
  assert.strictEqual(conferirCnpj('11253441000111', '11.234.554/0001-70', incorporacao).situacao, 'alterado');
  assert.strictEqual(conferirCnpj('11253441000111', '11.234.554/0001-70', []).situacao, 'diverge');
});

test('P.A. da pasta e do SGC no mesmo formato', () => {
  assert.strictEqual(normalizarPa('P.A. 01.275_2025 - Expansão de processamento - ATLAS'), '01.275/2025');
  assert.strictEqual(normalizarPa('1.275/2025'), '01.275/2025');
});

test('parcelas do SGC: média que contradiz o próprio SGC (096/2025) e divisão por 120 (006/2025)', () => {
  const { diagnosticarParcelasSgc } = require('../integrations/conferenciaSgc')._paraTeste;
  const d096 = diagnosticarParcelasSgc({ valorContrato: 26100000, valorMediaMensal: 2075.07, somenteInicial: true, aditivosDeValor: [], vigenciaMeses: 12 },
    { valorInicial: 26100000, mesesIniciais: 12, mesesTotal: 12, valorTotal: 26100000, aditivos: [] });
  assert.match(d096[0], /não corresponde às parcelas do próprio SGC.*a média seria R\$ 2\.175\.000,00/);
  const d006 = diagnosticarParcelasSgc({ valorContrato: 11190000, valorMediaMensal: 93250, somenteInicial: true, aditivosDeValor: [], vigenciaMeses: 11 },
    { valorInicial: 11190000, mesesIniciais: 12, mesesTotal: 24, valorTotal: 22380000, aditivos: [{ natureza: 'prorrogação', valor: 11190000, meses: 12 }] });
  assert.match(d006[0], /por 120 meses.*provavelmente 12 digitado como 120/);
});

test('parcelas do SGC: termos dos documentos que o SGC não tem (086/2021)', () => {
  const { diagnosticarParcelasSgc } = require('../integrations/conferenciaSgc')._paraTeste;
  const d = diagnosticarParcelasSgc({ valorContrato: 4818813.84, valorMediaMensal: 114733.66, somenteInicial: false, aditivosDeValor: [1409102.64], vigenciaMeses: 12 },
    { valorInicial: 3240000, mesesIniciais: 30, mesesTotal: 60, valorTotal: 6932410.56, aditivos: [
      { termo: '027', natureza: 'reajuste', valor: 169653.96, meses: 0 },
      { termo: '029', natureza: 'prorrogação', valor: 1409102.64, meses: 12 },
      { termo: '040', natureza: 'prorrogação', valor: 704551.32, meses: 6 },
      { termo: '194', natureza: 'prorrogação', valor: 1409102.64, meses: 12 }] });
  assert.ok(d.some(x => /por 42 meses; pelos documentos são 60/.test(x)));
  assert.ok(d.some(x => /040 \(prorrogação.*194 \(prorrogação/.test(x)));
  assert.ok(d.some(x => /reajuste de R\$ 169\.653,96 \(termo 027\)/.test(x)));
});

test('planilha de correções: só o que precisa corrigir, no formato do Excel', () => {
  const { gerarCsvCorrecoes } = require('../integrations/conferenciaSgc');
  const csv = gerarCsvCorrecoes({ linhas: [
    { numero: '096/2025', empresa: 'ATLAS', pa: '01.275/2025', situacao: 'sgc_desatualizado_ou_erro', valorSgc: 2075.07, valorDocumentos: 2175000, memoria: '(26.100.000,00) ÷ (12) = 2.175.000,00', diagnosticos: ['Média errada.'], cnpj: { situacao: 'confere' } },
    { numero: '072/2020', empresa: 'SIGMA', pa: '26.533/2018', situacao: 'confere', valorSgc: 65935.2, valorDocumentos: 65935.2, diagnosticos: [], cnpj: { situacao: 'confere' } },
    { numero: '010/2024', empresa: 'Fibra Sul', pa: '00.659/2023', situacao: 'confere', valorSgc: 1, valorDocumentos: 1, diagnosticos: ['CNPJ curto.'], cnpj: { situacao: 'invalido', mensagem: 'CNPJ curto.' } }
  ] });
  assert.ok(csv.startsWith('﻿Contrato;'));
  const linhas = csv.trim().split('\r\n');
  assert.strictEqual(linhas.length, 3); // cabeçalho + 096 + 010 (072 confere)
  assert.match(linhas[1], /^096\/2025;ATLAS;01\.275\/2025;SGC desatualizado \/ erro;2\.075,07;2\.175\.000,00;/);
  assert.match(linhas[2], /;CNPJ curto\.$/);
});
