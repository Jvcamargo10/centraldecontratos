/* ===================================================================
   testes/requisicoes.test.js

   Requisições lidas dos documentos (29/09/2026): os layouts reais do
   SisFin (RC e AD, nas variações achadas na pasta) e os documentos do
   TCE-SP (requisição de documentos, ofício de resposta, relatório de
   fiscalização). Trechos reduzidos, sem nome de pessoa.
=================================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const req = require('../integrations/requisicoes');
const { mascararCpf } = require('../integrations/mascaraDados');

const RC_LINHA_DE_BAIXO = `PREFEITURA MUNICIPAL DE ITAVERDE
REQUISIÇÃO DE SERVIÇOS
Página: 1 /3
Requisição RC: Data da Requisição:
Nro Integração:
1414/2022 18/10/2022
20201414
Unidade Administrativa Requisitante:
001.016.000.000.000 - - SEC MUNICIPAL DE TECNOLOGIA
Nro Processo: 7622 / 2022
Usuário Cadastro: FULANO
Valor Mensal Valor Estimado	Quantidade	Unidade	Serviço	Item
23,000	SER 2.188.296,6659	1 95.143,3333	7.03.97.0003-5
OPERAÇÃO ASSISETECA
60,000	MÊS 9.000.000,00	2 150.000,0000	7.03.20.0006-2
Serviço de Disponibilidade Operacional
Estimativa de Custo Total 11.188.296,6659	Tipo de Custo Plurianual
Dotação 2023 - 3684 Vínculo:01.110.0000
3.3.90.40.00
Valor a ser reservado R$ 3.090.514,67
3.3.90.40.00
Valor a ser reservado R$ -1.077.514,67
Iniciativa estratégica: 18.0735 Plataforma de Segurança`;

const RC_TRES_LINHAS = `REQUISIÇÃO DE SERVIÇOS
Requisição RC: 2022/2025 Data Requisição: 31/07/2025
Nro Integração: 20202022 Nro Processo: 1274 / 2025
Item Serviço Unidade Quantidade Valor Mensal Valor Estimado
1 7.03.14.0021-0
Serviços de Implantação
UN 325,000 18.525,3846 6.020.750,00
2 7.03.19.0002-7
Serviços Recorrentes de Operação
UN 6.575,000 1.060,0000 6.969.500,00
Tipo de Custo Plurianual Estimativa de Custo Total 12.990.250,00
Valor a ser reservado R$ 4.023.076,92`;

const AD = `Prefeitura Municipal de Itaverde Processo nº________________
ALTERAÇÃO CONTRATUAL 	Servidor___________________
Requisição AD:6/2023 	Data da Requisição: 05/01/2023 	Usuário Cadastro: FULANO
Nro Processo: 17359/2016 	Aprovado/Liberado para Reserva
Licitação: PREGÃO PRESENCIAL - 5 / 2017
Fornecedor: 00.000.000/0001-91 	EMPRESA DE TELECOMUNICAÇÕES S.A.
AF/OS: 6/2017
Nro Integração: 40200009
Dotação: 2023 - 3692 Vínculo: 01.110.0000 	Elemento da Despesa: 33904000
Material 	Unidade 	Tipo Alteração 	Quantidade 	Valor 	Valor Total
7.15.99.0008-2 	Serviço 	Renovação Contratual 	12,000 	728.175,0700 	8.738.100,84
CONTRATAÇÃO DE EMPRESA DE TELECOMUNICAÇÕES
Valor Total Reservado do Requisitante: 	R$ 8.135.858,70
Valor Total do Requisitante: 	R$ 8.738.100,84
Valor Total Reservado:
Valor Total:
R$ 8.135.858,70
R$ 8.738.100,84
MCR22501 - Granito Tecnologia Ltda. 	FULANO - FULANO DE TAL 	09/01/2024 15:04:20
Período 	2023 	Empenho
Janeiro 	R$ 	0,00
Março 	R$ 	728.175,07
Total 	R$ 	7.281.750,70`;

test('SisFin RC com o número na linha de baixo: número, data, integração, processo, itens (unidade "MÊS"), total e reserva somada', () => {
  const r = req.lerRequisicaoSisfin(RC_LINHA_DE_BAIXO);
  const c = r.campos;
  assert.strictEqual(c.codigo, 'RC');
  assert.strictEqual(c.numero, '1414/2022');
  assert.strictEqual(c.data, '2022-10-18');
  assert.strictEqual(c.integracao, '20201414');
  assert.strictEqual(c.processo, '07.622/2022');
  assert.strictEqual(c.valorTotal, 11188296.67);
  assert.strictEqual(c.valorReservado, 2013000);
  assert.strictEqual(r.itens.length, 2, 'o item em "MÊS" também');
  assert.strictEqual(r.itens[1].unidade, 'MÊS');
  assert.strictEqual(r.itens[0].descricao, 'OPERAÇÃO ASSISETECA');
  assert.doesNotMatch(JSON.stringify(r.evidencias), /FULANO/, 'o login de quem cadastrou não vai para a prova');
});

test('SisFin RC com número na mesma linha e item em três linhas', () => {
  const r = req.lerRequisicaoSisfin(RC_TRES_LINHAS);
  assert.strictEqual(r.campos.numero, '2022/2025');
  assert.strictEqual(r.campos.data, '2025-07-31');
  assert.deepStrictEqual(r.itens.map(i => [i.codigo, i.quantidade, i.valorEstimado]), [['7.03.14.0021-0', 325, 6020750], ['7.03.19.0002-7', 6575, 6969500]]);
  assert.strictEqual(r.itens[0].descricao, 'Serviços de Implantação');
  assert.strictEqual(r.campos.valorTotal, 12990250);
});

test('SisFin AD: fornecedor, licitação, AF/OS, situação, e o "Valor Total:" que não pega o reservado da linha de baixo', () => {
  const r = req.lerRequisicaoSisfin(AD);
  const c = r.campos;
  assert.strictEqual(c.codigo, 'AD');
  assert.strictEqual(c.numero, '6/2023');
  assert.strictEqual(c.processo, '17.359/2016');
  assert.strictEqual(c.fornecedorCnpj, '00.000.000/0001-91');
  assert.strictEqual(c.licitacao, 'PREGÃO PRESENCIAL - 5/2017');
  assert.strictEqual(c.afOs, '6/2017');
  assert.strictEqual(c.situacao, 'Aprovado/Liberado para Reserva');
  assert.strictEqual(c.valorTotal, 8738100.84);
  assert.strictEqual(c.valorReservado, 8135858.7);
  assert.strictEqual(c.emitidoEm, '2024-01-09T15:04:20');
  assert.strictEqual(r.itens[0].tipoAlteracao, 'Renovação Contratual');
  assert.strictEqual(r.programacao[0].ano, 2023);
  assert.strictEqual(r.programacao[0].total, 7281750.7);
});

test('texto que não é requisição do SisFin: null', () => {
  assert.strictEqual(req.lerRequisicaoSisfin('NOTA DE EMPENHO nº 123/2024'), null);
});

const TCE_REQUISICAO = `REQUISIÇÃO DE DOCUMENTOS DF-5.4 nº 107/2020
À
PREFEITURA MUNICIPAL DE ITAVERDE
REF:
Contrato nº 058/2020 de 24/07/2020
Contratada: EMPRESA DE TECNOLOGIA EIRELI
Com a finalidade de instruir o processo nº TC-023162.989.20-6
(Acompanhamento de Execução Contratual), REQUISITAMOS as seguintes informações`;

const TCE_OFICIO = `Ofício STI/SF nº 87/2021
Itaverde, 28 de junho de 2021
À Controladoria Geral do Município
Referente: Processo e-TCE nº 9175.989.20-1. - 3° Acompanhamento da execução contratual.
Em resposta ao processo e-TCE nº 9175.989.20-1 expedido pela 7ª Diretoria de Fiscalização do Tribunal de Contas do Estado de São Paulo, no que se refere ao Contrato nº 120/2019, apresentamos...`;

const TCE_RELATORIO = `TC-025938.989.20-9
TRIBUNAL DE CONTAS DO ESTADO DE SÃO PAULO
5ª DIRETORIA DE FISCALIZAÇÃO – DF-5.1
EXAME TERMO ADITIVO
2. CONTRATO Nº 14/2018 de 01/03/2018, Evento 1.20 do TC-
0012823.989.18-1`;

test('TCE: requisição de documentos — nº, TC do acompanhamento, contrato e contratada', () => {
  const c = req.lerDocumentoTce(TCE_REQUISICAO, 'Requisição TCE.SP 107.2020 - Execução I.pdf').campos;
  assert.strictEqual(c.tipo, 'Requisição de documentos');
  assert.strictEqual(c.requisicao, 'DF-5.4 nº 107/2020');
  assert.strictEqual(c.tc, '023162.989.20-6');
  assert.strictEqual(c.contrato, '058/2020');
  assert.strictEqual(c.contratada, 'EMPRESA DE TECNOLOGIA EIRELI');
});

test('TCE: ofício de resposta — ofício, data por extenso, e-TCE, nº da requisição pelo nome do arquivo', () => {
  const c = req.lerDocumentoTce(TCE_OFICIO, 'Of. 087 2021 - Req 37 2021 - Resposta requisição TCE_SP.docx').campos;
  assert.strictEqual(c.tipo, 'Ofício de resposta');
  assert.strictEqual(c.oficio, 'STI/SF nº 87/2021');
  assert.strictEqual(c.data, '2021-06-28');
  assert.strictEqual(c.tc, '009175.989.20-1');
  assert.strictEqual(c.requisicao, 'nº 37/2021');
  assert.strictEqual(c.contrato, '120/2019');
});

test('TCE: o TC do próprio documento (no topo) vale mais que o TC do contrato citado', () => {
  const c = req.lerDocumentoTce(TCE_RELATORIO, 'TC-025938.989.20-9 - PM Itaverde - TA 151-2020.pdf').campos;
  assert.strictEqual(c.tipo, 'Relatório de fiscalização');
  assert.strictEqual(c.tc, '025938.989.20-9');
  assert.ok(c.outrosTcs.includes('012823.989.18-1'));
  assert.strictEqual(c.contrato, '014/2018');
});

test('TCE: data do contrato, da vigência e o prazo de entrega não viram a data da requisição (107/2020)', () => {
  const texto = `${TCE_REQUISICAO}\nVigência: 23/07/2020 a 22/07/2021\nPRAZO DE ENTREGA: 19/10/2020 (segunda-feira).`;
  const c = req.lerDocumentoTce(texto, 'Requisição TCE.SP 107.2020.pdf').campos;
  assert.strictEqual(c.data, null, 'sem data própria no texto: quem confere preenche');
  assert.strictEqual(c.prazo, '2020-10-19');
  assert.match(req.fichaSgc({ campos: c, nome: 'x.pdf' }).observacoes, /prazo de entrega 19\/10\/2020/);
});

test('TCE: anexo que não cita o Tribunal (relatório de instalação) fica de fora', () => {
  assert.strictEqual(req.lerDocumentoTce('RELATÓRIO DE INSTALAÇÃO\nCentro Comunitário — ponto de acesso instalado.', '263 - SAS - CENTRO COMUNITÁRIO.pdf'), null);
});

test('máscara de CPF não apaga o número do processo do TCE, e continua apagando CPF', () => {
  assert.strictEqual(mascararCpf('TC-025938.989.20-9 TRIBUNAL'), 'TC-025938.989.20-9 TRIBUNAL');
  assert.strictEqual(mascararCpf('Resposta a IC 007818.989.20-4'), 'Resposta a IC 007818.989.20-4');
  assert.strictEqual(mascararCpf('CPF 123.456.789-01'), 'CPF [CPF removido]');
  assert.strictEqual(mascararCpf('portador do 123.456.789-01.'), 'portador do [CPF removido].');
});

function dbDeTeste() {
  const doc = (id, origem, nome, campos, extra = {}) => ({ id, origem, nome, caminho: `F:\\P.A. 17.359_2016 - X\\${nome}`, pa: '17.359/2016', categoria: 'encerrado', campos, itens: [], programacao: [], evidencias: {}, ...extra });
  return {
    contratos: [{ id: 7, numero: '014/2018', pa: '17.359/2016', empresa: 'EMPRESA' }],
    requisicoesLidas: [
      doc(1, 'sisfin', 'Requisição PA17359_2016.pdf', { codigo: 'AD', numero: '6/2023', data: '2023-01-05', emitidoEm: null, valorTotal: 1 }),
      doc(2, 'sisfin', 'RQ_empenho_2024_PA17359_2016.pdf', { codigo: 'AD', numero: '6/2023', data: '2023-01-05', emitidoEm: '2024-01-09T15:04:20', valorTotal: 2 }),
      doc(3, 'tce', 'Requisição TCE.SP 107.2020.pdf', { tipo: 'Requisição de documentos', requisicao: 'DF-5.4 nº 107/2020', tc: '023162.989.20-6', data: '2020-09-01', contrato: '014/2018' }),
      doc(4, 'tce', 'Of. 97 2020.docx', { tipo: 'Ofício de resposta', requisicao: 'nº 107/2020', tc: '023162.989.20-6', oficio: 'STI/SF nº 97/2020', data: '2020-10-15', protocolo: '202003142749' })
    ]
  };
}

test('grupos: versões do SisFin juntas (vale a impressa por último); requisição do TCE com a resposta; contrato pelo PA', () => {
  const l = req.listar(dbDeTeste());
  assert.strictEqual(l.sisfin.length, 1);
  assert.strictEqual(l.sisfin[0].campos.valorTotal, 2, 'a versão reimpressa em 2024');
  assert.strictEqual(l.sisfin[0].documentos.length, 2);
  assert.strictEqual(l.sisfin[0].contrato.numero, '014/2018');
  assert.strictEqual(l.tce.length, 1);
  const f = l.tce[0].ficha;
  assert.strictEqual(f.requisicao, 'DF-5.4 nº 107/2020');
  assert.strictEqual(f.data, '2020-09-01', 'a data da requisição, não a da resposta');
  assert.strictEqual(f.oficio, '202003142749', 'no SGC, "Ofício" é o protocolo digital');
  assert.strictEqual(f.contrato, '014/2018');
});

test('conferência: corrige campo, valida data, descarta e reabre', () => {
  const db = dbDeTeste();
  const chave = req.listar(db).tce[0].chave;
  assert.throws(() => req.conferir(db, chave, { acao: 'conferir', campos: { data: '15/10/2020' } }, 'Ana'), /Data inválida/);
  req.conferir(db, chave, { acao: 'conferir', campos: { contrato: '058/2020', observacoes: 'Execução contratual' } }, 'Ana');
  let g = req.listar(db).tce[0];
  assert.strictEqual(g.status, 'conferida');
  assert.strictEqual(g.ficha.contrato, '058/2020', 'o contrato corrigido vale mais do que o do PA');
  assert.strictEqual(g.ficha.observacoes, 'Execução contratual');
  assert.strictEqual(g.conferidoPor, 'Ana');
  req.conferir(db, chave, { acao: 'descartar' }, 'Ana');
  assert.strictEqual(req.listar(db).tce[0].status, 'descartada');
  assert.ok(!req.gerarCsv(db, 'tce').includes('107/2020'), 'descartada não vai para a planilha');
  req.conferir(db, chave, { acao: 'reabrir' }, 'Ana');
  assert.strictEqual(req.listar(db).tce[0].status, 'lida');
  assert.throws(() => req.conferir(db, 'nao-existe', { acao: 'conferir' }, 'Ana'), /não encontrada/);
});

test('conferência do SisFin: valor do campo numérico ("1409102.64") e digitado ("1.409.102,64")', () => {
  const db = dbDeTeste();
  const chave = req.listar(db).sisfin[0].chave;
  req.conferir(db, chave, { acao: 'conferir', campos: { valorTotal: '1409102.64', valorReservado: '1.095.968,72' } }, 'Ana');
  const g = req.listar(db).sisfin[0];
  assert.strictEqual(g.camposConferidos.valorTotal, 1409102.64);
  assert.strictEqual(g.camposConferidos.valorReservado, 1095968.72);
  assert.throws(() => req.conferir(db, chave, { acao: 'conferir', campos: { valorTotal: 'mil' } }, 'Ana'), /Valor inválido/);
});

test('planilha do SisFin no formato do Excel em português', () => {
  const csv = req.gerarCsv(dbDeTeste(), 'sisfin');
  assert.ok(csv.startsWith('\ufeffRequisição;Tipo;Data'));
  assert.match(csv, /AD 6\/2023;;05\/01\/2023;17\.359\/2016;014\/2018/);
});
