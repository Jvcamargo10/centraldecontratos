/* ===================================================================
   integrations/visaoContrato.js

   Tudo de um contrato num lugar só (01/10/2026). Antes, para entender um
   contrato, era preciso abrir 5 telas: Mapa de risco, Registro de riscos,
   Requisições, Relatórios mensais e Pendências de leitura. Aqui: o risco
   de hoje e os pontos que pesam, a cobertura dos relatórios mensais, as
   requisições do TCE (com a situação da resposta) e do SisFin, a
   garantia, o termo de encerramento a confirmar e as tratativas abertas.
   Só junta o que os outros módulos já calculam — nada novo é lido.
=================================================================== */
const { hojeLocal } = require('./dataLocal');

function montarVisao(db, contratoId, hoje = hojeLocal()) {
  const c = (db.contratos || []).find(x => String(x.id) === String(contratoId));
  if (!c) return null;
  const mapa = require('./mapaRiscoContratos');
  const relatorios = require('./relatoriosMensais');
  const registroRiscos = require('./registroRiscos');

  const risco = mapa.riscoAtualDoContrato(db, c);
  const reg = registroRiscos.montarRegistro(db, c.id, hoje);
  // Contrato encerrado sai do Mapa: "vencido" e "limite" seriam ruído.
  const pontos = risco.encerrado ? [] : (reg ? [...reg.automaticos, ...reg.riscos] : []).filter(r => r.status === 'Ativo' && (r.criticidade || 0) >= 6)
    .sort((a, b) => (b.criticidade || 0) - (a.criticidade || 0)).slice(0, 6)
    .map(r => ({ codigo: r.codigo || null, titulo: r.titulo || r.descricao, criticidade: r.criticidade, criterio: r.criterio, resposta: r.resposta || null }));

  let cobertura = null;
  try { cobertura = relatorios.coberturaDoContrato(db, c, new Date(`${hoje}T12:00:00`)); } catch (e) { cobertura = null; }

  const { tce, enviadas, sisfin } = requisicoesDoContrato(db, c, hoje);

  const diasAte = iso => iso ? Math.round((new Date(`${iso}T12:00:00`) - new Date(`${hoje}T12:00:00`)) / 86400000) : null;
  return {
    contrato: { id: c.id, numero: c.numero, status: c.status, inicio: c.inicio, termino: c.termino, diasParaVencer: diasAte(c.termino) },
    risco: { nivel: risco.nivel, label: risco.label, resumo: risco.resumo, encerrado: !!risco.encerrado, pontos },
    relatorios: cobertura ? (cobertura.naoExige ? { naoExige: true } : {
      entregues: cobertura.entregues, esperados: cobertura.esperados, percentual: cobertura.percentual,
      faltando: cobertura.faltando, aguardando: cobertura.aguardando, ultimo: cobertura.ultimo, ultimos12: cobertura.ultimos12, processo: cobertura.processo
    }) : { naoLido: !db.relatoriosMensais },
    requisicoes: { tce, enviadas, sisfin },
    garantia: c.garantiaLida ? { fim: c.garantiaLida.fim, arquivo: c.garantiaLida.arquivo, diasParaVencer: diasAte(c.garantiaLida.fim) } : (c.garantiaVerificadaEm ? { semValidade: true, documentos: Number(c.garantiaDocumentos) || 0 } : null),
    encerramento: c.encerramentoDetectado && c.status !== 'Encerrado' ? { arquivo: c.encerramentoDetectado.arquivo, data: c.encerramentoDetectado.data || null } : null,
    // Registros em aberto no Histórico administrativo (as tratativas viraram registros dele em 06/10/2026).
    historicoAbertos: require('./historicoContrato').abertosDoContrato(db, c.id),
    prazos: require('./prazosContrato').faixasDoContrato(db, c.id)
  };
}

/* Requisições (TCE e SisFin) ligadas ao contrato — também usadas na
   linha do tempo do Histórico administrativo. */
function requisicoesDoContrato(db, c, hoje = hojeLocal()) {
  const requisicoes = require('./requisicoes');
  const { chavePa } = requisicoes;
  const lista = requisicoes.listar(db, hoje);
  const doContrato = g => (g.contrato && String(g.contrato.id) === String(c.id)) || (g.ficha && g.ficha.contrato === c.numero) || (chavePa(g.pa) && chavePa(g.pa) === chavePa(c.pa));
  const tce = lista.tce.filter(g => g.status !== 'descartada' && doContrato(g)).map(g => ({ chave: g.chave, requisicao: g.ficha.requisicao, tc: g.ficha.tc, data: g.ficha.data, resposta: g.resposta }));
  const enviadas = lista.analisadas.filter(a => (a.campos && a.campos.contrato === c.numero) || (a.processo && chavePa(a.processo.pa) && chavePa(a.processo.pa) === chavePa(c.pa)))
    .map(a => ({ analiseId: a.id, requisicao: (a.campos && (a.campos.requisicao || a.campos.tc)) || a.nomeArquivo, data: a.campos && a.campos.data, resposta: a.resposta }));
  const sisfin = lista.sisfin.filter(g => g.status !== 'descartada' && doContrato(g))
    .map(g => ({ requisicao: `${g.campos.codigo} ${g.campos.numero || ''}`.trim(), tipo: g.campos.tipoDocumento, data: g.campos.data, valorTotal: g.campos.valorTotal, situacao: g.campos.situacao }));
  return { tce, enviadas, sisfin };
}

module.exports = { montarVisao, requisicoesDoContrato };
