/* ===================================================================
   integrations/fichaCadastroContrato.js

   Orquestrador da Ficha de Cadastro (Ferramenta 3): liga
   extratorDocumento.js (texto do arquivo já usado pela Ferramenta 1) ->
   máscara de CPF -> leituraPorRegra.fichaPorRegra() e as conferências
   abaixo (vigência, média mensal, gestão) -> um PDF salvo dentro da
   própria Central de Contratos, com os mesmos campos do formulário "Cadastrar
   Contrato" do SGC (levantado manualmente em setembro/2026 — ver README).

   Mesmo espírito da Ferramenta 2 (mapa de risco): só roda SOB DEMANDA
   (alguém clica em "Gerar Ficha de Cadastro"), só é possível para
   contratos com `arquivoOrigem` (hoje, os que vieram da Ferramenta 1), e
   NUNCA escreve nem envia nada para o SGC de verdade — o PDF gerado é um
   registro interno, pensado pra quem for cadastrar manualmente no SGC
   ter os valores à mão, ou só pra guardar como comprovante do que foi
   lido automaticamente daquele arquivo.

   Hoje cobre só Contratos. Os outros 8 tipos de cadastro do SGC
   (Aditivos, Apostilamentos, Gratificações, Requisições, Funcionários,
   Empresas, Ioms, Portarias) ficam para uma próxima rodada, quando as
   pastas de rede de origem de cada um forem definidas (ver README).
=================================================================== */

const fs = require('fs');
const path = require('path');
const extratorDocumento = require('./extratorDocumento');
const leituraPorRegra = require('./leituraPorRegra');
const servidorArquivos = require('./servidorArquivos');
const { mascararCpf } = require('./mascaraDados');
const gerarPdfFichaContrato = require('./fichaCadastroPdf');

/* Pasta própria do projeto (fora de node_modules/pastas de rede) onde os
   PDFs gerados ficam guardados — criada automaticamente na primeira
   geração. Fica FORA de `public/` de propósito: o download passa sempre
   pelo endpoint autenticado (ver server.js), nunca por um link estático
   direto, pra respeitar o mesmo controle de acesso do resto do app. */
const PASTA_FICHAS = require('./configServidor').obterConfig().pastaFichas; // <pasta de dados>/fichas-cadastro

function garantirPastaFichas() {
  if (!fs.existsSync(PASTA_FICHAS)) fs.mkdirSync(PASTA_FICHAS, { recursive: true });
}

/* Nome de arquivo seguro a partir do número do contrato — troca qualquer
   caractere que o Windows não aceita em nome de arquivo (\ / : * ? " < > |)
   por "_", já que o "número" do contrato às vezes vem com barra
   (ex: "096/2025") por vir direto do texto extraído. */
function nomeArquivoSeguro(base) {
  return String(base).replace(/[\\/:*?"<>|]/g, '_');
}

/* Campos da ficha que existem também no cadastro interno e que a busca
   local por regex extrai de forma determinística (formato fechado no
   documento). À esquerda o nome na ficha do SGC, à direita o nome usado
   por leituraPorRegra.lerCampos. */
const EQUIVALENTES_BUSCA_LOCAL = {
  numero: 'numero',
  processoAdministrativo: 'pa',
  cnpjEmpresa: 'cnpjEmpresa',
  empresa: 'empresa',
  tipoContratacao: 'tipoContratacao'
};

/* Destes, a leitura do texto inteiro da pasta prevalece quando diverge da
   base da ficha — são os de formato fechado, em que a regra só dispara com
   o padrão inteiro presente. `empresa` e `tipoContratacao` só completam o
   que ficou vazio (uma diferença de ponto final, "...LTDA." -> "...LTDA",
   não deve virar nota de procedência). */
const CAMPOS_FICHA_DE_FORMATO_CANONICO = ['numero', 'processoAdministrativo', 'cnpjEmpresa'];

/* Completa a base da ficha com a leitura por regra do texto, a média
   mensal e a vigência calculadas e a gestão (ato mais recente). Cada troca
   fica em `camposDaBuscaLocal` ({ campo, daIa: valor anterior, daRegex:
   valor da regra } — os nomes vêm de quando havia IA; ficaram para as
   fichas já gravadas continuarem legíveis). Altera `resultado` no lugar. */
function conferirComBuscaLocal(resultado, textoCompleto, textoDoGrupo) {
  const local = leituraPorRegra.lerCampos(textoCompleto);
  const vazio = v => v === undefined || v === null || v === '';
  resultado.camposDaBuscaLocal = [];
  Object.entries(EQUIVALENTES_BUSCA_LOCAL).forEach(([naFicha, naBusca]) => {
    const daRegex = local.campos[naBusca];
    if (vazio(daRegex)) return;
    const daIa = resultado.campos[naFicha];
    const divergem = !vazio(daIa) && String(daIa).trim() !== String(daRegex).trim();
    const podeCorrigir = CAMPOS_FICHA_DE_FORMATO_CANONICO.includes(naFicha);
    if (vazio(daIa) || (divergem && podeCorrigir)) {
      resultado.camposDaBuscaLocal.push({ campo: naFicha, daIa: vazio(daIa) ? null : daIa, daRegex });
      resultado.campos[naFicha] = daRegex;
    }
  });

  /* Valor do contrato e vigência em meses (os do contrato ORIGINAL, como
     o SGC cadastra) e a média mensal pela regra do SGC — (valor inicial +
     aditivos de valor) ÷ (vigência inicial + prorrogações) —, calculada
     com os termos aditivos de TODA a pasta do contrato (`textoDoGrupo`),
     não só do arquivo principal. Ver valorContratual.js. */
  const numero = resultado.campos.numero || local.campos.numero;

  /* Gestor e suplente pela regra (o ato de gestão mais recente da pasta,
     depois a cláusula do contrato) — a mesma da Fila de importação. */
  const gestao = require('./camposPorRegra').acharGestaoDoContrato(textoDoGrupo || textoCompleto, numero);
  [['gestor', gestao && gestao.responsavel], ['suplente', gestao && gestao.suplente]].forEach(([papel, nome]) => {
    if (!nome) return;
    const daIa = resultado[papel] && resultado[papel].nome;
    const mesmo = daIa && String(daIa).toLowerCase().replace(/\s+/g, ' ').includes(nome.toLowerCase());
    if (mesmo) return;
    resultado.camposDaBuscaLocal.push({ campo: `${papel}.nome`, daIa: daIa || null, daRegex: nome });
    resultado[papel] = { nome, cargo: null, dataDesignacao: null, dataTermino: null, status: null };
  });

  const calculo = leituraPorRegra.calcularMediaMensal(textoDoGrupo || textoCompleto, numero);
  resultado.calculoValor = calculo.memoria || calculo.avisos.length
    ? { memoria: calculo.memoria, aditivos: calculo.aditivos.map(a => ({ termo: a.termo, natureza: a.natureza, valor: a.valor, meses: a.meses, documento: a.documento, detalhe: a.detalhe || null })), avisos: calculo.avisos }
    : null;
  // Todos os valores da regra, mesmo os iguais aos da base — para avisosDaFicha
  // não tratar a média calculada como inferência (ela nunca está escrita).
  resultado.valoresDaRegra = [];
  [['valorContrato', calculo.valorInicial], ['vigenciaEmMeses', calculo.mesesIniciais], ['valorMediaMensal', calculo.mediaMensal]]
    .forEach(([naFicha, daRegex]) => {
      if (vazio(daRegex)) return;
      resultado.valoresDaRegra.push({ campo: naFicha, daRegex });
      const daIa = resultado.campos[naFicha];
      if (vazio(daIa) || Number(daIa) !== Number(daRegex)) {
        resultado.camposDaBuscaLocal.push({ campo: naFicha, daIa: vazio(daIa) ? null : daIa, daRegex });
        resultado.campos[naFicha] = daRegex;
      }
    });

  /* Datas: assinatura do contrato e vigência contada em meses a partir do
     marco (assinatura ou Ordem de Início), com as prorrogações — ver
     vigenciaContratual.js. Só entra data verificada. */
  const vigencia = leituraPorRegra.calcularVigencia(textoDoGrupo || textoCompleto, numero);
  resultado.calculoVigencia = (vigencia.memoria || vigencia.avisos.length)
    ? { memoria: vigencia.memoria, inicio: vigencia.inicio, termino: vigencia.termino, avisos: vigencia.avisos }
    : null;
  const inicioPeriodo = vigencia.periodos[0] && vigencia.periodos[0].inicio;
  [['dataAssinatura', vigencia.inicio], ['dataInicioVigencia', inicioPeriodo], ['dataTerminoVigencia', vigencia.termino]]
    .forEach(([naFicha, daRegra]) => {
      if (vazio(daRegra)) return;
      resultado.valoresDaRegra.push({ campo: naFicha, daRegex: daRegra });
      const daIa = resultado.campos[naFicha];
      if (daIa !== daRegra) {
        resultado.camposDaBuscaLocal.push({ campo: naFicha, daIa: vazio(daIa) ? null : daIa, daRegex: daRegra });
        resultado.campos[naFicha] = daRegra;
      }
    });
}

/* Avisos sobre data ou valor da ficha que não está escrito no documento
   nem veio de cálculo da regra. O PDF é feito para ser copiado no cadastro
   do SGC: um valor sem lastro ali viraria dado oficial. (Foi o que a IA,
   retirada em 01/10/2026, fazia: datas e um valor de R$ 100.000 num
   contrato de R$ 26.100.000.) */
function avisosDaFicha(campos, textoCompleto, camposDaBuscaLocal) {
  const texto = String(textoCompleto || '');
  const avisos = [];
  const preenchido = v => v !== undefined && v !== null && v !== '';
  // Data por data e valor por valor — as verificações ficam em
  // leituraPorRegra (dataApareceNoTexto/valorApareceNoTexto).
  const datasDaRegra = new Set((camposDaBuscaLocal || []).filter(c => String(c.daRegex) === String(campos[c.campo])).map(c => c.campo));
  const datasInferidas = ['dataAssinatura', 'dataInicioVigencia', 'dataTerminoVigencia', 'dataInicioOrdemServico']
    .filter(c => preenchido(campos[c]) && !datasDaRegra.has(c) && !leituraPorRegra.dataApareceNoTexto(campos[c], texto));

  if (datasInferidas.length) {
    const lista = datasInferidas.map(c => `${c} (${campos[c]})`).join(', ');
    avisos.push(`${datasInferidas.length === 1 ? 'A data' : 'As datas'} de ${lista} não ${datasInferidas.length === 1 ? 'aparece' : 'aparecem'} no documento — confirme na fonte antes de cadastrar.`);
  }

  // Valor que veio da regra (lido ou CALCULADO — a média mensal nunca está
  // escrita no documento) não precisa de aviso.
  const daRegra = new Set((camposDaBuscaLocal || []).filter(c => Number(c.daRegex) === Number(campos[c.campo])).map(c => c.campo));
  const valores = ['valorContrato', 'valorGarantia', 'valorMediaMensal'].filter(c => preenchido(campos[c]) && !daRegra.has(c));
  valores.forEach(campo => {
    const emReais = Number(campos[campo]);
    if (!Number.isFinite(emReais)) return;
    if (!leituraPorRegra.valorApareceNoTexto(emReais, texto)) {
      const comoTexto = emReais.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
      avisos.push(`O valor preenchido em ${campo} (R$ ${comoTexto}) não aparece escrito no documento — confirme antes de cadastrar.`);
    }
  });
  return avisos;
}

/* Texto de TODOS os documentos da pasta do contrato (o contrato e os
   termos aditivos, na subpasta "3. Contratos, Aditivos e Termos"), no
   mesmo formato da Ferramenta 1 — só para o cálculo da média mensal, que
   precisa dos aditivos. Usa o cache de texto do extrator, então só custa
   OCR o documento que nunca foi lido. Se a pasta não puder ser listada
   (fora das pastas configuradas, rede fora do ar), fica só o arquivo
   principal, como antes. */
async function textoDoGrupo(arquivoOrigem, principal) {
  const blocos = [`=== Arquivo: ${path.basename(arquivoOrigem)} ===\n${principal.texto}`];
  let docs = [];
  try {
    docs = servidorArquivos.listarDocumentosDaPasta(servidorArquivos.pastaDoGrupo(arquivoOrigem));
  } catch (e) {
    return blocos[0];
  }
  for (const d of docs) {
    if (path.resolve(d.caminho) === path.resolve(arquivoOrigem)) continue;
    try {
      // Um contrato só: leitura completa (a mesma do Mapa de risco, reaproveitada).
      const r = await extratorDocumento.extrairTexto(d.caminho, extratorDocumento.LEITURA_COMPLETA);
      if (!r.semTexto) blocos.push(`=== Arquivo: ${d.nome} ===\n${r.texto}`);
    } catch (e) { /* documento ilegível não impede a ficha */ }
  }
  return blocos.join('\n\n');
}

/* Gera (ou regenera) a ficha de cadastro de um contrato. */
async function gerarFichaCadastroContrato(db, save, nextId, contratoId, usuarioNome) {
  const contrato = (db.contratos || []).find(c => String(c.id) === String(contratoId));
  if (!contrato) throw new Error('Contrato não encontrado.');
  if (!contrato.arquivoOrigem) {
    throw new Error('Este contrato não tem um arquivo de origem associado (não veio da Ferramenta 1 de ingestão) — não há texto para preencher a ficha automaticamente.');
  }

  const extraido = await extratorDocumento.extrairTexto(contrato.arquivoOrigem, extratorDocumento.LEITURA_COMPLETA);
  if (extraido.semTexto) {
    throw new Error('O arquivo de origem deste contrato não tem texto extraível (mesmo com OCR) — não é possível preencher a ficha automaticamente.');
  }

  const resultado = leituraPorRegra.fichaPorRegra(mascararCpf(extraido.texto));
  conferirComBuscaLocal(resultado, extraido.texto, await textoDoGrupo(contrato.arquivoOrigem, extraido));
  resultado.avisos = avisosDaFicha(resultado.campos, extraido.texto, [...resultado.camposDaBuscaLocal, ...resultado.valoresDaRegra]);

  garantirPastaFichas();
  const nomeArquivo = `ficha-contrato-${nomeArquivoSeguro(contrato.numero || contrato.id)}-${Date.now()}.pdf`;
  const caminhoArquivo = path.join(PASTA_FICHAS, nomeArquivo);
  try {
    await gerarPdfFichaContrato({ ...resultado, contratoNumero: contrato.numero, arquivoOrigem: contrato.arquivoOrigem }, caminhoArquivo);
  } catch (errPdf) {
    throw new Error(`Os campos foram extraídos, mas a geração do arquivo PDF falhou: ${errPdf.message}`);
  }

  const registro = {
    id: nextId(db.fichasCadastro),
    tipo: 'contrato',
    contratoId: contrato.id,
    contratoNumero: contrato.numero,
    geradoEm: new Date().toISOString(),
    geradoPor: usuarioNome || 'Usuário',
    arquivoOrigem: contrato.arquivoOrigem,
    arquivoFicha: nomeArquivo,
    campos: resultado.campos,
    // Vão junto para o registro (e daí para a tela) pelo mesmo motivo que
    // aparecem no PDF: de onde veio cada campo.
    avisos: resultado.avisos || [],
    camposDaBuscaLocal: resultado.camposDaBuscaLocal || [],
    calculoValor: resultado.calculoValor || null,
    calculoVigencia: resultado.calculoVigencia || null,
    gestor: resultado.gestor,
    suplente: resultado.suplente,
    fiscais: resultado.fiscais,
    modeloUsado: resultado.modeloUsado
  };
  db.fichasCadastro = db.fichasCadastro || [];
  db.fichasCadastro.unshift(registro);
  save();
  return registro;
}

/* Ficha mais recente de um contrato (ou null se nunca foi gerada). */
function fichaMaisRecente(db, contratoId) {
  return (db.fichasCadastro || []).find(f => String(f.contratoId) === String(contratoId)) || null;
}

/* Mesma lógica de listarElegiveisComUltimoMapa (Ferramenta 2): só
   contratos com arquivoOrigem podem ter ficha gerada automaticamente. */
function listarElegiveisComUltimaFicha(db) {
  const elegiveis = (db.contratos || []).filter(c => !!c.arquivoOrigem);
  return elegiveis.map(c => ({
    contrato: { id: c.id, numero: c.numero, empresa: c.empresa, tipo: c.tipo, secretaria: c.secretaria },
    ultimaFicha: fichaMaisRecente(db, c.id)
  }));
}

/* Resolve o caminho físico de uma ficha já gerada a partir do seu ID,
   validando que o arquivo resultante fica DENTRO de PASTA_FICHAS — mesmo
   princípio de segurança usado em servidorArquivos.js (raizQueContem)
   para a seleção manual de arquivos: nunca confiar cegamente num nome
   vindo de um registro sem checar limites de pasta. */
function caminhoArquivoFicha(db, fichaId) {
  const ficha = (db.fichasCadastro || []).find(f => String(f.id) === String(fichaId));
  if (!ficha) throw new Error('Ficha de cadastro não encontrada.');
  const alvo = path.resolve(PASTA_FICHAS, ficha.arquivoFicha);
  const raiz = path.resolve(PASTA_FICHAS);
  if (alvo !== raiz && !alvo.startsWith(raiz + path.sep)) {
    throw new Error('Nome de arquivo de ficha inválido.');
  }
  if (!fs.existsSync(alvo)) {
    throw new Error('O arquivo desta ficha não foi encontrado no disco — pode ter sido movido ou apagado; gere a ficha novamente.');
  }
  return { caminho: alvo, nomeDownload: `ficha-contrato-${nomeArquivoSeguro(ficha.contratoNumero || ficha.contratoId)}.pdf` };
}

module.exports = {
  gerarFichaCadastroContrato,
  fichaMaisRecente,
  listarElegiveisComUltimaFicha,
  caminhoArquivoFicha,
  PASTA_FICHAS,
  /* Funções puras (sem db, sem rede, sem disco) para testes — decidem a
     proveniência de cada campo da ficha. Ver testes/ingestaoContratos.test.js. */
  _paraTeste: { conferirComBuscaLocal, avisosDaFicha }
};
