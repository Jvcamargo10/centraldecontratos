/* ===================================================================
   integrations/graphMail.js

   Envio de e-mail via Microsoft Graph (app-only, client-credentials) —
   escolhido como alternativa ao SMTP porque não há um servidor SMTP
   disponível na Prefeitura. Usado só pelo resumo diário de alertas de
   vencimento de contratos (ver integrations/resumoAlertas.js).

   Fica inteiramente DORMENTE enquanto as variáveis de ambiente abaixo
   não forem preenchidas: nenhuma chamada de rede é feita, e o resumo
   diário simplesmente não roda — o resto da Central de Contratos continua
   funcionando normalmente.

   Pré-requisitos no Azure AD (Entra ID), a pedir a quem administra o App
   Registration (pode ser o mesmo já usado para a integração de contratos
   do SGC, ou um novo, se preferirem separar):
     1. Permissão de APLICATIVO (não delegada) "Mail.Send" no Microsoft
        Graph, com consentimento de administrador concedido — sem isso o
        Graph responde 403 ao tentar enviar.
     2. O e-mail (UPN) da caixa que vai aparecer como remetente — pode ser
        uma caixa compartilhada ou a de uma pessoa/serviço, mas precisa
        existir de fato no Microsoft 365 da Prefeitura.

   Variáveis de ambiente (ver .env.example):
     GRAPH_MAIL_TENANT_ID      (se não definida, reaproveita CONTRATOS_API_AZURE_TENANT_ID)
     GRAPH_MAIL_CLIENT_ID      (se não definida, reaproveita CONTRATOS_API_AZURE_CLIENT_ID)
     GRAPH_MAIL_CLIENT_SECRET  (sempre própria — nunca reaproveita a de outra integração)
     GRAPH_MAIL_REMETENTE      (e-mail da caixa que envia)
=================================================================== */

const CONFIG = {
  tenantId: process.env.GRAPH_MAIL_TENANT_ID || process.env.CONTRATOS_API_AZURE_TENANT_ID || '',
  clientId: process.env.GRAPH_MAIL_CLIENT_ID || process.env.CONTRATOS_API_AZURE_CLIENT_ID || '',
  clientSecret: process.env.GRAPH_MAIL_CLIENT_SECRET || '',
  remetente: process.env.GRAPH_MAIL_REMETENTE || '',
  timeoutMs: Number(process.env.GRAPH_MAIL_TIMEOUT_MS) || 15000
};

let tokenCache = { token: null, expiraEm: 0 };

function isConfigured() {
  return !!(CONFIG.tenantId && CONFIG.clientId && CONFIG.clientSecret && CONFIG.remetente);
}

function statusPublico() {
  // Nunca devolve o client secret — só o suficiente para confirmar o que está configurado.
  return {
    configurado: isConfigured(),
    remetente: CONFIG.remetente || null,
    tenantId: CONFIG.tenantId || null,
    clientId: CONFIG.clientId || null
  };
}

async function obterToken() {
  const agora = Date.now();
  if (tokenCache.token && agora < tokenCache.expiraEm - 60000) {
    return tokenCache.token;
  }
  const tokenUrl = `https://login.microsoftonline.com/${CONFIG.tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: CONFIG.clientId,
    client_secret: CONFIG.clientSecret,
    grant_type: 'client_credentials',
    scope: 'https://graph.microsoft.com/.default'
  });
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  if (!res.ok) {
    const detalhe = await res.text().catch(() => '');
    throw new Error(`Falha ao obter token do Azure AD para o Graph (${res.status}). ${detalhe.slice(0, 300)}`);
  }
  const json = await res.json();
  if (!json.access_token) {
    throw new Error('O Azure AD respondeu sem access_token para o Microsoft Graph.');
  }
  tokenCache = { token: json.access_token, expiraEm: Date.now() + (Number(json.expires_in) || 3600) * 1000 };
  return tokenCache.token;
}

/* Envia um e-mail HTML via POST /users/{remetente}/sendMail. Lança erro se
   a integração não estiver configurada, se a lista de destinatários vier
   vazia, ou se o Graph recusar a requisição (permissão faltando, caixa
   inexistente, timeout etc.) — quem chama decide o que fazer com o erro
   (o resumo diário, por exemplo, registra e segue para o próximo
   destinatário em vez de travar tudo). */
async function enviarEmail({ destinatarios, assunto, corpoHtml }) {
  if (!isConfigured()) {
    throw new Error('Microsoft Graph não configurado — defina GRAPH_MAIL_TENANT_ID, GRAPH_MAIL_CLIENT_ID, GRAPH_MAIL_CLIENT_SECRET e GRAPH_MAIL_REMETENTE.');
  }
  const lista = (destinatarios || []).filter(Boolean);
  if (!lista.length) {
    throw new Error('Nenhum destinatário informado.');
  }
  const token = await obterToken();
  const payload = {
    message: {
      subject: assunto,
      body: { contentType: 'HTML', content: corpoHtml },
      toRecipients: lista.map(email => ({ emailAddress: { address: email } }))
    },
    saveToSentItems: true
  };
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(CONFIG.remetente)}/sendMail`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!res.ok) {
      const detalhe = await res.text().catch(() => '');
      throw new Error(`O Microsoft Graph respondeu ${res.status} ao enviar e-mail.${detalhe ? ' ' + detalhe.slice(0, 300) : ''}`);
    }
    return { enviado: true };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`O Microsoft Graph não respondeu em ${CONFIG.timeoutMs}ms (timeout).`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { isConfigured, statusPublico, enviarEmail };
