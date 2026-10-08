/* Vigência em MESES a partir de um marco (assinatura ou Ordem de Início),
   com as prorrogações encadeadas — regra definida pelo usuário em
   22/09/2026, conferida contra o SGC. */
const test = require('node:test');
const assert = require('node:assert');
const { calcularVigencia, _paraTeste } = require('../integrations/vigenciaContratual');
const { lerData, somarMeses, marcoInicial } = _paraTeste;

const doc = (nome, texto) => `=== Arquivo: ${nome} ===\n${texto}`;

test('datas por extenso com defeitos de OCR', () => {
  assert.strictEqual(lerData('Itaverde, o5 de dezembro de 2025'), '2025-12-05');
  assert.strictEqual(lerData('contada de 21 de marco de 2024'), '2024-03-21');
  assert.strictEqual(lerData('Lei nº 8.666, de 21 dejunho de 1993'), '1993-06-21');
  assert.strictEqual(lerData('a partir de 1° de agosto de 2025'), '2025-08-01');
  assert.strictEqual(lerData('em 05/12/2025'), '2025-12-05');
  assert.strictEqual(lerData('31 de fevereiro de 2025'), null);
});

test('meses pelo Código Civil: mesmo dia, ou o imediato se faltar', () => {
  assert.strictEqual(somarMeses('2024-09-29', 12), '2025-09-29');
  assert.strictEqual(somarMeses('2026-02-13', 12), '2027-02-13');
  assert.strictEqual(somarMeses('2025-01-31', 1), '2025-03-01');
});

test('marco: assinatura ou Ordem de Início', () => {
  assert.strictEqual(marcoInicial('O prazo de vigência será de 12 (doze) meses, contados da data de assinatura'), 'assinatura');
  assert.strictEqual(marcoInicial('A vigência do Contrato é de 36 (trinta e seis) meses consecutivos, contados da data de recebimento da Ordem de Início dos Serviços'), 'ordem');
  assert.strictEqual(marcoInicial('Vigência: conforme o edital'), null);
});

test('contrato contado da assinatura: término = assinatura + meses (086/2026)', () => {
  const r = calcularVigencia(doc('Contrato Comercial Nº 086_2026.pdf',
    'CLÁUSULA DÉCIMA TERCEIRA - DA VIGÊNCIA 13.1. O prazo de vigência será de 12 (doze) meses, contados da data de assinatura. ... “Itaverde, o3 de agosto de 2026'), '086/2026');
  assert.strictEqual(r.inicio, '2026-08-03');
  assert.strictEqual(r.termino, '2027-08-03');
  assert.deepStrictEqual(r.avisos, []);
});

/* Regra do usuário (24/09/2026): sem a Ordem de Início nos documentos, a
   vigência é contada da ASSINATURA — com aviso e marcada como presumida. */
test('contrato contado da Ordem de Início sem a Ordem na pasta: término contado da assinatura, com aviso', () => {
  const r = calcularVigencia(doc('Contrato nº 141_2022.pdf',
    'A vigência do Contrato é de 36 (trinta e seis) meses consecutivos, contados da data de recebimento da Ordem de Início dos Serviços. Itaverde, 14 de dezembro de 2022'), '141/2022');
  assert.strictEqual(r.inicio, '2022-12-14');
  assert.strictEqual(r.termino, '2025-12-14');
  assert.strictEqual(r.marcoPresumido, true);
  assert.match(r.memoria, /sem Ordem de Início nos documentos — contado da assinatura/);
  assert.ok(r.avisos.some(a => /Ordem de Início — essa seria a data de início correta.*não foi encontrada.*calculados a partir da assinatura \(14\/12\/2022\)/.test(a)));
  assert.match(r.rotuloInicio, /Ordem de Início não foi encontrada/);
});

test('com a Ordem de Início na pasta, ela continua mandando (não é presumido)', () => {
  const texto = [
    doc('Contrato nº 010_2024.pdf', 'vigência de 36 (trinta e seis) meses, contados da data do recebimento da ordem de início dos serviços pela CONTRATADA. Contrato nº 010/2024. Itaverde, 27 de fevereiro de 2024'),
    doc('Ordem de Inicio de Serviço - Meridiano.pdf', 'Itaverde, 01 de março de 2024. Ordem de Início de Serviços. Fica a empresa autorizada a dar início aos serviços constantes no contrato nº 010/2024.')
  ].join('\n\n');
  const r = calcularVigencia(texto, '010/2024');
  assert.strictEqual(r.termino, '2027-03-01');
  assert.strictEqual(r.marcoPresumido, false);
});

test('cláusula que não diz de quando conta: também da assinatura', () => {
  const r = calcularVigencia(doc('Contrato nº 200_2023.pdf', 'O prazo de vigência deste contrato é de 12 (doze) meses. Contrato nº 200/2023. Itaverde, 10 de março de 2023'), '200/2023');
  assert.strictEqual(r.termino, '2024-03-10');
  assert.strictEqual(r.marcoPresumido, true);
});

test('sem Ordem e sem assinatura nos documentos, o término continua vazio', () => {
  const r = calcularVigencia(doc('Contrato nº 141_2022.pdf', 'A vigência do Contrato é de 36 (trinta e seis) meses, contados da data de recebimento da Ordem de Início dos Serviços.'), '141/2022');
  assert.strictEqual(r.termino, null);
  assert.ok(r.avisos.some(a => /não pôde ser calculado/.test(a)));
});

test('prorrogações: término do último termo, conferindo o encadeamento (072/2020)', () => {
  const texto = [
    doc('1. Contrato n° 072.2020.pdf', 'O prazo de vigência deste Contrato é de 24 (vinte e quatro) meses, contados da data de recebimento da Ordem de Início.'),
    doc('4. Aditamento nº 156.2022 do Contrato nº 072.2020.pdf', 'Ficaprorrogada a vigência do Contrato nº 072/2020, por mais 24 (vinte e quatro) meses, contada de 29 de setembro de 2022.'),
    doc('Termo de Aditamento Nº 197_2024.pdf', 'Fics pronogada a vigincia do Contrato nº 072/2020, por 12 (dare) meses, contada de 29 de setembro de 2024, contomo manfegiação.')
  ].join('\n\n');
  const r = calcularVigencia(texto, '072/2020');
  assert.strictEqual(r.termino, '2025-09-29');
  assert.strictEqual(r.periodos.length, 3);
  assert.strictEqual(r.periodos[1].fim, '2024-09-29');
  assert.ok(!r.avisos.some(a => /mas o período anterior terminava/.test(a)), 'o encadeamento bate');
});

test('termo que escreve o fim ("até ...") vale a data escrita; data de assinatura de termo não é a do contrato', () => {
  const texto = [
    doc('Contrato Nº 066_2020.pdf', 'O prazo de vigência deste Contrato é de 36 (trinta e seis) meses, contados da assinatura. Itaverde, 07 de agosto de 2020'),
    doc('Termo de Ciência - aditamento.pdf', 'CONTRATO N° (DE ORIGEM): 066/2020 TERMO DE ADITAMENTO N° 147/2023 DATA DA ASSINATURA: 04 de agosto de 2023'),
    doc('Termo Aditamento - 147_2023.pdf', 'Fica prorrogada a vigência do Contrato nº 066/2020, por mais 12 (doze) meses, à contar de 07 de agosto de 2023 até 06 de agosto de 2024.'),
    doc('Termo de Aditamento Nº 176_2025.pdf', 'Fica prorrogada excepcionalmente a vigência do Contrato nº 066/2020, por mais 12 (doze) meses ou até a conclusão da licitação, a contar de 06 de agosto de 2025.')
  ].join('\n\n');
  const r = calcularVigencia(texto, '066/2020');
  assert.strictEqual(r.inicio, '2020-08-07');
  assert.strictEqual(r.periodos[1].fim, '2024-08-06');
  assert.strictEqual(r.termino, '2026-08-06');
  assert.ok(r.avisos.some(a => /termo 176 prorroga a partir de 06\/08\/2025, mas o período anterior terminava em 06\/08\/2024/.test(a)),
    'o salto de um ano entre os termos vira aviso (faltaria o termo 136/2024)');
});

test('contrato contado da Ordem de Início, com a ordem na pasta: término = data da ordem + meses (048/2026)', () => {
  const texto = [
    doc('Contrato Comercial Nº 048_2026.pdf', 'O presente contrato terá a vigência de 05 (cinco) anos, contados do recebimento da ordem de início dos serviços pela CONTRATADA. Itaverde, 11 de maio de 2026'),
    doc('Ordem de Inicio de Serviços - Contrato 048_2026.pdf', 'Itaverde, 27 de maio de 2026 Ordem de início de Serviços ... fica estabelecido por meio desse documento o início do contrato Nº 048/2026 com vigência de 60 (sessenta) meses')
  ].join('\n\n');
  const r = calcularVigencia(texto, '048/2026');
  // Regra do usuário (24/09/2026): o contrato conta da Ordem de Início e ela foi achada: o início é a Ordem.
  assert.strictEqual(r.inicio, '2026-05-27', 'início = Ordem de Início, como a cláusula manda');
  assert.strictEqual(r.assinatura, '2026-05-11', 'a assinatura continua disponível à parte');
  assert.strictEqual(r.rotuloInicio, 'Início pela Ordem de Início');
  assert.strictEqual(r.periodos[0].inicio, '2026-05-27');
  assert.strictEqual(r.termino, '2031-05-27');
  assert.deepStrictEqual(r.avisos, []);
});

/* Dado informado à mão (tela Pendências de leitura): a data entra como
   MARCO e o término continua saindo da regra (marco + meses), nunca
   digitado pronto. Só vale quando a leitura não achou o dado. */
test('Ordem de Início informada à mão: término = data informada + meses lidos do contrato', () => {
  const texto = doc('Contrato Nº 088_2026.pdf', 'O prazo de vigência é de 12 (doze) meses, contados do recebimento da ordem de início dos serviços.');
  const semData = calcularVigencia(texto, '088/2026');
  assert.strictEqual(semData.termino, null, 'sem a ordem na pasta, não há término');

  const r = calcularVigencia(texto, '088/2026', { marcoInformado: { data: '2026-03-04', por: 'Fulano' } });
  assert.strictEqual(r.termino, '2027-03-04');
  assert.strictEqual(r.inicio, '2026-03-04', 'sem assinatura lida, o início é o marco informado');
  assert.ok(r.avisos.some(a => /informada à mão por Fulano/.test(a)), 'o dado informado fica declarado nos avisos');
  assert.ok(/informado à mão/.test(r.periodos[0].base));
});

test('vigência em meses informada à mão quando a cláusula não foi lida', () => {
  const texto = doc('Contrato Nº 102_2022.pdf', 'Acordo de cooperação técnica entre as partes, sem cláusula de prazo legível.');
  const r = calcularVigencia(texto, '102/2022', { marcoInformado: { data: '2022-06-01' }, mesesInformados: 24 });
  assert.strictEqual(r.termino, '2024-06-01');
  assert.strictEqual(r.mesesTotal, 24);
  assert.ok(r.avisos.some(a => /24 meses informados à mão/.test(a)));
});

test('documento lido vale mais do que dado informado: a ordem na pasta ignora a data digitada', () => {
  const texto = [
    doc('Contrato Comercial Nº 048_2026.pdf', 'O presente contrato terá a vigência de 05 (cinco) anos, contados do recebimento da ordem de início dos serviços pela CONTRATADA. Itaverde, 11 de maio de 2026'),
    doc('Ordem de Inicio de Serviços - Contrato 048_2026.pdf', 'Itaverde, 27 de maio de 2026 Ordem de início de Serviços ... fica estabelecido por meio desse documento o início do contrato Nº 048/2026 com vigência de 60 (sessenta) meses')
  ].join('\n\n');
  const r = calcularVigencia(texto, '048/2026', { marcoInformado: { data: '2020-01-01', por: 'Fulano' } });
  assert.strictEqual(r.periodos[0].inicio, '2026-05-27');
  assert.strictEqual(r.termino, '2031-05-27');
  assert.deepStrictEqual(r.avisos, []);
});


/* Ordem de Fornecimento escaneada, sem o número do contrato (096/2025, 24/09/2026). */
test('Ordem de Fornecimento sem o número do contrato: vale, com aviso; rascunho, certificado e Ordem de outro contrato não', () => {
  const contrato = doc('Contrato Comercial Nº 096_2025.pdf', 'vigência de 12 (doze) meses, contados do recebimento da ordem de fornecimento pela CONTRATADA. Contrato nº 096/2025. DATA DA ASSINATURA: 05 de dezembro de 2025');
  const rascunho = doc('Ordem de inicio de serviços - Contrato 096_2025.docx', 'Itaverde, XX de xxxxx de 2026 Ordem de início de Serviços ... o início do contrato Nº 096/2025 com vigência de 12 (doze) meses');
  const certificado = doc('Assinaturas - Ordem de Serviço.pdf', 'Certificado de Conclusão. Enviado em 10 de janeiro de 2026. Assinado em 12 de janeiro de 2026.');
  const deOutro = doc('Ordem de Serviço - Contrato 050_2025.pdf', 'Itaverde, 03 de janeiro de 2026. Ordem de Serviço do contrato nº 050/2025.');
  const of = doc('Ordem de Serviço_assinada Atlas.pdf', 'PREFEITURA DO MUNICÍPIO DE ITAVERDE ORDEM DE FORNECIMENTO (O.F) Contratada: AURORA TECNOLOGIA LTDA. Data da Emissão: 22/01/2026');
  const r = calcularVigencia([contrato, rascunho, certificado, deOutro, of].join('\n\n'), '096/2025');
  assert.strictEqual(r.termino, '2027-01-22');
  assert.strictEqual(r.marcoPresumido, false);
  assert.match(r.memoria, /não cita o número do contrato/);
  assert.ok(r.avisos.some(a => /Confira se é a Ordem deste contrato/.test(a)));
});

test('arquivo chamado só "OS.pdf" e "Ordem de Fornecimento" contam como Ordem de Início', () => {
  const { classificarDocumento } = require('../integrations/valorContratual').pecas;
  assert.strictEqual(classificarDocumento('OS.pdf').tipo, 'ordem');
  assert.strictEqual(classificarDocumento('O.F. 01-2026.pdf').tipo, 'ordem');
  assert.strictEqual(classificarDocumento('Ordem de Fornecimento 01_2026.pdf').tipo, 'ordem');
  assert.notStrictEqual(classificarDocumento('Ofício nº 001-OMTX-2026.pdf').tipo, 'ordem');
});


test('Ordem de Início na pasta, mas sem data legível: início pela assinatura, dizendo que a Ordem não pôde ser lida', () => {
  const texto = [
    doc('Contrato nº 096_2025.pdf', 'vigência de 12 (doze) meses, contados do recebimento da ordem de fornecimento pela CONTRATADA. Contrato nº 096/2025. DATA DA ASSINATURA: 05 de dezembro de 2025'),
    doc('Ordem de inicio de serviços - Contrato 096_2025.docx', 'Itaverde, XX de xxxxx de 2026 Ordem de início de Serviços do contrato Nº 096/2025')
  ].join('\n\n');
  const r = calcularVigencia(texto, '096/2025');
  assert.strictEqual(r.inicio, '2025-12-05');
  assert.strictEqual(r.termino, '2026-12-05');
  assert.ok(r.avisos.some(a => /Há Ordem de Início na pasta, mas não foi possível extrair a data dela/.test(a)));
});

test('contrato que conta da assinatura: início é a assinatura, sem aviso', () => {
  const r = calcularVigencia(doc('Contrato Comercial Nº 086_2026.pdf', 'O prazo de vigência será de 12 (doze) meses, contados da data de assinatura. Itaverde, 03 de agosto de 2026'), '086/2026');
  assert.strictEqual(r.inicio, '2026-08-03');
  assert.strictEqual(r.rotuloInicio, 'Início pela assinatura do contrato');
  assert.deepStrictEqual(r.avisos, []);
});

test('data sem o "de" antes do ano ("27 de dezembro 2022", Ordem de Início do 141/2022)', () => {
  assert.strictEqual(lerData('Itaverde, 27 de dezembro 2022. Ordem de Início'), '2022-12-27');
  assert.strictEqual(lerData('Itaverde, 27 de dezembro, 2022'), '2022-12-27');
  const texto = [
    doc('Contrato nº 141_2022.pdf', 'A vigência do Contrato é de 36 (trinta e seis) meses consecutivos, contados da data de recebimento da Ordem de Início dos Serviços. Contrato nº 141/2022. Itaverde, AEE ÍA Y J RA'),
    doc('Ordem de inicio de serviço - Autodesk.pdf', 'Itaverde, 27 de dezembro 2022. Ordem de Início de Serviços ... referentes ao Contrato n° 141/2022')
  ].join('\n\n');
  const r = calcularVigencia(texto, '141/2022');
  assert.strictEqual(r.inicio, '2022-12-27');
  assert.strictEqual(r.termino, '2025-12-27');
});
