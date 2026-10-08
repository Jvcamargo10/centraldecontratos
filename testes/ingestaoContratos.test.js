/* ===================================================================
   testes/ingestaoContratos.test.js

   Cobre as regras da APROVAÇÃO — o ponto do pipeline onde uma leitura de
   documento vira dado de verdade no cadastro. Como os outros testes deste
   diretório, cada caso aqui veio de um problema real observado em
   18/09/2026, não de cobertura por cobertura.

   Não toca em disco: monta um `db` em memória e um `save` que não faz
   nada. Use:  npm test
=================================================================== */

const { test } = require('node:test');
const assert = require('node:assert');

const ingestao = require('../integrations/ingestaoContratos');

const nextId = arr => (arr.length ? Math.max(...arr.map(x => Number(x.id) || 0)) + 1 : 1);
const semSalvar = () => {};

/* Cenário real de 18/09/2026: o contrato 096/2025 já existia, vindo
   sincronizado do SGC (origemExterna), e a proposta lida do arquivo
   trazia vigência e valor do extrato do Diário Oficial. */
function cenarioMesclagem() {
  return {
    contratos: [{
      id: 24, numero: '096/2025', empresa: 'Atlas',
      inicio: '2025-12-05', termino: '2027-01-22', valor: 2075.07,
      objeto: 'objeto completo vindo do SGC', origemExterna: true
    }],
    importacoesPendentes: [{
      id: 11, status: 'pendente', contratoExistenteId: 24,
      arquivo: { caminho: 'X:\\pasta\\contrato.pdf' },
      campos: {
        numero: '096/2025', empresa: 'AURORA TECNOLOGIA LTDA',
        cnpjEmpresa: '11.253.441/0001-11',
        inicio: '2025-12-19', termino: '2026-12-19', valor: 26100000,
        objeto: 'objeto truncado lido do arquivo'
      }
    }]
  };
}

test('aprovar com campo em branco PRESERVA o valor já gravado', () => {
  /* É o mecanismo que permite aceitar o que a leitura acertou e recusar o que
     ela errou, sem precisar de uma tela separada: quem aprova apaga o
     campo no formulário e o valor atual fica. */
  const db = cenarioMesclagem();
  const contrato = ingestao.aprovarImportacao(db, semSalvar, nextId, 11,
    { inicio: '', termino: '', valor: '', objeto: '' }, 'Teste');

  assert.equal(contrato.inicio, '2025-12-05', 'vigência oficial do SGC não pode ser sobrescrita por campo vazio');
  assert.equal(contrato.termino, '2027-01-22');
  assert.strictEqual(contrato.valor, 2075.07);
  assert.equal(contrato.objeto, 'objeto completo vindo do SGC');
  // O que a leitura acertou continua entrando normalmente.
  assert.equal(contrato.empresa, 'AURORA TECNOLOGIA LTDA');
  assert.equal(contrato.cnpjEmpresa, '11.253.441/0001-11');
});

test('toda sobrescrita fica registrada com o valor anterior', () => {
  /* Sem esse registro, o valor antigo desaparecia sem rastro — e como a
     fonte pode ser o SGC, era impossível saber depois o que havia antes
     de uma leitura de documento substituir o dado oficial. */
  const db = cenarioMesclagem();
  ingestao.aprovarImportacao(db, semSalvar, nextId, 11, {}, 'Teste');

  const trocas = db.importacoesPendentes[0].camposSobrescritos;
  assert.ok(Array.isArray(trocas), 'a proposta precisa guardar o que foi trocado');
  const porCampo = Object.fromEntries(trocas.map(t => [t.campo, t]));
  assert.deepEqual(porCampo.valor, { campo: 'valor', de: 2075.07, para: 26100000 });
  assert.deepEqual(porCampo.termino, { campo: 'termino', de: '2027-01-22', para: '2026-12-19' });
  // Campo que estava vazio no contrato é preenchimento, não substituição.
  assert.equal(porCampo.cnpjEmpresa, undefined);
});

test('contrato NOVO exige pelo menos o número', () => {
  /* Foi assim que nasceu o contrato "(sem número — importado
     2026-09-18)", com empresa "(a preencher)" e vigência de um dia:
     alguém aprovou uma proposta que veio vazia porque a IA respondeu
     fora do formato. Ele depois aparecia nos alertas de vencimento como
     se fosse um contrato de verdade. */
  const db = { contratos: [], importacoesPendentes: [{
    id: 1, status: 'pendente', contratoExistenteId: null,
    arquivo: { caminho: 'X:\\contrato.pdf' }, campos: {}
  }] };
  assert.throws(
    () => ingestao.aprovarImportacao(db, semSalvar, nextId, 1, {}, 'Teste'),
    /número do contrato/i
  );
  assert.equal(db.contratos.length, 0, 'nenhum contrato pode ter sido criado');
});

test('contrato novo com número é criado normalmente', () => {
  const db = { contratos: [], importacoesPendentes: [{
    id: 1, status: 'pendente', contratoExistenteId: null,
    arquivo: { caminho: 'X:\\contrato.pdf' },
    campos: { numero: '096/2025', empresa: 'ATLAS LTDA' }
  }] };
  const contrato = ingestao.aprovarImportacao(db, semSalvar, nextId, 1, {}, 'Teste');
  assert.equal(contrato.numero, '096/2025');
  assert.equal(contrato.origemArquivo, true);
  assert.equal(db.contratos.length, 1);
});

/* ------------------------------------------------------------------
   Campos da proposta, lidos por regra
------------------------------------------------------------------ */

const { camposDaProposta } = ingestao._paraTeste;

const TEXTO_CONTRATO = 'unos 303 Ficioda Geral do Município CONTRATO Nº 096/2025 ' +
  'Pelo presente instrumento, de um lado o MUNICÍPIO DE ITAVERDE, inscrito no CNPJ sob o nº 11.256.774/0001-02, ' +
  'e de outro lado a empresa AURORA TECNOLOGIA LTDA, inscrita no CNPJ nº 11.253.441/0001-11, ' +
  'Processo Administrativo n° 01.275/2025, decorrente do Pregão Eletrônico nº 90.084/2025.';

test('proposta: os campos saem da regra, com a procedência de cada um', () => {
  /* O cabeçalho do OCR ("unos 303") não vira número: a regra só aceita o
     padrão inteiro "CONTRATO Nº 096/2025". O número decide se a aprovação
     mescla com um contrato existente ou cria um novo. */
  const r = camposDaProposta(TEXTO_CONTRATO);
  assert.equal(r.campos.numero, '096/2025');
  assert.equal(r.campos.pa, '01.275/2025');
  assert.equal(r.campos.tipoContratacao, 'Pregão Eletrônico');
  assert.equal(r.campos.cnpjEmpresa, '11.253.441/0001-11', 'CNPJ da contratada, não o do Município');
  assert.equal(r.campos.empresa, 'AURORA TECNOLOGIA LTDA');
  assert.equal(r.procedencia.numero, 'busca_local');
  assert.equal(r.modeloUsado, 'regras');
});

test('proposta: campo não achado fica em branco, sem procedência — vai para Pendências de leitura', () => {
  const r = camposDaProposta('texto sem nada de contrato aqui');
  assert.deepStrictEqual(r.campos, {});
  assert.deepStrictEqual(r.procedencia, {});
  assert.strictEqual(r.confiancas.numero, null);
});

test('uma proposta não pode ser aprovada duas vezes', () => {
  const db = cenarioMesclagem();
  ingestao.aprovarImportacao(db, semSalvar, nextId, 11, {}, 'Teste');
  assert.throws(() => ingestao.aprovarImportacao(db, semSalvar, nextId, 11, {}, 'Teste'), /já foi aprovada/i);
});

/* ------------------------------------------------------------------
   Ferramenta 3 — ficha de cadastro
------------------------------------------------------------------ */

const ficha = require('../integrations/fichaCadastroContrato');

test('ficha: a leitura do texto completa número e processo vazios na base', () => {
  const resultado = { campos: { numero: null, processoAdministrativo: null, empresa: null } };
  ficha._paraTeste.conferirComBuscaLocal(resultado, TEXTO_CONTRATO);
  assert.equal(resultado.campos.numero, '096/2025');
  assert.equal(resultado.campos.processoAdministrativo, '01.275/2025');
  assert.ok(resultado.camposDaBuscaLocal.some(c => c.campo === 'numero'));
});

test('ficha: avisa sobre cada data que não aparece no documento', () => {
  /* A verificação é POR DATA. A primeira versão só avisava quando o
     documento não tinha nenhuma data numérica — e bastava uma data solta
     (um carimbo, uma publicação, ruído do OCR) para silenciar o alerta de
     todas as outras. Aqui o documento TEM uma data (05/01/2026), e ainda
     assim as duas inventadas precisam ser apontadas. */
  const texto = 'Itaverde, 19 de dezembro de 2025. Publicado em 05/01/2026. Vigência de 12 (doze) meses.';
  const avisos = ficha._paraTeste.avisosDaFicha(
    { dataAssinatura: '2025-03-15', dataInicioVigencia: '2025-04-15' },
    texto
  );
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /não aparecem no documento/);
  assert.match(avisos[0], /dataAssinatura \(2025-03-15\)/);
  assert.match(avisos[0], /dataInicioVigencia \(2025-04-15\)/);
});

test('ficha: data que consta do documento não gera aviso', () => {
  const texto = 'Itaverde, 19 de dezembro de 2025. Publicado em 05/01/2026.';
  assert.deepEqual(ficha._paraTeste.avisosDaFicha({ dataAssinatura: '2026-01-05' }, texto), []);
});

test('ficha: a leitura não "corrige" razão social por diferença de pontuação', () => {
  /* Trocar "...LTDA." por "...LTDA" e registrar isso como correção seria
     ruído na procedência. */
  const r = { campos: { empresa: 'AURORA TECNOLOGIA LTDA.', numero: null } };
  ficha._paraTeste.conferirComBuscaLocal(r,
    'CONTRATO Nº 096/2025 ... a empresa AURORA TECNOLOGIA LTDA, inscrita no CNPJ nº 11.253.441/0001-11');
  assert.equal(r.campos.empresa, 'AURORA TECNOLOGIA LTDA.', 'o que já estava prevalece');
  assert.ok(!r.camposDaBuscaLocal.some(c => c.campo === 'empresa'));
  assert.ok(r.camposDaBuscaLocal.some(c => c.campo === 'numero'), 'campo vazio continua sendo completado');
});

test('ficha: avisa sobre valor que não aparece escrito no documento', () => {
  /* Caso real (da época da IA): R$ 100.000 num contrato de R$ 26.100.000 —
     o número simplesmente não existe no texto. */
  const avisos = ficha._paraTeste.avisosDaFicha(
    { valorContrato: 100000 },
    'valor: R$ 26.100.000,00 (vinte e seis milhões e cem mil reais).'
  );
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /não aparece escrito no documento/);
});

test('ficha: valor que consta do documento não gera aviso', () => {
  const avisos = ficha._paraTeste.avisosDaFicha(
    { valorContrato: 26100000 },
    'valor: R$ 26.100.000,00 (vinte e seis milhões e cem mil reais).'
  );
  assert.deepEqual(avisos, []);
});

test('ficha: valor do contrato, vigência e média mensal vêm do documento, pela regra do SGC', () => {
  /* A primeira ficha real do 096/2025 saiu com R$ 100.000 de valor. O
     contrato traz "valor total deste contrato para 12 (doze) meses é de
     R$ 26.100.000,00" — e a média mensal do SGC é valor ÷ meses (regra
     explicada pelo usuário e conferida ao centavo em 4 contratos). */
  const r = { campos: { valorContrato: 100000, vigenciaEmMeses: null, valorMediaMensal: null } };
  ficha._paraTeste.conferirComBuscaLocal(r, '5.1. Ovalortotal deste contrato para 12 (doze) meses é de R$ 26.100.000,00 (vinte e seis milhões)');
  assert.strictEqual(r.campos.valorContrato, 26100000);
  assert.strictEqual(r.campos.vigenciaEmMeses, 12);
  assert.strictEqual(r.campos.valorMediaMensal, 2175000);
  assert.ok(r.camposDaBuscaLocal.some(c => c.campo === 'valorContrato' && c.daIa === 100000));
});

test('média mensal pela regra do SGC confere com contratos reais', () => {
  // Casos medidos na avaliação: bate ao centavo com o valor_media_mensal do SGC.
  const ia = require('../integrations/leituraPorRegra');
  assert.strictEqual(ia.extrairValorEVigencia('5.1. Ovalor total global deste contrato é de R$ 2.330.237,52 ... vigência de 36 (trinta e seis) meses').mediaMensal, 64728.82);
  assert.strictEqual(ia.extrairValorEVigencia('O valor total deste contrato para 24 (vinte e quatro) meses é de R$ 12.990.250,00').mediaMensal, 541260.42);
  assert.strictEqual(ia.extrairValorEVigencia('O valor global do presente contrato é de R$ 48.240.000,00 ... vigência de 36 (trinta e seis) meses').mediaMensal, 1340000);
});

test('ficha: a média mensal usa os aditivos da pasta e não é marcada como inferida', () => {
  const { conferirComBuscaLocal, avisosDaFicha } = require('../integrations/fichaCadastroContrato')._paraTeste;
  const contrato = 'CONTRATO Nº 045/2022. 2.1. 0 presente contrato terá a vigência de 30 (trinta) meses. 5.1. 0 valor global deste Contrato é de R$ 9.000.000,00 (nove milhões).';
  const grupo = `=== Arquivo: Contrato Nº 045_2022.pdf ===\n${contrato}\n\n=== Arquivo: Termo de Aditamento Nº 238_2024.pdf ===\n` +
    'Fica prorrogada a vigência do Contrato nº 045/2022, por mais 18 (dezoito) meses. 2.1. O valor deste Aditamento é de R$ 6.996.235,20.';
  // Base com o valor do contrato certo e a média errada.
  const resultado = { campos: { numero: '045/2022', valorContrato: 9000000, valorMediaMensal: 300000 } };
  conferirComBuscaLocal(resultado, contrato, grupo);
  assert.strictEqual(resultado.campos.valorContrato, 9000000);
  assert.strictEqual(resultado.campos.vigenciaEmMeses, 30);
  assert.strictEqual(resultado.campos.valorMediaMensal, 333254.9);
  assert.match(resultado.calculoValor.memoria, /\(9\.000\.000,00 \+ 6\.996\.235,20\) ÷ \(30 \+ 18\)/);
  const avisos = avisosDaFicha(resultado.campos, contrato, [...resultado.camposDaBuscaLocal, ...resultado.valoresDaRegra]);
  assert.ok(!avisos.some(a => /valorMediaMensal|valorContrato/.test(a)), avisos.join(' | '));
});

test('recálculo: proposta pendente ganha a vigência calculada e perde a data inferida pela IA', async () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const extrator = require('../integrations/extratorDocumento');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setec-recalculo-'));
  extrator._cache.CONFIG_CACHE.pasta = path.join(dir, 'cache');
  const contrato = path.join(dir, 'Contrato Nº 072_2020.pdf');
  const termo = path.join(dir, 'Termo de Aditamento Nº 197_2024.pdf');
  fs.writeFileSync(contrato, 'x'); fs.writeFileSync(termo, 'y');
  // Página já lida por OCR: página única com pouco texto e sem OCR seria
  // relida como digitalizada (ver camadaDeTextoRala em extratorDocumento.js).
  const guardar = (caminho, texto) => extrator._cache.gravarNoCache(caminho, { caminho, extensao: 'pdf', semTexto: false, totalCaracteres: texto.length, paginas: [{ numero: 1, texto }], ocr: { tentado: true, paginasProcessadas: 1, paginasLidas: [1] }, leituraCompleta: true }, 10, 180000);
  guardar(contrato, 'CONTRATO Nº 072/2020. O prazo de vigência deste Contrato é de 24 (vinte e quatro) meses, contados da assinatura. O valor total deste contrato é de R$ 2.780.000,00. Itaverde, 14 de agosto de 2020');
  guardar(termo, 'Fica prorrogada a vigência do Contrato nº 072/2020, por 12 (doze) meses, contada de 14 de agosto de 2022. O valor deste Aditamento é de R$ 1.390.000,00.');
  const db = { importacoesPendentes: [{
    id: 1, status: 'pendente', arquivo: { caminho: contrato, nome: path.basename(contrato) },
    arquivosFonte: [{ caminho: contrato, nome: path.basename(contrato) }, { caminho: termo, nome: path.basename(termo) }],
    campos: { numero: '072/2020', inicio: '2021-01-01', termino: '2022-01-01' }, confiancas: {},
    procedencia: { numero: 'busca_local', inicio: 'inferido', termino: 'inferido' }
  }] };
  const r = await ingestao.recalcularPropostasPendentes(db, () => {});
  const p = db.importacoesPendentes[0];
  assert.deepStrictEqual(r, { recalculadas: 1, alteradas: 1, semTexto: 0, camposAlterados: 3, termosDeAprovados: 0, vigenciasDeAprovados: [], encerramentosDetectados: [], garantiasLidas: [], mudancasDetectadas: [] });
  assert.strictEqual(p.campos.inicio, '2020-08-14');
  assert.strictEqual(p.campos.termino, '2023-08-14');   // 24 meses da assinatura + 12 da prorrogação
  assert.strictEqual(p.campos.valor, 115833.33);          // (2.780.000 + 1.390.000) ÷ 36
  assert.strictEqual(p.procedencia.termino, 'busca_local');
  assert.ok(p.calculoVigencia && p.calculoValor);
});
