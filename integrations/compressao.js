/* ===================================================================
   integrations/compressao.js

   Compressão gzip das respostas (02/10/2026), sem pacote novo — só o
   zlib do próprio Node. Medido com o Lighthouse: o app.js (~400 KB), o
   /api/bootstrap (~190 KB) e a página (~70 KB) iam sem compressão, e a
   primeira tela levava 4,3 s para aparecer num celular em 4G. Com gzip,
   esses três caem para cerca de um quarto do tamanho.

     1. comprimirRespostas: respostas da API e o que sair por res.send
        (JSON, CSV, texto) a partir de 1 KB, quando o navegador aceita
        gzip. O resto (arquivos baixados, 204, 304) passa como está.
     2. estaticosComprimidos: os arquivos da pasta public (.html, .js,
        .css, .svg, .json), comprimidos uma vez e guardados em memória até
        o arquivo mudar no disco. Mantém a revalidação de antes (ETag):
        o navegador pergunta se mudou e recebe 304 quando não mudou.
        Arquivo de outro tipo, ou navegador sem gzip, segue para o
        express.static de sempre.
=================================================================== */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MINIMO_BYTES = 1024;
const TIPOS_COMPRIMIVEIS = /json|text|javascript|css|svg|csv|xml/i;
const TIPOS_ESTATICOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8'
};

function aceitaGzip(req) {
  return /\bgzip\b/i.test(String((req.headers && req.headers['accept-encoding']) || ''));
}

function comprimirRespostas(req, res, next) {
  if (!aceitaGzip(req)) return next();
  const enviar = res.send.bind(res);
  res.send = function (corpo) {
    // Objeto: o Express chama res.json, que volta aqui já como texto.
    if (res.getHeader('Content-Encoding') || (typeof corpo !== 'string' && !Buffer.isBuffer(corpo))) return enviar(corpo);
    if (typeof corpo === 'string' && !res.getHeader('Content-Type')) res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const tipo = String(res.getHeader('Content-Type') || '');
    const bytes = Buffer.isBuffer(corpo) ? corpo : Buffer.from(corpo, 'utf8');
    if (bytes.length < MINIMO_BYTES || !TIPOS_COMPRIMIVEIS.test(tipo) || req.method === 'HEAD'
      || res.statusCode === 204 || res.statusCode === 304) return enviar(corpo);
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    res.removeHeader('Content-Length');
    return enviar(zlib.gzipSync(bytes, { level: 6 }));
  };
  next();
}

function estaticosComprimidos(pasta) {
  const raiz = path.resolve(pasta);
  const guardados = new Map(); // caminho -> { mtimeMs, tamanho, gz, etag }
  return (req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || !aceitaGzip(req)) return next();
    let rel;
    try { rel = decodeURIComponent(req.path); } catch (e) { return next(); }
    if (rel.endsWith('/')) rel += 'index.html';
    const tipo = TIPOS_ESTATICOS[path.extname(rel).toLowerCase()];
    if (!tipo) return next();
    const arquivo = path.resolve(raiz, '.' + rel);
    if (!arquivo.startsWith(raiz + path.sep)) return next();
    let st;
    try { st = fs.statSync(arquivo); } catch (e) { return next(); }
    if (!st.isFile()) return next();
    let item = guardados.get(arquivo);
    if (!item || item.mtimeMs !== st.mtimeMs || item.tamanho !== st.size) {
      item = {
        mtimeMs: st.mtimeMs, tamanho: st.size,
        gz: zlib.gzipSync(fs.readFileSync(arquivo), { level: 9 }),
        etag: `W/"gz-${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`
      };
      guardados.set(arquivo, item);
    }
    res.setHeader('Content-Type', tipo);
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('ETag', item.etag);
    res.setHeader('Last-Modified', st.mtime.toUTCString());
    res.setHeader('Cache-Control', 'public, max-age=0');
    if (req.headers['if-none-match'] === item.etag) { res.statusCode = 304; return res.end(); }
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Content-Length', item.gz.length);
    if (req.method === 'HEAD') return res.end();
    res.end(item.gz);
  };
}

module.exports = { comprimirRespostas, estaticosComprimidos, aceitaGzip };
