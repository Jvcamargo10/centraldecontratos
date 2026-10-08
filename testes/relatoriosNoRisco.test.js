/* ===================================================================
   testes/relatoriosNoRisco.test.js

   Relatórios mensais além da lista (01/10/2026): a falta de relatório
   vira risco no Registro (e no Mapa), o padrão de nome com o nome
   sugerido, os indicadores lidos do conteúdo e a visão do contrato.
=================================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const rm = require('../integrations/relatoriosMensais');
const registro = require('../integrations/registroRiscos');
const ind = require('../integrations/indicadoresRelatorios');
const visao = require('../integrations/visaoContrato');

const arq = (competencia, nome, tipo = 'relatorio') => ({ id: competencia + nome, caminho: `C:\\x\\${nome}`, nome, rel: nome, competencia, tipo, tamanho: 1000 });
function dbCom(meses) {
  return {
    contratos: [{ id: 1, numero: '015/2024', pa: '07.334/2023', empresa: 'CONECTA', inicio: '2025-01-01', termino: '2027-12-31', status: 'Vigente' }],
    importacoesPendentes: [], aditivos: [], apostilamentos: [],
    relatoriosMensais: { lidoEm: '2026-10-01T10:00:00Z', avisos: [], processos: [{
      caminho: 'C:\\x\\P.A. 07.334_2023 - Internet - Conecta', nome: 'P.A. 07.334_2023 - Internet - Conecta', pa: '07.334/2023', categoria: 'vigencia',
      pastas: [{ nome: 'Relatórios mensais de atividades', caminho: 'C:\\x\\rel' }],
      arquivos: meses.map(m => arq(m, `${m.replace('-', '_')} - Relatório Mensal - Conecta.pdf`))
    }] }
  };
}
const todosOsMeses = (ini, fim) => { const out = []; let [a, m] = ini.split('-').map(Number); while (`${a}-${String(m).padStart(2, '0')}` <= fim) { out.push(`${a}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; a++; } } return out; };

test('cobertura do contrato: pelo PA; "não exige" sai da cobrança', () => {
  const db = dbCom(todosOsMeses('2025-01', '2026-05'));
  const c = rm.coberturaDoContrato(db, db.contratos[0], new Date('2026-10-01T12:00:00'));
  assert.deepStrictEqual(c.faltando, ['2026-06', '2026-07', '2026-08']);
  assert.strictEqual(c.aguardando, '2026-09', 'até o dia 10, o mês passado ainda está no prazo');
  db.relatoriosMensaisConfig = { '7334/2023': { motivo: 'licença', por: 'X', em: '2026-10-01' } };
  assert.ok(rm.coberturaDoContrato(db, db.contratos[0], new Date('2026-10-01T12:00:00')).naoExige);
  assert.strictEqual(rm.coberturaDoContrato({ contratos: [] }, db.contratos[0]), null, 'pastas não lidas: nada a dizer');
});

test('risco RELATORIO_MENSAL_FALTANDO: peso pelos meses recentes que faltam', () => {
  const pesoCom = meses => { const reg = registro.montarRegistro(dbCom(meses), 1, '2026-10-01'); return reg.automaticos.find(r => r.codigo === 'RELATORIO_MENSAL_FALTANDO') || null; };
  assert.strictEqual(pesoCom(todosOsMeses('2025-01', '2026-08')), null, 'tudo entregue: sem risco');
  assert.strictEqual(pesoCom(todosOsMeses('2025-01', '2026-05')).criticidade, 12, '3 meses recentes: 4×3');
  assert.strictEqual(pesoCom(todosOsMeses('2025-01', '2026-07')).criticidade, 6, '1 mês recente: 2×3');
  const antigo = pesoCom(todosOsMeses('2025-01', '2026-08').filter(m => m !== '2025-03'));
  assert.strictEqual(antigo.criticidade, 4, 'só mês antigo: 2×2');
  assert.match(antigo.evidencia, /03\/2025/);
  const db = dbCom(todosOsMeses('2025-01', '2026-05'));
  db.contratos[0].status = 'Encerrado';
  const enc = registro.montarRegistro(db, 1, '2026-10-01').automaticos.find(r => r.codigo === 'RELATORIO_MENSAL_FALTANDO');
  assert.strictEqual(enc.criticidade, 4, 'encerrado: a falta fica registrada, sem peso de cobrança');
  assert.match(enc.titulo, /^Contrato encerrado/);
});

test('padrão de nome: fora do padrão ganha o nome sugerido (a Central não renomeia)', () => {
  assert.strictEqual(rm.nomeSugerido({ nome: 'Relatorio Prisma dez.pdf', competencia: '2023-12', tipo: 'relatorio' }, 'P.A. 16.735_2017 - Locação de Impressoras - PRISMA'),
    '2023_12 - Relatório Mensal - PRISMA - Dezembro.pdf');
  assert.strictEqual(rm.nomeSugerido({ nome: 'x.pdf', competencia: null, tipo: 'relatorio' }, 'P'), null, 'sem mês, sem sugestão');
  const db = dbCom(['2026-01']);
  db.relatoriosMensais.processos[0].arquivos.push(arq('2026-02', 'Relatorio fevereiro.pdf'));
  const l = rm.listar(db, new Date('2026-10-01T12:00:00'));
  assert.strictEqual(l.processos[0].foraDoPadrao, 1);
  const csv = rm.gerarCsv(db, 'fora_do_padrao');
  assert.match(csv, /2026_02 - Relatório Mensal - Conecta - Fevereiro\.pdf/);
});

test('indicadores do conteúdo: disponibilidade, chamados, horas e SLA com a página', () => {
  const texto = '[página 1] Relatório de agosto. A disponibilidade mínima de 99,5% é exigida em contrato. O projeto está com 54% de avanço.\n'
    + '[página 2] DISPONIBILIDADE por unidade: UBS A 100,00% UBS B 99,10% UBS C 100,00% UBS D 98,50% UBS E 100,00%\n'
    + '[página 3] Total de engajamentos no período: Chamados Total Encerrados Em atendimento 6 5 1\n'
    + '[página 4] Foram empenhadas 124 das 600 horas previstas. SLA de atendimento cumprido: 97,5%';
  const i = Object.fromEntries(ind.extrairIndicadores(texto).map(x => [x.chave, x]));
  assert.strictEqual(i.disponibilidade.numero, 98.5, 'a meta (mínima de 99,5%) e o avanço (54%) não contam');
  assert.strictEqual(i.disponibilidade.pagina, 2);
  assert.match(i.disponibilidade.trecho, /98,50%/);
  assert.strictEqual(i.chamados.numero, 6);
  assert.match(i.chamados.valor, /1 em atendimento/);
  assert.strictEqual(i.horas.numero, 124);
  assert.match(i.horas.valor, /124 de 600 h/);
  assert.strictEqual(i.sla.numero, 97.5);
  assert.strictEqual(i.sla.pagina, 4);
});

test('indicadores: chamados listados (INC...), "nenhum chamado" e texto sem indicador', () => {
  const ids = ind.extrairIndicadores('[página 1] INC0063972 alerta INC0063974 queda INC0063972 repetido');
  assert.strictEqual(ids.find(x => x.chave === 'chamados').numero, 2, 'o mesmo chamado citado duas vezes conta uma');
  const nada = ind.extrairIndicadores('[página 1] Não foram registradas ocorrências de aberturas de chamados no período.');
  assert.strictEqual(nada.find(x => x.chave === 'chamados').numero, 0);
  assert.deepStrictEqual(ind.extrairIndicadores('[página 1] Diesel no tanque 52%. Umidade alta 80%.'), []);
});

test('indicadores: um relatório por mês (o maior), os 12 meses mais recentes, sem planilha', () => {
  const meses = todosOsMeses('2025-01', '2026-08');
  const proc = { arquivos: [...meses.map(m => arq(m, `${m} rel.pdf`)), { ...arq('2026-08', 'anexo.pdf'), tamanho: 10 }, arq('2026-08', 'pmo.xlsx', 'planilha')] };
  proc.arquivos.find(a => a.nome === '2026-08 rel.pdf').tamanho = 5000;
  const l = ind.arquivosDosUltimosMeses(proc);
  assert.strictEqual(l.length, 12);
  assert.strictEqual(l[0].competencia, '2026-08');
  assert.strictEqual(l[0].nome, '2026-08 rel.pdf');
  assert.strictEqual(l[11].competencia, '2025-09');
});

test('visão do contrato: risco, relatórios e requisições num lugar só', () => {
  const db = dbCom(todosOsMeses('2025-01', '2026-05'));
  db.historicoContratos = [{ id: 1, contratoId: 1, tipo: 'tratativa', situacao: 'aberta' }, { id: 2, contratoId: 1, tipo: 'solicitacao_tce', situacao: 'respondida' }];
  const v = visao.montarVisao(db, 1, '2026-10-01');
  assert.strictEqual(v.contrato.numero, '015/2024');
  assert.deepStrictEqual(v.relatorios.faltando, ['2026-06', '2026-07', '2026-08']);
  assert.ok(v.risco.pontos.some(p => /sem relatório mensal/.test(p.titulo)), 'o risco dos relatórios aparece entre os pontos');
  assert.strictEqual(v.historicoAbertos, 1);
  assert.deepStrictEqual(v.requisicoes, { tce: [], enviadas: [], sisfin: [] });
  assert.strictEqual(visao.montarVisao(db, 999), null);
  assert.deepStrictEqual(visao.montarVisao({ ...db, relatoriosMensais: undefined }, 1, '2026-10-01').relatorios, { naoLido: true });
});
