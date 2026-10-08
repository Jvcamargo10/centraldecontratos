/* ===================================================================
   integrations/loginEntra.js

   Login com a conta da Prefeitura — Microsoft Entra ID, o antigo Azure
   AD, o mesmo do SGC, do Outlook e do Teams (06/10/2026). Sem pacote novo:
   só fetch e crypto do Node.

   Como funciona (OpenID Connect, "código de autorização" com PKCE):
     1. /auth/entra/entrar manda o navegador para a tela da Microsoft,
        com um "state" e um "nonce" aleatórios guardados na sessão.
     2. A Microsoft devolve para /auth/entra/retorno com um código; o
        servidor troca o código pelo id_token direto com a Microsoft.
     3. O id_token é conferido aqui: assinatura (chaves públicas da
        Microsoft), emissor, tenant da Prefeitura, aplicativo, validade e
        nonce. Só então vale quem a pessoa diz ser.

   O AD diz QUEM é a pessoa; o QUE ela pode fazer continua nas Contas de
   acesso da Central (papel admin/gestor/fiscal/consulta). A conta é
   ligada pelo e-mail da Prefeitura (ou pelo usuário igual ao e-mail ou ao
   que vem antes do @) e, no primeiro login, fica presa ao identificador
   fixo da pessoa no AD (oid) — trocar o e-mail depois não desliga.

   Sem cadastro na Central:
     ENTRA_SEM_CADASTRO=bloquear (padrão) — não entra; o pedido aparece em
       Contas de acesso para um admin liberar com um clique.
     ENTRA_SEM_CADASTRO=consulta — entra só para consulta (conta criada
       sozinha, papel "consulta").

   Contas locais (usuário e senha) continuam funcionando: servem de
   acesso de emergência se a Microsoft ou a internet estiverem fora.
=================================================================== */
const crypto = require('crypto');

const AUTORIDADE_PADRAO = 'https://login.microsoftonline.com';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALIDADE_DO_PEDIDO_MS = 10 * 60 * 1000; // ida e volta na tela da Microsoft
const FOLGA_DO_RELOGIO_S = 5 * 60;
const MAX_PEDIDOS = 50;

function configEntra(env = process.env) {
  const tenant = String(env.ENTRA_TENANT_ID || '').trim();
  const clientId = String(env.ENTRA_CLIENT_ID || '').trim();
  const problemas = [];
  if (tenant && !GUID.test(tenant)) problemas.push('ENTRA_TENANT_ID precisa ser o ID (GUID) do tenant da Prefeitura.');
  if (clientId && !GUID.test(clientId)) problemas.push('ENTRA_CLIENT_ID precisa ser o ID (GUID) do aplicativo.');
  const semCadastro = String(env.ENTRA_SEM_CADASTRO || 'bloquear').trim().toLowerCase() === 'consulta' ? 'consulta' : 'bloquear';
  return {
    ligado: !!(tenant && clientId) && !problemas.length,
    problemas,
    tenant, clientId,
    clientSecret: String(env.ENTRA_CLIENT_SECRET || '').trim(),
    redirectUri: String(env.ENTRA_REDIRECT_URI || '').trim(),
    autoridade: String(env.ENTRA_AUTORIDADE || AUTORIDADE_PADRAO).replace(/\/+$/, ''),
    semCadastro
  };
}

const b64url = buf => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const aleatorio = () => b64url(crypto.randomBytes(32));
const desafioPkce = verificador => b64url(crypto.createHash('sha256').update(verificador).digest());

function urlDeEntrada(cfg, { state, nonce, desafio, redirectUri }) {
  const p = new URLSearchParams({
    client_id: cfg.clientId, response_type: 'code', redirect_uri: redirectUri, response_mode: 'query',
    scope: 'openid profile email', state, nonce, code_challenge: desafio, code_challenge_method: 'S256'
  });
  return `${cfg.autoridade}/${cfg.tenant}/oauth2/v2.0/authorize?${p}`;
}

async function trocarCodigo(cfg, { code, verificador, redirectUri }, fetchFn) {
  const corpo = new URLSearchParams({
    client_id: cfg.clientId, grant_type: 'authorization_code', code, redirect_uri: redirectUri,
    code_verifier: verificador, scope: 'openid profile email'
  });
  if (cfg.clientSecret) corpo.set('client_secret', cfg.clientSecret);
  const r = await fetchFn(`${cfg.autoridade}/${cfg.tenant}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: corpo.toString()
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id_token) throw new Error(`a Microsoft recusou o código (${j.error || r.status}${j.error_description ? ': ' + String(j.error_description).split('\n')[0].slice(0, 160) : ''})`);
  return j.id_token;
}

/* Chaves públicas da Microsoft, guardadas por 12 h; chave nova (kid
   desconhecido) força buscar de novo — a Microsoft troca as chaves. */
function cacheDeChaves(cfg, fetchFn) {
  let chaves = null, buscadoEm = 0;
  async function buscar() {
    const r = await fetchFn(`${cfg.autoridade}/${cfg.tenant}/discovery/v2.0/keys`);
    if (!r.ok) throw new Error(`não consegui buscar as chaves da Microsoft (${r.status})`);
    chaves = ((await r.json()).keys || []); buscadoEm = Date.now();
    return chaves;
  }
  return async function chavePara(kid) {
    if (!chaves || Date.now() - buscadoEm > 12 * 3600 * 1000) await buscar();
    let k = chaves.find(c => c.kid === kid);
    if (!k && Date.now() - buscadoEm > 60 * 1000) { await buscar(); k = chaves.find(c => c.kid === kid); }
    return k || null;
  };
}

function lerJwt(token) {
  const partes = String(token || '').split('.');
  if (partes.length !== 3) throw new Error('token malformado');
  const json = p => JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  return { cabecalho: json(partes[0]), dados: json(partes[1]), assinado: `${partes[0]}.${partes[1]}`, assinatura: Buffer.from(partes[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64') };
}

async function validarIdToken(token, { cfg, nonce, chavePara, agora = Date.now() }) {
  const t = lerJwt(token);
  if (t.cabecalho.alg !== 'RS256') throw new Error(`algoritmo não aceito (${t.cabecalho.alg})`);
  const jwk = await chavePara(t.cabecalho.kid);
  if (!jwk) throw new Error('chave de assinatura desconhecida');
  const chave = crypto.createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: 'jwk' });
  if (!crypto.verify('RSA-SHA256', Buffer.from(t.assinado), chave, t.assinatura)) throw new Error('assinatura inválida');
  const d = t.dados, s = Math.floor(agora / 1000);
  if (String(d.iss || '').toLowerCase() !== `${cfg.autoridade}/${cfg.tenant}/v2.0`.toLowerCase()) throw new Error('emissor diferente do tenant da Prefeitura');
  if (String(d.tid || '').toLowerCase() !== cfg.tenant.toLowerCase()) throw new Error('conta de outro tenant');
  if (d.aud !== cfg.clientId) throw new Error('token de outro aplicativo');
  if (typeof d.exp !== 'number' || d.exp + FOLGA_DO_RELOGIO_S < s) throw new Error('token vencido');
  if (typeof d.nbf === 'number' && d.nbf - FOLGA_DO_RELOGIO_S > s) throw new Error('token ainda não vale');
  if (!nonce || d.nonce !== nonce) throw new Error('nonce não confere');
  if (!d.oid) throw new Error('token sem identificador da pessoa (oid)');
  return d;
}

/* Quem é a pessoa, em formato simples. */
function pessoaDoToken(d) {
  const email = String(d.preferred_username || d.email || d.upn || '').trim().toLowerCase();
  return { oid: d.oid, email, nome: String(d.name || email || 'Conta da Prefeitura').trim() };
}

/* Conta da Central dessa pessoa: pelo oid (já ligada), senão pelo e-mail,
   senão pelo usuário igual ao e-mail ou ao que vem antes do @. */
function acharConta(contas, pessoa) {
  const lista = contas || [];
  const porOid = lista.find(u => u.entraOid && u.entraOid === pessoa.oid);
  if (porOid) return porOid;
  if (!pessoa.email) return null;
  const local = pessoa.email.split('@')[0];
  const livre = u => !u.entraOid; // conta já presa a OUTRA pessoa do AD não é reaproveitada
  return lista.find(u => livre(u) && u.email && String(u.email).toLowerCase() === pessoa.email)
    || lista.find(u => livre(u) && [pessoa.email, local].includes(String(u.usuario || '').toLowerCase()))
    || null;
}

function registrarPedido(db, pessoa) {
  db.pedidosDeAcesso = (db.pedidosDeAcesso || []).filter(p => p.oid !== pessoa.oid);
  db.pedidosDeAcesso.unshift({ oid: pessoa.oid, email: pessoa.email, nome: pessoa.nome, em: new Date().toISOString() });
  if (db.pedidosDeAcesso.length > MAX_PEDIDOS) db.pedidosDeAcesso.length = MAX_PEDIDOS;
}

function urlDeRetorno(cfg, req) {
  return cfg.redirectUri || `${req.protocol}://${req.get('host')}/auth/entra/retorno`;
}

/* Rotas /auth/entra/entrar e /auth/entra/retorno. Erro volta para a tela
   de login com um código (?login=...), nunca com texto vindo de fora. */
function montarRotas({ express, cfg, db, save, nextId, registrarAuditoria, fetchFn = fetch }) {
  const rotas = express.Router();
  const chavePara = cacheDeChaves(cfg, fetchFn);
  const voltar = (res, codigo) => res.redirect(303, `/?login=${encodeURIComponent(codigo)}`);

  rotas.get('/auth/entra/entrar', (req, res) => {
    if (!cfg.ligado) return voltar(res, 'desligado');
    const verificador = aleatorio();
    const pedido = { state: aleatorio(), nonce: aleatorio(), verificador, redirectUri: urlDeRetorno(cfg, req), em: Date.now() };
    req.session.entra = pedido;
    req.session.save(() => res.redirect(302, urlDeEntrada(cfg, { ...pedido, desafio: desafioPkce(verificador) })));
  });

  rotas.get('/auth/entra/retorno', async (req, res) => {
    if (!cfg.ligado) return voltar(res, 'desligado');
    const pedido = req.session && req.session.entra;
    if (req.session) delete req.session.entra; // vale uma vez só
    if (req.query.error) return voltar(res, req.query.error === 'access_denied' ? 'cancelado' : 'falhou');
    if (!pedido || !req.query.state || req.query.state !== pedido.state || Date.now() - pedido.em > VALIDADE_DO_PEDIDO_MS) return voltar(res, 'expirou');
    let pessoa;
    try {
      const idToken = await trocarCodigo(cfg, { code: String(req.query.code || ''), verificador: pedido.verificador, redirectUri: pedido.redirectUri }, fetchFn);
      pessoa = pessoaDoToken(await validarIdToken(idToken, { cfg, nonce: pedido.nonce, chavePara }));
    } catch (e) {
      console.error('Login com a conta da Prefeitura falhou:', e.message);
      registrarAuditoria({ __usuarioNome: '(conta da Prefeitura)', __usuarioRole: '-' }, 'login-falhou', 'sessao', null, `Login pelo AD não confirmado: ${e.message}.`);
      save();
      return voltar(res, 'falhou');
    }
    let conta = acharConta(db.authUsers, pessoa);
    if (!conta && cfg.semCadastro === 'consulta') {
      conta = { id: nextId(db.authUsers), usuario: pessoa.email || pessoa.oid, nome: pessoa.nome, email: pessoa.email, role: 'consulta', criadaPeloAd: true };
      db.authUsers.push(conta);
      registrarAuditoria({ __usuarioNome: pessoa.nome, __usuarioRole: 'consulta' }, 'criar', 'conta', conta.id, `Conta criada no primeiro login pelo AD (${pessoa.email}), papel consulta.`);
    }
    if (!conta) {
      registrarPedido(db, pessoa);
      registrarAuditoria({ __usuarioNome: pessoa.nome, __usuarioRole: '-' }, 'login-falhou', 'sessao', null, `Conta da Prefeitura ${pessoa.email} sem cadastro na Central — pedido de acesso registrado.`);
      save();
      return voltar(res, 'sem-acesso');
    }
    if (!conta.entraOid) conta.entraOid = pessoa.oid;
    if (!conta.email && pessoa.email) conta.email = pessoa.email;
    db.pedidosDeAcesso = (db.pedidosDeAcesso || []).filter(p => p.oid !== pessoa.oid);
    // Sessão NOVA a cada login, como no login por senha.
    req.session.regenerate(err => {
      if (err) return voltar(res, 'falhou');
      req.session.userId = conta.id;
      req.session.via = 'entra';
      registrarAuditoria({ __usuarioNome: conta.nome, __usuarioRole: conta.role }, 'login', 'sessao', conta.id, `Entrada de "${conta.usuario}" pela conta da Prefeitura (${pessoa.email}).`);
      save();
      req.session.save(() => res.redirect(303, '/'));
    });
  });
  return rotas;
}

module.exports = { configEntra, urlDeEntrada, desafioPkce, validarIdToken, cacheDeChaves, pessoaDoToken, acharConta, registrarPedido, montarRotas, AUTORIDADE_PADRAO };
