/* ===================================================================
   integrations/textoDeProposta.js

   O texto já lido dos documentos de uma proposta, direto do cache.

   Mora sozinho porque é usado por dois lados com papéis diferentes:
   ingestaoContratos.js (que ESCREVE propostas) e pendenciasLeitura.js
   (que só LÊ). Sem isto, o módulo de leitura precisava importar o
   orquestrador inteiro — e junto vinham servidorArquivos, leituraPorRegra e
   mapaRiscoContratos — só para pegar um texto.

   Nunca dispara OCR (`apenasCache: true`): quem chama é tela, e tela não
   pode ficar minutos esperando o Tesseract. Documento ainda não lido
   simplesmente não entra, e quem chama decide o que fazer com isso.
=================================================================== */

const path = require('path');
const extratorDocumento = require('./extratorDocumento');

/* Qual arquivo do grupo é o "principal" — o contrato, não o extrato do
   Diário nem o termo. Regra própria (curta) para não depender do
   orquestrador: o nome que parece contrato ganha; empate, o maior texto. */
function escolherPrincipal(comTexto) {
  const pontos = e => {
    const nome = String(e.nome || '').toLowerCase();
    if (/extrato|di[áa]rio|iom|public/.test(nome)) return 0;
    if (/aditamento|aditivo|apostilamento|termo/.test(nome)) return 1;
    if (/contrato|acordo|ata/.test(nome)) return 3;
    return 2;
  };
  return comTexto.slice().sort((a, b) => (pontos(b) - pontos(a)) || (b.texto.length - a.texto.length))[0];
}

/* Mesmo formato que a extração usa: um cabeçalho por arquivo, com o
   principal na frente. É o formato que valorContratual.js e
   vigenciaContratual.js esperam para separar os documentos. */
function combinar(comTexto, principal) {
  if (!comTexto || !comTexto.length) return '';
  const ordenados = principal ? [principal, ...comTexto.filter(e => e !== principal)] : comTexto;
  return ordenados.map(e => `=== Arquivo: ${e.nome} ===\n${e.texto}`).join('\n\n');
}

/* Devolve null quando nenhum documento da proposta foi lido ainda. */
async function doCache(p, escolherPrincipalExterno) {
  const comTexto = [];
  for (const f of ((p && p.arquivosFonte) || []).filter(f => f && f.caminho)) {
    let r = null;
    try { r = await extratorDocumento.extrairTexto(f.caminho, { apenasCache: true }); } catch (e) { r = null; }
    if (r && !r.semTexto) comTexto.push({ nome: f.nome || path.basename(f.caminho), caminho: f.caminho, texto: r.texto });
  }
  if (!comTexto.length) return null;
  const escolher = escolherPrincipalExterno || escolherPrincipal;
  const principal = comTexto.find(e => p.arquivo && e.caminho === p.arquivo.caminho) || escolher(comTexto);
  return combinar(comTexto, principal);
}

module.exports = { doCache, combinar, _paraTeste: { escolherPrincipal } };
