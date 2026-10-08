/* ===================================================================
   integrations/checklistPorRegra.js

   Leitura de cada item do checklist do Mapa de risco, por regra. Criado
   em 23/09/2026 (antes, uma IA local lia os itens; retirada em 01/10/2026).

   ------------------------------------------------------------------
   Por que regra primeiro
   ------------------------------------------------------------------
   Os contratos da Prefeitura saem do mesmo modelo da Procuradoria: a
   garantia é sempre "5% (cinco por cento) do valor total", o reajuste
   "a variação do IPCA ... a cada 12 (doze) meses", as multas "0,5% por
   dia de atraso ... até o limite de 15%". Conferir se esses elementos
   estão escritos é leitura de FATO, não julgamento — e regra faz isso
   melhor que um modelo de IA:

     - não inventa: a evidência é o trecho que casou, copiado do texto;
     - é igual toda vez (o mesmo PDF dá o mesmo resultado);
     - leva milissegundos (a IA local levava ~1 minuto por item).

   Onde há JULGAMENTO — a regra não acha todos os elementos (multa que só
   remete a um decreto, reajuste sem data-base, obrigações de uma das
   partes não achadas, alocação da matriz de riscos) — o item fica para
   conferência manual, com o trecho e a lista do que a regra não achou.

   ------------------------------------------------------------------
   O que a regra NUNCA faz
   ------------------------------------------------------------------
   Afirmar que um item "não atende" só porque não achou um elemento. Não
   achar pode ser OCR ruim ou redação incomum; isso vai para conferência
   humana, nunca vira apontamento sozinho. A única exceção são
   os alertas com citação literal (renovação automática, pagamento
   antecipado sem garantia): ali a própria frase é a prova.

   ------------------------------------------------------------------
   Regime legal
   ------------------------------------------------------------------
   Contrato assinado sob a Lei 8.666/1993 não pode ser cobrado pelo
   art. 92 da Lei 14.133/2021: a referência de cada item muda, e a matriz
   de riscos (que a 8.666 não prevê) deixa de ser exigível.
=================================================================== */

/* Referência legal de cada item, por regime. */
const REFERENCIAS = {
  penalidades: { '14.133': 'Lei 14.133/2021, art. 92, XIV', '8.666': 'Lei 8.666/1993, art. 55, VII, e arts. 86 e 87' },
  reajuste: { '14.133': 'Lei 14.133/2021, art. 92, V, e art. 25, § 7º', '8.666': 'Lei 8.666/1993, art. 55, III, e art. 40, XI' },
  pagamento: { '14.133': 'Lei 14.133/2021, art. 92, V e VI', '8.666': 'Lei 8.666/1993, art. 55, III, e art. 40, XIV' },
  garantia: { '14.133': 'Lei 14.133/2021, art. 92, XII e XIII, e art. 96', '8.666': 'Lei 8.666/1993, art. 55, VI, e art. 56' },
  vigencia: { '14.133': 'Lei 14.133/2021, art. 92, VII, e arts. 105 a 107', '8.666': 'Lei 8.666/1993, art. 55, IV, e art. 57' },
  extincao: { '14.133': 'Lei 14.133/2021, art. 92, XIX, e arts. 137 a 139', '8.666': 'Lei 8.666/1993, art. 55, VIII e IX, e arts. 77 a 80' },
  gestao: { '14.133': 'Lei 14.133/2021, art. 92, XVIII, e art. 117', '8.666': 'Lei 8.666/1993, art. 67' },
  obrigacoes: { '14.133': 'Lei 14.133/2021, art. 92, XIV, e art. 121', '8.666': 'Lei 8.666/1993, art. 55, VII, e arts. 70 e 71' },
  matriz: { '14.133': 'Lei 14.133/2021, art. 92, IX (quando for o caso)', '8.666': 'Não prevista na Lei 8.666/1993' }
};

function referenciaDoItem(item, regime) {
  const r = REFERENCIAS[item.id];
  if (!r) return item.referencia;
  return r[regime && regime.lei] || item.referencia;
}

/* Acordo ou termo de cooperação, convênio, termo de fomento ou de
   colaboração — instrumento que não é contrato de compra ou serviço. Sem
   repasse de recursos, os itens de dinheiro (multa, reajuste, pagamento,
   garantia, matriz de riscos) não se aplicam: a Lei 14.133/2021, art. 184,
   manda aplicar a lei a esses ajustes "no que couber". Medido em
   25/09/2026: 002/2024 (Nove Tecnologia) e 102/2022 (IFTEC) saíam com essas
   cláusulas "não localizadas" e risco Médio por isso. */
const RE_COOPERACAO = /(?:acordo|termo)\s+de\s+coopera[çc][ãa]o|\bcoopera[çc][ãa]o\s+t[ée]cnica|conv[êe]nio|termo\s+de\s+fomento|termo\s+de\s+colabora[çc][ãa]o/i;
const ITENS_SO_COM_REPASSE = ['penalidades', 'reajuste', 'pagamento', 'garantia', 'matriz'];
function naoSeAplicaAoInstrumento(item, instrumento) {
  return !!(instrumento && instrumento.cooperacao && instrumento.semRepasse && ITENS_SO_COM_REPASSE.includes(item.id));
}
const OBSERVACAO_COOPERACAO = 'Acordo/termo de cooperação sem repasse de recursos: não se aplica (Lei 14.133/2021, art. 184 — a lei vale para esses ajustes "no que couber").';

/* Item que não se aplica ao regime (a matriz de riscos na 8.666). */
function naoSeAplicaAoRegime(item, regime) {
  return item.id === 'matriz' && regime && regime.lei === '8.666';
}

/* ------------------------------------------------------------------
   Evidência: a frase em volta do que casou, copiada do texto.
------------------------------------------------------------------ */
const limpar = t => String(t || '').replace(/\[página \d+\]/g, ' ').replace(/\s+/g, ' ').trim();

/* Cabeçalho de página que o OCR joga no meio da frase citada ("PREFEITURA
   DE ITAVERDE | Procuradoria Geral do Município | CIDADE QUE CUIDA DE TODOS", "Contrato nº 072/2020", números de página e sujeira como "| 8",
   "1h5t"). Sai só o que vem LOGO DEPOIS de um marcador "[página N]", linha
   a linha, enquanto a linha parecer cabeçalho — o texto do contrato fica.
   Só para a citação mostrada como prova; a regra continua lendo o texto
   inteiro (25/09/2026). */
function ehLinhaDeCabecalho(linha) {
  const t = linha.trim();
  if (!t) return true;
  // "PRESGITURA", "PREFETURA": o OCR troca letras do cabeçalho.
  if (t.length < 90 && /pr[eé]\S{1,4}tura|itaverde|procuradoria|geral\s+do\s+munic|cidade\s+que\s+cuida|cuida\s+de\s+todos|assuntos\s+jur|imprensa\s+oficial/i.test(t)) return true;
  if (/^contrato\s+n[º°o.]*\s*\d+\s*[\/._]\s*\d+\.?$/i.test(t)) return true;
  return t.length <= 14 && !/[a-zà-ú]{4,}/.test(t); // "| 8", "O? - Filed]", "Ste"
}
function semCabecalhosDePagina(trecho) {
  return String(trecho || '')
    // rodapé curto logo ANTES da quebra de página: "| 8", "7 x", "jo a)", "a”"
    .replace(/(?:\n[^\n]{0,6})+(?=\s*\[página \d+\])/g, '\n')
    .replace(/\[página \d+\][ \t]*\n?((?:[^\n]*\n?){0,8})/g, (m, bloco) => {
    const linhas = bloco.split('\n');
    let i = 0;
    while (i < linhas.length - 1 && ehLinhaDeCabecalho(linhas[i])) i++;
    return ' ' + linhas.slice(i).join('\n');
  });
}

function citacaoEmVolta(texto, indice, ate = null, tamanhoAchado = 0) {
  const t = String(texto);
  // Começa no início da frase/subitem mais próximo antes do achado
  // ("11.1. São aplicáveis..."), olhando até 260 caracteres para trás.
  let inicio = Math.max(0, indice - 260);
  const antes = t.slice(inicio, indice);
  let depoisDoCorte = -1;
  // Quebra de linha do OCR não é fim de frase: só ". " e "; ".
  for (const m of antes.matchAll(/\.[ \t]|;\s/g)) {
    // "nº. 14.133", "art. 92", "fls. 12": abreviatura não encerra frase.
    if (m[0][0] === '.' && /(?:^|[\s(])(?:n[º°o]?|art|arts|fl|fls|inc|par|sr|sra|dr|dra)$/i.test(antes.slice(Math.max(0, m.index - 5), m.index))) continue;
    depoisDoCorte = m.index + m[0].length;
  }
  if (depoisDoCorte >= 0) inicio += depoisDoCorte;
  // Nunca começar no meio de uma palavra ou número ("4.133/2021").
  else if (inicio > 0 && /[\p{L}\p{N}./]/u.test(t[inicio - 1] || '') && /[\p{L}\p{N}]/u.test(t[inicio] || '')) {
    const espaco = t.indexOf(' ', inicio);
    if (espaco >= 0 && espaco < indice) inicio = espaco + 1;
  }
  // Título de cláusula entre o começo da frase e o achado: a citação começa
  // nele ("CLÁUSULA NONA — DAS OBRIGAÇÕES DA CONTRATADA"), não na última
  // frase da cláusula anterior — título não termina em ponto. O OCR estraga
  // a palavra ("CLAtISULA", "ciAusuL&", "cLAusuLA"): basta começar com
  // cl/ci, ter duas maiúsculas e vir seguida de palavra em MAIÚSCULAS.
  let ultimoTitulo = -1;
  for (const m of t.slice(inicio, indice).matchAll(/\b[cC][lLiI]\S{4,7}\s+[A-ZÁÉÍÓÚ]{4}/g)) {
    if ((m[0].split(/\s/)[0].match(/[A-ZÁ]/g) || []).length >= 2) ultimoTitulo = m.index;
  }
  if (ultimoTitulo >= 0) inicio += ultimoTitulo;

  /* Fim da citação. Antes era um corte seco em 300 caracteres, e a frase
     ficava pela metade ("...preceitos legais pertinentes, e") — sem chegar
     ao "b) Multa;" que prova o apontamento (contrato 061/2025, 25/09/2026).
     Agora: (1) vai até `ate`, quando o alerta diz qual linha precisa
     aparecer; (2) fecha no fim da frase ou do item de lista (". " ou ";")
     até 450 caracteres adiante; (3) se não achar onde fechar, termina numa
     palavra inteira e com "…", para ninguém ler o corte como o texto. */
  // Vai até o fim do que casou; daí fecha no fim da frase (abaixo). Sem o
  // tamanho do achado, o mínimo de antes (120 caracteres).
  let fim = Math.min(t.length, indice + (tamanhoAchado > 0 ? tamanhoAchado : 120));
  if (ate) {
    const m = new RegExp(ate.source, ate.flags.replace('g', '')).exec(t.slice(indice, indice + 700));
    if (m) fim = Math.max(fim, indice + m.index + m[0].length);
  }
  let cortado = false;
  if (fim < t.length && !/[.;]\s*$/.test(t.slice(Math.max(inicio, fim - 2), fim))) {
    const resto = t.slice(fim, fim + 450); // folga para o cabeçalho de página que sai da citação
    let fecho = -1;
    for (const m of resto.matchAll(/[.;](?=\s|$)/g)) {
      const antesDoPonto = t.slice(Math.max(0, fim + m.index - 5), fim + m.index);
      if (m[0] === '.' && /(?:^|[\s(])(?:n[º°o]?|art|arts|fl|fls|inc|par|sr|sra|dr|dra)$/i.test(antesDoPonto)) continue;
      fecho = m.index + 1;
      break;
    }
    if (fecho >= 0) fim += fecho;
    else {
      const espaco = t.lastIndexOf(' ', fim);
      if (espaco > indice) fim = espaco;
      cortado = true;
    }
  }
  // Não terminar num número de subitem solto ("... pertinentes. 11.2.").
  const citacao = limpar(semCabecalhosDePagina(t.slice(inicio, fim))).replace(/\s\d{1,2}(?:\.\d{1,2})*\.?$/, '');
  return cortado ? citacao + ' …' : citacao;
}

/* Procura cada elemento; devolve os achados (com citação) e os que
   faltaram. `elementos`: [{ rotulo, regex }]. */
function procurar(texto, elementos) {
  const achados = [];
  const faltando = [];
  for (const el of elementos) {
    const m = el.regex.exec(texto) || (el.alternativa ? el.alternativa.exec(texto) : null);
    if (m) achados.push({ rotulo: el.rotulo, citacao: citacaoEmVolta(texto, m.index, null, m[0].length) });
    else if (!el.opcional) faltando.push(el.rotulo); // opcional: vira evidência se achado, não falta se ausente
  }
  return { achados, faltando };
}

/* ------------------------------------------------------------------
   Elementos que cada item precisa ter escritos
------------------------------------------------------------------ */
const PERCENTUAL = String.raw`\d{1,3}(?:[,.]\d{1,2})?\s*%`;
/* Qualquer caractere que não encerre a frase. O ponto de número
   ("8.666/93", "R$ 139.000,00") não encerra; nem o ponto colado na
   palavra seguinte — o cabeçalho de página que o OCR joga no meio da frase ("CIDADE QUE CUIDA DE TODOS.PÊ") cortava
   "podendo ser prorrogado, desde que | devidamente justificado" (contrato
   064/2025, 25/09/2026). Fim de frase é ponto seguido de espaço. */
const NA_FRASE = String.raw`(?:[^.;]|\.(?=\S))`;
const EXTENSO = String.raw`\d{1,3}\s*\(\s*[a-zçãéêíóúõ\s]+\)`;
const re = s => new RegExp(s, 'i');

const ELEMENTOS = {
  penalidades: [
    { rotulo: 'multa com percentual definido', regex: re(String.raw`multa${NA_FRASE}{0,160}?${PERCENTUAL}|${PERCENTUAL}${NA_FRASE}{0,80}?multa`) },
    { rotulo: 'base de cálculo da multa (sobre o valor, por dia de atraso)', regex: re(String.raw`${PERCENTUAL}${NA_FRASE}{0,60}?(?:por\s+dia|ao\s+dia|di[áa]ri|sobre\s+o\s+valor|do\s+valor)`) }
  ],
  reajuste: [
    { rotulo: 'índice de reajuste nomeado', regex: /\b(?:IPCA|IGP-?M|INPC|INCC|ICTI|IST|IPC-?FIPE|IGP-?DI)\b/i },
    { rotulo: 'periodicidade do reajuste (12 meses)', regex: /(?:12|doze)\s*\(?\s*(?:doze)?\s*\)?\s*meses|anualmente|periodicidade\s+anual|interregno\s+m[íi]nimo/i },
    /* "mês DE apresentação", "da ' proposta" (sujeira do OCR) e o marco da
       anualidade escrito como "transcorridos 12 meses da contratação". */
    { rotulo: 'data-base do reajuste', regex: /data[\s-]+base|m[êe]s\s+d[ae]\s+(?:data\s+(?:prevista\s+)?(?:para\s+)?)?apresenta[çc][ãa]o\s+d[ae]\W{0,4}proposta|data\s+(?:prevista\s+para\s+)?(?:d?a\s+)?apresenta[çc][ãa]o\s+d[ae]\W{0,4}proposta|data\s+do\s+or[çc]amento|(?:transcorrid|decorrid)[oa]s?\s+(?:o\s+per[íi]odo\s+de\s+)?(?:12|doze)\s*\(?\s*(?:doze)?\s*\)?\s*meses\s+(?:da|de|do)\s+(?:contrata[çc][ãa]o|assinatura|apresenta[çc][ãa]o|in[íi]cio)/i }
  ],
  pagamento: [
    { rotulo: 'prazo de pagamento', regex: re(String.raw`(?:prazo\s+de|em\s+at[ée]|no\s+prazo\s+(?:m[áa]ximo\s+)?de|at[ée])\s+\d{1,3}\s*\(?[a-zçãéêíóúõ\s]*\)?\s*dias|${EXTENSO}\s*dias${NA_FRASE}{0,80}pagamento|pagamento${NA_FRASE}{0,160}\d{1,3}\s*\(?[a-zçãéêíóúõ\s]*\)?\s*dias|mensalmente`) },
    // "condicionado à comprovação, pela gestão e fiscalização, de que os equipamentos foram ... conferidos" (086/2026)
    { rotulo: 'pagamento condicionado a atesto, medição ou aceite', regex: /atestad|atesto|ateste|medi[çc][ãa]o|aceite|nota\s+fiscal[^.;]{0,80}(?:aprovad|confer)|condicionad[oa]\s+[àa]\s+comprova[çc][ãa]o[^;]{0,200}(?:conferid|aprovad|fiscaliza)|ap[óo]s\s+a\s+(?:entrega|execu[çc][ãa]o)[^.;]{0,60}verifica[çc][ãa]o\s+d[ae]\s+conformidade/i }
  ],
  garantia: [
    { rotulo: 'garantia com percentual ou valor definido', regex: re(String.raw`garantia${NA_FRASE}{0,300}?(?:${PERCENTUAL}|R\$\s*[\d.]+,\d{2})`) },
    { rotulo: 'modalidade da garantia (caução, seguro-garantia, fiança)', regex: /cau[çc][ãa]o|seguro[\s-]*garantia|fian[çc]a\s+banc|modalidades\s+previstas|art(?:igo|\.)?\s*(?:56|96)\b/i }
  ],
  vigencia: [
    /* "acordo" sozinho casava "de acordo com a variação do IPCA" numa frase
       de reajuste que cita a prorrogação (contrato 075/2025, 25/09/2026). */
    { rotulo: 'prazo de vigência determinado', regex: re(String.raw`vig[êe]ncia${NA_FRASE}{0,160}?${EXTENSO}\s*(?:meses|anos|dias)|${EXTENSO}\s*(?:meses|anos)${NA_FRASE}{0,80}?(?:contad|a\s+partir|vig[êe]ncia)`) },
    { rotulo: 'prorrogação condicionada (justificativa, interesse ou termo aditivo)', regex: re(String.raw`prorrog${NA_FRASE}{0,240}?(?:justific|interesse|conveni[êe]ncia|termo\s+aditivo|acordo\s+entre|comum\s+acordo|m[úu]tuo\s+acordo|manifesta|autoriza|vantaj|artigo|art\.|legisla)`) }
  ],
  extincao: [
    /* "athgo 78", "aitigo 78": o OCR estraga a palavra "artigo". E "constituem
       motivos para rescisão os relacionados no art. 78" já nomeia os casos. */
    { rotulo: 'casos de extinção ou rescisão previstos', regex: /(?:art(?:igo|s?\.)?|a\S{1,2}go)\s*(?:n?[º°o.]?\s*)?(?:77|78|79|80|137|138|139)\b|motivos?\s+para\s+(?:a\s+)?(?:rescis|extin)|inexecu[çc][ãa]o\s+(?:total|parcial)|motivos?\s+(?:elencados|previstos)|hip[óo]teses\s+(?:previstas|elencadas)|raz[õo]es\s+de\s+interesse\s+p[úu]blico/i }
  ],
  gestao: [
    // "ficará sob a gestão do servidor, Senhor ..." (contrato 141/2022).
    { rotulo: 'gestor do contrato', regex: /\bgestor(?:a|es)?\b|sob\s+a\s+gest[ãa]o\s+d[oa]s?\s+(?:servidor|servidora|senhor|senhora|sr)/i },
    /* "fiscal" sozinho casava "Nota Fiscal" e "encargos ... fiscais e
       comerciais" (contrato 009/2023, 25/09/2026): só o fiscal DO contrato
       e as formas de "fiscalizar" (inclui "fiscalizacão" do OCR). */
    { rotulo: 'fiscal do contrato ou fiscalização', regex: /(?<!notas?\s{1,3})\bfiscal\s+(?:do|de|t[ée]cnic|administrativ|setorial|designad)|\bfiscaliza|(?<!notas?\s{1,3})\bfiscais\s+(?:do|de|t[ée]cnic|administrativ|setoria|designad)/i }
  ],
  /* Criado em 25/09/2026 (sem regra, os 27 itens iam todos para
     conferência manual). O modelo da Procuradoria traz duas cláusulas,
     "DAS OBRIGAÇÕES (E RESPONSABILIDADES) DA CONTRATADA" e "... DO
     CONTRATANTE"; o OCR estraga os títulos ("oB1uGAcOES", "DA CADA", "DQ
     CONTRATANTE"), por isso as formas soltas. A transferência de
     responsabilidade à Prefeitura é o alerta de ALERTAS.obrigacoes. */
  obrigacoes: [
    /* `regex`: o título ou a abertura da lista ("São obrigações da
       CONTRATADA"). `alternativa`, só se não houver: a frase solta ("a
       CONTRATADA se obriga a...", "será de responsabilidade do
       CONTRATANTE") — confirma a obrigação, mas é evidência mais fraca. */
    { rotulo: 'obrigações da contratada', regex: /obriga\S{1,3}es\s+(?:espec[íi]ficas\s+)?(?:e\s+(?:das\s+)?responsabilidades?\s+)?d[ao]\s+c\S{0,8}ad[ao]\b/i, alternativa: /\bcontratada\s+(?:obriga-se|se\s+obriga|compromete-se|se\s+compromete)|ser[áa]\s+de\s+responsabilidade\s+da\s+contratad|responsabilidades?\s+d[ao]\s+contratad/i },
    { rotulo: 'obrigações do contratante', regex: /obriga\S{1,3}es\s+(?:espec[íi]ficas\s+)?(?:e\s+(?:das\s+)?responsabilidades?\s+)?[dl]\S\s+(?:contratante|prefeitura|munic[íi]pio|administra)/i, alternativa: /\bcontratante\s+(?:obriga-se|se\s+obriga|compromete-se|se\s+compromete)|ser[áa]\s+de\s+responsabilidade\s+d[ao]\s+contratante|responsabilidades?\s+d[ao]\s+contratante/i },
    /* Opcional: a cláusula que PROTEGE a Prefeitura ("Responsabilizar-se,
       sem qualquer espécie de solidariedade por parte do CONTRATANTE,
       pelas obrigações de natureza fiscal, trabalhista...") — entra como
       evidência quando existe; a lei já protege quando não existe
       (Lei 14.133, art. 121, §1º; Lei 8.666, art. 71, §1º). */
    { rotulo: 'encargos trabalhistas e fiscais a cargo da contratada', opcional: true, regex: /sem\s+qualquer\s+esp[ée]cie\s+de\s+solidariedade|inadimpl[êe]ncia\s+d[ao]\s+contratad[ao][^.;]{0,160}n[ãa]o\s+transfere|n[ãa]o\s+transfere\s+(?:[àa]|ao)\s+(?:contratante|administra|munic|prefeitura)|(?:encargos|obriga\S{1,3}es)\s+(?:de\s+natureza\s+)?(?:trabalhist|previdenci|fisca)[^.;]{0,120}(?:exclusiv|integral)\S*\s+(?:responsabilidade\s+)?d[ao]\s+contratad/i }
  ]
  /* Sem regra, de propósito: "matriz de riscos" (se a alocação está
     correta é julgamento). Vai para conferência manual. */
};

/* Alertas com citação literal: a frase é a prova, então vira apontamento
   sozinha. `quando(faltando)`: o alerta só vale se a regra não achou
   certos elementos (ex.: multa sem percentual E remissão a decreto). */
const ALERTAS = {
  vigencia: [
    {
      regex: /(?:renova[çc][ãa]o|prorroga[çc][ãa]o)\s+autom[áa]tica|renovad[oa]\s+automaticamente|prorrogad[oa]\s+automaticamente|t[áa]cita\s+(?:renova|prorroga)/i,
      nivel: 'alto', situacao: 'nao_atende',
      titulo: 'Renovação ou prorrogação automática da vigência',
      recomendacao: 'Prorrogação exige justificativa e manifestação das partes, por termo aditivo. Cláusula de renovação automática não tem amparo legal: revisar com a Procuradoria.'
    }
  ],
  pagamento: [
    {
      regex: /pagamento\s+antecipado|antecipa[çc][ãa]o\s+(?:do|de)\s+pagamento|pagamento[^.;]{0,40}\bantes\s+d[ao]\s+(?:entrega|execu)/i,
      nivel: 'medio', situacao: 'atende_parcialmente',
      titulo: 'Previsão de pagamento antecipado',
      recomendacao: 'A regra é pagar só depois da liquidação (Lei 4.320/1964, arts. 62 e 63). Antecipação exige justificativa e garantia correspondente: confirme as duas no processo.'
    }
  ],
  penalidades: [
    {
      /* Medido em 23/09/2026: os contratos da Lei 14.133 (2024 em diante)
         listam "b) Multa;" e remetem os percentuais ao Decreto municipal
         13.877/2023. O art. 92, XIV, pede no CONTRATO os valores das
         multas e suas bases de cálculo — a Procuradoria decide se a
         remissão basta. Médio: não é ausência, é dependência de outro
         ato. */
      regex: /decreto\s+(?:municipal\s+)?n?[º°o.]?\s*\d{1,3}\.?\d{3}\s*\/\s*\d{2,4}/i,
      quando: faltando => faltando.includes('multa com percentual definido'),
      // A citação vai até a linha "b) Multa;" — é ela que mostra a multa sem percentual.
      citarAte: /\b[a-z]\)\s*multa\b[^;.]{0,40}[;.]/i,
      nivel: 'medio', situacao: 'atende_parcialmente',
      titulo: 'Percentuais das multas não constam do contrato (remissão a decreto)',
      recomendacao: 'O contrato prevê multa, mas remete o percentual e a base de cálculo a um decreto. Confirme com a Procuradoria se a remissão atende ao art. 92, XIV, da Lei 14.133/2021 e se o decreto citado fixa os percentuais aplicáveis a este contrato.'
    }
  ],
  obrigacoes: [
    {
      /* Só a forma AFIRMATIVA: "o CONTRATANTE responderá solidariamente
         pelos encargos...", "os encargos trabalhistas correrão por conta
         da Prefeitura". Medido em 25/09/2026: as 21 menções a
         solidariedade/corresponsabilidade nos contratos da pasta eram
         todas de PROTEÇÃO ("não implica corresponsabilidade", "sem
         qualquer espécie de solidariedade por parte do CONTRATANTE") —
         `semNegacao` descarta a frase que tem "não", "nem", "sem" antes. */
      regex: /(?:contratante|prefeitura|munic[íi]pio|administra[çc][ãa]o)\s+(?:responder[áa]|ser[áa]\s+(?:solidariamente\s+|subsidiariamente\s+)?respons[áa]vel|arcar[áa]|se\s+responsabiliza|responsabiliza-se)\s+(?:solid[áa]ri\S*\s+|subsidi[áa]ri\S*\s+)?(?:pel[oa]s?|por)\s+(?:\S+\s+){0,3}(?:encargos|obriga\S{1,3}es\s+(?:trabalhist|previdenci|fisca)|sal[áa]rios|danos\s+causados\s+pela\s+contratad|d[ée]bitos\s+da\s+contratad)|responsabilidade\s+(?:solid[áa]ria|subsidi[áa]ria)\s+d[ao]\s+(?:contratante|prefeitura|munic|administra)|(?:encargos|obriga\S{1,3}es)\s+(?:trabalhist|previdenci|fisca)\S*[^.;]{0,120}(?:correr[ãa]o\s+por\s+conta|ser[ãa]o\s+de\s+responsabilidade|ficar[ãa]o\s+a\s+cargo)\s+d[ao]\s+(?:contratante|prefeitura|munic|administra)/i,
      semNegacao: true,
      nivel: 'alto', situacao: 'atende_parcialmente',
      titulo: 'Cláusula atribui à Prefeitura responsabilidade por encargos ou danos da contratada',
      recomendacao: 'Encargos trabalhistas, previdenciários, fiscais e comerciais e danos causados na execução são da contratada; a inadimplência dela não transfere a responsabilidade à Administração (Lei 14.133/2021, art. 121, §1º; Lei 8.666/1993, art. 71, §1º). A exceção é a do art. 121, §2º (serviço com dedicação exclusiva de mão de obra, quando falhar a fiscalização). Leve a cláusula citada à Procuradoria.'
    }
  ]
};

/* Primeira ocorrência cuja frase NÃO nega o que casou: "a fiscalização
   não implica corresponsabilidade", "sem qualquer espécie de
   solidariedade por parte do CONTRATANTE", "nem exime" são proteção, não
   transferência. A frase começa no último ". " ou ";" antes do achado. */
function primeiraAfirmativa(texto, regex) {
  for (const m of texto.matchAll(new RegExp(regex.source, regex.flags.replace('g', '') + 'g'))) {
    const antes = texto.slice(Math.max(0, m.index - 300), m.index + m[0].length);
    const inicioDaFrase = Math.max(antes.lastIndexOf('. '), antes.lastIndexOf(';'), antes.lastIndexOf('.\n'));
    const frase = antes.slice(inicioDaFrase + 1);
    if (!/\bn[ãa]o\b|\bnem\b|\bsem\b|\bnenhum|\bexime|\bvedad/i.test(frase)) return m;
  }
  return null;
}

/* Resultado da regra para um item, a partir dos trechos localizados.
     - completo: todos os elementos foram achados (e nenhum alerta);
     - achados / faltando: para a tela e para quem confere saber onde olhar;
     - alertas: frases que já são apontamento por si só.
   Item sem regra (matriz de riscos) devolve null: vai para conferência manual. */
function verificarItem(item, trechos) {
  const elementos = ELEMENTOS[item.id];
  if (!elementos) return null;
  const texto = trechos.map(t => t.texto).join('\n');
  const { achados, faltando } = procurar(texto, elementos);
  const alertas = [];
  for (const a of ALERTAS[item.id] || []) {
    if (a.quando && !a.quando(faltando)) continue;
    const m = a.semNegacao ? primeiraAfirmativa(texto, a.regex) : a.regex.exec(texto);
    if (m) alertas.push({ titulo: a.titulo, nivel: a.nivel, situacao: a.situacao, recomendacao: a.recomendacao, citacao: citacaoEmVolta(texto, m.index, a.citarAte, m[0].length) });
  }
  return { completo: faltando.length === 0 && alertas.length === 0, achados, faltando, alertas };
}

module.exports = {
  REFERENCIAS,
  referenciaDoItem,
  naoSeAplicaAoRegime,
  naoSeAplicaAoInstrumento,
  RE_COOPERACAO,
  OBSERVACAO_COOPERACAO,
  verificarItem,
  _paraTeste: { citacaoEmVolta, procurar, primeiraAfirmativa, semCabecalhosDePagina, ELEMENTOS, ALERTAS }
};
