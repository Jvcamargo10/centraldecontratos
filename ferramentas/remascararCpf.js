/* ===================================================================
   ferramentas/remascararCpf.js

   Aplica a máscara de CPF nova (integrations/mascaraDados.js) ao texto
   que JÁ estava guardado — sem refazer OCR nenhum. Criado em 24/09/2026:
   a máscara antiga só reconhecia "123.456.789-01" e deixou passar 140
   CPFs lidos pelo OCR com outra pontuação ou colados ao nome na
   assinatura digital.

       node ferramentas/remascararCpf.js              simula (não grava)
       node ferramentas/remascararCpf.js --confirmar  grava

   Onde aplica:
     - .texto-cache/                  (texto dos documentos);
     - ferramentas/avaliacao/cache/   (texto da avaliação);
     - data.json: textos das propostas, contratos, termos, mapas e
       registros de risco (nunca usuários, senhas nem auditoria).
   Cuidados: data.json só é gravado com o servidor DESLIGADO (o servidor
   mantém o banco em memória e sobrescreveria a correção), com backup em
   backups/antes-de-remascarar-cpf-AAAA-MM-DD-HHMMSS.json e gravação
   atômica. Pode rodar de novo: texto já mascarado não muda.
=================================================================== */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { mascararCpf } = require('../integrations/mascaraDados');

const RAIZ = path.join(__dirname, '..');
const CONFIRMAR = process.argv.includes('--confirmar');
const PORTA = Number(process.env.PORT) || 3001;
const COLECOES_DO_BANCO = ['importacoesPendentes', 'contratos', 'aditivos', 'apostilamentos', 'mapasRisco', 'fichasCadastro', 'registroRiscos', 'tratativas', 'comentarios'];

function servidorNoAr() {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port: PORTA, path: '/api/session', timeout: 2000 }, res => { res.resume(); resolve(true); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function gravarAtomico(arquivo, conteudo) {
  const tmp = `${arquivo}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, conteudo);
  fs.renameSync(tmp, arquivo);
}

/* Aplica a máscara em todas as strings de um objeto; devolve quantas mudaram. */
function mascararStrings(obj) {
  let mudou = 0;
  const visitar = o => {
    if (Array.isArray(o)) { o.forEach((v, i) => { if (typeof v === 'string') { const n = mascararCpf(v); if (n !== v) { o[i] = n; mudou++; } } else if (v && typeof v === 'object') visitar(v); }); return; }
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (typeof v === 'string') { const n = mascararCpf(v); if (n !== v) { o[k] = n; mudou++; } } else if (v && typeof v === 'object') visitar(v);
    }
  };
  visitar(obj);
  return mudou;
}

function pastaDeJson(pasta, rotulo) {
  if (!fs.existsSync(pasta)) return;
  let arquivos = 0, textos = 0;
  for (const nome of fs.readdirSync(pasta).filter(n => n.endsWith('.json'))) {
    const arq = path.join(pasta, nome);
    let j;
    try { j = JSON.parse(fs.readFileSync(arq, 'utf8')); } catch (e) { continue; }
    const n = mascararStrings(j);
    if (!n) continue;
    arquivos++; textos += n;
    if (CONFIRMAR) gravarAtomico(arq, JSON.stringify(j));
  }
  console.log(`${rotulo}: ${arquivos} arquivo(s), ${textos} texto(s) com CPF fora da máscara${CONFIRMAR ? ' — corrigidos' : ''}.`);
}

async function main() {
  console.log(CONFIRMAR ? 'Aplicando a máscara nova…' : 'SIMULAÇÃO (nada é gravado; use --confirmar para aplicar):');
  pastaDeJson(path.join(RAIZ, '.texto-cache'), 'Cache de texto');
  pastaDeJson(path.join(RAIZ, 'ferramentas', 'avaliacao', 'cache'), 'Cache da avaliação');

  const arqBanco = path.join(RAIZ, 'data.json');
  if (!fs.existsSync(arqBanco)) return;
  const bruto = fs.readFileSync(arqBanco, 'utf8');
  const db = JSON.parse(bruto);
  let total = 0;
  const porColecao = {};
  for (const c of COLECOES_DO_BANCO) {
    if (!Array.isArray(db[c])) continue;
    const n = mascararStrings(db[c]);
    if (n) { porColecao[c] = n; total += n; }
  }
  console.log(`data.json: ${total} texto(s) com CPF fora da máscara ${JSON.stringify(porColecao)}.`);
  if (!CONFIRMAR || !total) return;
  if (await servidorNoAr()) {
    console.log(`O servidor está no ar (porta ${PORTA}): data.json NÃO foi alterado. Pare o servidor e rode de novo.`);
    process.exitCode = 2;
    return;
  }
  fs.mkdirSync(path.join(RAIZ, 'backups'), { recursive: true });
  const agora = new Date();
  const carimbo = `${agora.toISOString().slice(0, 10)}-${String(agora.getHours()).padStart(2, '0')}${String(agora.getMinutes()).padStart(2, '0')}${String(agora.getSeconds()).padStart(2, '0')}`;
  const backup = path.join(RAIZ, 'backups', `antes-de-remascarar-cpf-${carimbo}.json`);
  fs.writeFileSync(backup, bruto);
  gravarAtomico(arqBanco, JSON.stringify(db, null, 2));
  console.log(`data.json corrigido. Backup: ${path.relative(RAIZ, backup)}`);
}

main().catch(e => { console.error('Falhou:', e.message); process.exit(1); });
