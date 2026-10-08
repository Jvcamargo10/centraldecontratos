/* Média mensal pela regra do SGC, com os termos aditivos da pasta 3.
   Os trechos imitam os documentos reais (com os defeitos de OCR deles). */
const test = require('node:test');
const assert = require('node:assert');
const vc = require('../integrations/valorContratual');
const { classificarDocumento, numeroDoTermo, valoresEmReais, lerTermo, paragrafosDoExtrato } = vc._paraTeste;

const doc = (nome, texto) => `=== Arquivo: ${nome} ===\n${texto}`;
const grupo = (...docs) => docs.join('\n\n');

const CONTRATO_072 = doc('1. Contrato n° 072.2020 - Cofre de Senha - SIGMA.pdf',
  'CLÁUSULA TERCEIRA - DA VIGÊNCIA DO CONTRATO 3.1. O prazo de vigência deste Contrato é de 24 (vinte e quatro)\nmeses, contados da assinatura. ' +
  'CLÁUSULA QUINTA - DO VALOR 5.1. 0 valor total deste contrato é de R$ 2.780.000,00 (dois milhões e setecentos e oitenta mil reais). ' +
  '6.1. A CONTRATADA apresenta garantia no valor de R$ 139.000,00 (cento e trinta e nove mil reais).');
const ADITIVO_156 = doc('4. Aditamento nº 156.2022 do Contrato nº 072.2020 - Cofre de Senha - SIGMA.pdf',
  'Ficaprorrogada a vigência do Contrato nº 072/2020, por mais 24 (vinte e quatro) meses. O valor do período, no percentual de 19,54%, é de R$784.074,48 (setecentos...), para 24 (vinte e quatro) meses. ' +
  'Deve a CONTRATADA apresentar nova garantia contratual no valor de R$ 39.203,72.');
const ADITIVO_197 = doc('Termo de Aditamento Nº 197_2024.pdf',
  'OBJETO: Fics pronogada a vigincia do Contrato nº 072/2020, por 12 (dare) meses. CLÁUSULA SEGUNDA - DO VALOR 2.1. Owlortotuldo presente Termoé de R$ R$ 392.037,24 (trezentos...).');
// Termo de OUTRO contrato arquivado na pasta (caso real).
const ADITIVO_PASTA_ERRADA = doc('Termo de Aditamento Nº 091_2025.pdf',
  'Fica prorrogada a vigência do Contrato nº 118/2022, por mais 18 (dezoito) meses. Valor total de R$ 1.378.080,00.');

test('072/2020: contrato + duas prorrogações = média do SGC ao centavo', () => {
  const r = vc.calcularMediaMensal(grupo(CONTRATO_072, ADITIVO_156, ADITIVO_197, ADITIVO_PASTA_ERRADA), '072/2020');
  assert.strictEqual(r.valorInicial, 2780000);
  assert.strictEqual(r.mesesIniciais, 24);
  assert.strictEqual(r.mediaMensal, 65935.2);
  assert.strictEqual(r.memoria, '(2.780.000,00 + 784.074,48 + 392.037,24) ÷ (24 + 24 + 12) = 65.935,20');
  assert.ok(r.avisos.some(a => a.includes('091_2025') && a.includes('não cita o contrato')));
});

test('acréscimo de valor entra sem meses; alteração de CNPJ não entra', () => {
  const contrato = doc('Contrato Nº 045_2022.pdf', '2.1. 0 presente contrato terá a vigência de 30 (trinta) meses. 5.1. 0 valor global deste Contrato é de R$ 9.000.000,00 (nove milhöes).');
  const acrescimo = doc('Aditivo de Contrato Nº 215_2022.pdf',
    'Fica aditado o Contrato nº 045/2022. CLÁUSULA SEGUNDA - DO VALOR 2.1. O valor deste Aditamento é de R$ 2.157.913,60 (dois milhões...) perfazendo o valor total do contrato de R$ 11.157.913,60.');
  const prorrogacao = doc('Termo de Aditamento Nº 238_2024.pdf',
    'Fica prorrogada a vigência do Contrato nº 045/2022, por mais 18 (dezoito) meses. 2.1. O valor deste Aditamento é de R$ 6.996.235,20 (seis milhões...).');
  const cnpj = doc('Termo de Aditamento 169_2024 - Alteração CNPJ.pdf',
    'O presente termo Aditivo tem por objeto a alteração subjetiva do Contrato 045/2022. Deve a CONTRATADA apresentar nova garantia contratual, conforme parágrafo 1º, correspondente a 5% do valor total do Termo, qual seja R$ 116.511,87.');
  const r = vc.calcularMediaMensal(grupo(contrato, acrescimo, prorrogacao, cnpj), '045/2022');
  assert.strictEqual(r.mediaMensal, 378211.43);
  assert.deepStrictEqual(r.aditivos.map(a => [a.termo, a.natureza, a.valor, a.meses]),
    [['215', 'acréscimo', 2157913.6, 0], ['238', 'prorrogação', 6996235.2, 18]]);
});

test('prorrogação sem valor legível fica fora, com aviso (não derruba a média)', () => {
  const contrato = doc('Contrato nº 141_2022.pdf', 'O valor total deste contrato é de R$ 1.729.940,40. A vigência será de 36 (trinta e seis) meses.');
  const semValor = doc('Termo de Aditamento Nº 098_2025.pdf', 'Fica prorrogada a vigência do Contrato nº 141/2022, por mais 12 (doze) meses.');
  const r = vc.calcularMediaMensal(grupo(contrato, semValor), '141/2022');
  assert.strictEqual(r.mediaMensal, 48053.9);
  assert.ok(r.avisos.some(a => a.includes('098_2025') && a.includes('valor do novo período')));
});

test('o termo sem cláusula de valor legível é completado pelo parágrafo do extrato', () => {
  const contrato = doc('Contrato nº 038.2023.pdf', 'O valor total deste contrato é de R$ 15.800.000,00. O prazo de vigência do contrato é de 24 (vinte e quatro) meses.');
  const termo = doc('Aditamento Nº 071_2025.pdf', 'Fica prorrogada a vigência do Contrato nº 038/2023, por 24 (vinte e quatro) meses. CLÁUSULA TERCEIRA - DA GARANTIA Deve a CONTRATADA prestar garantia no valor de R$ 752.400,00.');
  const extrato = doc('Extrato do Aditamento Nº 071_2025.pdf',
    'Termo de Aditamento nº 071/2025 ao Contrato nº 038/2023; Assunto: Fica prorrogada a vigência do Contrato nº 038/2023, por 24 (vinte e quatro) meses; Valor total de R$ 15.048.000,00 (quinze milhões...). Processo Administrativo nº 21.654/2021; Termo de Aditamento nº 099/2025 ao Contrato nº 777/2024; Valor total de R$ 1,00.');
  const r = vc.calcularMediaMensal(grupo(contrato, termo, extrato), '038/2023');
  assert.strictEqual(r.mediaMensal, 642666.67);
  assert.strictEqual(r.aditivos[0].fonte, 'termo + extrato');
});

test('no extrato, o registro seguinte (de outro contrato) não contamina este', () => {
  const pagina = 'Processo Administrativo nº 14.862/2020; Termo de Aditamento nº 100/2025 ao Contrato nº 086/2021; Assunto: Fica aditado o Contrato nº 086/2021, para incluir os itens D e E à cláusula 14.1. ' +
    'Processo Administrativo nº 24.086/2021; Termo de Aditamento nº 111/2025 ao Contrato nº 118/2022; Assunto: Fica prorrogada a vigência do Contrato nº 118/2022, por mais 18 (dezoito) meses; Valor total de R$ 1.378.080,00.';
  const re = /(?<!\d)0*86\s*[\/._]\s*(?:2021|21)(?!\d)/;
  paragrafosDoExtrato(pagina, re, '100').forEach(p => assert.ok(!p.includes('118/2022'), p));
  assert.strictEqual(lerTermo(paragrafosDoExtrato(pagina, re, '100')[0], re), null);
});

test('valores e prazos com defeitos de OCR', () => {
  assert.deepStrictEqual(valoresEmReais('R$ 80.725,302,00 e R$ 25.879949,76 e R$ 2:296,800,00 e R$ 3.600.000 (três milhões)').map(v => v.valor),
    [80725302, 25879949.76, 2296800, 3600000]);
  assert.strictEqual(vc.acharVigenciaMeses('O presente contrato terá a vigência de 05 (cinco) anos, contados do recebimento'), 60);
  assert.strictEqual(vc.acharVigenciaMeses('A vigência poderá ser prorrogada por até 60 (sessenta) meses. A vigência será de 12 (doze) meses.'), 12);
});

test('nomes de arquivo: tipo, extrato e número do termo', () => {
  assert.deepStrictEqual(classificarDocumento('IOM 2939 - Termo de aditamento nº 268_2025.pdf'), { tipo: 'aditivo', extrato: true });
  assert.deepStrictEqual(classificarDocumento('Extrat termo aditivo 230_2022.pdf'), { tipo: 'aditivo', extrato: true });
  assert.deepStrictEqual(classificarDocumento('Contrato Nº 045_2022.pdf'), { tipo: 'contrato', extrato: false });
  assert.strictEqual(numeroDoTermo('TERMO ADITAMENTO 040-2025-PA-14862-2020-VOX TELECOM.pdf'), '040');
  assert.strictEqual(numeroDoTermo('Termo Aditamento - 147_2023 - - Copia.pdf'), '147');
  assert.strictEqual(numeroDoTermo('Extrato Apostilamento Nº 027.pdf'), '027');
});

test('texto sem cabeçalhos de arquivo continua funcionando (documento único)', () => {
  const r = vc.calcularMediaMensal('O valor total deste contrato para 24 (vinte e quatro) meses é de R$ 12.990.250,00');
  assert.strictEqual(r.mediaMensal, 541260.42);
  assert.deepStrictEqual(r.aditivos, []);
});

test('reajuste por apostilamento, com retificação (caso 086/2021)', () => {
  const contrato = doc('Contrato 086.2021.pdf', 'O valor total deste contrato é de R$ 3.240.000,00. A vigência será de 30 (trinta) meses.');
  const reajuste = doc('apostilamento nº 027.2023 - MIRANTE TECNOLOGIA LTDA.pdf',
    'Fica apostilado o Contrato n° 086/2021, para que seja reajustado em 8,727060%, correspondendo ao valor mensal contratual de R$ 117.428,40 (cento e dezessete mil...). Deve a CONTRATADA complementar a garantia contratual, atingindo o valor de R$ 176.142,60.');
  const retificacao = doc('apostilamento nº 034.2023 - MIRANTE TECNOLOGIA LTDA.pdf',
    'Ficaretificado o Apostilamento nº 027/2023 o Contrato nº 086/2021, para que conste o valor mensal contratual de R$ 117.425,22 (cento e dezessete mil...).');
  const prorrogacao = doc('Aditivo Nº 029_2024.pdf', 'Fica prorrogada a vigência do Contrato nº 086/2021, por mais 12 (doze) meses. O valor deste Aditamento é de R$ 1.409.102,64.');
  const r = vc.calcularMediaMensal(grupo(contrato, reajuste, retificacao, prorrogacao), '086/2021');
  const ap = r.aditivos.find(a => a.termo === '027');
  assert.strictEqual(ap.natureza, 'reajuste');
  assert.strictEqual(ap.valor, 169653.96); // (117.425,22 − 108.000) × 18
  assert.strictEqual(ap.retificadoPor, '034');
  assert.ok(!r.aditivos.some(a => a.natureza === 'retificação'));
  assert.strictEqual(r.mediaMensal, 114732.3); // (3.240.000 + 169.653,96 + 1.409.102,64) ÷ 42
});

test('prorrogação que só escreve o valor mensal vale mensal × meses (caso 066/2020)', () => {
  const porMontante = lerTermo('Fica prorrogada a vigência do Contrato nº 066/2020, por mais 12 (doze) meses. 2.1. O valor mensal do contrato, sem reajuste, permanece em R$ 1.481.825,00, perfazendo, pelo período de 12 (doze) meses, o montante de R$ 17.781.900,00.', null);
  assert.strictEqual(porMontante.valor, 17781900);
  const soMensal = lerTermo('Fica prorrogada a vigência do Contrato nº 066/2020, por mais 12 (doze) meses; Valor mensal: R$ 1.481.825,00.', null);
  assert.strictEqual(soMensal.valor, 17781900);
  assert.strictEqual(soMensal.mensal, 1481825);
});

test('retificação de valor de termo aditivo substitui o valor original', () => {
  const contrato = doc('1. Contrato n° 66_2020.pdf', 'O valor total deste contrato é de R$ 39.286.800,00. O prazo de vigência deste Contrato é de 36 (trinta e seis) meses.');
  const acrescimo = doc('Termo de Aditamento 137.2022 - .pdf', 'Fica aditado o Contrato n° 066/2020, para acréscimo de 11,8%. 1.2. O percentual supramencionado corresponde ao valor de R$ 566.317,60.');
  const retifica = doc('Termo de Aditamento 207_2022.pdf', 'Fica retificado o Termo de Aditamento n° 137/2022 ao Contrato n° 066/2020, para que conste o valor de R$ 1.698.952,80.');
  const r = vc.calcularMediaMensal(grupo(contrato, acrescimo, retifica), '066/2020');
  assert.deepStrictEqual(r.aditivos.map(a => [a.termo, a.valor]), [['137', 1698952.8]]);
});
