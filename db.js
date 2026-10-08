/* ===================================================================
   db.js — camada de persistência da "Central de Contratos".

   Fictício, local, sem qualquer conexão com os sistemas reais da
   Prefeitura de Itaverde (SGC, Portal de Assinaturas, SharePoint).

   Módulos:
     1. Alertas de Vencimento de Contratos
     2. Painel de Indicadores de Contratos
     3. Ferramentas sobre os documentos dos contratos (ingestão, mapa de risco, ficha)

   Na primeira execução, gera um arquivo data.json com dados fictícios
   de exemplo. Nas execuções seguintes, carrega esse arquivo — tudo
   que for cadastrado, editado ou excluído pelo app fica salvo em
   disco e sobrevive a reinícios do servidor.
=================================================================== */

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { hojeLocal } = require('./integrations/dataLocal');

// Onde ficam os dados: a pasta do sistema (padrão) ou CENTRAL_DADOS_PASTA no servidor,
// para atualizar o código sem tocar nos dados — ver integrations/configServidor.js.
const CFG_SERVIDOR = require('./integrations/configServidor').obterConfig();
if (!fs.existsSync(CFG_SERVIDOR.pastaDados)) fs.mkdirSync(CFG_SERVIDOR.pastaDados, { recursive: true });
const DATA_FILE = CFG_SERVIDOR.arquivoDados;
const BACKUP_DIR = CFG_SERVIDOR.pastaBackups;
const MAX_BACKUPS = 30; // ~1 mês de histórico, guardando 1 backup por dia

// Papéis de acesso locais à Central de Contratos. Independentes do cadastro de
// usuários do ERP (removido) — são só as contas de login deste app. Pensado
// para, no futuro, dar lugar a um SSO via Azure AD sem mudar o resto do
// código: em qualquer lugar que hoje confere `role`, no futuro o papel
// pode vir de um grupo do AD em vez do login local.
const PAPEIS = ['admin', 'gestor', 'fiscal', 'consulta'];

/* Tipos de serviço (revistos em 24/09/2026): "Expansão de Processamento"
   virou "Infraestrutura" (datacenter, armazenamento, processamento) e
   "Teste" saiu; "Outros" é o que não é de TI. Preenchidos pela regra de
   integrations/camposPorRegra.js a partir do objeto do contrato. */
const TIPOS_SERVICO = ['Software', 'Hardware', 'Infraestrutura', 'Rede', 'Segurança', 'Telefonia', 'Serviços', 'Outros'];
const SECRETARIAS_NOMES = [
  'Secretaria Municipal de Tecnologia', 'Secretaria de Administração',
  'Secretaria de Finanças', 'Secretaria de Obras', 'Secretaria de Educação', 'Secretaria de Saúde'
];


function seed() {
  const now = new Date();

  /* ---------- Módulos trazidos do ERP Itaverde ----------
     Toda a informação destes módulos vem do SGC via sincronização (ou virá,
     quando a integração daquela entidade for ligada). Não há mais dados de
     exemplo/fictícios aqui: a instalação começa vazia e é populada pelas
     rotas de sincronização (/api/integracoes/contratos/sincronizar) ou,
     para as entidades ainda sem integração, ficará vazia até que uma fonte
     real seja conectada. */
  const contratos = [];
  const aditivos = [];
  const apostilamentos = [];
  const requisicoes = [];
  const gratificacoes = [];

  // Histórico de tratativas: começa vazio — só existe depois que houver
  // contratos reais (sincronizados do SGC) para registrar tratativas sobre.
  const tratativas = [];

  const alertaConfig = { critico: 15, atencao: 30, proximo: 90 };

  const authUsers = [
    { id: 1, usuario: 'admin', nome: 'Administrador', senhaHash: bcrypt.hashSync('itaverde2026', 10), role: 'admin' }
  ];

  const integracoes = {
    contratosApi: { ultimaSincronizacao: null, ultimoResumo: null },
    // Resumo diário de alertas de vencimento por e-mail (Microsoft Graph) —
    // fica dormente até GRAPH_MAIL_* estar configurado no servidor (ver
    // integrations/graphMail.js e integrations/resumoAlertas.js).
    resumoAlertas: { ultimoEnvio: null, ultimoResultado: null },
    // Ingestão automatizada a partir da pasta de rede de contratos — fica
    // dormente até CONTRATOS_ARQUIVOS_PASTAS estar configurado (ver
    // integrations/servidorArquivos.js e integrations/ingestaoContratos.js).
    // `arquivosVistos` guarda, por caminho de arquivo, o hash e a data de
    // modificação já processados, para a varredura seguinte só reprocessar
    // o que mudou de verdade.
    arquivosContratos: { ultimaVarredura: null, ultimoResumo: null, arquivosVistos: {} }
  };

  const auditoria = [];

  // Comentários internos — anexáveis a um contrato, para observações rápidas
  // de equipe sem virar um novo módulo. Começa vazio; ver rotas
  // /api/comentarios em server.js.
  const comentarios = [];

  // Fila de revisão da ingestão automatizada (Ferramenta 1): cada item é
  // uma PROPOSTA de contrato extraída de um arquivo da
  // pasta de rede — nunca escreve direto em `contratos`. Alguém com papel
  // gestor/admin aprova, corrige ou rejeita cada proposta antes dela virar
  // dado de verdade. Ver integrations/ingestaoContratos.js.
  const importacoesPendentes = [];

  // Histórico de análises de risco geradas pela Ferramenta 2 (mapa de
  // risco por contrato) — uma entrada por geração, mais recente
  // primeiro. Só existe para contratos com `arquivoOrigem` (hoje, os que
  // vieram da Ferramenta 1). Nada aqui é escrito automaticamente: cada
  // entrada nasce de alguém clicando em "Gerar/Atualizar análise" na tela
  // Mapa de Risco. Ver integrations/mapaRiscoContratos.js.
  const mapasRisco = [];

  // Fichas de cadastro geradas pela Ferramenta 3 (hoje só
  // para Contratos — os outros 8 tipos de cadastro do SGC ficam para quando
  // as pastas de origem de cada um forem definidas): um PDF de referência,
  // preenchido a partir do texto do arquivo de origem, com os mesmos campos
  // do formulário "Cadastrar Contrato" do SGC. É um registro interno da
  // Central de Contratos — nunca escreve nem envia nada para o SGC de verdade. Ver
  // integrations/fichaCadastroContrato.js.
  const fichasCadastro = [];

  return {
    contratos, tratativas, alertaConfig, authUsers,
    aditivos, apostilamentos, requisicoes, gratificacoes,
    integracoes, auditoria, comentarios,
    importacoesPendentes, mapasRisco, fichasCadastro
  };
}

function load() {
  if (fs.existsSync(DATA_FILE)) {
    const loaded = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    let dirty = false;
    if (!Array.isArray(loaded.authUsers) || loaded.authUsers.length === 0) {
      loaded.authUsers = [{ id: 1, usuario: 'admin', nome: 'Administrador', senhaHash: bcrypt.hashSync('itaverde2026', 10), role: 'admin' }];
      dirty = true;
    }
    // Migração: contas criadas antes dos papéis existirem ganham 'admin' —
    // preserva o comportamento de hoje (essas contas já podiam tudo).
    loaded.authUsers.forEach(u => { if (!PAPEIS.includes(u.role)) { u.role = 'admin'; dirty = true; } });
    if (!loaded.authUsers.some(u => u.role === 'admin')) {
      loaded.authUsers[0].role = 'admin';
      dirty = true;
    }
    if (!loaded.alertaConfig) { loaded.alertaConfig = { critico: 15, atencao: 30, proximo: 90 }; dirty = true; }
    if (!Array.isArray(loaded.tratativas)) { loaded.tratativas = []; dirty = true; }
    // Limpeza: módulos removidos (Central de apoio a ETP/TR, Biblioteca de
    // Modelos, Documentos) — se um data.json antigo ainda tiver esses dados,
    // eles somem na próxima gravação. Nenhuma rota nem tela usa mais isso.
    // 'colaboradores' entrou nesta lista em 21/09/2026, quando o módulo
    // Onboarding/Offboarding foi removido (nunca teve registro).
    ['estudos', 'modelos', 'documentos', 'colaboradores'].forEach(key => {
      if (key in loaded) { delete loaded[key]; dirty = true; }
    });
    /* Cadastros genéricos do protótipo do ERP (08/10/2026): funcionários,
       empresas, IOM, portarias, secretarias, grupos, unidades, usuários,
       políticas, termos de aceite e banner — nenhuma tela nem rota usa.
       Só sai o que estiver VAZIO: se alguma tiver registro (data.json de
       outra instalação), fica onde está e o servidor avisa. */
    ['funcionarios', 'empresas', 'ioms', 'portarias', 'secretarias', 'grupos', 'unidades', 'usuarios', 'politicas', 'termosAceite'].forEach(key => {
      if (!(key in loaded)) return;
      if (Array.isArray(loaded[key]) && loaded[key].length === 0) { delete loaded[key]; dirty = true; }
      else console.warn(`[data.json] "${key}" tem ${Array.isArray(loaded[key]) ? loaded[key].length : '?'} registro(s) de um módulo removido — não apagado; confira.`);
    });
    if (loaded.bannerConfig && !loaded.bannerConfig.ativo && !loaded.bannerConfig.titulo && !loaded.bannerConfig.mensagem) { delete loaded.bannerConfig; dirty = true; }
    ['aditivos', 'apostilamentos', 'requisicoes', 'gratificacoes', 'auditoria', 'comentarios'].forEach(key => {
      if (!Array.isArray(loaded[key])) { loaded[key] = []; dirty = true; }
    });
    if (!loaded.integracoes || typeof loaded.integracoes !== 'object') {
      loaded.integracoes = { contratosApi: { ultimaSincronizacao: null, ultimoResumo: null }, resumoAlertas: { ultimoEnvio: null, ultimoResultado: null } };
      dirty = true;
    }
    if (!loaded.integracoes.resumoAlertas || typeof loaded.integracoes.resumoAlertas !== 'object') {
      loaded.integracoes.resumoAlertas = { ultimoEnvio: null, ultimoResultado: null };
      dirty = true;
    }
    if (!loaded.integracoes.arquivosContratos || typeof loaded.integracoes.arquivosContratos !== 'object') {
      loaded.integracoes.arquivosContratos = { ultimaVarredura: null, ultimoResumo: null, arquivosVistos: {} };
      dirty = true;
    }
    if (!loaded.integracoes.arquivosContratos.arquivosVistos || typeof loaded.integracoes.arquivosContratos.arquivosVistos !== 'object') {
      loaded.integracoes.arquivosContratos.arquivosVistos = {};
      dirty = true;
    }
    if (!Array.isArray(loaded.importacoesPendentes)) { loaded.importacoesPendentes = []; dirty = true; }
    if (!Array.isArray(loaded.mapasRisco)) { loaded.mapasRisco = []; dirty = true; }
    if (!Array.isArray(loaded.fichasCadastro)) { loaded.fichasCadastro = []; dirty = true; }
    if (dirty) fs.writeFileSync(DATA_FILE, JSON.stringify(loaded, null, 2), 'utf8');
    return loaded;
  }
  const fresh = seed();
  fs.writeFileSync(DATA_FILE, JSON.stringify(fresh, null, 2), 'utf8');
  return fresh;
}

const db = load();

/* Backup diário: antes da primeira gravação de cada dia, guarda uma cópia do
   data.json como ele estava até então em backups/data-AAAA-MM-DD.json. Não
   cria mais de um backup por dia (evita encher a pasta em dias de uso
   intenso) e mantém só os MAX_BACKUPS mais recentes, apagando os mais
   antigos. Se algo der errado no backup, a gravação normal segue de
   qualquer forma — nunca trava o salvamento por causa disso. */
function backupDiarioSeNecessario() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const hoje = hojeLocal(); // AAAA-MM-DD
    const backupFile = path.join(BACKUP_DIR, `data-${hoje}.json`);
    if (fs.existsSync(backupFile)) return; // já existe backup de hoje
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    fs.copyFileSync(DATA_FILE, backupFile);
    podarBackups(BACKUP_DIR);
    copiarBackupParaFora(backupFile);
  } catch (e) {
    console.error('Aviso: falha ao gerar backup diário de data.json:', e.message);
  }
}

function podarBackups(pasta) {
  const arquivos = fs.readdirSync(pasta)
    .filter(f => /^data-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort(); // AAAA-MM-DD ordena cronologicamente como string
  const excedentes = arquivos.length - MAX_BACKUPS;
  if (excedentes > 0) {
    arquivos.slice(0, excedentes).forEach(f => {
      try { fs.unlinkSync(path.join(pasta, f)); } catch (e) { /* ignora */ }
    });
  }
}

/* Cópia do backup do dia FORA desta máquina (25/09/2026): o backups/ fica
   no mesmo disco do data.json — se o disco falhar, vão os dois. Com
   BACKUP_COPIA_PASTA no .env (uma pasta de rede com acesso restrito: o
   arquivo tem nomes de gestores e dados dos contratos), cada backup diário
   também é copiado para lá, com a mesma retenção. Falha na cópia (rede
   fora do ar) só avisa no console — nunca impede a gravação. */
function copiarBackupParaFora(backupFile) {
  const destino = (process.env.BACKUP_COPIA_PASTA || '').trim();
  if (!destino) return;
  try {
    if (!fs.existsSync(destino)) fs.mkdirSync(destino, { recursive: true });
    fs.copyFileSync(backupFile, path.join(destino, path.basename(backupFile)));
    podarBackups(destino);
  } catch (e) {
    console.error(`Aviso: backup do dia não foi copiado para ${destino}: ${e.message}`);
  }
}

function save() {
  backupDiarioSeNecessario();
  const tmpFile = DATA_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmpFile, DATA_FILE);
}

function nextId(arr) {
  return arr.length ? Math.max(...arr.map(x => Number(x.id) || 0)) + 1 : 1;
}

module.exports = {
  db, save, nextId,
  TIPOS_SERVICO, SECRETARIAS_NOMES,
  PAPEIS
};
