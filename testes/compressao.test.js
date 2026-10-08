/* ===================================================================
   testes/compressao.test.js

   Compressão gzip das respostas (02/10/2026): a API e os arquivos da
   página saem comprimidos para quem aceita gzip, voltam idênticos ao
   descomprimir, e o que não deve ser comprimido passa como está.
=================================================================== */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const express = require('express');
const { comprimirRespostas, estaticosComprimidos } = require('../integrations/compressao');

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'compressao-'));
const JS = 'function ola(){ return "olá"; }\n'.repeat(200);
fs.writeFileSync(path.join(pasta, 'app.js'), JS);
fs.writeFileSync(path.join(pasta, 'index.html'), '<!doctype html><p>Central</p>'.repeat(100));
fs.writeFileSync(path.join(pasta, 'logo.png'), Buffer.alloc(2000, 1));
const GRANDE = { itens: Array.from({ length: 200 }, (_, i) => ({ id: i, nome: `Contrato ${i}/2026` })) };

let servidor, porta;
before(async () => {
  const app = express();
  app.use(comprimirRespostas);
  app.get('/api/grande', (req, res) => res.json(GRANDE));
  app.get('/api/pequeno', (req, res) => res.json({ ok: true }));
  app.get('/api/vazio', (req, res) => res.status(204).end());
  app.use(estaticosComprimidos(pasta));
  app.use(express.static(pasta));
  servidor = app.listen(0);
  await new Promise(r => servidor.once('listening', r));
  porta = servidor.address().port;
});
after(() => { servidor.close(); fs.rmSync(pasta, { recursive: true, force: true }); });

function pedir(caminho, cabecalhos = {}) {
  return new Promise((ok, erro) => {
    http.get({ host: '127.0.0.1', port: porta, path: caminho, headers: cabecalhos }, res => {
      const partes = [];
      res.on('data', p => partes.push(p));
      res.on('end', () => ok({ status: res.statusCode, h: res.headers, corpo: Buffer.concat(partes) }));
    }).on('error', erro);
  });
}
const GZIP = { 'accept-encoding': 'gzip, deflate, br' };

test('JSON grande sai em gzip e volta idêntico', async () => {
  const r = await pedir('/api/grande', GZIP);
  assert.strictEqual(r.h['content-encoding'], 'gzip');
  assert.match(r.h['content-type'], /json/);
  assert.match(r.h.vary, /Accept-Encoding/);
  assert.deepStrictEqual(JSON.parse(zlib.gunzipSync(r.corpo)), GRANDE);
  assert.ok(r.corpo.length < JSON.stringify(GRANDE).length / 2);
});

test('sem gzip no pedido, resposta sem compressão', async () => {
  const r = await pedir('/api/grande');
  assert.strictEqual(r.h['content-encoding'], undefined);
  assert.deepStrictEqual(JSON.parse(r.corpo), GRANDE);
});

test('resposta pequena e 204 passam como estão', async () => {
  const p = await pedir('/api/pequeno', GZIP);
  assert.strictEqual(p.h['content-encoding'], undefined);
  assert.deepStrictEqual(JSON.parse(p.corpo), { ok: true });
  const v = await pedir('/api/vazio', GZIP);
  assert.strictEqual(v.status, 204);
});

test('arquivo da página em gzip, com ETag e 304 quando não mudou', async () => {
  const r = await pedir('/app.js', GZIP);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.h['content-encoding'], 'gzip');
  assert.match(r.h['content-type'], /javascript/);
  assert.strictEqual(zlib.gunzipSync(r.corpo).toString('utf8'), JS);
  const de_novo = await pedir('/app.js', { ...GZIP, 'if-none-match': r.h.etag });
  assert.strictEqual(de_novo.status, 304);
  assert.strictEqual(de_novo.corpo.length, 0);
});

test('"/" entrega o index.html comprimido', async () => {
  const r = await pedir('/', GZIP);
  assert.strictEqual(r.h['content-encoding'], 'gzip');
  assert.match(zlib.gunzipSync(r.corpo).toString('utf8'), /<p>Central<\/p>/);
});

test('arquivo mudou no disco: entrega o novo', async () => {
  const antes = await pedir('/index.html', GZIP);
  const novo = '<!doctype html><p>Nova versão</p>'.repeat(100);
  fs.writeFileSync(path.join(pasta, 'index.html'), novo);
  const t = new Date(Date.now() + 5000); fs.utimesSync(path.join(pasta, 'index.html'), t, t);
  const depois = await pedir('/index.html', GZIP);
  assert.notStrictEqual(depois.h.etag, antes.h.etag);
  assert.strictEqual(zlib.gunzipSync(depois.corpo).toString('utf8'), novo);
});

test('outros tipos e caminho para fora da pasta seguem para o express.static', async () => {
  const png = await pedir('/logo.png', GZIP);
  assert.strictEqual(png.status, 200);
  assert.strictEqual(png.h['content-encoding'], undefined);
  const fora = await pedir('/..%2f..%2fsegredo.js', GZIP);
  assert.notStrictEqual(fora.h['content-encoding'], 'gzip');
  assert.notStrictEqual(fora.status, 200);
});
