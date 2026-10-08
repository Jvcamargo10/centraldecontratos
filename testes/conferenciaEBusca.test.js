/* ===================================================================
   testes/conferenciaEBusca.test.js

   Ferramentas de 01/10/2026: situação da resposta ao TCE (prazo, alerta,
   registro), "leitura errada", fichas do SGC de aditivo/apostilamento/
   empresa e a busca dentro dos documentos já lidos.
=================================================================== */
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const requisicoes = require('../integrations/requisicoes');
const leituras = require('../integrations/leiturasReportadas');
const fichas = require('../integrations/fichasSgc');
const busca = require('../integrations/buscaDocumentos');

test('situação da resposta ao TCE: respondida, atrasada, vence logo, no prazo, antiga', () => {
  const s = (dados, hoje = '2026-10-01') => requisicoes.situacaoResposta(dados, hoje).situacao;
  assert.strictEqual(s({ prazo: '2026-09-20', manual: { em: '2026-09-18' } }), 'respondida');
  assert.strictEqual(s({ prazo: '2026-09-20', oficioNaPasta: true }), 'respondida');
  assert.strictEqual(s({ prazo: null }), 'sem_prazo');
  assert.strictEqual(s({ prazo: '2026-09-28' }), 'atrasada');
  assert.strictEqual(requisicoes.situacaoResposta({ prazo: '2026-09-28' }, '2026-10-01').rotulo, 'Atrasada há 3 dia(s)');
  assert.strictEqual(s({ prazo: '2026-10-01' }), 'vence_logo');
  assert.strictEqual(requisicoes.situacaoResposta({ prazo: '2026-10-01' }, '2026-10-01').rotulo, 'Vence hoje');
  assert.strictEqual(s({ prazo: '2026-10-06' }), 'vence_logo');
  assert.strictEqual(s({ prazo: '2026-10-07' }), 'no_prazo');
  assert.strictEqual(s({ prazo: '2026-05-01' }), 'historico', 'mais de 90 dias: não vira alerta');
});

test('resposta registrada à mão tira a requisição dos alertas; reabrir devolve', () => {
  const db = { requisicoesAnalisadas: [
    { id: 7, nomeArquivo: 'req.pdf', campos: { requisicao: '123/2026', prazo: '2026-10-03', contrato: '015/2024' } },
    { id: 8, nomeArquivo: 'velha.pdf', campos: { requisicao: '9/2025', prazo: '2025-01-10' } }
  ] };
  let p = requisicoes.pendenciasDeResposta(db, '2026-10-01');
  assert.strictEqual(p.length, 1, 'a antiga (histórico) não entra');
  assert.strictEqual(p[0].situacao, 'vence_logo');
  requisicoes.registrarResposta(db, { analiseId: 7, acao: 'respondida', em: '2026-10-01', oficio: 'Ofício 55/2026' }, 'Fulano');
  assert.strictEqual(requisicoes.pendenciasDeResposta(db, '2026-10-01').length, 0);
  assert.strictEqual(db.requisicoesResposta['analise:7'].oficio, 'Ofício 55/2026');
  requisicoes.registrarResposta(db, { analiseId: 7, acao: 'reabrir' }, 'Fulano');
  assert.strictEqual(requisicoes.pendenciasDeResposta(db, '2026-10-01').length, 1);
  assert.throws(() => requisicoes.registrarResposta(db, { analiseId: 99, acao: 'respondida' }), /não encontrada/);
  assert.throws(() => requisicoes.registrarResposta(db, { analiseId: 7, acao: 'respondida', em: '01/10/2026' }), /inválida/);
  assert.throws(() => requisicoes.registrarResposta(db, { analiseId: 7, acao: 'apagar' }), /inválida/);
});

test('leitura errada: registra, alterna resolvida/aberta e exporta', () => {
  const db = {};
  assert.throws(() => leituras.registrar(db, { valorCorreto: 'x' }), /campo/);
  assert.throws(() => leituras.registrar(db, { campo: 'Valor' }), /valor certo/);
  const r = leituras.registrar(db, { onde: 'Base de dados', referencia: '015/2024', campo: 'Valor', valorLido: '1.000,00', valorCorreto: '10.000,00', documento: 'contrato.pdf' }, 'Fulano');
  assert.strictEqual(r.status, 'aberta');
  assert.strictEqual(leituras.registrar(db, { campo: 'Data', observacao: 'data trocada com a da publicação' }, 'Fulano').id, 2);
  assert.strictEqual(leituras.resolver(db, 1, null, 'Admin').status, 'resolvida');
  assert.strictEqual(leituras.resolver(db, 1, null, 'Admin').status, 'aberta');
  assert.match(leituras.gerarCsv(db), /10\.000,00/);
});

test('fichas do SGC: aditivo com a nova data de término, apostilamento e empresa', () => {
  const db = {
    contratos: [{ id: 3, numero: '072/2020', empresa: 'SIGMA TECNOLOGIA', cnpjEmpresa: '11226777000195' }, { id: 4, numero: '1/2026', empresa: 'X' }],
    aditivos: [{ id: 'a1', contratoId: 3, contrato: '072/2020', numero: '156/2022', tipo: 'Prorrogação', meses: 24, valor: 784074.48, data: null, documento: 'aditivo.pdf', origem: 'documento' }],
    apostilamentos: [{ id: 'p1', contratoId: 3, contrato: '072/2020', numero: '013/2024', tipo: 'Alteração de gestor/suplente', gestor: 'Ana', data: '2024-01-16' }],
    importacoesPendentes: [{ status: 'aprovado', contratoId: 3, calculoVigencia: { periodos: [{ origem: 'contrato', fim: '2022-09-29' }, { origem: 'termo 156', meses: 24, fim: '2024-09-29' }] } }]
  };
  const campo = (f, r) => f.campos.find(c => c.rotulo === r);
  const ad = fichas.fichaDoTermo(db, 'aditivo', 'a1');
  assert.strictEqual(campo(ad, 'Nova data de término').valor, '29/09/2024');
  assert.match(campo(ad, 'Objeto').valor, /Prorrogação — 24 meses — valor R\$\s?784\.074,48/);
  assert.match(campo(ad, 'Data do extrato').aviso, /não lida/);
  const ap = fichas.fichaDoTermo(db, 'apostilamento', 'p1');
  assert.strictEqual(campo(ap, 'Data do extrato').valor, '16/01/2024');
  assert.strictEqual(campo(ap, 'Nova data de término').valor, null);
  assert.strictEqual(fichas.fichaDoTermo(db, 'aditivo', 'nao-existe'), null);
  assert.strictEqual(campo(fichas.fichaDaEmpresa(db, 3), 'CNPJ').valor, '11.226.777/0001-95');
  assert.match(campo(fichas.fichaDaEmpresa(db, 4), 'CNPJ').aviso, /não lido/);
});

const PASTA_CACHE = fs.mkdtempSync(path.join(os.tmpdir(), 'central-busca-'));
after(() => fs.rmSync(PASTA_CACHE, { recursive: true, force: true }));
const guardar = (nome, caminho, paginas) => fs.writeFileSync(path.join(PASTA_CACHE, nome + '.json'), JSON.stringify({ caminho, resultado: { caminho, paginas } }));

test('busca nos documentos: palavras em qualquer ordem, frase entre aspas, sem acento, com página', () => {
  guardar('a', 'F:\\c\\Contrato 015.pdf', [{ numero: 1, texto: 'CLÁUSULA DÉCIMA — Do reajuste' }, { numero: 3, texto: 'O reajuste será pelo IPCA, aplicada multa de mora de 0,33% ao dia.' }]);
  guardar('b', 'F:\\c\\Aditivo 2.pdf', [{ numero: 1, texto: 'Prorrogação por 12 meses. Multa contratual.' }]);
  assert.deepStrictEqual(busca.interpretarConsulta('"multa de mora" Reajuste'), ['multa de mora', 'reajuste']);
  const r = busca.buscar(PASTA_CACHE, 'reajuste ipca');
  assert.strictEqual(r.totalDocumentos, 1);
  assert.strictEqual(r.resultados[0].nome, 'Contrato 015.pdf');
  // Termos próximos na mesma página saem num trecho só.
  const t3 = r.resultados[0].trechos.filter(t => t.pagina === 3);
  assert.strictEqual(t3.length, 1);
  assert.match(t3[0].antes + t3[0].achado + t3[0].depois, /reajuste será pelo IPCA/);
  assert.strictEqual(busca.buscar(PASTA_CACHE, 'clausula decima').totalDocumentos, 1, 'sem acento acha com acento');
  assert.strictEqual(busca.buscar(PASTA_CACHE, 'multa').totalDocumentos, 2);
  assert.strictEqual(busca.buscar(PASTA_CACHE, '"multa de mora"').totalDocumentos, 1);
  assert.strictEqual(busca.buscar(PASTA_CACHE, 'multa', { filtro: c => /Aditivo/.test(c) }).resultados[0].nome, 'Aditivo 2.pdf');
  assert.throws(() => busca.buscar(PASTA_CACHE, 'a'), /ao menos uma palavra/);
  assert.ok(busca.documentoNoIndice(PASTA_CACHE, 'F:\\c\\Aditivo 2.pdf'));
  assert.ok(!busca.documentoNoIndice(PASTA_CACHE, 'F:\\c\\outro.pdf'), 'só abre o que está no índice');
});
