/* ===================================================================
   integrations/leiturasReportadas.js

   "Leitura errada" (01/10/2026): quem confere um campo lido do documento e
   acha erro registra o que foi lido, o que é o certo e em que documento.
   A correção do dado continua sendo feita onde sempre foi (aprovação na
   Fila, conferência da requisição); esta lista é a base para ajustar as
   REGRAS de leitura com casos reais — cada uma vira um caso de teste.
=================================================================== */
const MAX = 1000;
const texto = (v, max) => (v === undefined || v === null) ? null : String(v).trim().slice(0, max) || null;

function registrar(db, dados, usuario) {
  const d = dados || {};
  const campo = texto(d.campo, 120);
  const valorCorreto = texto(d.valorCorreto, 500);
  if (!campo) throw new Error('Informe o campo.');
  if (!valorCorreto && !texto(d.observacao, 500)) throw new Error('Diga qual é o valor certo (ou explique na observação).');
  db.leiturasReportadas = db.leiturasReportadas || [];
  const id = Math.max(0, ...db.leiturasReportadas.map(x => Number(x.id) || 0)) + 1;
  const reg = {
    id, onde: texto(d.onde, 60) || 'Central', referencia: texto(d.referencia, 120), campo,
    valorLido: texto(d.valorLido, 500), valorCorreto, documento: texto(d.documento, 260), observacao: texto(d.observacao, 500),
    status: 'aberta', por: usuario || 'Usuário', em: new Date().toISOString()
  };
  db.leiturasReportadas.unshift(reg);
  if (db.leiturasReportadas.length > MAX) db.leiturasReportadas.length = MAX;
  return reg;
}

function resolver(db, id, nota, usuario) {
  const r = (db.leiturasReportadas || []).find(x => String(x.id) === String(id));
  if (!r) throw new Error('Registro não encontrado.');
  r.status = r.status === 'resolvida' ? 'aberta' : 'resolvida';
  r.resolvidaPor = r.status === 'resolvida' ? (usuario || 'Usuário') : null;
  r.resolvidaEm = r.status === 'resolvida' ? new Date().toISOString() : null;
  r.notaResolucao = r.status === 'resolvida' ? texto(nota, 300) : null;
  return r;
}

function gerarCsv(db) {
  const planilhaCsv = require('./planilhaCsv');
  return planilhaCsv.montar(['Id', 'Onde', 'Referência', 'Campo', 'Valor lido', 'Valor certo', 'Documento', 'Observação', 'Situação', 'Reportado por', 'Em'],
    (db.leiturasReportadas || []).map(r => [r.id, r.onde, r.referencia, r.campo, r.valorLido, r.valorCorreto, r.documento, r.observacao, r.status, r.por, planilhaCsv.formatarValor({ tipo: 'data' }, String(r.em).slice(0, 10))]));
}

module.exports = { registrar, resolver, gerarCsv };
