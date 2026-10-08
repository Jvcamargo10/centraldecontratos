/* ===================================================================
   testes/camposPorRegra.test.js

   Objeto, tipo de serviço e gestor/suplente por regra, no lugar da IA.

   As frases usadas aqui foram copiadas dos documentos reais da pasta de
   rede (apostilamentos de 2023 a 2025 e uma portaria), porque é a
   variação de redação que quebra este tipo de regra — não o caso feliz.
   O que cada teste protege está dito no próprio título.
=================================================================== */

const { test } = require('node:test');
const assert = require('node:assert');
const regra = require('../integrations/camposPorRegra');
const { lerAtoDeGestao, nomeValido, normalizarNome, ordemDoAto } = regra._paraTeste;

const doc = (nome, texto) => `=== Arquivo: ${nome} ===\n${texto}`;

/* ---------------- Objeto ---------------- */

test('objeto: copia a cláusula primeira como está escrita, sem a remissão ao edital', () => {
  const texto = doc('Contrato nº 038.2023.pdf',
    'CLÁUSULA PRIMEIRA - DO OBJETO 1.1. Constitui objeto do presente instrumento a PRESTAÇÃO DE SERVIÇOS TÉCNICOS PARA DESBUROCRATIZAÇÃO E DESMATERIALIZAÇÃO DE DOCUMENTOS, conforme exigências e especificações contidas no Edital de Pregão Eletrônico n° 087/2022.');
  const r = regra.acharObjeto(texto);
  assert.match(r.valor, /^PRESTAÇÃO DE SERVIÇOS TÉCNICOS/);
  assert.ok(!/Edital/.test(r.valor), 'a remissão ao edital não faz parte do objeto');
});

test('objeto: aceita "tem por objeto" e não pega o do aditivo', () => {
  const texto = [
    doc('Aditivo de Contrato Nº 215_2022.pdf', 'Fica acrescido ao objeto contratual, conforme proposta comercial da CONTRATADA às fls. 437/438.'),
    doc('Contrato 118_2022.pdf', 'CLÁUSULA PRIMEIRA — DO OBJETO 1.1. O presente contrato tem por objeto a ATUALIZAÇÃO DE VERSÃO DE SOFTWARE, MANUTENÇÃO PREVENTIVA E CORRETIVA DOS EQUIPAMENTOS DE DADOS.')
  ].join('\n\n');
  const r = regra.acharObjeto(texto);
  assert.match(r.valor, /ATUALIZAÇÃO DE VERSÃO DE SOFTWARE/);
  assert.ok(!/fls\. 437/.test(r.valor));
});

test('objeto: sobra de OCR curta demais não vira objeto', () => {
  const texto = doc('Contrato.pdf', 'CLÁUSULA PRIMEIRA - DO OBJETO 1.1. Constitui objeto do presente instrumento a X.');
  assert.strictEqual(regra.acharObjeto(texto), null);
});

/* ---------------- Tipo de serviço ---------------- */

/* A regra de tipo vem DESLIGADA (ver camposPorRegra.js). Os testes
   abaixo ligam de propósito, para a regra continuar coberta caso alguém
   acerte o dicionário e ligue. */
function comRegraDeTipo(fn){
  process.env.REGRAS_CAMPO_TIPO = '1';
  try { return fn(); } finally { delete process.env.REGRAS_CAMPO_TIPO; }
}

test('tipo (ligado por padrão desde 24/09/2026): classifica pelo objeto', () => {
  assert.strictEqual(require('../integrations/camposPorRegra').acharTipoServico('LOCAÇÃO DE MICROCOMPUTADORES', ['Hardware']).valor, 'Hardware');
});

/* Objetos reais dos contratos da pasta (24/09/2026), categorias pedidas
   pelo usuário: Software, Hardware, Infraestrutura... */
test('tipo: objetos reais caem na categoria esperada', () => {
  const { TIPOS_SERVICO } = require('../db');
  const tipo = o => regra.acharTipoServico(o, TIPOS_SERVICO).valor;
  assert.strictEqual(tipo('prestação de SERVIÇO DE COMUNICAÇÃO MULTIMÍDIA - SCM E INTERNET PARA A PREFEITURA'), 'Rede');
  assert.strictEqual(tipo('FORNECIMENTO DE MÓDULO PARA ATUALIZAÇÃO DO ARMAZENAMENTO DO DATACENTER'), 'Infraestrutura');
  assert.strictEqual(tipo('AQUISIÇÃO DE 7.500 KITS DE MICROCOMPUTADORES, COMPOSTOS POR COMPUTADOR, MONITOR'), 'Hardware');
  assert.strictEqual(tipo('FORNECIMENTO DE LICENÇAS DE SOFTWARE AUTODESK'), 'Software');
  assert.strictEqual(tipo('PRESTAÇÃO DE SERVIÇOS GERENCIADOS DE CIBERSEGURANÇA COM OPERAÇÃO 24x7'), 'Segurança');
  assert.strictEqual(tipo('SOLUcAO TECNOLOGICA BASEADA EM SOFTWARE PARA INSPEcAO E SEGURANA DE INFORMAcOES'), 'Segurança', 'OCR sem o Ç');
  assert.strictEqual(tipo('PRESTAÇÃO DE SERVIÇOS TÉCNICOS PARA DESBUROCRATIZAÇÃO E DESMATERIALIZAÇÃO DE DOCUMENTOS'), 'Serviços');
  assert.strictEqual(tipo('Purificador de água de parede'), 'Outros');
  assert.strictEqual(tipo('transporte de cadeiras de rodas para pessoas em situação de vulnerabilidade'), 'Outros', '"vulnerabilidade" social não é segurança da informação');
});

test('objeto: "deste instrumento", "instrurnento" do OCR, e nunca o extrato de outro ato', () => {
  const c = doc('Contrato nº 141_2022.pdf', 'CLÁUSULA PRIMEIRA - DO OBJETO 1.1. Constitui objeto deste instrumento o FORNECIMENTO DE LICENÇAS DE SOFTWARE AUTODESK, de conformidade com o edital.');
  assert.match(regra.acharObjeto(c, '141/2022').valor, /^FORNECIMENTO DE LICENÇAS/);
  const ocr = doc('Contrato Nº 045_2022.pdf', 'CLAUSULA PRIMEIRA - DO OBJETO 1.1. Constitui objeto do presente instrurnento o FORNECIMENTO DE SOLUCAO TECNOLOGICA BASEADA EM SOFTWARE, conforme edital.');
  assert.match(regra.acharObjeto(ocr, '045/2022').valor, /^FORNECIMENTO DE SOLUCAO/);
  const soExtratoDeOutro = doc('Extrato Aditivo Nº 215_2022.pdf', 'CONTRATO Nº 777/2022 OBJETO: Execução de Serviços de Recapeamento Asfáltico, na Rua dos Ipês');
  assert.strictEqual(regra.acharObjeto(soExtratoDeOutro, '045/2022'), null, 'extrato de aditivo, e de outro contrato');
  const extratoDoContrato = doc('Extrato do Contrato 045_2022.pdf', 'CONTRATO Nº 045/2022 CONTRATADA: X OBJETO: Fornecimento de solução de segurança da informação');
  assert.match(regra.acharObjeto(extratoDoContrato, '045/2022').valor, /^Fornecimento de solução/);
});

test('tipo: sem objeto lido, não classifica pelo texto inteiro', () => {
  const r = regra.aplicar('texto sem nada de contrato aqui, cita internet e sistema', {});
  assert.strictEqual(r.campos.tipo, undefined);
});

test('tipo: classifica pelo dicionário e respeita a lista de tipos do sistema', () => comRegraDeTipo(() => {
  const tipos = ['Software', 'Rede', 'Segurança', 'Telefonia', 'Hardware', 'Serviços', 'Expansão de Processamento'];
  assert.strictEqual(regra.acharTipoServico('LOCAÇÃO DE MICROCOMPUTADORES E IMPRESSORAS', tipos).valor, 'Hardware');
  assert.strictEqual(regra.acharTipoServico('LICENCIAMENTO PERPÉTUO DE SOLUÇÃO DE GERENCIAMENTO DE IDENTIDADES PRIVILEGIADAS', tipos).valor, 'Segurança');
  assert.strictEqual(regra.acharTipoServico('FORNECIMENTO DE LINK DE DADOS E CABEAMENTO ESTRUTURADO', tipos).valor, 'Rede');
  assert.strictEqual(regra.acharTipoServico('serviço de telefonia fixa comutada (VoIP)', tipos).valor, 'Telefonia');
}));

test('tipo: categoria fora da lista do sistema não é sugerida', () => comRegraDeTipo(() => {
  const r = regra.acharTipoServico('FORNECIMENTO DE LINK DE DADOS', ['Software', 'Serviços']);
  assert.ok(!r || r.valor !== 'Rede');
}));

test('tipo: texto sem nenhuma palavra conhecida não recebe palpite', () => comRegraDeTipo(() => {
  assert.strictEqual(regra.acharTipoServico('acordo de cooperação técnica entre as partes', ['Software', 'Rede']), null);
}));

/* ---------------- Gestor e suplente ---------------- */

test('gestão: lê gestor e suplente da redação clássica ("para que conste ... como Gestor")', () => {
  const r = lerAtoDeGestao('Fica apostilado o Contrato nº 066/2020, para que conste na Cláusula Décima, item 10.1, como Gestor, o Senhor ISABELA TEIXEIRA LIMA, inscrito no CPF/MF sob o nº 111, ocupante do cargo de Secretário Executivo, bem como o Suplente, Senhor FÁBIO GOMES FARIAS, inscrito no CPF/MF sob o nº 222.');
  assert.deepStrictEqual(r, { responsavel: 'Isabela Teixeira Lima', suplente: 'Fábio Gomes Farias' });
});

test('gestão: lê a redação "passando a constar" dos apostilamentos de 2024/2025', () => {
  const r = lerAtoDeGestao('ASSUNTO: Alteração de gestor e suplente. Fica apostilado o Contrato, para que altere o Gestor e Suplente, passando a constar a nova Gestora, Senhora DANIEL RIBEIRO DIAS, inscrita no CPF/MF sob o nº 1, ocupante do cargo de Diretora, e novo Suplente, Senhor ISABELA FONSECA ARAÚJO, inscrito no CPF/MF sob o nº 2.');
  assert.strictEqual(r.responsavel, 'Daniel Ribeiro Dias');
  assert.strictEqual(r.suplente, 'Isabela Fonseca Araújo');
});

test('gestão: sem o cargo na frase, o papel vem do ASSUNTO do documento', () => {
  const r = lerAtoDeGestao('ASSUNTO: Alteração de suplente CONSIDERANDO: 1) a manifestação da Secretaria. Fica apostilado, para que seja alterado o Suplente, passando a constar o Senhor WAGNER DUARTE CAMPOS, inscrito no CPF/MF sob o nº 2, ocupante do cargo de Supervisor.');
  assert.deepStrictEqual(r, { suplente: 'Wagner Duarte Campos' });
});

test('gestão: a portaria em caixa baixa também é lida', () => {
  const r = lerAtoDeGestao('PORTARIA N° 03/2023. Assunto: Alteração do gestor e suplente do contrato n° 66/2020. Fica aditada a cláusula 10.1 do contrato, para constar como gestor do contrato, senhor Isabela Teixeira Lima, ocupante do cargo de Secretário, e como gestor suplente do contrato, senhor Fábio Gomes Farias, ocupante do cargo de Gerente.');
  assert.strictEqual(r.responsavel, 'Isabela Teixeira Lima');
  assert.strictEqual(r.suplente, 'Fábio Gomes Farias');
});

test('gestão: documento que só CITA gestor não nomeia ninguém', () => {
  /* "O recebimento dos equipamentos e aprovação da instalação pelo gestor
     do contrato" — cláusula de pagamento do contrato do 066/2020. Sem
     parte dispositiva, não há nome a extrair. */
  assert.strictEqual(lerAtoDeGestao('5.2. São condições para a liberação do pagamento: a) o recebimento dos equipamentos e aprovação da instalação pelo gestor do contrato;'), null);
});

test('gestão: frase inteira não passa por nome', () => {
  /* A expressão usa flag "i" (a portaria escreve em minúsculas), então a
     caixa não serve de validação — quem barra é a lista de palavras e o
     limite de partes do nome. */
  assert.strictEqual(nomeValido('passando a constar o Senhor Wagner Duarte Campos'), null);
  assert.strictEqual(nomeValido('Secretaria de Tecnologia'), null);
  assert.strictEqual(nomeValido('Ana'), null);
  assert.strictEqual(nomeValido('Ana Paula Souza'), 'Ana Paula Souza');
});

test('gestão: o ato mais recente vence, e o contrato só entra se não houver ato', () => {
  const texto = [
    doc('Contrato 066_2020.pdf', 'CLÁUSULA DÉCIMA - DA GESTÃO 10.1. Fica designado como Gestor o Senhor JOAO ANTIGO PEREIRA, inscrito no CPF/MF sob o nº 9. Contrato nº 066/2020.'),
    doc('Apostilamento 046_2023 do Contrato 066_2020.pdf', 'Fica apostilado o Contrato nº 066/2020, para que conste como Gestor, o Senhor ISABELA TEIXEIRA LIMA, inscrito no CPF/MF sob o nº 1, bem como o Suplente, Senhor FÁBIO GOMES FARIAS, inscrito no CPF/MF sob o nº 2.'),
    doc('Apostilamento Nº 005_2025.pdf', 'Fica apostilado o Contrato nº 066/2020, para que conste o novo gestor, Senhor VANESSA FERREIRA COSTA, inscrito no CPF/MF sob o nº 3, ocupante do Cargo de Diretor.')
  ].join('\n\n');
  const r = regra.acharGestaoDoContrato(texto, '066/2020');
  assert.strictEqual(r.responsavel, 'Vanessa Ferreira Costa', 'o apostilamento de 2025 manda');
  assert.strictEqual(r.suplente, 'Fábio Gomes Farias', 'o ato de 2025 não mexeu no suplente');
});

test('gestão: ato de OUTRO contrato guardado na mesma pasta é ignorado', () => {
  /* Aconteceu de verdade: o 072/2020 recebia o suplente de um ato do
     045/2022 arquivado junto. */
  const texto = [
    doc('Apostilamento Nº 002_2025 - outro contrato.pdf', 'Fica apostilado o Contrato nº 045/2022, para que conste como Gestor, o Senhor FULANO DE TAL SOUZA, inscrito no CPF/MF sob o nº 1.'),
    doc('Contrato 072_2020.pdf', 'Contrato nº 072/2020 celebrado entre as partes.')
  ].join('\n\n');
  const r = regra.acharGestaoDoContrato(texto, '072/2020');
  assert.ok(!r || !r.responsavel, 'nome de ato alheio não pode entrar');
});

test('gestão: pasta com ato de gestor ilegível avisa, em vez de ficar em silêncio', () => {
  const texto = doc('Apostilamento Nº 010_2024.pdf', 'ASSUNTO: Alteração de gestor. CONSIDERANDO a solicitação. [texto ilegível] fl. 524.');
  const r = regra.acharGestaoDoContrato(texto, null);
  assert.strictEqual(r.responsavel, null);
  assert.match(r.avisos[0], /não p[ôo]de ser lido/i);
});

test('ordem dos atos: portaria sem ano no nome não passa na frente de 2025', () => {
  const portaria = { nome: 'Portaria alteração gestor e suplente do contrato 66_20.pdf', texto: 'PORTARIA N° 03/2023 ... Itaverde, 10 de maio de 2023.' };
  const apostilamento = { nome: 'Apostilamento Nº 005_2025.pdf', texto: 'APOSTILAMENTO Nº 005/2025' };
  assert.ok(ordemDoAto(apostilamento) > ordemDoAto(portaria));
});

test('nome: inicial solta continua maiúscula; conectivo fica minúsculo', () => {
  assert.strictEqual(normalizarNome('WAGNER DUARTE CAMPOS'), 'Wagner Duarte Campos');
  assert.strictEqual(normalizarNome('ISABELA TEIXEIRA LIMA'), 'Isabela Teixeira Lima');
  assert.strictEqual(normalizarNome('Daniel Nunes Prado'), 'Daniel Nunes Prado');
});

/* ---------------- Chave de desligamento ---------------- */

test('REGRAS_CAMPOS_EXTRAS=0 devolve o sistema ao comportamento anterior', () => {
  const texto = doc('Contrato.pdf', 'CLÁUSULA PRIMEIRA - DO OBJETO 1.1. Constitui objeto do presente instrumento a PRESTAÇÃO DE SERVIÇOS DE REDE.');
  assert.ok(regra.acharObjeto(texto), 'ligado, acha');
  const antes = process.env.REGRAS_CAMPOS_EXTRAS;
  process.env.REGRAS_CAMPOS_EXTRAS = '0';
  try {
    assert.strictEqual(regra.acharObjeto(texto), null);
    assert.strictEqual(regra.acharTipoServico('LOCAÇÃO DE MICROCOMPUTADORES', ['Hardware']), null);
    assert.strictEqual(regra.acharGestaoDoContrato(texto, null), null);
    assert.deepStrictEqual(regra.aplicar(texto, {}).campos, {});
  } finally {
    if (antes === undefined) delete process.env.REGRAS_CAMPOS_EXTRAS;
    else process.env.REGRAS_CAMPOS_EXTRAS = antes;
  }
});

test('cada campo tem a sua própria chave', () => {
  const texto = doc('Contrato.pdf', 'CLÁUSULA PRIMEIRA - DO OBJETO 1.1. Constitui objeto do presente instrumento a PRESTAÇÃO DE SERVIÇOS DE REDE.');
  process.env.REGRAS_CAMPO_OBJETO = '0';
  try {
    process.env.REGRAS_CAMPO_TIPO = '1';
    const r = regra.aplicar(texto, { tiposValidos: ['Rede', 'Serviços'] });
    assert.strictEqual(r.campos.objeto, undefined, 'objeto desligado');
    assert.ok(r.campos.tipo, 'o tipo tem chave própria e continua ligado');
    delete process.env.REGRAS_CAMPO_TIPO;
  } finally {
    delete process.env.REGRAS_CAMPO_OBJETO;
  }
});

test('gestão: cada nome diz de qual documento veio', () => {
  /* O ato de 2025 trocou só o gestor; o suplente continua vindo do de
     2024. Mostrar os dois como se viessem do mesmo documento seria
     mentira na tela da Fila. */
  const texto = [
    doc('Apostilamento Nº 013_2024.pdf', 'Fica apostilado o Contrato nº 072/2020, para que conste como Gestor, o Senhor VANESSA FERREIRA COSTA, inscrito no CPF/MF sob o nº 1, bem como o Suplente, Senhor WAGNER DUARTE CAMPOS, inscrito no CPF/MF sob o nº 2.'),
    doc('Apostilamento Nº 006_2025.pdf', 'Fica apostilado o Contrato nº 072/2020, para que conste a nova gestora, Senhora DANIEL NUNES PRADO, inscrita no CPF/MF sob o nº 3.')
  ].join('\n\n');
  const r = regra.aplicar(texto, { numeroContrato: '072/2020' });
  assert.strictEqual(r.campos.responsavel, 'Daniel Nunes Prado');
  assert.strictEqual(r.origem.responsavel, 'Apostilamento Nº 006_2025.pdf');
  assert.strictEqual(r.campos.suplente, 'Wagner Duarte Campos');
  assert.strictEqual(r.origem.suplente, 'Apostilamento Nº 013_2024.pdf', 'o suplente veio do ato anterior');
});

test('objeto: a remissão às condições do edital também é cortada', () => {
  const texto = doc('Contrato 072_2020.pdf', 'CLÁUSULA PRIMEIRA - DO OBJETO 1.1. Constitui objeto do presente instrumento o Licenciamento Perpétuo de Solução de Gerenciamento de Identidades Privilegiadas, de acordo com as condições e especificações constantes no Anexo I - Termo de Referência do Edital.');
  const r = regra.acharObjeto(texto);
  assert.strictEqual(r.valor, 'Licenciamento Perpétuo de Solução de Gerenciamento de Identidades Privilegiadas');
});

/* ---------------- Histórico de gestão ---------------- */

test('histórico: guarda a cadeia inteira, do ato mais recente para o mais antigo', () => {
  /* Sem isto, o sistema só respondia "quem é o gestor hoje?" — e a
     resposta anterior sumia quando o apostilamento seguinte trocava o
     nome. Medido em 23/09/2026: 7 dos 31 contratos já têm dois ou mais
     atos de gestão. */
  const texto = [
    doc('Apostilamento 046_2023 do Contrato 066_2020.pdf', 'Fica apostilado o Contrato nº 066/2020, para que conste como Gestor, o Senhor ISABELA TEIXEIRA LIMA, inscrito no CPF/MF sob o nº 1, bem como o Suplente, Senhor FÁBIO GOMES FARIAS, inscrito no CPF/MF sob o nº 2.'),
    doc('Apostilamento Nº 012_2024.pdf', 'Fica apostilado o Contrato nº 066/2020, para que conste como Gestora a Senhora MARINA QUINTELA DE SOUZA, inscrita no CPF/MF sob o nº 3.'),
    doc('Apostilamento Nº 005_2025.pdf', 'Fica apostilado o Contrato nº 066/2020, para que conste o novo gestor, Senhor VANESSA FERREIRA COSTA, inscrito no CPF/MF sob o nº 4.')
  ].join('\n\n');
  const r = regra.aplicar(texto, { numeroContrato: '066/2020' });

  assert.deepStrictEqual(r.gestaoHistorico.map(h => h.termo), ['005', '012', '046'], 'do mais novo para o mais antigo');
  assert.deepStrictEqual(r.gestaoHistorico.map(h => h.ano), [2025, 2024, 2023]);
  assert.strictEqual(r.gestaoHistorico[1].responsavel, 'Marina Quintela de Souza');
  assert.strictEqual(r.gestaoHistorico[2].suplente, 'Fábio Gomes Farias');
  // "vale hoje" marca os atos de onde saem os nomes vigentes — o de 2025
  // (gestor) e o de 2023 (suplente, que ninguém trocou depois).
  assert.deepStrictEqual(r.gestaoHistorico.map(h => h.atual), [true, false, true]);
});

test('histórico: o mesmo ato guardado duas vezes na pasta entra uma vez só', () => {
  const ato = 'Fica apostilado o Contrato nº 066/2020, para que conste como Gestor, o Senhor ISABELA TEIXEIRA LIMA, inscrito no CPF/MF sob o nº 1.';
  const texto = [doc('Apostilamento 046_2023.pdf', ato), doc('Apostilamento 046_2023.pdf', ato)].join('\n\n');
  const r = regra.aplicar(texto, { numeroContrato: '066/2020' });
  assert.strictEqual(r.gestaoHistorico.length, 1);
});

test('histórico: portaria e apostilamento do mesmo ato entram uma vez só', () => {
  /* Na pasta do 066/2020 a nomeação de 2023 aparece duas vezes: a
     portaria e o apostilamento que a publica. Sem agrupar, o histórico
     dava a entender que houve duas nomeações iguais. */
  const nomes = 'como Gestor, o Senhor ISABELA TEIXEIRA LIMA, inscrito no CPF/MF sob o nº 1, bem como o Suplente, Senhor FÁBIO GOMES FARIAS, inscrito no CPF/MF sob o nº 2.';
  const texto = [
    doc('Apostilamento 046_2023 do Contrato 066_2020.pdf', `Fica apostilado o Contrato nº 066/2020, para que conste ${nomes}`),
    doc('Portaria alteração gestor e suplente do contrato 66_20.pdf', `PORTARIA N° 03/2023. Fica aditada a cláusula 10.1 do contrato nº 066/2020, para constar ${nomes}`)
  ].join('\n\n');
  const r = regra.aplicar(texto, { numeroContrato: '066/2020' });
  assert.strictEqual(r.gestaoHistorico.length, 1, 'um ato, não dois');
});

/* ---------------- Redações achadas na medição de 24/09/2026 ----------------
   Casos em que a IA achou o nome e a regra não: a redação passou para a
   regra, e a IA saiu da ingestão. */

test('objeto: "constitui objeto do presente CONTRATO a AQUISIÇÃO" (sem perder o "A")', () => {
  const r = regra.acharObjeto(doc('Contrato Comercial Nº 086_2026.pdf',
    'CLÁUSULA PRIMEIRA - DO OBJETO 1.1. Constitui objeto do presente contrato a AQUISIÇÃO DE 7.500 (SETE MIL E QUINHENTOS) KITS DE MICROCOMPUTADORES, conforme especificações do Termo de Referência.'));
  assert.match(r.valor, /^AQUISIÇÃO DE 7\.500/);
});

test('gestor: cláusula do próprio contrato, "fiscalização pelo gestor titular, Senhor ..."', () => {
  const a = lerAtoDeGestao('2.1. O Contrato ficará sob o regime de acompanhamento e fiscalização pelo gestor titular, Senhor VANESSA FERREIRA COSTA, ocupante do cargo de Diretor de Departamento, inscrito no CPF/MF sob o nº [CPF removido], e nos afastamentos e impedimentos legais pelo suplente, Senhor Bruno Ribeiro Dias, matrícula nº 201.522.');
  assert.deepStrictEqual(a, { responsavel: 'Vanessa Ferreira Costa', suplente: 'Bruno Ribeiro Dias' });
});

test('gestor: "pelo gestor, titular ANA PAULA CARDOSO MELO" — "titular" não é nome', () => {
  const a = lerAtoDeGestao('6.2. O Contrato ficará sob regime de acompanhamento e fiscalização pelo gestor, titular ANA PAULA CARDOSO MELO, inscrito no CPF sob no [CPF removido].');
  assert.strictEqual(a.responsavel, 'Ana Paula Cardoso Melo');
});

test('gestor: "sob a gestão da Servidora, Senhora ..."', () => {
  const a = lerAtoDeGestao('CLÁUSULA SÉTIMA - DA GESTÃO E FISCALIZAÇÃO DO CONTRATO 7.1. O presente contrato ficará sob a gestão da Servidora, Senhora DANIEL NUNES PRADO, matrícula 174.018, ocupante do cargo de Diretora de Governança e no seu afastamento e impedimentos legais o suplente WAGNER DUARTE CAMPOS, matrícula 191.405.');
  assert.deepStrictEqual(a, { responsavel: 'Daniel Nunes Prado', suplente: 'Wagner Duarte Campos' });
});

test('gestor: formulário do TCE anexado ao aditivo, quando o contrato não traz o nome', () => {
  const texto = [
    doc('Contrato Nº 045_2022.pdf', 'Contrato nº 045/2022. 8.1.2. Manter um gestor responsável pela fiscalização do bom andamento do contrato.'),
    doc('Termo de Aditamento Nº 238_2024.pdf', 'Fica prorrogado o Contrato nº 045/2022. TERMO DE CIÊNCIA E NOTIFICAÇÃO GESTOR(ES) DO CONTRATO: Nome: CARLA ANTUNES VIANA Cargo: Diretor de Segurança da Informação CPF: [CPF removido]')
  ].join('\n\n');
  const g = regra.acharGestaoDoContrato(texto, '045/2022');
  assert.strictEqual(g.responsavel, 'Carla Antunes Viana');
  assert.strictEqual(g.fonteResponsavel, 'Termo de Aditamento Nº 238_2024.pdf');
});

test('aditivo sem formulário do TCE não é lido como ato de gestão', () => {
  const texto = [
    doc('Contrato Nº 045_2022.pdf', 'Contrato nº 045/2022.'),
    doc('Termo de Aditamento Nº 238_2024.pdf', 'Fica prorrogado o Contrato nº 045/2022, passando a constar o gestor, o Senhor FULANO DE TAL SOUZA, inscrito no CPF.')
  ].join('\n\n');
  const g = regra.acharGestaoDoContrato(texto, '045/2022');
  assert.ok(!g || !g.responsavel, 'corpo de aditivo fala de outras coisas: só o formulário vale');
});

/* Preposto (24/09/2026): o nome vem do ofício de indicação da empresa. */
test('preposto: ofício "autorizamos FULANO, nacionalidade..."', () => {
  const t = doc('Ofício nº 001-OMTX-2026 - Apresentação de preposto e equipe técnica.pdf',
    'Ref.: Apresentação de Preposto e equipe técnica. Prezada Sra. Daniel Nunes Prado, Gestora do Contrato. Pela presente autorizamos Wagner Nunes Prado, nacionalidade brasileira, portadora do RG ...');
  const p = regra.acharPreposto(t, '096/2025');
  assert.strictEqual(p.valor, 'Wagner Nunes Prado');
  assert.match(p.fonte, /Apresentação de preposto/);
});

test('preposto: indicação em tabela (nome seguido de telefone), sem guardar telefone nem e-mail', () => {
  const t = doc('Indicação de Preposto - PM.pdf', 'INDICAÇÃO DE PREPOSTO REF. CONTRATO Nº. 075/2025 Nome Telefone E-mail RG/CPF Função Vanessa Cardoso Melo (11) 99148-3768 jmoraes@exemplo.com.br [CPF removido] Responsável pelo projeto Otávio Lacerda Bastos (21) 98153-4927 rtristao@exemplo.com.br');
  const p = regra.acharPreposto(t, '075/2025');
  assert.strictEqual(p.valor, 'Vanessa Cardoso Melo');
  assert.match(p.fonte, /também indicados: Otávio Lacerda Bastos/);
  assert.ok(!/99148|@/.test(JSON.stringify(p)), 'nada de telefone ou e-mail');
});

test('preposto: "Preposto: FULANO" e cláusula genérica não é nome', () => {
  assert.strictEqual(regra.acharPreposto(doc('Contrato nº 010_2024.pdf', 'Contrato nº 010/2024. PREPOSTO DA CONTRATADA: Sr. Rogério Antunes Leal, portador do RG'), '010/2024').valor, 'Rogério Antunes Leal');
  const generico = regra.acharPreposto(doc('Contrato nº 088_2026.pdf', 'Contrato nº 088/2026. 9.1.8. A CONTRATADA deverá manter, quando necessário, preposto responsável pela execução do contrato, aceito pelo CONTRATANTE.'), '088/2026');
  assert.strictEqual(generico.valor, null);
  assert.strictEqual(generico.exigido, true, 'o contrato exige, mas não indica');
  const r = regra.aplicar(doc('Contrato nº 088_2026.pdf', 'Contrato nº 088/2026. A CONTRATADA deverá manter preposto aceito pelo CONTRATANTE.'), { numeroContrato: '088/2026' });
  assert.match(r.origem.preposto_semValor, /exige preposto.*não foi encontrada/);
});

test('preposto: "autorizamos a execução dos serviços" não é nome de pessoa', () => {
  assert.strictEqual(regra.acharPreposto(doc('Ofício - preposto.pdf', 'Pela presente autorizamos a execução dos serviços, conforme contrato.'), null).valor, null);
});
