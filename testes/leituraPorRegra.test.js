/* ===================================================================
   testes/leituraPorRegra.test.js

   A leitura dos campos de um contrato por regra (leituraPorRegra.js) —
   casos reais, a maioria medida na avaliação contra o SGC (21/09/2026).
   Estes testes moravam em iaProvider.test.js até a IA ser retirada
   (01/10/2026).
=================================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const regra = require('../integrations/leituraPorRegra');

test('regra: pega o CNPJ da CONTRATADA, não o do Município', () => {
  /* Todo contrato da Prefeitura cita dois CNPJs e o do Município vem
     primeiro. A regra antiga ("pegue o primeiro") colocava o CNPJ da
     própria Prefeitura no campo da empresa — errado de forma consistente
     e difícil de notar na revisão. */
  const texto = 'o MUNICÍPIO DE ITAVERDE, Pessoa Jurídica de Direito Público Interno, inscrito no CNPJ sob o nº ' +
    '11.256.774/0001-02, com sede na Avenida das Palmeiras, e de outro lado a empresa ATLAS ' +
    'TECNOLOGIA DA INFORMAÇÃO LTDA, inscrita no CNPJ nº 11.253.441/0001-11, com sede na Rua das Acácias';
  const r = regra.lerCampos(texto);
  assert.equal(r.campos.cnpjEmpresa, '11.253.441/0001-11');
  assert.equal(r.campos.empresa, 'ATLAS TECNOLOGIA DA INFORMAÇÃO LTDA');
});

test('regra: não confunde cláusula de obrigação com razão social', () => {
  // A regex antiga devolvia "seja única e exclusiva responsável pela
  // execução" no campo `empresa`, por casar com qualquer frase iniciada
  // por "CONTRATADA".
  const texto = 'A CONTRATADA seja única e exclusiva responsável pela execução dos serviços contratados.';
  const r = regra.lerCampos(texto);
  assert.equal(r.campos.empresa, null);
});

test('regra: valor só é preenchido quando o texto diz que é mensal', () => {
  /* `valor` no cadastro é MENSAL, mas contrato declara o TOTAL. Pegar o
     primeiro "R$" do texto punha 26.100.000 num campo que o Painel de
     Indicadores soma como mensalidade — 12.500x o valor real. */
  const soTotal = 'O valor global do presente contrato é de R$ 26.100.000,00 (vinte e seis milhões e cem mil reais).';
  assert.equal(regra.lerCampos(soTotal).campos.valor, null);

  const comMensal = 'O valor mensal do presente contrato é de R$ 2.075,07 (dois mil e setenta e cinco reais).';
  assert.strictEqual(regra.lerCampos(comMensal).campos.valor, 2075.07);
});

test('regra: reconhece número do contrato, processo administrativo e modalidade', () => {
  const texto = 'CONTRATO Nº 096/2025 ... Processo Administrativo n° 01.275/2025 ... ' +
    'decorrente do Edital de Pregão Eletrônico nº 90.084/2025';
  const r = regra.lerCampos(texto);
  assert.equal(r.campos.numero, '096/2025');
  assert.equal(r.campos.pa, '01.275/2025');
  assert.equal(r.campos.tipoContratacao, 'Pregão Eletrônico');
});

test('data por extenso conta como escrita no documento', () => {
  /* Contrato da Prefeitura escreve data por extenso. A versão anterior só
     reconhecia dd/mm/aaaa e, na avaliação contra o SGC, enxergava o início
     da vigência em 1 de 24 contratos — o certo eram 11. Na tela, isso
     marcava como inferida uma data que estava no documento. */
  assert.equal(regra.dataApareceNoTexto('2025-12-05', 'Itaverde, 5 de dezembro de 2025.'), true);
  assert.equal(regra.dataApareceNoTexto('2025-12-05', 'Itaverde, 05 de Dezembro de 2025.'), true);
  assert.equal(regra.dataApareceNoTexto('2026-03-01', 'a partir de 1º de março de 2026'), true);
  assert.equal(regra.dataApareceNoTexto('2025-12-05', 'emitido em 5/12/2025'), true);
  assert.equal(regra.dataApareceNoTexto('2025-12-05', 'emitido em 05.12.2025'), true);
  // E continua recusando o que não está lá.
  assert.equal(regra.dataApareceNoTexto('2025-12-05', 'Itaverde, 15 de dezembro de 2025.'), false, '15 não é 5');
  assert.equal(regra.dataApareceNoTexto('2025-12-05', 'vigência de 12 (doze) meses'), false);
});

/* ------------------------------------------------------------------
   Busca local — casos medidos na avaliação contra o SGC (21/09/2026),
   24 contratos reais da pasta de rede. Cada teste é um contrato.
------------------------------------------------------------------ */

test('regra: número com zero à esquerda, no formato do SGC', () => {
  /* A aprovação casa proposta e contrato por comparação EXATA do número;
     "96/2025" não casaria com o "096/2025" do SGC e viraria duplicata. */
  assert.equal(regra.lerCampos('CONTRATO Nº 96/2025 que entre si celebram').campos.numero, '096/2025');
});

test('regra: não confunde item de cláusula com número de contrato', () => {
  /* 009/2023: o OCR estragou o cabeçalho ("CONTRATO N° OOQ/202") e a
     regra antiga devolveu "2.17". Sem número válido no texto, vale o
     nome do arquivo do documento principal. */
  const texto = '=== Arquivo: Contrato 009_2023 - Vox Telecom.pdf ===\nCONTRATO N° OOQ/202 ... conforme o contrato, item 2.17 do anexo';
  assert.equal(regra.lerCampos(texto).campos.numero, '009/2023');
  assert.equal(regra.lerCampos('conforme o contrato, item 2.17 do anexo').campos.numero, null, 'sem fonte confiável, vazio — não chute');
});

test('regra: processo administrativo com ano impossível é descartado', () => {
  // 072/2020: a regra antiga devolveu "26.533/2101".
  const texto = 'Processo Administrativo nº 26.533/2101 (erro de digitação) ... Processo Administrativo nº 26.533/2018';
  assert.equal(regra.lerCampos(texto).campos.pa, '26.533/2018');
});

test('regra: frase de cláusula não vira razão social', () => {
  /* 010/2024, 064/2025, 052/2026: a regra antiga devolveu "fará jus à
     aplicação de compensação..." — aceitava "SA"/"ME" minúsculos no meio
     da frase. */
  const texto = 'Em caso de atraso, a CONTRATADA fará jus à aplicação de compensação financeira, na forma da lei em mesma data.';
  assert.equal(regra.lerCampos(texto).campos.empresa, null);
});

test('regra: razão social do preâmbulo, com "EMPRESA" em maiúsculas e cortada antes de "pessoa jurídica"', () => {
  // 045/2023: a primeira versão da regra nova perdeu este (só aceitava "empresa" minúsculo).
  const texto = 'de outro lado a EMPRESA KAPA TECNOLOGIA LTDA, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº 11.228.023/0001-74';
  assert.equal(regra.lerCampos(texto).campos.empresa, 'KAPA TECNOLOGIA LTDA');
});

test('regra: o contrato principal tem prioridade sobre extratos do Diário Oficial', () => {
  /* 048/2025: a pasta tinha uma página do Diário com o extrato de outro
     contrato (da Saúde), e a razão social saiu dele. */
  const texto = '=== Arquivo: Contrato Comercial Nº 048_2025.pdf ===\n' +
    'e de outro lado a empresa LUMEN SOFTWARE LTDA, inscrita no CNPJ nº 11.228.023/0001-74\n\n' +
    '=== Arquivo: Extrato iom.pdf ===\nOutro extrato: a empresa CENTRO DE APOIO EXEMPLO LTDA, inscrita no CNPJ nº 11.111.111/0001-11';
  assert.equal(regra.lerCampos(texto).campos.empresa, 'LUMEN SOFTWARE LTDA');
});

test('regra: secretaria com o nome quebrado em linhas e sem a vírgula', () => {
  // 048/2025 e 045/2022: o OCR quebra "Secretaria de / Tecnologia" e come vírgulas.
  const texto = 'representado pela Secretaria\nMunicipal de\nTecnologia, e por outro lado... atendimento à Secretaria de Saúde';
  assert.equal(regra.lerCampos(texto).campos.secretaria, 'Secretaria Municipal de Tecnologia');
});

test('regra: os campos da ficha de cadastro saem da mesma leitura', () => {
  const texto = 'CONTRATO Nº 096/2025 ... de outro lado a empresa AURORA TECNOLOGIA LTDA, inscrita no CNPJ nº 11.253.441/0001-11';
  const f = regra.fichaPorRegra(texto);
  assert.equal(f.campos.numero, '096/2025');
  assert.equal(f.campos.cnpjEmpresa, '11.253.441/0001-11');
  assert.equal(f.campos.empresa, 'AURORA TECNOLOGIA LTDA');
  assert.equal(f.campos.portaria, null, 'portaria não está no texto do contrato: fica em branco');
  assert.deepStrictEqual(f.fiscais, []);
  assert.equal(f.modeloUsado, 'regras');
});

test('regra: valor em reais escrito no texto, sem confundir com parte de um número maior', () => {
  assert.equal(regra.valorApareceNoTexto(26100000, 'valor global de R$ 26.100.000,00'), true);
  assert.equal(regra.valorApareceNoTexto(100000, 'valor global de R$ 26.100.000,00'), false);
});
