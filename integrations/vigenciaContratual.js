/* ===================================================================
   integrations/vigenciaContratual.js

   Início e término da vigência de um contrato, a partir dos documentos da
   pasta "3. Contratos, Aditivos e Termos". Regra (definida pelo usuário
   em 22/09/2026): a vigência é contada em MESES, a partir de um marco —
   a assinatura do contrato ou a Ordem de Início (conforme o contrato
   disser) — e cada prorrogação soma meses a partir da data que o termo
   indicar. Datas não são "achadas" soltas no texto: são CALCULADAS
   (marco + meses) e só são preenchidas quando o marco é conhecido.

   Como o prazo vence: Código Civil, art. 132, §3º — "os prazos de meses
   e anos expiram no dia de igual número do de início, ou no imediato, se
   faltar exata correspondência". É também o que o SGC faz:
     072/2020  prorrogação de 12 meses contada de 29/09/2024 → 29/09/2025
     086/2021  12 meses contados de 21/09/2025              → 21/09/2026
     006/2025  12 meses a partir de 13/02/2026              → 13/02/2027
   Quando o termo escreve o fim ("à contar de 07 de agosto de 2023 até 06
   de agosto de 2024"), vale a data escrita.

   Verificações antes de preencher:
     - o marco inicial do contrato precisa estar identificado
       ("contados da assinatura" ou "da Ordem de Início") e a data dele
       precisa estar nos documentos; contrato que conta da Ordem de Início
       sem a data dela não tem término calculado (a menos que uma
       prorrogação posterior diga de quando conta);
     - cada prorrogação que diz de quando conta é conferida com o fim do
       período anterior; divergência vira aviso (vale a data do termo).
=================================================================== */

const { pecas } = require('./valorContratual');
const { dividirEmDocumentos, classificarDocumento, numeroDoTermo, anoDoTermo, regexDoNumero, paragrafosDoExtrato, PRORROGACAO } = pecas;
const { acharVigenciaMeses } = require('./valorContratual');

const MESES_NOME = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/* "05 de dezembro de 2025", "1° de agosto", "o3 de maio" (OCR: letra o
   no lugar do zero), "21 de marco" (cedilha perdida), "dejunho" (espaço
   perdido), "27 de dezembro 2022" (sem o "de" antes do ano — a Ordem de
   Início do 141/2022 é assim, e a data era descartada). Devolve
   'AAAA-MM-DD' ou null. */
const DATA_EXTENSO = /\b(\d{1,2}|[oO]\d)\s*[º°o]?\s*de\s*(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s*(?:de\s*|,\s*)?(\d{4})/i;
const DATA_NUMERICA = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/;

function lerData(texto) {
  const t = String(texto || '');
  const e = t.match(DATA_EXTENSO);
  const n = t.match(DATA_NUMERICA);
  // A que aparece primeiro no trecho.
  let dia, mes, ano;
  if (e && (!n || e.index <= n.index)) {
    dia = Number(e[1].replace(/^[oO]/, '0'));
    mes = MESES_NOME.indexOf(e[2].toLowerCase().replace('ç', 'c')) + 1;
    ano = Number(e[3]);
  } else if (n) {
    dia = Number(n[1]); mes = Number(n[2]); ano = Number(n[3]);
  } else return null;
  if (!(dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12 && ano >= 1990 && ano <= 2100)) return null;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCDate() !== dia) return null; // 31/02 e parecidos
  return d.toISOString().slice(0, 10);
}

/* Soma meses pela regra do Código Civil (art. 132, §3º): mesmo dia do
   mês final; sem esse dia (31 → fevereiro), o dia imediato. */
function somarMeses(iso, meses) {
  const [a, m, d] = iso.split('-').map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimoDia = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  if (d <= ultimoDia) return new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth(), d)).toISOString().slice(0, 10);
  return new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

const diasEntre = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const br = iso => iso ? iso.split('-').reverse().join('/') : '—';

/* De onde o contrato conta a vigência. */
function marcoInicial(texto) {
  const t = String(texto);
  for (const m of t.matchAll(/vig\S{0,2}ncia[^.;]{0,200}/gi)) {
    const trecho = m[0];
    if (/ordem\s*de\s*(in[íi]cio|servi[çc]o)|recebimento\s*d[ao]\s*(ordem|nota)|emiss[ãa]o\s*d[ao]\s*ordem/i.test(trecho)) return 'ordem';
    if (/assinatura/i.test(trecho)) return 'assinatura';
    if (/contad[oa]s?\s*(?:a\s*partir\s*)?d[oa]\s*recebimento/i.test(trecho)) return 'ordem';
  }
  return null;
}

/* Data de assinatura do contrato:
   1. "DATA DA ASSINATURA: 27 de fevereiro de 2024" logo depois do número
      do contrato, sem termo aditivo no meio (Termo de Ciência e extratos);
   2. "Itaverde, 05 de dezembro de 2025" — o fecho do próprio contrato (o
      último que aparecer nele). */
function dataDeAssinatura(documentos, reNumero) {
  // Só em documento do próprio contrato (ou no Termo de Ciência dele) — o de
  // um termo aditivo traz a data de assinatura do TERMO.
  for (const d of documentos.filter(x => x.tipo !== 'aditivo' && x.tipo !== 'apostilamento')) {
    for (const m of d.texto.matchAll(/data\s*da\s*assinatura\s*:?\s*/gi)) {
      const antes = d.texto.slice(Math.max(0, m.index - 120), m.index);
      if (reNumero && !reNumero.test(antes)) continue;
      // "CONTRATO N° (DE ORIGEM): 009/2023 TERMO DE RETI-RATIFICAÇÃO N° 116/2023 DATA DA ASSINATURA: ..."
      if (/aditament|aditivo|apostil|termo|ratifica/i.test(antes.slice(antes.search(reNumero || /$/)))) continue;
      const data = lerData(d.texto.slice(m.index + m[0].length, m.index + m[0].length + 40));
      if (data) return { data, fonte: d.nome, como: 'data da assinatura declarada' };
    }
  }
  const contratos = documentos.filter(d => d.tipo === 'contrato' && !d.extrato);
  for (const d of contratos) {
    const fechos = [...d.texto.matchAll(/Itaverde,?\s*(?:em\s*)?(?=(?:\d{1,2}|[oO]\d)\s*[º°o]?\s*de\s)/gi)];
    for (const f of fechos.reverse()) {
      const data = lerData(d.texto.slice(f.index, f.index + 60));
      if (data) return { data, fonte: d.nome, como: 'fecho do contrato ("Itaverde, ...")' };
    }
  }
  return null;
}

/* Data da Ordem de Início, quando o documento está na pasta: a data que
   ele diz para o início ("a partir de 01 de junho de 2026") ou, na falta,
   a data do próprio documento ("Itaverde, 27 de maio de 2026 — Ordem de
   início de Serviços ... fica estabelecido o início do contrato Nº
   048/2026"). Precisa citar o número do contrato. */
function dataDoDocumentoDaOrdem(texto) {
  const explicita = texto.match(/(?:in[íi]cio|a\s*partir|a\s*contar)\s*(?:dos\s*servi[çc]os\s*)?(?:em|de|a\s*partir\s*de)\s*([\s\S]{0,40})/i);
  // "Data da Emissão: 22/01/2026" — Ordem de Fornecimento (096/2025).
  const emissao = texto.match(/data\s*d[ae]\s*emiss[ãa]o\s*:?\s*([\s\S]{0,24})/i);
  return (explicita && lerData(explicita[1])) || (emissao && lerData(emissao[1])) || lerData(texto.slice(0, 400));
}

/* Cita o número de OUTRO contrato? (então não é a Ordem deste). */
function citaOutroContrato(texto, reNumero) {
  for (const m of String(texto).matchAll(/contrato\s*n?\s*[º°o.]?\s*(\d{1,4}\s*[\/_.]\s*\d{4})/gi)) {
    if (!reNumero || !reNumero.test(m[1].replace(/[_.]/, '/'))) return true;
  }
  return false;
}

function dataDaOrdemDeInicio(documentos, reNumero) {
  const ordens = documentos.filter(x => x.tipo === 'ordem' && x.texto.trim());
  // 1º: a Ordem que cita o número deste contrato (rascunho sem data não conta).
  for (const d of ordens) {
    if (reNumero && !reNumero.test(d.texto)) continue;
    const data = dataDoDocumentoDaOrdem(d.texto);
    if (data) return { data, fonte: d.nome };
  }
  /* 2º (24/09/2026): Ordem que NÃO cita o número — digitalizada, o OCR não
     leu o número (caso do 096/2025: "Ordem de Serviço_assinada Atlas.pdf",
     emitida em 22/01/2026). Vale se estiver entre os documentos deste
     processo e não citar OUTRO contrato; certificado de assinatura e
     rascunho ("XX de xxxxx") não entram. Sai com aviso para conferir. */
  for (const d of ordens) {
    if (reNumero && reNumero.test(d.texto)) continue; // já tentada acima
    if (/assinatura|certificado|modelo|xxx/i.test(d.nome) || citaOutroContrato(d.texto, reNumero)) continue;
    const data = dataDoDocumentoDaOrdem(d.texto);
    if (data) return { data, fonte: d.nome, semNumero: true };
  }
  return null;
}

/* Uma prorrogação: meses, e — se o termo disser — a partir de quando e
   até quando. */
function lerProrrogacao(texto, reNumero) {
  for (const m of String(texto).matchAll(new RegExp(PRORROGACAO.source, 'gi'))) {
    if (reNumero && !reNumero.test(m[0])) continue;
    const depois = String(texto).slice(m.index + m[0].length, m.index + m[0].length + 260);
    const aPartir = depois.match(/(?:contad[ao]s?|a\s*contar|a\s*partir|com\s*in[íi]cio)\s*(?:a\s*partir\s*)?(?:de|em)?\s*([\s\S]{0,40})/i);
    const ate = depois.match(/at[ée]\s*([\s\S]{0,40})/i);
    return {
      meses: Number(m[1]),
      inicio: aPartir ? lerData(aPartir[1]) : null,
      fimEscrito: ate ? lerData(ate[1]) : null
    };
  }
  return null;
}

/* `opcoes` permite completar à mão o que não está nos documentos (ver
   integrations/pendenciasLeitura.js): `marcoInformado` é a data do marco
   inicial (a Ordem de Início, quase sempre, que costuma ficar fora da
   pasta) e `mesesInformados`, a vigência em meses quando a cláusula não
   foi lida. Só entram quando a leitura NÃO achou o dado — documento lido
   sempre vale mais do que digitação. */
function calcularVigencia(texto, numeroContrato, opcoes) {
  const informado = (opcoes && opcoes.marcoInformado && opcoes.marcoInformado.data) ? opcoes.marcoInformado : null;
  const mesesInformados = Number(opcoes && opcoes.mesesInformados) > 0 ? Number(opcoes.mesesInformados) : null;
  const documentos = dividirEmDocumentos(texto).map(d => ({ ...d, ...classificarDocumento(d.nome) }));
  const reNumero = regexDoNumero(numeroContrato);
  const avisos = [];
  const semNomes = documentos.length === 1 && !documentos[0].nome;
  const contratos = semNomes ? documentos : documentos.filter(d => d.tipo === 'contrato' && !d.extrato);

  // 1. Período inicial: meses, marco e data do marco.
  let mesesIniciais, marco = null;
  for (const d of contratos) {
    if (mesesIniciais === undefined) { const m = acharVigenciaMeses(d.texto); if (m > 0) mesesIniciais = m; }
    if (!marco) marco = marcoInicial(d.texto);
  }
  const assinatura = dataDeAssinatura(documentos, reNumero);
  const ordem = marco === 'ordem' ? dataDaOrdemDeInicio(documentos, reNumero) : null;
  const periodos = [];
  let inicioInicial = null;
  let baseInformada = null;
  let marcoPresumido = false;
  if (mesesIniciais === undefined && mesesInformados) {
    mesesIniciais = mesesInformados;
    avisos.push(`A vigência em meses não foi encontrada nos documentos: ${mesesInformados} meses informados à mão${informado && informado.por ? ` por ${informado.por}` : ''} — confira no contrato.`);
  }
  if (mesesIniciais) {
    if (marco === 'assinatura' && assinatura) inicioInicial = assinatura.data;
    if (marco === 'ordem' && ordem) inicioInicial = ordem.data;
    // Nada nos documentos: vale a data informada à mão, se houver.
    if (!inicioInicial && informado) {
      inicioInicial = informado.data;
      baseInformada = `${marco === 'ordem' ? 'Ordem de Início' : 'início'} de ${br(informado.data)} informado à mão${informado.por ? ` por ${informado.por}` : ''}${informado.observacao ? ` — ${informado.observacao}` : ''}`;
      avisos.push(`O marco inicial (${marco === 'ordem' ? 'Ordem de Início' : 'assinatura'}) não está nos documentos da pasta: a data ${br(informado.data)} foi informada à mão${informado.por ? ` por ${informado.por}` : ''} — confira na fonte.`);
    }
    /* REGRA DO USUÁRIO (24/09/2026): sem Ordem de Início nos documentos (e
       sem data informada à mão), o início é a ASSINATURA do contrato, e o
       término é calculado a partir dela — para todos os contratos. Vale
       também quando a cláusula não diz de quando conta a vigência. Fica
       marcado como presumido, e a Ordem de Início, quando aparecer na
       pasta, volta a mandar. */
    if (!inicioInicial && assinatura && marco !== 'assinatura') {
      inicioInicial = assinatura.data;
      marcoPresumido = true;
    }
    periodos.push({
      origem: 'contrato', meses: mesesIniciais, inicio: inicioInicial,
      fim: inicioInicial ? somarMeses(inicioInicial, mesesIniciais) : null,
      base: baseInformada ? baseInformada
        : marcoPresumido ? `assinatura em ${br(assinatura.data)} (sem Ordem de Início nos documentos — contado da assinatura)`
        : marco === 'assinatura' ? (assinatura ? `assinatura em ${br(assinatura.data)}` : 'assinatura (data não encontrada)')
        : marco === 'ordem' ? (ordem ? `Ordem de Início de ${br(ordem.data)} (${ordem.fonte}${ordem.semNumero ? ' — não cita o número do contrato' : ''})` : 'Ordem de Início (data não consta dos documentos)')
        : 'marco inicial não identificado'
    });
    if (ordem && ordem.semNumero) avisos.push(`A Ordem de Início usada ("${ordem.fonte}", de ${br(ordem.data)}) não cita o número do contrato — foi considerada por estar na pasta do processo. Confira se é a Ordem deste contrato.`);
    if (baseInformada) { /* o aviso já foi dado acima */ }
    else if (marcoPresumido && marco === 'ordem') {
      const haOrdemNaPasta = documentos.some(d => d.tipo === 'ordem');
      avisos.push(haOrdemNaPasta
        ? `O contrato diz que a vigência começa na Ordem de Início — essa seria a data de início correta. Há Ordem de Início na pasta, mas não foi possível extrair a data dela (documento digitalizado ilegível, rascunho sem data ou sem o número do contrato). Início e término foram calculados a partir da assinatura (${br(assinatura.data)}): confira a Ordem e, se for o caso, informe a data em Pendências de leitura.`
        : `O contrato diz que a vigência começa na Ordem de Início — essa seria a data de início correta —, mas ela não foi encontrada nos documentos do processo. Início e término foram calculados a partir da assinatura (${br(assinatura.data)}): arquive a Ordem na pasta "Ordem de Início de Serviço" do processo ou informe a data em Pendências de leitura.`);
    }
    else if (marcoPresumido) avisos.push(`O contrato não diz de quando conta a vigência: início e término foram calculados a partir da assinatura (${br(assinatura.data)}).`);
    else if (marco === 'ordem' && !ordem) avisos.push(`O contrato conta os ${mesesIniciais} meses da Ordem de Início, e nem ela nem a data de assinatura estão nos documentos da pasta — o término do período inicial não pôde ser calculado.`);
    else if (!marco) avisos.push('O contrato não diz de quando conta a vigência, e a data de assinatura não foi encontrada — o término do período inicial não foi calculado.');
    else if (!assinatura) avisos.push('A vigência conta da assinatura, mas a data de assinatura não foi encontrada (o fecho "Itaverde, ..." costuma estar na última página, que pode não ter sido lida).');
  }

  // 2. Prorrogações, na ordem dos termos.
  const porTermo = new Map();
  if (!semNomes) {
    documentos.filter(d => d.tipo === 'aditivo').forEach(d => {
      const chave = numeroDoTermo(d.nome) || d.nome;
      if (!porTermo.has(chave)) porTermo.set(chave, []);
      porTermo.get(chave).push(d);
    });
  }
  const prorrogacoes = [];
  for (const [termo, docs] of porTermo) {
    let achada = null, fonte = null;
    for (const d of docs.filter(x => !x.extrato && x.texto.trim())) {
      if (reNumero && !reNumero.test(d.texto)) continue;
      achada = lerProrrogacao(d.texto, reNumero); fonte = d.nome;
      if (achada) break;
    }
    if (!achada || !achada.inicio) {
      for (const d of docs.filter(x => x.extrato)) {
        const r = paragrafosDoExtrato(d.texto, reNumero, termo).map(p => lerProrrogacao(p, reNumero)).find(Boolean);
        if (r && (!achada || (!achada.inicio && r.inicio))) { achada = achada ? { ...achada, inicio: r.inicio, fimEscrito: achada.fimEscrito || r.fimEscrito } : r; fonte = fonte || d.nome; break; }
      }
    }
    if (achada) prorrogacoes.push({ termo, ano: anoDoTermo(docs[0].nome, docs.map(x => x.texto).join(' '), termo), fonte, ...achada });
  }
  prorrogacoes.sort((a, b) => (a.ano - b.ano) || a.termo.localeCompare(b.termo) || String(a.inicio).localeCompare(String(b.inicio)));

  // 3. Encadeia os períodos, conferindo cada começo com o fim do anterior.
  for (const p of prorrogacoes) {
    const anterior = periodos[periodos.length - 1];
    let inicio = p.inicio;
    if (inicio && anterior && anterior.fim && Math.abs(diasEntre(anterior.fim, inicio)) > 1) {
      avisos.push(`O termo ${p.termo} prorroga a partir de ${br(inicio)}, mas o período anterior terminava em ${br(anterior.fim)} — vale a data escrita no termo; confira.`);
    }
    if (!inicio && anterior && anterior.fim) inicio = anterior.fim;
    const fim = p.fimEscrito || (inicio ? somarMeses(inicio, p.meses) : null);
    if (!inicio) avisos.push(`O termo ${p.termo} prorroga por ${p.meses} meses, mas não diz a partir de quando, e o período anterior não tem término conhecido.`);
    periodos.push({ origem: `termo ${p.termo}`, meses: p.meses, inicio, fim, base: p.inicio ? `contada de ${br(p.inicio)} (${p.fonte})` : (inicio ? 'emenda no fim do período anterior' : 'início não identificado'), fimEscrito: !!p.fimEscrito });
  }

  const ultimo = periodos[periodos.length - 1];
  const termino = ultimo && ultimo.fim ? ultimo.fim : null;
  const memoria = periodos.length
    ? periodos.map(p => `${p.origem}: ${p.meses} meses${p.inicio ? ` de ${br(p.inicio)}` : ''}${p.fim ? ` a ${br(p.fim)}${p.fimEscrito ? ' (data do termo)' : ''}` : ' (término não calculado)'} — ${p.base}`).join('; ')
    : null;
  /* Início da vigência (regra do usuário, 24/09/2026): o MARCO que a
     cláusula do contrato manda usar — a Ordem de Início, quando o contrato
     conta dela e ela foi lida; a assinatura, quando conta da assinatura;
     e a assinatura também quando conta da Ordem mas ela não foi achada,
     com o aviso de que a data correta seria a da Ordem. Sem período
     calculado (meses não lidos), vale a assinatura, se houver. */
  const primeiro = periodos[0];
  const inicioDoMarco = primeiro && primeiro.inicio;
  return {
    inicio: inicioDoMarco || (assinatura ? assinatura.data : null),
    fonteInicio: inicioDoMarco ? primeiro.base : (assinatura ? `${assinatura.como} — ${assinatura.fonte}` : null),
    rotuloInicio: marco === 'ordem' && ordem ? 'Início pela Ordem de Início'
      : marcoPresumido && marco === 'ordem' ? 'Início pela assinatura (a Ordem de Início não foi encontrada)'
      : baseInformada ? 'Início informado à mão'
      : 'Início pela assinatura do contrato',
    assinatura: assinatura ? assinatura.data : null,
    termino,
    marco,
    // Início contado da assinatura porque a Ordem de Início não estava nos documentos.
    marcoPresumido,
    mesesTotal: periodos.reduce((s, p) => s + p.meses, 0) || null,
    periodos,
    memoria,
    avisos
  };
}

module.exports = {
  calcularVigencia,
  // Leitor de data por extenso ou numérica — usado também pela leitura dos
  // termos (termosDosDocumentos.js), que precisa da data de cada termo.
  lerData,
  _paraTeste: { lerData, somarMeses, marcoInicial, lerProrrogacao, dataDeAssinatura }
};
