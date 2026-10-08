/* ===================================================================
   integrations/mascaraDados.js

   Máscara de CPF no texto dos documentos — um lugar só (antes havia uma
   cópia em extratorDocumento.js e outra em mapaRiscoContratos.js).

   Por que foi reescrita (24/09/2026): a máscara antiga só reconhecia o
   formato perfeito "123.456.789-01". No texto guardado dos 239
   documentos, 140 números com forma de CPF tinham escapado, em três
   situações:
     1. o OCR troca a pontuação: "123,456.789-01", "123.456 789-01",
        "123 .456.789-01", quebra de linha antes dos dois últimos dígitos;
     2. a assinatura digital (ICP-Brasil) traz o CPF colado ao nome:
        "Assinado de forma digital por FULANO DE TAL:12345678901";
     3. depois de "CPF", "CPF/MF sob o nº", com qualquer ruído no meio.
   O que NÃO é mascarado: valor em reais ("R$ 139.000.000,00", que tem a
   mesma forma 3-3-3-2) e o NIRE da empresa (11 dígitos, dado da pessoa
   jurídica).
=================================================================== */

const MARCA = '[CPF removido]';

// 3-3-3-2 dígitos com a pontuação que o OCR produz (ponto, vírgula,
// espaço, quebra de linha). Vírgula antes dos dois últimos dígitos só
// conta quando não é valor em reais (ver abaixo).
const RE_CPF_SOLTO = /(?<![\d.,])\d{3}[ \t]*[.,]?[ \t\r\n]*\d{3}[ \t]*[.,]?[ \t\r\n]*\d{3}[ \t]*[-.,]?[ \t\r\n]*\d{2}(?![\d.,]*\d)/g;
// CPF colado ao nome no carimbo da assinatura digital: "NOME:12345678901".
const RE_CPF_ASSINATURA = /([A-ZÀ-Ý]{2,}\s*):\s*(\d{11})(?!\d)/g;
// Depois da palavra CPF: o primeiro número de 9 a 11 dígitos, com ruído.
// A própria marca "[CPF removido]" não é rótulo: sem esta exclusão, a
// data e o IP do carimbo de assinatura logo depois dela eram mascarados.
const RE_CPF_ROTULADO = /(\bC\.?P\.?F\.?(?!\s*removido)(?:\s*\/\s*MF)?[^\d\n[\]]{0,30}?)(\d[\d \t.,\-]{8,18}\d)/gi;

function ehValorEmReais(texto, indice, trecho) {
  // "R$ 139.000.000,00": termina em ",dd" e tem "R$" logo antes.
  return /,\s*\d{2}$/.test(trecho) && /R\$\s*$/i.test(texto.slice(Math.max(0, indice - 6), indice));
}

// Número de registro que não é da pessoa física: NIRE (Junta Comercial) e
// número de processo — 11 dígitos seguidos, como o CPF sem pontuação.
function ehRegistroNaoPessoal(texto, indice) {
  return /(?:NIRE|N\/RE|processo)[^\d\n]{0,15}$/i.test(texto.slice(Math.max(0, indice - 30), indice));
}

/* Número de processo do TCE-SP (29/09/2026): "TC-025938.989.20-9" tem 11
   dígitos em 6-3-2 e a máscara lia como CPF — o número do TC, que o
   cadastro de requisição do SGC pede, sumia do texto. Forma do TC: o
   grupo "989" (código fixo do Tribunal) seguido de ".AA" (ano) e, depois,
   o dígito "-D"; ou o rótulo "TC"/"e-TCE" logo antes. CPF de verdade não
   tem dígito depois dos dois verificadores. */
function ehProcessoTce(texto, indice, trecho) {
  if (!/989\s*[.,]\s*\d{2}$/.test(trecho)) return false;
  const depois = texto.slice(indice + trecho.length, indice + trecho.length + 4);
  const antes = texto.slice(Math.max(0, indice - 20), indice);
  return /^\s*-\s*\d/.test(depois) || /\b(?:e-?)?T\.?C\.?(?:E\.?)?(?:[-\s]*SP)?[\s\-–:nº°.]*$/i.test(antes);
}

function mascararCpf(texto) {
  let t = String(texto || '');
  t = t.replace(RE_CPF_ASSINATURA, (m, nome) => `${nome}:${MARCA}`);
  t = t.replace(RE_CPF_ROTULADO, (m, rotulo, numero) => {
    const digitos = numero.replace(/\D/g, '');
    return digitos.length >= 9 && digitos.length <= 11 ? `${rotulo}${MARCA}` : m;
  });
  t = t.replace(RE_CPF_SOLTO, (m, indice, todo) => (ehValorEmReais(todo, indice, m) || ehRegistroNaoPessoal(todo, indice) || ehProcessoTce(todo, indice, m) ? m : MARCA));
  return t;
}

module.exports = { mascararCpf, MARCA };
