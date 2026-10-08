/* ===================================================================
   testes/prazosEHistorico.test.js

   Sugestões da gestão (06/10/2026):
   1. Criticidade individual: cada contrato usa o Padrão, um perfil de
      trâmite ou prazos próprios — e a tela, o e-mail de alertas e o
      Registro de riscos usam os MESMOS prazos.
   2. Histórico administrativo do contrato: nada se apaga, correção guarda
      a versão anterior, tratativas antigas viram registros, pendências com
      prazo aparecem para o Início.
=================================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const P = require('../integrations/prazosContrato');
const H = require('../integrations/historicoContrato');

const dbBase = () => ({
  alertaConfig: { critico: 15, atencao: 30, proximo: 90 },
  contratos: [
    { id: 1, numero: '010/2024', empresa: 'Alfa', status: 'Ativo', termino: '2026-12-31' },
    { id: 2, numero: '020/2024', empresa: 'Beta', status: 'Ativo', termino: '2026-11-20' }
  ],
  aditivos: [{ id: 7, contratoId: 1, contrato: '010/2024', numero: '1º', tipo: 'Prorrogação', data: '2026-03-01', documento: 'F:\\x\\aditivo.pdf' }],
  apostilamentos: []
});

/* ---------- 1. Prazos ---------- */
test('prazos: sem escolha, vale o Padrão (as Configurações de alerta de sempre)', () => {
  const db = dbBase();
  assert.deepStrictEqual(P.faixasDoContrato(db, 1), { critico: 15, atencao: 30, proximo: 90, origem: 'padrao', nome: 'Padrão' });
  assert.deepStrictEqual(P.faixasForaDoPadrao(db), {});
});

test('prazos: perfil de trâmite vale para os contratos dele e mudar o perfil muda todos', () => {
  const db = dbBase();
  const { perfil } = P.criarPerfil(db, { nome: 'Nova licitação', critico: 90, atencao: 180, proximo: 270 });
  assert.strictEqual(perfil.id, 'p1');
  P.definirDoContrato(db, 1, { perfilId: 'p1', motivo: 'Não pode mais ser prorrogado' }, 'Ana', '2026-10-06T10:00:00Z');
  const f = P.faixasDoContrato(db, 1);
  assert.strictEqual(f.critico, 90); assert.strictEqual(f.nome, 'Nova licitação'); assert.strictEqual(f.definidoPor, 'Ana');
  assert.strictEqual(P.faixasDoContrato(db, 2).origem, 'padrao');
  P.atualizarPerfil(db, 'p1', { nome: 'Nova licitação', critico: 100, atencao: 200, proximo: 300 });
  assert.strictEqual(P.faixasDoContrato(db, 1).critico, 100);
  const lista = P.listarPerfis(db);
  assert.strictEqual(lista.perfis.find(p => p.id === 'p1').contratos, 1);
  assert.strictEqual(lista.perfis.find(p => p.id === 'padrao').contratos, 1);
});

test('prazos próprios exigem motivo e ordem crescente; perfil em uso não é excluído', () => {
  const db = dbBase();
  assert.match(P.definirDoContrato(db, 1, { perfilId: 'proprio', critico: 30, atencao: 60, proximo: 120 }).erro, /Explique/);
  assert.match(P.definirDoContrato(db, 1, { perfilId: 'proprio', critico: 60, atencao: 30, proximo: 120, motivo: 'x' }).erro, /crescente/);
  assert.match(P.criarPerfil(db, { nome: 'Curto demais', critico: 0, atencao: 1, proximo: 2 }).erro, /1 a/);
  assert.match(P.criarPerfil(db, { nome: 'Padrão', critico: 1, atencao: 2, proximo: 3 }).erro, /Já existe/);
  P.definirDoContrato(db, 2, { perfilId: 'proprio', critico: 30, atencao: 60, proximo: 120, motivo: 'Renovação depende de parecer da PGM' }, 'Ana');
  assert.strictEqual(P.faixasDoContrato(db, 2).origem, 'proprio');
  P.criarPerfil(db, { nome: 'Prorrogação', critico: 30, atencao: 60, proximo: 120 });
  P.definirDoContrato(db, 1, { perfilId: 'p1' }, 'Ana');
  assert.match(P.excluirPerfil(db, 'p1').erro, /em uso por 1/);
  assert.match(P.excluirPerfil(db, 'padrao').erro, /não pode/);
  P.definirDoContrato(db, 1, { perfilId: 'padrao' }, 'Ana');
  assert.ok(P.excluirPerfil(db, 'p1').perfil);
  // perfil Padrão edita as Configurações de alerta de sempre
  P.atualizarPerfil(db, 'padrao', { critico: 20, atencao: 40, proximo: 100 });
  assert.deepStrictEqual(db.alertaConfig, { critico: 20, atencao: 40, proximo: 100 });
});

test('e-mail de alertas e Registro de riscos usam os prazos DO contrato', () => {
  const db = dbBase();
  const hoje = new Date(); const daqui = d => new Date(hoje.getTime() + d * 86400000).toISOString().slice(0, 10);
  db.contratos[0].termino = daqui(50); // no Padrão (próximo ≤ 90) não entra no e-mail (só vencido/crítico/atenção)
  const resumo = require('../integrations/resumoAlertas');
  assert.ok(!resumo.contratosEmAlerta(db).some(i => i.contrato.id === 1));
  P.criarPerfil(db, { nome: 'Nova licitação', critico: 60, atencao: 120, proximo: 240 });
  P.definirDoContrato(db, 1, { perfilId: 'p1' }, 'Ana');
  const item = resumo.contratosEmAlerta(db).find(i => i.contrato.id === 1);
  assert.strictEqual(item && item.faixa, 'Crítico');

  const reg = require('../integrations/registroRiscos');
  const venc = reg.riscosAutomaticos({ contrato: db.contratos[0], hoje: daqui(0), alertaConfig: P.faixasDoContrato(db, 1) }).find(r => r.codigo === 'VENCIMENTO');
  assert.ok(venc, 'risco de vencimento aparece');
  assert.match(venc.titulo, /prazo crítico/);
  assert.match(venc.evidencia, /Nova licitação/);
});

/* ---------- 2. Histórico ---------- */
test('histórico: registra, valida e abre pendência quando há prazo ou é solicitação', () => {
  const db = dbBase();
  assert.match(H.registrar(db, 1, { tipo: 'x', descricao: 'a' }, 'Ana').erro, /tipo/);
  assert.match(H.registrar(db, 1, { tipo: 'despacho', descricao: '' }, 'Ana').erro, /Descreva/);
  assert.match(H.registrar(db, 1, { tipo: 'despacho', descricao: 'a', data: '2026-10-10', prazoResposta: '2026-10-01' }, 'Ana').erro, /antes/);
  assert.match(H.registrar(db, 1, { tipo: 'despacho', descricao: 'a', arquivo: 'C:\\fora.pdf' }, 'Ana', { caminhoPermitido: () => false }).erro, /pastas de rede/);
  assert.strictEqual(H.registrar(db, 99, { tipo: 'despacho', descricao: 'a' }, 'Ana').status, 404);
  const tce = H.registrar(db, 1, { tipo: 'solicitacao_tce', descricao: 'Pede cópia do contrato e aditivos', solicitante: 'TCE-SP', documento: 'Ofício 123/2026', data: '2026-10-01', prazoResposta: '2026-10-08' }, 'Ana', { hoje: '2026-10-06' }).registro;
  assert.strictEqual(tce.situacao, 'aberta');
  const reuniao = H.registrar(db, 1, { tipo: 'reuniao', descricao: 'Alinhamento com a contratada', data: '2026-10-02' }, 'Ana').registro;
  assert.strictEqual(reuniao.situacao, 'informativo');
  const pend = H.pendentes(db, '2026-10-06');
  assert.strictEqual(pend.length, 1);
  assert.deepStrictEqual([pend[0].numero, pend[0].dias, pend[0].situacao], ['010/2024', 2, 'vence_logo']);
  assert.strictEqual(H.pendentes(db, '2026-10-09')[0].situacao, 'atrasada');
});

test('histórico: correção guarda a versão anterior; mudar o conteúdo pede motivo, marcar como respondida não', () => {
  const db = dbBase();
  const r = H.registrar(db, 1, { tipo: 'solicitacao_diretor', descricao: 'Relatório de execução', solicitante: 'Diretor de TI', data: '2026-10-01', prazoResposta: '2026-10-15' }, 'Ana').registro;
  assert.match(H.corrigir(db, r.id, { descricao: 'Relatório de execução e medições' }, 'Bruno').erro, /motivo/);
  const c1 = H.corrigir(db, r.id, { descricao: 'Relatório de execução e medições', motivo: 'Faltou citar as medições' }, 'Bruno', { agora: '2026-10-02T09:00:00Z' });
  assert.deepStrictEqual(c1.campos, ['descricao']);
  assert.strictEqual(r.versoes.length, 1);
  assert.strictEqual(r.versoes[0].descricao, 'Relatório de execução');
  assert.strictEqual(r.versoes[0].alteradoPor, 'Bruno');
  const c2 = H.corrigir(db, r.id, { situacao: 'respondida' }, 'Bruno', { hoje: '2026-10-05' });
  assert.ok(!c2.erro);
  assert.strictEqual(r.situacao, 'respondida'); assert.strictEqual(r.respondidoEm, '2026-10-05');
  assert.strictEqual(r.versoes.length, 2);
  assert.ok(H.corrigir(db, r.id, { situacao: 'respondida' }, 'Bruno', { hoje: '2026-10-05' }).semMudanca);
  assert.strictEqual(H.pendentes(db, '2026-10-06').length, 0);
});

test('histórico: tratativas antigas viram "Tratativa interna", uma vez só, sem apagar a lista antiga', () => {
  const db = dbBase();
  db.tratativas = [
    { id: 2, contratoId: 1, data: '2026-09-20', usuario: 'Carla', nota: 'Cobrar relatório de agosto', status: 'Em andamento' },
    { id: 1, contratoId: 2, data: '2026-09-10', usuario: 'Carla', nota: 'Garantia renovada', status: 'Resolvido' }
  ];
  assert.strictEqual(H.migrarTratativas(db), 2);
  assert.strictEqual(H.migrarTratativas(db), 0, 'rodar de novo não duplica');
  assert.strictEqual(db.tratativas.length, 2, 'a lista antiga fica');
  const t = db.historicoContratos.find(h => h.tratativaId === 2);
  assert.deepStrictEqual([t.tipo, t.situacao, t.descricao, t.registradoPor], ['tratativa', 'aberta', 'Cobrar relatório de agosto', 'Carla']);
  assert.strictEqual(db.historicoContratos.find(h => h.tratativaId === 1).situacao, 'concluida');
  assert.strictEqual(H.abertosDoContrato(db, 1), 1);
});

test('linha do tempo: registros e o que veio da pasta, mais recente primeiro; planilha e PDF', async () => {
  const db = dbBase();
  H.registrar(db, 1, { tipo: 'oficio_enviado', descricao: 'Resposta ao TCE', documento: 'Ofício 45/2026', data: '2026-10-05' }, 'Ana');
  const l = H.linhaDoTempo(db, 1, '2026-10-06');
  assert.deepStrictEqual(l.itens.map(i => [i.origem, i.tipoRotulo, i.data]), [['registro', 'Ofício enviado', '2026-10-05'], ['pasta', 'Aditivo', '2026-03-01']]);
  assert.strictEqual(H.linhaDoTempo(db, 999), null);
  const csv = H.gerarCsv(l);
  assert.match(csv, /Ofício 45\/2026/);
  assert.match(csv, /Lido da pasta;Aditivo/);
  const { PassThrough } = require('stream');
  const saida = new PassThrough(); const partes = [];
  saida.on('data', p => partes.push(p));
  const fim = new Promise(r => saida.on('end', r));
  H.gerarPdf(l, saida); await fim;
  assert.strictEqual(Buffer.concat(partes).subarray(0, 4).toString(), '%PDF');
});

test('Registro de riscos: pendência em aberto no histórico conta como risco do contrato', () => {
  const db = dbBase();
  H.registrar(db, 1, { tipo: 'solicitacao_tce', descricao: 'x', data: '2026-10-01' }, 'Ana');
  const reg = require('../integrations/registroRiscos');
  const r = reg.riscosAutomaticos({ contrato: db.contratos[0], hoje: '2026-10-06', historico: db.historicoContratos }).find(x => x.codigo === 'TRATATIVAS_ABERTAS');
  assert.ok(r);
  assert.match(r.titulo, /1 registro\(s\) em aberto no histórico/);
});

test('resumo por contrato (cor do sino): total e em aberto', () => {
  const db = dbBase();
  assert.deepStrictEqual(H.resumoPorContrato(db), {});
  const a = H.registrar(db, 1, { tipo: 'solicitacao_diretor', descricao: 'x', data: '2026-10-01' }, 'Ana').registro;
  H.registrar(db, 1, { tipo: 'reuniao', descricao: 'y', data: '2026-10-02' }, 'Ana');
  H.registrar(db, 2, { tipo: 'despacho', descricao: 'z', data: '2026-10-02' }, 'Ana');
  assert.deepStrictEqual(H.resumoPorContrato(db), { 1: { total: 2, abertos: 1 }, 2: { total: 1, abertos: 0 } });
  H.corrigir(db, a.id, { situacao: 'concluida' }, 'Ana', { hoje: '2026-10-06' });
  assert.deepStrictEqual(H.resumoPorContrato(db)[1], { total: 2, abertos: 0 });
});
