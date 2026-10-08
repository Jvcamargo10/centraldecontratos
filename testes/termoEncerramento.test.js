/* ===================================================================
   testes/termoEncerramento.test.js

   Termo de encerramento (25/09/2026): achado na subpasta "20. Termo de
   Encerramento", vira PENDÊNCIA — o contrato só vira Encerrado quando
   alguém confirma. Textos reais do 072/2020 e do 066/2020.
=================================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const termo = require('../integrations/termoEncerramento');
const servidor = require('../integrations/servidorArquivos');
const pendencias = require('../integrations/pendenciasLeitura');

const T072 = 'TERMO DE ENCERRAMENTO DO CONTRATO INTRODUÇÃO O Termo de Encerramento do Contrato encerrará formalmente o pacto contratual entre a Contratante e a Contratada do contrato n° 072/2020, que finalizou em 28/09/2022, do Termo de Aditamento 156/2022, que finalizou em 28/09/2024, do Termo de Aditamento 197/2024, que finalizou em 29/09/2025. 1 – IDENTIFICAÇÃO Processo Adm. Nº.: 26.533/2018 ... 3 – TERMOS Por este instrumento, as partes acima identificadas resolvem registrar o encerramento do contrato em epígrafe. O contrato encerra-se por motivo de término do prazo de vigência.';
const T066 = 'Termo de Encerramento do Contrato Nº 066/2020 INTRODUÇÃO O presente Termo de Encerramento do Contrato tem por objetivo encerrar formalmente o pacto contratual firmado entre a Contratante e a Contratada, referente ao contrato n° 066/2020, cuja vigência encerrou-se em 06/08/2026.';
const MODELO = 'TERMO DE ENCERRAMENTO DO CONTRATO Nº XXX/XXXX INTRODUÇÃO Encerramento pelo término da vigência contratual entre a contratante e a contratada.';

test('termo do 072/2020: a data é a do ÚLTIMO período (29/09/2025), com o motivo e a frase', () => {
  const r = termo.lerTermo(T072, '072/2020');
  assert.strictEqual(r.data, '2025-09-29');
  assert.strictEqual(r.motivo, 'término do prazo de vigência');
  assert.match(r.citacao, /finalizou em 29\/09\/2025/);
});

test('termo do 066/2020: "cuja vigência encerrou-se em 06/08/2026"', () => {
  assert.strictEqual(termo.lerTermo(T066, '066/2020').data, '2026-08-06');
});

test('modelo em branco e termo de OUTRO contrato não contam', () => {
  assert.strictEqual(termo.lerTermo(MODELO, '072/2020'), null);
  assert.strictEqual(termo.lerTermo(T066, '072/2020'), null);
  assert.ok(termo.lerTermo(T066.replace('066/2020', '66/20'), '066/2020'), '"66/20" também é o 066/2020');
});

test('pasta: acha o termo em "20. Termo de Encerramento" do processo, sem modelo, e prefere o .docx ao .pdf de mesmo nome', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'setec-encerramento-'));
  const proc = path.join(raiz, 'P.A. 26.533_2018 - Cofre de senhas - SIGMA');
  const arquivos = [
    '3. Contratos, Aditivos e Termos/Contrato 072_2020.pdf',
    '20. Termo de Encerramento/Termo de Encerramento Contrato Nº 072_2020.docx',
    '20. Termo de Encerramento/Termo de Encerramento Contrato Nº 072_2020.pdf',
    '4. Ordem de Início de Serviço/Termo de Encerramento Contrato Nº xx_xxxx.docx',
    '20. Termo de Encerramento/Modelo de Termo de Encerramento.docx'
  ];
  for (const rel of arquivos) { const c = path.join(proc, rel); fs.mkdirSync(path.dirname(c), { recursive: true }); fs.writeFileSync(c, 'x'); }
  const antes = { pastas: servidor._config.pastas, sub: servidor._config.subpastaContratos };
  servidor._config.pastas = [raiz]; servidor._config.subpastaContratos = 'contratos, aditivos e termos';
  try {
    const achados = servidor.documentosDeEncerramento(path.join(proc, '3. Contratos, Aditivos e Termos'));
    assert.deepStrictEqual(achados.map(c => path.basename(c)), ['Termo de Encerramento Contrato Nº 072_2020.docx']);
  } finally { servidor._config.pastas = antes.pastas; servidor._config.subpastaContratos = antes.sub; }
});

function dbComTermo() {
  return {
    contratos: [{ id: 7, numero: '072/2020', empresa: 'SIGMA', status: 'Ativo', termino: '2025-09-29',
      encerramentoDetectado: { arquivo: 'Termo de Encerramento Contrato Nº 072_2020.docx', caminho: 'F:\\x\\20. Termo\\t.docx', assinatura: '10:20', data: '2025-09-29', motivo: 'término do prazo de vigência', citacao: '... que finalizou em 29/09/2025.' } }],
    importacoesPendentes: []
  };
}

test('pendência: aparece em Pendências de leitura sem mudar o cadastro', () => {
  const db = dbComTermo();
  const r = pendencias.resumir(db);
  assert.strictEqual(r.encerramentos.length, 1);
  assert.strictEqual(r.encerramentos[0].data, '2025-09-29');
  assert.strictEqual(db.contratos[0].status, 'Ativo', 'achar o termo não encerra o contrato');
});

test('confirmar: o contrato vira Encerrado, com data, motivo, arquivo e quem confirmou', () => {
  const db = dbComTermo();
  pendencias.decidirEncerramento(db, 7, 'confirmar', 'Gestora');
  const c = db.contratos[0];
  assert.strictEqual(c.status, 'Encerrado');
  assert.strictEqual(c.dataEncerramento, '2025-09-29');
  assert.strictEqual(c.encerramento.confirmadoPor, 'Gestora');
  assert.strictEqual(c.encerramento.arquivo, 'Termo de Encerramento Contrato Nº 072_2020.docx');
  assert.strictEqual(c.encerramentoDetectado, undefined);
  assert.strictEqual(pendencias.resumir(db).encerramentos.length, 0);
});

test('descartar: o cadastro não muda e o mesmo arquivo não volta a ser sugerido', () => {
  const db = dbComTermo();
  pendencias.decidirEncerramento(db, 7, 'descartar', 'Gestora');
  const c = db.contratos[0];
  assert.strictEqual(c.status, 'Ativo');
  assert.deepStrictEqual({ caminho: c.encerramentoDescartado.caminho, assinatura: c.encerramentoDescartado.assinatura }, { caminho: 'F:\\x\\20. Termo\\t.docx', assinatura: '10:20' });
  assert.throws(() => pendencias.decidirEncerramento(db, 7, 'confirmar', 'X'), /Não há termo/);
});
