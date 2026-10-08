/* ===================================================================
   testes/cadastroECooperacao.test.js

   Melhorias de 25/09/2026, com os casos reais que as motivaram:
     - acordo/termo de cooperação sem repasse (002/2024, 102/2022): itens
       de dinheiro e eixo Financeiro "não se aplica";
     - arquivo principal que era um MODELO em branco (002/2024);
     - CNPJ da Prefeitura no lugar do da empresa (002/2024, 061/2025);
     - Painel e Mapa com o MESMO risco (riscoAtualDoContrato);
     - cabeçalho de página fora da citação mostrada como prova.
=================================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const regra = require('../integrations/checklistPorRegra');
const { CHECKLIST_LEI_14133, analisarPorChecklist } = require('../integrations/checklistRisco');
const mapa = require('../integrations/mapaRiscoContratos');
const ingestao = require('../integrations/ingestaoContratos');
const leituraPorRegra = require('../integrations/leituraPorRegra');

const COOPERACAO = { arquivoOrigem: 'F:\\P.A. 21.887_2023 - Cooperação - IFTEC\\3. Contratos, Aditivos e Termos\\Acordo de Cooperação - IFTEC.pdf', valor: 0 };

test('acordo de cooperação sem repasse: multa, reajuste, pagamento, garantia e matriz "não se aplica"; vigência e obrigações continuam', async () => {
  const instrumento = mapa.instrumentoDoContrato(COOPERACAO);
  assert.deepStrictEqual(instrumento, { cooperacao: true, semRepasse: true });
  const texto = 'ACORDO DE COOPERAÇÃO. CLÁUSULA SEGUNDA - DA VIGÊNCIA 2.1. O prazo de vigência deste acordo é de 24 (vinte e quatro) meses, podendo ser prorrogado mediante termo aditivo.';
  const r = await analisarPorChecklist({ documentos: [{ nome: 'Acordo.pdf', texto, leituraCompleta: true }], instrumento });
  const sit = id => r.checklist.find(c => c.id === id);
  for (const id of ['penalidades', 'reajuste', 'pagamento', 'garantia', 'matriz']) {
    assert.strictEqual(sit(id).situacao, 'nao_se_aplica', id);
    assert.match(sit(id).observacao || (id === 'matriz' ? 'art. 184' : ''), /art\. 184/);
  }
  assert.strictEqual(sit('vigencia').situacao, 'atende');
  assert.notStrictEqual(sit('obrigacoes').situacao, 'nao_se_aplica');
});

test('convênio COM repasse: os itens de dinheiro continuam sendo cobrados', () => {
  const instrumento = mapa.instrumentoDoContrato({ ...COOPERACAO, valor: 50000 });
  assert.deepStrictEqual(instrumento, { cooperacao: true, semRepasse: false });
  assert.strictEqual(regra.naoSeAplicaAoInstrumento({ id: 'pagamento' }, instrumento), false);
});

test('eixo Financeiro de cooperação sem repasse: "não se aplica" (antes: Médio por "valor não cadastrado")', () => {
  const db = { contratos: [], tratativas: [], aditivos: [], importacoesPendentes: [], alertaConfig: { critico: 15, atencao: 30, proximo: 90 } };
  const r = mapa.calcularRiscoPrazoFinanceiro(db, { id: 1, ...COOPERACAO, termino: null });
  assert.strictEqual(r.financeiro.nivel, null);
  assert.strictEqual(r.financeiro.naoSeAplica, true);
  assert.match(r.financeiro.motivos[0].texto, /não se aplica/);
});

test('contrato comum não é confundido com cooperação', () => {
  assert.deepStrictEqual(mapa.instrumentoDoContrato({ arquivoOrigem: 'F:\\P.A. 01.861_2024 - Atualização Datacenter - ATLAS\\Contrato Nº 061_2025.pdf', valor: 562494.58 }), { cooperacao: false, semRepasse: false });
});

test('arquivo principal: modelo em branco nunca é escolhido (002/2024)', () => {
  const { escolherArquivoPrincipal, ehModeloDeDocumento } = ingestao._paraTeste;
  const principal = escolherArquivoPrincipal([
    { nome: 'Termo de Encerramento Contrato Nº xx_xxxx.docx', totalCaracteres: 1614 },
    { nome: 'Ordem de inicio de serviços_Contrato XXX.docx', totalCaracteres: 798 },
    { nome: 'P.A 2794_2025 - Termo de Cooperação .pdf', totalCaracteres: 76364 }
  ]);
  assert.strictEqual(principal.nome, 'P.A 2794_2025 - Termo de Cooperação .pdf');
  assert.strictEqual(ehModeloDeDocumento('Contrato 066 - Anexo XX.pdf'), false, '"Anexo XX" é número romano');
  assert.strictEqual(ehModeloDeDocumento('Modelo de Proposta de Preços.docx'), true);
  // Termo de encerramento e ordem de início não são o instrumento, mesmo tendo "Contrato" no nome.
  assert.strictEqual(escolherArquivoPrincipal([
    { nome: 'Termo de Encerramento Contrato Nº 061_2025.pdf', totalCaracteres: 9000 },
    { nome: 'Contrato Nº 061_2025.pdf', totalCaracteres: 5000 }
  ]).nome, 'Contrato Nº 061_2025.pdf');
});

test('CNPJ da Prefeitura nunca é o da contratada, mesmo sem "Município" logo antes (061/2025)', () => {
  const texto = 'CONTRATO Nº 061/2025. ... inscrito no CNPJ sob o nº 11.256.774/0001-02, ... AURORA TECNOLOGIA LTDA, inscrita no CNPJ sob o nº 11.253.441/0001-11';
  assert.strictEqual(leituraPorRegra.lerCampos(texto).campos.cnpjEmpresa, '11.253.441/0001-11');
});

test('correção de cadastro ao subir o servidor: troca o modelo pelo documento certo e apaga o CNPJ da Prefeitura; idempotente', () => {
  const db = {
    contratos: [
      { id: 1, numero: '002/2024', arquivoOrigem: 'F:\\P\\4. Ordem\\Termo de Encerramento Contrato Nº xx_xxxx.docx', cnpjEmpresa: '11.256.774/0001-02' },
      { id: 2, numero: '010/2024', arquivoOrigem: 'F:\\P\\Contrato 010_2024 - Meridiano.pdf', cnpjEmpresa: '11.234.554/0001-70' }
    ],
    importacoesPendentes: [{ contratoId: 1, status: 'aprovado', aprovadoEm: '2026-09-20', campos: { cnpjEmpresa: '11.256.774/0001-02' }, arquivo: { caminho: 'F:\\P\\4. Ordem\\Termo de Encerramento Contrato Nº xx_xxxx.docx' },
      arquivosFonte: [
        { caminho: 'F:\\P\\4. Ordem\\Termo de Encerramento Contrato Nº xx_xxxx.docx', nome: 'Termo de Encerramento Contrato Nº xx_xxxx.docx', totalCaracteres: 1614 },
        { caminho: 'F:\\P\\15. PA Digitalizado\\P.A 2794_2025 - Termo de Cooperação .pdf', nome: 'P.A 2794_2025 - Termo de Cooperação .pdf', extensao: 'pdf', totalCaracteres: 76364 }
      ] }]
  };
  const r = ingestao.corrigirCadastrosConhecidos(db);
  assert.deepStrictEqual(r.map(x => x.campo), ['arquivo principal', 'CNPJ da empresa']);
  assert.match(db.contratos[0].arquivoOrigem, /Termo de Cooperação \.pdf$/);
  assert.strictEqual(db.contratos[0].cnpjEmpresa, null, 'sem texto guardado para reler: fica em branco, nunca o da Prefeitura');
  assert.strictEqual(db.importacoesPendentes[0].campos.cnpjEmpresa, null);
  assert.strictEqual(db.contratos[1].cnpjEmpresa, '11.234.554/0001-70', 'o que está certo não muda');
  assert.deepStrictEqual(ingestao.corrigirCadastrosConhecidos(db), [], 'segunda vez: nada a corrigir');
});

test('Painel e Mapa com o mesmo risco: riscoAtualDoContrato combina o conteúdo da última análise com prazo e financeiro de agora', () => {
  const emDias = n => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const db = {
    contratos: [{ id: 1, numero: '061/2025', valor: 562494.58, termino: emDias(-16), arquivoOrigem: 'F:\\x\\Contrato Nº 061_2025.pdf' }],
    tratativas: [], aditivos: [], importacoesPendentes: [], alertaConfig: { critico: 15, atencao: 30, proximo: 90 },
    mapasRisco: [{ id: 1, contratoId: 1, conteudo: { nivel: 'medio', findings: [{ nivel: 'medio', titulo: 'remissão a decreto' }] } }]
  };
  const r = mapa.riscoAtualDoContrato(db, db.contratos[0]);
  assert.strictEqual(r.nivel, 'alto', 'o pior dos eixos: prazo vencido');
  assert.strictEqual(r.parcial, false);
  assert.match(r.resumo, /Conteúdo Médio \(1 ponto/);
  assert.match(r.resumo, /Prazo Alto: Contrato vencido há 16 dia/);
  const semAnalise = mapa.riscoAtualDoContrato({ ...db, mapasRisco: [] }, db.contratos[0]);
  assert.strictEqual(semAnalise.parcial, true);
  assert.match(semAnalise.label, /\(parcial\)$/);
  assert.ok(r.pontos > semAnalise.pontos - 1000, 'pontos ordenam: o nível manda');
});

test('citação sem o cabeçalho de página que o OCR joga no meio da frase (064/2025)', () => {
  const t = '2.1. O prazo de vigência do contrato é de 24 (vinte e quatro) meses, podendo ser prorrogado, desde qué\njo a)\na”\n\n[página 2]\nPREFEITURA DE 1 ae\nITAVERDE | 55126:\n1h5t Geral do Município\nCIDADE QUE CUIDA DE TODOS.PÊ | |\ndevidamente justificado e autorizado expressamente.';
  const cit = regra._paraTeste.citacaoEmVolta(t, t.indexOf('O prazo'), null, 10);
  assert.strictEqual(cit, 'O prazo de vigência do contrato é de 24 (vinte e quatro) meses, podendo ser prorrogado, desde qué devidamente justificado e autorizado expressamente.');
  const t2 = 'Constituem motivos para a extinção os relacionados no art. 137 da Lei nº 14.133/2021.\n| 8\n\n[página 9]\nPRESGITURA DE Ste\nE) Procuradoria\nCLÁUSULA DÉCIMA TERCEIRA - DO FORO';
  assert.strictEqual(regra._paraTeste.citacaoEmVolta(t2, 0, null, 25), 'Constituem motivos para a extinção os relacionados no art. 137 da Lei nº 14.133/2021.', 'termina no fim da frase do achado');
});

test('objeto com "c" minúsculo no lugar de Ç (045/2022): conserto ao subir, sem inventar letra; empresa sem documento não muda', () => {
  const db = { contratos: [{ id: 1, numero: '045/2022', empresa: 'Tau Tecnologia Ltda',
    objeto: 'FORNECIMENTO DE SOLUcAO TECNOLOGICA PARA INSPEcAO DE INFORMAcOES' }], importacoesPendentes: [] };
  const r = ingestao.corrigirCadastrosConhecidos(db);
  assert.strictEqual(db.contratos[0].objeto, 'FORNECIMENTO DE SOLUÇÃO TECNOLOGICA PARA INSPEÇÃO DE INFORMAÇÕES');
  assert.strictEqual(db.contratos[0].empresa, 'Tau Tecnologia Ltda', 'sem documento com o nome certo, não mexe');
  assert.deepStrictEqual(r.map(x => x.campo), ['objeto']);
  assert.deepStrictEqual(ingestao.corrigirCadastrosConhecidos(db), [], 'segunda vez: nada');
});
