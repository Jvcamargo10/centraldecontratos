/* ===================================================================
   ferramentas/avaliacao/avaliar.js

   Etapa 2 da avaliação: compara, campo por campo, o que cada método
   extrai dos documentos com o que está registrado no SGC.

       npm run avaliacao                 leitura por regra (segundos)

   Precisa do texto já extraído: rode antes `npm run avaliacao:extrair`.

   Para cada campo, quatro números:
     - acerto:  o método extraiu e bate com o SGC;
     - erro:    extraiu, mas diferente do SGC;
     - vazio:   não extraiu nada;
     - no doc.: o valor do SGC APARECE ESCRITO nos documentos?
   O último é o teto de qualquer método: se a vigência do SGC não está
   escrita nos PDFs, nenhuma extração vai achá-la — a resposta aí é outra
   fonte, não um extrator melhor.

   Resultado detalhado em ferramentas/avaliacao/resultado.json.
=================================================================== */

const fs = require('fs');
const path = require('path');
const comum = require('./comum');

const env = comum.lerEnv();
Object.entries(env).forEach(([k, v]) => { if (process.env[k] === undefined) process.env[k] = v; });
const leituraPorRegra = require('../../integrations/leituraPorRegra');
const extrator = require('../../integrations/extratorDocumento');

/* Texto de um documento: o do cache da aplicação (.texto-cache), quando
   existe — ele é o mais completo (inclui, por exemplo, as últimas páginas
   lidas por OCR, onde fica a data de assinatura); senão, o da avaliação. */
function lerTexto(caminho) {
  const maxOcr = Number(process.env.CONTRATOS_OCR_MAX_PAGINAS) || 5;
  const timeoutOcr = Number(process.env.CONTRATOS_OCR_TIMEOUT_MS) || 45000;
  const daAplicacao = extrator._cache.lerDoCache(caminho, maxOcr, timeoutOcr);
  if (daAplicacao) return { texto: extrator._cache.textoDasPaginas(daAplicacao.paginas), semTexto: daAplicacao.semTexto };
  return comum.lerCache(caminho);
}


/* ------------------------------------------------------------------
   Normalização para comparar: o SGC e os documentos escrevem o mesmo
   dado de jeitos diferentes (CNPJ com e sem pontuação, "Atlas" x
   "AURORA TECNOLOGIA LTDA", "096/2025" x "96/2025").
------------------------------------------------------------------ */
const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const soDigitos = s => String(s || '').replace(/\D/g, '');

function numeroNormalizado(s) {
  const m = String(s || '').match(/(\d{1,6})\s*[/_.-]\s*(\d{2,4})/);
  if (!m) return null;
  const ano = m[2].length === 2 ? '20' + m[2] : m[2];
  return `${Number(m[1])}/${ano}`;
}

const SUFIXOS_EMPRESA = /\b(ltda|s\.?\s?a\.?|eireli|epp|me|limitada|cia|companhia)\b\.?/g;
function nomeEmpresa(s) {
  return semAcento(s).toLowerCase().replace(SUFIXOS_EMPRESA, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
/* Empresa bate se um nome contém o outro (o SGC às vezes guarda só o
   nome fantasia) ou se a maior parte das palavras coincide. */
function empresaBate(a, b) {
  const x = nomeEmpresa(a), y = nomeEmpresa(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const px = new Set(x.split(' ').filter(p => p.length > 2));
  const py = y.split(' ').filter(p => p.length > 2);
  const comuns = py.filter(p => px.has(p)).length;
  return comuns / Math.max(1, Math.min(px.size, py.length)) >= 0.6;
}

/* Cada campo avaliado: como comparar e como saber se o valor do SGC está
   escrito no texto. */
const CAMPOS = [
  { campo: 'numero', bate: (x, d) => numeroNormalizado(x) && numeroNormalizado(x) === numeroNormalizado(d),
    noDoc: (d, t) => { const n = numeroNormalizado(d); if (!n) return false; const [num, ano] = n.split('/'); return new RegExp(`0*${num}\\s*[/_.-]\\s*(${ano}|${ano.slice(2)})\\b`).test(t); } },
  { campo: 'pa', bate: (x, d) => comum.normalizarPa(x) && comum.normalizarPa(x) === comum.normalizarPa(d),
    noDoc: (d, t) => { const p = comum.normalizarPa(d); if (!p) return false; const [a, b] = p.split('/'); return new RegExp(`0?${a.replace('.', '\\.?')}\\s*[/_]\\s*${b}`).test(t); } },
  { campo: 'cnpjEmpresa', bate: (x, d) => soDigitos(x).length === 14 && soDigitos(x) === soDigitos(d),
    noDoc: (d, t) => soDigitos(d).length === 14 && soDigitos(t).includes(soDigitos(d)) },
  { campo: 'empresa', bate: (x, d) => empresaBate(x, d),
    noDoc: (d, t) => { const n = nomeEmpresa(d); return !!n && nomeEmpresa(t).includes(n); } },
  { campo: 'secretaria', bate: (x, d) => { const a = nomeEmpresa(x), b = nomeEmpresa(d); return !!a && !!b && (a.includes(b) || b.includes(a.replace(/ setec$/, ''))); },
    noDoc: (d, t) => { const n = nomeEmpresa(String(d).replace(/\s*-\s*[A-Z]+$/, '')); return !!n && nomeEmpresa(t).includes(n); } },
  { campo: 'inicio', bate: (x, d) => x === d, noDoc: (d, t) => !!d && leituraPorRegra.dataApareceNoTexto(d, t) },
  { campo: 'termino', bate: (x, d) => x === d, noDoc: (d, t) => !!d && leituraPorRegra.dataApareceNoTexto(d, t) },
  // Até 2 centavos: o SGC ora trunca, ora arredonda a divisão
  // (064/2025: 12.990.250 ÷ 24 = 541.260,4166 -> SGC 541.260,41).
  { campo: 'valor', bate: (x, d) => Number(x) > 0 && Math.abs(Number(x) - Number(d)) <= 0.021,
    noDoc: (d, t) => Number(d) > 0 && leituraPorRegra.valorApareceNoTexto(d, t) }
];

const vazio = v => v === undefined || v === null || v === '';

/* O contrato "principal" da pasta 3 — nela também ficam aditivos,
   apostilamentos e extratos, que repetem o preâmbulo com outros números. */
function ordenarDocumentos(docs) {
  const principal = d => /contrato/i.test(d.nome) && !/(extrato|aditivo|aditamento|apostil|termo\s+de|rescis)/i.test(d.nome);
  return docs.slice().sort((a, b) => (principal(b) - principal(a)) || (b.texto.length - a.texto.length));
}

function avaliarCampos(extraido, sgc, texto) {
  const r = {};
  CAMPOS.forEach(({ campo, bate, noDoc }) => {
    const x = extraido[campo], d = sgc[campo];
    const noDocumento = vazio(d) ? null : !!noDoc(d, texto);
    /* "erro" só quando o valor do SGC ESTÁ no documento e o método não o
       trouxe — falha de extração. Se o SGC não está no documento e o
       método trouxe outra coisa, o documento é que diz outra coisa
       ("divergente"): CNPJ da filial, instituto que mudou de nome,
       secretaria com nome antigo. Isso vale saber, mas não é culpa do
       extrator — misturar os dois tornaria a medição inútil para decidir
       o que corrigir. */
    const resultado = vazio(d) ? 'sem_gabarito'
      : vazio(x) ? 'vazio'
      : bate(x, d) ? 'acerto'
      : noDocumento ? 'erro' : 'divergente';
    r[campo] = { sgc: vazio(d) ? null : d, extraido: vazio(x) ? null : x, resultado, noDocumento };
  });
  return r;
}

(async () => {
  const db = JSON.parse(fs.readFileSync(path.join(comum.PROJ, 'data.json'), 'utf8'));
  const raiz = comum.raizDosProcessos(env);
  const processos = comum.listarProcessos(raiz, db).filter(p => p.pasta3 && p.sgc.length);

  const resultados = [];
  let semCache = 0;
  for (const p of processos) {
    const docs = comum.listarDocumentos(p.pasta3).map(d => ({ ...d, cache: lerTexto(d.caminho) }));
    const faltando = docs.filter(d => !d.cache).length;
    semCache += faltando;
    const comTexto = ordenarDocumentos(docs.filter(d => d.cache && !d.cache.semTexto).map(d => ({ nome: d.nome, texto: d.cache.texto })));
    const texto = comTexto.map(d => `=== Arquivo: ${d.nome} ===\n${d.texto}`).join('\n\n');
    // Mais de um contrato no SGC com o mesmo P.A.: vale o que tem o número escrito nos documentos.
    const sgc = p.sgc.find(c => CAMPOS[0].noDoc(c.numero, texto)) || p.sgc[0];

    const local = leituraPorRegra.lerCampos(texto);
    resultados.push({
      processo: p.nome, contrato: sgc.numero,
      documentos: docs.length, documentosSemCache: faltando, documentosComTexto: comTexto.length,
      principal: comTexto[0] ? comTexto[0].nome : null,
      buscaLocal: avaliarCampos(local.campos, sgc, texto)
    });
  }

  // ------------------------------------------------------------ resumo
  function resumo(chave) {
    const linhas = [];
    for (const { campo } of CAMPOS) {
      const vals = resultados.map(r => r[chave] && r[chave][campo]).filter(v => v && v.resultado !== 'sem_gabarito');
      if (!vals.length) continue;
      const n = s => vals.filter(v => v.resultado === s).length;
      const noDoc = vals.filter(v => v.noDocumento).length;
      linhas.push({ campo, total: vals.length, acerto: n('acerto'), erro: n('erro'), divergente: n('divergente'), vazio: n('vazio'), noDocumento: noDoc });
    }
    return linhas;
  }
  function imprimir(titulo, linhas) {
    console.log(`\n${titulo}`);
    console.log('  campo          acerto   erro  diverg.  vazio   | valor do SGC escrito nos docs');
    linhas.forEach(l => console.log(`  ${l.campo.padEnd(14)} ${String(l.acerto).padStart(3)}/${String(l.total).padEnd(3)} ${String(l.erro).padStart(4)} ${String(l.divergente).padStart(7)} ${String(l.vazio).padStart(6)}   | ${l.noDocumento}/${l.total}`));
  }

  console.log(`\n${resultados.length} contratos avaliados (${resultados.filter(r => r.documentosComTexto).length} com texto).${semCache ? ` ATENÇÃO: ${semCache} documento(s) ainda sem texto extraído — rode "npm run avaliacao:extrair" até o fim.` : ''}`);
  const resumoLocal = resumo('buscaLocal');
  imprimir('LEITURA POR REGRA:', resumoLocal);

  const saida = path.join(__dirname, 'resultado.json');
  fs.writeFileSync(saida, JSON.stringify({
    geradoEm: new Date().toISOString(),
    resumo: { buscaLocal: resumoLocal },
    contratos: resultados
  }, null, 1));
  console.log(`\nDetalhe por contrato: ${path.relative(comum.PROJ, saida)}`);
  process.exit(0);
})();
