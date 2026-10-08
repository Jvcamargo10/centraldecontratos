/* ===================================================================
   testes/loginEntra.test.js

   Login com a conta da Prefeitura (Entra ID / Azure AD), 06/10/2026.
   A "Microsoft" aqui é falsa: chaves RSA geradas no teste assinam o
   id_token, e um fetch falso faz o papel dos endereços da Microsoft. O
   que se protege: só entra token assinado pela Microsoft, do tenant da
   Prefeitura, para este aplicativo, dentro da validade e com o nonce
   desta tentativa; e quem não tem conta na Central não entra (ou entra só
   para consulta, se o .env pedir).
=================================================================== */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const session = require('express-session');
const E = require('../integrations/loginEntra');

const TENANT = '11111111-2222-4333-8444-555555555555';
const CLIENTE = '11111111-2222-3333-4444-555555555555';
const AUT = 'https://login.exemplo.test';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const outro = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = { ...publicKey.export({ format: 'jwk' }), kid: 'chave-1', use: 'sig' };

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
function assinar(dados, { chave = privateKey, kid = 'chave-1', alg = 'RS256' } = {}) {
  const corpo = `${b64({ alg, kid, typ: 'JWT' })}.${b64(dados)}`;
  return `${corpo}.${crypto.sign('RSA-SHA256', Buffer.from(corpo), chave).toString('base64url')}`;
}
const agoraS = () => Math.floor(Date.now() / 1000);
const dadosBons = (extra = {}) => ({
  iss: `${AUT}/${TENANT}/v2.0`, tid: TENANT, aud: CLIENTE, exp: agoraS() + 3600, nbf: agoraS() - 10,
  nonce: 'n-1', oid: 'oid-ana', preferred_username: 'Ana.Souza@itaverde.gov.br', name: 'Ana Souza', ...extra
});
const cfg = E.configEntra({ ENTRA_TENANT_ID: TENANT, ENTRA_CLIENT_ID: CLIENTE, ENTRA_CLIENT_SECRET: 'segredo', ENTRA_AUTORIDADE: AUT });
const chavePara = async kid => (kid === 'chave-1' ? JWK : null);

test('configuração: liga só com tenant e aplicativo válidos; padrão é bloquear quem não tem conta', () => {
  assert.strictEqual(E.configEntra({}).ligado, false);
  assert.strictEqual(E.configEntra({ ENTRA_TENANT_ID: 'itaverde', ENTRA_CLIENT_ID: CLIENTE }).ligado, false);
  assert.strictEqual(cfg.ligado, true);
  assert.strictEqual(cfg.semCadastro, 'bloquear');
  assert.strictEqual(E.configEntra({ ENTRA_SEM_CADASTRO: 'Consulta' }).semCadastro, 'consulta');
  assert.strictEqual(E.configEntra({}).autoridade, 'https://login.microsoftonline.com');
});

test('id_token válido é aceito', async () => {
  const d = await E.validarIdToken(assinar(dadosBons()), { cfg, nonce: 'n-1', chavePara });
  assert.deepStrictEqual(E.pessoaDoToken(d), { oid: 'oid-ana', email: 'ana.souza@itaverde.gov.br', nome: 'Ana Souza' });
});

test('id_token recusado: assinatura de outra chave, outro tenant, outro aplicativo, vencido, nonce de outra tentativa, chave desconhecida, alg trocado', async () => {
  const recusa = async (token, nonce = 'n-1', msg) => assert.rejects(E.validarIdToken(token, { cfg, nonce, chavePara }), msg);
  await recusa(assinar(dadosBons(), { chave: outro.privateKey }), 'n-1', /assinatura/);
  await recusa(assinar(dadosBons({ tid: '99999999-2222-3333-4444-555555555555' })), 'n-1', /tenant/);
  await recusa(assinar(dadosBons({ iss: `${AUT}/99999999-2222-3333-4444-555555555555/v2.0` })), 'n-1', /emissor/);
  await recusa(assinar(dadosBons({ aud: 'outro-app' })), 'n-1', /aplicativo/);
  await recusa(assinar(dadosBons({ exp: agoraS() - 3600 })), 'n-1', /vencido/);
  await recusa(assinar(dadosBons()), 'n-2', /nonce/);
  await recusa(assinar(dadosBons(), { kid: 'chave-x' }), 'n-1', /desconhecida/);
  await recusa(assinar(dadosBons(), { alg: 'none' }), 'n-1', /algoritmo/);
  await recusa('nao.e.token', 'n-1');
});

test('conta da Central: pelo oid, pelo e-mail, pelo usuário igual ao e-mail ou ao nome antes do @', () => {
  const pessoa = { oid: 'oid-ana', email: 'ana.souza@itaverde.gov.br', nome: 'Ana' };
  assert.strictEqual(E.acharConta([{ id: 1, usuario: 'x', entraOid: 'oid-ana' }], pessoa).id, 1);
  assert.strictEqual(E.acharConta([{ id: 2, usuario: 'x', email: 'Ana.Souza@itaverde.gov.br' }], pessoa).id, 2);
  assert.strictEqual(E.acharConta([{ id: 3, usuario: 'ana.souza' }], pessoa).id, 3);
  assert.strictEqual(E.acharConta([{ id: 4, usuario: 'ana.souza@itaverde.gov.br' }], pessoa).id, 4);
  assert.strictEqual(E.acharConta([{ id: 5, usuario: 'admin' }], pessoa), null);
  // conta já ligada a OUTRA pessoa do AD não é reaproveitada pelo e-mail
  assert.strictEqual(E.acharConta([{ id: 6, usuario: 'ana.souza', entraOid: 'oid-outra' }], pessoa), null);
});

/* ---------- Fluxo completo com a "Microsoft" falsa ---------- */
let servidor, porta, db, modo = 'bloquear', tokenDaVez = null, ultimoCorpoToken = null;
function montar(semCadastro) {
  db = { authUsers: [{ id: 1, usuario: 'admin', nome: 'Admin', role: 'admin', senhaHash: 'x' }, { id: 2, usuario: 'carlos', nome: 'Carlos', role: 'gestor', email: 'carlos@itaverde.gov.br' }], auditoria: [] };
  const c = E.configEntra({ ENTRA_TENANT_ID: TENANT, ENTRA_CLIENT_ID: CLIENTE, ENTRA_CLIENT_SECRET: 'segredo', ENTRA_AUTORIDADE: AUT, ENTRA_REDIRECT_URI: 'http://localhost/auth/entra/retorno', ENTRA_SEM_CADASTRO: semCadastro });
  const fetchFalso = async (url, op = {}) => {
    if (url === `${AUT}/${TENANT}/discovery/v2.0/keys`) return new Response(JSON.stringify({ keys: [JWK] }));
    if (url === `${AUT}/${TENANT}/oauth2/v2.0/token`) {
      ultimoCorpoToken = new URLSearchParams(op.body);
      return new Response(JSON.stringify({ id_token: tokenDaVez(ultimoCorpoToken) }));
    }
    return new Response('{}', { status: 404 });
  };
  const app = express();
  app.use(session({ secret: 'teste', resave: false, saveUninitialized: false }));
  app.use(E.montarRotas({ express, cfg: c, db, save: () => {}, nextId: l => l.reduce((m, x) => Math.max(m, x.id), 0) + 1,
    registrarAuditoria: (r, acao, ent, id, det) => db.auditoria.push({ acao, det }), fetchFn: fetchFalso }));
  app.get('/eu', (req, res) => res.json({ userId: req.session.userId || null, via: req.session.via || null }));
  return app;
}
function pedir(caminho, cookie) {
  return new Promise((ok, erro) => {
    http.get({ host: '127.0.0.1', port: porta, path: caminho, headers: cookie ? { cookie } : {} }, r => {
      let corpo = ''; r.on('data', p => { corpo += p; });
      r.on('end', () => ok({ status: r.statusCode, local: r.headers.location, cookie: (r.headers['set-cookie'] || [])[0], corpo }));
    }).on('error', erro);
  });
}
async function iniciar(semCadastro) {
  if (servidor) servidor.close();
  servidor = montar(semCadastro).listen(0);
  await new Promise(r => servidor.once('listening', r));
  porta = servidor.address().port;
}
after(() => servidor && servidor.close());

/* Vai até a "Microsoft" e volta com um código; o token devolvido usa o nonce da ida. */
async function entrarComo(dadosExtra) {
  const ida = await pedir('/auth/entra/entrar');
  assert.strictEqual(ida.status, 302);
  const u = new URL(ida.local);
  assert.strictEqual(u.origin + u.pathname, `${AUT}/${TENANT}/oauth2/v2.0/authorize`);
  assert.strictEqual(u.searchParams.get('code_challenge_method'), 'S256');
  assert.strictEqual(u.searchParams.get('client_id'), CLIENTE);
  const cookie = ida.cookie.split(';')[0];
  tokenDaVez = corpo => {
    // PKCE: o verificador mandado na troca tem de bater com o desafio da ida.
    assert.strictEqual(E.desafioPkce(corpo.get('code_verifier')), u.searchParams.get('code_challenge'));
    assert.strictEqual(corpo.get('client_secret'), 'segredo');
    return assinar(dadosBons({ nonce: u.searchParams.get('nonce'), ...dadosExtra }));
  };
  const volta = await pedir(`/auth/entra/retorno?code=abc&state=${encodeURIComponent(u.searchParams.get('state'))}`, cookie);
  const novoCookie = volta.cookie ? volta.cookie.split(';')[0] : cookie;
  const eu = JSON.parse((await pedir('/eu', novoCookie)).corpo);
  return { volta, eu, cookie, state: u.searchParams.get('state') };
}

test('fluxo: conta cadastrada pelo e-mail entra e fica ligada ao oid', async () => {
  await iniciar('bloquear');
  const { volta, eu } = await entrarComo({ oid: 'oid-carlos', preferred_username: 'carlos@itaverde.gov.br', name: 'Carlos' });
  assert.strictEqual(volta.local, '/');
  assert.deepStrictEqual(eu, { userId: 2, via: 'entra' });
  assert.strictEqual(db.authUsers[1].entraOid, 'oid-carlos');
  assert.ok(db.auditoria.some(a => a.acao === 'login' && /conta da Prefeitura/.test(a.det)));
});

test('fluxo: sem cadastro e modo bloquear — não entra e vira pedido de acesso', async () => {
  await iniciar('bloquear');
  const { volta, eu } = await entrarComo({});
  assert.strictEqual(volta.local, '/?login=sem-acesso');
  assert.strictEqual(eu.userId, null);
  assert.strictEqual(db.pedidosDeAcesso.length, 1);
  assert.strictEqual(db.pedidosDeAcesso[0].email, 'ana.souza@itaverde.gov.br');
  assert.strictEqual(db.authUsers.length, 2);
});

test('fluxo: sem cadastro e modo consulta — entra só para consulta', async () => {
  await iniciar('consulta');
  const { volta, eu } = await entrarComo({});
  assert.strictEqual(volta.local, '/');
  const nova = db.authUsers.find(u => u.id === eu.userId);
  assert.strictEqual(nova.role, 'consulta');
  assert.strictEqual(nova.entraOid, 'oid-ana');
  assert.strictEqual(nova.senhaHash, undefined);
});

test('fluxo: retorno com state de outra tentativa, sem ida, ou repetido — recusa', async () => {
  await iniciar('bloquear');
  const ida = await pedir('/auth/entra/entrar');
  const cookie = ida.cookie.split(';')[0];
  assert.strictEqual((await pedir('/auth/entra/retorno?code=abc&state=outro', cookie)).local, '/?login=expirou');
  assert.strictEqual((await pedir('/auth/entra/retorno?code=abc&state=x')).local, '/?login=expirou');
  // o mesmo state não vale duas vezes
  const { state, cookie: c2 } = await entrarComo({ oid: 'oid-carlos', preferred_username: 'carlos@itaverde.gov.br' });
  assert.strictEqual((await pedir(`/auth/entra/retorno?code=abc&state=${state}`, c2)).local, '/?login=expirou');
});

test('fluxo: pessoa cancela na tela da Microsoft; token adulterado vira falha', async () => {
  await iniciar('bloquear');
  assert.strictEqual((await pedir('/auth/entra/retorno?error=access_denied&state=x')).local, '/?login=cancelado');
  const { volta } = await entrarComo({ aud: 'outro-app' });
  assert.strictEqual(volta.local, '/?login=falhou');
  assert.ok(db.auditoria.some(a => a.acao === 'login-falhou' && /outro aplicativo/.test(a.det)));
});
