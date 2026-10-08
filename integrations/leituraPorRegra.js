/* ===================================================================
   integrations/leituraPorRegra.js

   Leitura dos campos de um contrato POR REGRA — sem IA (01/10/2026, quando
   a IA foi retirada do projeto; o código veio de iaProvider.js, onde
   ficava junto com a IA). Número, CNPJ e razão social da contratada,
   processo administrativo, secretaria, modalidade, média mensal pela
   regra do SGC, vigência (marco + meses), objeto, gestor, suplente,
   tipo de serviço e preposto (camposPorRegra.js).

   Uma regra só preenche quando o padrão inteiro está no texto: melhor em
   branco (vai para "Pendências de leitura") do que errado. Sai igual toda
   vez, mostra de onde veio e leva milissegundos.

   Por que a IA saiu: desligada desde 24/09/2026 (o modelo local travava a
   máquina) e, medida nos documentos reais, não acertava nada que a regra
   não acerte — tipo de serviço 0 de 23, preposto 0 de 5, e 4 de 11
   gestores errados. Retirada de vez em 01/10/2026; a versão com IA está
   no git, na etiqueta "com-ia".
=================================================================== */

/* Os campos do cadastro de contratos que a leitura procura (os mesmos do
   REGISTRY em public/js/app.js). */
const CAMPOS_CONTRATO = [
  'numero', 'empresa', 'cnpjEmpresa', 'tipo', 'objeto', 'inicio', 'termino',
  'valor', 'secretaria', 'responsavel', 'suplente', 'pa', 'preposto', 'tipoContratacao'
];

/* Todo contrato da Prefeitura cita DOIS CNPJs: o do próprio Município
   (contratante, sempre primeiro no preâmbulo) e o da empresa
   (contratada). Pegar simplesmente o primeiro do texto — o que esta
   função substitui — trazia SEMPRE o CNPJ da Prefeitura no campo
   "cnpjEmpresa", um erro silencioso e consistente. A janela curta (150
   caracteres antes da ocorrência) é de propósito: o suficiente pra ver
   quem está sendo qualificado ali, curta o bastante pra não pegar o
   cabeçalho do contrato, que cita os dois lados numa frase só. */
/* O CNPJ do Município nunca é o da contratada — venha de onde vier no
   texto. A janela de contexto abaixo falhava quando o OCR ou a quebra de
   página separava "MUNICÍPIO DE ITAVERDE" do número: 002/2024 e 061/2025
   ficaram com 11.256.774/0001-02 em "CNPJ da empresa" (25/09/2026). */
const CNPJ_PREFEITURA = '11256774000102';
function acharCnpjDaContratada(texto) {
  const ocorrencias = [...String(texto).matchAll(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-?\d{2})/g)];
  if (!ocorrencias.length) return undefined;
  const ehDoContratante = m => {
    if (m[1].replace(/\D/g, '') === CNPJ_PREFEITURA) return true;
    const antes = String(texto).slice(Math.max(0, m.index - 150), m.index).toLowerCase();
    return /munic[ií]pio|prefeitura|contratante/.test(antes) && !/empresa|contratada/.test(antes);
  };
  const daContratada = ocorrencias.find(m => !ehDoContratante(m));
  // Se TODAS as ocorrências parecem ser do contratante, não chuta: é
  // melhor deixar em branco pra alguém preencher do que gravar o CNPJ da
  // própria Prefeitura como se fosse o da empresa.
  return daContratada ? daContratada[1] : undefined;
}

/* Nome da empresa contratada. A regex antiga (`contratad[ao]\s*:?\s*...`)
   casava com qualquer frase que começasse com "CONTRATADA" — inclusive
   cláusulas de obrigação ("a CONTRATADA seja única e exclusiva
   responsável pela execução..."), que foi o que ela devolveu no primeiro
   contrato real testado. Esta versão exige uma marca de razão social
   (LTDA, S/A, EIRELI, ME, EPP) para aceitar o trecho como nome de
   empresa — se não achar nenhuma, prefere não preencher a preencher
   errado. */
/* Nome próprio de empresa, não pedaço de cláusula: no preâmbulo do modelo
   da Procuradoria a razão social vem em MAIÚSCULAS, e cláusula vem em
   caixa normal. Medido na avaliação contra o SGC (21/09/2026): a regra
   antiga devolveu "fará jus à aplicação de compensação..." e "terá direito
   à aplicação de compensação..." como nome de empresa em 3 dos 24
   contratos — ela aceitava "SA"/"ME" minúsculos no meio de uma frase como
   se fossem a forma societária. */
function pareceRazaoSocial(nome) {
  const letras = nome.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (letras.length < 3 || nome.length > 120) return false;
  const maiusculas = nome.replace(/[^A-ZÀ-Ý]/g, '').length;
  if (maiusculas / letras.length < 0.7) return false;
  return !/\b(SEJA|DEVER[AÁ]|FAR[AÁ]|TER[AÁ]|FICA|OBRIGA|RESPONS[AÁ]VEL|QUE|COM DOLO)\b/.test(nome.toUpperCase());
}

/* Busca no texto do documento PRINCIPAL antes do resto. A pasta de um
   contrato costuma ter extratos do Diário Oficial, e uma página do Diário
   traz o preâmbulo de VÁRIOS contratos — medido na avaliação: sem esta
   prioridade, o 048/2025 (LUMEN Software) saiu com a razão social de um
   contrato da Saúde publicado na mesma página. O principal é o primeiro
   bloco "=== Arquivo: ===" (os orquestradores o põem primeiro). */
function blocosPorPrioridade(texto) {
  const t = String(texto);
  const segundo = t.indexOf('=== Arquivo:', t.indexOf('=== Arquivo:') + 1);
  return segundo > 0 ? [t.slice(0, segundo), t.slice(segundo)] : [t];
}

function acharNomeDaContratada(texto) {
  for (const t of blocosPorPrioridade(texto)) {
    /* 1. O formato do preâmbulo da Procuradoria: "...e de outro lado a
       empresa AURORA TECNOLOGIA LTDA, inscrita no CNPJ...".
       A âncora é "inscrita no CNPJ" — logo antes vem a razão social,
       possivelmente quebrada em linhas pelo OCR, e às vezes seguida de
       ", pessoa jurídica de direito privado" (cortado). O Município também
       é "inscrito no CNPJ" — esse é pulado. */
    for (const ancora of t.matchAll(/,?\s*inscrit[ao]\s+no\s+C\.?\s*N\.?\s*P\.?\s*J/gi)) {
      const antes = t.slice(Math.max(0, ancora.index - 260), ancora.index);
      const m = antes.match(/(?:empresa|contratad[ao])\s*:?\s*([\s\S]+)$/i);
      if (!m) continue;
      const nome = m[1]
        .split(/,\s*(?:pessoa\s+jur|com\s+sede|sediad|estabelecid|situad|neste\s+ato|doravante)/i)[0]
        .replace(/\s+/g, ' ').replace(/[,;.\s]+$/, '').trim();
      if (/munic[íi]pio|prefeitura/i.test(nome)) continue;
      if (pareceRazaoSocial(nome)) return nome;
    }

    /* 2. Fora do preâmbulo (extrato do Diário Oficial, por exemplo):
       "Contratada: ACME COMÉRCIO LTDA". A palavra-chave aceita qualquer
       caixa ("EMPRESA", "empresa" — a versão anterior só aceitava
       minúscula e perdeu o 045/2023), mas o NOME precisa estar em
       maiúsculas e a forma societária ser palavra inteira. */
    for (const k of t.matchAll(/(?:empresa|contratad[ao])\s*:?\s*/gi)) {
      const depois = t.slice(k.index + k[0].length, k.index + k[0].length + 160);
      const m = depois.match(/^([A-ZÀ-Ý0-9][A-ZÀ-Ý0-9 .,&'\/\n-]{2,120}?\b(?:LTDA|EIRELI|S\/A|S\.A\.|SA|ME|EPP))\b/);
      if (!m) continue;
      const nome = m[1].replace(/\s+/g, ' ').trim();
      if (pareceRazaoSocial(nome) && !/munic[íi]pio|prefeitura/i.test(nome)) return nome;
    }
  }
  return undefined;
}

/* Número do contrato, no formato do SGC ("096/2025": três dígitos com
   zero à esquerda, ano com quatro). O zero importa: a aprovação casa a
   proposta com um contrato existente por comparação EXATA do número, e
   "96/2025" não casaria com "096/2025" — viraria duplicata.

   Medido na avaliação contra o SGC: a regra antiga aceitava ano de dois
   dígitos e "." como separador, e num contrato em que o OCR estragou o
   cabeçalho ("CONTRATO N° OOQ/202") ela devolveu "2.17" — um número de
   item de cláusula. Agora exige ano de quatro dígitos plausível e, se o
   texto não trouxer um número válido, usa o NOME DO ARQUIVO do
   documento principal ("Contrato 009_2023 - Vox Telecom.pdf"), que nesta
   estrutura de pastas é uma fonte confiável. Sem nenhum dos dois: vazio
   — melhor que errado. */
function formatarNumeroContrato(numero, ano) {
  const a = Number(ano);
  if (!(a >= 1990 && a <= new Date().getFullYear() + 1)) return undefined;
  return `${String(Number(numero)).padStart(3, '0')}/${a}`;
}

function acharNumeroDoContrato(texto) {
  const t = String(texto);
  for (const m of t.matchAll(/contrato\s+(?:administrativo\s+|comercial\s+)?n[º°o.]?\s*\.?\s*(\d{1,4})\s*[/._-]\s*(\d{4})(?!\d)/gi)) {
    const n = formatarNumeroContrato(m[1], m[2]);
    if (n) return n;
  }
  // Nome do arquivo, pelo cabeçalho "=== Arquivo: ... ===" que os
  // orquestradores põem antes do texto de cada documento.
  for (const m of t.matchAll(/=== Arquivo: [^\n]*?contrato[^\n]*?(\d{1,4})\s*[._]\s*(\d{4})[^\n]*===/gi)) {
    if (/extrato|aditivo|aditamento|apostil/i.test(m[0])) continue;
    const n = formatarNumeroContrato(m[1], m[2]);
    if (n) return n;
  }
  return undefined;
}

/* Processo administrativo ("01.275/2025"), com ano plausível. A regra
   antiga pegava a primeira ocorrência e, num contrato, devolveu
   "26.533/2101" — ano impossível. */
function acharProcessoAdministrativo(texto) {
  for (const m of String(texto).matchAll(/processo\s+administrativo\s*n?[º°o.]?\s*\.?\s*(\d{1,2})\.?(\d{3})\s*\/\s*(\d{4})/gi)) {
    const ano = Number(m[3]);
    if (ano >= 1990 && ano <= new Date().getFullYear() + 1) return `${m[1].padStart(2, '0')}.${m[2]}/${ano}`;
  }
  return undefined;
}

/* Secretaria gestora: a primeira da LISTA (em db.js, na ordem de
   prioridade) que aparecer em qualquer documento da pasta — agora com
   quebra de linha, acento e caixa tolerados.

   Medido na avaliação contra o SGC, e vale o registro das duas tentativas:
     - a regra original exigia o nome inteiro numa linha só; o OCR quebra
       "Secretaria de / Tecnologia..." e ela caía na próxima da lista que
       aparecesse (Saúde, Administração, citadas em outras cláusulas);
     - "a que aparece primeiro no texto" foi PIOR (17 de 24): contratos
       antigos citam a Secretaria de Finanças logo no começo, e a gestora
       atual (a SETEC, primeira da lista) só aparece nos aditivos mais
       recentes da mesma pasta.
   A ordem da lista é a regra certa aqui porque reflete quem gere os
   contratos hoje — que é o que o cadastro precisa. */
function acharSecretaria(texto, nomes) {
  // Sem acento, caixa, pontuação e quebra de linha: o OCR às vezes come a
  // pontuação do nome da secretaria e o nome deixava de casar.
  const normal = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const alvo = normal(texto);
  return (nomes || []).find(nome => alvo.includes(normal(nome)));
}

/* O campo `valor` do cadastro é a MÉDIA MENSAL do contrato, calculada
   pela regra do SGC — (valor inicial + aditivos de valor) ÷ (vigência
   inicial + aditivos de prazo) — a partir dos documentos da pasta 3.
   A regra e as salvaguardas (extrato do Diário Oficial, termo arquivado
   na pasta errada, OCR) estão em valorContratual.js. Até 21/09/2026 só
   entrava o contrato original, sem os aditivos. */
const valorContratual = require('./valorContratual');
const vigenciaContratual = require('./vigenciaContratual');
const camposPorRegra = require('./camposPorRegra');

function acharMediaMensal(texto, numeroContrato) {
  return valorContratual.calcularMediaMensal(texto, numeroContrato).mediaMensal;
}

/* Modalidade de contratação, como aparece no preâmbulo ou no extrato.
   Lista fechada de propósito — é um campo de domínio conhecido (Lei
   14.133/2021), então reconhecer o termo é mais confiável do que deixar
   um modelo pequeno redigir um rótulo livre. */
const MODALIDADES_CONTRATACAO = [
  ['pregão eletrônico', 'Pregão Eletrônico'],
  ['pregão presencial', 'Pregão Presencial'],
  ['concorrência', 'Concorrência'],
  ['tomada de preços', 'Tomada de Preços'],
  ['dispensa de licitação', 'Dispensa de Licitação'],
  ['inexigibilidade', 'Inexigibilidade'],
  ['adesão a ata', 'Adesão a Ata de Registro de Preços'],
  ['ata de registro de preços', 'Ata de Registro de Preços']
];

function acharTipoContratacao(texto) {
  const alvo = String(texto).toLowerCase();
  const achado = MODALIDADES_CONTRATACAO.find(([termo]) => alvo.includes(termo));
  return achado ? achado[1] : undefined;
}

/* ---------------------------------------------------------------------
   Verificação "isto está escrito no documento?"
   ---------------------------------------------------------------------
   Usadas pela Ferramenta 1 (fila de importação) e pela Ferramenta 3
   (ficha de cadastro) para apontar data ou valor que não está escrito.
   Ficam aqui, num lugar só, porque a primeira versão estava duplicada
   nos dois orquestradores e as cópias divergiram: a da ficha passou a
   conferir data por data, a da fila continuou só perguntando "o
   documento tem alguma data?" — e uma única data solta (carimbo,
   publicação, ruído do OCR) silenciava o aviso de todas as outras.
--------------------------------------------------------------------- */

/* Uma data AAAA-MM-DD aparece no texto, em qualquer grafia comum de
   contrato? Numérica (05/12/2025, 5/12/2025, 05.12.2025) ou por extenso
   ("5 de dezembro de 2025", "1º de março de 2026"). Formato inesperado
   devolve `true` (não dá pra afirmar que foi inferida — melhor não
   acusar).

   A versão anterior só reconhecia a forma numérica — e contrato da
   Prefeitura escreve data por extenso ("Itaverde, 5 de dezembro de 2025").
   Medido na avaliação contra o SGC (21/09/2026): o início da vigência
   aparece escrito em 11 dos 24 contratos, e a versão antiga só
   enxergava 1 — e marcava como inferida uma data que estava, sim, no
   documento. */
const MESES_POR_EXTENSO = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function dataApareceNoTexto(iso, texto) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return true;
  const [, ano, mes, dia] = m;
  const bruto = String(texto || '');
  if (bruto.includes(iso)) return true;
  const d = String(Number(dia)), mm = String(Number(mes));
  // Numérica, com / . ou -, dia e mês com ou sem zero à esquerda.
  const numerica = new RegExp(`(?<!\\d)0?${d}\\s*[/.-]\\s*0?${mm}\\s*[/.-]\\s*${ano}(?!\\d)`);
  if (numerica.test(bruto)) return true;
  // Por extenso, sem acento e sem diferença de caixa ("março" = "marco").
  const normal = bruto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ');
  const mesExtenso = MESES_POR_EXTENSO[Number(mes) - 1];
  const diaExtenso = d === '1' ? '(?:0?1|1o|1º|primeiro)' : `0?${d}`;
  return new RegExp(`(?<!\\d)${diaExtenso}\\s+de\\s+${mesExtenso}\\s+de\\s+${ano}`).test(normal);
}

/* Um valor em reais aparece escrito no texto (com separador de milhar
   brasileiro)? Exige que não haja dígito, ponto ou vírgula logo antes:
   "100.000,00" é substring de "26.100.000,00", e um `includes` simples
   daria como encontrado justamente o caso que isto existe pra pegar. */
function valorApareceNoTexto(valor, texto) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return true;
  const comoTexto = n.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  const escapado = comoTexto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(?<![\\d.,])' + escapado).test(String(texto || ''));
}

/* ---------------------------------------------------------------------
   Os campos de um contrato, lidos do texto (de todos os documentos da
   pasta, o principal primeiro). Campo não achado: null. "confiancas" fica
   pelo formato que a Fila de importação já guarda (0,3 = lido por regra).
--------------------------------------------------------------------- */
function lerCampos(texto) {
  const campos = {};
  const confiancas = {};
  const marcar = (campo, valor) => {
    if (valor !== undefined && valor !== null && valor !== '') {
      campos[campo] = valor;
      confiancas[campo] = 0.3;
    } else {
      campos[campo] = null;
      confiancas[campo] = 0;
    }
  };

  const numero = acharNumeroDoContrato(texto);
  marcar('numero', numero);

  marcar('cnpjEmpresa', acharCnpjDaContratada(texto));
  marcar('empresa', acharNomeDaContratada(texto));

  // Média mensal pela regra do SGC, com os aditivos da pasta — ver valorContratual.js.
  marcar('valor', acharMediaMensal(texto, numero));

  // Início = data de assinatura; término = marco (assinatura ou Ordem de
  // Início) + meses + prorrogações, pela regra do Código Civil — só quando
  // o marco é conhecido. Ver vigenciaContratual.js. (Até 22/09/2026 só se
  // lia um "dd/mm/aaaa a dd/mm/aaaa" escrito, que quase nunca existe.)
  const vigencia = vigenciaContratual.calcularVigencia(texto, numero);
  marcar('inicio', vigencia.inicio || undefined);
  marcar('termino', vigencia.termino || undefined);

  /* Campos que aparecem em formato padronizado em contrato e extrato da
     Prefeitura — regex acerta sempre onde o modelo pequeno erra às
     vezes. Ver nota em extrairComHeuristicaLocal sobre por que vale a
     pena o determinístico aqui. */
  marcar('pa', acharProcessoAdministrativo(texto));

  marcar('tipoContratacao', acharTipoContratacao(texto));

  let secretariaAchada;
  try {
    const { SECRETARIAS_NOMES } = require('../db');
    secretariaAchada = acharSecretaria(texto, SECRETARIAS_NOMES);
  } catch (e) { /* db.js pode não estar disponível fora do server — ok, só não acha */ }
  marcar('secretaria', secretariaAchada);

  /* Objeto, tipo de serviço, gestor e suplente: até 23/09/2026 ficavam
     sempre nulos aqui ("regex não entende texto").
     Hoje saem de regra — ver integrations/camposPorRegra.js, com o
     porquê e as chaves para desligar. Preposto também, desde 24/09/2026:
     do ofício de indicação da empresa (ver acharPreposto).
     Se as regras estiverem desligadas no .env, `campos` vem vazio e o
     comportamento é o de antes, campo a campo. */
  let origemRegra = null;
  let gestaoHistorico = null;
  try {
    let tiposValidos = null;
    try { tiposValidos = require('../db').TIPOS_SERVICO; } catch (e) { /* fora do server: usa a lista padrão do módulo */ }
    const daRegra = camposPorRegra.aplicar(texto, { tiposValidos, numeroContrato: numero });
    ['objeto', 'tipo', 'responsavel', 'suplente', 'preposto'].forEach(campo => marcar(campo, daRegra.campos[campo]));
    if (Object.keys(daRegra.origem).length) origemRegra = daRegra.origem;
    if (daRegra.gestaoHistorico) gestaoHistorico = daRegra.gestaoHistorico;
    if (daRegra.avisos.length) origemRegra = { ...(origemRegra || {}), _avisos: daRegra.avisos };
  } catch (e) {
    // Regra nova nunca pode derrubar a leitura: na dúvida, campo nulo.
    ['tipo', 'objeto', 'responsavel', 'suplente', 'preposto'].forEach(campo => marcar(campo, undefined));
  }

  return { campos, confiancas, modeloUsado: 'regras', ...(origemRegra ? { origemRegra } : {}), ...(gestaoHistorico ? { gestaoHistorico } : {}) };
}

/* Campos da Ficha de Cadastro do SGC (formulário "Cadastrar Contrato").
   Portaria, Iom e fiscais são atos separados, que quase nunca estão no
   texto do contrato: ficam em branco para preencher à mão. */
const CAMPOS_FICHA_CONTRATO = [
  'numero', 'processoAdministrativo', 'dataAssinatura', 'objeto', 'tipoContratacao',
  'tipoServico', 'secretaria', 'status', 'empresa', 'cnpjEmpresa', 'preposto',
  'dataInicioVigencia', 'dataTerminoVigencia', 'vigenciaEmMeses', 'dataInicioOrdemServico',
  'valorContrato', 'valorGarantia', 'tipoGarantia', 'valorMediaMensal',
  'portaria', 'iom'
];
const CAMPOS_PESSOA_FICHA = ['nome', 'cargo', 'dataDesignacao', 'dataTermino', 'status'];

/* Base da ficha de cadastro: os campos que a leitura acima já acha (o
   resto é completado em fichaCadastroContrato.js). */
function fichaPorRegra(texto) {
  const base = lerCampos(texto);
  const campos = {};
  CAMPOS_FICHA_CONTRATO.forEach(c => { campos[c] = null; });
  campos.numero = base.campos.numero ?? null;
  campos.cnpjEmpresa = base.campos.cnpjEmpresa ?? null;
  campos.empresa = base.campos.empresa ?? null;
  campos.valorContrato = base.campos.valor ?? null;
  campos.dataInicioVigencia = base.campos.inicio ?? null;
  campos.dataTerminoVigencia = base.campos.termino ?? null;
  campos.secretaria = base.campos.secretaria ?? null;
  const pessoaVazia = () => { const p = {}; CAMPOS_PESSOA_FICHA.forEach(c => { p[c] = null; }); return p; };
  return {
    campos, gestor: pessoaVazia(), suplente: pessoaVazia(), fiscais: [],
    modeloUsado: 'regras'
  };
}

module.exports = {
  CAMPOS_CONTRATO, CAMPOS_FICHA_CONTRATO, CAMPOS_PESSOA_FICHA,
  lerCampos, fichaPorRegra,
  // "Isto está escrito no documento?" — ver nota junto das funções.
  dataApareceNoTexto,
  valorApareceNoTexto,
  // Vigência (marco + meses) e média mensal com a memória de cálculo.
  calcularVigencia: (texto, numeroContrato, opcoes) => vigenciaContratual.calcularVigencia(texto, numeroContrato || acharNumeroDoContrato(texto), opcoes),
  calcularMediaMensal: (texto, numeroContrato) => valorContratual.calcularMediaMensal(texto, numeroContrato || acharNumeroDoContrato(texto)),
  extrairValorEVigencia: texto => {
    const r = valorContratual.calcularMediaMensal(texto, acharNumeroDoContrato(texto));
    return { valorGlobal: r.valorInicial, vigenciaMeses: r.mesesIniciais, mediaMensal: r.mediaMensal, calculo: r };
  }
};
