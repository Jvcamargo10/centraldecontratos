/* ===================================================================
   integrations/buscaDocumentos.js

   Busca dentro dos documentos já lidos (01/10/2026): o texto de cada
   documento que a Central leu (contratos, aditivos, apólices, requisições,
   termos) já está no cache de texto, com CPF mascarado. Aqui ele vira um
   índice em memória para buscar "multa", "reajuste", um CNPJ ou uma frase
   entre aspas em todos de uma vez — com a página e o trecho.

   Só busca o que já foi lido: documento que a Central nunca leu (uma nota
   fiscal, por exemplo) não aparece. O índice é refeito sozinho quando o
   cache muda (outro documento lido). Nada é enviado para fora.
=================================================================== */
const fs = require('fs');
const path = require('path');

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
let indice = { assinatura: null, documentos: [] };

function assinaturaDaPasta(pasta) {
  try {
    const nomes = fs.readdirSync(pasta).filter(n => n.endsWith('.json'));
    let ultimo = 0;
    for (const n of nomes) { const m = fs.statSync(path.join(pasta, n)).mtimeMs; if (m > ultimo) ultimo = m; }
    return `${nomes.length}:${Math.round(ultimo)}`;
  } catch (e) { return 'vazia'; }
}

/* Carrega (ou reaproveita) o índice. `pasta`: a do cache de texto. */
function obterIndice(pasta) {
  const assinatura = assinaturaDaPasta(pasta);
  if (indice.assinatura === assinatura) return indice;
  const documentos = [];
  const vistos = new Set();
  let nomes = [];
  try { nomes = fs.readdirSync(pasta).filter(n => n.endsWith('.json')); } catch (e) { nomes = []; }
  for (const n of nomes) {
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(pasta, n), 'utf8')); } catch (e) { continue; }
    const caminho = j.caminho || (j.resultado && j.resultado.caminho);
    const paginas = (j.resultado && j.resultado.paginas) || [];
    if (!caminho || !paginas.length || vistos.has(caminho.toLowerCase())) continue;
    vistos.add(caminho.toLowerCase());
    documentos.push({
      caminho, nome: path.basename(caminho).normalize('NFC'),
      paginas: paginas.map(p => ({ numero: p.numero, texto: String(p.texto || ''), normal: norm(p.texto) }))
    });
  }
  indice = { assinatura, documentos, carregadoEm: new Date().toISOString() };
  return indice;
}

/* "multa reajuste" = as duas palavras no mesmo documento; "multa de mora"
   entre aspas = a frase exata. Sem diferença de maiúsculas e acentos. */
function interpretarConsulta(q) {
  const termos = [];
  const texto = String(q || '').trim();
  const frases = [...texto.matchAll(/"([^"]{2,})"/g)].map(m => norm(m[1]).trim()).filter(Boolean);
  const resto = texto.replace(/"[^"]*"/g, ' ');
  const palavras = norm(resto).split(/\s+/).map(w => w.replace(/^[^a-z0-9]+|[^a-z0-9./-]+$/g, '')).filter(w => w.length >= 2);
  termos.push(...frases, ...palavras);
  return [...new Set(termos)];
}

/* Trecho em volta da posição: o texto original (com acento), ~90 caracteres de cada lado. */
function trecho(texto, normal, pos, tamanho) {
  const ini = Math.max(0, pos - 90);
  const fim = Math.min(texto.length, pos + tamanho + 90);
  // norm() não muda o tamanho do texto em português (o acento combinante sai; a letra base fica) —
  // mas por segurança o recorte usa as mesmas posições no texto original.
  return { antes: (ini > 0 ? '…' : '') + texto.slice(ini, pos).replace(/\s+/g, ' '), achado: texto.slice(pos, pos + tamanho), depois: texto.slice(pos + tamanho, fim).replace(/\s+/g, ' ') + (fim < texto.length ? '…' : '') };
}

function buscar(pasta, q, { limite = 100, porDocumento = 3, filtro = null } = {}) {
  const termos = interpretarConsulta(q);
  if (!termos.length) throw new Error('Digite ao menos uma palavra (2 letras ou mais).');
  const { documentos } = obterIndice(pasta);
  const resultados = [];
  let totalDocumentos = 0;
  for (const d of documentos) {
    if (filtro && !filtro(d.caminho)) continue;
    const juntos = d.paginas.map(p => p.normal).join('\n');
    if (!termos.every(t => juntos.includes(t))) continue;
    totalDocumentos++;
    if (resultados.length >= limite) continue;
    // Todas as ocorrências; depois os trechos: primeiro um de cada termo (para
    // "reajuste ipca" mostrar onde está o IPCA), e o resto na ordem do documento.
    const achados = [];
    for (const p of d.paginas) {
      for (const t of termos) {
        for (let i = p.normal.indexOf(t); i >= 0; i = p.normal.indexOf(t, i + t.length)) achados.push({ p, t, i });
      }
    }
    const ocorrencias = achados.length;
    const trechos = [];
    const incluir = ({ p, t, i }) => {
      if (trechos.length >= porDocumento || trechos.some(x => x.pagina === p.numero && Math.abs(x.pos - i) < 120)) return;
      // Mesmo tamanho entre o texto normalizado e o original? (Texto com caractere
      // composto pode mudar; aí o trecho é recortado do normalizado, sem acento.)
      const mesmoTamanho = p.normal.length === p.texto.length;
      trechos.push({ pagina: p.numero, pos: i, termo: t, ...trecho(mesmoTamanho ? p.texto : p.normal, p.normal, i, t.length) });
    };
    for (const t of termos) { const a = achados.find(x => x.t === t); if (a) incluir(a); }
    achados.forEach(incluir);
    trechos.sort((a, b) => (a.pagina - b.pagina) || (a.pos - b.pos));
    resultados.push({ caminho: d.caminho, nome: d.nome, ocorrencias, trechos: trechos.map(({ pos, termo, ...x }) => x) });
  }
  resultados.sort((a, b) => b.ocorrencias - a.ocorrencias);
  return { termos, totalDocumentos, documentosNoIndice: documentos.length, resultados };
}

function documentoNoIndice(pasta, caminho) {
  return obterIndice(pasta).documentos.some(d => d.caminho === caminho);
}

module.exports = { buscar, obterIndice, interpretarConsulta, documentoNoIndice };
