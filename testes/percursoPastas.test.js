/* ===================================================================
   testes/percursoPastas.test.js

   Leitura das pastas com vários pedidos ao mesmo tempo (06/10/2026): o
   limite é respeitado, a ordem do resultado é a da lista, e as varreduras
   de Requisições e Relatórios encontram o mesmo que antes numa árvore de
   pastas de exemplo, sem travar o servidor.
=================================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const percurso = require('../integrations/percursoPastas');

const espera = ms => new Promise(r => setTimeout(r, ms));

test('limitador: nunca passa do máximo de pedidos ao mesmo tempo, e todos terminam', async () => {
  const vez = percurso.limitador(3);
  let agora = 0, pico = 0;
  const r = await Promise.all(Array.from({ length: 20 }, (_, i) => vez(async () => {
    agora++; pico = Math.max(pico, agora);
    await espera(5 + (i % 4));
    agora--;
    return i;
  })));
  assert.strictEqual(pico, 3);
  assert.deepStrictEqual(r, Array.from({ length: 20 }, (_, i) => i));
});

test('limitador: um pedido que falha devolve o erro e não prende a fila', async () => {
  const vez = percurso.limitador(1);
  await assert.rejects(vez(async () => { throw new Error('sem acesso'); }), /sem acesso/);
  assert.strictEqual(await vez(async () => 'seguiu'), 'seguiu');
});

test('emOrdem: resultado na ordem da lista, mesmo terminando fora de ordem', async () => {
  const r = await percurso.emOrdem([30, 1, 15, 5], async ms => { await espera(ms); return [ms]; });
  assert.deepStrictEqual(r, [30, 1, 15, 5]);
});

function arvore(raiz, estrutura) {
  for (const [nome, filho] of Object.entries(estrutura)) {
    const c = path.join(raiz, nome);
    if (filho === null) fs.writeFileSync(c, 'x');
    else { fs.mkdirSync(c, { recursive: true }); arvore(c, filho); }
  }
}

test('requisições: acha os documentos do TCE e do SisFin na ordem das pastas, sem travar o servidor', async () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'percurso-'));
  arvore(raiz, {
    '3. Processos': {
      'P.A. 02.000_2024 - Beta': { '19. Sisfin': { '1. Requisição': { 'RQ_2.pdf': null } }, 'TCE': { 'Ofício TCE 2.pdf': null, 'MODELO xxx.pdf': null } },
      'P.A. 01.000_2024 - Alfa': { 'TCE-SP': { 'Requisição 1.pdf': null, 'anexo.txt': null }, 'Outros': { 'qualquer.pdf': null } }
    }
  });
  const req = require('../integrations/requisicoes');
  let batidas = 0; const relogio = setInterval(() => batidas++, 1);
  const p = req.localizarDocumentos([raiz]);
  assert.ok(p instanceof Promise, 'precisa ser assíncrona (antes travava o servidor)');
  const { achados, avisos } = await p;
  clearInterval(relogio);
  const nomes = achados.map(a => `${a.origem}:${a.nome}`);
  const esperado = fs.readdirSync(path.join(raiz, '3. Processos')).flatMap(proc => proc.includes('Alfa')
    ? ['tce:Requisição 1.pdf'] : ['sisfin:RQ_2.pdf', 'tce:Ofício TCE 2.pdf']);
  assert.deepStrictEqual(nomes.sort(), esperado.sort());
  assert.deepStrictEqual(avisos, []);
  fs.rmSync(raiz, { recursive: true, force: true });
});

test('relatórios mensais: arquivos de cada processo, como antes', async () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'percurso-'));
  arvore(raiz, {
    'P.A. 01.000_2024 - Alfa': { 'Relatórios mensais de atividades': { '2026': { 'Relatório 01-2026.pdf': null, 'Relatório 02-2026.pdf': null } } },
    'P.A. 02.000_2024 - Beta': { 'Outra pasta': { 'x.pdf': null } }
  });
  const rel = require('../integrations/relatoriosMensais');
  const r = await rel.lerPastasDeRelatorios([raiz]);
  assert.strictEqual(r.processos.length, 2);
  const alfa = r.processos.find(p => /Alfa/.test(p.nome)), beta = r.processos.find(p => /Beta/.test(p.nome));
  assert.deepStrictEqual(alfa.arquivos.map(a => a.nome).sort(), ['Relatório 01-2026.pdf', 'Relatório 02-2026.pdf']);
  assert.deepStrictEqual(beta.arquivos, []);
  fs.rmSync(raiz, { recursive: true, force: true });
});
