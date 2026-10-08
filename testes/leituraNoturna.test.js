/* ===================================================================
   testes/leituraNoturna.test.js

   O que a leitura noturna lê (e em que ordem) e os cuidados com a
   máquina — 24/09/2026. Usa uma pasta de cache temporária: nada aqui
   toca no .texto-cache do projeto.
=================================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'leitura-noturna-'));
process.env.CONTRATOS_CACHE_TEXTO_PASTA = path.join(tmp, 'cache');
delete require.cache[require.resolve('../integrations/extratorDocumento')];
const extrator = require('../integrations/extratorDocumento');
const { gravarNoCache } = extrator._cache;

const arquivo = nome => { const c = path.join(tmp, nome); fs.writeFileSync(c, 'pdf de mentira ' + nome); return c; };
const paginas = n => Array.from({ length: n }, (_, i) => ({ numero: i + 1, texto: 'texto' }));
const OPCOES = { maxPaginasOcr: 60, timeoutOcrMs: 600000, escalaOcr: 2.0 };

test('documento que nunca foi lido entra primeiro', () => {
  assert.strictEqual(extrator.motivoParaLer(arquivo('novo.pdf'), OPCOES), 'nunca lido');
});

// Página de contrato de verdade: ~2.000 caracteres.
const paginasNativas = n => Array.from({ length: n }, (_, i) => ({ numero: i + 1, texto: 'cláusula '.repeat(220) }));

test('PDF com texto próprio não precisa de OCR nenhum', () => {
  const c = arquivo('nativo.pdf');
  gravarNoCache(c, { paginas: paginasNativas(3), semTexto: false, ocr: null, leituraCompleta: true }, 10, 180000);
  assert.strictEqual(extrator.motivoParaLer(c, OPCOES), null);
});

test('camada de texto RALA (carimbo de assinatura sobre página digitalizada) vai para o OCR — contrato 125/2023', () => {
  const c = arquivo('rala.pdf');
  // 485 caracteres em 12 páginas: passava do mínimo e nunca era lido por OCR.
  const rala = Array.from({ length: 12 }, (_, i) => ({ numero: i + 1, texto: 'x'.repeat(i === 11 ? 45 : 40) }));
  gravarNoCache(c, { paginas: rala, semTexto: false, ocr: null, leituraCompleta: true }, 10, 180000);
  assert.strictEqual(extrator.motivoParaLer(c, OPCOES), 'OCR pendente');
  assert.strictEqual(extrator._cache.lerDoCache(c, 10, 180000), null, 'o cache não serve como leitura');
});

test('recorte da Imprensa Oficial de uma página, só com o cabeçalho como texto, vai para o OCR', () => {
  const c = arquivo('iom.pdf');
  const cabecalho = '@ PrefeituradeItaverde\nIMPRENSA OFICIAL DO MUNICÍPIO DE ITAVERDE \t49 \tItaverde, 7 de agosto de 2023\nSECRETARIA MUNICIPAL DE TECNOLOGIA';
  gravarNoCache(c, { paginas: [{ numero: 1, texto: cabecalho }], semTexto: false, ocr: null, leituraCompleta: true }, 10, 180000);
  assert.strictEqual(extrator.motivoParaLer(c, OPCOES), 'OCR pendente');
  const carta = arquivo('carta.pdf');
  gravarNoCache(carta, { paginas: [{ numero: 1, texto: 'Ofício com texto de verdade. '.repeat(20) }], semTexto: false, ocr: null, leituraCompleta: true }, 10, 180000);
  assert.strictEqual(extrator.motivoParaLer(carta, OPCOES), null, 'página única com texto de verdade não é relida');
});

test('OCR pulado pelo limite antigo de 40MB vira pendente; OCR que falhou não é refeito a cada pedido', () => {
  const pulado = arquivo('grande.pdf');
  gravarNoCache(pulado, { paginas: paginas(17).map(p => ({ ...p, texto: '' })), semTexto: true, ocr: { tentado: false, paginasProcessadas: 0, aviso: 'Arquivo tem 42.9MB (limite pra OCR é 40MB) — OCR não foi tentado.' }, leituraCompleta: false }, 60, 600000);
  assert.strictEqual(extrator.motivoParaLer(pulado, OPCOES), 'OCR pendente', 'o arquivo de teste é pequeno: hoje o OCR seria feito');
  const falhou = arquivo('falhou.pdf');
  gravarNoCache(falhou, { paginas: paginas(3).map(p => ({ ...p, texto: '' })), semTexto: true, ocr: { tentado: false, paginasProcessadas: 0, aviso: 'OCR foi tentado mas falhou: PDF corrompido' }, leituraCompleta: false }, 10, 180000);
  assert.strictEqual(extrator.motivoParaLer(falhou, OPCOES), null);
});

test('leitura parcial (OCR parou no limite) é relida por inteiro', () => {
  const c = arquivo('parcial.pdf');
  gravarNoCache(c, { paginas: paginas(30), semTexto: false, ocr: { tentado: true, paginasProcessadas: 12, paginasFinaisLidas: 2, escala: 1.3 }, leituraCompleta: false }, 10, 180000);
  assert.strictEqual(extrator.motivoParaLer(c, OPCOES), 'leitura incompleta');
});

test('escaneado lido com nitidez menor é relido; já lido com a nitidez da noite, não', () => {
  const antigo = arquivo('antigo.pdf');
  gravarNoCache(antigo, { paginas: paginas(4), semTexto: false, ocr: { tentado: true, paginasProcessadas: 4 }, leituraCompleta: true }, 10, 180000);
  assert.strictEqual(extrator.motivoParaLer(antigo, OPCOES), 'nitidez menor', 'sem escala gravada = a do dia (1.3)');
  const noturno = arquivo('noturno.pdf');
  gravarNoCache(noturno, { paginas: paginas(4), semTexto: false, ocr: { tentado: true, paginasProcessadas: 4, escala: 2.0 }, leituraCompleta: true }, 60, 600000);
  assert.strictEqual(extrator.motivoParaLer(noturno, OPCOES), null);
});

test('arquivo alterado depois da leitura volta a ser "nunca lido"', () => {
  const c = arquivo('alterado.pdf');
  gravarNoCache(c, { paginas: paginas(2), semTexto: false, ocr: null, leituraCompleta: true }, 10, 180000);
  fs.appendFileSync(c, ' — versão nova');
  assert.strictEqual(extrator.motivoParaLer(c, OPCOES), 'nunca lido');
});

test('gravação do cache é atômica: não sobra temporário', () => {
  const c = arquivo('atomico.pdf');
  gravarNoCache(c, { paginas: paginas(1), semTexto: false, ocr: null, leituraCompleta: true }, 10, 180000);
  const sobras = fs.readdirSync(path.join(tmp, 'cache')).filter(n => n.endsWith('.tmp'));
  assert.deepStrictEqual(sobras, []);
});

test('prioridade: "normal" não mexe no processo; nível desconhecido vira "baixa"', () => {
  const { ajustarPrioridade } = require('../integrations/prioridadeProcesso');
  assert.match(ajustarPrioridade('normal'), /normal/);
  const antes = os.getPriority(0);
  const r = ajustarPrioridade('qualquer');
  assert.match(r, /abaixo do normal|não foi possível/);
  assert.ok(os.getPriority(0) >= antes, 'só baixa, nunca sobe');
});

/* PDF mínimo com texto próprio, montado aqui mesmo (sem arquivo de fora). */
function pdfComTexto(texto) {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  const conteudo = `BT /F1 14 Tf 72 760 Td (${texto}) Tj ET`;
  objs[3] = `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`;
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

test('a leitura do PDF roda num processo à parte, e ele fecha de forma ordenada', async () => {
  const c = path.join(tmp, 'texto-proprio.pdf');
  fs.writeFileSync(c, pdfComTexto('CONTRATO 096/2025 - inscrito no CPF 123.456.789-01'));
  const r = await extrator.extrairTexto(c, { ignorarCache: true });
  assert.match(r.texto, /CONTRATO 096\/2025/);
  assert.match(r.texto, /\[CPF removido\]/, 'a máscara vale para o texto vindo do processo à parte');
  await extrator.encerrarOcr(); // não pode travar nem derrubar o processo de teste
});

/* Leitura incremental (24/09/2026): o que já foi lido não é relido. */
function cacheParcial(nome, total, lidasPrimeiras, lidasFinais, extra = {}) {
  const c = arquivo(nome);
  const lidas = n => n <= lidasPrimeiras || n > total - lidasFinais;
  const pags = Array.from({ length: total }, (_, i) => ({ numero: i + 1, texto: lidas(i + 1) ? `texto antigo da página ${i + 1}` : '' }));
  gravarNoCache(c, { paginas: pags, semTexto: false, leituraCompleta: false,
    ocr: { tentado: true, paginasProcessadas: lidasPrimeiras + lidasFinais, paginasFinaisLidas: lidasFinais, aviso: 'Documento tem 20 páginas — OCR rodou só nas primeiras 10 páginas e nas 2 últimas (ajustável via CONTRATOS_OCR_MAX_PAGINAS).', ...extra } }, 10, 180000);
  return c;
}
const ocrFalso = (pedidos, { parar } = {}) => async (caminho, paginas) => {
  pedidos.push(paginas);
  const feitas = parar ? paginas.slice(0, parar) : paginas;
  return { paginas: feitas.map(n => ({ numero: n, texto: `texto novo da página ${n}` })), interrompidoPorTempo: !!parar };
};

test('o Mapa pede o documento inteiro: só as páginas que faltam passam pelo OCR', async () => {
  const c = cacheParcial('parcial-20.pdf', 20, 10, 2);
  const pedidos = [];
  extrator._paraTeste.trocarOcr(ocrFalso(pedidos));
  try {
    const r = await extrator.extrairTexto(c, { maxPaginasOcr: 60, timeoutOcrMs: 600000 });
    assert.deepStrictEqual(pedidos, [[11, 12, 13, 14, 15, 16, 17, 18]], 'as 12 páginas já lidas não voltam ao OCR');
    assert.strictEqual(r.leituraCompleta, true);
    assert.deepStrictEqual(r.ocr.paginasLidas, Array.from({ length: 20 }, (_, i) => i + 1));
    assert.match(r.texto, /texto antigo da página 1\b/);
    assert.match(r.texto, /texto novo da página 11\b/);
    // Pedido de novo: agora vem inteiro do cache, sem OCR nenhum.
    await extrator.extrairTexto(c, { maxPaginasOcr: 60, timeoutOcrMs: 600000 });
    assert.strictEqual(pedidos.length, 1);
  } finally { extrator._paraTeste.trocarOcr(null); }
});

test('OCR interrompido pelo tempo: a próxima leitura continua de onde parou', async () => {
  const c = cacheParcial('parcial-interrompido.pdf', 20, 10, 2);
  const pedidos = [];
  extrator._paraTeste.trocarOcr(ocrFalso(pedidos, { parar: 2 }));
  try {
    const r1 = await extrator.extrairTexto(c, { maxPaginasOcr: 60, timeoutOcrMs: 600000 });
    assert.strictEqual(r1.leituraCompleta, false);
    assert.match(r1.ocr.aviso, /continua de onde parou/);
    extrator._paraTeste.trocarOcr(ocrFalso(pedidos));
    const r2 = await extrator.extrairTexto(c, { maxPaginasOcr: 60, timeoutOcrMs: 600000 });
    assert.deepStrictEqual(pedidos[1], [13, 14, 15, 16, 17, 18], 'não repete as páginas 11 e 12');
    assert.strictEqual(r2.leituraCompleta, true);
  } finally { extrator._paraTeste.trocarOcr(null); }
});

test('a leitura noturna não conta de novo como "incompleta" o que já foi completado', () => {
  const c = cacheParcial('parcial-motivo.pdf', 20, 10, 2);
  assert.strictEqual(extrator.motivoParaLer(c, OPCOES), 'leitura incompleta');
});

test('importação de UM contrato e ficha usam a leitura completa (a mesma do Mapa)', () => {
  const fonte = f => fs.readFileSync(path.join(__dirname, '..', 'integrations', f), 'utf8');
  assert.match(fonte('ingestaoContratos.js'), /extrairTexto\(caminho, extratorDocumento\.LEITURA_COMPLETA\)/);
  assert.match(fonte('fichaCadastroContrato.js'), /extrairTexto\(contrato\.arquivoOrigem, extratorDocumento\.LEITURA_COMPLETA\)/);
  assert.match(fonte('mapaRiscoContratos.js'), /LEITURA_COMPLETA\.maxPaginasOcr/);
});
