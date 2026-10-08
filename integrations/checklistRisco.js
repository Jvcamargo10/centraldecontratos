/* ===================================================================
   integrations/checklistRisco.js

   Eixo "Conteúdo" do mapa de risco (Ferramenta 2): a régua está AQUI,
   escrita, como um checklist baseado nas cláusulas que a lei exige em todo
   contrato (art. 92 da Lei 14.133; art. 55 da 8.666). Para cada item, a
   leitura por regra (checklistPorRegra.js) procura a cláusula e confere
   se o que a lei pede está escrito — e mostra a frase como prova.

     - Conhecimento: explícito, versionado, revisável pelo jurídico.
     - Leitura: por regra, cláusula por cláusula. O que a regra não conclui
       sozinha (interpretação) fica "para conferência manual", com o que
       ela achou e o que faltou — nunca um veredito sem prova. (Até
       01/10/2026 esses itens iam a uma IA local; ela foi retirada: travava
       a máquina e respondia "atende" até onde a regra achou problema.)
     - Evidência: citação literal, CONFERIDA contra o texto.

   ATENÇÃO — antes de uso real, o jurídico da Prefeitura precisa validar
   este checklist (itens, referências e o que se considera risco). Ele é
   um ponto de partida técnico, não um parecer.

   ------------------------------------------------------------------
   Ausência só é afirmada com leitura completa
   ------------------------------------------------------------------
   "Não há cláusula de garantia" é o apontamento mais perigoso que esta
   ferramenta pode fazer errado: se o OCR leu 10 de 17 páginas e a
   garantia está na página 12, a ferramenta acusaria uma falha que não
   existe — e perderia a credibilidade na primeira vez. Então:
     - item não localizado + TODOS os documentos lidos por inteiro
         -> apontamento "não localizado" (médio: a busca é por título e
            termo, e pode falhar com redação incomum ou OCR ruim);
     - item não localizado + alguma leitura parcial
         -> NENHUM apontamento, só a situação "não localizado — leitura
            incompleta" no checklist, pra quem revisa saber o porquê.
=================================================================== */

const checklistPorRegra = require('./checklistPorRegra');

/* O checklist. `secao` localiza o trecho do contrato que trata do item;
   `oQueVerificar` é o conhecimento que vai no prompt — é isto que o
   jurídico precisa revisar. */
const CHECKLIST_LEI_14133 = [
  {
    id: 'penalidades',
    item: 'Penalidades e valores das multas, com base de cálculo',
    referencia: 'Lei 14.133/2021, art. 92, XIV',
    obrigatorio: true,
    secao: /(das?\s+(penalidades|san[çc][õo]es|infra[çc][õo]es)|\bmultas?\b)/i,
    titulo: /penalidad|san[çc][õo]es|infra[çc][õo]es/i,
    corpo: /s[ãa]o\s+aplic[áa]veis\s+as\s+san[çc]|ensejar[áa]\s+a\s+aplica[çc][ãa]o\s+d[ae]s?\s+(?:seguintes\W{1,4})?(?:penalidades|san[çc])|sujeitar[áa][^.;]{0,80}(?:penalidades|san[çc][õo]es)|[àa]s\s+seguintes\s+san[çc][õo]es/i,
    oQueVerificar: 'As multas têm percentual ou valor definido E base de cálculo clara (sobre o valor do contrato, da parcela, por dia de atraso)? Há limite máximo? Multa sem percentual ou sem base de cálculo é risco ALTO.'
  },
  {
    id: 'reajuste',
    item: 'Critério, data-base e periodicidade do reajuste',
    referencia: 'Lei 14.133/2021, art. 92, V',
    obrigatorio: true,
    secao: /(reajust|repactua|revis[ãa]o\s+de\s+pre[çc]os?|atualiza[çc][ãa]o\s+monet)/i,
    titulo: /reajust|repactua/i,
    oQueVerificar: 'O índice de reajuste está nomeado (IPCA, IGP-M, INPC ou índice setorial)? A data-base e a periodicidade estão definidas? "Índice oficial" sem dizer qual, ou reajuste sem data-base, é risco MÉDIO.'
  },
  {
    id: 'pagamento',
    item: 'Condições de pagamento e critério de medição',
    referencia: 'Lei 14.133/2021, art. 92, V e VI',
    obrigatorio: true,
    secao: /(do\s+pagamento|das?\s+condi[çc][õo]es\s+de\s+pagamento|da\s+medi[çc][ãa]o)/i,
    titulo: /pagamento/i,
    corpo: /o\s+pagamento\s+(?:ser[áa]|dever[áa]\s+ser)\s+(?:efetuad|realizad|feit|processad)/i,
    oQueVerificar: 'O prazo de pagamento está definido? O pagamento depende de medição ou aceite do objeto? Pagamento antecipado, sem garantia correspondente, é risco ALTO.'
  },
  {
    id: 'garantia',
    item: 'Garantia de execução e prazo de garantia do objeto',
    referencia: 'Lei 14.133/2021, art. 92, XII e XIII',
    obrigatorio: true,
    secao: /(da\s+garantia|garantia\s+(contratual|de\s+execu[çc][ãa]o)|cau[çc][ãa]o|seguro[\s-]garantia|fian[çc]a\s+banc)/i,
    titulo: /garantia/i,
    oQueVerificar: 'Há garantia contratual (caução, seguro-garantia ou fiança bancária) com percentual definido? Há prazo de garantia do objeto (assistência técnica, substituição)?'
  },
  {
    id: 'vigencia',
    item: 'Prazo de vigência e condições de prorrogação',
    referencia: 'Lei 14.133/2021, art. 92, VII',
    obrigatorio: true,
    secao: /(da\s+vig[êe]ncia|do\s+prazo\s+de\s+vig[êe]ncia|prorroga[çc][ãa]o)/i,
    titulo: /vig[êeé]ncia|do\s+prazo\b/i,
    corpo: /prazo\s+de\s+vig[êe]ncia|(?:contrato|instrumento)\s+ter[áa]\s+(?:a\s+)?vig[êe]ncia|vig[êe]ncia\s+(?:deste|do\s+presente)\s+(?:contrato|instrumento)|vigorar[áa]\s+(?:pelo\s+prazo|por)/i,
    oQueVerificar: 'A vigência tem prazo determinado? A prorrogação depende de justificativa e manifestação das partes? Renovação AUTOMÁTICA ou prazo indeterminado é risco ALTO.'
  },
  {
    id: 'extincao',
    item: 'Casos de extinção (rescisão) do contrato',
    referencia: 'Lei 14.133/2021, art. 92, XIX',
    obrigatorio: true,
    secao: /(da\s+(extin[çc][ãa]o|rescis[ãa]o)|extin[çc][ãa]o\s+do\s+contrato|rescis[ãa]o\s+do\s+contrato)/i,
    titulo: /extin[çc]|res\W{0,3}cis/i,
    corpo: /constituem\s+motivos?\s+para|motivos?\s+para\s+(?:a\s+)?(?:rescis|extin)/i,
    oQueVerificar: 'Os casos de extinção estão previstos (inexecução, razões de interesse público, acordo entre as partes)? Há previsão das consequências (retenção de créditos, execução da garantia)?'
  },
  {
    id: 'gestao',
    item: 'Gestão e fiscalização do contrato',
    referencia: 'Lei 14.133/2021, art. 92, XVIII',
    obrigatorio: true,
    secao: /(da\s+(gest[ãa]o|fiscaliza[çc][ãa]o)|gestor\s+do\s+contrato|fiscal\s+do\s+contrato)/i,
    titulo: /gest[ãa]o|gestor|fiscaliza|fiscal\b/i,
    corpo: /ficar[áa]\s+sob\s+a\s+gest[ãa]o/i,
    oQueVerificar: 'Há gestor e fiscal designados, ou a forma de designação? Estão definidos o acompanhamento, o registro de ocorrências e o aceite do objeto?'
  },
  {
    id: 'obrigacoes',
    item: 'Obrigações e responsabilidades das partes',
    referencia: 'Lei 14.133/2021, art. 92, XIV',
    obrigatorio: true,
    secao: /(das\s+obriga[çc][õo]es|das\s+responsabilidades|obriga[çc][õo]es\s+da\s+contratad)/i,
    titulo: /obriga|o\S{1,3}g\S{1,2}c[oõ]es|responsabilidades/i, // "oB1uGAcOES" (OCR, 108/2024)
    /* A regra lê o contrato INTEIRO: as obrigações ficam em duas cláusulas
       (contratada e contratante), o OCR some com títulos no meio da lista,
       e a transferência de responsabilidade pode estar em qualquer
       cláusula. As expressões da regra são específicas ("São obrigações
       do CONTRATANTE") — não casam por acaso. */
    regraNoDocumentoInteiro: true,
    oQueVerificar: 'As obrigações da contratada e da contratante estão definidas? Alguma cláusula transfere à Prefeitura responsabilidade que deveria ser da contratada (encargos trabalhistas, danos a terceiros)? Isso é risco ALTO.'
  },
  {
    id: 'matriz',
    item: 'Matriz de riscos',
    referencia: 'Lei 14.133/2021, art. 92, IX (quando for o caso)',
    obrigatorio: false,
    secao: /matriz\s+de\s+riscos?/i,
    oQueVerificar: 'A matriz aloca cada risco a uma das partes de forma clara? Algum risco que deveria ser da contratada ficou alocado à Prefeitura?'
  }
];


/* ------------------------------------------------------------------
   Localização do trecho de cada item nos documentos
------------------------------------------------------------------ */

/* Título da cláusula que começa em `pos`: até o primeiro subitem ("4.1.",
   "41. O valor") — o OCR quebra o título em duas linhas ("CLÁUSULA
   TERCEIRA -\nDA GARANTIA"). */
function tituloDaClausula(texto, pos) {
  // Também para no fim de frase e no próximo "CLÁUSULA": "conforme a
  // cláusula quinta, o prazo... CLÁUSULA SEXTA - DO PAGAMENTO" não é um título.
  return texto.slice(pos, pos + 160).split(/\s\d{1,2}\s*[.,:]\s*\d|\s\d{2,3}\.\s+[A-ZÁ-Ú]|[.;]\s|\scl[áa]usula\s/i)[0].replace(/\s+/g, ' ');
}

/* Posições de títulos de cláusula para a busca por palavra-chave: o
   "CLÁUSULA" em MAIÚSCULAS ("conforme a cláusula quinta", no corpo, não é
   título) e o que o OCR estragou mas manteve a forma de título — palavra
   parecida, ordinal e travessão: "CLAUSUTA DECIMA TERCEIRA -", "cLAusuLA
   SEnMA -" (contratos 108/2024 e 009/2023). */
function titulosTolerantes(texto, clausulas) {
  const posicoes = clausulas.filter(t => t[0] === t[0].toUpperCase()).map(t => t.index);
  for (const m of texto.matchAll(/\bc\S?l\S{3,6}\s+(?:\S{3,10}\s+){1,2}[-—–:=]/gi)) {
    // "cláusula quinta -" / "Cláusula Quinta -" no corpo: no máximo uma maiúscula
    if ((m[0].slice(0, 8).match(/[A-ZÁ]/g) || []).length <= 1) continue;
    if (!posicoes.includes(m.index)) posicoes.push(m.index);
  }
  return posicoes.sort((a, b) => a - b);
}

/* Posição do trecho que trata do item, nesta ordem:
     1. TÍTULO de cláusula ("CLÁUSULA QUARTA — DO VALOR E DO PAGAMENTO") —
        no corpo do texto os termos aparecem em qualquer lugar ("multa"
        pode estar numa cláusula de pagamento);
     2. título com a palavra-chave do item, em MAIÚSCULAS ("DOS CRITÉRIOS
        DE MEDIÇÃO E PAGAMENTO", "DA RES! CISÃO", "BA VIGENCIA");
     3. título em MAIÚSCULAS com "CLÁUSULA" estragado pelo OCR;
     4. a frase que ABRE a cláusula ("São aplicáveis as sanções...", "O
        pagamento será efetuado...") — o título pode ter sumido no OCR;
     5. a primeira ocorrência do termo.
   `extras` é o próprio item do checklist (campos `titulo` e `corpo`).
   Medido em 25/09/2026: 14 itens "para conferência" vinham de trecho de
   OUTRA cláusula por causa de título estragado ou ausente. */
function localizarNoTexto(texto, secao, extras = {}) {
  const alvo = String(texto || '');
  const clausulas = [...alvo.matchAll(/cl[áa]usula\s+/gi)];
  for (const t of clausulas) {
    if (secao.test(tituloDaClausula(alvo, t.index))) return t.index;
  }
  if (extras.titulo) {
    for (const pos of titulosTolerantes(alvo, clausulas)) {
      if (extras.titulo.test(tituloDaClausula(alvo, pos))) return pos;
    }
  }
  /* Título com a palavra "CLÁUSULA" estragada pelo OCR ("CLAUSUILA",
     "ciAusuL&"): o título continua em MAIÚSCULAS ("DAS PENALIDADES"), e
     o corpo do texto não. Medido em 23/09/2026: sem isto, parte dos
     contratos lia um trecho da cláusula de pagamento no item de
     penalidades, só porque ali aparecia a palavra "multa". */
  for (const m of alvo.matchAll(new RegExp(secao.source, secao.flags.replace('g', '') + 'g'))) {
    if (m[0].length >= 5 && m[0] === m[0].toUpperCase() && /[A-ZÁ-Ú]{4}/.test(m[0])) return m.index;
  }
  if (extras.corpo) {
    const c = extras.corpo.exec(alvo);
    if (c) return c.index;
  }
  const m = secao.exec(alvo);
  return m ? m.index : -1;
}

/* Número da página em que está a posição, pelos marcadores
   "[página N]" que extratorDocumento.js insere no texto. */
function paginaDaPosicao(texto, posicao) {
  let pagina = null;
  for (const m of String(texto).slice(0, posicao).matchAll(/\[página (\d+)\]/g)) pagina = Number(m[1]);
  return pagina;
}

/* Trechos do item em cada documento (no máximo `maxDocumentos`), já na
   ordem de prioridade dos documentos (contrato principal primeiro). */
/* A posição achada é um TÍTULO de cláusula ("CLÁUSULA TERCEIRA - DO
   REAJUSTE", "DAS PENALIDADES")? Então o trecho começa nele. Se for só uma
   menção no meio do texto ("...em relação ao mês do reajustamento"), o
   trecho volta 500 caracteres: o começo da cláusula — índice, prazo — fica
   ANTES da palavra. Medido em 25/09/2026: o trecho do 010/2024 começava em
   "o base o índice vigente..." e perdia o IPCA e os 12 meses. */
function ehTitulo(texto, pos) {
  // Título longo: "CLÁUSULA QUARTA - DO VALOR DO CONTRATO, DOS RECURSOS
  // FINANCEIROS E DO REAJUSTE" — a palavra fica a ~70 caracteres do "CLÁUSULA".
  const antes = texto.slice(Math.max(0, pos - 130), pos);
  const trecho = texto.slice(pos, pos + 30);
  return /cl[áa]usula[^.;]{0,110}$/i.test(antes) || (trecho === trecho.toUpperCase() && /[A-ZÁ-Ú]{4}/.test(trecho));
}

function trechosDoItem(item, documentos, tamanhoTrecho, maxDocumentos) {
  const trechos = [];
  for (const doc of documentos) {
    if (trechos.length >= maxDocumentos) break;
    const pos = localizarNoTexto(doc.texto, item.secao, item);
    if (pos < 0) continue;
    const recuo = ehTitulo(doc.texto, pos) ? 80 : 500;
    const inicio = Math.max(0, pos - recuo);
    const fim = inicio + tamanhoTrecho + recuo - 80;
    trechos.push({
      documento: doc.nome, pagina: paginaDaPosicao(doc.texto, pos), texto: doc.texto.slice(inicio, fim),
      textoDaRegra: doc.texto.slice(inicio, Math.max(fim, fimDaClausula(doc.texto, pos)))
    });
  }
  return trechos;
}

/* Onde termina a cláusula que começa (ou está) em `pos`: no próximo título
   "CLÁUSULA ..." em MAIÚSCULAS, no máximo 5000 caracteres adiante. Só a
   regra lê a cláusula inteira (custa milissegundos); o trecho curto é o
   que aparece como "onde foi localizado". Medido em 25/09/2026: no contrato 009/2023 a
   designação dos gestores estava 1.330 caracteres depois do título, fora
   do trecho de 1.400 (o OCR enche o texto de tabulações). */
function fimDaClausula(texto, pos) {
  const LIMITE = 5000;
  const resto = texto.slice(pos + 40, pos + LIMITE);
  const m = /\bCL[ÁA]U\S{1,4}\s+[A-ZÁÉÍÓÚ]{4}/.exec(resto);
  return m ? pos + 40 + m.index : pos + LIMITE;
}

/* As OUTRAS cláusulas do contrato principal cujo título também é deste
   item — só para a leitura por regra. Medido em 25/09/2026: o contrato
   061/2025 tem "CLÁUSULA SEGUNDA - DA EXECUÇÃO DOS SERVIÇOS E DA
   FISCALIZAÇÃO" e, mais adiante, a cláusula da gestão; a regra só via a
   primeira e dava "gestor não achado". Só títulos "CLÁUSULA ..." (menção
   solta no corpo do texto não conta) e só no documento do primeiro trecho
   (o de maior prioridade em contratoPrimeiro() que trata do item). */
function outrasClausulasDoItem(item, documentos, trechos, tamanhoTrecho) {
  const doc = trechos.length ? documentos.find(d => d.nome === trechos[0].documento) : null;
  if (!doc) return [];
  const texto = String(doc.texto || '');
  const primeira = localizarNoTexto(texto, item.secao, item);
  const extras = [];
  for (const t of texto.matchAll(/cl[áa]usula\s+/gi)) {
    if (extras.length >= 3) break;
    if (t.index >= primeira - 500 && t.index <= primeira) continue; // já está no trecho
    const titulo = tituloDaClausula(texto, t.index);
    if (!item.secao.test(titulo) && !(item.titulo && t[0] === t[0].toUpperCase() && item.titulo.test(titulo))) continue;
    const trecho = texto.slice(t.index, Math.max(t.index + tamanhoTrecho, fimDaClausula(texto, t.index)));
    extras.push({ documento: doc.nome, pagina: paginaDaPosicao(texto, t.index), texto: trecho });
  }
  return extras;
}

/* O CONTRATO primeiro (sem extrato): a pasta junta aditivos, apostilamentos
   e extratos — o apostilamento que APLICA um reajuste ("fica reajustado em
   8,72%") não é a cláusula de reajuste, e o extrato do Diário Oficial traz
   outros contratos. Medido em 25/09/2026: parte dos itens "para
   conferência" vinha de trecho de aditivo. */
function contratoPrimeiro(documentos) {
  const { classificarDocumento } = require('./valorContratual').pecas;
  const peso = d => { const c = classificarDocumento(d.nome || ''); return c.tipo === 'contrato' && !c.extrato ? 0 : c.extrato ? 2 : 1; };
  return documentos.map((d, i) => ({ d, i })).sort((a, b) => (peso(a.d) - peso(b.d)) || (a.i - b.i)).map(x => x.d);
}

/* ------------------------------------------------------------------
   Conferência da citação contra o texto
------------------------------------------------------------------ */

function normalizarParaComparar(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/* Onde (documento e página) a citação aparece de verdade. Compara sem
   acento, caixa e pontuação — o OCR mexe nisso — e aceita a citação se
   ao menos um pedaço longo dela (8 palavras seguidas) está no texto. Devolve null se não achar:
   aí a citação foi parafraseada ou inventada. */
function localizarCitacao(citacao, documentos) {
  const palavras = normalizarParaComparar(citacao).split(' ').filter(Boolean);
  if (palavras.length < 4) return null;
  const tamanhoJanela = Math.min(8, palavras.length);
  for (const doc of documentos) {
    const texto = normalizarParaComparar(doc.texto);
    for (let i = 0; i + tamanhoJanela <= palavras.length; i++) {
      const janela = palavras.slice(i, i + tamanhoJanela).join(' ');
      const pos = texto.indexOf(janela);
      if (pos >= 0) {
        // Página: acha a mesma janela no texto original para ler o marcador.
        const bruto = String(doc.texto);
        const marcadores = [...bruto.matchAll(/\[página (\d+)\]/g)];
        let pagina = null;
        for (const mk of marcadores) {
          const ateAqui = normalizarParaComparar(bruto.slice(0, mk.index));
          if (ateAqui.length <= pos) pagina = Number(mk[1]);
        }
        return { documento: doc.nome, pagina };
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------
   Análise completa
------------------------------------------------------------------ */

/* `documentos`: [{ nome, texto, leituraCompleta }] — texto com os
   marcadores "[página N]" e CPF já mascarado (responsabilidade de quem
   chama; ver mapaRiscoContratos.js).
   `aoProgredir(info)`: opcional, chamada a cada item.
   `regime`: { lei: '8.666' | '14.133' | null } — muda a referência legal
   de cada item e dispensa a matriz de riscos na 8.666.
   `usarRegras`: a leitura por regra de cada item (ver
   checklistPorRegra.js). Desligada, todo item localizado fica para
   conferência manual — só serve para comparar. */
async function analisarPorChecklist({ documentos, aoProgredir, tamanhoTrecho = 1400, maxDocumentosPorItem = 2, regime = null, usarRegras = true, instrumento = null }) {
  const leituraCompleta = documentos.length > 0 && documentos.every(d => d.leituraCompleta);
  const findings = [];
  const checklist = [];
  let resolvidosPorRegra = 0;
  let paraConferencia = 0;
  const documentosOrdenados = contratoPrimeiro(documentos);

  for (let i = 0; i < CHECKLIST_LEI_14133.length; i++) {
    const itemOriginal = CHECKLIST_LEI_14133[i];
    const referencia = checklistPorRegra.referenciaDoItem(itemOriginal, regime);
    const item = { ...itemOriginal, referencia };
    const base = { id: item.id, item: item.item, referencia, obrigatorio: item.obrigatorio };
    if (checklistPorRegra.naoSeAplicaAoRegime(item, regime)) {
      checklist.push({ ...base, obrigatorio: false, situacao: 'nao_se_aplica', fonte: 'regra', documentos: [] });
      continue;
    }
    // Acordo de cooperação sem repasse: itens de dinheiro não se aplicam.
    if (checklistPorRegra.naoSeAplicaAoInstrumento(item, instrumento)) {
      checklist.push({ ...base, obrigatorio: false, situacao: 'nao_se_aplica', fonte: 'regra', documentos: [], observacao: checklistPorRegra.OBSERVACAO_COOPERACAO });
      continue;
    }
    const trechos = trechosDoItem(item, documentosOrdenados, tamanhoTrecho, maxDocumentosPorItem);

    if (!trechos.length) {
      // Ver a nota "Ausência só é afirmada com leitura completa" no topo.
      if (!item.obrigatorio) {
        checklist.push({ ...base, situacao: 'nao_se_aplica', documentos: [] });
      } else if (leituraCompleta) {
        checklist.push({ ...base, situacao: 'nao_localizado', documentos: [] });
        findings.push({
          titulo: `Cláusula de "${item.item.toLowerCase()}" não localizada`,
          nivel: 'medio',
          itemChecklist: item.id,
          clausula: null, citacao: null, documento: null, pagina: null, citacaoVerificada: null,
          recomendacao: `Nenhum dos documentos lidos traz uma cláusula sobre isto (${item.referencia}). Confirme no original: se a cláusula não existir, o contrato não atende ao que a lei exige.`
        });
      } else {
        checklist.push({ ...base, situacao: 'nao_localizado_leitura_incompleta', documentos: [] });
      }
      continue;
    }

    const ondeLocalizou = trechos.map(t => ({ nome: t.documento, pagina: t.pagina }));
    const docDoItem = documentosOrdenados.find(d => d.nome === trechos[0].documento);
    const trechosDaRegra = !usarRegras ? trechos
      : item.regraNoDocumentoInteiro && docDoItem
        ? [{ documento: docDoItem.nome, pagina: trechos[0].pagina, texto: String(docDoItem.texto || '') }].concat(trechos.slice(1))
        : trechos.map(t => ({ ...t, texto: t.textoDaRegra || t.texto })).concat(outrasClausulasDoItem(item, documentosOrdenados, trechos, tamanhoTrecho));
    const leituraDaRegra = usarRegras ? checklistPorRegra.verificarItem(item, trechosDaRegra) : null;
    const evidencias = leituraDaRegra ? leituraDaRegra.achados : undefined;

    /* A regra achou uma frase que já é apontamento (renovação automática,
       multa só por remissão a decreto): a citação é literal. */
    if (leituraDaRegra && leituraDaRegra.alertas.length) {
      resolvidosPorRegra++;
      const ORDEM = { atende_parcialmente: 1, nao_atende: 2 };
      let situacao = 'atende_parcialmente';
      leituraDaRegra.alertas.forEach(a => {
        if ((ORDEM[a.situacao] || 0) > ORDEM[situacao]) situacao = a.situacao;
        const onde = localizarCitacao(a.citacao, trechosDaRegra.map(t => ({ nome: t.documento, texto: t.texto })));
        findings.push({
          titulo: a.titulo, nivel: a.nivel, itemChecklist: item.id, fonte: 'regra',
          clausula: null, citacao: a.citacao,
          documento: onde ? onde.documento : trechos[0].documento,
          pagina: onde ? (onde.pagina || trechos[0].pagina) : trechos[0].pagina,
          citacaoVerificada: true,
          recomendacao: a.recomendacao
        });
      });
      checklist.push({ ...base, situacao, fonte: 'regra', evidencias, faltando: leituraDaRegra.faltando, documentos: ondeLocalizou });
      continue;
    }
    /* Todos os elementos do item estão escritos: atende, com a evidência
       copiada do texto. */
    if (leituraDaRegra && leituraDaRegra.completo) {
      resolvidosPorRegra++;
      checklist.push({ ...base, situacao: 'atende', fonte: 'regra', evidencias, documentos: ondeLocalizou });
      continue;
    }
    const faltando = leituraDaRegra ? leituraDaRegra.faltando : [];

    /* A regra não conclui sozinha: o item fica para conferência manual,
       com o que ela achou e o que faltou, para quem confere saber onde
       olhar. (Situação "falha" por compatibilidade com os mapas gravados;
       a tela mostra "Para conferência manual".) */
    if (aoProgredir) aoProgredir({ itemAtual: i + 1, totalItens: CHECKLIST_LEI_14133.length, item: item.item });
    checklist.push({ ...base, situacao: 'falha', evidencias, faltando, documentos: ondeLocalizou, erro: 'a leitura automática não conclui este item sozinha — confira no documento' });
    paraConferencia++;
  }

  return { findings, checklist, resolvidosPorRegra, paraConferencia, leituraCompleta, regime };
}

/* Nível do eixo Conteúdo: o pior entre os apontamentos que se SUSTENTAM.
   Apontamento com citação que não foi encontrada nos documentos (só
   existe em mapas antigos, da época da IA) continua aparecendo, marcado
   em vermelho, mas não define o nível. */
function nivelDoConteudo(findings) {
  const ORDEM = { baixo: 0, medio: 1, alto: 2 };
  return (findings || [])
    .filter(f => f.citacaoVerificada !== false)
    .reduce((pior, f) => (ORDEM[f.nivel] > ORDEM[pior] ? f.nivel : pior), 'baixo');
}

module.exports = {
  CHECKLIST_LEI_14133,
  analisarPorChecklist,
  nivelDoConteudo,
  _paraTeste: { localizarNoTexto, paginaDaPosicao, trechosDoItem, localizarCitacao, contratoPrimeiro }
};
