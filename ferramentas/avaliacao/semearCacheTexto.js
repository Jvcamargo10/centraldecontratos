/* ===================================================================
   ferramentas/avaliacao/semearCacheTexto.js

   Copia o texto que a avaliação já extraiu (ferramentas/avaliacao/cache,
   com OCR feito) para o cache de texto da aplicação (.texto-cache, ver
   integrations/extratorDocumento.js). Resultado: a primeira varredura da
   pasta de rede não refaz o OCR de documento nenhum que a avaliação já
   leu — passa direto para a extração de campos.

       npm run avaliacao:semear-cache

   Só copia entradas cujo arquivo não mudou desde a extração (mesma
   assinatura), e nunca sobrescreve uma entrada que a aplicação já tenha.
   Os limites de OCR gravados são os do .env atual, os mesmos com que
   `npm run avaliacao:extrair` leu os documentos.
=================================================================== */

const fs = require('fs');
const path = require('path');
const comum = require('./comum');

const env = comum.lerEnv();
Object.entries(env).forEach(([k, v]) => { if (process.env[k] === undefined) process.env[k] = v; });
const extrator = require('../../integrations/extratorDocumento');
const { arquivoDeCache, gravarNoCache, lerDoCache } = extrator._cache;

const maxPaginasOcr = Number(process.env.CONTRATOS_OCR_MAX_PAGINAS) || 5;
const timeoutOcrMs = Number(process.env.CONTRATOS_OCR_TIMEOUT_MS) || 45000;
const pastaAvaliacao = path.join(__dirname, 'cache');

/* O texto da avaliação é o texto da aplicação: "[página N]\n..." por
   página. Remonta as páginas a partir dos marcadores. */
function paginasDoTexto(texto) {
  const partes = String(texto || '').split(/\[página (\d+)\]\n/);
  const paginas = [];
  for (let i = 1; i < partes.length; i += 2) {
    paginas.push({ numero: Number(partes[i]), texto: partes[i + 1].replace(/\n\n$/, '') });
  }
  return paginas;
}

let copiados = 0, jaTinha = 0, mudaram = 0, ignorados = 0;
for (const f of fs.existsSync(pastaAvaliacao) ? fs.readdirSync(pastaAvaliacao) : []) {
  let c;
  try { c = JSON.parse(fs.readFileSync(path.join(pastaAvaliacao, f), 'utf8')); } catch (e) { ignorados++; continue; }
  if (!c.caminho || c.erro || !c.texto) { ignorados++; continue; }
  if (!comum.lerCache(c.caminho)) { mudaram++; continue; } // arquivo mudou (ou sumiu) desde a extração
  if (fs.existsSync(arquivoDeCache(c.caminho)) && lerDoCache(c.caminho, maxPaginasOcr, timeoutOcrMs)) { jaTinha++; continue; }
  const paginas = paginasDoTexto(c.texto);
  if (!paginas.length) { ignorados++; continue; }
  gravarNoCache(c.caminho, {
    caminho: c.caminho,
    extensao: path.extname(c.caminho).slice(1).toLowerCase(),
    semTexto: !!c.semTexto,
    totalCaracteres: paginas.reduce((s, p) => s + p.texto.length, 0),
    paginas,
    ocr: c.ocr || null,
    leituraCompleta: !!c.leituraCompleta
  }, maxPaginasOcr, timeoutOcrMs);
  copiados++;
}
console.log(`Cache de texto da aplicação: ${copiados} documento(s) copiado(s), ${jaTinha} já estavam lá, ${mudaram} mudaram desde a avaliação (serão lidos de novo), ${ignorados} ignorado(s).`);
