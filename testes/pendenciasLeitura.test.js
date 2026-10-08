/* Pendências de leitura: o agrupamento pelo MOTIVO de o cálculo não ter
   saído, e a gravação do dado informado à mão.

   O que estes testes protegem:
     - cada motivo cai no grupo certo (é o que define o que a tela pede);
     - o dado informado é validado antes de virar campo do contrato;
     - o recálculo usa a regra de vigência (marco + meses), em vez de
       gravar uma data digitada como se fosse lida do documento;
     - o campo informado à mão fica marcado como 'manual' — a Base de
       Dados e a Fila mostram essa procedência. */
const { test } = require('node:test');
const assert = require('node:assert');
const pendencias = require('../integrations/pendenciasLeitura');
const { motivosDaProposta, recortar, ordenarPorNumero } = pendencias._paraTeste;

const AVISO_ORDEM = 'O contrato conta os 12 meses da Ordem de Início, e a data dela não está nos documentos da pasta — o término do período inicial não pôde ser calculado.';

function pendente(extra) {
  return {
    id: 1, status: 'pendente',
    campos: { numero: '088/2026', empresa: 'Empresa Exemplo LTDA', valor: 1000, inicio: '2026-01-10' },
    arquivosFonte: [],
    ...extra
  };
}

test('falta a Ordem de Início: cai no grupo que pede só a data', () => {
  const p = pendente({ calculoVigencia: { avisos: [AVISO_ORDEM], periodos: [{ origem: 'contrato', meses: 12 }] } });
  const r = pendencias.resumir({ importacoesPendentes: [p] });
  assert.strictEqual(r.grupos.length, 1);
  assert.strictEqual(r.grupos[0].chave, 'ordem_inicio');
  assert.deepStrictEqual(r.grupos[0].pede, ['dataMarco']);
  assert.strictEqual(r.grupos[0].itens[0].meses, 12, 'a tela mostra os meses já lidos');
});

test('cada aviso da vigência cai no seu grupo', () => {
  const caso = aviso => motivosDaProposta(pendente({ calculoVigencia: { avisos: [aviso] } }))[0].chave;
  assert.strictEqual(caso(AVISO_ORDEM), 'ordem_inicio');
  assert.strictEqual(caso('O contrato não diz de quando conta a vigência (assinatura ou Ordem de Início) — o término do período inicial não foi calculado.'), 'sem_marco');
  assert.strictEqual(caso('A vigência conta da assinatura, mas a data de assinatura não foi encontrada (o fecho "Itaverde, ..." costuma estar na última página, que pode não ter sido lida).'), 'sem_assinatura');
  assert.strictEqual(caso('O termo 176 prorroga por 12 meses, mas não diz a partir de quando, e o período anterior não tem término conhecido.'), 'prorrogacao_sem_inicio');
});

test('sem nenhum cálculo de vigência, o motivo é "vigência não encontrada" e pede data + meses', () => {
  const r = pendencias.resumir({ importacoesPendentes: [pendente({ calculoVigencia: null })] });
  assert.strictEqual(r.grupos[0].chave, 'sem_vigencia');
  assert.deepStrictEqual(r.grupos[0].pede, ['dataMarco', 'meses']);
});

test('proposta sem valor entra também no grupo do valor', () => {
  const p = pendente({ campos: { numero: '102/2022', valor: null, termino: '2027-01-01' } });
  const chaves = motivosDaProposta(p).map(m => m.chave);
  assert.deepStrictEqual(chaves, ['sem_valor']);
});

test('proposta completa não gera pendência; aprovada nunca entra', () => {
  const completa = pendente({ campos: { numero: '1/2026', valor: 10, inicio: '2026-01-01', termino: '2027-01-01' } });
  const aprovada = pendente({ id: 2, status: 'aprovado', campos: { numero: '2/2026' } });
  const r = pendencias.resumir({ importacoesPendentes: [completa, aprovada] });
  assert.strictEqual(r.grupos.length, 0);
  assert.strictEqual(r.totais.pendentes, 1);
  assert.strictEqual(r.totais.comPendencia, 0);
});

test('totais contam o que falta em cada campo', () => {
  const r = pendencias.resumir({ importacoesPendentes: [
    pendente({ id: 1, campos: { numero: '1/2026', valor: null } }),
    pendente({ id: 2, campos: { numero: '2/2026', valor: 5, inicio: '2026-01-01', termino: '2027-01-01' } })
  ] });
  assert.strictEqual(r.totais.semTermino, 1);
  assert.strictEqual(r.totais.semInicio, 1);
  assert.strictEqual(r.totais.semValor, 1);
});

test('dado inválido é recusado antes de encostar na proposta', async () => {
  const db = { importacoesPendentes: [pendente({ campos: { numero: '1/2026' } })] };
  const nada = () => { throw new Error('não deveria gravar'); };
  await assert.rejects(() => pendencias.aplicarDadoManual(db, nada, 1, { dataMarco: '10/01/2026' }), /AAAA-MM-DD/);
  await assert.rejects(() => pendencias.aplicarDadoManual(db, nada, 1, { dataMarco: '1826-01-10' }), /intervalo/);
  await assert.rejects(() => pendencias.aplicarDadoManual(db, nada, 1, { meses: 0 }), /meses/);
  await assert.rejects(() => pendencias.aplicarDadoManual(db, nada, 1, { valorMensal: -3 }), /Valor mensal/);
  await assert.rejects(() => pendencias.aplicarDadoManual(db, nada, 1, {}), /pelo menos um dado/);
  await assert.rejects(() => pendencias.aplicarDadoManual(db, nada, 99, { valorMensal: 1 }), /não encontrada/);
});

test('proposta já revisada não aceita dado manual', async () => {
  const db = { importacoesPendentes: [pendente({ status: 'aprovado' })] };
  await assert.rejects(() => pendencias.aplicarDadoManual(db, () => {}, 1, { valorMensal: 10 }), /já foi revisada/);
});

test('valor informado à mão vira campo com procedência "manual" e histórico', async () => {
  const p = pendente({ campos: { numero: '102/2022', valor: null } });
  const db = { importacoesPendentes: [p] };
  let gravou = 0;
  const r = await pendencias.aplicarDadoManual(db, () => gravou++, 1, { valorMensal: '84250.50', observacao: 'conferido no contrato, fl. 12' }, 'Fulano');
  assert.strictEqual(p.campos.valor, 84250.5);
  assert.strictEqual(p.procedencia.valor, 'manual');
  assert.strictEqual(p.dadosManuais.por, 'Fulano');
  assert.strictEqual(p.dadosManuais.observacao, 'conferido no contrato, fl. 12');
  assert.deepStrictEqual(r.alterados, [{ campo: 'valor', de: null, para: 84250.5 }]);
  assert.strictEqual(gravou, 1, 'grava uma vez só');
});

test('sem texto no cache, a data informada preenche o início e o término fica para a próxima varredura', async () => {
  const p = pendente({ campos: { numero: '102/2022' }, arquivosFonte: [] });
  const db = { importacoesPendentes: [p] };
  const r = await pendencias.aplicarDadoManual(db, () => {}, 1, { dataMarco: '2026-03-04' }, 'Fulano');
  assert.strictEqual(p.campos.inicio, '2026-03-04');
  assert.strictEqual(p.procedencia.inicio, 'manual');
  assert.strictEqual(r.semTexto, true);
  assert.strictEqual(p.campos.termino, undefined);
});

test('o recorte do trecho marca corte no começo e no fim', () => {
  const texto = 'a'.repeat(300) + 'ORDEM DE INÍCIO' + 'b'.repeat(300);
  const t = recortar(texto, 300, 100);
  assert.ok(t.startsWith('…') && t.endsWith('…'));
  assert.ok(t.includes('ORDEM DE INÍCIO'));
});

test('a lista de cada grupo vem do contrato mais recente para o mais antigo', () => {
  const itens = [{ numero: '005/2020' }, { numero: '100/2026' }, { numero: '007/2026' }];
  assert.deepStrictEqual(itens.sort(ordenarPorNumero).map(i => i.numero), ['100/2026', '007/2026', '005/2020']);
});

test('término contado da assinatura (sem Ordem de Início) aparece para confirmação, sem bloquear', () => {
  const { resumir } = require('../integrations/pendenciasLeitura');
  const db = { importacoesPendentes: [{
    id: 7, status: 'pendente', campos: { numero: '096/2025', inicio: '2025-12-05', termino: '2026-12-05', valor: 2175000 },
    calculoVigencia: { termino: '2026-12-05', marco: 'ordem', marcoPresumido: true, avisos: ['O contrato conta os 12 meses da Ordem de Início, que não está nos documentos da pasta: foram contados da assinatura (05/12/2025).'] }
  }] };
  const r = resumir(db);
  const g = r.grupos.find(x => x.chave === 'ordem_presumida');
  assert.ok(g, 'grupo de confirmação');
  assert.strictEqual(g.itens[0].numero, '096/2025');
  assert.strictEqual(r.totais.semTermino, 0, 'não conta como sem término');
});
