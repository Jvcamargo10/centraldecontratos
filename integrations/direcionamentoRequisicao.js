/* ===================================================================
   integrations/direcionamentoRequisicao.js

   "Onde está a resposta" de uma requisição do TCE-SP (29/09/2026).
   A Central NÃO responde a requisição — lê o documento de pergunta, separa
   os itens que o Tribunal pede ("1) Encaminhar as notas de empenho...",
   "2) Fornecer cópia dos controles de ocorrências...") e, para cada um,
   aponta a pasta do processo onde costuma estar o documento da resposta,
   com os arquivos que ela tem hoje.

   A ligação assunto → pasta usa a estrutura padrão dos processos da
   gestão de contratos (medida em 29/09/2026 nos 65 processos da raiz "9.
   Gestão de Contratos": Empenhos, Liquidações, Pagamentos, "NF, BRM_BRS e
   comprovantes", Atestados técnicos, Relatórios mensais de atividades,
   TRP e TRD, Cronogramas, Sisfin/Empenho...). O NOME da pasta é o que
   conta (o número na frente muda de um processo para outro).

   Item que pede "Informar..." ou "declaração" pede manifestação do gestor:
   a Central diz isso, e ainda aponta as pastas que ajudam a responder.
=================================================================== */
const fs = require('fs');
const path = require('path');

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/* Cada assunto: o que no texto do item indica o assunto, em que pasta a
   resposta costuma estar e, quando a pasta é genérica, que nome de
   arquivo procurar. */
const ASSUNTOS = [
  { chave: 'empenho', rotulo: 'Notas de empenho', termo: /empenho/, pasta: [/^empenhos?$/, /sisfin.*\bempenho/, /notas? de empenho/] , arquivo: /empenho|\bne[\s_-]?\d/ },
  { chave: 'liquidacao', rotulo: 'Notas de liquidação', termo: /liquida/, pasta: [/liquida/] },
  { chave: 'nota_fiscal', rotulo: 'Notas fiscais e BRM/BRS', termo: /notas? fisca|\bnfs?-?e?\b|\bbrm|\bbrs\b|faturas?\b/, pasta: [/\bnf\b|notas? fisca|brm|brs/] },
  { chave: 'pagamento', rotulo: 'Comprovantes de pagamento', termo: /pagamento|ordem bancaria|transferencia bancaria|valores pagos/, pasta: [/pagamento/, /\bnf\b.*comprovante|comprovantes/] },
  { chave: 'medicao', rotulo: 'Medições e atestados de execução', termo: /medic|atestad|servicos executados|relatorios? de execucao|ateste/, pasta: [/atestado/, /medic/, /relatorios? mensa/] },
  { chave: 'relatorio_mensal', rotulo: 'Relatórios mensais de atividades', termo: /relatorios? mensa|relatorios? de atividade/, pasta: [/relatorios? mensa|relatorio de atividade/] },
  { chave: 'ocorrencias', rotulo: 'Controle de ocorrências e fiscalização', termo: /ocorrenc|livro de registro|relatorios? de fiscaliza|acompanhamento da execu/, pasta: [/relatorios? mensa/, /papel de informa/, /outros documentos/], arquivo: /ocorr|fiscaliza|notifica/ },
  { chave: 'fotos', rotulo: 'Fotos e identificação de equipamentos', termo: /\bfotos?\b|fotograf|imagens?\b|etiquetas?|numero de serie|patrimonio|marcas?\s*\/\s*fabricante|fabricantes? dos equipamentos/, pasta: [/relatorios? mensa/, /atestado/, /entregas? previst/, /plano de implanta/, /outros documentos/], arquivo: /foto|imagem|relatorio fotog|\.(jpe?g|png)$/ },
  { chave: 'painel', rotulo: 'Painel / sistema de monitoramento', termo: /painel|monitoramento|dashboard/, pasta: [/relatorios? mensa/, /plano de implanta/, /entregas? previst/], arquivo: /painel|monitora|dashboard/ },
  { chave: 'treinamento', rotulo: 'Treinamento', termo: /treinamento|capacitac/, pasta: [/treinamento/, /plano de implanta/, /relatorios? mensa/], arquivo: /treinamento|capacita|lista de presen/ },
  { chave: 'cronograma', rotulo: 'Cronograma de execução', termo: /cronograma|percentual executado|etapas?\b/, pasta: [/cronograma de execu/, /cronograma/, /plano de implanta/] },
  { chave: 'recebimento', rotulo: 'Termos de recebimento provisório e definitivo', termo: /recebimento provis|recebimento definit|termos? de recebimento|\btrp\b|\btrd\b/, pasta: [/\btrp\b|\btrd\b|recebimento/] },
  { chave: 'garantia', rotulo: 'Garantia contratual', termo: /garantia (contratual|complementar)|termo de garantia|apolice|seguro[- ]garantia|caucao|fianca bancaria/, pasta: [/contratos?,? aditivos|contrato e aditivos/, /outros documentos/], arquivo: /apolice|garantia|seguro|cauca|fianca|endosso/ },
  { chave: 'sancao', rotulo: 'Sanções e multas', termo: /sanc|multa|penalidade|advertencia|notificac|penalizac/, pasta: [/papel de informa/, /outros documentos/], arquivo: /multa|sanca|penalid|notifica|advert/ },
  { chave: 'gestao', rotulo: 'Gestor e fiscal do contrato (designação)', termo: /\bgestor|fiscal do contrato|fiscais do contrato|designac|portaria|responsavel pelo acompanhamento/, pasta: [/contratos?,? aditivos|contrato e aditivos/, /papel de informa/], arquivo: /portaria|designa|gestor|fiscal|apostil/ },
  { chave: 'aditivos', rotulo: 'Aditivos, apostilamentos e prorrogações', termo: /aditiv|aditamento|prorroga|apostil|reajuste|repactua|acrescimo|supress/, pasta: [/contratos?,? aditivos|contrato e aditivos|contratos e termos|aditivos/] },
  { chave: 'contrato', rotulo: 'Contrato', termo: /copia do contrato|contrato assinado|instrumento contratual|contrato original/, pasta: [/contratos?,? aditivos|contrato e aditivos|contratos e termos/] },
  { chave: 'licitacao', rotulo: 'Edital, termo de referência e licitação', termo: /edital|termo de referencia|licita|pregao|propostas?\b|ata de registro|habilita|parecer juridico|homologa|adjudica|pesquisa de preco|cotac/, pasta: [/edital|termo de refer/, /propostas?/, /cotac/, /pa digitaliz|processo administrativo digit|p\.a\. digit/] },
  { chave: 'ordem_inicio', rotulo: 'Ordem de início', termo: /ordem de (inicio|servico|fornecimento)/, pasta: [/ordem de inicio/] },
  { chave: 'encerramento', rotulo: 'Encerramento / rescisão', termo: /encerramento|rescis|extincao do contrato/, pasta: [/termo de encerramento/] },
  { chave: 'ciencia', rotulo: 'Termo de ciência e notificação', termo: /ciencia e notifica|termo de ciencia/, pasta: [/termo de ciencia/, /sisfin.*ciencia/] },
  { chave: 'processo', rotulo: 'Cópia do processo administrativo', termo: /copia (integral|do processo)|processo administrativo (na integra|completo)|integra do processo/, pasta: [/pa digitaliz|processo administrativo digit|p\.a\. digit/] },
  { chave: 'regularidade', rotulo: 'Regularidade fiscal e trabalhista', termo: /regularidade|certid|\bcnd\b|fgts|inss|debitos trabalhistas/, pasta: [/documentos regular/, /propostas? comerc/], arquivo: /certid|regularidade|\bcnd|fgts|cndt/ },
  { chave: 'publicacao', rotulo: 'Publicações (extratos, IOM)', termo: /publicac|extrato|imprensa oficial|\biom\b|diario oficial/, pasta: [/contratos?,? aditivos|contrato e aditivos/, /outros documentos/], arquivo: /extrato|publica|iom|diario/ },
  { chave: 'desembolso', rotulo: 'Cronograma de desembolso e acompanhamento financeiro', termo: /desembolso|acompanhamento financeiro|planilha financeira|saldo contratual/, pasta: [/cronograma de desembols/, /pagamento/, /liquida/] },
  { chave: 'implantacao', rotulo: 'Plano de implantação e entregas', termo: /plano de implanta|entregas?\b|instalac|implantac|modulos? de/, pasta: [/plano de implanta/, /entregas? previst/, /atestado/] },
  { chave: 'sigilo', rotulo: 'Termo de sigilo e confidencialidade', termo: /sigilo|confidencialidade/, pasta: [/sigilo/] },
  { chave: 'comunicacao', rotulo: 'Plano de comunicação', termo: /plano de comunica/, pasta: [/plano de comunica/] },
  { chave: 'requisicao_sisfin', rotulo: 'Requisição, reserva e dotação (SisFin)', termo: /reserva|dotacao|requisicao de (compra|servico)|autorizacao de fornecimento|\baf\b/, pasta: [/sisfin.*requisi/, /sisfin.*autoriza/, /sisfin/] }
];
const RE_MANIFESTACAO = /^\s*(informar|esclarecer|justificar|apresentar justificativa|declarar|manifestar)|declaracao|em caso (positivo|negativo)/;

/* Os itens pedidos: "1) ...", "2) ...", "a) ...", "1. ..." — até o fim da lista
   (prazo, forma de entrega, observações, contato). */
function lerItensPedidos(texto) {
  let t = String(texto || '').replace(/\[p[áa]gina \d+\]/g, '\n');
  // Rodapé repetido de página ("Finanças" solto numa linha) não é texto do item.
  const linhas = t.split('\n');
  const frequentes = new Map();
  linhas.map(l => l.trim()).filter(l => l && l.length < 25).forEach(l => frequentes.set(l, (frequentes.get(l) || 0) + 1));
  t = linhas.filter(l => !(frequentes.get(l.trim()) >= 3 && l.trim().length < 25)).join('\n');
  // A lista começa depois de "REQUISITAMOS ..." / "seguintes informações" quando existe.
  const inicio = t.search(/requisitamos|seguintes (informac|documento)|solicitamos|solicita-se|questionamentos?\s*:/i);
  if (inicio > 0) t = t.slice(inicio);
  const fim = t.search(/\n\s*(D[úu]vidas quanto|PRAZO DE ENTREGA|FORMA DE ENTREGA|OBSERVA[ÇC][ÕO]ES\s*:|Atenciosamente|Contato\s*:)/i);
  if (fim > 0) t = t.slice(0, fim);
  const itens = [];
  const re = /(?:^|\n)\s*(\d{1,2}|[a-z])\s*[)\].–-]\s+(?=[A-ZÀ-Ýa-zà-ý])/g;
  const marcas = [...t.matchAll(re)];
  for (let i = 0; i < marcas.length; i++) {
    const ini = marcas[i].index + marcas[i][0].length;
    const fimItem = i + 1 < marcas.length ? marcas[i + 1].index : t.length;
    const textoItem = t.slice(ini, fimItem).replace(/\s+/g, ' ').trim();
    if (textoItem.length < 8) continue;
    itens.push({ numero: marcas[i][1], texto: textoItem.slice(0, 600) });
  }
  // Numeração que não segue (1, 2, 3...) quase sempre é lista de outra coisa (cláusula citada).
  return itens;
}

/* Mapa das pastas do processo: cada pasta com os arquivos que tem hoje. */
function mapearProcesso(caminhoProcesso) {
  const pastas = [];
  const visitar = (pasta, rel, prof) => {
    let ents;
    try { ents = fs.readdirSync(pasta, { withFileTypes: true }); } catch (e) { return; }
    const arquivos = ents.filter(e => e.isFile() && !/^(thumbs\.db|desktop\.ini|~\$.*)$/i.test(e.name)).map(e => e.name.normalize('NFC'));
    const subs = ents.filter(e => e.isDirectory());
    if (rel) pastas.push({ rel, nome: path.basename(rel), arquivos, subpastas: subs.map(s => s.name.normalize('NFC')), caminho: pasta });
    if (prof < 3) subs.forEach(s => visitar(path.join(pasta, s.name), rel ? `${rel}/${s.name.normalize('NFC')}` : s.name.normalize('NFC'), prof + 1));
  };
  visitar(caminhoProcesso, '', 0);
  return pastas;
}
const totalDeArquivos = (pastas, p) => pastas.filter(x => x.rel === p.rel || x.rel.startsWith(p.rel + '/')).reduce((s, x) => s + x.arquivos.length, 0);
const nomeSemNumero = n => norm(n).replace(/^\d+\s*[.\-_)]?\s*/, '');

const RE_GENERICA = /outros documentos|papel de informa/;
// "conforme item 11 do termo de referência": citação, não pedido do edital/TR.
const semCitacoes = t => t.replace(/\(?\s*(?:conforme|nos termos d[oa]s?|previst[oa]s? n[oa]s?|de acordo com|segundo)?\s*(?:o\s+)?(?:subitem|item|clausula)\s+[\d.]+\s*(?:,\s*[\d.]+\s*)*(?:d[oa]\s+)?(?:termo de referencia|edital|contrato)\s*\)?/g, ' ');

function direcionarItem(item, pastas) {
  const t = semCitacoes(norm(item.texto));
  const assuntos = ASSUNTOS.filter(a => a.termo.test(t));
  const manifestacao = RE_MANIFESTACAO.test(t);
  const achadas = new Map();
  const arquivos = [];
  for (const a of assuntos) {
    // Pasta: a de nível mais alto cujo nome bate (as de dentro dela entram como subpastas).
    for (const re of a.pasta) {
      for (const p of pastas) {
        const caminhoNorm = p.rel.split('/').map(nomeSemNumero).join('/');
        if (!re.test(re.source.includes('sisfin') ? caminhoNorm : nomeSemNumero(p.nome))) continue;
        if (!achadas.has(p.rel)) achadas.set(p.rel, { rel: p.rel, caminho: p.caminho, assuntos: [], arquivos: totalDeArquivos(pastas, p), subpastas: p.subpastas.slice(0, 8), exemplos: p.arquivos.slice(0, 4) });
        const reg = achadas.get(p.rel);
        if (!reg.assuntos.includes(a.rotulo)) reg.assuntos.push(a.rotulo);
      }
    }
    // Arquivos pelo nome, no processo inteiro (pasta genérica como "Outros documentos").
    if (a.arquivo) {
      for (const p of pastas) for (const f of p.arquivos) {
        if (a.arquivo.test(norm(f)) && !arquivos.some(x => x.rel === `${p.rel}/${f}`)) arquivos.push({ rel: `${p.rel}/${f}`, caminho: path.join(p.caminho, f), assunto: a.rotulo });
      }
    }
  }
  /* Pasta específica dentro de pasta genérica ("Outros Documentos/Treinamento"):
     fica a específica. Pasta específica com subpasta que também bate
     ("Empenhos" e "Empenhos/2020"): fica a de cima (as de dentro aparecem nela). */
  const todas = [...achadas.values()];
  const dentro = (filho, pai) => filho.rel.startsWith(pai.rel + '/');
  const lista = todas.filter(p => {
    const generica = RE_GENERICA.test(norm(p.rel.split('/').pop()));
    if (generica && todas.some(o => dentro(o, p))) return false;
    if (todas.some(o => dentro(p, o) && !RE_GENERICA.test(norm(o.rel.split('/').pop())))) return false;
    return true;
  }).sort((x, y) => (y.arquivos > 0) - (x.arquivos > 0) || x.rel.localeCompare(y.rel, 'pt-BR', { numeric: true }));
  // Arquivo que já está numa das pastas apontadas não se repete: a lista mostra o que está FORA
  // delas (uma resposta anterior em "Requisições TCE", uma planilha em "Outros documentos").
  // Dentro de pasta genérica ("Outros Documentos", 50+ arquivos) o arquivo continua listado: é agulha no palheiro.
  const foraDasPastas = arquivos.filter(a => !lista.some(p => a.rel.startsWith(p.rel + '/') && !RE_GENERICA.test(norm(p.rel.split('/').pop()))));
  return {
    numero: item.numero, texto: item.texto,
    assuntos: assuntos.map(a => a.rotulo),
    manifestacao,
    pastas: lista,
    arquivos: foraDasPastas.slice(0, 12),
    semPasta: !lista.length
  };
}

/* ------------------------------------------------------------------
   Qual processo: pelo PA citado, pelo contrato cadastrado na Central ou
   pelo nome da empresa no nome da pasta. Quem usa pode trocar.
   ------------------------------------------------------------------ */
function listarProcessos(raizes) {
  const { paDaPasta } = require('./requisicoes');
  const out = [];
  const procurar = (pasta, prof) => {
    let ents;
    try { ents = fs.readdirSync(pasta, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      if (!e.isDirectory()) continue;
      const c = path.join(pasta, e.name);
      if (/^P\.?\s*A\.?\s*\d/i.test(e.name)) out.push({ caminho: c, nome: e.name.normalize('NFC'), pa: paDaPasta(e.name), categoria: /encerrad/i.test(c) ? 'encerrado' : /outras\s+secretarias/i.test(c) ? 'outra_secretaria' : 'vigencia' });
      else if (prof < 2) procurar(c, prof + 1);
    }
  };
  (raizes || []).forEach(r => procurar(r, 0));
  return out.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true }));
}

const PALAVRAS_GENERICAS = new Set(['ltda', 'eireli', 'me', 'epp', 'sa', 's/a', 'tecnologia', 'informacao', 'informatica', 'servicos', 'comercio', 'empresa', 'da', 'de', 'do', 'e', 'solucoes', 'sistemas', 'computadores', 'consultoria', 'telecomunicacoes', 'brasil', 'importacao', 'exportacao']);
function localizarProcesso(db, processos, { pa, contrato, contratada }) {
  const { chavePa } = require('./requisicoes');
  const porPa = k => k && processos.find(p => chavePa(p.pa) === k);
  let achado = porPa(chavePa(pa));
  if (achado) return { ...achado, como: `pelo PA ${pa} citado no documento` };
  const c = contrato && (db.contratos || []).find(x => x.numero === contrato);
  if (c && (achado = porPa(chavePa(c.pa)))) return { ...achado, como: `pelo contrato ${contrato}, cadastrado na Central com o PA ${c.pa}` };
  if (contratada) {
    const palavras = norm(contratada).split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !PALAVRAS_GENERICAS.has(w));
    const pontuados = processos.map(p => ({ p, n: palavras.filter(w => new RegExp(`\\b${w}\\b`).test(norm(p.nome))).length })).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
    if (pontuados.length === 1 || (pontuados.length > 1 && pontuados[0].n > pontuados[1].n)) return { ...pontuados[0].p, como: `pelo nome da contratada (${contratada}) no nome da pasta — confira` };
    if (pontuados.length > 1) return { ...pontuados[0].p, como: `pelo nome da contratada — há ${pontuados.length} processos dela; confira se é este`, alternativas: pontuados.slice(1, 6).map(x => x.p.nome) };
  }
  return null;
}

function direcionar(itens, caminhoProcesso) {
  const pastas = caminhoProcesso && fs.existsSync(caminhoProcesso) ? mapearProcesso(caminhoProcesso) : [];
  return { itens: itens.map(i => direcionarItem(i, pastas)), pastasNoProcesso: pastas.filter(p => !p.rel.includes('/')).length };
}

module.exports = { ASSUNTOS, lerItensPedidos, mapearProcesso, direcionarItem, direcionar, listarProcessos, localizarProcesso };
