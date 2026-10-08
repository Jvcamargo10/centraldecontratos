/* ===================================================================
   integrations/indicadoresRelatorios.js

   Indicadores lidos do CONTEÚDO dos relatórios mensais (01/10/2026), por
   regra e sob pedido, um processo de cada vez: os últimos 12 meses com
   relatório. Cada número vem com o trecho e a página de onde saiu — quem
   olha confere no documento.

   Os relatórios não têm modelo único (medido em 12 empresas): a regra
   procura só o que aparece de forma reconhecível:
     - Disponibilidade: os percentuais (50% a 100%) das páginas que falam
       de disponibilidade — mostra o menor e a média;
     - Chamados: o total declarado ("Chamados Total Encerrados Em
       atendimento 6 6 0", "total de chamados: 12"), ou, sem ele, os
       números de chamado listados (INC0063972, RITM..., "Ticket: 7159");
       "não foram registradas ocorrências de chamados" vira 0;
     - Horas: "124 das 600 horas" — consumidas de contratadas;
     - SLA: percentuais logo depois de "SLA" / "nível de serviço".
   Sem OCR (opção semOcr do extrator): relatório digitalizado sai "sem
   texto" — rodar OCR em 2.000 relatórios travaria a máquina. O texto lido
   fica no cache de texto (a Busca nos documentos passa a achá-lo).
=================================================================== */
const fs = require('fs');

const MESES_ANALISADOS = 12;
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const numeroBr = s => Number(String(s).replace(/\.(?=\d{3}(?!\d))/g, '').replace(',', '.'));
const pctBr = n => `${n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`;

/* Página de uma posição no texto (o extrator marca "[página N]"). */
function paginaEm(texto, pos) {
  const antes = texto.slice(0, pos);
  const m = antes.match(/\[página (\d+)\](?![\s\S]*\[página \d+\])/);
  return m ? Number(m[1]) : null;
}
function trechoEm(texto, ini, fim) {
  return texto.slice(Math.max(0, ini - 60), Math.min(texto.length, fim + 60)).replace(/\s+/g, ' ').trim();
}
function paginasDoTexto(texto) {
  const partes = String(texto || '').split(/(?=\[página \d+\])/);
  let pos = 0;
  return partes.map(p => { const m = /^\[página (\d+)\]/.exec(p); const r = { numero: m ? Number(m[1]) : null, inicio: pos, texto: p }; pos += p.length; return r; });
}

const RE_PCT = /(\d{1,3}(?:[.,]\d{1,3})?)\s?%/g;

// Percentual que não é disponibilidade medida: meta do contrato, avanço de projeto, consumo...
const RE_OUTRO_PCT = /avan[cç]o|consum|popula|acima|abaixo|m[ií]nim|meta\b|tanque|diesel|umidade|conclu|execu[cç][aã]o|desconto|reajuste|multa/i;
const RE_DISP = /disponib\s?ilidade|tempo\s+de\s+atividade|uptime/gi;
function disponibilidade(texto) {
  const valores = [];
  for (const pg of paginasDoTexto(texto)) {
    const tn = norm(pg.texto);
    const mencoes = [...tn.matchAll(RE_DISP)].map(m => m.index);
    if (!mencoes.length) continue;
    const pcts = [...pg.texto.matchAll(RE_PCT)]
      .map(m => ({ v: numeroBr(m[1]), i: m.index, fim: m.index + m[0].length }))
      .filter(p => p.v >= 50 && p.v <= 100 && !RE_OUTRO_PCT.test(pg.texto.slice(Math.max(0, p.i - 45), p.fim + 15)));
    // Tabela de disponibilidade (uma linha por unidade/circuito): vale a página inteira.
    // Fora de tabela: só o percentual logo depois da menção.
    const daTabela = pcts.length >= 5;
    for (const p of pcts) {
      if (daTabela || mencoes.some(i => p.i > i && p.i - i <= 200)) valores.push({ v: p.v, pos: pg.inicio + p.i, fim: pg.inicio + p.fim, pagina: pg.numero });
    }
  }
  if (!valores.length) return null;
  const menor = valores.reduce((a, b) => (b.v < a.v ? b : a));
  const media = valores.reduce((s, x) => s + x.v, 0) / valores.length;
  return {
    chave: 'disponibilidade', rotulo: 'Disponibilidade', numero: menor.v,
    valor: valores.length > 1 ? `menor ${pctBr(menor.v)} · média ${pctBr(Math.round(media * 100) / 100)} (${valores.length} valores)` : pctBr(menor.v),
    pagina: menor.pagina, trecho: trechoEm(texto, menor.pos, menor.fim)
  };
}

const RE_TOTAL_TABELA = /chamados\s+total\s+encerrados\s+em\s+atendimento\s+(\d+)\s+(\d+)\s+(\d+)/gi;
const RE_TOTAL = /total\s+de\s+(?:chamados|tickets|incidentes|ocorr[eê]ncias|atendimentos|engajamentos)[^\d\n]{0,30}?(\d{1,5})(?![\d/.,])/gi;
const RE_NENHUM = /n[aã]o\s+(?:foram|houve)\s+(?:registrad[oa]s\s+)?(?:ocorr[eê]ncias\s+(?:de\s+)?)?(?:aberturas?\s+de\s+)?(?:chamados|incidentes|tickets)/i;
const RE_IDS = /\b(?:INC|RITM|REQ|CHG|PRB)\d{5,}\b|ticket:?\s*n?[ºo°]?\s*(\d{3,})/gi;

function chamados(texto) {
  // Total declarado: soma as tabelas do resumo ("Chamados Total Encerrados Em atendimento").
  const tabelas = [...texto.matchAll(RE_TOTAL_TABELA)];
  if (tabelas.length) {
    const total = tabelas.reduce((s, m) => s + Number(m[1]), 0);
    const abertos = tabelas.reduce((s, m) => s + Number(m[3]), 0);
    const m = tabelas[0];
    return { chave: 'chamados', rotulo: 'Chamados', numero: total, valor: `${total} no período${abertos ? ` · ${abertos} em atendimento` : ' · todos encerrados'}`,
      pagina: paginaEm(texto, m.index), trecho: trechoEm(texto, m.index, m.index + m[0].length) };
  }
  const tot = RE_TOTAL.exec(texto); RE_TOTAL.lastIndex = 0;
  if (tot) return { chave: 'chamados', rotulo: 'Chamados', numero: Number(tot[1]), valor: `${tot[1]} (total declarado)`, pagina: paginaEm(texto, tot.index), trecho: trechoEm(texto, tot.index, tot.index + tot[0].length) };
  const ids = new Map();
  for (const m of texto.matchAll(RE_IDS)) { const id = (m[1] ? `ticket ${m[1]}` : m[0]).toUpperCase(); if (!ids.has(id)) ids.set(id, m); }
  if (ids.size) {
    const m = [...ids.values()][0];
    return { chave: 'chamados', rotulo: 'Chamados', numero: ids.size, valor: `${ids.size} listado(s) no relatório`, pagina: paginaEm(texto, m.index), trecho: trechoEm(texto, m.index, m.index + m[0].length) };
  }
  const nada = RE_NENHUM.exec(texto);
  if (nada) return { chave: 'chamados', rotulo: 'Chamados', numero: 0, valor: 'nenhum no período', pagina: paginaEm(texto, nada.index), trecho: trechoEm(texto, nada.index, nada.index + nada[0].length) };
  return null;
}

const RE_HORAS = /(\d{1,5}(?:[.,]\d{1,2})?)\s+(?:das|de)\s+(\d{1,5}(?:[.,]\d{1,2})?)\s+horas/i;
function horas(texto) {
  const m = RE_HORAS.exec(texto);
  if (!m) return null;
  const [usadas, total] = [numeroBr(m[1]), numeroBr(m[2])];
  if (!total || usadas > total * 3) return null;
  return { chave: 'horas', rotulo: 'Horas', numero: usadas, valor: `${m[1]} de ${m[2]} h (${pctBr(Math.round(usadas / total * 1000) / 10)})`, pagina: paginaEm(texto, m.index), trecho: trechoEm(texto, m.index, m.index + m[0].length) };
}

const RE_SLA = /\b(?:SLA|n[ií]vel\s+de\s+servi[cç]o|ANS)\b[^%]{0,120}?(\d{1,3}(?:[.,]\d{1,3})?)\s?%/g;
function sla(texto) {
  const valores = [];
  for (const m of texto.matchAll(RE_SLA)) {
    const v = numeroBr(m[1]);
    if (v >= 50 && v <= 100) valores.push({ v, m });
  }
  if (!valores.length) return null;
  const menor = valores.reduce((a, b) => (b.v < a.v ? b : a));
  return { chave: 'sla', rotulo: 'SLA', numero: menor.v, valor: valores.length > 1 ? `menor ${pctBr(menor.v)} (${valores.length} valores)` : pctBr(menor.v),
    pagina: paginaEm(texto, menor.m.index), trecho: trechoEm(texto, menor.m.index, menor.m.index + menor.m[0].length) };
}

/* Os indicadores de um texto (puro — é o que os testes exercitam). */
function extrairIndicadores(texto) {
  const t = String(texto || '');
  return [disponibilidade(t), chamados(t), horas(t), sla(t)].filter(Boolean);
}

/* Os arquivos a analisar: o relatório (não planilha nem anexo) de cada um
   dos últimos 12 meses; no mesmo mês, o maior PDF/DOCX (o relatório
   completo costuma ser o maior; os outros são anexos). */
function arquivosDosUltimosMeses(proc, n = MESES_ANALISADOS) {
  const porMes = new Map();
  for (const a of proc.arquivos || []) {
    if (!a.competencia || a.tipo !== 'relatorio' || !/\.(pdf|docx)$/i.test(a.nome)) continue;
    const atual = porMes.get(a.competencia);
    if (!atual || (a.tamanho || 0) > (atual.tamanho || 0)) porMes.set(a.competencia, a);
  }
  return [...porMes.values()].sort((a, b) => b.competencia.localeCompare(a.competencia)).slice(0, n);
}

// Resultado por arquivo, na memória: assinatura = tamanho + data de modificação.
const memoria = new Map();
const emAndamento = new Map();

async function analisarArquivo(a) {
  let assinatura = null;
  try { const st = fs.statSync(a.caminho); assinatura = `${st.size}:${st.mtimeMs}`; } catch (e) { return { erro: 'Arquivo não encontrado agora (pasta sem acesso ou arquivo movido).' }; }
  const guardado = memoria.get(a.caminho);
  if (guardado && guardado.assinatura === assinatura) return guardado.resultado;
  let resultado;
  try {
    const ex = require('./extratorDocumento');
    const r = await ex.extrairTexto(a.caminho, { semOcr: true });
    const semTexto = !r || r.semTexto || (r.totalCaracteres || 0) < 200;
    resultado = semTexto ? { semTexto: true, indicadores: [] } : { semTexto: false, indicadores: extrairIndicadores(r.texto) };
  } catch (e) {
    resultado = { erro: `Não consegui ler: ${e.message}` };
  }
  memoria.set(a.caminho, { assinatura, resultado });
  return resultado;
}

/* Os indicadores de um processo (pelo caminho da pasta do processo). */
async function indicadoresDoProcesso(db, caminhoProcesso) {
  const rm = require('./relatoriosMensais');
  const proc = rm.caminhoDaPasta(db, caminhoProcesso);
  if (!proc) throw new Error('Processo não encontrado — leia as pastas de novo.');
  if (emAndamento.has(proc.caminho)) return emAndamento.get(proc.caminho);
  const permitido = require('./servidorArquivos').caminhoPermitido;
  const trabalho = (async () => {
    const meses = [];
    for (const a of arquivosDosUltimosMeses(proc)) {
      if (!permitido(a.caminho)) continue;
      meses.push({ competencia: a.competencia, arquivo: { id: a.id, nome: a.nome }, ...(await analisarArquivo(a)) });
    }
    const comTexto = meses.filter(m => !m.semTexto && !m.erro);
    return {
      processo: proc.nome, meses,
      resumo: { analisados: meses.length, semTexto: meses.filter(m => m.semTexto).length, comIndicador: comTexto.filter(m => m.indicadores.length).length }
    };
  })();
  emAndamento.set(proc.caminho, trabalho);
  try { return await trabalho; } finally { emAndamento.delete(proc.caminho); }
}

module.exports = { extrairIndicadores, arquivosDosUltimosMeses, indicadoresDoProcesso, MESES_ANALISADOS };
