/* ===================================================================
   integrations/seguranca.js

   Proteções HTTP do servidor (24/09/2026), sem pacote novo:

     1. Cabeçalhos de segurança em toda resposta: política de conteúdo
        (CSP) — a página só carrega o que vem do próprio servidor —, sem
        embutir o sistema em moldura de outro site (clickjacking), sem
        "adivinhar" tipo de arquivo, sem enviar o endereço de origem para
        fora e sem acesso a câmera, microfone e localização.
     2. Respostas da API sem cache no navegador: dado de contrato (com
        nomes de servidores) não fica gravado no disco do computador.
     3. Origem conferida nas requisições que alteram dados (POST, PUT,
        DELETE): uma página de outro site não consegue agir em nome de
        quem está logado (CSRF). Reforça o cookie SameSite=Lax.
     4. Limite de tentativas de login: 5 senhas erradas para o mesmo
        usuário (ou 20 do mesmo computador) bloqueiam novas tentativas por
        15 minutos — impede testar senhas em sequência.

   A CSP permite script e estilo "inline" porque a interface usa
   atributos onclick e estilos inline (style="..."); todo o resto
   (outros domínios, plugins, formulários para fora) fica bloqueado.
=================================================================== */

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');

function cabecalhosDeSeguranca(req, res, next) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  // HTTPS: só quando o servidor estiver atrás de um proxy com certificado.
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  next();
}

function semCache(req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
}

const METODOS_QUE_ALTERAM = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/* O navegador sempre manda "Origin" num POST vindo de página. Se vier e
   não for a deste servidor, é outro site tentando agir em nome do
   usuário. Sem Origin (ferramenta de linha de comando, teste) passa: aí
   não há sessão de navegador para sequestrar. */
/* No servidor, atrás de proxy (IIS/nginx), o "Host" que chega aqui pode
   ser o interno ("localhost:3001") e não o que o navegador usou
   ("https://central.itaverde.gov.br"): sem isto, todo POST seria
   recusado. Valem também o X-Forwarded-Host (só com CONFIAR_PROXY=1) e
   os endereços de ORIGENS_PERMITIDAS no .env (30/09/2026). */
function verificarOrigem(origensPermitidas = []) {
  const permitidas = new Set(origensPermitidas.map(o => String(o).replace(/\/+$/, '').toLowerCase()));
  return function (req, res, next) {
    if (!METODOS_QUE_ALTERAM.has(req.method)) return next();
    const origem = req.get('origin');
    if (!origem) return next();
    let url;
    try { url = new URL(origem); } catch (e) { url = null; }
    if (url) {
      if (url.host === req.get('host')) return next();
      const encaminhado = req.app && req.app.get('trust proxy') ? String(req.get('x-forwarded-host') || '').split(',')[0].trim() : '';
      if (encaminhado && url.host === encaminhado) return next();
      if (permitidas.has(url.origin.toLowerCase())) return next();
    }
    return res.status(403).json({ error: 'Requisição de outra origem recusada.' });
  };
}

/* ------------------------------------------------------------------
   Limite de tentativas de login (em memória: zera se o servidor
   reiniciar — suficiente contra teste de senhas em sequência).
------------------------------------------------------------------ */
const JANELA_MS = 15 * 60 * 1000;
const MAX_POR_USUARIO = 5;
const MAX_POR_ORIGEM = 20;
const falhas = new Map(); // chave -> { vezes, desde, bloqueadoAte }

function registro(chave, agora) {
  let r = falhas.get(chave);
  if (!r || agora - r.desde > JANELA_MS) { r = { vezes: 0, desde: agora, bloqueadoAte: 0 }; falhas.set(chave, r); }
  return r;
}

function chaves(ip, usuario) {
  return [`u:${ip}|${String(usuario || '').trim().toLowerCase()}`, `ip:${ip}`];
}

/* Minutos que faltam para liberar, ou 0 se pode tentar. */
function loginBloqueado(ip, usuario, agora = Date.now()) {
  let espera = 0;
  for (const k of chaves(ip, usuario)) {
    const r = falhas.get(k);
    if (r && r.bloqueadoAte > agora) espera = Math.max(espera, r.bloqueadoAte - agora);
  }
  return espera ? Math.ceil(espera / 60000) : 0;
}

function registrarFalhaDeLogin(ip, usuario, agora = Date.now()) {
  const [kUsuario, kIp] = chaves(ip, usuario);
  const ru = registro(kUsuario, agora);
  const ri = registro(kIp, agora);
  ru.vezes++; ri.vezes++;
  if (ru.vezes >= MAX_POR_USUARIO) ru.bloqueadoAte = agora + JANELA_MS;
  if (ri.vezes >= MAX_POR_ORIGEM) ri.bloqueadoAte = agora + JANELA_MS;
  return ru.bloqueadoAte > agora || ri.bloqueadoAte > agora;
}

function limparFalhasDeLogin(ip, usuario) {
  falhas.delete(chaves(ip, usuario)[0]);
}

// Limpeza periódica, para o mapa não crescer.
setInterval(() => {
  const agora = Date.now();
  for (const [k, r] of falhas) if (agora - r.desde > JANELA_MS && r.bloqueadoAte < agora) falhas.delete(k);
}, JANELA_MS).unref();

module.exports = {
  cabecalhosDeSeguranca, semCache, verificarOrigem,
  loginBloqueado, registrarFalhaDeLogin, limparFalhasDeLogin,
  _paraTeste: { CSP, falhas, MAX_POR_USUARIO, MAX_POR_ORIGEM }
};
