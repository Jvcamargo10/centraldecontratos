/* ===================================================================
   testes/seguranca.test.js

   Proteções HTTP (24/09/2026): cabeçalhos, origem das requisições que
   alteram dados e limite de tentativas de login.
=================================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const seg = require('../integrations/seguranca');

function resFalsa() {
  const h = {};
  return { h, statusCode: 200, corpo: null,
    setHeader(k, v) { h[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.corpo = b; return this; } };
}
const reqFalsa = (metodo, headers = {}) => ({ method: metodo, secure: false, get: k => headers[k.toLowerCase()] });

test('cabeçalhos de segurança em toda resposta', () => {
  const res = resFalsa(); let seguiu = false;
  seg.cabecalhosDeSeguranca(reqFalsa('GET'), res, () => { seguiu = true; });
  assert.ok(seguiu);
  assert.match(res.h['content-security-policy'], /default-src 'self'/);
  assert.match(res.h['content-security-policy'], /frame-ancestors 'none'/);
  assert.match(res.h['content-security-policy'], /object-src 'none'/);
  assert.strictEqual(res.h['x-frame-options'], 'DENY');
  assert.strictEqual(res.h['x-content-type-options'], 'nosniff');
  assert.strictEqual(res.h['referrer-policy'], 'no-referrer');
  assert.strictEqual(res.h['strict-transport-security'], undefined, 'HSTS só com HTTPS');
});

test('API sem cache no navegador', () => {
  const res = resFalsa();
  seg.semCache(reqFalsa('GET'), res, () => {});
  assert.strictEqual(res.h['cache-control'], 'no-store');
});

test('POST de outro site é recusado; do próprio servidor ou sem Origin, passa', () => {
  const passa = (metodo, headers) => { let ok = false; const res = resFalsa(); seg.verificarOrigem()(reqFalsa(metodo, headers), res, () => { ok = true; }); return ok ? 'passou' : res.statusCode; };
  assert.strictEqual(passa('POST', { origin: 'https://site-malicioso.example', host: 'localhost:3001' }), 403);
  assert.strictEqual(passa('DELETE', { origin: 'http://localhost:3001', host: 'localhost:3001' }), 'passou');
  assert.strictEqual(passa('POST', { host: 'localhost:3001' }), 'passou', 'sem Origin: não é navegador');
  assert.strictEqual(passa('GET', { origin: 'https://site-malicioso.example', host: 'localhost:3001' }), 'passou', 'leitura não altera nada');
});

test('servidor atrás de proxy: vale o endereço do .env e o X-Forwarded-Host (só com CONFIAR_PROXY)', () => {
  const com = (origens, confiaProxy, headers) => {
    let ok = false; const res = resFalsa();
    const req = { ...reqFalsa('POST', headers), app: { get: k => (k === 'trust proxy' ? confiaProxy : undefined) } };
    seg.verificarOrigem(origens)(req, res, () => { ok = true; });
    return ok ? 'passou' : res.statusCode;
  };
  const doProxy = { origin: 'https://central.itaverde.gov.br', host: 'localhost:3001' };
  assert.strictEqual(com([], false, doProxy), 403, 'sem configuração: o Host interno não bate');
  assert.strictEqual(com(['https://central.itaverde.gov.br/'], false, doProxy), 'passou', 'ORIGENS_PERMITIDAS');
  assert.strictEqual(com([], 1, { ...doProxy, 'x-forwarded-host': 'central.itaverde.gov.br' }), 'passou', 'X-Forwarded-Host com proxy confiável');
  assert.strictEqual(com([], false, { ...doProxy, 'x-forwarded-host': 'central.itaverde.gov.br' }), 403, 'X-Forwarded-Host sem CONFIAR_PROXY não vale (qualquer um manda)');
  assert.strictEqual(com(['https://central.itaverde.gov.br'], 1, { origin: 'https://site-malicioso.example', host: 'localhost:3001' }), 403);
});

test('5 senhas erradas para o mesmo usuário bloqueiam por 15 minutos; acerto limpa', () => {
  const ip = '10.0.0.5', agora = Date.now();
  for (let i = 1; i < seg._paraTeste.MAX_POR_USUARIO; i++) {
    assert.strictEqual(seg.registrarFalhaDeLogin(ip, 'fulano', agora), false);
    assert.strictEqual(seg.loginBloqueado(ip, 'fulano', agora), 0);
  }
  assert.strictEqual(seg.registrarFalhaDeLogin(ip, 'FULANO', agora), true, 'maiúsculas contam como o mesmo usuário');
  assert.strictEqual(seg.loginBloqueado(ip, 'fulano', agora), 15);
  assert.strictEqual(seg.loginBloqueado(ip, 'fulano', agora + 15 * 60 * 1000 + 1), 0, 'libera depois de 15 minutos');
  assert.strictEqual(seg.loginBloqueado(ip, 'outra-pessoa', agora), 0, 'outro usuário no mesmo computador segue podendo');
  seg.limparFalhasDeLogin(ip, 'fulano');
  assert.strictEqual(seg.loginBloqueado(ip, 'fulano', agora), 0);
});

test('20 erros do mesmo computador, trocando de usuário, também bloqueiam', () => {
  const ip = '10.0.0.9', agora = Date.now();
  for (let i = 0; i < seg._paraTeste.MAX_POR_ORIGEM; i++) seg.registrarFalhaDeLogin(ip, `usuario-${i}`, agora);
  assert.ok(seg.loginBloqueado(ip, 'qualquer-um', agora) > 0);
});
