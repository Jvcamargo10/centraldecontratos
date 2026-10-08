/* ===================================================================
   integrations/pendenciasLeitura.js

   "Por que não calculou": as propostas pendentes agrupadas pelo MOTIVO
   de faltar término, início ou valor mensal.

   Medido em 22/09/2026, com 31 propostas pendentes: 19 estavam sem
   término e 12 sem início. Abrir uma por uma para descobrir o porquê
   custava mais do que resolver — e o porquê quase sempre se repetia. O
   caso mais comum (13 propostas) é o mesmo: o contrato conta os meses da
   ORDEM DE INÍCIO, e a ordem não está na pasta de rede. Sabendo disso,
   quem cuida do contrato informa uma data e o término sai pela mesma
   regra de sempre (ver vigenciaContratual.js) — sem digitar data
   calculada à mão.

   Três funções, nesta ordem de uso:
     resumir(db)            — os grupos e o que resolve cada um (só leitura)
     trechos(db, id)        — os pedaços dos documentos que falam do assunto
     aplicarDadoManual(...) — grava o dado informado e recalcula

   Nada aqui inventa dado: o que é informado à mão fica marcado como
   'manual' na procedência do campo, aparece como tal na Base de
   Contratos e na Fila, e pode ser conferido no histórico da proposta.
=================================================================== */

const extratorDocumento = require('./extratorDocumento');
const vigenciaContratual = require('./vigenciaContratual');
const textoDeProposta = require('./textoDeProposta');

const vazio = v => v === undefined || v === null || v === '';

/* Cada grupo diz: o que está faltando, por que, e o que resolve. `pede`
   são os campos do formulário da tela — o mínimo para o cálculo sair. */
const GRUPOS = [
  {
    chave: 'ordem_inicio',
    titulo: 'Falta a data da Ordem de Início',
    explicacao: 'O contrato conta a vigência a partir da Ordem de Início, e esse documento não está na pasta de rede. Com a data, o término sai pela regra (data + meses de vigência, mais as prorrogações).',
    comoResolver: 'Informe a data da Ordem de Início (ela costuma estar no processo físico ou no e-mail de autorização).',
    pede: ['dataMarco'],
    campos: ['inicio', 'termino']
  },
  {
    chave: 'sem_marco',
    titulo: 'O contrato não diz de quando conta a vigência',
    explicacao: 'A cláusula de vigência não diz se os meses contam da assinatura ou da Ordem de Início, então não há de onde partir.',
    comoResolver: 'Confira no contrato e informe a data em que a vigência começou.',
    pede: ['dataMarco'],
    campos: ['inicio', 'termino']
  },
  {
    chave: 'sem_assinatura',
    titulo: 'Falta a data de assinatura',
    explicacao: 'A vigência conta da assinatura, mas o fecho "Itaverde, ..." não foi lido — costuma estar na última página, que pode não ter sido digitalizada ou lida por OCR.',
    comoResolver: 'Informe a data de assinatura do contrato.',
    pede: ['dataMarco'],
    campos: ['inicio', 'termino']
  },
  {
    chave: 'prorrogacao_sem_inicio',
    titulo: 'Prorrogação sem data de início',
    explicacao: 'Um termo prorroga o contrato, mas não diz a partir de quando, e o período anterior também não tem término conhecido.',
    comoResolver: 'Resolva antes o período inicial; se ele já estiver certo, informe a data em que a prorrogação começou.',
    pede: ['dataMarco'],
    campos: ['termino']
  },
  {
    chave: 'sem_vigencia',
    titulo: 'Vigência não encontrada nos documentos',
    explicacao: 'Não foi possível ler nem os meses de vigência nem o marco inicial — o documento pode estar sem texto legível, ou a pasta pode não ter o contrato (só extrato ou termos).',
    comoResolver: 'Informe a data de início e a vigência em meses, conferindo no contrato.',
    pede: ['dataMarco', 'meses'],
    campos: ['inicio', 'termino']
  },
  {
    /* Regra do usuário (24/09/2026): sem Ordem de Início na pasta, o término
       é contado da assinatura. Não bloqueia nada — é para quem tiver a data
       real da Ordem poder corrigir. */
    chave: 'ordem_presumida',
    titulo: 'Confirmar: término contado da assinatura',
    explicacao: 'O contrato conta a vigência da Ordem de Início, que não está na pasta de rede. Pela regra da Prefeitura, os meses foram contados da data de assinatura. Se a Ordem de Início tiver outra data, o contrato vence depois.',
    comoResolver: 'Se tiver a Ordem de Início, informe a data dela (ou arquive o documento na pasta "Ordem de Início de Serviço" do processo). Se não, nada a fazer.',
    pede: ['dataMarco'],
    campos: ['inicio', 'termino']
  },
  {
    chave: 'sem_valor',
    titulo: 'Valor mensal não calculado',
    explicacao: 'O valor global ou a vigência não foram encontrados no contrato, então a média mensal ((valor + aditivos) ÷ meses) não pôde ser calculada.',
    comoResolver: 'Informe o valor mensal conferido no contrato (ou resolva a vigência acima, que muitas vezes é o que falta).',
    pede: ['valorMensal'],
    campos: ['valor']
  }
];

const PEDIDOS = {
  dataMarco: { rotulo: 'Data de início da contagem', tipo: 'date', dica: 'Ordem de Início, assinatura ou início do período — conforme o caso acima.' },
  meses: { rotulo: 'Vigência em meses', tipo: 'number', dica: 'Só os meses do período inicial; as prorrogações já lidas continuam valendo.' },
  valorMensal: { rotulo: 'Valor mensal (R$)', tipo: 'number', dica: 'Use ponto para os centavos (ex.: 84250.00).' }
};

/* Qual grupo explica a falta desta proposta. A ordem importa: o primeiro
   que casar é o que se resolve primeiro. */
function motivosDaProposta(p) {
  const cv = p.calculoVigencia || null;
  const cvalor = p.calculoValor || null;
  const campos = p.campos || {};
  const avisos = (cv && cv.avisos) || [];
  const achou = re => avisos.find(a => re.test(a));
  const motivos = [];

  if (vazio(campos.termino)) {
    const ordem = achou(/Ordem de Início, e (?:a data dela não está|nem ela nem a data de assinatura)/i);
    const semMarco = achou(/não diz de quando conta a vigência/i);
    const semAssinatura = achou(/data de assinatura não foi encontrada/i);
    const prorrogacao = achou(/não diz a partir de quando/i);
    if (ordem) motivos.push({ chave: 'ordem_inicio', detalhe: ordem });
    else if (semMarco) motivos.push({ chave: 'sem_marco', detalhe: semMarco });
    else if (semAssinatura) motivos.push({ chave: 'sem_assinatura', detalhe: semAssinatura });
    else if (prorrogacao) motivos.push({ chave: 'prorrogacao_sem_inicio', detalhe: prorrogacao });
    else motivos.push({ chave: 'sem_vigencia', detalhe: cv && cv.memoria ? cv.memoria : 'Nenhuma cláusula de vigência foi lida nos documentos desta pasta.' });
  }
  // Término existe, mas contado da assinatura por falta da Ordem de Início.
  if (!vazio(campos.termino) && cv && cv.marcoPresumido && cv.marco === 'ordem' && !p.dadosManuais) {
    motivos.push({ chave: 'ordem_presumida', detalhe: achou(/calculados a partir da assinatura/i) || cv.memoria || '' });
  }
  if (vazio(campos.valor)) {
    motivos.push({
      chave: 'sem_valor',
      detalhe: (cvalor && ((cvalor.avisos || [])[0] || cvalor.memoria)) || 'Valor global ou vigência não encontrados no contrato.'
    });
  }
  return motivos;
}

function mesesConhecidos(p) {
  const periodos = (p.calculoVigencia && p.calculoVigencia.periodos) || [];
  const inicial = periodos.find(x => x.origem === 'contrato');
  return inicial ? inicial.meses : null;
}

/* Só leitura: nenhuma chamada de rede, nenhum acesso a disco. */
function resumir(db) {
  const porGrupo = new Map(GRUPOS.map(g => [g.chave, []]));
  const pendentes = (db.importacoesPendentes || []).filter(p => p.status === 'pendente');

  for (const p of pendentes) {
    for (const m of motivosDaProposta(p)) {
      const lista = porGrupo.get(m.chave);
      if (!lista) continue;
      lista.push({
        propostaId: p.id,
        numero: (p.campos && p.campos.numero) || null,
        empresa: (p.campos && p.campos.empresa) || null,
        pa: (p.campos && p.campos.pa) ? String(p.campos.pa).trim() : null,
        detalhe: m.detalhe,
        meses: mesesConhecidos(p),
        inicio: (p.campos && p.campos.inicio) || null,
        termino: (p.campos && p.campos.termino) || null,
        valor: (p.campos && p.campos.valor) != null ? p.campos.valor : null,
        documentos: (p.arquivosFonte || []).map(f => f.nome),
        dadosManuais: p.dadosManuais || null
      });
    }
  }

  const grupos = GRUPOS
    .map(g => ({ ...g, pedidos: g.pede.map(k => ({ chave: k, ...PEDIDOS[k] })), itens: (porGrupo.get(g.chave) || []).sort(ordenarPorNumero) }))
    .filter(g => g.itens.length);

  const comPendencia = new Set();
  grupos.forEach(g => g.itens.forEach(i => comPendencia.add(i.propostaId)));

  /* Termos de encerramento achados na pasta (ver termoEncerramento.js),
     esperando alguém confirmar — o contrato só vira Encerrado depois disso. */
  const encerramentos = (db.contratos || [])
    .filter(c => c.encerramentoDetectado && c.status !== 'Encerrado')
    .map(c => ({
      contratoId: c.id, numero: c.numero, empresa: c.empresa, pa: c.pa || null, termino: c.termino || null,
      data: c.encerramentoDetectado.data, motivo: c.encerramentoDetectado.motivo, citacao: c.encerramentoDetectado.citacao,
      arquivo: c.encerramentoDetectado.arquivo, caminho: c.encerramentoDetectado.caminho, detectadoEm: c.encerramentoDetectado.detectadoEm
    }))
    .sort(ordenarPorNumero);

  return {
    grupos,
    encerramentos,
    totais: {
      pendentes: pendentes.length,
      comPendencia: comPendencia.size,
      semTermino: pendentes.filter(p => vazio((p.campos || {}).termino)).length,
      semInicio: pendentes.filter(p => vazio((p.campos || {}).inicio)).length,
      semValor: pendentes.filter(p => vazio((p.campos || {}).valor)).length,
      resolvidasComDadoManual: pendentes.filter(p => p.dadosManuais).length
    }
  };
}

/* Decisão sobre um termo de encerramento achado na pasta:
     'confirmar' — o contrato passa a Encerrado, com a data e o motivo do
                   termo (e quem confirmou, quando, de qual arquivo);
     'descartar' — o termo não é o encerramento deste contrato (ou ainda
                   não vale); não volta a ser sugerido enquanto o arquivo
                   for o mesmo.
   Devolve o que mudou, para a Auditoria. */
function decidirEncerramento(db, contratoId, acao, usuarioNome) {
  const c = (db.contratos || []).find(x => String(x.id) === String(contratoId));
  if (!c) throw new Error('Contrato não encontrado.');
  const d = c.encerramentoDetectado;
  if (!d) throw new Error('Não há termo de encerramento pendente para este contrato.');
  const quando = new Date().toISOString();
  if (acao === 'confirmar') {
    c.status = 'Encerrado';
    if (d.data) c.dataEncerramento = d.data;
    c.encerramento = { data: d.data || null, motivo: d.motivo || null, arquivo: d.arquivo, caminho: d.caminho, citacao: d.citacao, confirmadoPor: usuarioNome || 'Usuário', confirmadoEm: quando };
    delete c.encerramentoDetectado;
    return { numero: c.numero, acao, data: d.data, arquivo: d.arquivo };
  }
  if (acao === 'descartar') {
    c.encerramentoDescartado = { caminho: d.caminho, assinatura: d.assinatura || null, por: usuarioNome || 'Usuário', em: quando };
    delete c.encerramentoDetectado;
    return { numero: c.numero, acao, data: d.data, arquivo: d.arquivo };
  }
  throw new Error('Ação inválida — use "confirmar" ou "descartar".');
}

function ordenarPorNumero(a, b) {
  const chave = n => {
    const m = String(n || '').match(/(\d+)\s*\/\s*(\d{4})/);
    return m ? `${m[2]}-${m[1].padStart(6, '0')}` : String(n || 'zzz');
  };
  return chave(b.numero).localeCompare(chave(a.numero));
}

/* ------------------------------------------------------------------
   Trechos dos documentos que falam do assunto — para conferir sem
   abrir o PDF. Só lê o que já está no cache de texto (nunca dispara
   OCR: esta tela é consultada muitas vezes seguidas).
------------------------------------------------------------------ */
const PALAVRAS = {
  ordem_inicio: [/ordem\s+de\s+in[íi]cio/i, /in[íi]cio\s+dos\s+servi[çc]os/i, /vig[êe]ncia/i],
  sem_marco: [/vig[êe]ncia/i, /prazo\s+de\s+vig[êe]ncia/i, /contad[ao]s?\s+a\s+partir/i],
  sem_assinatura: [/itaverde,\s*\d/i, /data\s+da\s+assinatura/i, /assinad[oa]/i],
  prorrogacao_sem_inicio: [/prorrog/i, /aditament/i],
  sem_vigencia: [/vig[êe]ncia/i, /prazo/i, /ordem\s+de\s+in[íi]cio/i],
  sem_valor: [/valor\s+(global|total|estimado|mensal)/i, /R\$\s*\d/i, /perfazendo/i]
};

function recortar(texto, indice, tamanho) {
  const antes = Math.max(0, indice - Math.round(tamanho * 0.35));
  const trecho = texto.slice(antes, antes + tamanho).replace(/\s+/g, ' ').trim();
  return (antes > 0 ? '…' : '') + trecho + (antes + tamanho < texto.length ? '…' : '');
}

async function trechos(db, propostaId, grupo) {
  const p = (db.importacoesPendentes || []).find(x => String(x.id) === String(propostaId));
  if (!p) return null;
  const padroes = PALAVRAS[grupo] || PALAVRAS.sem_vigencia;
  const encontrados = [];
  let semCache = 0;

  for (const f of (p.arquivosFonte || []).filter(f => f && f.caminho)) {
    let r = null;
    try { r = await extratorDocumento.extrairTexto(f.caminho, { apenasCache: true }); } catch (e) { r = null; }
    if (!r || r.semTexto) { semCache++; continue; }
    const texto = r.texto || '';
    for (const re of padroes) {
      const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      let m, achadosDoPadrao = 0;
      while ((m = global.exec(texto)) && achadosDoPadrao < 2 && encontrados.length < 12) {
        encontrados.push({ documento: f.nome, trecho: recortar(texto, m.index, 420) });
        achadosDoPadrao++;
      }
    }
  }

  // Mesmo trecho achado por dois padrões diferentes aparece uma vez só.
  const vistos = new Set();
  const unicos = encontrados.filter(t => {
    const chave = `${t.documento}|${t.trecho.slice(0, 80)}`;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });

  return {
    propostaId: p.id,
    numero: (p.campos && p.campos.numero) || null,
    trechos: unicos,
    documentosSemTexto: semCache,
    aviso: unicos.length ? null : (semCache
      ? 'Os documentos desta pasta ainda não foram lidos (ou estão sem texto legível) — rode a varredura antes de conferir por aqui.'
      : 'Nenhum trecho sobre o assunto foi encontrado no texto lido — confira direto no documento.')
  };
}

/* ------------------------------------------------------------------
   Gravar o dado informado à mão e recalcular pela mesma regra.
------------------------------------------------------------------ */
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

async function aplicarDadoManual(db, save, propostaId, dados, usuarioNome) {
  const p = (db.importacoesPendentes || []).find(x => String(x.id) === String(propostaId));
  if (!p) throw new Error('Proposta não encontrada.');
  if (p.status !== 'pendente') throw new Error('Esta proposta já foi revisada — o dado manual só vale para propostas pendentes.');

  const entrada = dados || {};
  const dataMarco = entrada.dataMarco ? String(entrada.dataMarco).trim() : null;
  const meses = entrada.meses !== undefined && entrada.meses !== null && String(entrada.meses).trim() !== '' ? Number(entrada.meses) : null;
  const valorMensal = entrada.valorMensal !== undefined && entrada.valorMensal !== null && String(entrada.valorMensal).trim() !== '' ? Number(entrada.valorMensal) : null;
  const observacao = entrada.observacao ? String(entrada.observacao).trim().slice(0, 300) : null;

  if (dataMarco && !DATA_ISO.test(dataMarco)) throw new Error('Data inválida — use o formato AAAA-MM-DD.');
  if (dataMarco) {
    const d = new Date(dataMarco + 'T00:00:00');
    if (isNaN(d) || d.getFullYear() < 1990 || d.getFullYear() > 2100) throw new Error('Data fora do intervalo esperado (1990–2100).');
  }
  if (meses !== null && (!Number.isFinite(meses) || meses <= 0 || meses > 600)) throw new Error('Vigência em meses inválida (1 a 600).');
  if (valorMensal !== null && (!Number.isFinite(valorMensal) || valorMensal <= 0)) throw new Error('Valor mensal inválido.');
  if (dataMarco === null && meses === null && valorMensal === null) throw new Error('Informe pelo menos um dado.');

  p.campos = p.campos || {};
  p.procedencia = (p.procedencia && typeof p.procedencia === 'object') ? p.procedencia : {};
  p.confiancas = p.confiancas || {};
  const antes = { inicio: p.campos.inicio ?? null, termino: p.campos.termino ?? null, valor: p.campos.valor ?? null };

  p.dadosManuais = {
    ...(p.dadosManuais || {}),
    ...(dataMarco ? { dataMarco } : {}),
    ...(meses !== null ? { meses } : {}),
    ...(valorMensal !== null ? { valorMensal } : {}),
    ...(observacao ? { observacao } : {}),
    por: usuarioNome || 'Usuário',
    em: new Date().toISOString()
  };

  // Vigência: recalcula pela regra, com a data/meses informados entrando
  // só onde a leitura não achou nada.
  let recalculou = false;
  if (dataMarco || meses !== null) {
    const texto = await textoDeProposta.doCache(p);
    if (texto) {
      const vig = vigenciaContratual.calcularVigencia(texto, p.campos.numero, {
        marcoInformado: dataMarco ? { data: dataMarco, por: p.dadosManuais.por, observacao } : null,
        mesesInformados: meses
      });
      p.calculoVigencia = {
        memoria: vig.memoria, inicio: vig.inicio, fonteInicio: vig.fonteInicio,
        termino: vig.termino, marco: vig.marco, marcoPresumido: !!vig.marcoPresumido, rotuloInicio: vig.rotuloInicio, assinatura: vig.assinatura, mesesTotal: vig.mesesTotal,
        periodos: vig.periodos, avisos: vig.avisos
      };
      if (vig.inicio) { p.campos.inicio = vig.inicio; p.procedencia.inicio = 'manual'; p.confiancas.inicio = 1; }
      if (vig.termino) { p.campos.termino = vig.termino; p.procedencia.termino = 'manual'; p.confiancas.termino = 1; }
      recalculou = true;
    } else if (dataMarco) {
      // Sem texto no cache (pasta ainda não lida): grava o que dá — a data
      // informada — e deixa o término para depois da varredura.
      p.campos.inicio = dataMarco;
      p.procedencia.inicio = 'manual';
      p.confiancas.inicio = 1;
    }
  }
  if (valorMensal !== null) {
    p.campos.valor = valorMensal;
    p.procedencia.valor = 'manual';
    p.confiancas.valor = 1;
  }

  const alterados = ['inicio', 'termino', 'valor']
    .filter(c => String(antes[c] ?? '') !== String(p.campos[c] ?? ''))
    .map(c => ({ campo: c, de: antes[c], para: p.campos[c] ?? null }));

  save();
  return {
    propostaId: p.id,
    numero: p.campos.numero || null,
    alterados,
    recalculou,
    semTexto: !recalculou && !!(dataMarco || meses !== null),
    calculoVigencia: p.calculoVigencia || null,
    avisos: (p.calculoVigencia && p.calculoVigencia.avisos) || []
  };
}

module.exports = {
  resumir,
  trechos,
  aplicarDadoManual,
  decidirEncerramento,
  GRUPOS,
  _paraTeste: { motivosDaProposta, mesesConhecidos, recortar, ordenarPorNumero }
};
