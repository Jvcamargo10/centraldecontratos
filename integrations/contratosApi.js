/* ===================================================================
   integrations/contratosApi.js

   Conector "plugável" para importar contratos de uma API real (por
   exemplo, o SGC da Prefeitura, ou qualquer outro sistema que exponha
   uma API de contratos). Enquanto as variáveis de ambiente abaixo não
   forem configuradas, este módulo fica inerte — não faz nenhuma
   chamada de rede e a Central de Contratos continua funcionando 100% com os
   dados locais, como hoje.

   Quando a Prefeitura fornecer a documentação da API real (URL,
   autenticação, formato dos dados), o trabalho é:
     1. Preencher as variáveis de ambiente (veja README.md, seção
        "Integração com uma API real de contratos").
     2. Ajustar `extrairListaDeContratos()` e `mapearContratoExterno()`
        logo abaixo para o formato de resposta real da API — eles já
        tentam alguns nomes de campo comuns, mas cada sistema tem o
        seu próprio formato.

   Nada aqui se conecta a nada por padrão — é só código esperando ser
   ligado a uma fonte real quando ela existir.
=================================================================== */

const { hojeLocal } = require('./dataLocal');
const CONFIG = {
  url: process.env.CONTRATOS_API_URL || '',
  authType: (process.env.CONTRATOS_API_AUTH_TYPE || 'none').toLowerCase(), // 'none' | 'bearer' | 'apikey' | 'basic' | 'azuread'
  token: process.env.CONTRATOS_API_TOKEN || '',
  apiKey: process.env.CONTRATOS_API_KEY || '',
  apiKeyHeader: process.env.CONTRATOS_API_KEY_HEADER || 'x-api-key',
  basicUser: process.env.CONTRATOS_API_USER || '',
  basicPass: process.env.CONTRATOS_API_PASSWORD || '',
  timeoutMs: Number(process.env.CONTRATOS_API_TIMEOUT_MS) || 15000,
  // Azure AD (Entra ID) — fluxo client-credentials, usado por APIs como o
  // SGC que exigem "Authorization: Bearer <token>" emitido pelo Azure AD.
  azureTenantId: process.env.CONTRATOS_API_AZURE_TENANT_ID || '',
  azureClientId: process.env.CONTRATOS_API_AZURE_CLIENT_ID || '',
  azureClientSecret: process.env.CONTRATOS_API_AZURE_CLIENT_SECRET || '',
  // Escopo do token. Para uma API própria registrada no Azure AD, normalmente
  // é "api://<client_id_da_API>/.default" — pergunte a quem administra o
  // App Registration da API caso não seja simplesmente o client_id acima.
  azureScope: process.env.CONTRATOS_API_AZURE_SCOPE || '',

  /* Demais listas do SGC (ou de qualquer outro sistema que exponha essas
     entidades) — usam a MESMA autenticação configurada acima (authType,
     Azure AD etc.), só a URL muda. Cada uma fica inativa até sua URL ser
     definida, exatamente como a de contratos acima. Ex. no SGC:
       CONTRATOS_API_URL_ADITIVOS=https://sgc.itaverde.gov.br/api-node/aditivo/todos
       CONTRATOS_API_URL_APOSTILAMENTOS=https://sgc.itaverde.gov.br/api-node/apostilamento/todos
       CONTRATOS_API_URL_REQUISICOES=https://sgc.itaverde.gov.br/api-node/requisicao/todos
       CONTRATOS_API_URL_GRATIFICACOES=https://sgc.itaverde.gov.br/api-node/gratificacao/todos
     No caso do SGC, cada uma dessas rotas só aceita hoje os papéis humanos
     (Nivel.Alto/Medio/Baixo) — é preciso repetir, para cada rota, o mesmo
     ajuste de uma linha já feito em ContratoRoute.js e usuariosRoute.js
     (adicionar "Contratos.Read.All" à lista de roles() aceitas), senão a
     sincronização vai falhar com 401 mesmo com a URL certa configurada. */
  aditivosUrl: process.env.CONTRATOS_API_URL_ADITIVOS || '',
  apostilamentosUrl: process.env.CONTRATOS_API_URL_APOSTILAMENTOS || '',
  requisicoesUrl: process.env.CONTRATOS_API_URL_REQUISICOES || '',
  gratificacoesUrl: process.env.CONTRATOS_API_URL_GRATIFICACOES || ''
};

// Cache em memória do token Azure AD, para não pedir um novo a cada sincronização.
let azureTokenCache = { token: null, expiraEm: 0 };

/* As credenciais (authType/token/apiKey/basic/azuread) são as mesmas para
   toda e qualquer URL configurada aqui — só a URL muda por entidade. */
function credenciaisOk() {
  if (CONFIG.authType === 'azuread') {
    return !!(CONFIG.azureTenantId && CONFIG.azureClientId && CONFIG.azureClientSecret);
  }
  return true;
}
/* Desligada por decisão de 23/09/2026 (CONTRATOS_API_DESLIGADA=1 no
   .env): a Central deixou de consultar o SGC, e os dados que vieram dele
   foram removidos (ver integrations/removerDadosSgc.js). Com a chave
   ligada, nenhuma entidade conta como configurada — nem que as URLs e
   credenciais voltem ao .env por engano. Para religar: tirar a chave. */
function desligada() {
  return String(process.env.CONTRATOS_API_DESLIGADA || '').trim() === '1';
}
function entidadeConfigurada(url) {
  if (desligada()) return false;
  return !!(url && credenciaisOk());
}
function isConfigured() {
  return entidadeConfigurada(CONFIG.url);
}

function statusPublico() {
  // Nunca devolve token/senha/client secret — só o suficiente para confirmar o que está configurado.
  return {
    configurado: isConfigured(),
    desligada: desligada(),
    url: CONFIG.url ? maskUrl(CONFIG.url) : null,
    autenticacao: CONFIG.authType,
    azureTenantId: CONFIG.authType === 'azuread' ? CONFIG.azureTenantId : undefined,
    azureClientId: CONFIG.authType === 'azuread' ? CONFIG.azureClientId : undefined,
    // Status por entidade — cada uma só fica ativa quando sua URL é definida.
    entidades: {
      contratos: { configurado: isConfigured(), url: CONFIG.url ? maskUrl(CONFIG.url) : null },
      aditivos: { configurado: entidadeConfigurada(CONFIG.aditivosUrl), url: CONFIG.aditivosUrl ? maskUrl(CONFIG.aditivosUrl) : null },
      apostilamentos: { configurado: entidadeConfigurada(CONFIG.apostilamentosUrl), url: CONFIG.apostilamentosUrl ? maskUrl(CONFIG.apostilamentosUrl) : null },
      requisicoes: { configurado: entidadeConfigurada(CONFIG.requisicoesUrl), url: CONFIG.requisicoesUrl ? maskUrl(CONFIG.requisicoesUrl) : null },
      gratificacoes: { configurado: entidadeConfigurada(CONFIG.gratificacoesUrl), url: CONFIG.gratificacoesUrl ? maskUrl(CONFIG.gratificacoesUrl) : null }
    }
  };
}

function maskUrl(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch (e) {
    return '(url configurada)';
  }
}

/* Obtém (e cacheia) um token de acesso do Azure AD via client-credentials
   flow: POST para https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
   com client_id + client_secret + scope. Reaproveita o token em cache até
   ~1 minuto antes de expirar. */
async function obterTokenAzureAD() {
  const agora = Date.now();
  if (azureTokenCache.token && agora < azureTokenCache.expiraEm - 60000) {
    return azureTokenCache.token;
  }
  const tokenUrl = `https://login.microsoftonline.com/${CONFIG.azureTenantId}/oauth2/v2.0/token`;
  const scope = CONFIG.azureScope || `${CONFIG.azureClientId}/.default`;
  const body = new URLSearchParams({
    client_id: CONFIG.azureClientId,
    client_secret: CONFIG.azureClientSecret,
    grant_type: 'client_credentials',
    scope
  });
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  if (!res.ok) {
    const detalhe = await res.text().catch(() => '');
    throw new Error(`Falha ao obter token do Azure AD (${res.status}). ${detalhe.slice(0, 300)}`);
  }
  const json = await res.json();
  if (!json.access_token) {
    throw new Error('O Azure AD respondeu sem access_token — confira CONTRATOS_API_AZURE_SCOPE.');
  }
  azureTokenCache = {
    token: json.access_token,
    expiraEm: Date.now() + (Number(json.expires_in) || 3600) * 1000
  };
  return azureTokenCache.token;
}

async function buildHeaders() {
  const headers = { Accept: 'application/json' };
  if (CONFIG.authType === 'bearer' && CONFIG.token) {
    headers.Authorization = `Bearer ${CONFIG.token}`;
  } else if (CONFIG.authType === 'azuread') {
    const token = await obterTokenAzureAD();
    headers.Authorization = `Bearer ${token}`;
  } else if (CONFIG.authType === 'apikey' && CONFIG.apiKey) {
    headers[CONFIG.apiKeyHeader] = CONFIG.apiKey;
  } else if (CONFIG.authType === 'basic' && CONFIG.basicUser) {
    const encoded = Buffer.from(`${CONFIG.basicUser}:${CONFIG.basicPass}`).toString('base64');
    headers.Authorization = `Basic ${encoded}`;
  }
  return headers;
}

/* Busca o JSON bruto numa URL da API externa (por padrão, a de contratos).
   Lança erro se a URL não estiver definida, se a resposta não for OK, ou
   se estourar o timeout. Reaproveitada por todas as entidades — só a URL
   muda, a autenticação (buildHeaders) é sempre a mesma. */
async function buscarBruto(url) {
  url = url || CONFIG.url;
  if (!url) {
    throw new Error('A integração ainda não está totalmente configurada. Veja o README para as variáveis de ambiente necessárias.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.timeoutMs);
  try {
    const headers = await buildHeaders();
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) {
      const detalhe = await res.text().catch(() => '');
      throw new Error(`A API respondeu ${res.status} ${res.statusText}.${detalhe ? ' ' + detalhe.slice(0, 300) : ''}`);
    }
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`A API não respondeu em ${CONFIG.timeoutMs}ms (timeout).`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/* A maioria das APIs devolve ou uma lista direta, ou um objeto com a
   lista dentro de alguma chave comum (data/items/results/...). Ajuste aqui
   se o formato real for diferente disso. */
function extrairLista(bruto) {
  if (Array.isArray(bruto)) return bruto;
  if (bruto && typeof bruto === 'object') {
    for (const chave of ['data', 'items', 'results', 'registros', 'contratos', 'aditivos', 'apostilamentos', 'requisicoes', 'gratificacoes']) {
      if (Array.isArray(bruto[chave])) return bruto[chave];
    }
  }
  throw new Error('Formato de resposta inesperado da API — ajuste extrairLista() em integrations/contratosApi.js para o formato real.');
}

function primeiroValor(obj, chaves) {
  for (const k of chaves) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return undefined;
}

/* Converte uma data em qualquer formato razoável (ISO, "dd/mm/aaaa",
   timestamp) para o formato "aaaa-mm-dd" usado internamente. Ajuste
   se a API real usar um formato diferente. */
function normalizarData(valor) {
  if (!valor) return undefined;
  if (/^\d{4}-\d{2}-\d{2}/.test(String(valor))) return String(valor).slice(0, 10);
  const brMatch = String(valor).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brMatch) return `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`;
  const d = new Date(valor);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return undefined;
}

/* Algumas APIs (como o SGC) não trazem valor/término num campo simples —
   trazem uma LISTA de registros relacionados (ex: histórico de aditivos),
   cada um com seu próprio valor e um "status: true/false" indicando qual é
   o vigente. Esta função pega o item vigente (ou o primeiro, se nenhum
   estiver marcado) e devolve o valor de uma chave dele. */
function extrairDeListaRelacionada(lista, chaveValor) {
  if (!Array.isArray(lista) || lista.length === 0) return undefined;
  const vigente = lista.find(item => item && item.status === true) || lista[0];
  return vigente ? vigente[chaveValor] : undefined;
}

/* Confirmado com uma amostra real do SGC (14/09/2026): cada contrato traz
   uma lista `ccfContrato` com as pessoas designadas nele (gestor, suplente,
   fiscal...), cada item com `cargosContratoCcf.cargo` (o nome do cargo) e
   `funcionarioCcf.nome` (o nome da pessoa, já "detokenizado" pela própria
   API). Nos 44 contratos already sincronizados, todo contrato tem
   exatamente 1 "Gestor" vigente e 1 "Suplente" vigente; "Fiscal" apareceu
   em só 1 dos 44 (uso raro nesta instalação). Esta função pega, para uma
   lista de nomes de cargo (em ordem de preferência), o nome da pessoa
   vigente nesse cargo. */
function pessoaPorCargo(raw, nomesCargo) {
  const lista = Array.isArray(raw.ccfContrato) ? raw.ccfContrato : [];
  for (const alvo of nomesCargo) {
    const doCargo = lista.filter(item => {
      const cargo = item && item.cargosContratoCcf && item.cargosContratoCcf.cargo;
      return cargo && String(cargo).trim().toLowerCase() === alvo.toLowerCase();
    });
    const vigente = doCargo.find(item => item.status === true) || doCargo[0];
    const nome = vigente && vigente.funcionarioCcf && vigente.funcionarioCcf.nome;
    if (nome) return nome;
  }
  return undefined;
}

/* Alguns campos de texto livre do SGC usam frases como "Não tem" em vez de
   deixar o campo vazio quando não há valor. Normaliza essas frases para
   undefined, para não exibir "Não tem" como se fosse um dado de verdade. */
function normalizarTextoOuVazio(valor) {
  if (!valor) return undefined;
  const v = String(valor).trim();
  if (!v || /^(n[ãa]o tem|n[ãa]o h[áa]|nenhum[a]?|n\/?a|-)$/i.test(v)) return undefined;
  return v;
}

/* Mapeia um registro cru da API externa para o formato de contrato
   usado pela Central de Contratos. Confirmado com uma amostra real do SGC
   (14/09/2026, 44 contratos) — ver comentário mais abaixo com o resumo
   de tudo que a API entrega e não era aproveitado antes. */
function mapearContratoExterno(raw) {
  const numero = primeiroValor(raw, ['numero', 'numeroContrato', 'numero_contrato', 'contrato', 'codigo', 'numContrato']);
  if (!numero) return null; // sem número de contrato não há como casar com o cadastro local — ignora o registro.

  // Nomes de campo específicos do SGC (Prefeitura de Itaverde): empresa, valor
  // mensal e término não vêm soltos — vêm dentro de sub-objetos/sub-listas.
  const empresaSgc = raw.empresaContrato && raw.empresaContrato.nome;
  const terminoSgc = extrairDeListaRelacionada(raw.dataterminoContrato, 'data');
  const valorSgc = extrairDeListaRelacionada(raw.valorContrato, 'valor_media_mensal')
    ?? extrairDeListaRelacionada(raw.valorContrato, 'valor_contrato');

  return {
    numero: String(numero),
    empresa: empresaSgc || primeiroValor(raw, ['empresa', 'fornecedor', 'razaoSocial', 'razao_social', 'contratada', 'nomeEmpresa']) || '',
    cnpjEmpresa: (raw.empresaContrato && raw.empresaContrato.cnpj) || undefined,
    tipo: primeiroValor(raw, ['tipo', 'tipoServico', 'tipo_servico', 'descricaoObjeto']) || '',
    objeto: primeiroValor(raw, ['objeto']) || undefined,
    inicio: normalizarData(primeiroValor(raw, ['inicio', 'dataInicio', 'data_inicio', 'vigenciaInicio', 'dataAssinatura'])),
    termino: normalizarData(terminoSgc || primeiroValor(raw, ['termino', 'fim', 'dataFim', 'data_fim', 'vigenciaFim', 'dataTermino', 'dataVencimento'])),
    valor: Number(valorSgc ?? primeiroValor(raw, ['valor', 'valorMensal', 'valor_mensal', 'valorGlobal'])) || undefined,
    // O SGC não tem um campo "status"/"situação" solto — o que existe é
    // `termo_encerramento` ("Sim"/"Não"), que é o sinal real de que o
    // contrato foi encerrado. Antes desta correção, `status` nunca vinha
    // preenchido pela API (a lista de nomes abaixo não batia com nada) e
    // todo contrato importado ficava travado em "Ativo" para sempre, mesmo
    // depois de encerrado de verdade — por isso ele agora tem prioridade.
    status: mapStatusSgc(raw.termo_encerramento) || primeiroValor(raw, ['status', 'situacao', 'situacaoContrato']) || undefined,
    // Campos novos, descobertos a partir do código-fonte real da API do SGC
    // (ver integrations/referencia-sgc/) e confirmados com uma amostra real:
    secretaria: (raw.secretariaContrato && raw.secretariaContrato.nome) || undefined,
    responsavel: pessoaPorCargo(raw, ['Gestor', 'Fiscal', 'Suplente']),
    suplente: pessoaPorCargo(raw, ['Suplente']),
    pa: primeiroValor(raw, ['pa']) || undefined,
    preposto: normalizarTextoOuVazio(raw.preposto),
    tipoContratacao: primeiroValor(raw, ['tipo_contratacao']) || undefined,
    sgcValores: parcelasDoValorSgc(raw)
  };
}

/* As PARCELAS com que o SGC chegou à média mensal — não só a média.
   Confirmado na API real (21/09/2026): `valorContrato` traz o valor total
   (`valor_contrato`, já com os aditivos quando `status_inicial` é
   false) e a média; `aditivoValorContrato` traz cada aditivo de valor;
   `vigenciaContrato` traz a vigência em meses (a vigente é a de
   status true — depois de uma prorrogação, costuma ser SÓ a do aditivo).
   Guardadas para a Conferência SGC dizer de onde vem cada divergência:
   no 096/2025, o próprio SGC tem 26.100.000 em 12 meses e média de
   2.075,07; no 006/2025, a média é 11.190.000 ÷ 120. Só leitura — nada
   aqui volta para o SGC. */
function parcelasDoValorSgc(raw) {
  const valores = Array.isArray(raw.valorContrato) ? raw.valorContrato : [];
  const vigente = valores.find(v => v && v.status === true) || valores[0];
  if (!vigente) return undefined;
  const num = v => (v === null || v === undefined || v === '' || isNaN(Number(v))) ? null : Number(v);
  return {
    valorContrato: num(vigente.valor_contrato),
    valorMediaMensal: num(vigente.valor_media_mensal),
    somenteInicial: vigente.status_inicial === true,
    aditivosDeValor: (Array.isArray(raw.aditivoValorContrato) ? raw.aditivoValorContrato : [])
      .map(a => num(a && a.valor_do_aditivo)).filter(v => v !== null),
    vigenciaMeses: num(extrairDeListaRelacionada(raw.vigenciaContrato, 'vigencia_em_meses')),
    vigenciaDeAditivo: !!((raw.vigenciaContrato || []).find(v => v && v.status === true) || {}).aditivo_id
  };
}

function mapStatusSgc(termoEncerramento) {
  if (termoEncerramento === 'Sim') return 'Encerrado';
  if (termoEncerramento === 'Não' || termoEncerramento === 'Nao') return 'Ativo';
  return undefined;
}

/* ---------------------------------------------------------------------
   Notas específicas para o SGC (Prefeitura de Itaverde), a partir do que
   foi mapeado nas rotas da API real:

     Base URL:  https://sgc.itaverde.gov.br/api-node/
     Lista de contratos:  GET /contrato/todos  (ou GET /contrato/vigentes
                           para trazer só os contratos vigentes)
     Autenticação: Azure AD (Entra ID), client-credentials —
                   CONTRATOS_API_AUTH_TYPE=azuread

   O tenant e o client_id do App Registration não são segredo por si só
   (são identificadores públicos), mas o client_secret É uma credencial
   sensível — configure-o só no .env local, nunca aqui no código nem em
   qualquer lugar que possa ser compartilhado.

   Confirmado com uma amostra real de 44 contratos (14/09/2026) — ver
   integrations/referencia-sgc/ para o código-fonte original do SGC que
   comprovou o formato abaixo:
     - secretariaContrato.nome            -> secretaria
     - empresaContrato.nome / .cnpj       -> empresa / cnpjEmpresa
     - ccfContrato[] (cargo "Gestor"/"Suplente"/"Fiscal" + funcionarioCcf.nome)
                                           -> responsavel / suplente
     - termo_encerramento ("Sim"/"Não")   -> status ("Encerrado"/"Ativo")
     - pa, preposto, tipo_contratacao, objeto -> campos novos, sem
       equivalente na Central de Contratos antes desta integração.
   Não existe e-mail de responsável nesta API (o cadastro de funcionário
   do SGC só tem nome/CPF/matrícula) — `emailResponsavel` continua sendo
   preenchido manualmente, se necessário.
--------------------------------------------------------------------- */

/* Sincroniza os contratos vindos da API externa com o cadastro local.
   Regra: todo campo que a API do SGC realmente fornece (empresa, CNPJ,
   tipo, objeto, início, término, valor, status, secretaria, responsável,
   suplente, PA, preposto, modalidade) é sempre atualizado a partir dela —
   é a fonte oficial. Só ficam de fora dessa lista os campos que não têm
   equivalente na API e por isso são mantidos e editados por aqui:
   `emailResponsavel` (sem fonte na API do SGC) e `observacoes` (anotação
   livre da própria Central de Contratos). */
async function sincronizarContratos(db, save, nextId) {
  const bruto = await buscarBruto(CONFIG.url);
  const lista = extrairLista(bruto);

  const resumo = { total: lista.length, criados: 0, atualizados: 0, ignorados: 0, erros: [] };
  const CAMPOS_DA_API = ['empresa', 'cnpjEmpresa', 'tipo', 'objeto', 'inicio', 'termino', 'valor', 'status', 'secretaria', 'responsavel', 'suplente', 'pa', 'preposto', 'tipoContratacao', 'sgcValores'];

  lista.forEach(raw => {
    let mapeado;
    try {
      mapeado = mapearContratoExterno(raw);
    } catch (err) {
      resumo.erros.push(err.message);
      return;
    }
    if (!mapeado) { resumo.ignorados++; return; }

    const existente = db.contratos.find(c => c.numero === mapeado.numero);
    if (existente) {
      CAMPOS_DA_API.forEach(campo => {
        if (mapeado[campo] !== undefined) existente[campo] = mapeado[campo];
      });
      existente.origemExterna = true;
      existente.sincronizadoEm = hojeLocal();
      resumo.atualizados++;
    } else {
      const novo = {
        id: nextId(db.contratos),
        numero: mapeado.numero,
        empresa: mapeado.empresa || '(a preencher)',
        cnpjEmpresa: mapeado.cnpjEmpresa || '',
        secretaria: mapeado.secretaria || '',
        tipo: mapeado.tipo || '(a preencher)',
        objeto: mapeado.objeto || '',
        inicio: mapeado.inicio || hojeLocal(),
        termino: mapeado.termino || hojeLocal(),
        valor: mapeado.valor || 0,
        status: mapeado.status || 'Ativo',
        responsavel: mapeado.responsavel || '(a definir)',
        suplente: mapeado.suplente || '',
        pa: mapeado.pa || '',
        preposto: mapeado.preposto || '',
        tipoContratacao: mapeado.tipoContratacao || '',
        ...(mapeado.sgcValores ? { sgcValores: mapeado.sgcValores } : {}),
        emailResponsavel: '',
        observacoes: '',
        origemExterna: true,
        sincronizadoEm: hojeLocal()
      };
      db.contratos.unshift(novo);
      resumo.criados++;
    }
  });

  db.integracoes = db.integracoes || {};
  db.integracoes.contratosApi = db.integracoes.contratosApi || {};
  db.integracoes.contratosApi.ultimaSincronizacao = new Date().toISOString();
  db.integracoes.contratosApi.ultimoResumo = resumo;
  save();

  return resumo;
}

/* ---------------------------------------------------------------------
   Aditivos, Apostilamentos, Requisições e Gratificações — mesmo padrão
   usado para Contratos acima: cada uma tem sua própria URL (CONFIG.*Url,
   ver topo do arquivo) e fica inativa até essa URL ser definida.

   Aditivos, Apostilamentos e Requisições já foram confirmados com amostra
   real do SGC (11 e 14/09/2026, 76 + 37 + 32 registros) — os campos abaixo
   batem com o que a API realmente devolve. Gratificações continua sem
   amostra real (o SGC não tinha nenhum registro até agora).
--------------------------------------------------------------------- */

/* Confirmado com uma amostra real do SGC (11/09/2026): Aditivo, Apostilamento
   e Requisição não trazem o contrato como um campo simples — trazem um
   objeto aninhado com o Contrato inteiro "junto" (mesmo formato usado por
   /contrato/todos), só que o nome da chave muda conforme a entidade:
   "contratoAditivo", "contratoApostilamento", "contratoRequisicoes". Esse
   objeto tem `numero_contrato` (o número "bonito", tipo "010/2024") e, pelo
   menos em Requisição, também `empresaContrato.nome`. Esta função acha
   qual dessas chaves está presente e usa ela como fonte de contrato/empresa. */
function contratoLinkadoDe(raw) {
  return raw.contratoAditivo || raw.contratoApostilamento || raw.contratoRequisicoes
    || raw.contratoRequisicao || raw.contratoGratificacao || null;
}

function mapearAditivoOuApostilamentoExterno(raw) {
  const contratoObj = contratoLinkadoDe(raw);
  const contrato = (contratoObj && contratoObj.numero_contrato)
    || primeiroValor(raw, ['contrato', 'numeroContrato', 'numero_contrato', 'contratoNumero']);
  // O "numero" no nível raiz é o número do próprio aditivo/apostilamento
  // (ex: "095/2025") — não confundir com o número do contrato acima.
  const numero = primeiroValor(raw, ['numero', 'numeroAditivo', 'numero_aditivo', 'numeroApostilamento', 'numero_apostilamento', 'codigo']);
  if (!contrato || !numero) return null; // sem contrato+número não há chave para casar com o cadastro local.
  return {
    contrato: String(contrato),
    numero: String(numero),
    empresa: (contratoObj && contratoObj.empresaContrato && contratoObj.empresaContrato.nome)
      || primeiroValor(raw, ['empresa', 'fornecedor', 'razaoSocial', 'razao_social', 'contratada']) || '',
    tipo: primeiroValor(raw, ['tipo', 'tipoAditivo', 'tipo_aditivo', 'tipoApostilamento']) || '',
    // "objeto" é a descrição completa do que o aditivo/apostilamento muda
    // no contrato (texto livre, geralmente uma frase citando a lei) —
    // confirmado com amostra real; não existia neste mapeamento antes.
    objeto: primeiroValor(raw, ['objeto']) || undefined,
    data: normalizarData(primeiroValor(raw, ['data', 'dataExtrato', 'data_extrato', 'dataAssinatura', 'dataAditivo', 'data_aditivo']))
  };
}

function mapearRequisicaoExterna(raw) {
  const contratoObj = contratoLinkadoDe(raw);
  const contrato = (contratoObj && contratoObj.numero_contrato)
    || primeiroValor(raw, ['contrato', 'numeroContrato', 'numero_contrato', 'contratoNumero']);
  const numero = primeiroValor(raw, ['numero', 'numeroRequisicao', 'numero_requisicao', 'codigo']);
  if (!contrato || !numero) return null;
  return {
    contrato: String(contrato),
    numero: String(numero),
    empresa: (contratoObj && contratoObj.empresaContrato && contratoObj.empresaContrato.nome)
      || primeiroValor(raw, ['empresa', 'fornecedor', 'razaoSocial', 'razao_social', 'contratada']) || '',
    data: normalizarData(primeiroValor(raw, ['data', 'dataRequisicao', 'data_requisicao', 'dataAssinatura'])),
    // Campos confirmados com amostra real (14/09/2026) e não usados antes:
    // "tc" é o número do processo no Tribunal de Contas; "observacoes" e
    // "numero_oficio" vêm soltos no registro (não são "objeto").
    observacoes: normalizarTextoOuVazio(raw.observacoes),
    tc: primeiroValor(raw, ['tc']) || undefined,
    numeroOficio: primeiroValor(raw, ['numero_oficio']) || undefined
  };
}

/* Gratificação ainda não pôde ser testada contra dados reais — o SGC não
   tinha nenhum registro no momento (resposta veio como lista vazia). O
   mapeamento abaixo segue o mesmo padrão descoberto nas outras 3 entidades
   (contrato ligado via objeto aninhado), mas precisa ser conferido assim
   que houver ao menos uma gratificação real para comparar. */
function mapearGratificacaoExterna(raw) {
  const funcionario = primeiroValor(raw, ['funcionario', 'nomeFuncionario', 'nome_funcionario', 'servidor', 'nome']);
  const periodo = primeiroValor(raw, ['periodo', 'competencia', 'mesAno', 'mes_ano']);
  if (!funcionario || !periodo) return null; // sem funcionário+período não há chave para casar com o cadastro local.
  const contratoObj = contratoLinkadoDe(raw);
  return {
    funcionario: String(funcionario),
    periodo: String(periodo),
    contrato: (contratoObj && contratoObj.numero_contrato) || primeiroValor(raw, ['contrato', 'numeroContrato', 'numero_contrato']) || '',
    empresa: (contratoObj && contratoObj.empresaContrato && contratoObj.empresaContrato.nome) || primeiroValor(raw, ['empresa', 'fornecedor']) || '',
    valor: Number(primeiroValor(raw, ['valor', 'valorGratificacao', 'valor_gratificacao'])) || undefined
  };
}

/* Sincroniza uma lista genérica (aditivos/apostilamentos/requisições/
   gratificações) contra `db[dbKey]`, casando registros pela chave que
   `chaveDe()` calcula a partir dos campos já mapeados. Como essas
   entidades não têm campos "só da Central de Contratos" (diferente de Contratos,
   que preserva secretaria/responsável/observações), todo campo mapeado é
   sempre atualizado. Retorna `null` (sem tentar nada) se a URL dessa
   entidade ainda não estiver configurada — isso não é um erro, é só uma
   etapa futura, então o resto da sincronização segue normalmente. */
async function sincronizarEntidadeGenerica({ db, dbKey, url, mapear, chaveDe, nextId }) {
  if (!entidadeConfigurada(url)) return null;
  const bruto = await buscarBruto(url);
  const lista = extrairLista(bruto);
  const resumo = { total: lista.length, criados: 0, atualizados: 0, ignorados: 0, erros: [] };
  const hoje = hojeLocal();

  lista.forEach(raw => {
    let mapeado;
    try {
      mapeado = mapear(raw);
    } catch (err) {
      resumo.erros.push(err.message);
      return;
    }
    if (!mapeado) { resumo.ignorados++; return; }

    // Se a entidade não trouxe o nome da empresa, tenta completar a partir
    // do cadastro de Contratos já sincronizado (mesmo número de contrato).
    if (!mapeado.empresa && mapeado.contrato && Array.isArray(db.contratos)) {
      const contratoLocal = db.contratos.find(c => c.numero === mapeado.contrato);
      if (contratoLocal && contratoLocal.empresa) mapeado.empresa = contratoLocal.empresa;
    }

    const chave = chaveDe(mapeado);
    const existente = db[dbKey].find(item => chaveDe(item) === chave);
    if (existente) {
      Object.keys(mapeado).forEach(campo => {
        if (mapeado[campo] !== undefined && mapeado[campo] !== '') existente[campo] = mapeado[campo];
      });
      existente.origemExterna = true;
      existente.sincronizadoEm = hoje;
      resumo.atualizados++;
    } else {
      const novo = { id: nextId(db[dbKey]), ...mapeado, origemExterna: true, sincronizadoEm: hoje };
      db[dbKey].unshift(novo);
      resumo.criados++;
    }
  });

  return resumo;
}

const chaveContratoNumero = item => `${item.contrato || ''}||${item.numero || ''}`;
const chaveGratificacao = item => `${item.funcionario || ''}||${item.periodo || ''}||${item.contrato || ''}`;

/* Roda a sincronização de Contratos e, em seguida, tenta as outras 4
   entidades — cada uma isoladamente, para que um erro numa não impeça as
   demais (nem a de Contratos, que já rodou primeiro). Entidades sem URL
   configurada aparecem no resumo com `configurado:false`, sem contar como
   falha. */
async function sincronizarTudo(db, save, nextId) {
  const resumoContratos = await sincronizarContratos(db, save, nextId);

  async function tentarEntidade(dbKey, url, mapear, chaveDe) {
    if (!entidadeConfigurada(url)) return { configurado: false };
    try {
      const resumo = await sincronizarEntidadeGenerica({ db, dbKey, url, mapear, chaveDe, nextId });
      return { configurado: true, ...resumo };
    } catch (err) {
      return { configurado: true, total: 0, criados: 0, atualizados: 0, ignorados: 0, erros: [err.message] };
    }
  }

  const resumoAditivos = await tentarEntidade('aditivos', CONFIG.aditivosUrl, mapearAditivoOuApostilamentoExterno, chaveContratoNumero);
  const resumoApostilamentos = await tentarEntidade('apostilamentos', CONFIG.apostilamentosUrl, mapearAditivoOuApostilamentoExterno, chaveContratoNumero);
  const resumoRequisicoes = await tentarEntidade('requisicoes', CONFIG.requisicoesUrl, mapearRequisicaoExterna, chaveContratoNumero);
  const resumoGratificacoes = await tentarEntidade('gratificacoes', CONFIG.gratificacoesUrl, mapearGratificacaoExterna, chaveGratificacao);

  const resumoCombinado = {
    contratos: resumoContratos,
    aditivos: resumoAditivos,
    apostilamentos: resumoApostilamentos,
    requisicoes: resumoRequisicoes,
    gratificacoes: resumoGratificacoes
  };

  db.integracoes = db.integracoes || {};
  db.integracoes.contratosApi = db.integracoes.contratosApi || {};
  db.integracoes.contratosApi.ultimaSincronizacao = new Date().toISOString();
  db.integracoes.contratosApi.ultimoResumo = resumoCombinado;
  save();

  return resumoCombinado;
}

module.exports = {
  isConfigured, desligada, statusPublico, sincronizarContratos, sincronizarTudo,
  // Leitura crua da API, para ferramentas de diagnóstico e avaliação
  // (ferramentas/). Não usar na aplicação — ela passa pelos mapeamentos.
  _paraDiagnostico: { buscarBruto, extrairLista, mapearContratoExterno }
};
