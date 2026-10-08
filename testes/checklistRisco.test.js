/* ===================================================================
   testes/checklistRisco.test.js

   Eixo Conteúdo do mapa de risco: checklist da Lei 14.133/2021 analisado
   cláusula por cláusula, sobre TODOS os documentos do contrato.

   As regras que mais importam aqui são as que protegem a credibilidade
   da ferramenta:
     - nunca afirmar que uma cláusula NÃO EXISTE com base em leitura
       parcial do documento;
     - nunca apresentar como trecho do contrato uma citação que não está
       nos documentos;
     - o que a regra não conclui fica para conferência manual — nunca vira
       veredito sem prova.
=================================================================== */

const { test } = require('node:test');
const assert = require('node:assert');
const { CHECKLIST_LEI_14133, analisarPorChecklist, _paraTeste } = require('../integrations/checklistRisco');
const { localizarNoTexto, paginaDaPosicao, localizarCitacao } = _paraTeste;

const CONTRATO = { numero: '096/2025', empresa: 'AURORA TECNOLOGIA LTDA' };

// Documento com a estrutura real de um contrato da Prefeitura.
const TEXTO_CONTRATO = [
  '[página 1]',
  'CONTRATO Nº 096/2025. O valor global do presente contrato é de R$ 26.100.000,00.',
  'CLÁUSULA QUARTA — DO VALOR E DO PAGAMENTO',
  '4.1. O pagamento será efetuado em até 30 (trinta) dias após o aceite definitivo do objeto pelo fiscal do contrato.',
  '[página 2]',
  'CLÁUSULA TERCEIRA — DA VIGÊNCIA E DO REAJUSTE',
  '3.1. O presente contrato terá a vigência de 12 (doze) meses, contados do recebimento definitivo.',
  '3.2. Os preços serão reajustados pelo índice oficial aplicável, após 12 meses.',
  '[página 3]',
  'CLÁUSULA OITAVA — DAS PENALIDADES',
  '8.1. Pelo atraso injustificado, a CONTRATADA ficará sujeita a multa, a critério da Administração.'
].join('\n');

function documento(texto, leituraCompleta = true, nome = 'Contrato Comercial Nº 096_2025.pdf') {
  return { nome, texto, leituraCompleta };
}

/* ------------------------------------------------------------------
   Ausência: a regra mais importante
------------------------------------------------------------------ */

test('item não localizado com leitura COMPLETA vira apontamento', async () => {
  const r = await analisarPorChecklist({
    documentos: [documento(TEXTO_CONTRATO, true)]
  });
  const garantia = r.checklist.find(c => c.id === 'garantia');
  assert.equal(garantia.situacao, 'nao_localizado');
  assert.ok(r.findings.some(f => f.itemChecklist === 'garantia' && /não localizada/.test(f.titulo)));
});

test('item não localizado com leitura INCOMPLETA não vira apontamento de ausência', async () => {
  /* O caso real que motivou a regra: OCR lendo 10 de 17 páginas. A
     garantia pode estar na página 12 — "não achei" não quer dizer "não
     existe", e acusar isso destruiria a credibilidade da ferramenta. */
  const r = await analisarPorChecklist({
    documentos: [documento(TEXTO_CONTRATO, false)]
  });
  const garantia = r.checklist.find(c => c.id === 'garantia');
  assert.equal(garantia.situacao, 'nao_localizado_leitura_incompleta');
  assert.ok(!r.findings.some(f => f.itemChecklist === 'garantia'), 'não pode haver apontamento de ausência');
  assert.equal(r.leituraCompleta, false);
});

test('um documento incompleto basta para suspender afirmações de ausência', () => {
  // Mesmo com o contrato lido por inteiro, um aditivo parcial pode conter a cláusula.
  return analisarPorChecklist({
    documentos: [documento(TEXTO_CONTRATO, true), documento('[página 1]\nPrimeiro termo aditivo...', false, 'Aditivo 1.pdf')]
  }).then(r => {
    assert.equal(r.checklist.find(c => c.id === 'extincao').situacao, 'nao_localizado_leitura_incompleta');
  });
});

test('item opcional (matriz de riscos) ausente não é apontado como falha', async () => {
  const r = await analisarPorChecklist({
    documentos: [documento(TEXTO_CONTRATO, true)]
  });
  assert.equal(r.checklist.find(c => c.id === 'matriz').situacao, 'nao_se_aplica');
  assert.ok(!r.findings.some(f => f.itemChecklist === 'matriz'));
});

/* ------------------------------------------------------------------
   Citação: conferida contra o texto, nunca aceita na palavra do modelo
------------------------------------------------------------------ */

test('o que a regra não conclui fica para conferência manual, com o que faltou', async () => {
  /* Multa sem percentual e reajuste sem índice nomeado: a regra não afirma
     que "não atende" (pode ser redação incomum ou OCR ruim) — o item fica
     para quem confere, com a lista do que não foi achado. */
  const r = await analisarPorChecklist({ documentos: [documento(TEXTO_CONTRATO, true)] });
  const multa = r.checklist.find(c => c.id === 'penalidades');
  assert.equal(multa.situacao, 'falha', '"falha" é mostrado na tela como "Para conferência manual"');
  assert.ok(multa.faltando.includes('multa com percentual definido'));
  assert.match(multa.erro, /conferência|confira/);
  assert.ok(!r.findings.some(f => f.itemChecklist === 'penalidades'), 'sem prova, sem apontamento');
  assert.equal(r.checklist.find(c => c.id === 'pagamento').situacao, 'atende');
  assert.equal(r.checklist.find(c => c.id === 'pagamento').fonte, 'regra');
  assert.equal(r.paraConferencia, 4);
  assert.equal(r.resolvidosPorRegra, 1);
});

test('citação de um apontamento de regra vem com documento e página conferidos', async () => {
  // Renovação automática: a própria frase é a prova (alerta com citação literal).
  const texto = TEXTO_CONTRATO + '\n[página 4]\nCLÁUSULA NONA — DA VIGÊNCIA\n9.1. O contrato será renovado automaticamente por iguais períodos, independentemente de termo aditivo.';
  const r = await analisarPorChecklist({ documentos: [documento(texto, true)] });
  const f = r.findings.find(x => /renova/i.test(x.titulo));
  assert.ok(f, 'renovação automática vira apontamento');
  assert.equal(f.fonte, 'regra');
  assert.equal(f.citacaoVerificada, true);
  assert.equal(f.documento, 'Contrato Comercial Nº 096_2025.pdf');
});

test('citação com diferença de acento, caixa e pontuação ainda é reconhecida', () => {
  /* O OCR mexe nisso — rejeitar por isso faria sumir apontamento válido. */
  const onde = localizarCitacao(
    'a contratada ficara sujeita a multa a criterio da administracao',
    [{ nome: 'Contrato.pdf', texto: TEXTO_CONTRATO }]
  );
  assert.equal(onde && onde.documento, 'Contrato.pdf');
});

/* ------------------------------------------------------------------
   Localização do trecho
------------------------------------------------------------------ */

test('prefere o TÍTULO da cláusula a uma menção solta do termo', () => {
  /* "pagamento" aparece antes no texto (numa frase qualquer), mas o trecho
     certo é o da cláusula intitulada "DO VALOR E DO PAGAMENTO". */
  const texto = 'Condições gerais: o pagamento de tributos cabe à contratada.\n' +
    'CLÁUSULA QUARTA — DO VALOR E DO PAGAMENTO\n4.1. O pagamento será em 30 dias.';
  const item = CHECKLIST_LEI_14133.find(i => i.id === 'pagamento');
  const pos = localizarNoTexto(texto, item.secao);
  assert.ok(texto.slice(pos).startsWith('CLÁUSULA QUARTA'));
});

test('página do trecho vem do marcador [página N] do extrator', () => {
  assert.equal(paginaDaPosicao(TEXTO_CONTRATO, TEXTO_CONTRATO.indexOf('DAS PENALIDADES')), 3);
  assert.equal(paginaDaPosicao(TEXTO_CONTRATO, TEXTO_CONTRATO.indexOf('DA VIGÊNCIA')), 2);
});

test('trechos de vários documentos entram no mesmo item', async () => {
  const aditivo = '[página 1]\nPRIMEIRO TERMO ADITIVO\nCLÁUSULA PRIMEIRA — DA PRORROGAÇÃO\nFica prorrogada a vigência por mais 12 meses.';
  const r = await analisarPorChecklist({
    documentos: [documento(TEXTO_CONTRATO, true), documento(aditivo, true, 'Aditivo 1.pdf')]
  });
  const nomes = r.checklist.find(c => c.id === 'vigencia').documentos.map(d => d.nome);
  assert.ok(nomes.includes('Contrato Comercial Nº 096_2025.pdf'));
  assert.ok(nomes.includes('Aditivo 1.pdf'), 'o aditivo que prorroga a vigência é conferido junto');
});

/* ------------------------------------------------------------------
   Risco geral sem análise de conteúdo
------------------------------------------------------------------ */

test('risco geral sem análise de conteúdo é marcado como PARCIAL', async () => {
  /* Medido em 21/09/2026: o eixo Conteúdo ficou indisponível e o mapa
     saiu como "Risco geral: Baixo" — lido como contrato seguro, quando na
     verdade ninguém analisou o conteúdo. Aqui, um contrato sem arquivo de
     origem reproduz a mesma situação sem precisar de disco. */
  const mapa = require('../integrations/mapaRiscoContratos');
  const db = {
    contratos: [{ id: 1, numero: '001/2026', termino: '2030-01-01', valor: 100 }],
    aditivos: [], tratativas: [], mapasRisco: [],
    alertaConfig: { critico: 15, atencao: 30, proximo: 90 }
  };
  const r = await mapa.gerarMapaRisco(db, () => {}, a => (a.length ? a.length + 1 : 1), 1, 'Teste');
  assert.equal(r.conteudo, null);
  assert.equal(r.riscoGeralParcial, true);
  assert.match(r.riscoGeralLabel, /\(parcial\)$/);
});

const { nivelDoConteudo } = require('../integrations/checklistRisco');

test('citação não conferida não define o nível do eixo Conteúdo', () => {
  /* Só existe em mapas antigos (a IA chegou a devolver o texto do próprio
     prompt como "citação"): aparece marcado na tela, mas não classifica. */
  assert.equal(nivelDoConteudo([
    { nivel: 'alto', citacaoVerificada: false },
    { nivel: 'medio', citacaoVerificada: true }
  ]), 'medio');
  // Apontamento de regra (sem citação) conta normalmente.
  assert.equal(nivelDoConteudo([{ nivel: 'medio', citacaoVerificada: null }]), 'medio');
  assert.equal(nivelDoConteudo([]), 'baixo');
});
