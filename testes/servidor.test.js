/* ===================================================================
   testes/servidor.test.js

   Estrutura para a troca para um servidor (30/09/2026): configuração,
   bloqueio de subida insegura na rede,
   troca da raiz dos documentos (data.json e cache) e sessões em arquivo.
=================================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { obterConfig, problemasParaRede } = require('../integrations/configServidor');
const { montarTroca, trocarNoObjeto, trocarNoTexto, nomeDoArquivoDeCache } = require('../integrations/trocaDeRaiz');

test('sem nada no .env, vale o uso local de hoje', () => {
  const c = obterConfig({});
  assert.strictEqual(c.host, '127.0.0.1');
  assert.strictEqual(c.porta, 3001);
  assert.strictEqual(c.soEstaMaquina, true);
  assert.strictEqual(c.confiarProxy, false);
  assert.strictEqual(c.cookieSeguro, false);
  assert.strictEqual(c.sessoes, 'memoria');
  assert.strictEqual(c.pastaDados, path.join(__dirname, '..'));
  assert.strictEqual(c.pastaCacheTexto, path.join(__dirname, '..', '.texto-cache'));
  assert.strictEqual(c.loginPreenchido, true);
});

test('configuração de servidor: dados fora do código, proxy, cookie, origens e sessões', () => {
  const c = obterConfig({ HOST: '0.0.0.0', PORT: '8080', CENTRAL_DADOS_PASTA: 'D:\\CentralSETEC\\dados', CONFIAR_PROXY: '1', COOKIE_SEGURO: '1',
    ORIGENS_PERMITIDAS: 'https://central.itaverde.gov.br/; http://10.0.0.5:8080', SESSION_STORE: 'arquivo', LOGIN_PREENCHIDO_EM_TESTE: '0' });
  assert.strictEqual(c.soEstaMaquina, false);
  assert.strictEqual(c.porta, 8080);
  assert.strictEqual(c.arquivoDados, path.resolve('D:\\CentralSETEC\\dados', 'data.json'));
  assert.strictEqual(c.pastaCacheTexto, path.resolve('D:\\CentralSETEC\\dados', '.texto-cache'));
  assert.deepStrictEqual(c.origensPermitidas, ['https://central.itaverde.gov.br', 'http://10.0.0.5:8080']);
  assert.strictEqual(c.sessoes, 'arquivo');
  assert.strictEqual(c.loginPreenchido, false);
  assert.strictEqual(obterConfig({ NODE_ENV: 'production' }).cookieSeguro, true, 'produção: cookie seguro por padrão, como antes');
});

test('na rede, segredo padrão e senha padrão impedem subir; cookie seguro sem proxy também', () => {
  const rede = obterConfig({ HOST: '0.0.0.0' });
  assert.strictEqual(problemasParaRede(rede, { segredoPadrao: true, senhaPadraoAtiva: true }).length, 2);
  assert.deepStrictEqual(problemasParaRede(rede, { segredoPadrao: false, senhaPadraoAtiva: false }), []);
  const semProxy = obterConfig({ HOST: '0.0.0.0', COOKIE_SEGURO: '1' });
  assert.match(problemasParaRede(semProxy, { segredoPadrao: false, senhaPadraoAtiva: false })[0], /COOKIE_SEGURO/);
});

const DE = 'F:\\Contratos da Secretaria\\9. Gestão de Contratos';
const PARA = '\\\\servidor-arquivos.itaverde.gov.br\\arquivos\\Depto - DTI\\Contratos da Secretaria\\9. Gestão de Contratos';

test('troca de raiz: textos, chaves de objeto, maiúsculas e barra "/"; não confunde pasta de nome parecido', () => {
  const t = montarTroca(DE, PARA + '\\');
  const dados = {
    contratos: [{ arquivoOrigem: `${DE}\\3. Processos\\P.A. 1\\Contrato.pdf` }],
    integracoes: { arquivosContratos: { arquivosVistos: { [`${DE}\\3. Processos\\a.pdf`]: { assinatura: '1:2' } } } },
    requisicoesConferencia: { [`TCE:ARQ:${DE}\\x.pdf`]: { status: 'conferida' } },
    outros: ['f:\\contratos da secretaria\\9. gestão de contratos\\y.pdf', 'F:/Contratos da Secretaria/9. Gestão de Contratos/z.pdf',
      `${DE} 2\\nao-mexe.pdf`, 'C:\\outro\\lugar.pdf', 42, null]
  };
  const r = trocarNoObjeto(dados, t);
  assert.strictEqual(r.trocas, 5);
  assert.strictEqual(r.objeto.contratos[0].arquivoOrigem, `${PARA}\\3. Processos\\P.A. 1\\Contrato.pdf`);
  assert.ok(r.objeto.integracoes.arquivosContratos.arquivosVistos[`${PARA}\\3. Processos\\a.pdf`], 'chave de objeto trocada');
  assert.ok(r.objeto.requisicoesConferencia[`TCE:ARQ:${PARA}\\x.pdf`], 'caminho dentro de chave composta');
  assert.strictEqual(r.objeto.outros[0], `${PARA}\\y.pdf`);
  assert.strictEqual(r.objeto.outros[1], `${PARA}/z.pdf`);
  assert.strictEqual(r.objeto.outros[2], `${DE} 2\\nao-mexe.pdf`, 'outra pasta com o mesmo começo');
  assert.deepStrictEqual(r.objeto.outros.slice(3), ['C:\\outro\\lugar.pdf', 42, null]);
  assert.throws(() => montarTroca(DE, DE), /iguais/);
  assert.strictEqual(trocarNoTexto('sem caminho', t).trocas, 0);
});

test('nome do arquivo de cache é o mesmo que o extrator calcula', () => {
  const caminho = `${PARA}\\3. Processos\\Contrato.pdf`;
  const esperado = require('crypto').createHash('sha1').update(path.resolve(caminho).toLowerCase()).digest('hex') + '.json';
  assert.strictEqual(nomeDoArquivoDeCache(caminho), esperado);
});

test('sessões em arquivo: sobrevivem a um reinício; vencida some', async () => {
  const session = require('express-session');
  const arquivo = path.join(os.tmpdir(), `central-sessoes-${process.pid}.json`);
  try {
    const criar = require('../integrations/sessoesArquivo');
    const a = criar(session, arquivo);
    const futuro = new Date(Date.now() + 3600e3).toISOString();
    await new Promise(r => a.set('abc', { cookie: { expires: futuro }, userId: 7 }, r));
    await new Promise(r => a.set('velha', { cookie: { expires: new Date(Date.now() - 1000).toISOString() }, userId: 8 }, r));
    await new Promise(r => setTimeout(r, 1300)); // gravação agrupada (1 s)
    const b = criar(session, arquivo); // "reinício"
    const s = await new Promise(r => b.get('abc', (e, v) => r(v)));
    assert.strictEqual(s.userId, 7);
    assert.strictEqual(await new Promise(r => b.get('velha', (e, v) => r(v))), null);
    await new Promise(r => b.destroy('abc', r));
    assert.strictEqual(await new Promise(r => b.get('abc', (e, v) => r(v))), null);
  } finally {
    await new Promise(r => setTimeout(r, 1200));
    fs.rmSync(arquivo, { force: true });
  }
});
