/* ===================================================================
   integrations/termoEncerramento.js

   Termo de ENCERRAMENTO do contrato (25/09/2026). Fica na subpasta
   "20. Termo de Encerramento" de cada processo, fora da subpasta de
   contratos, e a varredura não o lia. Medido: 4 contratos da pasta de
   VIGÊNCIA já tinham o termo preenchido — 072/2020 ("finalizou em
   29/09/2025"), 066/2020 ("vigência encerrou-se em 06/08/2026"), 045/2022
   e 141/2022 — e continuavam "Ativo", com prazo "vencido" (risco Alto) no
   Mapa de risco.

   O termo NÃO muda o cadastro sozinho (decisão do usuário): vira uma
   pendência "Confirmar encerramento" em Pendências de leitura, com a
   data, o motivo e a frase do termo como prova. Só quem confirma põe o
   contrato como Encerrado — e fica na Auditoria.

   Só vale termo que CITA o número deste contrato: o modelo em branco
   ("Contrato Nº XXX/XXXX") e o termo de outro contrato do mesmo processo
   não contam.
=================================================================== */
const path = require('path');
const servidorArquivos = require('./servidorArquivos');
const extratorDocumento = require('./extratorDocumento');

/* "072/2020" -> casa "Contrato nº 072/2020", "contrato n° 72/2020",
   "Contrato Nº 072_2020", "contrato 72/20". */
function citaOContrato(texto, numero) {
  const m = String(numero || '').match(/(\d{1,4})\s*[\/._-]\s*(\d{2,4})/);
  if (!m) return false;
  const n = String(Number(m[1]));
  const ano = m[2].length === 4 ? `(?:${m[2]}|${m[2].slice(2)})` : `(?:20)?${m[2]}`;
  return new RegExp(`contrato\\s*(?:n[º°o.]*\\s*)?0*${n}\\s*[\\/._-]\\s*${ano}\\b`, 'i').test(String(texto || ''));
}

const DATA = String.raw`(\d{1,2})\s*[\/.]\s*(\d{1,2})\s*[\/.]\s*(\d{4})`;
const PALAVRA_DE_FIM = String.raw`(?:finalizou|finalizad[oa]|encerrou(?:-se)?|encerrad[oa]|t[ée]rmino|termino|venceu|vencid[oa]|expirou)`;

/* Data de encerramento: a MAIS TARDIA entre as datas ligadas a
   "finalizou/encerrou/término" — o termo do 072/2020 lista o contrato
   (28/09/2022) e cada aditivo (28/09/2024, 29/09/2025); o fim é o último. */
function dataDeEncerramento(texto) {
  const t = String(texto || '');
  const datas = [];
  for (const m of t.matchAll(new RegExp(`${PALAVRA_DE_FIM}[^.;]{0,80}?${DATA}`, 'gi'))) {
    const [d, mes, a] = [m[1], m[2], m[3]].map(Number);
    if (mes >= 1 && mes <= 12 && d >= 1 && d <= 31) datas.push({ iso: `${a}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`, indice: m.index });
  }
  const rotulada = new RegExp(`data\\s+(?:de|do)\\s+encerramento\\s*:?\\s*${DATA}`, 'i').exec(t);
  if (rotulada) datas.push({ iso: `${rotulada[3]}-${rotulada[2].padStart(2, '0')}-${rotulada[1].padStart(2, '0')}`, indice: rotulada.index });
  if (!datas.length) return null;
  return datas.sort((a, b) => b.iso.localeCompare(a.iso))[0];
}

function motivoDoEncerramento(texto) {
  const m = /encerra(?:-se)?\s+por\s+motivo\s+de\s+([^.;]{3,140})/i.exec(String(texto || ''))
    || /motivo\s+(?:do\s+encerramento)?\s*:\s*([^.;\n]{3,140})/i.exec(String(texto || ''));
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

function frase(texto, indice) {
  const t = String(texto || '');
  const ini = Math.max(0, t.lastIndexOf('. ', indice) + 1);
  const fimPonto = t.indexOf('. ', indice);
  const fim = fimPonto < 0 ? Math.min(t.length, indice + 240) : Math.min(fimPonto + 1, indice + 300);
  return t.slice(ini, fim).replace(/\[página \d+\]/g, ' ').replace(/\s+/g, ' ').trim();
}

/* Lê UM texto de termo. null quando não é o termo deste contrato. */
function lerTermo(texto, numero) {
  if (!citaOContrato(texto, numero)) return null;
  const data = dataDeEncerramento(texto);
  return {
    data: data ? data.iso : null,
    motivo: motivoDoEncerramento(texto),
    citacao: data ? frase(texto, data.indice) : frase(texto, String(texto).search(/encerramento/i))
  };
}

/* Procura o termo de encerramento do contrato nos documentos do processo.
   `caminhoDoGrupo`: a pasta do contrato (arquivoOrigem ou pasta do grupo).
   Devolve { arquivo, caminho, assinatura, data, motivo, citacao } ou null. */
async function detectarEncerramento(contrato, caminhoDoGrupo) {
  const candidatos = servidorArquivos.documentosDeEncerramento(caminhoDoGrupo);
  for (const caminho of candidatos) {
    let r = null;
    try { r = await extratorDocumento.extrairTexto(caminho); } catch (e) { continue; }
    if (!r || r.semTexto) continue;
    const lido = lerTermo(r.texto, contrato.numero);
    if (!lido) continue;
    let assinatura = null;
    try { const st = require('fs').statSync(caminho); assinatura = `${st.size}:${Math.round(st.mtimeMs)}`; } catch (e) { /* segue sem */ }
    return { arquivo: path.basename(caminho), caminho, assinatura, ...lido };
  }
  return null;
}

module.exports = { detectarEncerramento, lerTermo, _paraTeste: { citaOContrato, dataDeEncerramento, motivoDoEncerramento } };
