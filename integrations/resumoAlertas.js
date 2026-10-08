/* ===================================================================
   integrations/resumoAlertas.js

   Monta e envia (quando o Microsoft Graph estiver configurado — ver
   graphMail.js) o resumo diário de contratos nas faixas Vencido/Crítico/
   Atenção: um e-mail por responsável (usando o campo "e-mail do
   responsável" já existente em cada contrato) e uma cópia consolidada
   para os destinatários definidos em ALERTA_EMAIL_DESTINATARIOS.

   Fica inteiramente inerte se graphMail não estiver configurado —
   nenhuma tentativa de rede é feita, só devolve { enviado:false, motivo }.
=================================================================== */

const graphMail = require('./graphMail');

const DESTINATARIOS_FIXOS = (process.env.ALERTA_EMAIL_DESTINATARIOS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

function diasParaVencer(dataISO) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const [y, m, d] = dataISO.split('-').map(Number);
  const alvo = new Date(y, m - 1, d);
  return Math.round((alvo - hoje) / 86400000);
}

/* Mesma classificação usada em public/js/app.js (classificarContrato) — está
   duplicada aqui de propósito, porque o servidor não carrega o app.js do
   cliente. Se um dia mudar as faixas por lá, replique aqui também. */
function classificar(c, alertaConfig) {
  if (c.status === 'Encerrado') return 'Encerrado';
  if (!c.termino) return 'Sem término';
  const dias = diasParaVencer(c.termino);
  if (dias < 0) return 'Vencido';
  if (dias <= alertaConfig.critico) return 'Crítico';
  if (dias <= alertaConfig.atencao) return 'Atenção';
  if (dias <= alertaConfig.proximo) return 'Próximo';
  return 'Confortável';
}

function contratosEmAlerta(db) {
  // Prazos de cada contrato (perfil de trâmite ou Padrão), os mesmos da tela.
  const { faixasDoContrato } = require('./prazosContrato');
  return (db.contratos || [])
    .filter(c => c.status !== 'Encerrado')
    .map(c => ({ contrato: c, faixa: classificar(c, faixasDoContrato(db, c.id)), dias: diasParaVencer(c.termino) }))
    .filter(item => ['Vencido', 'Crítico', 'Atenção'].includes(item.faixa))
    .sort((a, b) => a.dias - b.dias);
}

function prazoTexto(dias) {
  if (dias < 0) return `Venceu há ${Math.abs(dias)} dia(s)`;
  if (dias === 0) return 'Vence hoje';
  return `Vence em ${dias} dia(s)`;
}

function linhaHtml(item) {
  const { contrato: c, faixa, dias } = item;
  const td = 'padding:6px 10px;border-bottom:1px solid #e1e0d9;text-align:left;';
  return `<tr><td style="${td}">${c.numero}</td><td style="${td}">${c.empresa}</td><td style="${td}">${faixa}</td><td style="${td}">${prazoTexto(dias)}</td><td style="${td}">${c.responsavel || ''}</td></tr>`;
}

function montarCorpoHtml(itens, titulo) {
  const linhas = itens.map(linhaHtml).join('');
  const th = 'padding:6px 10px;text-align:left;background:#f2f3f5;';
  return `<div style="font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#0b0b0b;">
    <h2 style="font-size:16px;margin:0 0 8px;">${titulo}</h2>
    <p style="margin:0 0 12px;">${itens.length} contrato(s) na faixa Vencido, Crítico ou Atenção.</p>
    <table style="border-collapse:collapse;width:100%;">
      <thead><tr><th style="${th}">Contrato</th><th style="${th}">Empresa</th><th style="${th}">Situação</th><th style="${th}">Prazo</th><th style="${th}">Responsável</th></tr></thead>
      <tbody>${linhas || '<tr><td colspan="5" style="padding:8px 10px;">Nenhum contrato em alerta no momento.</td></tr>'}</tbody>
    </table>
    <p style="color:#898781;font-size:11.5px;margin-top:16px;">E-mail automático da Central de Contratos — não responda.</p>
  </div>`;
}

/* Ponto de entrada usado pela rota manual ("Enviar agora") e pelo
   agendamento diário em server.js. Nunca lança — cada falha de envio vira
   uma entrada em `resultados`, para um destinatário com problema (caixa
   inexistente, por exemplo) não impedir os demais. */
async function enviarResumoDiario(db) {
  if (!graphMail.isConfigured()) {
    return { enviado: false, motivo: 'Microsoft Graph não configurado (GRAPH_MAIL_TENANT_ID/CLIENT_ID/CLIENT_SECRET/REMETENTE) — resumo por e-mail está desligado.' };
  }
  const itens = contratosEmAlerta(db);
  if (!itens.length) {
    return { enviado: false, motivo: 'Nenhum contrato em faixa Vencido/Crítico/Atenção hoje — nada para enviar.' };
  }

  const porResponsavel = new Map();
  itens.forEach(item => {
    const email = item.contrato.emailResponsavel;
    if (email && String(email).trim()) {
      const chave = String(email).trim();
      if (!porResponsavel.has(chave)) porResponsavel.set(chave, []);
      porResponsavel.get(chave).push(item);
    }
  });

  const resultados = [];
  for (const [email, lista] of porResponsavel) {
    try {
      await graphMail.enviarEmail({
        destinatarios: [email],
        assunto: `[Central de Contratos] ${lista.length} contrato(s) sob sua responsabilidade precisam de atenção`,
        corpoHtml: montarCorpoHtml(lista, 'Contratos sob sua responsabilidade em faixa de alerta')
      });
      resultados.push({ destinatario: email, enviado: true, quantidade: lista.length });
    } catch (err) {
      resultados.push({ destinatario: email, enviado: false, erro: err.message });
    }
  }

  if (DESTINATARIOS_FIXOS.length) {
    try {
      await graphMail.enviarEmail({
        destinatarios: DESTINATARIOS_FIXOS,
        assunto: `[Central de Contratos] Resumo diário — ${itens.length} contrato(s) em alerta`,
        corpoHtml: montarCorpoHtml(itens, 'Resumo consolidado — todos os contratos em faixa de alerta')
      });
      resultados.push({ destinatario: DESTINATARIOS_FIXOS.join(', '), enviado: true, quantidade: itens.length });
    } catch (err) {
      resultados.push({ destinatario: DESTINATARIOS_FIXOS.join(', '), enviado: false, erro: err.message });
    }
  }

  if (!porResponsavel.size && !DESTINATARIOS_FIXOS.length) {
    return { enviado: false, motivo: 'Existem contratos em alerta, mas nenhum tem "e-mail do responsável" preenchido e ALERTA_EMAIL_DESTINATARIOS não está definida — não há para quem enviar.' };
  }

  return { enviado: true, totalContratos: itens.length, resultados };
}

module.exports = { enviarResumoDiario, contratosEmAlerta, montarCorpoHtml, DESTINATARIOS_FIXOS };
