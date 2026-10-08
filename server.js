/* ===================================================================
   server.js — backend da "Central de Contratos" (Express + JSON local).

   Roda 100% local/demo. NÃO se conecta a nenhum sistema real da
   Prefeitura de Itaverde. Módulos: Alertas de Vencimento de Contratos,
   Painel de Indicadores de Contratos e Onboarding/Offboarding.
=================================================================== */

/* Carrega o .env da raiz (sem pacote externo; nunca sobrescreve variável já
   definida no ambiente) — ver integrations/carregarEnv.js, também usado pelas
   ferramentas de linha de comando. */
require('./integrations/carregarEnv').carregarEnv();
// Tudo o que muda ao sair desta máquina para um servidor: integrations/configServidor.js e SERVIDOR.md.
const CFG = require('./integrations/configServidor').obterConfig();

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const {
  db, save, nextId,
  TIPOS_SERVICO, SECRETARIAS_NOMES,
  PAPEIS
} = require('./db');
const contratosApi = require('./integrations/contratosApi');
const graphMail = require('./integrations/graphMail');
const resumoAlertas = require('./integrations/resumoAlertas');
const servidorArquivos = require('./integrations/servidorArquivos');
const ingestaoContratos = require('./integrations/ingestaoContratos');
const mapaRiscoContratos = require('./integrations/mapaRiscoContratos');
const fichaCadastroContrato = require('./integrations/fichaCadastroContrato');
const baseContratos = require('./integrations/baseContratos');
const conferenciaSgc = require('./integrations/conferenciaSgc');
const baseTermos = require('./integrations/baseTermos');
const mudancasPorTermos = require('./integrations/mudancasPorTermos');
const pendenciasLeitura = require('./integrations/pendenciasLeitura');
const registroRiscos = require('./integrations/registroRiscos');
const requisicoes = require('./integrations/requisicoes');
const historicoContrato = require('./integrations/historicoContrato');
const prazosContrato = require('./integrations/prazosContrato');
const ufm = require('./integrations/ufm');
const { hojeLocal } = require('./integrations/dataLocal');
const dataBr = iso => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || ''); };

const app = express();
const PORT = CFG.porta;
const IS_PROD = CFG.IS_PROD;
const DEFAULT_SECRET = 'central-contratos-demo-secret-troque-em-producao';
const SESSION_SECRET = process.env.SESSION_SECRET || DEFAULT_SECRET;

/* A Central de Contratos é um EXIBIDOR de dados de contratos, aditivos,
   apostilamentos, requisições, gratificações e dos demais cadastros do ERP —
   toda essa informação vem de fora (SGC) e não é criada/editada por aqui.
   O que ainda se escreve pela própria Central são tratativas, comentários,
   configurações de alerta, contas de acesso e a revisão das propostas lidas
   dos documentos. */

app.disable('x-powered-by');
// Atrás de proxy HTTPS (IIS/nginx): IP real de quem acessa e protocolo — CONFIAR_PROXY.
if (CFG.confiarProxy) app.set('trust proxy', 1);
// Cabeçalhos de segurança, API sem cache e origem conferida — ver integrations/seguranca.js.
const seguranca = require('./integrations/seguranca');
app.use(seguranca.cabecalhosDeSeguranca);
// Respostas em gzip (API e arquivos da página) — ver integrations/compressao.js.
const compressao = require('./integrations/compressao');
app.use(compressao.comprimirRespostas);
app.use('/api', seguranca.semCache, seguranca.verificarOrigem(CFG.origensPermitidas));
// 1 MB (o padrão é 100 KB): a seleção manual pelo Explorer manda nome,
// tamanho e data de até 500 arquivos de uma pasta escolhida inteira.
app.use(express.json({ limit: '1mb' }));
const storeDeSessoes = CFG.sessoes === 'arquivo' ? require('./integrations/sessoesArquivo')(session, CFG.arquivoSessoes) : undefined;
app.use(session({
  name: 'central_setec_sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  // SESSION_STORE=arquivo: a sessão sobrevive a reinício do serviço (padrão: memória).
  store: storeDeSessoes,
  cookie: { httpOnly: true, sameSite: 'lax', secure: CFG.cookieSeguro, maxAge: 8 * 60 * 60 * 1000 }
}));
// Login com a conta da Prefeitura (Entra ID / Azure AD) — ver integrations/loginEntra.js.
const loginEntra = require('./integrations/loginEntra');
const ENTRA = loginEntra.configEntra();

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    const user = (db.authUsers || []).find(u => u.id === req.session.userId);
    if (user) { req.__usuarioNome = user.nome; req.__usuarioRole = user.role || 'admin'; return next(); }
  }
  return res.status(401).json({ error: 'Não autenticado.' });
}
/* Restringe uma rota a quem tem um dos papéis informados. Usa sempre depois
   de requireAuth (que já preenche req.__usuarioRole). Pensado para, no
   futuro, trocar só a origem do papel (login local -> grupo do AD) sem
   precisar mexer em nenhuma rota que já usa isso. */
function requireRole(...papeis) {
  return (req, res, next) => {
    if (papeis.includes(req.__usuarioRole)) return next();
    return res.status(403).json({ error: 'Seu perfil não tem permissão para esta ação.' });
  };
}
function publicUser(u) { return { id: u.id, usuario: u.usuario, nome: u.nome, role: u.role || 'admin' }; }

/* Trilha de auditoria: quem fez o quê e quando, nos módulos que ainda têm
   escrita (Tratativas, Onboarding/Offboarding, Configurações de alerta,
   Contas de acesso). Guarda só os MAX_AUDITORIA mais recentes
   para o arquivo não crescer para sempre. Nunca impede a ação em si — se o
   registro de auditoria falhar por algum motivo, a operação principal
   continua normalmente. */
const MAX_AUDITORIA = 2000;
function registrarAuditoria(req, acao, entidade, entidadeId, detalhes) {
  try {
    if (!Array.isArray(db.auditoria)) db.auditoria = [];
    db.auditoria.unshift({
      id: nextId(db.auditoria),
      data: new Date().toISOString(),
      usuario: req.__usuarioNome || 'Usuário',
      papel: req.__usuarioRole || 'admin',
      acao, entidade, entidadeId: entidadeId === undefined ? null : entidadeId,
      detalhes: detalhes || ''
    });
    if (db.auditoria.length > MAX_AUDITORIA) db.auditoria.length = MAX_AUDITORIA;
  } catch (e) {
    console.error('Aviso: falha ao registrar auditoria:', e.message);
  }
}

/* ---------- Autenticação ---------- */
/* Hash de uma senha qualquer: com usuário inexistente, a senha ainda é
   conferida contra ele — a resposta leva o mesmo tempo e não revela quais
   usuários existem. */
const HASH_DE_COMPARACAO = bcrypt.hashSync('usuario-inexistente', 10);
const SENHA_MINIMA = 10;

app.use(loginEntra.montarRotas({ express, cfg: ENTRA, db, save, nextId, registrarAuditoria }));

app.post('/api/login', (req, res) => {
  const { usuario, senha } = req.body || {};
  const ip = req.ip;
  const espera = seguranca.loginBloqueado(ip, usuario);
  if (espera) {
    return res.status(429).json({ error: `Muitas tentativas erradas. Tente de novo em ${espera} minuto(s).` });
  }
  const user = typeof usuario === 'string' ? (db.authUsers || []).find(u => u.usuario === usuario) : null;
  // Conta só do AD (sem senha na Central) não entra por aqui.
  const senhaConfere = bcrypt.compareSync(String(senha || ''), user && user.senhaHash ? user.senhaHash : HASH_DE_COMPARACAO) && !!(user && user.senhaHash);
  if (!user || !senhaConfere) {
    const bloqueou = seguranca.registrarFalhaDeLogin(ip, usuario);
    registrarAuditoria({ __usuarioNome: String(usuario || '(vazio)').slice(0, 60), __usuarioRole: '-' }, 'login-falhou', 'sessao', null,
      bloqueou ? 'Senha errada — tentativas bloqueadas por 15 minutos.' : 'Usuário ou senha inválidos.');
    save();
    return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
  }
  seguranca.limparFalhasDeLogin(ip, usuario);
  // Sessão NOVA a cada login: um identificador obtido antes não vale depois.
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Não foi possível iniciar a sessão.' });
    req.session.userId = user.id;
    registrarAuditoria({ __usuarioNome: user.nome, __usuarioRole: user.role }, 'login', 'sessao', user.id, `Entrada de "${user.usuario}".`);
    save();
    req.session.save(() => res.json(publicUser(user)));
  });
});
app.post('/api/logout', (req, res) => {
  if (!req.session) return res.status(204).end();
  req.session.destroy(() => { res.clearCookie('central_setec_sid'); res.status(204).end(); });
});
/* A senha padrão do admin ainda está ativa? (Na primeira instalação: "admin" / a senha do db.js.) */
const SENHA_PADRAO = 'itaverde2026';
function senhaPadraoAindaAtiva() {
  return (db.authUsers || []).some(u => u.usuario === 'admin' && bcrypt.compareSync(SENHA_PADRAO, u.senhaHash));
}
/* Login preenchido para teste (pedido do usuário em 22/09/2026). Antes, a
   senha ficava escrita no app.js — arquivo público, que qualquer um na
   rede baixa. Agora o servidor só a entrega se: LOGIN_PREENCHIDO_EM_TESTE
   não foi desligado, o pedido vem desta máquina (sem proxy no meio) e a
   senha padrão ainda está ativa. Depois de trocada, o login vem vazio. */
app.get('/api/login-config', (req, res) => {
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && !req.get('x-forwarded-for');
  if (CFG.loginPreenchido && local && senhaPadraoAindaAtiva()) return res.json({ preencher: true, usuario: 'admin', senha: SENHA_PADRAO, entra: ENTRA.ligado });
  res.json({ preencher: false, entra: ENTRA.ligado });
});
app.get('/api/session', (req, res) => {
  const user = req.session && req.session.userId ? (db.authUsers || []).find(u => u.id === req.session.userId) : null;
  if (!user) return res.status(401).json({ error: 'Não autenticado.' });
  res.json(publicUser(user));
});

// Navegadores pedem /favicon.ico por conta própria: entrega o ícone da Central.
app.get('/favicon.ico', (req, res) => res.type('image/svg+xml').sendFile(path.join(__dirname, 'public', 'favicon.svg')));
app.use(compressao.estaticosComprimidos(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- A partir daqui, exige sessão ---------- */
app.use('/api', requireAuth);

app.get('/api/bootstrap', (req, res) => {
  // Fora do bootstrap (29/09/2026): o histórico de análises do Mapa de risco
  // e o texto das propostas eram 1,9 MB dos 2 MB desta resposta e a tela
  // não usa nada disso daqui — cada tela busca o que precisa na sua rota.
  // Das propostas, só o status (contador "esperando revisão" do menu).
  const { authUsers, auditoria, pedidosDeAcesso, ufm: _ufm, historicoContratos, tratativas: _tratativas, perfisPrazo, prazosContrato: _prazosContrato, integracoes, mapasRisco, importacoesPendentes, requisicoesLidas, requisicoesConferencia, requisicoesAnalisadas, relatoriosMensais: _relatoriosMensais, relatoriosMensaisConfig, leiturasReportadas: _leiturasReportadas, requisicoesResposta, ...publicData } = db;
  const { arquivosVistos, ...arquivosContratos } = (integracoes && integracoes.arquivosContratos) || {};
  res.json({
    ...publicData,
    importacoesPendentes: (importacoesPendentes || []).map(i => ({ id: i.id, status: i.status })),
    // Risco de cada contrato pelo mesmo cálculo do Mapa de risco (Painel e tabela de Contratos).
    riscos: mapaRiscoContratos.riscosAtuais(db),
    // Requisições do TCE com resposta pendente (prazo), para o aviso do Início.
    respostasTce: (() => { try { return requisicoes.pendenciasDeResposta(db); } catch (e) { return []; } })(),
    // Histórico administrativo: o que está em aberto (aviso do Início).
    historicoPendentes: historicoContrato.pendentes(db),
    historicoResumo: historicoContrato.resumoPorContrato(db),
    // Valor total de cada contrato (inicial + termos de valor) — ver valorTotalContrato.js.
    valoresTotais: require('./integrations/valorTotalContrato').porContrato(db),
    // Contratos com mudança vinda de termo novo esperando confirmação (menu e Início).
    mudancasPendentes: mudancasPorTermos.listar(db).map(m => ({ contratoId: m.contratoId, numero: m.numero, naFila: m.naFila, campos: m.mudancas.map(x => x.rotulo) })),
    // Criticidade por contrato: perfis de trâmite e os contratos fora do Padrão.
    perfisPrazo: prazosContrato.listarPerfis(db),
    faixasContrato: prazosContrato.faixasForaDoPadrao(db),
    integracoes: { ...(integracoes || {}), arquivosContratos },
    meta: {
      hoje: hojeLocal(),
      tiposServico: TIPOS_SERVICO, secretarias: SECRETARIAS_NOMES,
      papeis: PAPEIS, meuPapel: req.__usuarioRole,
      // A tela esconde o que só existe por causa da API do SGC.
      sgcDesligado: contratosApi.desligada()
    }
  });
});

/* ---------- Contas de acesso da Central de Contratos ----------
   Isto NÃO é o módulo "Usuários & Acessos" do ERP que foi removido — são só
   as contas de login deste app (usuário/senha + papel: admin/gestor/fiscal/
   consulta). Só quem tem papel "admin" pode gerenciar. Pensado para ser
   trocado, no futuro, por login via SSO do Azure AD sem mudar o resto do
   sistema — o conceito de "papel" continua igual, só muda de onde ele vem. */
function publicConta(u) { return { id: u.id, usuario: u.usuario, nome: u.nome, role: u.role || 'admin', email: u.email || '', ligadaAoAd: !!u.entraOid, temSenha: !!u.senhaHash }; }
const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function emailDaConta(valor, idIgnorado) {
  const email = String(valor || '').trim().toLowerCase();
  if (!email) return { email: '' };
  if (!EMAIL_VALIDO.test(email)) return { erro: 'E-mail da Prefeitura inválido.' };
  if ((db.authUsers || []).some(u => u.id !== idIgnorado && String(u.email || '').toLowerCase() === email)) return { erro: 'Já existe uma conta com esse e-mail.' };
  return { email };
}

/* Pedidos de acesso: quem entrou com a conta da Prefeitura sem ter conta
   na Central (ENTRA_SEM_CADASTRO=bloquear). O admin libera criando a conta. */
app.get('/api/contas/pedidos', requireRole('admin'), (req, res) => {
  res.json({ entraLigado: ENTRA.ligado, pedidos: db.pedidosDeAcesso || [] });
});
app.delete('/api/contas/pedidos/:oid', requireRole('admin'), (req, res) => {
  const antes = (db.pedidosDeAcesso || []).length;
  db.pedidosDeAcesso = (db.pedidosDeAcesso || []).filter(p => p.oid !== req.params.oid);
  if (db.pedidosDeAcesso.length !== antes) { registrarAuditoria(req, 'excluir', 'conta', null, 'Pedido de acesso dispensado.'); save(); }
  res.status(204).end();
});

app.get('/api/contas', requireRole('admin'), (req, res) => {
  res.json((db.authUsers || []).map(publicConta));
});

app.post('/api/contas', requireRole('admin'), (req, res) => {
  const { usuario, nome, senha, role } = req.body || {};
  const em = emailDaConta((req.body || {}).email);
  if (em.erro) return res.status(400).json({ error: em.erro });
  // Com e-mail da Prefeitura a pessoa entra pelo AD: a senha é opcional.
  if (!usuario || !nome || (!senha && !em.email)) return res.status(400).json({ error: 'Usuário e nome são obrigatórios, e a senha também quando a conta não tem e-mail da Prefeitura.' });
  if (senha && String(senha).length < SENHA_MINIMA) return res.status(400).json({ error: `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.` });
  if (!PAPEIS.includes(role)) return res.status(400).json({ error: `Papel inválido. Use um de: ${PAPEIS.join(', ')}.` });
  if ((db.authUsers || []).some(u => u.usuario.toLowerCase() === String(usuario).toLowerCase())) {
    return res.status(409).json({ error: 'Já existe uma conta com esse usuário.' });
  }
  const novo = { id: nextId(db.authUsers), usuario, nome, role };
  if (senha) novo.senhaHash = bcrypt.hashSync(String(senha), 10);
  if (em.email) {
    novo.email = em.email;
    // Veio de um pedido de acesso: já liga ao AD e tira o pedido da lista.
    const pedido = (db.pedidosDeAcesso || []).find(p => p.email === em.email);
    if (pedido) { novo.entraOid = pedido.oid; db.pedidosDeAcesso = db.pedidosDeAcesso.filter(p => p !== pedido); }
  }
  db.authUsers.push(novo);
  registrarAuditoria(req, 'criar', 'conta', novo.id, `Conta "${novo.usuario}" (papel: ${novo.role}).`);
  save();
  res.status(201).json(publicConta(novo));
});

app.put('/api/contas/:id', requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  const conta = (db.authUsers || []).find(u => u.id === id);
  if (!conta) return res.status(404).json({ error: 'Conta não encontrada.' });
  const { nome, senha, role } = req.body || {};
  if ((req.body || {}).email !== undefined) {
    const em = emailDaConta(req.body.email, conta.id);
    if (em.erro) return res.status(400).json({ error: em.erro });
    if (!em.email && !conta.senhaHash && !(senha)) return res.status(400).json({ error: 'Sem e-mail da Prefeitura, a conta precisa de uma senha.' });
    // Trocar o e-mail desfaz a ligação com a pessoa do AD (liga de novo no próximo login).
    if (String(conta.email || '') !== em.email) delete conta.entraOid;
    if (em.email) conta.email = em.email; else delete conta.email;
  }
  if (role !== undefined) {
    if (!PAPEIS.includes(role)) return res.status(400).json({ error: `Papel inválido. Use um de: ${PAPEIS.join(', ')}.` });
    if (role !== 'admin' && conta.role === 'admin' && (db.authUsers || []).filter(u => u.role === 'admin').length <= 1) {
      return res.status(400).json({ error: 'Precisa existir pelo menos uma conta com papel admin.' });
    }
    conta.role = role;
  }
  if (nome !== undefined) {
    if (!String(nome).trim()) return res.status(400).json({ error: 'Nome não pode ficar vazio.' });
    conta.nome = nome;
  }
  if (senha !== undefined && senha !== '') {
    if (String(senha).length < SENHA_MINIMA) return res.status(400).json({ error: `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.` });
    conta.senhaHash = bcrypt.hashSync(String(senha), 10);
  }
  registrarAuditoria(req, 'editar', 'conta', conta.id, `Conta "${conta.usuario}" (papel: ${conta.role}).`);
  save();
  res.json(publicConta(conta));
});

app.delete('/api/contas/:id', requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  if (id === req.session.userId) return res.status(400).json({ error: 'Você não pode excluir a própria conta enquanto está logado nela.' });
  const conta = (db.authUsers || []).find(u => u.id === id);
  if (!conta) return res.status(404).json({ error: 'Conta não encontrada.' });
  if (conta.role === 'admin' && (db.authUsers || []).filter(u => u.role === 'admin').length <= 1) {
    return res.status(400).json({ error: 'Precisa existir pelo menos uma conta com papel admin.' });
  }
  db.authUsers = db.authUsers.filter(u => u.id !== id);
  registrarAuditoria(req, 'excluir', 'conta', id, `Conta "${conta.usuario}".`);
  save();
  res.status(204).end();
});

/* ---------- Trilha de auditoria ----------
   Só leitura, só para admin. As entradas são criadas pelas próprias rotas de
   escrita ao longo do arquivo, via registrarAuditoria() (ver definição lá em
   cima). Aqui devolvemos as mais recentes primeiro (já é como são guardadas). */
app.get('/api/auditoria', requireRole('admin'), (req, res) => {
  res.json(db.auditoria || []);
});

/* ---------- Módulo 1: Contratos ----------
   Contratos são só exibidos aqui — o cadastro/edição/exclusão em si vem do
   SGC via /api/integracoes/contratos/sincronizar (mais abaixo). A única
   escrita que continua existindo neste módulo é o histórico de tratativas
   (acompanhamento interno da Central de Contratos, não um dado do contrato). */
// "consulta" é só leitura: tratativas e comentários, de admin, gestor ou fiscal.
app.post('/api/contratos/:id/tratativas', requireRole('admin', 'gestor', 'fiscal'), (req, res) => {
  const { nota, status } = req.body || {};
  if (!nota || !String(nota).trim()) return res.status(400).json({ error: 'Campos obrigatórios ausentes.', missing: ['nota'] });
  const r = historicoContrato.registrar(db, req.params.id, { tipo: 'tratativa', descricao: nota, situacao: status === 'Resolvido' ? 'concluida' : 'aberta' }, req.__usuarioNome || 'Usuário',
    { caminhoPermitido: servidorArquivos.caminhoPermitido });
  if (r.erro) return res.status(r.status || 400).json({ error: r.erro });
  registrarAuditoria(req, 'criar', 'historico', r.registro.id, `Contrato ${r.contrato.numero}: Tratativa interna — ${r.registro.descricao.slice(0, 80)}`);
  save();
  res.status(201).json(r.registro);
});

/* ---------- Histórico administrativo do contrato (06/10/2026) ----------
   Ver integrations/historicoContrato.js. Nada se apaga: correção guarda a
   versão anterior. Registra: admin, gestor, fiscal; consulta só vê. */
app.get('/api/contratos/:id/historico', (req, res) => {
  const l = historicoContrato.linhaDoTempo(db, req.params.id);
  if (!l) return res.status(404).json({ error: 'Contrato não encontrado.' });
  res.json({ ...l, tipos: historicoContrato.TIPOS, situacoes: historicoContrato.SITUACOES });
});
app.post('/api/contratos/:id/historico', requireRole('admin', 'gestor', 'fiscal'), (req, res) => {
  const r = historicoContrato.registrar(db, req.params.id, req.body, req.__usuarioNome || 'Usuário', { caminhoPermitido: servidorArquivos.caminhoPermitido });
  if (r.erro) return res.status(r.status || 400).json({ error: r.erro });
  registrarAuditoria(req, 'criar', 'historico', r.registro.id, `Contrato ${r.contrato.numero}: ${historicoContrato.TIPOS[r.registro.tipo]} — ${r.registro.descricao.slice(0, 80)}`);
  save();
  res.status(201).json({ registro: r.registro, pendentes: historicoContrato.pendentes(db), resumo: historicoContrato.resumoPorContrato(db) });
});
app.put('/api/historico/:id', requireRole('admin', 'gestor', 'fiscal'), (req, res) => {
  const r = historicoContrato.corrigir(db, req.params.id, req.body, req.__usuarioNome || 'Usuário', { caminhoPermitido: servidorArquivos.caminhoPermitido });
  if (r.erro) return res.status(r.status || 400).json({ error: r.erro });
  if (!r.semMudanca) {
    const c = db.contratos.find(x => String(x.id) === String(r.registro.contratoId));
    const ultima = r.registro.versoes[r.registro.versoes.length - 1];
    registrarAuditoria(req, 'editar', 'historico', r.registro.id, `Contrato ${c ? c.numero : r.registro.contratoId}: ${historicoContrato.TIPOS[r.registro.tipo]} — ${ultima.motivo}`);
    save();
  }
  res.json({ registro: r.registro, pendentes: historicoContrato.pendentes(db), resumo: historicoContrato.resumoPorContrato(db) });
});
app.get('/api/contratos/:id/historico/exportar', (req, res) => {
  const l = historicoContrato.linhaDoTempo(db, req.params.id);
  if (!l) return res.status(404).json({ error: 'Contrato não encontrado.' });
  const pdf = req.query.formato === 'pdf';
  registrarAuditoria(req, 'exportar', 'historico', l.contrato.id, `Histórico administrativo do contrato ${l.contrato.numero} (${pdf ? 'PDF' : 'planilha'}).`);
  save();
  const nome = `historico-contrato-${String(l.contrato.numero || l.contrato.id).replace(/[^\w.-]+/g, '-')}-${hojeLocal()}`;
  if (pdf) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}.pdf"`);
    return historicoContrato.gerarPdf(l, res);
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nome}.csv"`);
  res.send(historicoContrato.gerarCsv(l));
});

/* ---------- UFM e gratificação dos gestores (GFE), 06/10/2026 ----------
   Ver integrations/ufm.js. Todos veem; alterar a tabela (valor da UFM e
   faixas): só admin, sempre como versão nova — nada se apaga. */
app.get('/api/ufm', (req, res) => res.json(ufm.montar(db)));
app.post('/api/ufm/versoes', requireRole('admin'), (req, res) => {
  const r = ufm.registrarVersao(db, req.body, req.__usuarioNome || 'Usuário');
  if (r.erro) return res.status(400).json({ error: r.erro });
  const v = r.versao;
  registrarAuditoria(req, 'criar', 'ufm', v.id, `Tabela da UFM a partir de ${dataBr(v.vigenteDesde)}: UFM R$ ${String(v.valorUfm).replace('.', ',')}; gratificações ${v.faixas.map(f => String(f.valor.toFixed(2)).replace('.', ',')).join(' / ')} — ${v.fundamento}.`);
  save();
  res.status(201).json(ufm.montar(db));
});
app.get('/api/ufm/exportar', (req, res) => {
  const tela = ufm.montar(db);
  registrarAuditoria(req, 'exportar', 'ufm', null, `Planilha da UFM e gratificação por contrato (UFM R$ ${String(tela.versao.valorUfm).replace('.', ',')}).`);
  save();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="ufm-gratificacao-gestores-${hojeLocal()}.csv"`);
  res.send(ufm.gerarCsv(tela));
});

/* ---------- Criticidade por contrato: perfis de trâmite (06/10/2026) ----------
   Ver integrations/prazosContrato.js. Perfis: só admin. Escolher o perfil
   de um contrato: admin e gestor. */
function respostaDosPrazos() {
  return { ...prazosContrato.listarPerfis(db), faixasContrato: prazosContrato.faixasForaDoPadrao(db), alertaConfig: db.alertaConfig };
}
app.post('/api/perfis-prazo', requireRole('admin'), (req, res) => {
  const r = prazosContrato.criarPerfil(db, req.body);
  if (r.erro) return res.status(r.status || 400).json({ error: r.erro });
  registrarAuditoria(req, 'criar', 'perfil_prazo', r.perfil.id, `Perfil de trâmite "${r.perfil.nome}": crítico ${r.perfil.critico}, atenção ${r.perfil.atencao}, próximo ${r.perfil.proximo} dias.`);
  save();
  res.status(201).json(respostaDosPrazos());
});
app.put('/api/perfis-prazo/:id', requireRole('admin'), (req, res) => {
  const r = prazosContrato.atualizarPerfil(db, req.params.id, req.body);
  if (r.erro) return res.status(r.status || 400).json({ error: r.erro });
  registrarAuditoria(req, 'editar', 'perfil_prazo', r.perfil.id, `Perfil de trâmite "${r.perfil.nome}": crítico ${r.perfil.critico}, atenção ${r.perfil.atencao}, próximo ${r.perfil.proximo} dias.`);
  save();
  res.json(respostaDosPrazos());
});
app.delete('/api/perfis-prazo/:id', requireRole('admin'), (req, res) => {
  const r = prazosContrato.excluirPerfil(db, req.params.id);
  if (r.erro) return res.status(r.status || 400).json({ error: r.erro });
  registrarAuditoria(req, 'excluir', 'perfil_prazo', r.perfil.id, `Perfil de trâmite "${r.perfil.nome}".`);
  save();
  res.json(respostaDosPrazos());
});
app.put('/api/contratos/:id/prazos', requireRole('admin', 'gestor'), (req, res) => {
  const r = prazosContrato.definirDoContrato(db, req.params.id, req.body, req.__usuarioNome || 'Usuário');
  if (r.erro) return res.status(r.status || 400).json({ error: r.erro });
  const fx = r.faixas;
  registrarAuditoria(req, 'editar', 'contrato', r.contrato.id, `Prazos de alerta do contrato ${r.contrato.numero}: ${fx.nome} (crítico ${fx.critico}, atenção ${fx.atencao}, próximo ${fx.proximo} dias)${fx.motivo ? ` — ${fx.motivo}` : ''}.`);
  save();
  res.json({ faixas: fx, ...respostaDosPrazos() });
});

/* Tudo de um contrato num lugar só (risco, relatórios, requisições,
   garantia, encerramento) — ver integrations/visaoContrato.js. */
app.get('/api/contratos/:id/visao', (req, res) => {
  const v = require('./integrations/visaoContrato').montarVisao(db, req.params.id);
  if (!v) return res.status(404).json({ error: 'Contrato não encontrado.' });
  res.json(v);
});

app.put('/api/config', requireRole('admin'), (req, res) => {
  const { critico, atencao, proximo } = req.body || {};
  const nums = [critico, atencao, proximo].map(Number);
  if (nums.some(n => !Number.isFinite(n) || n <= 0)) {
    return res.status(400).json({ error: 'Os limiares precisam ser números positivos.' });
  }
  if (!(nums[0] < nums[1] && nums[1] < nums[2])) {
    return res.status(400).json({ error: 'Os limiares precisam estar em ordem crescente (crítico < atenção < próximo).' });
  }
  db.alertaConfig = { critico: nums[0], atencao: nums[1], proximo: nums[2] };
  registrarAuditoria(req, 'editar', 'configuracao', null, `Limiares de alerta: crítico=${nums[0]}, atenção=${nums[1]}, próximo=${nums[2]}.`);
  save();
  res.json(db.alertaConfig);
});

/* O módulo Onboarding/Offboarding (rotas /api/colaboradores) foi removido
   em 21/09/2026 a pedido do usuário: nunca teve nenhum registro e a tela
   "Minhas pendências", que dependia dele, saiu junto. */

/* ---------- Comentários internos ----------
   Observações rápidas de equipe, anexáveis a um contrato — não é um módulo
   novo, só um jeito de conversar sobre um item sem precisar de e-mail ou de
   outro sistema. Qualquer papel autenticado pode comentar; só o autor do
   próprio comentário (ou um admin) pode excluí-lo. */
const ENTIDADES_COMENTARIO = ['contrato'];
function publicComentario(c) { return { id: c.id, entidade: c.entidade, entidadeId: c.entidadeId, autor: c.autor, autorId: c.autorId, texto: c.texto, data: c.data }; }

app.get('/api/comentarios', (req, res) => {
  const { entidade, entidadeId } = req.query;
  if (!ENTIDADES_COMENTARIO.includes(entidade) || entidadeId === undefined) {
    return res.status(400).json({ error: 'Informe entidade (contrato) e entidadeId.' });
  }
  const lista = (db.comentarios || [])
    .filter(c => c.entidade === entidade && String(c.entidadeId) === String(entidadeId))
    .sort((a, b) => a.data.localeCompare(b.data));
  res.json(lista.map(publicComentario));
});

app.post('/api/comentarios', requireRole('admin', 'gestor', 'fiscal'), (req, res) => {
  const { entidade, entidadeId, texto } = req.body || {};
  if (!ENTIDADES_COMENTARIO.includes(entidade) || entidadeId === undefined) {
    return res.status(400).json({ error: 'Informe entidade (contrato) e entidadeId.' });
  }
  if (!texto || !String(texto).trim()) return res.status(400).json({ error: 'O comentário não pode ficar vazio.' });
  if (!Array.isArray(db.comentarios)) db.comentarios = [];
  const record = {
    id: nextId(db.comentarios),
    entidade, entidadeId,
    autor: req.__usuarioNome || 'Usuário',
    autorId: req.session.userId, // o nome pode se repetir; o id, não
    texto: String(texto).trim(),
    data: new Date().toISOString()
  };
  db.comentarios.push(record);
  registrarAuditoria(req, 'criar', 'comentario', record.id, `${entidade} #${entidadeId}: ${record.texto.slice(0, 80)}`);
  save();
  res.status(201).json(publicComentario(record));
});

app.delete('/api/comentarios/:id', (req, res) => {
  const idx = (db.comentarios || []).findIndex(c => String(c.id) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Comentário não encontrado.' });
  const comentario = db.comentarios[idx];
  // Pelo id da conta; comentários antigos (sem id) continuam pelo nome.
  const souAutor = comentario.autorId !== undefined ? comentario.autorId === req.session.userId : comentario.autor === req.__usuarioNome;
  if (!souAutor && req.__usuarioRole !== 'admin') {
    return res.status(403).json({ error: 'Só o autor do comentário ou um admin pode excluí-lo.' });
  }
  db.comentarios.splice(idx, 1);
  registrarAuditoria(req, 'excluir', 'comentario', comentario.id, `${comentario.entidade} #${comentario.entidadeId}`);
  save();
  res.status(204).end();
});

/* ---------- Integração com API real de contratos (plugável) ---------- */
app.get('/api/integracoes/contratos/status', (req, res) => {
  res.json({
    ...contratosApi.statusPublico(),
    ultimaSincronizacao: (db.integracoes && db.integracoes.contratosApi && db.integracoes.contratosApi.ultimaSincronizacao) || null,
    ultimoResumo: (db.integracoes && db.integracoes.contratosApi && db.integracoes.contratosApi.ultimoResumo) || null
  });
});

app.post('/api/integracoes/contratos/sincronizar', requireRole('admin'), async (req, res) => {
  if (contratosApi.desligada()) {
    return res.status(410).json({ error: 'A integração com o SGC foi desligada (CONTRATOS_API_DESLIGADA=1 no .env). Nenhum dado é mais consultado nem importado do SGC.' });
  }
  if (!contratosApi.isConfigured()) {
    return res.status(400).json({ error: 'A integração ainda não foi configurada. Defina CONTRATOS_API_URL (e as variáveis de autenticação) antes de sincronizar — veja o README.' });
  }
  try {
    // sincronizarTudo() sincroniza Contratos e, na sequência, tenta Aditivos,
    // Apostilamentos, Requisições e Gratificações — cada uma só roda se sua
    // própria URL (CONTRATOS_API_URL_*) já estiver configurada no .env.
    const resumo = await contratosApi.sincronizarTudo(db, save, nextId);
    res.json({ ok: true, resumo, ultimaSincronizacao: db.integracoes.contratosApi.ultimaSincronizacao });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Falha ao sincronizar com a API de contratos.' });
  }
});

/* ---------- Resumo diário de alertas por e-mail (Microsoft Graph) ----------
   Dormente até GRAPH_MAIL_* estar configurado no servidor — ver
   integrations/graphMail.js e integrations/resumoAlertas.js. Enquanto isso,
   o status abaixo só informa "não configurado" e o agendamento diário (mais
   abaixo, perto do app.listen) não faz nenhuma chamada de rede. */
app.get('/api/integracoes/alertas-email/status', (req, res) => {
  res.json({
    ...graphMail.statusPublico(),
    destinatariosFixos: resumoAlertas.DESTINATARIOS_FIXOS,
    ultimoEnvio: (db.integracoes && db.integracoes.resumoAlertas && db.integracoes.resumoAlertas.ultimoEnvio) || null,
    ultimoResultado: (db.integracoes && db.integracoes.resumoAlertas && db.integracoes.resumoAlertas.ultimoResultado) || null
  });
});

app.post('/api/integracoes/alertas-email/enviar-agora', requireRole('admin'), async (req, res) => {
  if (!graphMail.isConfigured()) {
    return res.status(400).json({ error: 'Microsoft Graph ainda não foi configurado — defina GRAPH_MAIL_TENANT_ID, GRAPH_MAIL_CLIENT_ID, GRAPH_MAIL_CLIENT_SECRET e GRAPH_MAIL_REMETENTE antes de enviar.' });
  }
  const resultado = await resumoAlertas.enviarResumoDiario(db);
  db.integracoes.resumoAlertas = { ultimoEnvio: new Date().toISOString(), ultimoResultado: resultado };
  registrarAuditoria(req, 'editar', 'configuracao', null, `Resumo de alertas por e-mail disparado manualmente — ${resultado.enviado ? `${resultado.totalContratos} contrato(s)` : resultado.motivo}.`);
  save();
  res.json(resultado);
});

/* ---------- Ingestão automatizada a partir da pasta de rede (Ferramenta 1)
   ----------
   Dormente até CONTRATOS_ARQUIVOS_PASTAS estar configurado — ver
   integrations/servidorArquivos.js, integrations/extratorDocumento.js,
   integrations/leituraPorRegra.js e integrations/ingestaoContratos.js.

   Nada aqui escreve direto em `contratos`: toda varredura só propõe itens
   em `importacoesPendentes`, e só vira contrato de verdade quando alguém
   com papel gestor/admin aprova explicitamente (ver POST .../aprovar). */
app.get('/api/integracoes/arquivos/status', (req, res) => {
  res.json({
    pastas: servidorArquivos.statusPublico(),
    ultimaVarredura: (db.integracoes && db.integracoes.arquivosContratos && db.integracoes.arquivosContratos.ultimaVarredura) || null,
    ultimoResumo: (db.integracoes && db.integracoes.arquivosContratos && db.integracoes.arquivosContratos.ultimoResumo) || null,
    // A tela mostra só o estado: em andamento, concluída ou com erro.
    // O erro fica guardado para aparecer mesmo depois de recarregar a página.
    ultimoErro: (db.integracoes && db.integracoes.arquivosContratos && db.integracoes.arquivosContratos.ultimoErro) || null,
    progresso: ingestaoContratos.obterProgresso()
  });
});

/* Progresso da varredura em andamento — só em memória (ver
   integrations/ingestaoContratos.js), consultado pela tela por polling
   enquanto o botão "Varrer pastas agora" está desabilitado. Existe pra
   deixar claro que uma varredura demorada (normal quando há OCR de PDF
   digitalizado) está de fato progredindo, não travada. */
app.get('/api/integracoes/arquivos/progresso', (req, res) => {
  res.json(ingestaoContratos.obterProgresso());
});

app.post('/api/integracoes/arquivos/varrer', requireRole('admin', 'gestor'), async (req, res) => {
  if (!ingestaoContratos.isConfigured()) {
    return res.status(400).json({ error: 'Nenhuma pasta de rede configurada — defina CONTRATOS_ARQUIVOS_PASTAS antes de varrer (veja o README).' });
  }
  try {
    const resumo = await ingestaoContratos.varrerEProporImportacoes(db, save, nextId);
    // `totalArquivosAlterados` (não `totalCandidatos`) é o número que
    // corresponde a "novos/alterados" — ver a nota em
    // servidorArquivos.listarArquivosNovosOuAlterados. A tela já foi
    // corrigida antes; esta linha de auditoria tinha ficado para trás e
    // registrava "N arquivo(s) novos/alterados" contando TODO arquivo já
    // visto antes.
    registrarAuditoria(req, 'sincronizar', 'importacao', null, `Varredura de pastas: ${resumo.propostas} proposta(s), ${resumo.semTexto} sem texto, ${resumo.erros} erro(s), de ${resumo.totalArquivosAlterados} arquivo(s) novo(s)/alterado(s) (${resumo.totalCandidatos} encontrado(s) no total).`);
    if (db.integracoes && db.integracoes.arquivosContratos) delete db.integracoes.arquivosContratos.ultimoErro;
    save();
    res.json({ ok: true, resumo });
  } catch (err) {
    db.integracoes = db.integracoes || {};
    db.integracoes.arquivosContratos = db.integracoes.arquivosContratos || { ultimaVarredura: null, ultimoResumo: null, arquivosVistos: {} };
    db.integracoes.arquivosContratos.ultimoErro = { em: new Date().toISOString(), mensagem: err.message || 'Falha ao varrer as pastas de arquivos.' };
    save();
    res.status(502).json({ error: err.message || 'Falha ao varrer as pastas de arquivos.' });
  }
});

/* Navegação manual de pastas (ver README, seção "Seleção manual de
   arquivos") — quem usa entra na árvore de pastas configuradas e escolhe
   exatamente quais arquivos processar, em vez de esperar a varredura
   automática decidir sozinha. Só lista nome/tamanho/data — nunca lê
   conteúdo de arquivo aqui (isso só acontece se algo for de fato
   selecionado e mandado pro endpoint de extração abaixo). Mesmo papel
   exigido do botão "Varrer pastas agora": expor a árvore de pastas da
   rede, mesmo só os nomes, é uma ação de quem administra a integração,
   não de qualquer pessoa logada. */
app.get('/api/integracoes/arquivos/pastas', requireRole('admin', 'gestor'), (req, res) => {
  try {
    const conteudo = servidorArquivos.listarConteudoDePasta(req.query.caminho || null);
    res.json(conteudo);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* Seleção manual a partir do Explorer do Windows — ver a nota em
   servidorArquivos.js ("Seleção manual a partir do Explorer"). Só
   localizam; a extração continua passando por extrair-selecionados. */
app.post('/api/integracoes/arquivos/resolver-caminho', requireRole('admin', 'gestor'), (req, res) => {
  try {
    res.json(servidorArquivos.resolverCaminhoColado((req.body || {}).caminho));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/integracoes/arquivos/localizar', requireRole('admin', 'gestor'), async (req, res) => {
  try {
    res.json(await servidorArquivos.localizarArquivos((req.body || {}).arquivos));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/integracoes/arquivos/extrair-selecionados', requireRole('admin', 'gestor'), async (req, res) => {
  if (!ingestaoContratos.isConfigured()) {
    return res.status(400).json({ error: 'Nenhuma pasta de rede configurada — defina CONTRATOS_ARQUIVOS_PASTAS antes de extrair (veja o README).' });
  }
  const caminhos = Array.isArray((req.body || {}).caminhos) ? req.body.caminhos : [];
  try {
    const resultado = await ingestaoContratos.processarArquivosSelecionados(db, save, nextId, caminhos);
    registrarAuditoria(req, 'sincronizar', 'importacao', resultado.propostaId || null, `Extração manual de ${caminhos.length} arquivo(s) selecionado(s).`);
    res.json({ ok: true, ...resultado });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Falha ao processar os arquivos selecionados.' });
  }
});

app.get('/api/importacoes', (req, res) => {
  res.json(db.importacoesPendentes || []);
});

app.post('/api/importacoes/:id/aprovar', requireRole('admin', 'gestor'), async (req, res) => {
  try {
    const contrato = ingestaoContratos.aprovarImportacao(db, save, nextId, req.params.id, req.body || {}, req.__usuarioNome);
    /* Quando a aprovação MESCLA numa ficha de contrato que já existia, os
       valores anteriores dos campos trocados vão junto para a auditoria —
       é a única forma de, depois, saber o que havia antes de uma leitura
       de documento substituir um dado (que pode ter vindo do SGC). Ver
       `camposSobrescritos` em integrations/ingestaoContratos.js. */
    const proposta = (db.importacoesPendentes || []).find(i => String(i.id) === String(req.params.id));
    const sobrescritos = (proposta && proposta.camposSobrescritos) || [];
    const detalheTrocas = sobrescritos.length
      ? ` Substituiu ${sobrescritos.length} campo(s): ${sobrescritos.map(s => `${s.campo} ("${s.de}" -> "${s.para}")`).join('; ')}.`
      : '';
    registrarAuditoria(req, 'aprovar', 'importacao', req.params.id, `Contrato ${contrato.numero} (${contrato.id}).${detalheTrocas}`);
    save(); // a aprovação já gravou; sem isto, a linha de auditoria só ia para o disco na próxima gravação
    /* Mapa de risco na hora (01/10/2026): contrato ativo aprovado já entra
       no Mapa com a análise, em vez de esperar alguém clicar em "Gerar
       análise". Só com o texto já lido na varredura (sem OCR novo — leva
       menos de um segundo); documento lido em parte não vira "cláusula não
       localizada". "Atualizar a análise" lê os documentos inteiros.
       Contrato encerrado também ganha a análise (só Conteúdo e Gestão — ver
       o filtro "Encerrados" do Mapa). Uma falha aqui não desfaz a aprovação. */
    let mapaRisco = null;
    if (contrato.arquivoOrigem) {
      try {
        const registro = await mapaRiscoContratos.gerarMapaRisco(db, save, nextId, contrato.id, req.__usuarioNome, { soCache: true, modo: 'aprovacao' });
        mapaRisco = { riscoGeralLabel: registro.riscoGeralLabel };
        registrarAuditoria(req, 'gerar', 'mapa_risco', contrato.id, `Gerado ao aprovar o contrato ${contrato.numero} (só o texto já lido). Risco geral: ${registro.riscoGeralLabel}.`);
      } catch (err) {
        mapaRisco = { erro: err.message };
        registrarAuditoria(req, 'gerar', 'mapa_risco', contrato.id, `Não foi possível gerar o mapa ao aprovar o contrato ${contrato.numero}: ${err.message}`);
      }
      save();
    }
    res.json({ ...contrato, _mapaRisco: mapaRisco });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ---------- Base de Contratos ----------
   Tabela única com o que a Ferramenta 1 leu dos arquivos — separando o
   que já foi CONFIRMADO por revisão humana do que ainda é só leitura
   automática. Ver integrations/baseContratos.js para a regra completa. */
app.get('/api/base-contratos', (req, res) => {
  res.json(baseContratos.montarBase(db));
});

/* Tudo o que foi lido e calculado para uma linha da base ("Visualizar"). */
app.get('/api/base-contratos/detalhe/:propostaId', (req, res) => {
  const detalhe = baseContratos.montarDetalhe(db, req.params.propostaId);
  if (!detalhe) return res.status(404).json({ error: 'Registro não encontrado.' });
  res.json(detalhe);
});

app.get('/api/base-contratos/exportar', (req, res) => {
  const escopo = req.query.escopo === 'todas' ? 'todas' : 'aprovadas';
  const base = baseContratos.montarBase(db);
  const csv = baseContratos.gerarCsv(base, escopo);
  const qtd = escopo === 'todas' ? base.linhas.length : base.totais.aprovadas;
  // Exportar tira os dados de contrato da Central — fica registrado.
  registrarAuditoria(req, 'exportar', 'base_contratos', null, `${qtd} contrato(s) exportado(s) (${escopo === 'todas' ? 'todas as linhas, inclusive pendentes de revisão' : 'só aprovadas'}).`);
  save();
  const hoje = hojeLocal();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="base-contratos-${escopo}-${hoje}.csv"`);
  res.send(csv);
});

/* ---------- Base de termos (aditivos e apostilamentos) ----------
   Os termos do SGC cruzados com o efeito que a leitura calculou em cada
   um (quanto somou ao valor, quantos meses prorrogou) — ver
   integrations/baseTermos.js. */
app.get('/api/base-termos', (req, res) => {
  res.json(baseTermos.montarBase(db));
});

app.get('/api/base-termos/exportar', (req, res) => {
  const escopos = ['todas', 'aditivos', 'apostilamentos', 'aprovados'];
  const escopo = escopos.includes(req.query.escopo) ? req.query.escopo : 'todas';
  const base = baseTermos.montarBase(db);
  const csv = baseTermos.gerarCsv(base, escopo);
  registrarAuditoria(req, 'exportar', 'base_termos', null, `Termos exportados (escopo: ${escopo}) — ${base.totais.termos} no total.`);
  save();
  const hoje = hojeLocal();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="base-termos-${escopo}-${hoje}.csv"`);
  res.send(csv);
});

/* ---------- Pendências de leitura ----------
   As propostas pendentes agrupadas pelo motivo de faltar término,
   início ou valor — e o formulário para informar o dado que falta (quase
   sempre a data da Ordem de Início). Ver integrations/pendenciasLeitura.js. */
app.get('/api/pendencias-leitura', (req, res) => {
  // + mudanças no contrato vindas de termo novo (ver mudancasPorTermos.js)
  res.json({ ...pendenciasLeitura.resumir(db), mudancas: mudancasPorTermos.listar(db) });
});

/* Confirmar ou descartar uma mudança relida dos documentos (término,
   valor mensal, gestor ou suplente) num contrato já aprovado. */
app.post('/api/pendencias-leitura/mudanca/:contratoId', requireRole('admin', 'gestor'), (req, res) => {
  try {
    const { campo, acao } = req.body || {};
    const r = mudancasPorTermos.decidir(db, req.params.contratoId, String(campo || ''), String(acao || ''), req.__usuarioNome, new Date().toISOString());
    const fmt = v => v == null ? '—' : (r.campo === 'termino' ? dataBr(v) : r.campo === 'valor' ? `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : String(v));
    registrarAuditoria(req, 'editar', 'contrato', r.numero,
      acao === 'confirmar'
        ? `${r.rotulo} atualizado pela releitura dos documentos: ${fmt(r.de)} → ${fmt(r.para)} (${r.motivo}${r.documento ? `; ${r.documento}` : ''}).`
        : `${r.rotulo} relido como ${fmt(r.para)} — descartado; o cadastro continua ${fmt(r.de)}.`);
    save();
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* Trechos dos documentos que falam do assunto do grupo — só do cache de
   texto, nunca dispara OCR. */
app.get('/api/pendencias-leitura/:propostaId/trechos', async (req, res) => {
  try {
    const r = await pendenciasLeitura.trechos(db, req.params.propostaId, String(req.query.grupo || ''));
    if (!r) return res.status(404).json({ error: 'Proposta não encontrada.' });
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Falha ao ler os trechos dos documentos.' });
  }
});

/* Grava o dado informado à mão e recalcula a vigência pela mesma regra.
   Fica na trilha de auditoria: é dado que não veio de documento lido. */
app.post('/api/pendencias-leitura/:propostaId/aplicar', requireRole('admin', 'gestor'), async (req, res) => {
  try {
    const r = await pendenciasLeitura.aplicarDadoManual(db, save, req.params.propostaId, req.body || {}, req.__usuarioNome);
    const informado = Object.entries(req.body || {})
      .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
      .map(([k, v]) => `${k}=${String(v).slice(0, 60)}`)
      .join(', ');
    registrarAuditoria(req, 'editar', 'importacao', req.params.propostaId,
      `Dado informado à mão na proposta ${r.numero || req.params.propostaId} (${informado}). Campos atualizados: ${r.alterados.map(a => a.campo).join(', ') || 'nenhum'}.`);
    save();
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* Termo de encerramento achado na pasta: confirmar (o contrato vira
   Encerrado) ou descartar. Nunca muda o cadastro sem esta decisão — ver
   termoEncerramento.js. */
app.post('/api/pendencias-leitura/encerramento/:contratoId', requireRole('admin', 'gestor'), (req, res) => {
  try {
    const acao = String((req.body || {}).acao || '');
    const r = pendenciasLeitura.decidirEncerramento(db, req.params.contratoId, acao, req.__usuarioNome);
    registrarAuditoria(req, 'editar', 'contrato', r.numero,
      acao === 'confirmar'
        ? `Encerramento confirmado pelo termo "${r.arquivo}"${r.data ? ` (encerrado em ${dataBr(r.data)})` : ''}: contrato passa a Encerrado.`
        : `Termo "${r.arquivo}" descartado: não é o encerramento deste contrato. O cadastro não mudou.`);
    save();
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ---------- Registro de riscos (modelo SGC) ----------
   A planilha "MAPA DE RISCOS EM CONTRATOS DA PM ITAVERDE" dentro do
   sistema: riscos automáticos (legislação de contratos, a partir dos
   documentos lidos) e o registro do gestor (riscos e problemas). Ver
   integrations/registroRiscos.js. */
app.get('/api/registro-riscos', (req, res) => {
  res.json({ itens: registroRiscos.resumirTodos(db), listas: registroRiscos.LISTAS });
});

app.get('/api/registro-riscos/:contratoId', (req, res) => {
  const r = registroRiscos.montarRegistro(db, req.params.contratoId);
  if (!r) return res.status(404).json({ error: 'Contrato não encontrado.' });
  res.json({ ...r, listas: registroRiscos.LISTAS });
});

app.post('/api/registro-riscos/:contratoId', requireRole('admin', 'gestor'), (req, res) => {
  try {
    const corpo = req.body || {};
    const novo = registroRiscos.registrar(db, req.params.contratoId, corpo.registro, corpo, req.__usuarioNome);
    const contrato = (db.contratos || []).find(c => String(c.id) === String(req.params.contratoId));
    registrarAuditoria(req, 'criar', novo.registro === 'issue' ? 'problema_contrato' : 'risco_contrato', novo.id,
      `${novo.registro === 'issue' ? 'Problema' : 'Risco'} no contrato ${contrato ? contrato.numero : req.params.contratoId}: ${String(novo.titulo || novo.descricao || novo.codigoAutomatico || '').slice(0, 120)}${novo.criticidade ? ` (criticidade ${novo.criticidade}, ${novo.criterio})` : ''}.`);
    save();
    res.json(novo);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/registro-riscos/:contratoId/:id', requireRole('admin', 'gestor'), (req, res) => {
  try {
    const r = registroRiscos.atualizar(db, req.params.contratoId, req.params.id, req.body || {}, req.__usuarioNome);
    registrarAuditoria(req, 'editar', r.registro === 'issue' ? 'problema_contrato' : 'risco_contrato', r.id,
      `Status: ${r.status}${r.criticidade ? `; criticidade ${r.criticidade} (${r.criterio})` : ''}.`);
    save();
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* Planilha no layout das abas "Riscos" e "Issues" do modelo do SGC. */
app.get('/api/registro-riscos/:contratoId/exportar', (req, res) => {
  const r = registroRiscos.montarRegistro(db, req.params.contratoId);
  if (!r) return res.status(404).json({ error: 'Contrato não encontrado.' });
  const aba = req.query.aba === 'issues' ? 'issues' : 'riscos';
  const csv = aba === 'issues' ? registroRiscos.gerarCsvIssues(r) : registroRiscos.gerarCsvRiscos(r);
  registrarAuditoria(req, 'exportar', 'registro_riscos', req.params.contratoId, `Registro de ${aba} do contrato ${r.painel.contrato} exportado.`);
  save();
  const nome = `mapa-de-riscos-${aba}-${String(r.painel.contrato || req.params.contratoId).replace(/[^\w-]+/g, '-')}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
  res.send(csv);
});

/* ---------- Requisições (TCE-SP e SisFin) ----------
   Lidas dos documentos da pasta de rede, por regra — ver
   integrations/requisicoes.js. A leitura roda em segundo plano (a rota
   responde 202) e só lê: nunca altera nem move documento. A do TCE vira a
   ficha do formulário "Cadastrar Requisição" do SGC. */
app.get('/api/requisicoes', (req, res) => {
  res.json(requisicoes.listar(db));
});

app.get('/api/requisicoes/progresso', (req, res) => {
  res.json(requisicoes.obterProgresso());
});

app.post('/api/requisicoes/ler', requireRole('admin', 'gestor'), (req, res) => {
  const autor = { __usuarioNome: req.__usuarioNome, __usuarioRole: req.__usuarioRole };
  try {
    const p = requisicoes.iniciarLeitura(db, save, (err, resumo) => {
      registrarAuditoria(autor, 'sincronizar', 'requisicao', null, err
        ? `Leitura das requisições falhou: ${err.message}`
        : `Leitura das requisições: ${resumo.documentos} documento(s) — ${resumo.sisfin} do SisFin, ${resumo.tce} do TCE-SP, ${resumo.anexos} anexo(s) ignorado(s)${resumo.erros.length ? `, ${resumo.erros.length} com erro` : ''}.`);
      save();
    });
    res.status(202).json(p);
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

app.post('/api/requisicoes/conferir', requireRole('admin', 'gestor'), (req, res) => {
  try {
    const corpo = req.body || {};
    const r = requisicoes.conferir(db, String(corpo.chave || ''), corpo, req.__usuarioNome);
    const alterados = Object.entries(r.campos || {}).map(([k, v]) => `${k}=${v == null ? '(vazio)' : String(v).slice(0, 60)}`).join(', ');
    registrarAuditoria(req, 'editar', 'requisicao', r.chave,
      r.status === 'lida' ? 'Conferência desfeita: volta a "a conferir".'
        : `${r.status === 'descartada' ? 'Descartada' : 'Conferida'}${alterados ? ` — campos: ${alterados}` : ''}.`);
    save();
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/requisicoes/ficha', (req, res) => {
  const g = requisicoes.montarGrupos(db).find(x => x.chave === String(req.query.chave || ''));
  if (!g || g.origem !== 'tce') return res.status(404).json({ error: 'Requisição do TCE não encontrada.' });
  registrarAuditoria(req, 'exportar', 'requisicao', g.chave, `Ficha de cadastro (SGC) da requisição ${g.ficha.requisicao || g.ficha.tc || ''} gerada.`);
  save();
  const nome = `ficha-requisicao-${String(g.ficha.requisicao || g.ficha.tc || 'tce').replace(/[^\w-]+/g, '-')}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
  requisicoes.gerarFichaPdf(g, res);
});

/* Onde está a resposta de uma requisição do TCE: os itens pedidos e, para
   cada um, as pastas do processo (ver direcionamentoRequisicao.js). A
   Central não responde — só indica onde procurar. */
app.get('/api/requisicoes/direcionamento', (req, res) => {
  const r = requisicoes.direcionamentoDoGrupo(db, String(req.query.chave || ''));
  if (!r) return res.status(404).json({ error: 'Requisição do TCE não encontrada.' });
  res.json(r);
});

app.get('/api/requisicoes/processos', requireRole('admin', 'gestor', 'fiscal'), (req, res) => {
  res.json(require('./integrations/direcionamentoRequisicao').listarProcessos(servidorArquivos.statusPublico().pastas)
    .map(p => ({ caminho: p.caminho, nome: p.nome, pa: p.pa, categoria: p.categoria })));
});

/* Documento de pergunta enviado pela tela (PDF ou Word, até 25 MB): lido
   num arquivo temporário, sem cache, e apagado em seguida — só o
   resultado (itens e pastas) fica guardado. */
app.post('/api/requisicoes/analisar', requireRole('admin', 'gestor', 'fiscal'), express.raw({ type: () => true, limit: '25mb' }), async (req, res) => {
  const os = require('os');
  const crypto = require('crypto');
  const fsp = require('fs');
  let nome = 'documento';
  try { nome = decodeURIComponent(String(req.get('x-nome-arquivo') || 'documento')); } catch (e) { /* nome estranho: fica "documento" */ }
  const corpo = req.body;
  if (!Buffer.isBuffer(corpo) || !corpo.length) return res.status(400).json({ error: 'Envie o arquivo da requisição (PDF ou Word).' });
  const ehPdf = corpo.slice(0, 5).toString('latin1') === '%PDF-';
  const ehDocx = corpo.slice(0, 2).toString('latin1') === 'PK' && /\.docx$/i.test(nome);
  if (!ehPdf && !ehDocx) return res.status(400).json({ error: 'Formato não aceito: envie PDF ou Word (.docx).' });
  const temp = require('path').join(os.tmpdir(), `central-requisicao-${crypto.randomBytes(8).toString('hex')}.${ehPdf ? 'pdf' : 'docx'}`);
  try {
    fsp.writeFileSync(temp, corpo);
    const r = await require('./integrations/extratorDocumento').extrairTexto(temp, { semCache: true });
    if (!r || r.semTexto || !String(r.texto || '').trim()) return res.status(422).json({ error: 'Não foi possível ler texto neste documento (nem por OCR).' });
    const a = requisicoes.analisarDocumento(db, { texto: r.texto, nomeArquivo: nome, usuario: req.__usuarioNome, porOcr: !!(r.ocr && r.ocr.tentado) });
    registrarAuditoria(req, 'sincronizar', 'requisicao', `analise-${a.id}`,
      `Requisição analisada ("${a.nomeArquivo}"): ${a.itensPedidos.length} item(ns) pedido(s); processo ${a.processo ? a.processo.nome : 'não identificado'}.`);
    save();
    res.json(a);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Falha ao ler o documento.' });
  } finally {
    try { fsp.unlinkSync(temp); } catch (e) { /* já apagado */ }
  }
});

/* Resposta ao Tribunal: marcar como respondida (data e ofício/protocolo)
   ou desfazer. Vale para a requisição da pasta (chave) e para a enviada
   pela tela (analiseId). */
app.post('/api/requisicoes/resposta', requireRole('admin', 'gestor', 'fiscal'), (req, res) => {
  try {
    const r = requisicoes.registrarResposta(db, req.body || {}, req.__usuarioNome);
    registrarAuditoria(req, 'editar', 'requisicao', r.chave, r.respondida ? `Resposta ao Tribunal registrada em ${dataBr(r.em)}${r.oficio ? ` (${r.oficio})` : ''}.` : 'Resposta ao Tribunal desfeita: volta a pendente.');
    save();
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/requisicoes/analisadas/:id/processo', requireRole('admin', 'gestor', 'fiscal'), (req, res) => {
  try {
    const a = requisicoes.refazerAnalise(db, req.params.id, (req.body || {}).caminho || null);
    registrarAuditoria(req, 'editar', 'requisicao', `analise-${a.id}`, `Direcionamento refeito com o processo ${a.processo.nome}.`);
    save();
    res.json(a);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/requisicoes/analisadas/:id', requireRole('admin', 'gestor'), (req, res) => {
  const lista = db.requisicoesAnalisadas || [];
  const i = lista.findIndex(a => String(a.id) === String(req.params.id));
  if (i < 0) return res.status(404).json({ error: 'Análise não encontrada.' });
  const [a] = lista.splice(i, 1);
  registrarAuditoria(req, 'excluir', 'requisicao', `analise-${a.id}`, `Análise da requisição "${a.nomeArquivo}" removida da lista.`);
  save();
  res.status(204).end();
});

app.get('/api/requisicoes/exportar', (req, res) => {
  const origem = req.query.origem === 'sisfin' ? 'sisfin' : 'tce';
  const csv = requisicoes.gerarCsv(db, origem);
  registrarAuditoria(req, 'exportar', 'requisicao', origem, `Planilha de requisições (${origem === 'tce' ? 'TCE-SP' : 'SisFin'}) exportada.`);
  save();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="requisicoes-${origem}-${hojeLocal()}.csv"`);
  res.send(csv);
});

/* ---------- Relatórios mensais de todos os contratos ----------
   O que está na subpasta "Relatórios mensais de atividades" de cada
   processo, com o mês de cada arquivo e os meses da vigência sem
   relatório — ver integrations/relatoriosMensais.js. Só lista; o download
   entrega apenas arquivo achado na última leitura e dentro das pastas
   configuradas. */
const relatoriosMensais = require('./integrations/relatoriosMensais');
app.get('/api/relatorios-mensais', (req, res) => {
  res.json(relatoriosMensais.listar(db));
});

app.get('/api/relatorios-mensais/processo', (req, res) => {
  const p = relatoriosMensais.processo(db, String(req.query.caminho || ''));
  if (!p) return res.status(404).json({ error: 'Processo não encontrado — leia as pastas de novo.' });
  res.json(p);
});

/* Indicadores lidos do conteúdo dos últimos 12 relatórios do processo
   (sob pedido; ver integrations/indicadoresRelatorios.js). */
app.get('/api/relatorios-mensais/indicadores', async (req, res) => {
  try {
    res.json(await require('./integrations/indicadoresRelatorios').indicadoresDoProcesso(db, String(req.query.caminho || '')));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/relatorios-mensais/ler', requireRole('admin', 'gestor', 'fiscal'), async (req, res) => {
  try {
    const r = await relatoriosMensais.ler(db, save, servidorArquivos.statusPublico().pastas);
    registrarAuditoria(req, 'sincronizar', 'relatorio_mensal', null, `Leitura das pastas de relatórios mensais: ${r.arquivos} arquivo(s) em ${r.comPasta} processo(s); ${r.semMes} sem mês identificado.`);
    save();
    res.json(r);
  } catch (err) {
    res.status(/em andamento/.test(err.message) ? 409 : 502).json({ error: err.message });
  }
});

app.get('/api/relatorios-mensais/arquivo', (req, res) => {
  const a = relatoriosMensais.arquivoPorId(db, String(req.query.id || ''));
  if (!a) return res.status(404).json({ error: 'Arquivo não encontrado — leia as pastas de novo.' });
  if (!require('fs').existsSync(a.caminho)) return res.status(404).json({ error: 'O arquivo não está mais na pasta (foi movido ou apagado) — leia as pastas de novo.' });
  registrarAuditoria(req, 'exportar', 'relatorio_mensal', a.id, `Relatório aberto: "${a.nome}" (${a.processo}).`);
  save();
  // PDF abre no navegador; os outros baixam.
  const nomeCodificado = encodeURIComponent(a.nome);
  res.setHeader('Content-Disposition', `${/\.pdf$/i.test(a.nome) ? 'inline' : 'attachment'}; filename="${a.nome.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${nomeCodificado}`);
  res.sendFile(a.caminho, { dotfiles: 'allow' }, err => { if (err && !res.headersSent) res.status(500).json({ error: 'Falha ao ler o arquivo.' }); });
});

app.post('/api/relatorios-mensais/nao-exige', requireRole('admin', 'gestor'), (req, res) => {
  try {
    const { caminho, naoExige, motivo } = req.body || {};
    const r = relatoriosMensais.marcarNaoExige(db, String(caminho || ''), !!naoExige, motivo, req.__usuarioNome);
    registrarAuditoria(req, 'editar', 'relatorio_mensal', r.processo, r.naoExige ? `Marcado como "não exige relatório mensal"${motivo ? `: ${String(motivo).slice(0, 120)}` : ''}.` : 'Volta a exigir relatório mensal.');
    save();
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/relatorios-mensais/exportar', (req, res) => {
  const tipo = ['faltas', 'fora_do_padrao'].includes(req.query.tipo) ? req.query.tipo : 'arquivos';
  const csv = relatoriosMensais.gerarCsv(db, tipo);
  registrarAuditoria(req, 'exportar', 'relatorio_mensal', tipo, tipo === 'faltas' ? 'Planilha dos meses sem relatório exportada.' : tipo === 'fora_do_padrao' ? 'Planilha dos relatórios fora do padrão de nome exportada.' : 'Planilha dos relatórios mensais exportada.');
  save();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="relatorios-mensais-${tipo}-${hojeLocal()}.csv"`);
  res.send(csv);
});

/* ---------- Fichas de cadastro do SGC: aditivo, apostilamento, empresa ----------
   Ver integrations/fichasSgc.js. ?formato=pdf baixa o PDF. */
const fichasSgc = require('./integrations/fichasSgc');
function responderFicha(req, res, ficha, nomeArquivo) {
  if (!ficha) return res.status(404).json({ error: 'Registro não encontrado.' });
  if (req.query.formato !== 'pdf') return res.json(ficha);
  registrarAuditoria(req, 'exportar', 'ficha_sgc', null, `${ficha.titulo}: ${ficha.referencia}.`);
  save();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo.replace(/[^\w.-]+/g, '-')}"`);
  fichasSgc.gerarPdf(ficha, res);
}
app.get('/api/fichas-sgc/termo/:especie/:id', (req, res) => {
  const especie = req.params.especie === 'apostilamento' ? 'apostilamento' : 'aditivo';
  const f = fichasSgc.fichaDoTermo(db, especie, req.params.id);
  responderFicha(req, res, f, `ficha-${especie}-${f ? f.referencia : req.params.id}.pdf`);
});
app.get('/api/fichas-sgc/empresa/:contratoId', (req, res) => {
  const f = fichasSgc.fichaDaEmpresa(db, req.params.contratoId);
  responderFicha(req, res, f, `ficha-empresa-${req.params.contratoId}.pdf`);
});

/* ---------- Telas Aditivos e Apostilamentos (07/10/2026) ----------
   Os termos do cadastro com os campos do formulário do SGC, a situação do
   contrato e a nova data de término — ver integrations/listaTermos.js. */
const listaTermos = require('./integrations/listaTermos');
app.get('/api/termos/:qual', (req, res) => {
  const r = listaTermos.listar(db, req.params.qual);
  if (!r) return res.status(404).json({ error: 'Use aditivos ou apostilamentos.' });
  res.json(r);
});

/* ---------- Leituras reportadas como erradas ----------
   Ver integrations/leiturasReportadas.js. Quem confere reporta; o admin
   acompanha e marca como resolvida (regra ajustada). */
const leiturasReportadas = require('./integrations/leiturasReportadas');
app.get('/api/leituras-reportadas', (req, res) => {
  res.json(db.leiturasReportadas || []);
});
app.post('/api/leituras-reportadas', requireRole('admin', 'gestor', 'fiscal'), (req, res) => {
  try {
    const r = leiturasReportadas.registrar(db, req.body || {}, req.__usuarioNome);
    registrarAuditoria(req, 'criar', 'leitura_reportada', r.id, `Leitura errada reportada (${r.onde}${r.referencia ? `, ${r.referencia}` : ''}): ${r.campo} — lido "${String(r.valorLido || '').slice(0, 60)}", certo "${String(r.valorCorreto || '').slice(0, 60)}".`);
    save();
    res.status(201).json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.put('/api/leituras-reportadas/:id/resolver', requireRole('admin'), (req, res) => {
  try {
    const r = leiturasReportadas.resolver(db, req.params.id, (req.body || {}).nota, req.__usuarioNome);
    registrarAuditoria(req, 'editar', 'leitura_reportada', r.id, r.status === 'resolvida' ? 'Leitura reportada marcada como resolvida.' : 'Leitura reportada reaberta.');
    save();
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.get('/api/leituras-reportadas/exportar', (req, res) => {
  const csv = leiturasReportadas.gerarCsv(db);
  registrarAuditoria(req, 'exportar', 'leitura_reportada', null, 'Planilha de leituras reportadas exportada.');
  save();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="leituras-reportadas-${hojeLocal()}.csv"`);
  res.send(csv);
});

/* ---------- Busca dentro dos documentos já lidos ----------
   Texto do cache (CPF mascarado), em memória — ver buscaDocumentos.js.
   A busca e o documento aberto ficam na auditoria (buscar um nome em
   todos os contratos é um acesso a dado que precisa de registro). */
const buscaDocumentos = require('./integrations/buscaDocumentos');
app.get('/api/busca-documentos', (req, res) => {
  try {
    const { chavePa, paDaPasta } = requisicoes;
    const cat = String(req.query.categoria || 'todos');
    const categoriaDe = c => /contratos\s+encerrados/i.test(c) ? 'encerrado' : /outras\s+secretarias/i.test(c) ? 'outra_secretaria' : 'vigencia';
    const r = buscaDocumentos.buscar(CFG.pastaCacheTexto, String(req.query.q || ''), {
      limite: 100,
      filtro: c => servidorArquivos.caminhoPermitido(c) && (cat === 'todos' || categoriaDe(c) === cat)
    });
    // Processo e contrato de cada documento, pela pasta "P.A. ..." do caminho.
    for (const d of r.resultados) {
      const pasta = d.caminho.split(/[\\/]/).find(p => /^P\.?\s*A\.?\s*\d/i.test(p)) || null;
      const pa = pasta ? paDaPasta(pasta) : null;
      const c = pa && (db.contratos || []).find(x => chavePa(x.pa) === chavePa(pa));
      d.processo = pasta ? pasta.normalize('NFC') : null;
      d.contrato = c ? { id: c.id, numero: c.numero, status: c.status } : null;
      d.categoria = categoriaDe(d.caminho);
    }
    registrarAuditoria(req, 'consultar', 'busca_documentos', null, `Busca nos documentos: "${String(req.query.q || '').slice(0, 80)}" — ${r.totalDocumentos} documento(s).`);
    save();
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/busca-documentos/arquivo', (req, res) => {
  const caminho = String(req.query.caminho || '');
  // Só documento que está no índice (foi lido pela Central) e dentro das pastas configuradas.
  if (!buscaDocumentos.documentoNoIndice(CFG.pastaCacheTexto, caminho) || !servidorArquivos.caminhoPermitido(caminho)) return res.status(404).json({ error: 'Documento não encontrado.' });
  if (!require('fs').existsSync(caminho)) return res.status(404).json({ error: 'O documento não está mais na pasta (movido ou apagado).' });
  registrarAuditoria(req, 'exportar', 'busca_documentos', null, `Documento aberto pela busca: "${require('path').basename(caminho)}".`);
  save();
  const nome = require('path').basename(caminho).normalize('NFC');
  res.setHeader('Content-Disposition', `${/\.pdf$/i.test(nome) ? 'inline' : 'attachment'}; filename="${nome.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(nome)}`);
  res.sendFile(caminho, { dotfiles: 'allow' }, err => { if (err && !res.headersSent) res.status(500).json({ error: 'Falha ao ler o documento.' }); });
});

/* Conferência do SGC contra os documentos da pasta de rede (média mensal
   recalculada com os aditivos, CNPJ) — só lê o que já está no cache de
   texto, então responde em segundos. Ver integrations/conferenciaSgc.js. */
app.get('/api/conferencia-sgc', requireRole('admin', 'gestor'), async (req, res) => {
  try {
    res.json(await conferenciaSgc.conferir(db));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/conferencia-sgc/exportar', requireRole('admin', 'gestor'), async (req, res) => {
  try {
    const relatorio = await conferenciaSgc.conferir(db);
    const csv = conferenciaSgc.gerarCsvCorrecoes(relatorio);
    registrarAuditoria(req, 'exportar', 'conferencia_sgc', null, 'Planilha de correções do SGC exportada.');
    save();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="correcoes-sgc-${hojeLocal()}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* Reaplica as regras (valor, vigência) às propostas pendentes, com o texto
   já guardado — sem OCR. Ver ingestaoContratos.recalcularPropostasPendentes. */
app.post('/api/importacoes/recalcular', requireRole('admin', 'gestor'), async (req, res) => {
  try {
    const resumo = await ingestaoContratos.recalcularPropostasPendentes(db, save, nextId);
    registrarAuditoria(req, 'sincronizar', 'importacao', null, `Recálculo das propostas pendentes: ${resumo.recalculadas} recalculada(s), ${resumo.alteradas} com campo alterado (${resumo.camposAlterados} campo(s)), ${resumo.semTexto} sem texto guardado.`);
    (resumo.encerramentosDetectados || []).forEach(e => registrarAuditoria(req, 'sincronizar', 'contrato', e.contrato,
      `Termo de encerramento encontrado na pasta ("${e.arquivo}"${e.data ? `, encerrado em ${dataBr(e.data)}` : ''}) — aguardando confirmação em Pendências de leitura.`));
    (resumo.vigenciasDeAprovados || []).forEach(v => registrarAuditoria(req, 'editar', 'contrato', v.contrato,
      `Vigência em branco calculada pelos documentos: início ${v.depois.inicio || '—'}, término ${v.depois.termino || '—'}${v.presumido ? ' (marco presumido: assinatura)' : ''}.`));
    (resumo.mudancasDetectadas || []).forEach(m => registrarAuditoria(req, 'sincronizar', 'contrato', m.contrato,
      `${m.campo} relido diferente do cadastro (${m.motivo}) — aguardando confirmação em Pendências de leitura.`));
    (resumo.garantiasLidas || []).forEach(g => registrarAuditoria(req, 'sincronizar', 'contrato', g.contrato,
      `Validade da garantia contratual lida em "${g.arquivo}": até ${dataBr(g.fim)}.`));
    save();
    res.json(resumo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/importacoes/:id/rejeitar', requireRole('admin', 'gestor'), (req, res) => {
  try {
    const proposta = ingestaoContratos.rejeitarImportacao(db, save, req.params.id, (req.body || {}).motivo, req.__usuarioNome);
    registrarAuditoria(req, 'rejeitar', 'importacao', req.params.id, (req.body || {}).motivo || '');
    save();
    res.json(proposta);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ---------- Mapa de risco por contrato (Ferramenta 2) ----------
   Reaproveita a extração de texto da Ferramenta 1 e confere o checklist
   da lei por regra — ver integrations/mapaRiscoContratos.js. Só funciona
   para contratos com `arquivoOrigem` (os que vieram da Ferramenta 1) e
   roda ao aprovar um contrato ativo na Fila (só o texto já lido), sob
   demanda ou em "Atualizar todas" — nunca sozinho em segundo plano. */
app.get('/api/mapas-risco', (req, res) => {
  res.json({
    itens: mapaRiscoContratos.listarElegiveisComUltimoMapa(db),
    // Filtro "Encerrados" (02/10/2026): só Conteúdo e Gestão — ver eixosDoEncerrado.
    encerrados: mapaRiscoContratos.listarEncerradosComUltimoMapa(db),
    // "O que fazer agora": os riscos da carteira agrupados pela ação que resolve.
    acoes: mapaRiscoContratos.acoesDaCarteira(db)
  });
});

/* Precisa vir ANTES de /api/mapas-risco/:contratoId — o Express casa as
   rotas na ordem, e depois dela "progresso" seria lido como um id de
   contrato (devolvendo null, sem erro nenhum). */
/* Planilha das lacunas da análise mais recente de cada contrato — ver
   mapaRiscoContratos.gerarCsvLacunas. Antes de /api/mapas-risco/:contratoId. */
app.get('/api/mapas-risco/lacunas/exportar', (req, res) => {
  const csv = mapaRiscoContratos.gerarCsvLacunas(db);
  registrarAuditoria(req, 'exportar', 'mapa_risco', 'todos', 'Planilha de lacunas do Mapa de risco exportada.');
  save();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="lacunas-mapa-de-risco-${hojeLocal()}.csv"`);
  res.send(csv);
});

// Risco atual de cada contrato (o mesmo do Mapa) — a tela recarrega depois de gerar análises.
app.get('/api/mapas-risco/riscos', (req, res) => {
  res.json(mapaRiscoContratos.riscosAtuais(db));
});

app.get('/api/mapas-risco/progresso', (req, res) => {
  res.json(mapaRiscoContratos.obterProgresso());
});

app.get('/api/mapas-risco/:contratoId', (req, res) => {
  const mapa = mapaRiscoContratos.mapaMaisRecente(db, req.params.contratoId);
  res.json(mapa);
});

/* A geração lê todos os documentos do contrato (OCR completo dos
   digitalizados) — pode levar minutos. Por isso a rota só DISPARA e
   responde 202 na hora; a tela acompanha em
   /api/mapas-risco/progresso. Segurar a requisição aberta esse tempo todo
   dependeria de navegador, proxy e rede não derrubarem a conexão. */
app.post('/api/contratos/:id/mapa-risco/gerar', requireRole('admin', 'gestor'), (req, res) => {
  // A auditoria do resultado acontece depois que a requisição já foi
  // respondida — guarda quem pediu para registrar no nome certo.
  const autor = { __usuarioNome: req.__usuarioNome, __usuarioRole: req.__usuarioRole };
  try {
    const r = mapaRiscoContratos.iniciarGeracaoMapaRisco(db, save, nextId, req.params.id, req.__usuarioNome,
      registro => {
        registrarAuditoria(autor, 'gerar', 'mapa_risco', req.params.id, `Risco geral: ${registro.riscoGeralLabel} (conteúdo: ${registro.conteudo ? registro.conteudo.nivelLabel : 'indisponível'}, prazo: ${registro.prazo.nivelLabel}, financeiro: ${registro.financeiro.nivelLabel}${registro.gestao ? `, gestão: ${registro.gestao.nivelLabel}` : ''}). Documentos lidos: ${(registro.documentosLidos || []).length}.`);
        save();
      },
      err => {
        registrarAuditoria(autor, 'gerar', 'mapa_risco', req.params.id, `Falhou: ${err.message}`);
        save();
      });
    res.status(202).json(r);
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

/* Atualiza as análises de TODOS os contratos com documentos, só por regra
   e só com o texto já lido (sem OCR novo) — ver iniciarAtualizacaoEmLote.
   Só administrador: mexe no mapa de todo mundo de uma vez. */
app.post('/api/mapas-risco/atualizar-todos', requireRole('admin'), (req, res) => {
  const autor = { __usuarioNome: req.__usuarioNome, __usuarioRole: req.__usuarioRole };
  try {
    const r = mapaRiscoContratos.iniciarAtualizacaoEmLote(db, save, nextId, req.__usuarioNome, lote => {
      const falhas = lote.falhas.length ? ` Falharam ${lote.falhas.length}: ${lote.falhas.map(f => `${f.numero || f.contratoId} (${f.mensagem})`).join('; ')}.` : '';
      registrarAuditoria(autor, 'gerar', 'mapa_risco', 'todos', `Atualização em lote (só regras, texto já lido): ${lote.feitos - lote.falhas.length} de ${lote.total} análise(s) atualizada(s).${falhas}`);
      save();
    });
    res.status(202).json(r);
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

/* ---------- Ficha de Cadastro por contrato (Ferramenta 3) ----------
   Reaproveita a extração de texto e a leitura por regra da Ferramenta 1
   (com máscara de CPF) — ver integrations/fichaCadastroContrato.js. Campos espelham o formulário
   real "Cadastrar Contrato" do SGC. Só funciona para contratos com
   `arquivoOrigem` e só roda sob demanda. O PDF gerado é um registro
   interno da Central de Contratos — nunca é enviado nem escrito no SGC de
   verdade; hoje cobre só Contratos (ver README para os outros 8 tipos). */
app.get('/api/fichas-cadastro', (req, res) => {
  res.json({
    itens: fichaCadastroContrato.listarElegiveisComUltimaFicha(db)
  });
});

app.post('/api/contratos/:id/ficha-cadastro/gerar', requireRole('admin', 'gestor'), async (req, res) => {
  try {
    const registro = await fichaCadastroContrato.gerarFichaCadastroContrato(db, save, nextId, req.params.id, req.__usuarioNome);
    registrarAuditoria(req, 'gerar', 'ficha_cadastro', req.params.id, `Ficha de cadastro gerada (contrato ${registro.contratoNumero}).`);
    save();
    res.json(registro);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/fichas-cadastro/:id/arquivo', (req, res) => {
  try {
    const { caminho, nomeDownload } = fichaCadastroContrato.caminhoArquivoFicha(db, req.params.id);
    res.download(caminho, nomeDownload);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

/* Erro não tratado numa rota: registra no console e responde uma
   mensagem genérica. Sem isto, o Express devolvia ao navegador o rastro
   interno do código (caminhos de pasta, nomes de função). JSON malformado
   no corpo da requisição vira 400. */
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Corpo da requisição inválido.' });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Requisição grande demais.' });
  console.error(`Erro em ${req.method} ${req.path}:`, err && err.stack ? err.stack : err);
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

if (SESSION_SECRET === DEFAULT_SECRET) {
  console.warn('\n!!! ATENÇÃO: SESSION_SECRET não definido no .env — as sessões usam um segredo conhecido.');
}
if (IS_PROD && SESSION_SECRET === DEFAULT_SECRET) {
  console.warn('\n!!! ATENÇÃO: rodando com NODE_ENV=production mas sem SESSION_SECRET definido.');
  console.warn('!!! Gere um com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n');
}

/* Correções de cadastro conhecidas (arquivo principal que é modelo em
   branco, CNPJ da Prefeitura no lugar do da empresa) — aplicadas aqui, ao
   subir, porque o data.json só é gravado pelo próprio servidor. Idempotente:
   depois da primeira vez, não acha mais nada. Ver ingestaoContratos.js. */
try {
  const correcoes = ingestaoContratos.corrigirCadastrosConhecidos(db);
  if (correcoes.length) {
    correcoes.forEach(c => {
      registrarAuditoria({ __usuarioNome: 'Sistema (correção automática)', __usuarioRole: 'admin' }, 'corrigir', 'contrato', c.contrato,
        `${c.campo}: "${c.de}" → ${c.para == null ? 'em branco (preencher com o da contratada)' : `"${c.para}"`}`);
      const curto = v => { const t = String(v); return t.length > 90 ? t.slice(0, 90) + '…' : t; };
      console.log(`Correção de cadastro — contrato ${c.contrato}: ${c.campo} "${curto(c.de)}" → ${c.para == null ? '(em branco)' : `"${curto(c.para)}"`}`);
    });
    save();
  }
} catch (e) {
  console.error('Aviso: falha nas correções de cadastro:', e.message);
}

/* Tabela da UFM: na primeira vez, a da planilha do GFE (ver ufm.js). */
try { if (ufm.garantirTabela(db)) { console.log('UFM: tabela inicial criada (valores da planilha do GFE).'); save(); } }
catch (e) { console.error('Aviso: falha ao preparar a tabela da UFM:', e.message); }

/* Tratativas antigas -> Histórico administrativo (06/10/2026). Idempotente;
   a lista antiga (db.tratativas) fica intacta, só deixa de ser usada. */
try {
  const migradas = historicoContrato.migrarTratativas(db);
  if (migradas) {
    registrarAuditoria({ __usuarioNome: 'Sistema', __usuarioRole: 'admin' }, 'criar', 'historico', null, `${migradas} tratativa(s) passaram para o Histórico administrativo dos contratos.`);
    console.log(`Histórico administrativo: ${migradas} tratativa(s) migrada(s).`);
    save();
  }
} catch (e) {
  console.error('Aviso: falha ao migrar as tratativas para o histórico:', e.message);
}

// Cede a vez aos programas do usuário (o OCR roda neste processo) — ver prioridadeProcesso.js.
const prioridade = require('./integrations/prioridadeProcesso').ajustarPrioridade(process.env.SERVIDOR_PRIORIDADE);

/* Por padrão, só ESTA máquina acessa (127.0.0.1). Para abrir na rede da
   Prefeitura: HOST=0.0.0.0 no .env — antes, troque a senha padrão e,
   de preferência, coloque HTTPS na frente. Antes de 24/09/2026 o servidor
   escutava em todas as interfaces, com a senha padrão ativa. */
const HOST = CFG.host;
const senhaPadraoAtiva = senhaPadraoAindaAtiva();
/* Aberto na rede (HOST diferente de 127.0.0.1): NÃO sobe com segredo de
   sessão conhecido nem com a senha padrão do admin (ela está no código-
   fonte). Na própria máquina, só avisa. PERMITIR_INICIO_INSEGURO=1 força
   — não recomendado. Ver SERVIDOR.md. */
const problemasRede = require('./integrations/configServidor').problemasParaRede(CFG, { segredoPadrao: SESSION_SECRET === DEFAULT_SECRET, senhaPadraoAtiva });
if (!CFG.soEstaMaquina && problemasRede.length) {
  console.error(`\n!!! O sistema está configurado para abrir na rede (HOST=${HOST}), mas:`);
  problemasRede.forEach(p => console.error(`!!!   - ${p}`));
  if (!CFG.permitirInicioInseguro) {
    console.error('!!! O servidor NÃO foi iniciado. Corrija os itens acima (ou volte HOST=127.0.0.1). Rode "npm run verificar-servidor" para o diagnóstico completo.\n');
    process.exit(1);
  }
  console.error('!!! PERMITIR_INICIO_INSEGURO=1: iniciando mesmo assim.\n');
}
const server = app.listen(PORT, HOST, () => {
  console.log(`Central de Contratos rodando em http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT} (NODE_ENV=${process.env.NODE_ENV || 'development'}${CFG.soEstaMaquina ? ', acesso só desta máquina' : `, aberto em ${HOST}`})`);
  console.log(`Dados em: ${CFG.pastaDados}${CFG.sessoes === 'arquivo' ? ' · sessões em arquivo' : ''}${CFG.confiarProxy ? ' · atrás de proxy' : ''}`);
  console.log(`Prioridade do processo no Windows: ${prioridade}.`);
  if (ENTRA.ligado) console.log(`Login com a conta da Prefeitura (Entra ID): ligado${ENTRA.semCadastro === 'consulta' ? ' — sem cadastro entra só para consulta' : ' — sem cadastro fica bloqueado (pedido de acesso)'}.`);
  else if (ENTRA.problemas.length) console.warn('!!! Login com a conta da Prefeitura desligado: ' + ENTRA.problemas.join(' '));
  if (senhaPadraoAtiva) console.warn('!!! A conta "admin" ainda usa a senha padrão — troque em Administração > Contas de acesso antes de abrir o sistema na rede.');
});

/* Agendamento do resumo diário de alertas por e-mail — sem depender de
   node-cron nem de nenhum pacote novo: só um setInterval de hora em hora
   que verifica se (a) o Microsoft Graph está configurado, (b) já passou do
   horário definido em ALERTA_EMAIL_HORA (padrão 8h) e (c) ainda não foi
   enviado hoje. Isso só tem efeito se o processo do servidor ficar de pé o
   dia todo — se ele for iniciado manualmente e encerrado logo depois, como
   hoje, o resumo diário não roda; ver README para a discussão sobre deixar
   o servidor rodando permanentemente (pm2, serviço do Windows etc.). */
const ALERTA_EMAIL_HORA = Number(process.env.ALERTA_EMAIL_HORA) || 8;
async function verificarResumoDiarioDeAlertas() {
  try {
    if (!graphMail.isConfigured()) return; // dormente — nem verifica a hora
    const agora = new Date();
    const hoje = agora.toISOString().slice(0, 10);
    const ultimoEnvio = db.integracoes && db.integracoes.resumoAlertas && db.integracoes.resumoAlertas.ultimoEnvio;
    const jaEnviouHoje = ultimoEnvio && String(ultimoEnvio).slice(0, 10) === hoje;
    if (jaEnviouHoje || agora.getHours() < ALERTA_EMAIL_HORA) return;
    const resultado = await resumoAlertas.enviarResumoDiario(db);
    db.integracoes.resumoAlertas = { ultimoEnvio: agora.toISOString(), ultimoResultado: resultado };
    save();
    console.log(`Resumo diário de alertas por e-mail: ${resultado.enviado ? `enviado (${resultado.totalContratos} contrato(s))` : `não enviado — ${resultado.motivo}`}`);
  } catch (e) {
    console.error('Aviso: falha ao verificar/enviar o resumo diário de alertas por e-mail:', e.message);
  }
}
setTimeout(verificarResumoDiarioDeAlertas, 30000).unref();
setInterval(verificarResumoDiarioDeAlertas, 60 * 60 * 1000).unref();

/* Agendamento opcional da varredura de pastas (Ferramenta 1) fora do
   horário de expediente — mesmo padrão de setInterval por hora usado
   acima pro resumo de alertas, sem node-cron. Existe porque o OCR de PDF
   digitalizado numa máquina modesta pode levar minutos por pasta: se
   ninguém precisa ESPERAR o resultado, rodar de madrugada (quando a rede
   e a máquina estão ociosas) elimina a sensação de demora sem precisar
   deixar mais rápido. Fica DESLIGADO por padrão — só liga definindo
   CONTRATOS_VARREDURA_AUTOMATICA_HORA no .env (ex: 2, pra 2h da manhã).

   IMPORTANTE — isso só funciona se o processo do Node (este servidor)
   estiver DE PÉ na hora marcada. Rodar `npm start` de dia e fechar o
   terminal à noite (o hábito de hoje) faz esse agendamento nunca
   disparar. Pra funcionar de verdade, o computador precisa ficar ligado
   (sem suspender/hibernar) com o servidor rodando durante a madrugada —
   ver README, seção "Varredura automática agendada", para as opções de
   deixar isso rodando sem alguém logado o tempo todo (serviço do
   Windows, pm2, etc.). */
const CONTRATOS_VARREDURA_AUTO_HORA = process.env.CONTRATOS_VARREDURA_AUTOMATICA_HORA;
async function verificarVarreduraAutomaticaDeArquivos() {
  try {
    if (CONTRATOS_VARREDURA_AUTO_HORA === undefined || CONTRATOS_VARREDURA_AUTO_HORA === '') return; // desligado por padrão
    if (!ingestaoContratos.isConfigured()) return;
    const horaAlvo = Number(CONTRATOS_VARREDURA_AUTO_HORA);
    if (!Number.isFinite(horaAlvo) || horaAlvo < 0 || horaAlvo > 23) {
      console.error(`Aviso: CONTRATOS_VARREDURA_AUTOMATICA_HORA="${CONTRATOS_VARREDURA_AUTO_HORA}" inválido (use um número de 0 a 23) — varredura automática não vai rodar até isso ser corrigido.`);
      return;
    }
    const agora = new Date();
    const hoje = agora.toISOString().slice(0, 10);
    db.integracoes.arquivosContratos = db.integracoes.arquivosContratos || { ultimaVarredura: null, ultimoResumo: null, arquivosVistos: {} };
    const ultimaAuto = db.integracoes.arquivosContratos.ultimaVarreduraAutomatica;
    const jaRodouHoje = ultimaAuto && String(ultimaAuto).slice(0, 10) === hoje;
    /* Só dentro de uma janela de 4 h a partir do horário marcado. Antes,
       bastava "já passou da hora": marcada para as 2h e com o servidor
       aberto às 9h, a varredura (com OCR) disparava às 9h, em pleno
       expediente — o oposto do motivo de existir. */
    const horasDesdeOAlvo = (agora.getHours() - horaAlvo + 24) % 24;
    if (jaRodouHoje || horasDesdeOAlvo >= 4) return;
    console.log('Iniciando varredura automática agendada de pastas de contrato...');
    const resumo = await ingestaoContratos.varrerEProporImportacoes(db, save, nextId);
    db.integracoes.arquivosContratos.ultimaVarreduraAutomatica = agora.toISOString();
    save();
    console.log(`Varredura automática concluída: ${resumo.propostas} proposta(s), ${resumo.semTexto} sem texto, ${resumo.erros} erro(s), de ${resumo.totalCandidatos} arquivo(s) encontrado(s).`);
  } catch (e) {
    // Uma varredura em andamento (outra pessoa clicou manualmente bem na
    // hora) ou qualquer outra falha pontual só vira um aviso no log — a
    // próxima checagem (daqui a 1h) tenta de novo; nunca derruba o servidor.
    console.error('Aviso: falha na varredura automática agendada de pastas de contrato:', e.message);
  }
}
setTimeout(verificarVarreduraAutomaticaDeArquivos, 45000).unref();
setInterval(verificarVarreduraAutomaticaDeArquivos, 60 * 60 * 1000).unref();

function shutdown(signal) {
  console.log(`\nRecebido ${signal}, encerrando servidor...`);
  if (storeDeSessoes) storeDeSessoes.gravarAgora(); // sessões em arquivo: nada pendente se perde
  // Fecha a thread do OCR de forma ordenada (ver encerrarOcr em extratorDocumento.js).
  server.close(() => require('./integrations/extratorDocumento').encerrarOcr().then(() => process.exit(0)));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
