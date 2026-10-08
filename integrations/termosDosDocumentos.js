/* ===================================================================
   integrations/termosDosDocumentos.js

   Aditivos e apostilamentos lidos dos DOCUMENTOS da pasta de rede — a
   fonte desde que a integração com o SGC foi desligada (23/09/2026).

   Para cada termo encontrado na pasta do contrato:
     - espécie e número/ano ("Aditamento nº 156.2022" -> Aditivo 156/2022);
     - data de assinatura (o fecho "Itaverde, 14 de janeiro de 2025");
     - tipo (prorrogação, acréscimo, supressão, reajuste, alteração de
       gestor...), com o efeito no valor e no prazo quando houver — esses
       vêm do mesmo cálculo da média mensal (valorContratual.js), para a
       Base e o Mapa de risco não divergirem da conta do valor;
     - gestor e suplente, quando o termo é de gestão (camposPorRegra.js);
     - o trecho dispositivo ("Fica apostilado ... para que conste ...").

   Só entram documentos que citam o número DESTE contrato — a mesma
   cautela das outras regras: pasta às vezes guarda termo alheio, e o
   extrato do Diário traz vários contratos na mesma página. Extrato só é
   usado quando o termo não tem outro documento na pasta.

   Só leitura, sem rede e sem disco: recebe o texto já lido.
=================================================================== */

const { pecas, calcularMediaMensal } = require('./valorContratual');
const { dividirEmDocumentos, classificarDocumento, numeroDoTermo, anoDoTermo, regexDoNumero } = pecas;
const { lerData } = require('./vigenciaContratual');
const { lerAtoDeGestao } = require('./camposPorRegra');

const limpar = t => String(t || '').replace(/\s+/g, ' ').trim();

/* Data do termo: o fecho de assinatura ("Itaverde, 14 de janeiro de 2025"),
   o último que aparecer; senão "DATA DA ASSINATURA:"; senão nada — data
   solta no meio do texto costuma ser de OUTRO ato citado ("Portaria nº
   1938/2025, de 14 de janeiro de 2025"). */
function dataDoTermo(texto) {
  const t = String(texto || '');
  const fechos = [...t.matchAll(/Itaverde,?\s*(?:em\s*)?(?=(?:\d{1,2}|[oO]\d)\s*[º°o]?\s*de\s)/gi)];
  for (const f of fechos.reverse()) {
    const data = lerData(t.slice(f.index, f.index + 60));
    if (data) return data;
  }
  const declarada = t.match(/data\s*da\s*assinatura\s*:?\s*([\s\S]{0,40})/i);
  return declarada ? lerData(declarada[1]) : null;
}

const ROTULO_NATUREZA = {
  'prorrogação': 'Prorrogação', 'acréscimo': 'Acréscimo', 'supressão': 'Supressão',
  'reajuste': 'Reajuste', 'retificação': 'Retificação'
};

/* O que o termo faz. A natureza lida pelo cálculo do valor manda; o
   resto é pelo assunto escrito no próprio termo. */
function tipoDoTermo(texto, natureza, gestao) {
  if (gestao && (gestao.responsavel || gestao.suplente || gestao.fiscal)) return 'Alteração de gestor/suplente';
  if (natureza && ROTULO_NATUREZA[natureza]) return ROTULO_NATUREZA[natureza];
  const t = limpar(texto).slice(0, 2500);
  const regras = [
    [/reequil[íi]brio/i, 'Reequilíbrio econômico-financeiro'],
    [/cess[ãa]o\s+da\s+posi[çc][ãa]o/i, 'Cessão da posição contratual'],
    [/raz[ãa]o\s+social|altera[çc][ãa]o\s+subjetiva|incorpora[çc][ãa]o|cis[ãa]o/i, 'Alteração subjetiva da contratada'],
    [/rescis[ãa]o|extin[çc][ãa]o\s+(?:do|contratual)/i, 'Rescisão'],
    [/dota[çc][ãa]o\s+or[çc]ament|classifica[çc][ãa]o\s+or[çc]ament/i, 'Dotação orçamentária'],
    [/gestor|suplente|fiscal/i, 'Alteração de gestor/suplente'],
    [/reajust|repactua/i, 'Reajuste'],
    [/prorrog/i, 'Prorrogação'],
    [/acr[ée]sc/i, 'Acréscimo'],
    [/supress|suprim/i, 'Supressão'],
    [/retifica/i, 'Retificação']
  ];
  const achado = regras.find(([re]) => re.test(t));
  return achado ? achado[1] : 'Outro';
}

/* O trecho que diz o que o termo faz — a parte dispositiva. */
const ABERTURA_DISPOSITIVA = /(fica(?:m)?\s+(?:apostilad|aditad|prorrogad|acrescid|suprimid|alterad|reajustad|retificad)\w*|constitui\s+objeto\s+do\s+presente\s+(?:termo|aditamento|apostilamento|instrumento)|tem\s+por\s+objeto|pelo\s+presente\s+(?:termo|instrumento))/i;
function trechoDispositivo(texto) {
  const t = limpar(texto);
  const m = ABERTURA_DISPOSITIVA.exec(t);
  if (!m) return null;
  let trecho = t.slice(m.index, m.index + 420);
  const fim = trecho.search(/continuam\s+em\s+vigor|permanecem\s+inalterad|e\s+por\s+estarem\s+justos/i);
  if (fim > 40) trecho = trecho.slice(0, fim);
  trecho = trecho.replace(/\s*[.;,]\s*$/, '').trim();
  return trecho.length > 400 ? trecho.slice(0, 397).replace(/\s+\S*$/, '') + '...' : trecho;
}

function numeroApresentado(termo, ano) {
  if (!termo) return null;
  return ano ? `${String(termo).padStart(3, '0')}/${ano}` : String(termo).padStart(3, '0');
}

/* `opcoes.calculo`: o resultado de calcularMediaMensal (ou o mapeado que
   a proposta guarda em calculoValor) — evita refazer a conta. */
function extrairTermos(texto, numeroContrato, opcoes) {
  const documentos = dividirEmDocumentos(texto).map(d => ({ ...d, ...classificarDocumento(d.nome) }));
  if (documentos.length === 1 && !documentos[0].nome) return []; // texto solto: sem nome de arquivo não há como separar os termos
  const reNumero = numeroContrato ? regexDoNumero(numeroContrato) : null;
  const calculo = (opcoes && opcoes.calculo) || calcularMediaMensal(texto, numeroContrato);
  const doCalculo = (calculo && calculo.aditivos) || [];

  // Agrupa os arquivos de cada termo (o termo, o extrato, a cópia...).
  const grupos = new Map();
  for (const d of documentos.filter(x => x.tipo === 'aditivo' || x.tipo === 'apostilamento')) {
    if (!String(d.texto || '').trim()) continue;
    const termo = numeroDoTermo(d.nome);
    const chave = `${d.tipo}:${termo || d.nome}`;
    if (!grupos.has(chave)) grupos.set(chave, { tipo: d.tipo, termo, docs: [] });
    grupos.get(chave).docs.push(d);
  }

  const termos = [];
  for (const g of grupos.values()) {
    const citaEste = d => !reNumero || reNumero.test(d.texto);
    const proprios = g.docs.filter(d => !d.extrato && citaEste(d));
    const extratos = g.docs.filter(d => d.extrato && citaEste(d));
    const principal = proprios[0] || extratos[0];
    if (!principal) continue; // nenhum documento do grupo cita este contrato: é termo alheio

    const anoLido = anoDoTermo(principal.nome, g.docs.map(d => d.texto).join(' '), g.termo);
    const ano = anoLido && anoLido !== 9999 ? anoLido : null;
    const calc = doCalculo.find(a => a.termo && g.termo && Number(a.termo) === Number(g.termo)
      && (!a.ano || !ano || Number(a.ano) === Number(ano)) && (a.tipo || 'aditivo') === g.tipo)
      || doCalculo.find(a => a.termo && g.termo && Number(a.termo) === Number(g.termo) && (!a.ano || !ano || Number(a.ano) === Number(ano)));
    const gestao = g.tipo === 'apostilamento' || /gestor|suplente|fiscal/i.test(principal.texto.slice(0, 600))
      ? lerAtoDeGestao(principal.texto) : null;

    termos.push({
      especie: g.tipo === 'apostilamento' ? 'Apostilamento' : 'Aditivo',
      termo: g.termo,
      ano,
      numero: numeroApresentado(g.termo, ano),
      data: dataDoTermo(principal.texto),
      tipo: tipoDoTermo(principal.texto, calc && calc.natureza, gestao),
      natureza: calc ? calc.natureza || null : null,
      valor: calc && calc.valor != null ? calc.valor : null,
      meses: calc && calc.meses ? calc.meses : null,
      gestor: gestao ? gestao.responsavel || null : null,
      suplente: gestao ? gestao.suplente || null : null,
      fiscal: gestao ? gestao.fiscal || null : null,
      objeto: trechoDispositivo(principal.texto),
      documento: principal.nome,
      soExtrato: !proprios.length,
      documentos: g.docs.map(d => d.nome)
    });
  }

  termos.sort((a, b) => (a.ano || 0) - (b.ano || 0) || String(a.termo || '').localeCompare(String(b.termo || '')) || (a.especie < b.especie ? -1 : 1));
  return termos;
}

module.exports = { extrairTermos, _paraTeste: { dataDoTermo, tipoDoTermo, trechoDispositivo, numeroApresentado } };
