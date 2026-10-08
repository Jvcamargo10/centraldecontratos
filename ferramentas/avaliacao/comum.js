/* ===================================================================
   ferramentas/avaliacao/comum.js

   Base da AVALIAÇÃO da extração: quanto cada método (busca local por
   padrões) acerta dos campos de contrato, medido contra o SGC.

   Por que existe: antes de construir um extrator especializado nos
   contratos da Prefeitura (ou de fazer fine-tuning de um modelo), é
   preciso saber, campo por campo, onde cada método acerta e onde erra.
   Sem medição, "melhorar a extração" vira tentativa e erro no escuro.

   O gabarito é o SGC: os contratos sincronizados em data.json têm o
   número do Processo Administrativo (campo `pa`), e cada processo tem uma
   pasta na rede ("P.A. 01.275_2025 - ..."). Casando os dois pelo P.A.,
   cada contrato do SGC ganha os PDFs de origem — e o que está no SGC vira
   a resposta certa para comparar.

   Os documentos de contrato de cada processo ficam sempre na subpasta
   "3. Contratos, Aditivos e Termos" (o processo inteiro tem 21 subpastas
   padronizadas: edital, propostas, notas fiscais, empenhos...). Só essa
   subpasta interessa aqui.
=================================================================== */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROJ = path.join(__dirname, '..', '..');
const PASTA_CACHE = path.join(__dirname, 'cache');

function lerEnv() {
  const env = {};
  const arq = path.join(PROJ, '.env');
  if (!fs.existsSync(arq)) return env;
  for (const l of fs.readFileSync(arq, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

/* Raiz dos processos em vigência. Pode ser informada em
   CONTRATOS_AVALIACAO_RAIZ; senão, é deduzida de CONTRATOS_ARQUIVOS_PASTAS
   (que pode ser a própria raiz ou uma pasta abaixo dela). */
function raizDosProcessos(env) {
  if (env.CONTRATOS_AVALIACAO_RAIZ) return env.CONTRATOS_AVALIACAO_RAIZ;
  const pasta = (env.CONTRATOS_ARQUIVOS_PASTAS || '').split(';')[0].trim();
  if (!pasta) throw new Error('Defina CONTRATOS_AVALIACAO_RAIZ (ou CONTRATOS_ARQUIVOS_PASTAS) no .env.');
  // A própria pasta configurada pode já ser a raiz; senão, sobe até achar
  // a pasta cujas filhas são "P.A. ...".
  try {
    if (fs.readdirSync(pasta).some(n => /^P\.A\.\s*\d/i.test(n))) return pasta;
  } catch (e) { /* segue subindo */ }
  let atual = pasta;
  for (let i = 0; i < 5; i++) {
    const pai = path.dirname(atual);
    try {
      if (fs.readdirSync(pai).some(n => /^P\.A\.\s*\d/i.test(n))) return pai;
    } catch (e) { /* segue subindo */ }
    atual = pai;
  }
  throw new Error(`Não achei a pasta dos processos a partir de "${pasta}". Defina CONTRATOS_AVALIACAO_RAIZ no .env.`);
}

/* "P.A. 01.275_2025" -> "01.275/2025" (mesmo formato do campo `pa` do SGC). */
function normalizarPa(texto) {
  const m = String(texto || '').match(/(\d{1,2})\.?(\d{3})\s*[_/]\s*(\d{4})/);
  return m ? `${m[1].padStart(2, '0')}.${m[2]}/${m[3]}` : null;
}

/* Processos com pasta 3 e contrato casado no SGC — o conjunto avaliável. */
function listarProcessos(raiz, db) {
  const sgcPorPa = new Map();
  (db.contratos || []).forEach(c => {
    const k = normalizarPa(c.pa);
    if (!k) return;
    if (!sgcPorPa.has(k)) sgcPorPa.set(k, []);
    sgcPorPa.get(k).push(c);
  });

  const processos = [];
  for (const e of fs.readdirSync(raiz, { withFileTypes: true })) {
    if (!e.isDirectory() || !/^P\.A\.\s*\d/i.test(e.name)) continue; // ignora "Modelo", "Arquivos para Excluir"...
    const pa = normalizarPa(e.name);
    const dirProcesso = path.join(raiz, e.name);
    const pasta3 = fs.readdirSync(dirProcesso, { withFileTypes: true })
      .find(s => s.isDirectory() && /^3\.\s*contrato/i.test(s.name));
    processos.push({
      nome: e.name,
      pa,
      pasta3: pasta3 ? path.join(dirProcesso, pasta3.name) : null,
      sgc: pa ? (sgcPorPa.get(pa) || []) : []
    });
  }
  return processos;
}

/* Documentos (PDF/DOCX) da pasta 3, recursivo — o contrato costuma estar
   numa subpasta "Contrato Nº ...", aditivos e apostilamentos em outras. */
function listarDocumentos(pasta3) {
  const docs = [];
  (function andar(d, prof) {
    if (prof > 3) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const c = path.join(d, e.name);
      if (e.isDirectory()) andar(c, prof + 1);
      else if (/\.(pdf|docx)$/i.test(e.name) && !e.name.startsWith('~$')) docs.push({ caminho: c, nome: e.name });
    }
  })(pasta3, 0);
  return docs.sort((a, b) => a.caminho.localeCompare(b.caminho));
}

/* ------------------------------------------------------------------
   Cache do texto extraído — o OCR é a parte cara (minutos por PDF
   digitalizado); extrai-se uma vez e avalia-se quantas vezes quiser.
   Chave: caminho; validade: tamanho + data de modificação do arquivo.
------------------------------------------------------------------ */
function arquivoDeCache(caminho) {
  return path.join(PASTA_CACHE, crypto.createHash('sha1').update(caminho).digest('hex') + '.json');
}

function assinatura(caminho) {
  const st = fs.statSync(caminho);
  return `${st.size}:${Math.round(st.mtimeMs)}`;
}

function lerCache(caminho) {
  const arq = arquivoDeCache(caminho);
  if (!fs.existsSync(arq)) return null;
  try {
    const c = JSON.parse(fs.readFileSync(arq, 'utf8'));
    return c.assinatura === assinatura(caminho) ? c : null;
  } catch (e) { return null; }
}

function gravarCache(caminho, dados) {
  fs.mkdirSync(PASTA_CACHE, { recursive: true });
  fs.writeFileSync(arquivoDeCache(caminho), JSON.stringify({ caminho, assinatura: assinatura(caminho), ...dados }));
}

module.exports = { PROJ, lerEnv, raizDosProcessos, normalizarPa, listarProcessos, listarDocumentos, lerCache, gravarCache };
