/* ===================================================================
   integrations/configServidor.js

   Tudo o que muda quando a Central sai desta máquina e vai para um
   servidor, num lugar só (30/09/2026). Cada item vem do .env e, sem
   ele, vale o comportamento de hoje (uso local) — a troca para o
   servidor é só configuração. Ver SERVIDOR.md.

     HOST / PORT              onde o servidor escuta (hoje: 127.0.0.1:3001)
     CENTRAL_DADOS_PASTA      data.json, backups, caches, fichas e sessões
                              fora da pasta do código (atualizar o sistema
                              sem tocar nos dados)
     CONFIAR_PROXY            atrás de IIS/nginx com HTTPS: o IP de quem
                              acessa vem do proxy (limite de login por
                              pessoa, não um só para todos)
     COOKIE_SEGURO            cookie de sessão só por HTTPS
     ORIGENS_PERMITIDAS       endereços pelos quais o sistema é acessado
                              (proteção contra CSRF atrás de proxy)
     SESSION_STORE            "arquivo": a sessão sobrevive a reinício
     LOGIN_PREENCHIDO_EM_TESTE  login preenchido (só nesta máquina e só com
                              a senha padrão ainda ativa)
     PERMITIR_INICIO_INSEGURO não recomendado — ver problemasParaRede()
=================================================================== */
const path = require('path');

const RAIZ_APP = path.join(__dirname, '..');
const LOOPBACK = ['127.0.0.1', 'localhost', '::1', '[::1]'];
const ehLoopback = h => LOOPBACK.includes(String(h || '').toLowerCase());
const booleano = (v, padrao) => (v === undefined || v === '') ? padrao : ['1', 'true', 'sim', 'yes', 's'].includes(String(v).trim().toLowerCase());
const lista = v => String(v || '').split(/[;,]/).map(x => x.trim()).filter(Boolean);

function obterConfig(env = process.env) {
  const IS_PROD = env.NODE_ENV === 'production';
  const host = (env.HOST || '127.0.0.1').trim();
  const pastaDados = env.CENTRAL_DADOS_PASTA ? path.resolve(env.CENTRAL_DADOS_PASTA) : RAIZ_APP;
  return {
    IS_PROD,
    host,
    porta: Number(env.PORT) || 3001,
    soEstaMaquina: ehLoopback(host),
    confiarProxy: booleano(env.CONFIAR_PROXY, IS_PROD),
    cookieSeguro: booleano(env.COOKIE_SEGURO, IS_PROD),
    origensPermitidas: lista(env.ORIGENS_PERMITIDAS).map(o => o.replace(/\/+$/, '').toLowerCase()),
    pastaDados,
    arquivoDados: path.join(pastaDados, 'data.json'),
    pastaBackups: path.join(pastaDados, 'backups'),
    pastaFichas: path.join(pastaDados, 'fichas-cadastro'),
    pastaCacheTexto: env.CONTRATOS_CACHE_TEXTO_PASTA || path.join(pastaDados, '.texto-cache'),
    pastaCacheOcr: path.join(pastaDados, '.ocr-cache'),
    sessoes: String(env.SESSION_STORE || 'memoria').trim().toLowerCase() === 'arquivo' ? 'arquivo' : 'memoria',
    arquivoSessoes: path.join(pastaDados, 'sessoes.json'),
    loginPreenchido: booleano(env.LOGIN_PREENCHIDO_EM_TESTE, true),
    permitirInicioInseguro: booleano(env.PERMITIR_INICIO_INSEGURO, false)
  };
}

/* O que IMPEDE abrir o sistema na rede (HOST diferente de 127.0.0.1).
   Na própria máquina nada disso bloqueia — só avisa. */
function problemasParaRede(cfg, { segredoPadrao, senhaPadraoAtiva }) {
  const p = [];
  if (segredoPadrao) p.push('SESSION_SECRET não definido no .env: qualquer um que conheça o código forja uma sessão.');
  if (senhaPadraoAtiva) p.push('A conta "admin" ainda usa a senha padrão (que está no código-fonte): troque em Administração > Contas de acesso.');
  if (cfg.cookieSeguro && !cfg.confiarProxy) p.push('COOKIE_SEGURO=1 sem CONFIAR_PROXY=1: o cookie só vai por HTTPS, e sem proxy HTTPS na frente ninguém consegue entrar.');
  return p;
}

module.exports = { obterConfig, problemasParaRede, ehLoopback, RAIZ_APP };
