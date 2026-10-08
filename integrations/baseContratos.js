/* ===================================================================
   integrations/baseContratos.js

   Base de Contratos: uma tabela única com os dados que a Ferramenta 1
   leu dos arquivos de contrato — pensada para virar base de dados
   (consulta, filtro, exportação para planilha/BI).

   ------------------------------------------------------------------
   A regra que define esta base: leitura automática ≠ dado conferido
   ------------------------------------------------------------------
   Uma base que misturasse o que foi LIDO com o que alguém CONFIRMOU
   contaminaria qualquer relatório construído em cima dela, sem ninguém
   perceber (a IA, retirada em 01/10/2026, chegou a inventar quatro datas
   e um valor num único contrato). Por isso cada linha diz de onde vêm os
   seus valores:

     - "Aprovada": a proposta passou pela revisão humana. Os valores
       mostrados são os do CONTRATO depois da aprovação — o registro
       confirmado. É o que vale para a base.
     - "Pendente de revisão": ninguém conferiu ainda. Os valores são os
       da leitura dos documentos, com a procedência campo a campo.

   A exportação traz por padrão só as aprovadas; exportar todas é uma
   escolha explícita, e mesmo assim a coluna de situação vai junto.

   Uma linha por contrato (pelo número): se o mesmo contrato foi lido
   mais de uma vez, vale a leitura mais recente. Proposta sem número não
   entra — sem número não há como identificar o registro, e foi
   exatamente uma proposta assim que gerou o contrato "(sem número)"
   removido em 21/09/2026.
=================================================================== */

const planilhaCsv = require('./planilhaCsv');
const { hojeLocal } = require('./dataLocal');
const valorTotalContrato = require('./valorTotalContrato');

/* Colunas da base, na ordem da tabela e da planilha. `chave` é o nome do
   campo no cadastro de contratos (o mesmo usado pela extração). */
const COLUNAS = [
  { chave: 'numero', rotulo: 'Número' },
  { chave: 'pa', rotulo: 'Processo Adm.' },
  { chave: 'empresa', rotulo: 'Empresa' },
  { chave: 'cnpjEmpresa', rotulo: 'CNPJ' },
  { chave: 'objeto', rotulo: 'Objeto' },
  { chave: 'secretaria', rotulo: 'Secretaria' },
  { chave: 'tipoContratacao', rotulo: 'Modalidade' },
  // rotuloCurto: cabeçalho da tabela na tela; a planilha usa o rótulo completo.
  { chave: 'inicio', rotulo: 'Início da vigência', rotuloCurto: 'Início', tipo: 'data' },
  { chave: 'termino', rotulo: 'Término da vigência', rotuloCurto: 'Término', tipo: 'data' },
  { chave: 'valor', rotulo: 'Valor mensal (R$)', rotuloCurto: 'Valor mensal', tipo: 'valor' },
  /* Valor total = valor inicial + termos de valor (o numerador da média
     mensal) — calculado, não é campo do cadastro (ver valorTotalContrato.js). */
  { chave: 'valorTotal', rotulo: 'Valor total (R$)', rotuloCurto: 'Valor total', tipo: 'valor', calculado: true }
];

/* 'ia', 'busca_local_corrigiu_ia' e 'inferido' só existem em propostas
   gravadas antes da retirada da IA (01/10/2026). */
const ROTULO_PROCEDENCIA = {
  ia: 'lido pela IA (leitura antiga)',
  busca_local: 'lido do documento',
  busca_local_corrigiu_ia: 'lido do documento (corrigiu a IA)',
  inferido: 'INFERIDO — não está no documento',
  atualizado_na_aprovacao: 'atualizado na aprovação',
  confirmado: 'confirmado',
  manual: 'informado à mão (Pendências de leitura)',
  calculado: 'calculado: valor inicial + aditivos e apostilamentos de valor'
};

const vazio = v => v === undefined || v === null || v === '';

/* Procedência de uma proposta pendente. Propostas gravadas antes de
   existir o campo `procedencia` (até 21/09/2026) só têm a lista de
   correções da busca local — reconstrói o que dá a partir dela e marca o
   resto como leitura da IA (era o que havia então), sem inventar. */
function procedenciaDaProposta(p) {
  if (p.procedencia && typeof p.procedencia === 'object') return { ...p.procedencia };
  const procedencia = {};
  Object.keys(p.campos || {}).forEach(c => { if (!vazio(p.campos[c])) procedencia[c] = 'ia'; });
  (p.camposCorrigidosPorRegex || []).forEach(c => { procedencia[c.campo] = 'busca_local_corrigiu_ia'; });
  return procedencia;
}

function linhaAprovada(p, contrato) {
  const valores = {};
  const procedencia = {};
  const trocados = new Set((p.camposSobrescritos || []).map(s => s.campo));
  COLUNAS.filter(c => !c.calculado).forEach(({ chave }) => {
    valores[chave] = vazio(contrato[chave]) ? null : contrato[chave];
    if (valores[chave] !== null) procedencia[chave] = trocados.has(chave) ? 'atualizado_na_aprovacao' : 'confirmado';
  });
  const total = valorTotalContrato.doContrato(null, contrato, p);
  valores.valorTotal = total ? total.valor : null;
  if (total) procedencia.valorTotal = 'calculado';
  return {
    situacao: 'aprovada',
    propostaId: p.id,
    contratoId: contrato.id,
    valores,
    procedencia,
    camposInferidos: [],
    revisadoPor: p.aprovadoPor || null,
    revisadoEm: p.aprovadoEm || null,
    lidoEm: p.criadoEm || null,
    documentos: (p.arquivosFonte || []).map(f => f.nome),
    origemOficial: !!contrato.origemExterna
  };
}

function linhaPendente(p) {
  const valores = {};
  COLUNAS.filter(c => !c.calculado).forEach(({ chave }) => { valores[chave] = vazio((p.campos || {})[chave]) ? null : p.campos[chave]; });
  const total = valorTotalContrato.daProposta(p);
  valores.valorTotal = total ? total.valor : null;
  const procedencia = procedenciaDaProposta(p);
  if (total) procedencia.valorTotal = 'calculado';
  return {
    situacao: 'pendente',
    propostaId: p.id,
    contratoId: p.contratoExistenteId || null,
    valores,
    procedencia,
    camposInferidos: COLUNAS.map(c => c.chave).filter(c => procedencia[c] === 'inferido'),
    revisadoPor: null,
    revisadoEm: null,
    lidoEm: p.criadoEm || null,
    documentos: (p.arquivosFonte || []).map(f => f.nome),
    origemOficial: false
  };
}

/* Monta a base a partir de db.importacoesPendentes (propostas) e
   db.contratos (registro confirmado das aprovadas). Função pura: não
   escreve nada, não chama rede — é o que permite testar a regra acima. */
function montarBase(db) {
  const contratosPorId = new Map((db.contratos || []).map(c => [String(c.id), c]));
  // Mais recente primeiro: a primeira proposta vista para cada número é a que vale.
  const propostas = (db.importacoesPendentes || [])
    .filter(p => p.status === 'aprovado' || p.status === 'pendente')
    .slice()
    .sort((a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')) || (Number(b.id) - Number(a.id)));

  const vistos = new Set();
  const linhas = [];
  for (const p of propostas) {
    let linha;
    if (p.status === 'aprovado') {
      const contrato = contratosPorId.get(String(p.contratoId));
      // Aprovada cujo contrato não existe mais (foi removido): não faz
      // parte da base — não há registro confirmado a mostrar.
      if (!contrato) continue;
      linha = linhaAprovada(p, contrato);
    } else {
      linha = linhaPendente(p);
    }
    const numero = String(linha.valores.numero || '').trim();
    if (!numero || vistos.has(numero)) continue;
    vistos.add(numero);
    linhas.push(linha);
  }

  return {
    colunas: COLUNAS,
    rotulosProcedencia: ROTULO_PROCEDENCIA,
    linhas,
    totais: {
      contratos: linhas.length,
      aprovadas: linhas.filter(l => l.situacao === 'aprovada').length,
      pendentes: linhas.filter(l => l.situacao === 'pendente').length,
      camposInferidos: linhas.reduce((soma, l) => soma + l.camposInferidos.length, 0)
    }
  };
}

/* ------------------------------------------------------------------
   Detalhe de uma linha ("Visualizar"): tudo o que foi lido e calculado
   para o contrato, inclusive o que a tabela não mostra — os 14 campos
   com a procedência de cada um, a conta do valor mensal e da vigência,
   os documentos lidos, o cadastro atual (Central/SGC, com as parcelas do
   valor no SGC) e os termos que o SGC tem cadastrados. Só leitura.
------------------------------------------------------------------ */
function montarDetalhe(db, propostaId) {
  const p = (db.importacoesPendentes || []).find(x => String(x.id) === String(propostaId));
  if (!p) return null;
  const contratoId = p.status === 'aprovado' ? p.contratoId : p.contratoExistenteId;
  const contrato = contratoId ? (db.contratos || []).find(c => String(c.id) === String(contratoId)) : null;
  const numero = (contrato && contrato.numero) || (p.campos && p.campos.numero) || null;
  const termosSgc = numero ? [
    ...(db.aditivos || []).filter(a => a.contrato === numero).map(a => ({ especie: 'Aditivo', numero: a.numero, tipo: String(a.tipo || '').trim(), data: a.data || null })),
    ...(db.apostilamentos || []).filter(a => a.contrato === numero).map(a => ({ especie: 'Apostilamento', numero: a.numero, tipo: String(a.tipo || '').trim(), data: a.data || null }))
  ].sort((a, b) => String(a.data || '').localeCompare(String(b.data || ''))) : [];
  const ficha = contrato ? (db.fichasCadastro || []).find(f => String(f.contratoId) === String(contrato.id)) : null;
  const mapa = contrato ? (db.mapasRisco || []).find(m => String(m.contratoId) === String(contrato.id)) : null;
  return {
    proposta: {
      id: p.id, status: p.status, criadoEm: p.criadoEm || null,
      aprovadoPor: p.aprovadoPor || null, aprovadoEm: p.aprovadoEm || null,
      campos: p.campos || {}, confiancas: p.confiancas || {}, procedencia: procedenciaDaProposta(p),
      modeloUsado: p.modeloUsado || null, observacao: p.observacao || null,
      camposExtras: p.camposExtras || null, camposExtrasPedidos: p.camposExtrasPedidos || null,
      calculoValor: p.calculoValor || null, calculoVigencia: p.calculoVigencia || null,
      arquivosFonte: p.arquivosFonte || [], trechosConsultados: p.trechosConsultados || null,
      // De qual documento veio cada campo lido por regra, e a cadeia de
      // gestores do contrato — ver camposPorRegra.js.
      origemRegra: p.origemRegra || null, gestaoHistorico: p.gestaoHistorico || null,
      camposSobrescritos: p.camposSobrescritos || []
    },
    contrato: contrato ? {
      id: contrato.id, numero: contrato.numero, empresa: contrato.empresa, cnpjEmpresa: contrato.cnpjEmpresa || null,
      objeto: contrato.objeto || null, tipo: contrato.tipo || null, status: contrato.status || null,
      secretaria: contrato.secretaria || null, responsavel: contrato.responsavel || null, suplente: contrato.suplente || null,
      preposto: contrato.preposto || null, pa: contrato.pa ? String(contrato.pa).trim() : null, tipoContratacao: contrato.tipoContratacao || null,
      inicio: contrato.inicio || null, termino: contrato.termino || null, valor: contrato.valor ?? null,
      origemExterna: !!contrato.origemExterna, sincronizadoEm: contrato.sincronizadoEm || null,
      sgcValores: contrato.sgcValores || null
    } : null,
    termosSgc,
    ficha: ficha ? { id: ficha.id, geradoEm: ficha.geradoEm } : null,
    mapaRisco: mapa ? { riscoGeralLabel: mapa.riscoGeralLabel || null, geradoEm: mapa.geradoEm } : null
  };
}

/* ------------------------------------------------------------------
   Exportação CSV — formato e neutralização de fórmula em planilhaCsv.js
------------------------------------------------------------------ */
/* `escopo`: 'aprovadas' (padrão — só dado conferido) ou 'todas'. */
function gerarCsv(base, escopo) {
  const linhas = escopo === 'todas' ? base.linhas : base.linhas.filter(l => l.situacao === 'aprovada');
  const cabecalho = [...COLUNAS.map(c => c.rotulo), 'Situação', 'Campos inferidos (não estão no documento)', 'Procedência', 'Revisado por', 'Revisado em', 'Documentos lidos'];
  const corpo = linhas.map(l => [
    ...COLUNAS.map(c => planilhaCsv.formatarValor(c, l.valores[c.chave])),
    l.situacao === 'aprovada' ? 'Aprovada' : 'Pendente de revisão',
    l.camposInferidos.map(c => (COLUNAS.find(x => x.chave === c) || { rotulo: c }).rotulo).join(', '),
    Object.entries(l.procedencia).map(([c, p]) => `${c}: ${ROTULO_PROCEDENCIA[p] || p}`).join('; '),
    l.revisadoPor || '',
    l.revisadoEm ? hojeLocal(String(l.revisadoEm)).split('-').reverse().join('/') : '',
    l.documentos.join(', ')
  ]);
  return planilhaCsv.montar(cabecalho, corpo);
}

module.exports = { COLUNAS, montarBase, montarDetalhe, gerarCsv };
