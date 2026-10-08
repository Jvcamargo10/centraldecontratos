/* ===================================================================
   testes/checklistPorRegra.test.js

   Checklist do Mapa de risco conferido por regra (23/09/2026). Os
   trechos abaixo são da redação real dos contratos da Prefeitura (com os
   defeitos de OCR que aparecem na pasta).
=================================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const { CHECKLIST_LEI_14133, analisarPorChecklist, _paraTeste } = require('../integrations/checklistRisco');
const regra = require('../integrations/checklistPorRegra');

const item = id => CHECKLIST_LEI_14133.find(i => i.id === id);
const trecho = texto => [{ documento: 'Contrato.pdf', pagina: 1, texto }];
const doc = texto => ({ nome: 'Contrato 072_2020.pdf', texto, leituraCompleta: true });

const GARANTIA = 'CLÁUSULA SEXTA - DA GARANTIA CONTRATUAL 6.i. A CONTRATADA apresenta neste ato garantia numa das modalidades previstas no parágrafo 10, artigo 56 da lei 8.666/93, no valor de R$ 139.000,00 (cento e trinta e nove mil reais), correspondente a 5% (cinco por cento) do valor total deste contrato.';
const MULTAS_8666 = 'CLÁUSULA DÉCIMA - DAS PENALIDADES 10.1. O descumprimento ensejará: a) Advertência; b) Multa moratória de 0,5% por dia de atraso na entrega do produto e na execução dos serviços até o limite de 15%; c) Multa de até 10% sobre o valor da contratação.';
const MULTAS_14133 = 'CLÁUSULA DÉCIMA PRIMEIRA - DAS PENALIDADES E SANÇÕES ADMINISTRATIVAS 11.1. São aplicáveis as sanções previstas no Capítulo I do Título IV, da Lei Federal nº 14.133/2021 e presentes no Decreto nº 13.877/2023 e demais normas pertinentes. 11.2. O descumprimento ensejará as seguintes penalidades: a) Advertência; b) Multa; c) Impedimento de licitar ou contratar.';
const REAJUSTE = '3.2. Decorrido o período de 12 (doze) meses, e mediante requerimento expresso da CONTRATADA, poderá o contrato ser reajustado, adotando-se o índice IPCA/IBGE, com data base do mês da data prevista para apresentação da proposta.';

test('garantia no padrão da Procuradoria: o ponto de "8.666/93" e de "R$ 139.000,00" não corta a frase', () => {
  const v = regra.verificarItem(item('garantia'), trecho(GARANTIA));
  assert.strictEqual(v.completo, true, JSON.stringify(v.faltando));
  assert.match(v.achados[0].citacao, /garantia/i, 'a evidência é o próprio texto');
});

test('multa com percentual e base de cálculo: atende por regra', () => {
  const v = regra.verificarItem(item('penalidades'), trecho(MULTAS_8666));
  assert.strictEqual(v.completo, true);
  assert.deepStrictEqual(v.alertas, []);
});

test('multa só por remissão a decreto: apontamento médio, com a frase citada', () => {
  const v = regra.verificarItem(item('penalidades'), trecho(MULTAS_14133));
  assert.strictEqual(v.completo, false);
  assert.strictEqual(v.alertas.length, 1);
  assert.strictEqual(v.alertas[0].nivel, 'medio');
  assert.match(v.alertas[0].citacao, /Decreto nº 13\.877\/2023/);
});

test('citação da remissão a decreto vai até o "b) Multa;" e não termina no meio da frase (061/2025)', () => {
  const v = regra.verificarItem(item('penalidades'), trecho(MULTAS_14133));
  assert.match(v.alertas[0].citacao, /^São aplicáveis as sanções/);
  assert.match(v.alertas[0].citacao, /b\) Multa;$/, 'antes parava em "...preceitos legais pertinentes, e"');
});

test('citação longa sem fim de frase por perto termina em palavra inteira, com "…"', () => {
  const texto = 'O prazo de vigência é de 12 meses ' + 'e segue a legislação vigente '.repeat(30);
  const cit = regra._paraTeste.citacaoEmVolta(texto, 0);
  assert.match(cit, / …$/);
  const semReticencias = cit.replace(/ …$/, '');
  assert.ok(texto.startsWith(semReticencias), 'o que aparece é o próprio texto');
  assert.strictEqual(texto[semReticencias.length], ' ', 'cortado entre palavras, não no meio de uma');
});

test('citação não começa no meio de uma palavra', () => {
  const texto = 'x'.repeat(10) + ' palavra '.repeat(30) + 'Decreto nº 13.877/2023 fim';
  const c = _paraTeste.localizarCitacao ? null : null; // (a de checklistRisco é outra função)
  const cit = regra._paraTeste.citacaoEmVolta(texto, texto.indexOf('Decreto'));
  assert.match(cit, /^palavra/);
  assert.strictEqual(c, null);
});

test('reajuste com índice, periodicidade e data-base: atende por regra', () => {
  assert.strictEqual(regra.verificarItem(item('reajuste'), trecho(REAJUSTE)).completo, true);
});

test('reajuste por "índice oficial" sem nome: a regra não conclui — fica para conferência com o que faltou', () => {
  const v = regra.verificarItem(item('reajuste'), trecho('3.2. Os preços serão reajustados pelo índice oficial aplicável, após 12 meses.'));
  assert.strictEqual(v.completo, false);
  assert.ok(v.faltando.includes('índice de reajuste nomeado'));
  assert.deepStrictEqual(v.alertas, [], 'não achar não é o mesmo que "não atende"');
});

test('renovação automática é apontamento alto por regra', () => {
  const v = regra.verificarItem(item('vigencia'), trecho('CLÁUSULA TERCEIRA - DA VIGÊNCIA 3.1. O contrato terá vigência de 12 (doze) meses, com renovação automática por iguais períodos.'));
  assert.strictEqual(v.alertas[0].nivel, 'alto');
  assert.strictEqual(v.alertas[0].situacao, 'nao_atende');
});

test('matriz de riscos não tem regra: a alocação é julgamento', () => {
  assert.strictEqual(regra.verificarItem(item('matriz'), trecho('MATRIZ DE RISCOS ...')), null);
});

const OBRIGACOES = [
  'CLÁUSULA SÉTIMA - DAS RESPONSABILIDADES E DAS OBRIGAÇÕES DO CONTRATANTE 7.1. São obrigações do CONTRATANTE: 7.1.1. Emitir a Ordem de Início dos Serviços.',
  // OCR real do contrato 108/2024
  'CLAUSULA DECIMA PRIMEIRA - DAS RESPONSABILIDADES E DAS oB1uGAcOES DA CONTRATADA 11.1. So obrigaçöes da CONTRATADA: 11.1.27. Responsabilizar-se, sem qualquer espécie de solidariedade por parte do CONTRATANTE, pelas obrigações de natureza fiscal, trabalhista, acidentária e civil.',
  '2.2. A fiscalização, exercida por profissionais designados pelo CONTRATANTE, não implica em corresponsabilidade, nem exime a CONTRATADA de responsabilidade.'
].join(' ');

test('obrigações: contratada e contratante definidas; a cláusula de proteção vira evidência, não alerta', () => {
  const v = regra.verificarItem(item('obrigacoes'), trecho(OBRIGACOES));
  assert.strictEqual(v.completo, true, JSON.stringify(v));
  assert.deepStrictEqual(v.alertas, [], '"sem qualquer solidariedade" e "não implica corresponsabilidade" protegem a Prefeitura');
  assert.ok(v.achados.some(a => a.rotulo === 'encargos trabalhistas e fiscais a cargo da contratada'));
  assert.match(v.achados.find(a => a.rotulo === 'obrigações do contratante').citacao, /^CLÁUSULA SÉTIMA/, 'a citação começa no título da cláusula');
});

test('obrigações: só a da contratada escrita fica para conferência; a ausência da cláusula de proteção não falta', () => {
  const v = regra.verificarItem(item('obrigacoes'), trecho('CLÁUSULA NONA - DAS OBRIGAÇÕES DA CONTRATADA 9.1. Executar o objeto.'));
  assert.deepStrictEqual(v.faltando, ['obrigações do contratante']);
});

test('obrigações: cláusula que põe encargos da contratada na conta da Prefeitura é apontamento alto, com a frase', () => {
  const texto = OBRIGACOES + ' 9.4. O CONTRATANTE responderá solidariamente pelos encargos trabalhistas e previdenciários dos empregados da CONTRATADA.';
  const v = regra.verificarItem(item('obrigacoes'), trecho(texto));
  assert.strictEqual(v.alertas.length, 1);
  assert.strictEqual(v.alertas[0].nivel, 'alto');
  assert.match(v.alertas[0].citacao, /responderá solidariamente pelos encargos/);
  const negada = OBRIGACOES + ' 9.4. A inadimplência da CONTRATADA não transfere ao CONTRATANTE a responsabilidade, e o CONTRATANTE não responderá solidariamente pelos encargos trabalhistas.';
  assert.deepStrictEqual(regra.verificarItem(item('obrigacoes'), trecho(negada)).alertas, [], 'frase negada não é transferência');
});

test('fiscal: "Nota Fiscal" e "encargos fiscais" não contam como fiscal do contrato', () => {
  const t = 'CLÁUSULA OITAVA - DA GESTÃO 8.1. O gestor do contrato atestará a Nota Fiscal de Serviços. 8.2. Os encargos trabalhistas, fiscais e comerciais são da CONTRATADA.';
  assert.deepStrictEqual(regra.verificarItem(item('gestao'), trecho(t)).faltando, ['fiscal do contrato ou fiscalização']);
  const comFiscalizacao = t + ' 8.3. A execução será acompanhada e fiscalizada por servidor designado.';
  assert.strictEqual(regra.verificarItem(item('gestao'), trecho(comFiscalizacao)).completo, true);
});

test('gestor: "ficará sob a gestão do servidor" (contrato 141/2022)', () => {
  const t = 'CLÁUSULA OITAVO - DA GESTÃO DO CONTRATO 8.1. O presente Contrato ficará sob a gestão do servidor, Senhor FULANO. 8.2. A execução dos serviços será acompanhada e fiscalizada por um servidor da CONTRATANTE.';
  assert.strictEqual(regra.verificarItem(item('gestao'), trecho(t)).completo, true);
});

test('prorrogação: "de acordo com a variação do IPCA" não é condição de prorrogação', () => {
  const t = 'CLÁUSULA TERCEIRA - DA VIGÊNCIA 3.1. O prazo de vigência deste contrato é de 12 (doze) meses. 3.2. Decorrido o período de 12 meses, caso necessária a prorrogação, poderá o contrato ser reajustado, de acordo com a variação do IPCA.';
  assert.deepStrictEqual(regra.verificarItem(item('vigencia'), trecho(t)).faltando, ['prorrogação condicionada (justificativa, interesse ou termo aditivo)']);
});

test('frase cortada por cabeçalho de página do OCR ("TODOS.PÊ") continua a mesma frase (064/2025)', () => {
  const t = 'CLÁUSULA SEGUNDA — DA VIGÊNCIA DO CONTRATO 2.1. O prazo de vigência do contrato é de 24 (vinte e quatro) meses, podendo ser prorrogado, desde qué\n[página 2]\nPREFEITURA DE ITAVERDE\nCIDADE QUE CUIDA DE TODOS.PÊ | |\ndevidamente justificado e autorizado expressamente.';
  assert.strictEqual(regra.verificarItem(item('vigencia'), trecho(t)).completo, true);
});

test('rescisão: "athgo 78" do OCR e "constituem motivos para rescisão" nomeiam os casos', () => {
  const t = 'CLAUSULA DECIMA PRIMEIRA - DA RESCISAO 11.1. Constituem motivos para rescisão da contratacão os relacionados no athgo 78 da Lei no 8.666/93.';
  assert.strictEqual(regra.verificarItem(item('extincao'), trecho(t)).completo, true);
});

test('pagamento condicionado à conferência pela fiscalização (086/2026)', () => {
  const t = 'CLÁUSULA SÉTIMA DAS CONDIÇÕES DE PAGAMENTO 7.2. O pagamento de cada parcela ficará condicionado à comprovação, pela gestão e fiscalização contratual, de que os equipamentos foram localizados, identificados, conferidos fisicamente. 7.2.1. O pagamento das notas fiscais/faturas será realizado em 30 (trinta) dias.';
  assert.strictEqual(regra.verificarItem(item('pagamento'), trecho(t)).completo, true);
});

test('localização: título estragado pelo OCR ou partido em duas linhas ainda é título', () => {
  const loc = (texto, id) => _paraTeste.localizarNoTexto(texto, item(id).secao, item(id));
  // "BA VIGENCIA" (108/2024): D lido como B
  let t = '1.1. Objeto. A garantia vale até o final da vigência contratual. CLAUSULA SEGUNDA - BA VIGENCIA DO CONTRATO 2.1. O presente contrato terá a vigência de 36 meses.';
  assert.strictEqual(t.slice(loc(t, 'vigencia'), loc(t, 'vigencia') + 16), 'CLAUSULA SEGUNDA');
  // "CLAUSUTA ... -\nDA REsCIsAo" (108/2024): palavra estragada e título em duas linhas
  t = '8.12. O CONTRATANTE adotará as medidas necessárias à rescisão contratual. CLAUSUTA DECIMA TERCEIRA -\nDA REsCIsAo/ExT1NçAo\n13.1. Dar-se-á rescisão nos termos dos artigos 137 a 139.';
  assert.strictEqual(t.slice(loc(t, 'extincao'), loc(t, 'extincao') + 8), 'CLAUSUTA');
  // "DOS CRITÉRIOS DE MEDIÇÃO E PAGAMENTO" (048/2025)
  t = '13.5. As multas serão pagas no prazo de 5 dias, descontado do pagamento devido. CLÁUSULA SEXTA - DOS CRITÉRIOS DE MEDIÇÃO E PAGAMENTO 6.1. O pagamento será efetuado em 29 dias.';
  assert.match(t.slice(loc(t, 'pagamento')), /^CLÁUSULA SEXTA/);
  // "conforme a cláusula quinta" no corpo não é título para a palavra-chave solta
  t = 'nos termos da cláusula quinta - critérios e pagamento, o prazo é de 10 dias. CLÁUSULA SEXTA - DO PAGAMENTO 6.1. Em 30 dias.';
  assert.match(t.slice(loc(t, 'pagamento')), /^CLÁUSULA SEXTA/);
});

test('localização: sem título (sumiu no OCR), a frase que ABRE a cláusula vence a menção solta', () => {
  const t = '6.5. A Prefeitura pode deduzir do montante a pagar os valores correspondentes a multas. ... ADMINISTRATIVAS 13.1. São aplicáveis as sanções previstas no Capítulo I do Título IV da Lei 14.133/2021. 13.2. b) Multa;';
  const pos = _paraTeste.localizarNoTexto(t, item('penalidades').secao, item('penalidades'));
  assert.match(t.slice(pos), /^São aplicáveis as sanções/);
});

test('a regra lê a cláusula inteira e as outras cláusulas do item', async () => {
  const enchimento = ' 2.x. Os serviços seguirão o Termo de Referência.'.repeat(40); // ~1.900 caracteres
  const texto = [
    'CLÁUSULA SEGUNDA - DA EXECUÇÃO DOS SERVIÇOS E DA FISCALIZAÇÃO 2.1. A fiscalização será exercida por servidor designado.' + enchimento + ' 2.9. O gestor do contrato será o titular da Secretaria.',
    'CLÁUSULA TERCEIRA - DO FORO 3.1. Itaverde.'
  ].join('\n');
  const r = await analisarPorChecklist({ documentos: [doc(texto)] });
  assert.strictEqual(r.checklist.find(c => c.id === 'gestao').situacao, 'atende', 'o gestor está no fim da cláusula, fora do trecho de 1.400');
});

test('referência legal pelo regime; matriz de riscos não se aplica na 8.666', () => {
  assert.match(regra.referenciaDoItem(item('garantia'), { lei: '8.666' }), /8\.666\/1993, art\. 55, VI/);
  assert.match(regra.referenciaDoItem(item('garantia'), { lei: '14.133' }), /14\.133\/2021, art\. 92, XII/);
  assert.strictEqual(regra.referenciaDoItem(item('garantia'), null), item('garantia').referencia, 'sem regime: a referência original');
  assert.strictEqual(regra.naoSeAplicaAoRegime(item('matriz'), { lei: '8.666' }), true);
  assert.strictEqual(regra.naoSeAplicaAoRegime(item('matriz'), { lei: '14.133' }), false);
});

test('título com "CLÁUSULA" estragada pelo OCR ainda é achado pelas MAIÚSCULAS', () => {
  const texto = '4.5. A PM pode deduzir do montante a pagar os valores correspondentes a multas. ... CLAUSUILA DÉCIMA - DAS PENALIDADES 10.1. Multa de 0,5% por dia de atraso.';
  const pos = _paraTeste.localizarNoTexto(texto, item('penalidades').secao);
  assert.strictEqual(texto.slice(pos, pos + 16), 'DAS PENALIDADES ');
});

test('o mapa sai com o que a regra resolveu — e o resto fica para conferência', async () => {
  const texto = [GARANTIA, 'CLÁUSULA QUARTA - DO PAGAMENTO 4.1. O pagamento será efetuado em até 30 (trinta) dias após o atesto da nota fiscal pelo fiscal do contrato.', 'CLÁUSULA NONA - DAS OBRIGAÇÕES DA CONTRATADA 9.1. Executar o objeto.'].join('\n');
  const r = await analisarPorChecklist({ documentos: [doc(texto)], regime: { lei: '8.666' } });
  const sit = id => r.checklist.find(c => c.id === id);
  assert.strictEqual(sit('garantia').situacao, 'atende');
  assert.strictEqual(sit('garantia').fonte, 'regra');
  assert.match(sit('garantia').referencia, /8\.666/);
  assert.strictEqual(sit('pagamento').situacao, 'atende');
  assert.strictEqual(sit('obrigacoes').situacao, 'falha', 'julgamento: para conferência manual');
  assert.match(sit('obrigacoes').erro, /confira/);
  assert.strictEqual(sit('matriz').situacao, 'nao_se_aplica');
  assert.ok(r.resolvidosPorRegra >= 2);
});

test('item incompleto fica para conferência com a lista do que a regra não achou', async () => {
  const texto = [GARANTIA, 'CLÁUSULA TERCEIRA - DO REAJUSTE 3.2. Os preços serão reajustados pelo índice oficial aplicável, após 12 meses.'].join('\n');
  const r = await analisarPorChecklist({ documentos: [doc(texto)] });
  assert.strictEqual(r.checklist.find(c => c.id === 'garantia').fonte, 'regra', 'garantia resolvida por regra');
  const reajuste = r.checklist.find(c => c.id === 'reajuste');
  assert.strictEqual(reajuste.situacao, 'falha');
  assert.ok(reajuste.faltando.includes('índice de reajuste nomeado'));
});
