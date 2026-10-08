/* ===================================================================
   integrations/historicoContrato.js

   Histórico administrativo do contrato (06/10/2026, sugestão da gestão):
   o registro de tudo o que aconteceu no contrato no âmbito
   administrativo — solicitações do TCE e dos diretores, ofícios,
   despachos, notificações, reuniões e as tratativas internas —, como a
   Trilha de auditoria, mas por contrato.

   - Nada se apaga. Uma correção guarda a versão anterior (com quem
     corrigiu, quando e por quê), e a versão antiga continua visível.
   - Quem registra é a equipe da SETEC (admin, gestor, fiscal); quem tem
     papel "consulta" só vê.
   - Registro com prazo de resposta fica "em aberto" até ser respondido ou
     concluído; os atrasados e os que vencem em até 5 dias aparecem no
     Início.
   - As tratativas antigas viram registros do tipo "Tratativa interna"
     (migrarTratativas, ao iniciar, sem apagar a lista antiga).
   - A linha do tempo do contrato junta estes registros com o que a
     Central já lê das pastas (aditivos, apostilamentos, requisições do
     TCE e do SisFin), marcados como "lido da pasta".
=================================================================== */
const { hojeLocal } = require('./dataLocal');

const TIPOS = {
  solicitacao_tce: 'Solicitação do TCE',
  solicitacao_diretor: 'Solicitação de diretor/secretário',
  oficio_recebido: 'Ofício recebido',
  oficio_enviado: 'Ofício enviado',
  despacho: 'Despacho',
  notificacao_contratada: 'Notificação à contratada',
  reuniao: 'Reunião',
  tratativa: 'Tratativa interna',
  outro: 'Outro'
};
const SITUACOES = { aberta: 'Em aberto', respondida: 'Respondida', concluida: 'Concluída', informativo: 'Só registro' };
const CAMPOS = ['data', 'tipo', 'solicitante', 'documento', 'descricao', 'prazoResposta', 'situacao', 'respondidoEm', 'arquivo'];
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const dataValida = s => DATA.test(s) && !isNaN(new Date(`${s}T12:00:00`)) && new Date(`${s}T12:00:00`).toISOString().slice(0, 10) === s;
const texto = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

/* Confere e arruma o que veio do formulário. caminhoPermitido: o arquivo
   precisa estar dentro das pastas de rede configuradas. */
function validar(dados, { hoje = hojeLocal(), caminhoPermitido = () => true } = {}) {
  const d = dados || {};
  const r = {
    data: texto(d.data, 10) || hoje,
    tipo: texto(d.tipo, 40),
    solicitante: texto(d.solicitante, 120),
    documento: texto(d.documento, 120),
    descricao: texto(d.descricao, 4000),
    prazoResposta: texto(d.prazoResposta, 10),
    situacao: texto(d.situacao, 20),
    respondidoEm: texto(d.respondidoEm, 10),
    arquivo: texto(d.arquivo, 500)
  };
  if (!TIPOS[r.tipo]) return { erro: 'Escolha o tipo do registro.' };
  if (!dataValida(r.data)) return { erro: 'Data inválida.' };
  if (!r.descricao) return { erro: 'Descreva o que aconteceu ou o que foi pedido.' };
  if (r.prazoResposta && !dataValida(r.prazoResposta)) return { erro: 'Prazo de resposta inválido.' };
  if (r.prazoResposta && r.prazoResposta < r.data) return { erro: 'O prazo de resposta não pode ser antes da data do registro.' };
  if (!r.situacao) r.situacao = (r.prazoResposta || /^solicitacao_/.test(r.tipo)) ? 'aberta' : 'informativo';
  if (!SITUACOES[r.situacao]) return { erro: 'Situação inválida.' };
  if (r.respondidoEm && !dataValida(r.respondidoEm)) return { erro: 'Data da resposta inválida.' };
  if (['respondida', 'concluida'].includes(r.situacao) && !r.respondidoEm) r.respondidoEm = hoje;
  if (!['respondida', 'concluida'].includes(r.situacao)) r.respondidoEm = '';
  if (r.arquivo && !caminhoPermitido(r.arquivo)) return { erro: 'O arquivo precisa estar nas pastas de rede da Central (o caminho completo, como aparece no Explorer).' };
  return { registro: r };
}

const proximoId = lista => (lista || []).reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;

function registrar(db, contratoId, dados, autor, opcoes = {}) {
  const c = (db.contratos || []).find(x => String(x.id) === String(contratoId));
  if (!c) return { erro: 'Contrato não encontrado.', status: 404 };
  const v = validar(dados, opcoes); if (v.erro) return v;
  db.historicoContratos = db.historicoContratos || [];
  const reg = { id: proximoId(db.historicoContratos), contratoId: c.id, ...v.registro, registradoPor: autor, registradoEm: opcoes.agora || new Date().toISOString(), versoes: [] };
  db.historicoContratos.push(reg);
  return { registro: reg, contrato: c };
}

/* Correção: a versão anterior fica guardada. Mudar só a situação (marcar
   como respondida) não pede motivo; mudar o conteúdo, pede. */
function corrigir(db, id, dados, autor, opcoes = {}) {
  const reg = (db.historicoContratos || []).find(x => String(x.id) === String(id));
  if (!reg) return { erro: 'Registro não encontrado.', status: 404 };
  const v = validar({ ...reg, ...dados }, opcoes); if (v.erro) return v;
  const mudou = CAMPOS.filter(k => String(reg[k] || '') !== String(v.registro[k] || ''));
  if (!mudou.length) return { registro: reg, semMudanca: true };
  const soSituacao = mudou.every(k => ['situacao', 'respondidoEm'].includes(k));
  const motivo = texto(dados && dados.motivo, 500);
  if (!soSituacao && !motivo) return { erro: 'Explique o motivo da correção — a versão anterior continua no histórico.' };
  const anterior = {};
  for (const k of CAMPOS) anterior[k] = reg[k];
  reg.versoes = reg.versoes || [];
  reg.versoes.push({ ...anterior, alteradoPor: autor, alteradoEm: opcoes.agora || new Date().toISOString(), motivo: motivo || (soSituacao ? `Situação: ${SITUACOES[v.registro.situacao]}` : ''), campos: mudou });
  Object.assign(reg, v.registro);
  return { registro: reg, campos: mudou };
}

/* Tratativas (o registro antigo) viram "Tratativa interna". Roda ao
   iniciar; a lista antiga fica intacta e cada uma é migrada uma vez só. */
function migrarTratativas(db) {
  db.historicoContratos = db.historicoContratos || [];
  const migradas = new Set(db.historicoContratos.filter(h => h.tratativaId != null).map(h => String(h.tratativaId)));
  let n = 0;
  for (const t of (db.tratativas || []).slice().reverse()) { // a lista antiga é a mais nova primeiro
    if (migradas.has(String(t.id))) continue;
    const resolvido = t.status === 'Resolvido';
    db.historicoContratos.push({
      id: proximoId(db.historicoContratos), contratoId: t.contratoId, data: String(t.data || '').slice(0, 10) || hojeLocal(),
      tipo: 'tratativa', solicitante: '', documento: '', descricao: String(t.nota || ''), prazoResposta: '',
      situacao: resolvido ? 'concluida' : 'aberta', respondidoEm: resolvido ? String(t.data || '').slice(0, 10) : '', arquivo: '',
      registradoPor: t.usuario || 'Usuário', registradoEm: t.data ? `${String(t.data).slice(0, 10)}T12:00:00.000Z` : new Date().toISOString(),
      versoes: [], tratativaId: t.id
    });
    n++;
  }
  return n;
}

const diasAte = (iso, hoje) => Math.round((new Date(`${iso}T12:00:00`) - new Date(`${hoje}T12:00:00`)) / 86400000);

/* Em aberto com prazo: para o aviso do Início e para o Registro de riscos. */
function pendentes(db, hoje = hojeLocal()) {
  const porId = new Map((db.contratos || []).map(c => [String(c.id), c]));
  return (db.historicoContratos || [])
    .filter(h => h.situacao === 'aberta' && porId.has(String(h.contratoId)))
    .map(h => {
      const c = porId.get(String(h.contratoId));
      const dias = h.prazoResposta ? diasAte(h.prazoResposta, hoje) : null;
      return { id: h.id, contratoId: c.id, numero: c.numero, tipo: h.tipo, tipoRotulo: TIPOS[h.tipo] || h.tipo, solicitante: h.solicitante, documento: h.documento,
        prazoResposta: h.prazoResposta || null, dias, situacao: dias === null ? 'sem_prazo' : dias < 0 ? 'atrasada' : dias <= 5 ? 'vence_logo' : 'no_prazo' };
    })
    .sort((a, b) => (a.dias === null) - (b.dias === null) || (a.dias || 0) - (b.dias || 0));
}

/* Por contrato: quantos registros e quantos em aberto (cor do sino em Contratos). */
function resumoPorContrato(db) {
  const r = {};
  for (const h of db.historicoContratos || []) {
    const k = String(h.contratoId);
    r[k] = r[k] || { total: 0, abertos: 0 };
    r[k].total++;
    if (h.situacao === 'aberta') r[k].abertos++;
  }
  return r;
}

const abertosDoContrato = (db, contratoId) => (db.historicoContratos || []).filter(h => String(h.contratoId) === String(contratoId) && h.situacao === 'aberta').length;

/* Linha do tempo: os registros + o que veio das pastas. */
function linhaDoTempo(db, contratoId, hoje = hojeLocal()) {
  const c = (db.contratos || []).find(x => String(x.id) === String(contratoId));
  if (!c) return null;
  const doContrato = x => String(x.contratoId) === String(c.id) || (!x.contratoId && x.contrato && x.contrato === c.numero);
  const itens = (db.historicoContratos || []).filter(h => String(h.contratoId) === String(c.id))
    .map(h => ({ origem: 'registro', ...h, tipoRotulo: TIPOS[h.tipo] || h.tipo, situacaoRotulo: SITUACOES[h.situacao] || h.situacao }));
  // Só o essencial do termo: o "objeto" lido costuma ser o preâmbulo inteiro do documento.
  const reais = v => Number(v) ? `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '';
  const termo = (lista, especie) => (lista || []).filter(doContrato).forEach(t => itens.push({
    origem: 'pasta', tipo: especie.toLowerCase(), tipoRotulo: especie, data: String(t.data || '').slice(0, 10),
    descricao: [`${especie} ${t.numero || ''}`.trim(), t.tipo, Number(t.meses) ? `+${t.meses} meses` : '', reais(t.valor)].filter(Boolean).join(' — '),
    documento: t.documento || ''
  }));
  termo(db.aditivos, 'Aditivo');
  termo(db.apostilamentos, 'Apostilamento');
  try {
    const { requisicoesDoContrato } = require('./visaoContrato');
    const r = requisicoesDoContrato(db, c, hoje);
    for (const g of r.tce) itens.push({ origem: 'pasta', tipo: 'requisicao_tce', tipoRotulo: 'Requisição do TCE', data: String(g.data || '').slice(0, 10),
      descricao: [g.requisicao && `Requisição ${g.requisicao}`, g.tc && `TC ${g.tc}`, g.resposta && g.resposta.rotulo].filter(Boolean).join(' · ') || 'Requisição do TCE' });
    for (const s of r.sisfin) itens.push({ origem: 'pasta', tipo: 'requisicao_sisfin', tipoRotulo: 'Requisição SisFin', data: String(s.data || '').slice(0, 10),
      descricao: [s.requisicao, s.tipo, s.situacao].filter(Boolean).join(' · ') || 'Requisição SisFin' });
  } catch (e) { /* requisições ainda não lidas: a linha do tempo segue sem elas */ }
  // Mais recente primeiro; sem data vai para o fim.
  itens.sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')) || (Number(b.id) || 0) - (Number(a.id) || 0));
  return { contrato: { id: c.id, numero: c.numero, empresa: c.empresa }, itens, abertos: abertosDoContrato(db, c.id) };
}

const dataBr = iso => { const m = String(iso || '').match(/^(d{4})-(d{2})-(d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };

/* Planilha da linha do tempo (para atender o TC ou a direção). */
function gerarCsv(linha) {
  const { montar } = require('./planilhaCsv');
  const cab = ['Data', 'Origem', 'Tipo', 'Solicitante', 'Documento', 'Descrição', 'Prazo de resposta', 'Situação', 'Respondido em', 'Registrado por', 'Registrado em', 'Correções', 'Arquivo'];
  const linhas = linha.itens.map(i => [dataBr(i.data), i.origem === 'pasta' ? 'Lido da pasta' : 'Registro', i.tipoRotulo, i.solicitante || '', i.documento || '', i.descricao || '',
    dataBr(i.prazoResposta), i.situacaoRotulo || '', dataBr(i.respondidoEm), i.registradoPor || '', i.registradoEm ? new Date(i.registradoEm).toLocaleString('pt-BR') : '',
    (i.versoes || []).map(v => `${new Date(v.alteradoEm).toLocaleString('pt-BR')} ${v.alteradoPor}: ${v.motivo}`).join(' | '), i.arquivo || '']);
  return montar(cab, linhas);
}

function gerarPdf(linha, destino) {
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  doc.pipe(destino);
  const t = v => String(v || '').normalize('NFC');
  doc.fontSize(15).font('Helvetica-Bold').text(`Histórico administrativo — contrato ${t(linha.contrato.numero)}`, { align: 'center' });
  doc.moveDown(0.2).fontSize(10).font('Helvetica').fillColor('#444').text(t(linha.contrato.empresa), { align: 'center' });
  doc.moveDown(0.2).fontSize(8.5).text(`Central de Contratos — SETEC, Prefeitura de Itaverde. Gerado em ${new Date().toLocaleString('pt-BR')}. ${linha.itens.length} evento(s), ${linha.abertos} em aberto.`, { align: 'center' });
  doc.moveDown(1).fillColor('#000');
  if (!linha.itens.length) doc.fontSize(10).text('Nenhum evento registrado para este contrato.');
  for (const i of linha.itens) {
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#333').text(`${dataBr(i.data) || 'sem data'} · ${t(i.tipoRotulo)}${i.origem === 'pasta' ? ' (lido da pasta)' : ''}${i.situacaoRotulo ? ` · ${i.situacaoRotulo}` : ''}`);
    const det = [i.solicitante && `Solicitante: ${t(i.solicitante)}`, i.documento && `Documento: ${t(i.documento)}`, i.prazoResposta && `Prazo: ${dataBr(i.prazoResposta)}`, i.respondidoEm && `Respondido em ${dataBr(i.respondidoEm)}`].filter(Boolean).join(' · ');
    if (det) doc.fontSize(8.5).font('Helvetica').fillColor('#555').text(det);
    doc.fontSize(10).font('Helvetica').fillColor('#000').text(t(i.descricao) || '—');
    if (i.registradoPor) doc.fontSize(8).fillColor('#666').text(`Registrado por ${t(i.registradoPor)} em ${new Date(i.registradoEm).toLocaleString('pt-BR')}${(i.versoes || []).length ? ` · corrigido ${i.versoes.length} vez(es): ${i.versoes.map(v => `${new Date(v.alteradoEm).toLocaleDateString('pt-BR')} por ${t(v.alteradoPor)} (${t(v.motivo)})`).join('; ')}` : ''}`);
    doc.moveDown(0.7);
  }
  doc.end();
}

module.exports = { TIPOS, SITUACOES, validar, registrar, corrigir, migrarTratativas, pendentes, resumoPorContrato, abertosDoContrato, linhaDoTempo, gerarCsv, gerarPdf };
