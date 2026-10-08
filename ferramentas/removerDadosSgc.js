/* ===================================================================
   ferramentas/removerDadosSgc.js

   Apaga do data.json tudo o que veio da API do SGC (ver
   integrations/removerDadosSgc.js para o que sai e o que fica).

   Uso:  node ferramentas/removerDadosSgc.js --confirmar

   Travas, nesta ordem:
     1. sem --confirmar, só mostra o que seria removido (simulação);
     2. se o servidor estiver no ar, NÃO grava: ele mantém o banco em
        memória e, na próxima gravação, devolveria tudo ao arquivo;
     3. antes de gravar, copia o data.json inteiro para
        backups/antes-de-remover-sgc-AAAA-MM-DD-HHMMSS.json — para
        desfazer, basta parar o servidor e copiar esse arquivo de volta
        sobre o data.json.
=================================================================== */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { removerDadosDoSgc } = require('../integrations/removerDadosSgc');

const RAIZ = path.join(__dirname, '..');
const DATA_FILE = path.join(RAIZ, 'data.json');
const PASTA_BACKUP = path.join(RAIZ, 'backups');
const PORTA = Number(process.env.PORT) || 3001;

function servidorNoAr() {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port: PORTA, path: '/api/session', timeout: 2000 }, res => { res.resume(); resolve(true); });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

function carimbo() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

(async () => {
  const confirmar = process.argv.includes('--confirmar');
  const db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const resumo = removerDadosDoSgc(db);

  console.log(confirmar ? 'Remoção dos dados vindos da API do SGC' : 'SIMULAÇÃO (nada foi gravado) — use --confirmar para remover');
  console.log('  removidos:', JSON.stringify(resumo.removidos));
  console.log('  dependentes removidos:', JSON.stringify(resumo.dependentesRemovidos));
  console.log('  propostas pendentes desvinculadas:', resumo.propostasDesvinculadas, '| aprovadas marcadas:', resumo.propostasAprovadasMarcadas);
  console.log('  total de registros removidos:', resumo.totalRemovido);
  if (!confirmar) return;

  if (await servidorNoAr()) {
    console.error(`\nABORTADO: o servidor está no ar na porta ${PORTA}. Pare o servidor (Ctrl+C no terminal do npm start) e rode de novo.`);
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(PASTA_BACKUP, { recursive: true });
  const backup = path.join(PASTA_BACKUP, `antes-de-remover-sgc-${carimbo()}.json`);
  fs.copyFileSync(DATA_FILE, backup);

  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);

  console.log(`\nFeito. Backup do estado anterior: ${path.relative(RAIZ, backup)}`);
  console.log('Para desfazer: pare o servidor e copie esse arquivo por cima do data.json.');
})().catch(err => { console.error('Erro:', err.message); process.exitCode = 1; });
