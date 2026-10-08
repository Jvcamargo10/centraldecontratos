/* ===================================================================
   ferramentas/verificarServidor.js — diagnóstico antes de subir a Central
   num servidor (ou depois de mudar o .env). Só lê: não grava nada, não
   envia texto de contrato para lugar nenhum.

   Uso:  npm run verificar-servidor
   Saída: cada item com ✓ (ok), ! (atenção) ou ✗ (impede); código de saída
   1 se houver algum ✗. Ver SERVIDOR.md.
=================================================================== */
require('../integrations/carregarEnv').carregarEnv();
const fs = require('fs');
const net = require('net');
const path = require('path');
const { obterConfig, problemasParaRede } = require('../integrations/configServidor');

const cfg = obterConfig();
const itens = [];
const ok = (t) => itens.push(['✓', t]);
const atencao = (t) => itens.push(['!', t]);
const impede = (t) => itens.push(['✗', t]);

function portaLivre(porta, host) {
  return new Promise(resolve => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(porta, host === '0.0.0.0' ? undefined : host);
  });
}

(async () => {
  // Node
  const maior = Number(process.versions.node.split('.')[0]);
  maior >= 18 ? ok(`Node.js ${process.versions.node}`) : impede(`Node.js ${process.versions.node}: precisa da versão 18 ou mais nova (o sistema usa fetch nativo).`);
  if (!fs.existsSync(path.join(__dirname, '..', 'node_modules'))) impede('node_modules ausente: rode "npm install" (ou "npm ci") na pasta do sistema.');

  // Onde escuta
  if (cfg.soEstaMaquina) atencao(`HOST=${cfg.host}: só esta máquina acessa. No servidor, HOST=0.0.0.0 (ou o IP do servidor) — normalmente atrás de um proxy HTTPS.`);
  else ok(`HOST=${cfg.host}: aberto na rede, porta ${cfg.porta}.`);
  (await portaLivre(cfg.porta, cfg.host)) ? ok(`Porta ${cfg.porta} livre.`) : atencao(`Porta ${cfg.porta} ocupada — a Central já está rodando ou outro programa usa a porta.`);

  // Segurança para a rede
  const segredo = process.env.SESSION_SECRET;
  const segredoPadrao = !segredo;
  if (segredoPadrao) (cfg.soEstaMaquina ? atencao : impede)('SESSION_SECRET não definido no .env. Gere: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  else if (segredo.length < 32) atencao('SESSION_SECRET curto (menos de 32 caracteres).');
  else ok('SESSION_SECRET definido.');
  let senhaPadraoAtiva = false;
  try {
    const bcrypt = require('bcryptjs');
    const dados = JSON.parse(fs.readFileSync(cfg.arquivoDados, 'utf8'));
    senhaPadraoAtiva = (dados.authUsers || []).some(u => u.usuario === 'admin' && bcrypt.compareSync('itaverde2026', u.senhaHash));
    ok(`Dados: ${cfg.arquivoDados} (${(fs.statSync(cfg.arquivoDados).size / 1048576).toFixed(1)} MB, ${(dados.contratos || []).length} contrato(s)).`);
    const admins = (dados.authUsers || []).filter(u => u.role === 'admin').length;
    if (admins < 2) atencao(`Só ${admins} conta de administrador: crie uma segunda, para não depender de uma pessoa.`);
  } catch (e) {
    fs.existsSync(cfg.arquivoDados) ? impede(`data.json ilegível: ${e.message}`) : atencao(`Ainda não há data.json em ${cfg.pastaDados} — na primeira subida o sistema cria um vazio (copie o data.json de hoje para lá).`);
  }
  if (senhaPadraoAtiva) (cfg.soEstaMaquina ? atencao : impede)('A conta "admin" usa a senha padrão (que está no código-fonte). Troque em Administração > Contas de acesso.');
  else ok('Senha padrão do admin já trocada.');
  if (cfg.loginPreenchido) atencao('LOGIN_PREENCHIDO_EM_TESTE ligado: o login vem preenchido nesta máquina enquanto a senha padrão existir. No servidor, LOGIN_PREENCHIDO_EM_TESTE=0.');
  for (const p of problemasParaRede(cfg, { segredoPadrao, senhaPadraoAtiva }).filter(p => /COOKIE_SEGURO/.test(p))) impede(p);

  // Proxy, cookie e origem
  if (!cfg.soEstaMaquina) {
    if (!cfg.confiarProxy) atencao('CONFIAR_PROXY desligado: se houver IIS/nginx na frente, ligue (CONFIAR_PROXY=1) — senão o limite de senhas erradas vale para TODOS juntos (todo mundo chega com o IP do proxy).');
    else ok('CONFIAR_PROXY=1: IP real de quem acessa vem do proxy.');
    if (!cfg.cookieSeguro) atencao('COOKIE_SEGURO desligado: sem HTTPS, a senha e o cookie de sessão passam abertos pela rede. Com proxy HTTPS: COOKIE_SEGURO=1.');
    else ok('COOKIE_SEGURO=1: cookie só por HTTPS.');
    cfg.origensPermitidas.length ? ok(`ORIGENS_PERMITIDAS: ${cfg.origensPermitidas.join(', ')}`) : atencao('ORIGENS_PERMITIDAS vazio: ponha o endereço que as pessoas vão usar (ex.: https://central.itaverde.gov.br), para os botões que gravam não serem recusados atrás do proxy.');
  }
  cfg.sessoes === 'arquivo' ? ok(`Sessões em arquivo (${cfg.arquivoSessoes}): reiniciar o serviço não desconecta ninguém.`) : atencao('Sessões na memória: reiniciar o serviço desconecta todo mundo (SESSION_STORE=arquivo resolve).');

  // Pasta de dados
  try {
    fs.mkdirSync(cfg.pastaDados, { recursive: true });
    const teste = path.join(cfg.pastaDados, `.teste-escrita-${process.pid}`);
    fs.writeFileSync(teste, 'x'); fs.unlinkSync(teste);
    ok(`Pasta de dados gravável: ${cfg.pastaDados}`);
  } catch (e) { impede(`Sem permissão de escrita na pasta de dados ${cfg.pastaDados}: ${e.message}`); }
  if (!process.env.BACKUP_COPIA_PASTA) atencao('BACKUP_COPIA_PASTA não definido: o backup diário fica só no mesmo disco dos dados.');
  else fs.existsSync(process.env.BACKUP_COPIA_PASTA) ? ok(`Cópia do backup em ${process.env.BACKUP_COPIA_PASTA}`) : impede(`BACKUP_COPIA_PASTA inacessível: ${process.env.BACKUP_COPIA_PASTA}`);

  // Pastas de documentos
  const raizes = String(process.env.CONTRATOS_ARQUIVOS_PASTAS || '').split(';').map(s => s.trim()).filter(Boolean);
  if (!raizes.length) atencao('CONTRATOS_ARQUIVOS_PASTAS vazio: sem pasta de documentos, a leitura fica desligada.');
  for (const r of raizes) {
    if (/^[a-z]:[\\/]/i.test(r) && !/^[c-e]:/i.test(r)) atencao(`"${r}" usa letra de unidade mapeada: no servidor (principalmente como serviço do Windows) a letra não existe — use o caminho de rede \\\\servidor\\compartilhamento\\... e rode "npm run trocar-raiz".`);
    try {
      const n = fs.readdirSync(r).length;
      ok(`Pasta de documentos acessível: ${r} (${n} item(ns) na raiz).`);
    } catch (e) { impede(`Pasta de documentos inacessível para este usuário: ${r} (${e.code || e.message}). O usuário do serviço precisa de LEITURA nela.`); }
  }
  const cacheN = fs.existsSync(cfg.pastaCacheTexto) ? fs.readdirSync(cfg.pastaCacheTexto).filter(n => n.endsWith('.json')).length : 0;
  cacheN ? ok(`Cache de texto: ${cacheN} documento(s) já lido(s) em ${cfg.pastaCacheTexto}.`) : atencao(`Cache de texto vazio em ${cfg.pastaCacheTexto}: a primeira leitura vai ler (e passar por OCR) todos os documentos — copie a pasta .texto-cache de hoje.`);

  // Resultado
  console.log('\nDiagnóstico da Central de Contratos para servidor\n');
  for (const [m, t] of itens) console.log(` ${m} ${t}`);
  const n = s => itens.filter(i => i[0] === s).length;
  console.log(`\n${n('✓')} ok · ${n('!')} atenção · ${n('✗')} impede${n('✗') ? ' — resolva os ✗ antes de subir.' : ''}\n`);
  process.exit(n('✗') ? 1 : 0);
})();
