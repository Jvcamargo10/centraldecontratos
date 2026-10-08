/* ===================================================================
   testes/direcionamentoRequisicao.test.js

   "Onde está a resposta" (29/09/2026): os itens pedidos pelo TCE e a pasta
   do processo onde está cada resposta. Caso real: requisição DF-5.4
   nº 107/2020 (Vertex), com uma pasta de processo montada no temporário
   na mesma estrutura das da rede.
=================================================================== */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = require('../integrations/direcionamentoRequisicao');
const req = require('../integrations/requisicoes');

const REQUISICAO = `REQUISIÇÃO DE DOCUMENTOS DF-5.4 nº 107/2020
REF:
Contrato nº 058/2020 de 24/07/2020
Contratada: VERTEX TECNOLOGIA LTDA
Com a finalidade de instruir o processo nº TC-023162.989.20-6
(Acompanhamento de Execução Contratual), REQUISITAMOS as seguintes informações e documentos:
1) Encaminhar, em arquivos separados, todas as Notas de empenho e
medições atestadas desde o início do contrato, acompanhadas das notas fiscais,
notas de liquidação e comprovantes dos pagamentos;
2) Fornecer cópia dos controles de ocorrências verificadas na execução do contrato;
Finanças
Finanças
Finanças
[página 2]
5) Informar se foi realizado o treinamento, nos termos do item 13 do termo de
referência. Em caso positivo, fornecer relação com o nome dos servidores;
8) Fornecer os termos de recebimento provisório e definitivo;
9) Informar se foi aplicada sanção ou multa à Contratada.
PRAZO DE ENTREGA: 19/10/2020 (segunda-feira).
OBSERVAÇÕES:
I Os documentos devem estar no formato PDF;
DF-5.4, 09 de outubro de 2020.`;

let raiz, processo;
before(() => {
  raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'central-direcao-'));
  processo = path.join(raiz, '4. Processos Administrativos - Contratos Encerrados', 'P.A. 32.595_2019 - Replicação - VERTEX');
  const arq = (rel, nomes) => { const p = path.join(processo, rel); fs.mkdirSync(p, { recursive: true }); nomes.forEach(n => fs.writeFileSync(path.join(p, n), 'x')); };
  arq('1. Edital e Termo de Referência', ['Edital.pdf']);
  arq('4. Empenhos/2020', ['Empenho nº 16417.2020.pdf', 'Empenho nº 16418.2020.pdf']);
  arq('6. Notas Fiscais e BRSs/2021', ['NF 100.pdf']);
  arq('7. Liquidações', ['Liquidação 1.pdf']);
  arq('8. Outros Documentos', ['Ata.pdf']);
  arq('8. Outros Documentos/Treinamento', ['Lista de presença treinamento.pdf']);
  arq('8. Outros Documentos/Termo de Recebimento', ['TRP.pdf', 'TRD.pdf']);
  arq('8. Outros Documentos/Requisições TCE', ['Of. 96 2020 - Declaração Negativa de Sanção.docx']);
  arq('17. Pagamentos', []);
  fs.mkdirSync(path.join(raiz, '3. Processos Administrativos - Contratos em Vigência', 'P.A. 20.032_2019 - Locação de Computadores - TECLOC'), { recursive: true });
});
after(() => { fs.rmSync(raiz, { recursive: true, force: true }); });

test('itens pedidos: numeração do documento, sem o rodapé repetido nem as observações', () => {
  const itens = dir.lerItensPedidos(REQUISICAO);
  assert.deepStrictEqual(itens.map(i => i.numero), ['1', '2', '5', '8', '9']);
  assert.match(itens[0].texto, /^Encaminhar, em arquivos separados, todas as Notas de empenho/);
  assert.doesNotMatch(itens[1].texto, /Finanças/);
  assert.doesNotMatch(itens[4].texto, /PRAZO|formato PDF/);
});

test('cada item vai para a pasta do assunto; a específica ganha da genérica; citação do TR não vira pedido do edital', () => {
  const d = dir.direcionar(dir.lerItensPedidos(REQUISICAO), processo);
  const pastas = n => d.itens.find(i => i.numero === n).pastas.map(p => p.rel);
  for (const p of ['4. Empenhos', '6. Notas Fiscais e BRSs', '7. Liquidações', '17. Pagamentos']) assert.ok(pastas('1').includes(p), p);
  assert.ok(!pastas('1').includes('4. Empenhos/2020'), 'a subpasta do ano aparece dentro de "Empenhos", não como outra linha');
  assert.strictEqual(d.itens[0].pastas.find(p => p.rel === '17. Pagamentos').arquivos, 0, 'pasta vazia aparece, com 0 arquivos');
  assert.deepStrictEqual(pastas('5'), ['8. Outros Documentos/Treinamento'], 'sem "Outros Documentos" genérico e sem o Edital (o item só cita o TR)');
  assert.strictEqual(d.itens.find(i => i.numero === '5').manifestacao, true, '"Informar..." pede manifestação do gestor');
  assert.deepStrictEqual(pastas('8'), ['8. Outros Documentos/Termo de Recebimento']);
  const sancao = d.itens.find(i => i.numero === '9');
  assert.ok(sancao.arquivos.some(a => /Declaração Negativa de Sanção/.test(a.rel)), 'acha a resposta anterior pelo nome do arquivo');
});

test('processo: pelo nome da contratada; pelo contrato cadastrado com PA; nada quando não dá', () => {
  const processos = dir.listarProcessos([raiz]);
  assert.strictEqual(processos.length, 2);
  const p = dir.localizarProcesso({ contratos: [] }, processos, { contratada: 'VERTEX TECNOLOGIA LTDA' });
  assert.strictEqual(p.caminho, processo);
  assert.match(p.como, /contratada/);
  const q = dir.localizarProcesso({ contratos: [{ numero: '066/2020', pa: '20.032/2019' }] }, processos, { contrato: '066/2020' });
  assert.match(q.nome, /TECLOC/);
  assert.match(q.como, /contrato 066\/2020/);
  assert.strictEqual(dir.localizarProcesso({ contratos: [] }, processos, { contratada: 'EMPRESA INEXISTENTE LTDA' }), null);
});

test('análise de documento enviado: campos, data "DF-5.4, 09 de outubro de 2020", prazo, processo e direcionamento guardados; troca de processo', () => {
  const db = { contratos: [] };
  const a = req.analisarDocumento(db, { texto: REQUISICAO, nomeArquivo: 'Requisição 107.2020.pdf', usuario: 'Ana', raizes: [raiz] });
  assert.strictEqual(a.campos.requisicao, 'DF-5.4 nº 107/2020');
  assert.strictEqual(a.campos.data, '2020-10-09');
  assert.strictEqual(a.campos.prazo, '2020-10-19');
  assert.strictEqual(a.processo.caminho, processo);
  assert.strictEqual(a.itensPedidos.length, 5);
  assert.strictEqual(a.direcionamento.itens.length, 5);
  assert.strictEqual(db.requisicoesAnalisadas.length, 1);
  assert.throws(() => req.analisarDocumento(db, { texto: REQUISICAO, nomeArquivo: 'x.pdf', raizes: [raiz], caminhoProcesso: 'C:\\fora\\das\\pastas' }), /não encontrado/);
});
