/* ===================================================================
   integrations/carregarEnv.js

   Lê o .env da raiz do projeto para process.env, sem pacote externo.
   Nunca sobrescreve variável já definida no ambiente (por `set`/`$env:`
   ou pela configuração do serviço do Windows). Usado pelo server.js e
   pelas ferramentas de linha de comando (verificarServidor, trocarRaiz),
   que precisam enxergar a mesma configuração.
=================================================================== */
const fs = require('fs');
const path = require('path');

function carregarEnv(arquivo = path.join(__dirname, '..', '.env')) {
  if (!fs.existsSync(arquivo)) return false;
  fs.readFileSync(arquivo, 'utf8').split('\n').forEach(line => {
    const l = line.trim();
    if (!l || l.startsWith('#')) return;
    const eq = l.indexOf('=');
    if (eq === -1) return;
    const key = l.slice(0, eq).trim();
    let value = l.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  });
  return true;
}

module.exports = { carregarEnv };
