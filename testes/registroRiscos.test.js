/* ===================================================================
   testes/registroRiscos.test.js

   Registro de riscos no modelo da planilha do SGC e os riscos
   automáticos da legislação de contratos.

   O que se protege:
     - a METODOLOGIA da planilha: criticidade = P × I e o critério de
       aceitação exatamente como a fórmula da coluna R;
     - cada regra automática dispara na situação dela, com fundamento
       legal — e NÃO dispara sem o dado (nada de risco inventado);
     - validação do registro manual pelas listas da planilha.
=================================================================== */

const { test } = require('node:test');
const assert = require('node:assert');
const r = require('../integrations/registroRiscos');
const { validarRisco, validarIssue } = r._paraTeste;

const HOJE = '2026-09-23';
const codigos = lista => lista.map(x => x.codigo);

/* ---------------- Metodologia da planilha ---------------- */

test('criticidade é probabilidade × impacto, só com P e I de 1 a 5', () => {
  assert.strictEqual(r.criticidade(4, 5), 20);
  assert.strictEqual(r.criticidade(1, 1), 1);
  assert.strictEqual(r.criticidade(0, 5), 0, 'fora da escala não calcula');
  assert.strictEqual(r.criticidade(6, 5), 0, 'a planilha não limita a 5; aqui é limitado');
});

test('critério de aceitação igual à fórmula da coluna R, em todos os produtos possíveis', () => {
  // =IF(Q=0,"defina P e I",IF(Q<3,"Registrar",IF(8<=Q<15,"MITIGAR",IF(2<Q<=6,"ACEITAR MONITORAR","EVITAR"))))
  const planilha = q => q === 0 ? null : q < 3 ? 'Registrar' : (q >= 8 && q < 15) ? 'Mitigar' : (q > 2 && q <= 6) ? 'Aceitar e monitorar' : 'Evitar';
  for (let p = 1; p <= 5; p++) for (let i = 1; i <= 5; i++) {
    assert.strictEqual(r.criterioDeAceitacao(p * i), planilha(p * i), `P ${p} × I ${i}`);
  }
  assert.strictEqual(r.criterioDeAceitacao(0), null);
});

test('faixas de cor: verde até 2, amarelo até 6, vermelho até 14, crítico de 15 em diante', () => {
  assert.deepStrictEqual([2, 3, 6, 8, 12, 15, 25].map(r.faixaDeCriticidade), ['baixa', 'moderada', 'moderada', 'alta', 'alta', 'critica', 'critica']);
});

/* ---------------- Regime legal ---------------- */

test('regime legal: pela lei citada no texto; sem citação, pela data de início', () => {
  assert.deepStrictEqual(r.regimeLegal('nos termos da Lei Federal nº 8.666/1993', '2020-01-01'), { lei: '8.666', presumido: false });
  assert.deepStrictEqual(r.regimeLegal('Lei nº 14.133, de 1º de abril de 2021', '2025-01-01'), { lei: '14.133', presumido: false });
  assert.deepStrictEqual(r.regimeLegal('texto sem lei', '2022-05-01'), { lei: '8.666', presumido: true });
  assert.deepStrictEqual(r.regimeLegal('texto sem lei', '2025-05-01'), { lei: '14.133', presumido: true });
  // Contrato antigo cujo termo recente cita a lei nova: vale a do contrato.
  assert.strictEqual(r.regimeLegal('8.666 ... 14.133', '2020-08-07').lei, '8.666');
});

/* ---------------- Regras automáticas ---------------- */

test('vencido: 5 × 5, Evitar', () => {
  const x = r.riscosAutomaticos({ contrato: { id: 1, termino: '2026-08-06', responsavel: 'A B', suplente: 'C D' }, hoje: HOJE });
  const v = x.find(a => a.codigo === 'VENCIMENTO');
  assert.strictEqual(v.criticidade, 25);
  assert.strictEqual(v.criterio, 'Evitar');
  assert.match(v.titulo, /vencido há 48 dia/);
  assert.ok(v.fundamento.includes('14.133'));
});

test('sem término, a regra de vencimento NÃO dispara — dispara a de vigência não comprovada', () => {
  /* Até 23/09/2026 a aprovação gravava "hoje" como término e isto virava
     "vence hoje" em 17 contratos. */
  const x = r.riscosAutomaticos({ contrato: { id: 1, termino: null, responsavel: 'A B', suplente: 'C D' }, hoje: HOJE });
  assert.ok(!codigos(x).includes('VENCIMENTO'));
  assert.ok(codigos(x).includes('VIGENCIA_NAO_COMPROVADA'));
});

test('Lei 8.666: 72 meses esgotam o limite, mesmo sem a palavra "excepcional"', () => {
  const x = r.riscosAutomaticos({
    contrato: { id: 1, inicio: '2020-08-07', termino: '2027-08-06', responsavel: 'A B', suplente: 'C D' },
    proposta: { id: 1, calculoVigencia: { mesesTotal: 72, termino: '2027-08-06', avisos: [] }, regimeLegal: { lei: '8.666', presumido: false } },
    hoje: HOJE
  });
  const l = x.find(a => a.codigo === 'LIMITE_VIGENCIA');
  assert.strictEqual(l.criticidade, 25);
  assert.match(l.titulo, /esgotado/);
});

test('Lei 8.666: 60 meses deixam só a excepcional; 48 meses já avisam', () => {
  const com = meses => r.riscosAutomaticos({
    contrato: { id: 1, inicio: '2020-01-01', termino: '2027-12-31', responsavel: 'A B', suplente: 'C D' },
    proposta: { id: 1, calculoVigencia: { mesesTotal: meses, termino: '2027-12-31', avisos: [] }, regimeLegal: { lei: '8.666' } },
    hoje: HOJE
  }).find(a => a.codigo === 'LIMITE_VIGENCIA');
  assert.match(com(60).titulo, /só resta a prorrogação excepcional/);
  assert.match(com(48).titulo, /Próximo do limite/);
  assert.strictEqual(com(36), undefined);
});

test('Lei 14.133: limite de 10 anos', () => {
  const l = r.riscosAutomaticos({
    contrato: { id: 1, inicio: '2024-02-01', termino: '2034-02-01', responsavel: 'A B', suplente: 'C D' },
    proposta: { id: 1, calculoVigencia: { mesesTotal: 120, termino: '2034-02-01', avisos: [] }, regimeLegal: { lei: '14.133' } },
    hoje: HOJE
  }).find(a => a.codigo === 'LIMITE_VIGENCIA');
  assert.match(l.fundamento, /arts\. 106 e 107/);
});

test('acréscimos: acima de 25% é Evitar; supressão não compensa acréscimo', () => {
  const base = acrescimos => r.riscosAutomaticos({
    contrato: { id: 1, termino: '2028-01-01', responsavel: 'A B', suplente: 'C D' },
    proposta: { id: 1, calculoValor: { valorInicial: 1000000 }, calculoVigencia: { termino: '2028-01-01', avisos: [] } },
    termos: acrescimos, hoje: HOJE
  }).find(a => a.codigo === 'LIMITE_ACRESCIMO');
  const acima = base([{ natureza: 'acréscimo', valor: 300000, numero: '1/2024' }, { natureza: 'supressão', valor: -200000, numero: '2/2024' }]);
  assert.strictEqual(acima.criterio, 'Evitar');
  assert.match(acima.titulo, /30\.0%/);
  assert.strictEqual(base([{ natureza: 'acréscimo', valor: 100000, numero: '1/2024' }]), undefined, '10% não é risco');
});

test('gestor e suplente: nome mascarado do SGC conta como ausente', () => {
  const semGestor = r.riscosAutomaticos({ contrato: { id: 1, termino: '2028-01-01', responsavel: '***********' }, hoje: HOJE });
  assert.ok(codigos(semGestor).includes('SEM_GESTOR'));
  const semSuplente = r.riscosAutomaticos({ contrato: { id: 1, termino: '2028-01-01', responsavel: 'Ana Paula Souza', suplente: '' }, hoje: HOJE });
  assert.ok(codigos(semSuplente).includes('SEM_SUPLENTE'));
});

test('reajuste: termo sem data conta pelo ano do número; avisa no aniversário e sobe com o tempo', () => {
  const com = (termos, inicio) => r.riscosAutomaticos({
    contrato: { id: 1, inicio, termino: '2028-01-01', responsavel: 'A B', suplente: 'C D', valor: 1000 }, termos, hoje: HOJE
  }).find(a => a.codigo === 'REAJUSTE');
  assert.match(com([{ natureza: 'reajuste', numero: '240/2021', data: null }], '2020-08-07').descricao, /31\/12\/2021/);
  assert.strictEqual(com([{ natureza: 'reajuste', numero: '10/2026', data: '2026-01-01' }], '2020-08-07'), undefined, 'menos de 12 meses: nada');
  const aniversario = com([{ natureza: 'reajuste', numero: '10/2025', data: '2025-06-01' }], '2020-08-07');
  assert.match(aniversario.titulo, /Aniversário do contrato passou/);
  assert.strictEqual(aniversario.criterio, 'Aceitar e monitorar', '12 a 23 meses: peso baixo');
  assert.strictEqual(com([], '2022-01-01').criterio, 'Mitigar', '36 meses ou mais sem reajuste: Mitigar');
  // Acordo de cooperação sem repasse: não há o que reajustar.
  assert.strictEqual(r.riscosAutomaticos({ contrato: { id: 1, inicio: '2020-01-01', termino: '2028-01-01', responsavel: 'A B', suplente: 'C D', arquivoOrigem: 'F:\\P.A. x - Cooperação - IFTEC\\Acordo de Cooperação.pdf', valor: 0 }, hoje: HOJE }).find(a => a.codigo === 'REAJUSTE'), undefined);
});

test('concentração de fornecedor: 3 contratos ativos com o mesmo CNPJ', () => {
  const cnpj = '11.222.333/0001-81';
  const contratos = [1, 2, 3].map(id => ({ id, cnpjEmpresa: cnpj, valor: 1000, status: 'Ativo' })).concat([{ id: 4, cnpjEmpresa: '99.999.999/0001-99', valor: 100000, status: 'Ativo' }]);
  const x = r.riscosAutomaticos({ contrato: { ...contratos[0], termino: '2028-01-01', responsavel: 'A B', suplente: 'C D' }, contratos, hoje: HOJE });
  assert.ok(codigos(x).includes('CONCENTRACAO'));
});

test('cláusula obrigatória ausente no checklist vira risco de conformidade', () => {
  const mapa = { geradoEm: '2026-09-21T10:00:00Z', checklist: [
    { id: 'garantia', item: 'Garantia de execução', obrigatorio: true, situacao: 'nao_localizado', referencia: 'Lei 14.133/2021, art. 92, XII' },
    { id: 'matriz', item: 'Matriz de riscos', obrigatorio: false, situacao: 'nao_se_aplica' }
  ] };
  const x = r.riscosAutomaticos({ contrato: { id: 1, termino: '2028-01-01', responsavel: 'A B', suplente: 'C D', preposto: 'E F', valor: 1000 }, mapa, hoje: HOJE });
  assert.deepStrictEqual(codigos(x), ['CHECKLIST_GARANTIA']);
});

test('contrato sem nada a apontar não tem risco automático', () => {
  const x = r.riscosAutomaticos({
    // Menos de 12 meses de contrato: o reajuste ainda não é devido.
    contrato: { id: 1, inicio: '2026-01-01', termino: '2028-01-01', responsavel: 'Ana Paula Souza', suplente: 'Carlos Lima', preposto: 'Renata Valadares', cnpjEmpresa: '11.222.333/0001-81', valor: 1000 },
    proposta: { id: 1, calculoVigencia: { mesesTotal: 36, termino: '2028-01-01', avisos: [] }, regimeLegal: { lei: '14.133' } },
    contratos: [{ id: 1, cnpjEmpresa: '11.222.333/0001-81', valor: 1000 }, { id: 2, cnpjEmpresa: '9', valor: 99999 }],
    hoje: HOJE
  });
  assert.deepStrictEqual(x, []);
});

/* ---------------- Registro manual ---------------- */

test('risco manual: valida pelas listas da planilha e calcula criticidade e critério', () => {
  const ok = validarRisco({ descricao: 'Queda do link', tipo: 'Tecnologia', classificacao: 'Interna', categoria: 'Infraestrutura', probabilidade: '4', impacto: '3' });
  assert.strictEqual(ok.criticidade, 12);
  assert.strictEqual(ok.criterio, 'Mitigar');
  assert.throws(() => validarRisco({ descricao: 'x', probabilidade: 6, impacto: 1 }), /1 a 5/);
  assert.throws(() => validarRisco({ descricao: 'x', tipo: 'Inventado', probabilidade: 1, impacto: 1 }), /Tipo/);
  assert.throws(() => validarRisco({ descricao: 'x', classificacao: 'Externa', categoria: 'Pessoal', probabilidade: 1, impacto: 1 }), /não pertence/);
  assert.throws(() => validarRisco({ probabilidade: 1, impacto: 1 }), /Descreva/);
});

test('problema: duração calculada como na coluna "Vigência do Problema"', () => {
  const i = validarIssue({ titulo: 'Atraso na entrega', dataCriacao: '2026-09-01', dataEncerramento: '2026-09-11' });
  assert.strictEqual(i.duracaoDias, 10);
  assert.throws(() => validarIssue({ titulo: 'x', dataCriacao: '2026-09-11', dataEncerramento: '2026-09-01' }), /anterior/);
  assert.throws(() => validarIssue({}), /título/);
});

test('registrar, tratar risco automático e montar o registro do contrato', () => {
  const db = { contratos: [{ id: 5, numero: '066/2020', termino: '2026-08-06', responsavel: 'A B', suplente: 'C D' }], importacoesPendentes: [], aditivos: [], apostilamentos: [] };
  r.registrar(db, 5, 'risco', { descricao: 'Queda do link', probabilidade: 2, impacto: 2 }, 'Fulano');
  r.registrar(db, 5, 'risco', { codigoAutomatico: 'VENCIMENTO', descricao: 'Vencido', probabilidade: 5, impacto: 5, resposta: 'Nova licitação em andamento', responsavel: 'Fulano' }, 'Fulano');
  r.registrar(db, 5, 'issue', { titulo: 'Serviço sem cobertura', status: 'Em progresso', prioridade: 'Alta' }, 'Fulano');
  const reg = r.montarRegistro(db, 5, HOJE);
  const venc = reg.automaticos.find(a => a.codigo === 'VENCIMENTO');
  assert.strictEqual(venc.resposta, 'Nova licitação em andamento', 'o tratamento do gestor aparece no risco automático');
  assert.strictEqual(reg.riscos.length, 1, 'o tratamento não vira um segundo risco');
  assert.strictEqual(reg.issues.length, 1);
  assert.strictEqual(reg.resumo.maiorCriticidade, 25);
  assert.strictEqual(reg.resumo.issuesAbertos, 1);
  assert.strictEqual(reg.resumo.matriz['5x5'], 1);
  assert.ok(reg.painel.dataUltimaRevisao);
});

test('exportação no layout da aba "Riscos" da planilha', () => {
  const db = { contratos: [{ id: 5, numero: '066/2020', termino: '2026-08-06', responsavel: 'A B', suplente: 'C D' }], importacoesPendentes: [] };
  const csv = r.gerarCsvRiscos(r.montarRegistro(db, 5, HOJE));
  const cab = csv.split('\r\n')[0];
  assert.ok(cab.startsWith('﻿Id. do RISCO;Status;Risco, Oportunidade?'));
  assert.ok(cab.includes('CRITÉRIO de ACEITAÇÃO'));
  assert.ok(csv.includes('VENCIMENTO'));
});

/* Regime legal (24/09/2026): vale a lei do preâmbulo do CONTRATO, não a
   dos aditivos; e número de CNPJ não é citação de lei. */
test('regime: aditivo recente citando a lei nova não muda o regime do contrato antigo', () => {
  const { regimeLegal } = require('../integrations/registroRiscos');
  const texto = [
    '=== Arquivo: Contrato nº 066_2020.pdf ===\nContrato celebrado nos termos da Lei Federal nº 8.666/1993 e Lei 10.520/2002.',
    '=== Arquivo: Termo Aditamento - 147_2025.pdf ===\nFica prorrogado nos termos da Lei Federal nº 14.133/2021.'
  ].join('\n\n');
  assert.deepStrictEqual(regimeLegal(texto, null, '066/2020'), { lei: '8.666', presumido: false });
});

test('regime: CNPJ 11.244.553/0001-06 não é a Lei 14.133', () => {
  const { regimeLegal } = require('../integrations/registroRiscos');
  const texto = '=== Arquivo: Contrato nº 038.2023.pdf ===\nCONTRATADA inscrita no CNPJ 11.244.553/0001-06 ... nos termos da Lei Federal n° 8.666/1993.';
  assert.strictEqual(regimeLegal(texto, '2023-03-27').lei, '8.666');
});

test('regime: sem citação nem início, o ano do número decide (presumido)', () => {
  const { regimeLegal } = require('../integrations/registroRiscos');
  assert.deepStrictEqual(regimeLegal('texto sem lei', null, '048/2026'), { lei: '14.133', presumido: true });
  assert.deepStrictEqual(regimeLegal('texto sem lei', null, null), { lei: null, presumido: true });
});

test('término contado da assinatura (sem Ordem de Início) vira risco de acompanhamento', () => {
  const { riscosAutomaticos } = require('../integrations/registroRiscos');
  const r = riscosAutomaticos({
    contrato: { id: 1, numero: '096/2025', inicio: '2025-12-05', termino: '2026-12-05', responsavel: 'Fulano de Tal', suplente: 'Beltrano de Tal', status: 'Ativo' },
    proposta: { id: 9, calculoVigencia: { termino: '2026-12-05', marcoPresumido: true, avisos: ['O contrato conta os 12 meses da Ordem de Início, que não está nos documentos da pasta: foram contados da assinatura (05/12/2025).'] } },
    hoje: '2026-09-24'
  });
  const p = r.find(x => x.codigo === 'VIGENCIA_PRESUMIDA');
  assert.ok(p, 'aparece no registro');
  assert.strictEqual(p.criticidade, 6);
  assert.strictEqual(p.criterio, 'Aceitar e monitorar');
  assert.ok(!r.some(x => x.codigo === 'VIGENCIA_NAO_COMPROVADA'), 'o término existe: não é "não comprovado"');
});


test('preposto não indicado vira risco, com a lei do regime do contrato', () => {
  const { riscosAutomaticos } = require('../integrations/registroRiscos');
  const r = riscosAutomaticos({
    contrato: { id: 1, numero: '072/2020', inicio: '2020-09-29', termino: '2030-01-01', responsavel: 'Ana Souza', suplente: 'Carlos Lima', status: 'Ativo' },
    proposta: { id: 3, regimeLegal: { lei: '8.666' }, origemRegra: { preposto_semValor: 'O contrato exige preposto da contratada, mas a indicação não foi encontrada nos documentos do processo.' } },
    hoje: '2026-09-24'
  });
  const p = r.find(x => x.codigo === 'SEM_PREPOSTO');
  assert.ok(p);
  assert.match(p.fundamento, /8\.666\/1993, art\. 68/);
  assert.match(p.evidencia, /exige preposto/);
  assert.strictEqual(p.criticidade, 6);
});
