/* ===================================================================
   integrations/valorContratual.js

   Média mensal do contrato pela regra do SGC (explicada pelo usuário em
   21/09/2026):

     média mensal = (valor inicial + aditivos/apostilamentos de valor)
                    ÷ (vigência inicial em meses + aditivos/apostilamentos de prazo)

   Tudo sai dos documentos da pasta "3. Contratos, Aditivos e Termos" de
   cada processo: o contrato original dá a parte inicial; cada termo
   aditivo, o valor acrescido e os meses prorrogados. Conferido ao
   centavo contra o SGC, por exemplo:

     072/2020  (2.780.000,00 + 784.074,48 + 392.037,24) ÷ (24 + 24 + 12) = 65.935,20
     045/2022  (9.000.000,00 + 2.157.913,60 + 6.996.235,20) ÷ (30 + 18) = 378.211,43
     130/2023  (3.600.000,00 + 3.600.000,00) ÷ (24 + 24)                 = 150.000,00

   Que termo entra na conta:
   - PRORROGAÇÃO ("Fica prorrogada a vigência do Contrato nº X, por mais
     18 meses"): entram os meses e o valor do novo período. Prorrogação
     cujo valor não se consegue ler fica FORA, com aviso — somar só os
     meses derrubaria a média pela metade.
   - ACRÉSCIMO ("para acréscimo do valor contratual em R$ ..."): entra o
     valor, sem meses. Supressão entra negativa.
   - O resto (alteração de CNPJ/razão social, de garantia, de fiscal) não
     muda valor nem prazo — não entra, mesmo que cite valores.

   Cuidados que os documentos reais exigiram:
   - O "Extrato" é a página do Diário Oficial (IOM), com DEZENAS de
     contratos de outras secretarias. Nunca se lê o extrato inteiro: só o
     parágrafo que cita o número deste contrato, e só quando o documento
     próprio (contrato ou termo) não deu a informação.
   - Termo arquivado na pasta errada existe (a pasta do 072/2020 tem um
     termo do 118/2022): termo que não cita o número do contrato é
     ignorado, com aviso.
   - Valor de garantia ("5% do valor total do Termo, qual seja R$ ...") e
     total acumulado ("perfazendo o valor total do contrato de R$ ...")
     não são valor de aditamento.
   - O mesmo termo aparece em vários arquivos (termo, extrato, "- Copia");
     conta uma vez só, pelo número do termo.
   - OCR cola e troca letras ("Ficaprorrogada", "pronogada a vigincia",
     "Owlortotuldo presente Termo", "R$ 80.725,302,00"); os padrões são
     tolerantes a isso.

   Não depende de leituraPorRegra.js (é ele que depende deste módulo).
=================================================================== */

const CABECALHO_ARQUIVO = /=== Arquivo: (.+?) ===\r?\n/g;

/* "=== Arquivo: X ===" separa os documentos do grupo no texto combinado
   (ver ingestaoContratos.combinarTextoCompleto). Sem cabeçalho, o texto
   inteiro é um documento só, sem nome. */
function dividirEmDocumentos(texto) {
  const t = String(texto || '');
  const cabecalhos = [...t.matchAll(CABECALHO_ARQUIVO)];
  if (cabecalhos.length === 0) return [{ nome: '', texto: t }];
  return cabecalhos.map((m, i) => ({
    nome: m[1].trim(),
    texto: t.slice(m.index + m[0].length, i + 1 < cabecalhos.length ? cabecalhos[i + 1].index : t.length)
  }));
}

/* Classificação pelo NOME do arquivo — é como a SETEC organiza a pasta 3
   ("Contrato Nº 045_2022.pdf", "Termo de Aditamento Nº 238_2024.pdf",
   "Extrato do Apostilamento Nº 02_2025.pdf", "IOM 2939 - Termo de
   aditamento nº 268_2025.pdf" — IOM é a Imprensa Oficial, ou seja, um
   extrato). "Extrat" sem o "o" também aparece. */
function classificarDocumento(nome) {
  const n = String(nome || '');
  const extrato = /extrat|iom|imprensa\s+oficial|di[áa]rio\s+oficial/i.test(n);
  let tipo = 'outro';
  // Termo de Referência, minuta, cronograma e planilha de um aditivo não
  // são o termo — só o planejam ("Termo Referencia Aditivo Locação...docx").
  if (/refer[êe]ncia|minuta|crono|planilha|proposta|or[çc]amento/i.test(n)) tipo = 'outro';
  // "Ordem de Inicio de Serviços - Contrato 048_2026.pdf": marco da vigência,
  // não o contrato (ver vigenciaContratual.js).
  // "Ordem de Fornecimento" (contratos de fornecimento contam a vigência
  // dela — 096/2025) e arquivos chamados só "OS.pdf" / "O.F. ...".
  else if (/ordem\s*de\s*(in[íi]cio|servi[çc]o|fornecimento)|ordem_de_in[íi]cio|^(?:O\.?S|O\.?F)\.?(?:[\s._-]|$)/i.test(n)) tipo = 'ordem';
  else if (/aditiv|aditament/i.test(n)) tipo = 'aditivo';
  else if (/apostil/i.test(n)) tipo = 'apostilamento';
  // Portaria de gestor, ofício, declaração e anexo citam "contrato" no nome
  // ("Portaria alteração gestor e suplente do contrato 66_20.pdf") sem ser ele.
  else if (/rescis|ci[êe]ncia|notifica|portaria|of[íi]cio|declara|anexo|nota\s*fiscal|empenho/i.test(n)) tipo = 'outro';
  else if (/contrato/i.test(n)) tipo = 'contrato';
  return { tipo, extrato };
}

/* Número do termo no nome do arquivo, logo depois da palavra que o
   identifica: "Termo de Aditamento Nº 238_2024", "TERMO ADITAMENTO
   040-2025-PA-...", "Aditivo de Contrato Nº 215_2022", "Termo Aditamento
   - 147_2023 - Copia", "Extrato Apostilamento Nº 027". Só o número
   (sem o ano): o ano às vezes falta no nome do extrato, e dois termos
   com o mesmo número no mesmo contrato não acontecem. */
function numeroDoTermo(nome) {
  const m = String(nome || '').match(/(?:aditiv|aditament|apostil)\w*\D{0,20}?(\d{1,4})(?!\d)/i);
  return m ? String(Number(m[1])).padStart(3, '0') : null;
}

/* "045/2022" -> casa "045/2022", "45/2022", "045.2022", "045/22" (OCR e
   grafias vistas nos documentos). */
function regexDoNumero(numero) {
  const m = String(numero || '').match(/(\d{1,4})\s*\/\s*(\d{4})/);
  if (!m) return null;
  const n = String(Number(m[1]));
  return new RegExp(`(?<!\\d)0*${n}\\s*[\\/._]\\s*(?:${m[2]}|${m[2].slice(2)})(?!\\d)`);
}

/* Valor em reais escrito, tolerante ao OCR: "R$784.074,48",
   "R$ R$ 392.037,24", "R$ 3.600.000 (três milhões...)" (sem centavos) e
   "R$ 80.725,302,00" (vírgula no lugar do ponto de milhar),
   "R$ 25.879949,76" (ponto de milhar perdido) e "R$ 2:296,800,00". */
const VALOR_EM_REAIS = /R\$\s*(?:R\$\s*)?(\d{1,3}(?:[.,:]?\d{3})*)(,\d{2})?(?![\d])/g;

function paraNumero(inteiro, centavos) {
  return Number(inteiro.replace(/[.,:]/g, '') + (centavos ? '.' + centavos.slice(1) : ''));
}

function valoresEmReais(texto) {
  return [...String(texto).matchAll(VALOR_EM_REAIS)]
    .map(m => ({ valor: paraNumero(m[1], m[2]), indice: m.index, fim: m.index + m[0].length }))
    .filter(v => v.valor > 0);
}

const arredondar = v => Math.round(v * 100) / 100;
// O número por extenso pode quebrar linha no OCR: "24 (vinte e\nquatro) meses".
const MESES = /(\d{1,3})\s*\(\s*[a-zà-ú\s]{2,30}\)\s*(m[eê]s|anos?)/i;
const emMeses = (n, unidade) => /^ano/i.test(unidade) ? Number(n) * 12 : Number(n);

/* ------------------------------------------------------------------
   Contrato original: valor global e vigência em meses.
------------------------------------------------------------------ */
const FRASE_VALOR_GLOBAL = /valor\s*(?:total|global)(?:\s*(?:total|global))?([\s\S]{0,90}?)(?=R\$)/i;

function acharValorGlobal(texto) {
  const t = String(texto);
  const m = t.match(FRASE_VALOR_GLOBAL);
  if (!m) return undefined;
  const v = valoresEmReais(t.slice(m.index + m[0].length, m.index + m[0].length + 60))[0];
  return v ? v.valor : undefined;
}

/* Prazo do contrato em meses. Primeiro o prazo escrito na própria frase
   do valor ("O valor total deste contrato para 24 (vinte e quatro) meses
   é de R$ ..."); depois a cláusula de vigência em qualquer das formas
   vistas: "terá a vigência de 30 (trinta) meses", "O prazo de vigência
   deste Contrato é de 24 (vinte e quatro) meses", "Vigência: 12 (doze)
   meses", "vigência de 05 (cinco) anos" (60 meses). "Vigência ...
   poderá ser prorrogada por até 60 meses" não é o prazo. Até 21/09/2026
   a forma "é de" não era reconhecida, e o valor caía num "valor mensal"
   de OUTRO contrato do Diário Oficial. */
function acharVigenciaMeses(texto) {
  const t = String(texto);
  const frase = t.match(FRASE_VALOR_GLOBAL);
  if (frase) {
    const naFrase = frase[1].match(MESES);
    if (naFrase) return emMeses(naFrase[1], naFrase[2]);
  }
  for (const m of t.matchAll(/vig\S{0,2}ncia([^.;]{0,60}?)(\d{1,3})\s*\(\s*[a-zà-ú\s]{2,30}\)\s*(m[eê]s|anos?)/gi)) {
    if (!/prorrog/i.test(m[1])) return emMeses(m[2], m[3]);
  }
  return undefined;
}

/* Valor que o próprio texto chama de mensal ("R$ 700.000,00 mensais").
   Último recurso: só é consultado no documento do contrato (nunca no
   Diário Oficial inteiro, onde há "valor mensal" de outros contratos). */
function acharValorMensal(texto) {
  const MENSAL = /(mensal|por\s+m[êe]s|\/m[êe]s|mensalidade)/i;
  const t = String(texto);
  for (const v of valoresEmReais(t)) {
    const redor = t.slice(Math.max(0, v.indice - 120), v.fim + 120);
    if (MENSAL.test(redor)) return v.valor;
  }
  return undefined;
}

/* Parágrafos do extrato (Diário Oficial) que falam DESTE contrato: de
   cada citação do número até o fim daquele registro — o início do
   próximo ("Processo Administrativo nº 24.086/2021; Termo de Aditamento
   nº 111/2025 ao Contrato nº 118/2022...") ou 900 caracteres. Sem esse
   corte, a prorrogação do registro seguinte (de OUTRO contrato) era
   atribuída a este. `termo` (opcional) prefere o registro daquele termo
   ("Termo de Aditamento nº 100/2025 ao Contrato nº 086/2021"). Sem o
   número do contrato, não há como saber qual parágrafo é o dele. */
const FIM_DO_REGISTRO = /processo\s*(?:administrativo)?\s*(?:n[º°o.]*)?\s*(?::|[\d.]+\s*\/\s*\d{4})/i;

function paragrafosDoExtrato(texto, reNumero, termo) {
  if (!reNumero) return [];
  const t = String(texto);
  const reTermo = termo ? new RegExp(`n[º°o.]*\\s*0*${Number(termo)}\\s*[\\/._]`, 'i') : null;
  const paragrafos = [...t.matchAll(new RegExp(reNumero.source, 'g'))].map(m => {
    const resto = t.slice(m.index, m.index + 900);
    const fim = resto.slice(20).search(FIM_DO_REGISTRO);
    return {
      texto: fim >= 0 ? resto.slice(0, fim + 20) : resto,
      doTermo: !!reTermo && reTermo.test(t.slice(Math.max(0, m.index - 150), m.index))
    };
  });
  const doTermo = paragrafos.filter(p => p.doTermo);
  return (doTermo.length ? doTermo : paragrafos).map(p => p.texto);
}

function paragrafoDoExtrato(texto, reNumero) {
  return paragrafosDoExtrato(texto, reNumero)[0] || null;
}

/* ------------------------------------------------------------------
   Termo aditivo / apostilamento.
------------------------------------------------------------------ */
// "prorrogada excepcionalmente a vigência" (066/2020, termo 176/2025) também conta.
const PRORROGACAO = /pro[rn]+ogad[ao]\s*(?:[a-zà-ú]+mente\s*)?(?:a|o)?\s*(?:vig\S{0,2}ncia|prazo)[^.;]{0,80}?por\s*(?:mais\s*)?(\d{1,3})\s*\(/i;
const ACRESCIMO = /acr[ée]sc\w*|acrescer|supress\w*|suprimir|valor\s*(?:deste|do\s*presente)\s*(?:termo\s*(?:de\s*)?)?(?:aditamento|aditivo)/gi;
// Contexto que diz que o valor NÃO é o do aditamento.
const NAO_E_VALOR_DO_TERMO = /garantia|cau[çc][ãa]o|perfazendo|passa(?:ndo)?\s+a\s+ser|atualizado\s+do\s+contrato/i;

/* Com o número do contrato conhecido, a prorrogação precisa citá-lo
   ("prorrogada a vigência do Contrato nº 045/2022, por mais 18 meses") —
   um termo pode trazer, colada, a página do Diário com outros contratos. */
function mesesProrrogados(texto, reNumero) {
  for (const m of String(texto).matchAll(new RegExp(PRORROGACAO.source, 'gi'))) {
    if (!reNumero || reNumero.test(m[0])) return Number(m[1]);
  }
  return 0;
}

function ehValorDoTermo(texto, v) {
  return !NAO_E_VALOR_DO_TERMO.test(String(texto).slice(Math.max(0, v.indice - 250), v.indice));
}

function ehGarantia(texto, v) {
  return /garantia|cau[çc][ãa]o/i.test(String(texto).slice(Math.max(0, v.indice - 250), v.indice));
}

/* Valor do novo período, numa prorrogação. Em ordem:
   1. "perfazendo, pelo período de 12 (doze) meses, o montante de
      R$ 17.781.900,00" — o total do período, dito com todas as letras;
   2. o primeiro valor que não é garantia nem total acumulado — e, se o
      texto diz que ele é MENSAL ("O valor mensal do contrato, sem
      reajuste, permanece em R$ 1.481.825,00"; "Valor mensal: R$ ..."),
      o período vale mensal × meses. Até 21/09/2026 esse valor mensal
      entrava como se fosse o do período inteiro (066/2020: 1,48 milhão
      em vez de 17,8 milhões por prorrogação). */
function valorDaProrrogacao(texto, meses) {
  const t = String(texto);
  const periodo = t.match(/perfazendo,?\s*(?:pelo|para\s*o)\s*per[íi]odo\s*de\s*\d{1,3}[^R]{0,60}?(?=R\$)/i);
  if (periodo) {
    const fim = periodo.index + periodo[0].length;
    const v = valoresEmReais(t.slice(fim, fim + 40))[0];
    if (v) return { valor: v.valor };
  }
  const v = valoresEmReais(t).find(x => ehValorDoTermo(t, x));
  if (!v) return { valor: 0 };
  if (meses > 0 && /(?:m|rn)ensal/i.test(t.slice(Math.max(0, v.indice - 80), v.indice))) {
    return { valor: arredondar(v.valor * meses), mensal: v.valor };
  }
  return { valor: v.valor };
}

/* Novo valor MENSAL que um reajuste (ou a retificação dele) fixa:
   "para que seja reajustado em 8,727060%, correspondendo ao valor
   mensal contratual de R$ 117.428,40"; "o valor mensal do contrato,
   reajustado, passa a ser de R$ ..."; "valor rnensal" (OCR). */
function novoValorMensal(texto) {
  const t = String(texto);
  for (const m of t.matchAll(/valor\s*(?:m|rn)ensal/gi)) {
    const ini = m.index + m[0].length;
    const v = valoresEmReais(t.slice(ini, ini + 160)).map(x => ({ ...x, indice: x.indice + ini })).find(x => !ehGarantia(t, x));
    if (v) return v.valor;
  }
  return 0;
}

/* "Fica retificado o Termo de Aditamento nº 137/2022 ao Contrato nº
   066/2020, para que conste o valor de R$ 1.698.952,80"; "Fica
   retificado o Apostilamento nº 027/2023 ... para que conste o valor
   mensal contratual de R$ 117.425,22". O termo retificado passa a valer
   com o valor novo; o que retifica não soma nada por si. */
const RETIFICACAO = /retificad[oa]\s*o\s*(termo\s*de\s*a\S{0,3}itamento|aditamento|termo\s*aditivo|aditivo|apostilamento)\s*n\S{0,3}\s*(\d{1,4})/i;

/* Valor de acréscimo/supressão: o primeiro valor até 300 caracteres
   depois da palavra ("acréscimo do valor contratual em R$ ...",
   "para acrescer o percentual de 14,07% ... correspondente ao valor de
   R$ ..."). */
function valorDeAcrescimo(texto, reNumero) {
  const t = String(texto);
  for (const m of t.matchAll(ACRESCIMO)) {
    // Mesmo cuidado da prorrogação: "Fica aditado o Contrato nº 010/2024, para acrescer...".
    // "O valor deste Aditamento" já diz de qual termo é.
    if (reNumero && !/valor/i.test(m[0]) && !reNumero.test(t.slice(Math.max(0, m.index - 200), m.index))) continue;
    const inicio = m.index + m[0].length;
    const v = valoresEmReais(t.slice(inicio, inicio + 300)).map(x => ({ ...x, indice: x.indice + inicio }))
      .find(x => ehValorDoTermo(t, x));
    if (v) return /supress|suprim/i.test(m[0]) ? -v.valor : v.valor;
  }
  return 0;
}

/* O que um texto de termo (ou o parágrafo dele no extrato) muda no
   contrato: { natureza, meses, valor } — e, para reajuste e retificação,
   o novo valor mensal ou o termo retificado. A ordem importa: um termo
   de retificação cita valores do termo que corrige; "com o reajuste e
   com o acréscimo, passa a ser de R$ X" é mudança de valor MENSAL (o
   acréscimo não acha valor próprio ali, porque "passa a ser" não é valor
   de aditamento). */
function lerTermo(texto, reNumero) {
  const t = String(texto);
  const retif = t.match(RETIFICACAO);
  if (retif) {
    const alvo = { tipo: /apostil/i.test(retif[1]) ? 'apostilamento' : 'aditivo', termo: String(Number(retif[2])).padStart(3, '0') };
    const novoMensal = novoValorMensal(t);
    const v = novoMensal ? null : valoresEmReais(t.slice(retif.index)).find(x => !ehGarantia(t, x));
    if (novoMensal || v) return { natureza: 'retificação', alvo, novoMensal: novoMensal || null, valor: v ? v.valor : 0, meses: 0 };
  }
  const meses = mesesProrrogados(t, reNumero);
  if (meses > 0) {
    const p = valorDaProrrogacao(t, meses);
    return { meses, valor: p.valor, ...(p.mensal ? { mensal: p.mensal } : {}), natureza: 'prorrogação' };
  }
  const valor = valorDeAcrescimo(t, reNumero);
  if (valor) return { meses: 0, valor, natureza: valor > 0 ? 'acréscimo' : 'supressão' };
  if (/reajust/i.test(t.replace(/sem\s*reajuste/gi, ''))) {
    const novoMensal = novoValorMensal(t);
    if (novoMensal) return { natureza: 'reajuste', novoMensal, valor: 0, meses: 0 };
  }
  return null;
}

/* Ano do termo, para ordenar reajustes: do nome do arquivo
   ("apostilamento nº 027.2023") ou do próprio texto ("Apostilamento nº
   027/2023"). */
function anoDoTermo(nome, texto, termo) {
  const doNome = String(nome || '').match(/(?:aditiv|aditament|apostil)\w*\D{0,20}?\d{1,4}\s*[_.\/-]\s*(\d{4}|\d{2})(?!\d)/i);
  if (doNome) return Number(doNome[1].length === 2 ? '20' + doNome[1] : doNome[1]);
  if (termo) {
    const doTexto = String(texto || '').match(new RegExp(`(?:apostilamento|aditamento|aditivo)\\s*n\\S{0,3}\\s*0*${Number(termo)}\\s*[\\/.]\\s*(\\d{4})`, 'i'));
    if (doTexto) return Number(doTexto[1]);
  }
  return 9999;
}

/* Retificações substituem o valor do termo que corrigem; reajustes viram
   valor: (novo mensal − mensal anterior) × meses que ainda restavam do
   período INICIAL quando o reajuste passou a valer. O reajuste é anual:
   o k-ésimo vale a partir do mês 12k+1, então restam (meses iniciais −
   12k). Conferido no 086/2021: 30 meses a R$ 108.000; o apostilamento
   027/2023 reajusta para R$ 117.428,40 a partir do 13º mês — o SGC soma
   exatamente 9.428,40 × 18 = 169.711,20. Reajuste que cai depois do
   período inicial não entra: as prorrogações já trazem o valor
   reajustado. É uma estimativa (o documento não diz o mês exato), e a
   memória de cálculo diz isso. */
function aplicarRetificacoesEReajustes(aditivos, valorInicial, mesesIniciais, avisos) {
  for (const r of aditivos.filter(a => a.natureza === 'retificação')) {
    const alvo = aditivos.find(a => a !== r && a.tipo === r.alvo.tipo && a.termo === r.alvo.termo);
    if (!alvo) {
      avisos.push(`O termo ${r.termo} retifica o ${r.alvo.tipo} ${r.alvo.termo}, que não foi encontrado na pasta — retificação fora do cálculo.`);
      continue;
    }
    if (r.novoMensal) {
      alvo.novoMensal = r.novoMensal;
    } else if (r.valor) {
      alvo.valor = r.valor;
      if (alvo.natureza === 'reajuste') { alvo.natureza = 'acréscimo'; delete alvo.novoMensal; }
    }
    alvo.retificadoPor = r.termo;
  }
  const semRetificacoes = aditivos.filter(a => a.natureza !== 'retificação');

  const reajustes = semRetificacoes.filter(a => a.natureza === 'reajuste').sort((a, b) => (a.ano - b.ano) || a.termo.localeCompare(b.termo));
  let anterior = valorInicial > 0 && mesesIniciais > 0 ? valorInicial / mesesIniciais : null;
  reajustes.forEach((a, i) => {
    const restantes = (mesesIniciais || 0) - 12 * (i + 1);
    if (anterior === null || restantes <= 0) {
      a.valor = 0;
      avisos.push(`O reajuste do ${a.tipo} ${a.termo} vale depois do período inicial — não entra na conta (as prorrogações já trazem o valor reajustado).`);
    } else {
      a.valor = arredondar((a.novoMensal - anterior) * restantes);
      a.detalhe = `(${fmt(a.novoMensal)} − ${fmt(anterior)}) × ${restantes} meses restantes do período inicial (estimativa: reajuste anual)`;
    }
    anterior = a.novoMensal;
  });
  return semRetificacoes;
}

function fmt(v) {
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* Um termo (todos os arquivos com o mesmo número): o documento próprio
   primeiro; o parágrafo do extrato completa o que faltar (é comum o OCR
   do termo perder a cláusula de valor e o extrato trazê-la). */
function avaliarTermo(docs, termo, reNumero, numeroContrato, avisos) {
  let achado = null;
  let citaOutroContrato = null;
  for (const d of docs.filter(x => !x.extrato && x.texto.trim())) {
    if (reNumero && !reNumero.test(d.texto)) { citaOutroContrato = d.nome; continue; }
    const r = lerTermo(d.texto, reNumero);
    if (r) { achado = { ...r, documento: d.nome, fonte: 'termo' }; break; }
  }
  if (!achado || (achado.natureza === 'prorrogação' && !achado.valor)) {
    for (const d of docs.filter(x => x.extrato)) {
      const r = paragrafosDoExtrato(d.texto, reNumero, termo).map(p => lerTermo(p, reNumero)).find(Boolean);
      if (!r) continue;
      if (!achado) { achado = { ...r, documento: d.nome, fonte: 'extrato' }; break; }
      if (r.valor) { achado = { ...achado, valor: r.valor, documento: `${achado.documento} + ${d.nome}`, fonte: 'termo + extrato' }; break; }
    }
  }
  if (!achado && citaOutroContrato) {
    avisos.push(`"${citaOutroContrato}" não cita o contrato ${numeroContrato} — ficou fora do cálculo (arquivado na pasta errada?).`);
  }
  if (achado && achado.natureza === 'prorrogação' && !achado.valor) {
    avisos.push(`"${achado.documento}" prorroga por ${achado.meses} meses, mas o valor do novo período não foi encontrado — termo fora do cálculo; confira no documento.`);
    return null;
  }
  return achado;
}

/* Cálculo completo a partir do texto (combinado, com cabeçalhos de
   arquivo, ou de um documento só) e do número do contrato, quando
   conhecido. Devolve as peças e a memória de cálculo — quem revisa
   precisa ver de onde saiu cada parcela. */
function calcularMediaMensal(texto, numeroContrato) {
  const documentos = dividirEmDocumentos(texto).map(d => ({ ...d, ...classificarDocumento(d.nome) }));
  const reNumero = regexDoNumero(numeroContrato);
  const avisos = [];
  const semNomes = documentos.length === 1 && !documentos[0].nome;

  /* 1. Parte inicial: documento do contrato; senão, o parágrafo do
     extrato do contrato. Texto sem cabeçalhos = um documento só. */
  let valorInicial, mesesIniciais, fonteInicial = null;
  const contratos = semNomes ? documentos : documentos.filter(d => d.tipo === 'contrato' && !d.extrato);
  for (const d of contratos) {
    const v = acharValorGlobal(d.texto);
    const m = acharVigenciaMeses(d.texto);
    if (v > 0 && valorInicial === undefined) { valorInicial = v; fonteInicial = d.nome; }
    if (m > 0 && mesesIniciais === undefined) mesesIniciais = m;
  }
  if (valorInicial === undefined || mesesIniciais === undefined) {
    for (const d of documentos.filter(x => x.tipo === 'contrato' && x.extrato)) {
      const p = paragrafoDoExtrato(d.texto, reNumero);
      if (!p) continue;
      if (valorInicial === undefined) {
        const v = valoresEmReais(p)[0];
        if (v) { valorInicial = v.valor; fonteInicial = d.nome; }
      }
      if (mesesIniciais === undefined) {
        const m = p.match(/vig\S{0,2}ncia\s*:?\s*(\d{1,3})\s*\([^)]*\)\s*(m[eê]s|anos?)/i);
        if (m) mesesIniciais = emMeses(m[1], m[2]);
      }
    }
  }

  /* 2. Termos aditivos e apostilamentos, um por número de termo. */
  let aditivos = [];
  if (!semNomes) {
    const porTermo = new Map();
    documentos.filter(d => d.tipo === 'aditivo' || d.tipo === 'apostilamento').forEach(d => {
      const chave = `${d.tipo}:${numeroDoTermo(d.nome) || d.nome}`;
      if (!porTermo.has(chave)) porTermo.set(chave, []);
      porTermo.get(chave).push(d);
    });
    for (const [chave, docs] of porTermo) {
      const achado = avaliarTermo(docs, numeroDoTermo(docs[0].nome), reNumero, numeroContrato, avisos);
      const termo = numeroDoTermo(docs[0].nome);
      if (achado) aditivos.push({ tipo: chave.split(':')[0], termo, ano: anoDoTermo(docs[0].nome, docs.map(d => d.texto).join(' '), termo), ...achado });
    }
    aditivos = aplicarRetificacoesEReajustes(aditivos, valorInicial, mesesIniciais, avisos)
      .filter(a => a.valor || a.meses)
      .sort((a, b) => (a.ano - b.ano) || (a.termo || '').localeCompare(b.termo || ''));
  }

  /* 3. A fórmula. Sem a parte inicial não há média calculada: vale só um
     valor escrito como mensal no próprio contrato. */
  const resultado = { valorInicial, mesesIniciais, fonteInicial, aditivos, avisos, valorTotal: undefined, mesesTotal: undefined, mediaMensal: undefined, memoria: null };
  if (valorInicial > 0 && mesesIniciais > 0) {
    resultado.valorTotal = arredondar(valorInicial + aditivos.reduce((s, a) => s + a.valor, 0));
    resultado.mesesTotal = mesesIniciais + aditivos.reduce((s, a) => s + a.meses, 0);
    resultado.mediaMensal = arredondar(resultado.valorTotal / resultado.mesesTotal);
    const parcelasValor = [fmt(valorInicial), ...aditivos.filter(a => a.valor).map(a => (a.valor < 0 ? '- ' : '+ ') + fmt(Math.abs(a.valor)))].join(' ');
    const parcelasMeses = [mesesIniciais, ...aditivos.filter(a => a.meses).map(a => a.meses)].join(' + ');
    resultado.memoria = `(${parcelasValor}) ÷ (${parcelasMeses}) = ${fmt(resultado.mediaMensal)}`;
  } else {
    const doContrato = contratos.map(d => acharValorMensal(d.texto)).find(v => v > 0);
    if (doContrato) {
      resultado.mediaMensal = doContrato;
      resultado.memoria = `valor escrito como mensal no contrato: ${fmt(doContrato)} (sem valor global e vigência para aplicar a fórmula)`;
    }
  }
  return resultado;
}

module.exports = {
  calcularMediaMensal,
  acharValorGlobal,
  acharVigenciaMeses,
  // Peças de leitura da pasta 3, reaproveitadas pelo cálculo da vigência
  // (vigenciaContratual.js) — mesma classificação de documentos e mesmos
  // cuidados com extrato do Diário e termo arquivado na pasta errada.
  pecas: { dividirEmDocumentos, classificarDocumento, numeroDoTermo, anoDoTermo, regexDoNumero, paragrafosDoExtrato, PRORROGACAO },
  _paraTeste: { dividirEmDocumentos, classificarDocumento, numeroDoTermo, regexDoNumero, valoresEmReais, lerTermo, paragrafosDoExtrato }
};
