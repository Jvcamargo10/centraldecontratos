/* Desligamento da integração com o SGC (23/09/2026).

   O que se protege aqui:
     - a remoção tira TUDO o que veio do SGC e o que ficaria órfão, e
       nada além disso (propostas da Fila e auditoria ficam);
     - com CONTRATOS_API_DESLIGADA=1, a integração não conta como
       configurada, nem com URL e credenciais no .env. */
const { test } = require('node:test');
const assert = require('node:assert');
const { removerDadosDoSgc } = require('../integrations/removerDadosSgc');

function banco() {
  return {
    contratos: [
      { id: 1, numero: '066/2020', origemExterna: true },
      { id: 2, numero: '999/2026' }                       // criado pela Central, não pelo SGC
    ],
    aditivos: [{ id: 10, contrato: '066/2020', origemExterna: true }],
    apostilamentos: [{ id: 11, contrato: '066/2020', origemExterna: true, objeto: 'inscrito no CPF/MF sob o nº 111.222.333-44' }],
    requisicoes: [{ id: 12, origemExterna: true }],
    gratificacoes: [],
    mapasRisco: [{ id: 20, contratoId: 1 }, { id: 21, contratoId: 2 }],
    fichasCadastro: [{ id: 30, contratoId: 1 }],
    tratativas: [{ id: 40, contratoId: 1 }],
    comentarios: [],
    importacoesPendentes: [
      { id: 50, status: 'pendente', contratoExistenteId: 1 },
      { id: 51, status: 'aprovado', contratoId: 1 },
      { id: 52, status: 'pendente', contratoExistenteId: 2 }
    ],
    auditoria: [{ id: 1, acao: 'sincronizar' }],
    integracoes: { contratosApi: { ultimaSincronizacao: '2026-09-22' }, arquivosContratos: {} }
  };
}

test('remove tudo o que veio do SGC — e só isso', () => {
  const db = banco();
  const r = removerDadosDoSgc(db);
  assert.deepStrictEqual(db.contratos.map(c => c.id), [2], 'o contrato criado pela Central fica');
  assert.strictEqual(db.aditivos.length, 0);
  assert.strictEqual(db.apostilamentos.length, 0, 'inclusive o texto com CPF que veio da API');
  assert.strictEqual(db.requisicoes.length, 0);
  assert.deepStrictEqual(r.removidos, { contratos: 1, aditivos: 1, apostilamentos: 1, requisicoes: 1, gratificacoes: 0 });
});

test('o que dependia dos contratos do SGC sai junto, para não ficar órfão', () => {
  const db = banco();
  const r = removerDadosDoSgc(db);
  assert.deepStrictEqual(db.mapasRisco.map(m => m.id), [21]);
  assert.strictEqual(db.fichasCadastro.length, 0);
  assert.strictEqual(db.tratativas.length, 0);
  assert.deepStrictEqual(r.dependentesRemovidos, { mapasRisco: 1, fichasCadastro: 1, tratativas: 1, comentarios: 0 });
});

test('a Fila de importação e a auditoria ficam; o vínculo com o contrato removido, não', () => {
  const db = banco();
  const r = removerDadosDoSgc(db);
  assert.strictEqual(db.importacoesPendentes.length, 3, 'nenhuma proposta é apagada');
  assert.strictEqual(db.importacoesPendentes[0].contratoExistenteId, null, 'aprovar passa a criar contrato novo');
  assert.ok(db.importacoesPendentes[1].contratoRemovido, 'a aprovada vira histórico, marcada');
  assert.strictEqual(db.importacoesPendentes[2].contratoExistenteId, 2, 'vínculo com contrato da Central fica');
  assert.strictEqual(r.propostasDesvinculadas, 1);
  assert.strictEqual(db.auditoria.length, 1, 'a trilha de auditoria não se apaga');
  assert.strictEqual(db.integracoes.contratosApi, undefined);
  assert.ok(db.integracoes.arquivosContratos, 'o estado da varredura de arquivos fica');
});

test('rodar duas vezes não quebra nada', () => {
  const db = banco();
  removerDadosDoSgc(db);
  const r = removerDadosDoSgc(db);
  assert.strictEqual(r.totalRemovido, 0);
});

test('CONTRATOS_API_DESLIGADA=1 vence URL e credenciais configuradas', () => {
  const antes = { ...process.env };
  process.env.CONTRATOS_API_URL = 'https://exemplo.invalido/api/contrato/todos';
  process.env.CONTRATOS_API_AUTH_TYPE = 'none';
  delete require.cache[require.resolve('../integrations/contratosApi')];
  const api = require('../integrations/contratosApi');
  try {
    process.env.CONTRATOS_API_DESLIGADA = '0';
    assert.strictEqual(api.isConfigured(), true, 'ligada, com URL, conta como configurada');
    process.env.CONTRATOS_API_DESLIGADA = '1';
    assert.strictEqual(api.isConfigured(), false);
    assert.strictEqual(api.desligada(), true);
    assert.strictEqual(api.statusPublico().desligada, true);
    assert.strictEqual(api.statusPublico().entidades.aditivos.configurado, false);
  } finally {
    for (const k of ['CONTRATOS_API_URL', 'CONTRATOS_API_AUTH_TYPE', 'CONTRATOS_API_DESLIGADA']) {
      if (antes[k] === undefined) delete process.env[k]; else process.env[k] = antes[k];
    }
    delete require.cache[require.resolve('../integrations/contratosApi')];
  }
});
