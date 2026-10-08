/* ===================================================================
   integrations/planilhaCsv.js

   Geração de CSV para o Excel em português, num lugar só.

   Existia duplicado em baseContratos.js e baseTermos.js (22/09/2026).
   Duas cópias de uma regra de SEGURANÇA é um problema, não só feiura: o
   conteúdo exportado vem de documento de terceiro, e a
   neutralização de fórmula (`=HYPERLINK("http://...")` no objeto do
   contrato vira link clicável na planilha de quem abrir) precisa valer
   para toda exportação — inclusive a próxima, que alguém vai escrever
   copiando de uma das duas.

   Formato: BOM + separador ";" + CRLF é o que o Excel em português abre
   com acentuação e colunas certas, sem passar pelo assistente de
   importação.
=================================================================== */

const vazio = v => v === undefined || v === null || v === '';

/* Células que começam com = + - @ (ou tab/CR) são interpretadas como
   FÓRMULA pelo Excel. O apóstrofo na frente faz tratar como texto. */
function neutralizarFormula(texto) {
  return /^[=+\-@\t\r]/.test(texto) ? "'" + texto : texto;
}

function celula(valor) {
  if (vazio(valor)) return '';
  const texto = neutralizarFormula(String(valor).replace(/\r?\n/g, ' '));
  return /[";]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/* Valor de uma coluna no formato que o Excel brasileiro entende:
   dd/mm/aaaa e 1234,56 (vírgula decimal, sem separador de milhar — com
   ele o Excel lê como texto). */
function formatarValor(coluna, valor) {
  if (vazio(valor)) return '';
  if (coluna && coluna.tipo === 'data') {
    const m = String(valor).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(valor);
  }
  if (coluna && coluna.tipo === 'valor') {
    const n = Number(valor);
    return Number.isFinite(n) ? n.toFixed(2).replace('.', ',') : String(valor);
  }
  return valor;
}

/* `cabecalho`: array de títulos. `linhas`: array de arrays já na ordem
   das colunas (use formatarValor em cada célula tipada antes). */
function montar(cabecalho, linhas) {
  return '﻿' + [cabecalho, ...linhas].map(cols => cols.map(celula).join(';')).join('\r\n') + '\r\n';
}

module.exports = { montar, celula, formatarValor, neutralizarFormula };
