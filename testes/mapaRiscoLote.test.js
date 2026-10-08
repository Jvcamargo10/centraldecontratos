/* ===================================================================
   testes/mapaRiscoLote.test.js

   "Atualizar todas as análises" do Mapa de risco (25/09/2026): só o texto
   já lido (nenhum OCR novo), um contrato por vez.
=================================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const mapa = require('../integrations/mapaRiscoContratos');

const nextId = a => (a.length ? Math.max(...a.map(x => x.id)) + 1 : 1);
const esperarFim = async () => { while (mapa.obterProgresso().emAndamento) await new Promise(r => setTimeout(r, 10)); };

function dbDeTeste() {
  return {
    contratos: [
      // Arquivo que nunca foi lido: o lote NÃO pode disparar leitura/OCR dele.
      { id: 1, numero: '001/2026', termino: '2030-01-01', valor: 100, arquivoOrigem: path.join(os.tmpdir(), 'central-contratos-nunca-lido', 'Contrato 001_2026.pdf') },
      { id: 2, numero: '002/2026', termino: '2030-01-01', valor: 100 } // sem documentos: fica fora do lote
    ],
    aditivos: [], tratativas: [], mapasRisco: [],
    alertaConfig: { critico: 15, atencao: 30, proximo: 90 }
  };
}

test('lote: atualiza só quem tem documentos, marca o modo e não lê arquivo que ainda não foi lido', async () => {
  const db = dbDeTeste();
  let salvou = 0, concluido = null;
  const r = mapa.iniciarAtualizacaoEmLote(db, () => { salvou++; }, nextId, 'Admin', lote => { concluido = lote; });
  assert.deepStrictEqual(r, { iniciado: true, total: 1 });
  assert.strictEqual(mapa.obterProgresso().emAndamento, true);
  await esperarFim();

  assert.strictEqual(db.mapasRisco.length, 1, 'só o contrato com documentos');
  const m = db.mapasRisco[0];
  assert.strictEqual(m.contratoId, 1);
  assert.strictEqual(m.modo, 'lote');
  assert.strictEqual(m.conteudo, null, 'sem texto lido, o eixo Conteúdo fica sem análise — não inventa');
  assert.match(m.avisoConteudo, /texto/);
  assert.ok(salvou >= 1);
  assert.deepStrictEqual(concluido, { total: 1, feitos: 1, falhas: [] });
  assert.deepStrictEqual(mapa.obterProgresso().ultimoConcluido.lote, concluido, 'a tela lê o resumo do lote no andamento');
});

test('lote: recusa enquanto outra geração está rodando', async () => {
  const db = dbDeTeste();
  mapa.iniciarAtualizacaoEmLote(db, () => {}, nextId, 'Admin');
  assert.throws(() => mapa.iniciarAtualizacaoEmLote(db, () => {}, nextId, 'Admin'), /aguarde/);
  assert.throws(() => mapa.iniciarGeracaoMapaRisco(db, () => {}, nextId, 1, 'Admin'), /aguarde/);
  await esperarFim();
});

test('histórico: guarda só as 5 análises mais recentes de cada contrato', async () => {
  const db = dbDeTeste();
  db.mapasRisco = [
    ...Array.from({ length: 6 }, (_, i) => ({ id: 100 + i, contratoId: 1, geradoEm: `2026-09-0${i + 1}` })).reverse(),
    { id: 200, contratoId: 99, geradoEm: '2026-01-01' } // de outro contrato: fica
  ];
  mapa.iniciarAtualizacaoEmLote(db, () => {}, nextId, 'Admin');
  await esperarFim();
  const doContrato = db.mapasRisco.filter(m => m.contratoId === 1);
  assert.strictEqual(doContrato.length, 5);
  assert.strictEqual(doContrato[0].modo, 'lote', 'a nova é a primeira');
  assert.ok(!doContrato.some(m => m.id === 100 || m.id === 101), 'saem as mais antigas');
  assert.ok(db.mapasRisco.some(m => m.id === 200));
});

test('lote: sem contratos com documentos, avisa em vez de rodar à toa', () => {
  const db = dbDeTeste();
  db.contratos = db.contratos.filter(c => !c.arquivoOrigem);
  assert.throws(() => mapa.iniciarAtualizacaoEmLote(db, () => {}, nextId, 'Admin'), /Nenhum contrato/);
});
