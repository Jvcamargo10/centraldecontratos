/* ===================================================================
   integrations/garantiaContratual.js

   Validade da GARANTIA contratual (28/09/2026), para o risco de garantia
   vencida ou que não cobre a vigência (registroRiscos.js).

   De onde vem a data, em ordem de confiança:
     1. o ofício que encaminha a apólice, digitado: "apólice ... com
        vigência entre 13/02/2025 até 13/02/2026, referente ao Contrato nº
        006/2025";
     2. a própria apólice: "Vigência do seguro a partir das 09:00h do dia
        13/02/2025 até 23:59h do dia 13/02/2026";
     3. qualquer "vigência ... de DATA a DATA" do documento.
   A apólice costuma ser digitalizada, e o OCR erra dígito — no 118/2022 o
   ofício diz 03/06/2025 e o OCR da apólice leu "03/06/2028". Por isso o
   ofício vem primeiro. Data lida por OCR vai marcada para conferência.

   Só vale documento que CITA o número deste contrato (a mesma regra do
   termo de encerramento).
=================================================================== */
const path = require('path');
const servidorArquivos = require('./servidorArquivos');
const extratorDocumento = require('./extratorDocumento');
const { _paraTeste: { citaOContrato } } = require('./termoEncerramento');

// "13/02/2026", "1302/2025" (OCR comeu a barra), "13.02.2026".
const DATA = String.raw`(\d{2})\s*[\/.]?\s*(\d{2})\s*[\/.]\s*(\d{4})`;
const iso = (d, m, a) => {
  const [D, M] = [Number(d), Number(m)];
  return D >= 1 && D <= 31 && M >= 1 && M <= 12 ? `${a}-${m}-${d}` : null;
};

function frase(t, i) {
  // Do começo da frase, mas no máximo 140 caracteres antes da data (o
  // carimbo "Papel para informação, rubricado como folha..." não é prova).
  let ini = Math.max(0, t.lastIndexOf('. ', i) + 1, i - 140);
  if (ini > 0 && ini < i) { const esp = t.indexOf(' ', ini); if (esp > 0 && esp < i) ini = esp + 1; }
  /* Termina no número do contrato ("referente ao Contrato nº 066/2020"), se
     vier logo depois; senão no fim da frase. Antes ia até 300 caracteres e
     pegava a assinatura digitalizada ("Fxlana Mxntxiro Crvzpo (x 'rocuradoria"). */
  const numero = /contrato\s+n[º°o.]*\s*\d{1,4}\s*[\/_-]\s*\d{2,4}/i.exec(t.slice(i, i + 220));
  const ponto = t.indexOf('. ', i);
  const fim = numero ? i + numero.index + numero[0].length
    : ponto < 0 ? i + 240 : Math.min(ponto + 1, i + 300);
  return t.slice(ini, fim).replace(/\[página \d+\]/g, ' ').replace(/\s+/g, ' ').trim();
}

/* Lê a validade da garantia num texto. null se o texto não é deste contrato
   ou não traz período. */
function lerGarantia(texto, numero) {
  const t = String(texto || '');
  if (!citaOContrato(t, numero)) return null;
  const achados = [];
  const regras = [
    // 1. ofício: "vigência entre X até Y, referente ao Contrato nº N"
    { confianca: 3, re: new RegExp(String.raw`vig[êe]ncia\s+(?:entre|de)\s+${DATA}\s+(?:at[ée]|a)\s+${DATA}`, 'gi'), exigeNumeroPerto: true },
    // 2. apólice: "Vigência do seguro a partir ... do dia X até ... do dia Y"
    { confianca: 2, re: new RegExp(String.raw`vig[êe]ncia\s+d[ao]\s+(?:seguro|ap[óo]lice|garantia)[^.]{0,60}?${DATA}[^.]{0,50}?at[ée][^.]{0,30}?${DATA}`, 'gi') },
    // 3. genérico: "vigência ... de X a Y"
    { confianca: 1, re: new RegExp(String.raw`vig[êe]ncia[^.]{0,80}?\bde\s+${DATA}\s+(?:a|at[ée])\s+${DATA}`, 'gi') }
  ];
  for (const r of regras) {
    for (const m of t.matchAll(r.re)) {
      const inicio = iso(m[1], m[2], m[3]);
      const fim = iso(m[4], m[5], m[6]);
      if (!fim || (inicio && fim < inicio)) continue;
      if (r.exigeNumeroPerto && !citaOContrato(t.slice(Math.max(0, m.index - 250), m.index + m[0].length + 250), numero)) continue;
      achados.push({ inicio, fim, confianca: r.confianca, citacao: frase(t, m.index) });
    }
  }
  if (!achados.length) return null;
  // A fonte mais confiável; entre elas, a validade mais longa (a renovação mais recente).
  const melhor = Math.max(...achados.map(a => a.confianca));
  return achados.filter(a => a.confianca === melhor).sort((a, b) => b.fim.localeCompare(a.fim))[0];
}

/* Procura a garantia do contrato nos documentos do processo.
   Devolve { lida, documentos }: `lida` é a de validade mais longa (ou
   null) e `documentos`, quantos documentos de garantia havia — para
   distinguir "não arquivada" de "arquivada, mas sem validade legível". */
async function detectarGarantia(contrato, caminhoDoGrupo) {
  let melhor = null;
  const docs = servidorArquivos.documentosDeGarantia(caminhoDoGrupo);
  for (const caminho of docs) {
    let r = null;
    try { r = await extratorDocumento.extrairTexto(caminho); } catch (e) { continue; }
    if (!r || r.semTexto) continue;
    const lida = lerGarantia(r.texto, contrato.numero);
    if (!lida) continue;
    const item = { arquivo: path.basename(caminho), caminho, inicio: lida.inicio, fim: lida.fim, citacao: lida.citacao, porOcr: !!(r.ocr && r.ocr.tentado) };
    if (!melhor || item.fim > melhor.fim) melhor = item;
  }
  return { lida: melhor, documentos: docs.length };
}

module.exports = { lerGarantia, detectarGarantia };
