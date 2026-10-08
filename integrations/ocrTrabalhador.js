/* ===================================================================
   integrations/ocrTrabalhador.js

   Roda num PROCESSO FILHO (ver ocrDePaginasPdf em extratorDocumento.js):
   lê o PDF, desenha as páginas escaneadas e faz o OCR fora do processo
   do servidor. Antes (até 24/09/2026), isso rodava no próprio servidor,
   que parava de responder enquanto um documento era lido.

   Processo, e não worker thread: o componente nativo de desenho
   (@napi-rs/canvas) derruba o Node com "Segmentation fault" quando a
   thread é descarregada — visto no teste de 24/09/2026. Como processo,
   ele ainda ganha prioridade própria (mínima) e, ao sair, devolve toda a
   memória ao Windows.

   Mensagem recebida: { id, caminho, paginas: [n...], timeoutMs, escala,
   idioma, langPath, cachePath, limiarBranco }.
   Resposta: { id, ok, paginas: [{ numero, texto, branca? }],
   interrompidoPorTempo } ou { id, ok: false, erro }.
=================================================================== */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let pdfjsPromise = null;
let tesseractPromise = null;

function obterPdfjs() {
  if (!pdfjsPromise) pdfjsPromise = import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
  return pdfjsPromise;
}

/* Um motor do Tesseract por thread, reaproveitado entre documentos.
   `tessedit_do_invert=0`: o Tesseract testa, em cada linha, se o texto
   está invertido (branco no preto) — em contrato isso não acontece.
   Medido em 24/09/2026: ~8% mais rápido, mesmo texto. */
function obterTesseract(job) {
  if (!tesseractPromise) {
    tesseractPromise = (async () => {
      const { createWorker } = require('tesseract.js');
      fs.mkdirSync(job.cachePath, { recursive: true });
      const w = await createWorker(job.idioma, 1, { langPath: job.langPath, gzip: true, cachePath: job.cachePath });
      await w.setParameters({ tessedit_do_invert: '0' });
      return w;
    })().catch(err => { tesseractPromise = null; throw err; });
  }
  return tesseractPromise;
}

/* pdfjs trata as pastas de fontes como URL: barra "/" sempre, e no fim. */
const comoUrl = (...p) => path.join(...p).split(path.sep).join('/') + '/';

/* Página em branco (verso, folha de separação): quase nenhum pixel
   escuro. O limiar é bem baixo — uma única linha de texto já passa de
   0,2% da página —, para só pular o que é de fato vazio. */
function ehBranca(ctx, largura, altura, limiar) {
  const { data } = ctx.getImageData(0, 0, largura, altura);
  let escuros = 0;
  // Amostra 1 a cada 4 pixels: suficiente para decidir, 4× mais rápido.
  for (let i = 0; i < data.length; i += 16) {
    if (data[i + 3] > 0 && (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8 < 128) escuros++;
  }
  return escuros / (data.length / 16) < limiar;
}

async function processar(job) {
  const pdfjs = await obterPdfjs();
  const dirBase = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(fs.readFileSync(job.caminho)),
    disableWorker: true,
    standardFontDataUrl: comoUrl(dirBase, 'standard_fonts'),
    cMapUrl: comoUrl(dirBase, 'cmaps'),
    cMapPacked: true,
    /* Decodificador de JPEG 2000 (OpenJPEG). Sem ele, a imagem JPX vira
       página em branco e o OCR não lê nada — foi o caso do recorte da
       Imprensa Oficial "Alteração de Gestor e Suplente" do 20.032
       (25/09/2026: "JpxError: OpenJPEG failed to initialize"). */
    wasmUrl: comoUrl(dirBase, 'wasm')
  }).promise;
  const tesseract = await obterTesseract(job);
  const { createCanvas } = require('@napi-rs/canvas');
  const paginas = [];
  const inicio = Date.now();
  let interrompidoPorTempo = false;
  try {
    for (const numero of job.paginas) {
      if (Date.now() - inicio > job.timeoutMs) { interrompidoPorTempo = true; break; }
      const pagina = await doc.getPage(numero);
      const viewport = pagina.getViewport({ scale: job.escala });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d');
      await pagina.render({ canvasContext: ctx, viewport }).promise;
      pagina.cleanup();
      if (ehBranca(ctx, canvas.width, canvas.height, job.limiarBranco)) {
        paginas.push({ numero, texto: '', branca: true });
        continue;
      }
      const { data } = await tesseract.recognize(canvas.toBuffer('image/png'));
      paginas.push({ numero, texto: (data.text || '').trim() });
    }
  } finally {
    await doc.destroy();
  }
  return { paginas, interrompidoPorTempo };
}

/* PDF com texto próprio (sem OCR): também fora da thread principal — um
   PDF de 348 páginas levava 3 s para ser lido, com o servidor parado. */
async function lerTexto(job) {
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: fs.readFileSync(job.caminho) });
  try {
    const r = await parser.getText();
    return { paginas: (r.pages || []).map(p => ({ numero: p.num, texto: (p.text || '').trim() })) };
  } finally {
    await parser.destroy();
  }
}

async function encerrar(codigo) {
  try { if (tesseractPromise) await (await tesseractPromise).terminate(); } catch (e) { /* já fechado */ }
  process.exit(codigo);
}

process.on('message', async job => {
  if (job && job.tipo === 'encerrar') return encerrar(0);
  try {
    const resultado = job.tipo === 'texto' ? await lerTexto(job) : await processar(job);
    process.send({ id: job.id, ok: true, ...resultado });
  } catch (err) {
    process.send({ id: job.id, ok: false, erro: err.message });
  }
});
// O servidor caiu ou fechou: não fica um processo órfão lendo PDF.
process.on('disconnect', () => encerrar(0));
