/* Cache do texto extraído (extratorDocumento.js): vale enquanto o arquivo
   não muda, e leitura parcial não serve para quem pede mais páginas. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const extrator = require('../integrations/extratorDocumento');
const { CONFIG_CACHE, gravarNoCache, lerDoCache } = extrator._cache;

function ambiente() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setec-cache-'));
  CONFIG_CACHE.pasta = path.join(dir, 'cache');
  const arquivo = path.join(dir, 'contrato.pdf');
  fs.writeFileSync(arquivo, 'conteúdo qualquer');
  return arquivo;
}

// Página com texto de verdade (~400 caracteres): página única com pouco texto
// é tratada como digitalizada e vai para o OCR (ver camadaDeTextoRala).
const PAGINA = 'CONTRATO Nº 010/2024. ' + 'Cláusula do contrato. '.repeat(18);

const resultado = (caminho, extra) => ({
  caminho, extensao: 'pdf', semTexto: false, totalCaracteres: 10,
  paginas: [{ numero: 1, texto: PAGINA }], texto: '[página 1]\n' + PAGINA,
  ocr: null, leituraCompleta: true, ...extra
});

test('o texto gravado volta do cache enquanto o arquivo não muda', () => {
  const arquivo = ambiente();
  gravarNoCache(arquivo, resultado(arquivo), 10, 180000);
  const lido = lerDoCache(arquivo, 10, 180000);
  assert.ok(lido && lido.doCache);
  assert.deepStrictEqual(lido.paginas, [{ numero: 1, texto: PAGINA }]);
});

test('arquivo alterado invalida o cache', () => {
  const arquivo = ambiente();
  gravarNoCache(arquivo, resultado(arquivo), 10, 180000);
  fs.appendFileSync(arquivo, ' + aditivo');
  assert.strictEqual(lerDoCache(arquivo, 10, 180000), null);
});

test('OCR parcial (10 páginas) não serve para quem pede o documento inteiro (60)', () => {
  const arquivo = ambiente();
  gravarNoCache(arquivo, resultado(arquivo, { ocr: { tentado: true, paginasProcessadas: 10 }, leituraCompleta: false }), 10, 180000);
  assert.ok(lerDoCache(arquivo, 10, 180000));
  assert.ok(lerDoCache(arquivo, 5, 60000), 'quem pede menos aproveita');
  assert.strictEqual(lerDoCache(arquivo, 60, 600000), null);
});

test('o texto não é gravado duas vezes (é remontado das páginas)', () => {
  const arquivo = ambiente();
  gravarNoCache(arquivo, resultado(arquivo), 10, 180000);
  const bruto = JSON.parse(fs.readFileSync(extrator._cache.arquivoDeCache(arquivo), 'utf8'));
  assert.strictEqual(bruto.resultado.texto, undefined);
});
