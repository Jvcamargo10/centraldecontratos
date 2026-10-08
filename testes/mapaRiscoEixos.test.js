/* ===================================================================
   testes/mapaRiscoEixos.test.js

   Eixos Prazo, Financeiro e Gestão do Mapa de risco pelo REGISTRO DE
   RISCOS (28/09/2026): um motor só. Cada eixo é o risco mais crítico do
   registro que cai nele (P × I, régua da planilha do SGC), com evidência
   e fundamento. Casos reais da pasta.
=================================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const { calcularEixos, riscoAtualDoContrato } = require('../integrations/mapaRiscoContratos');

const emDias = n => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

function cenario({ contrato = {}, proposta = {}, aditivos = [], carteira = [], tratativas = [], mapa = null } = {}) {
  const c = { id: 1, numero: '045/2022', valor: 100000, inicio: emDias(-200), termino: emDias(300), responsavel: 'Ana Souza', suplente: 'Carlos Lima', preposto: 'Renata Valadares', status: 'Ativo', ...contrato };
  return {
    contrato: c,
    db: {
      contratos: [c, ...carteira.map((v, i) => ({ id: 100 + i, numero: `X${i}`, valor: v, status: 'Ativo' }))],
      aditivos: aditivos.map(a => ({ contrato: c.numero, ...a })), apostilamentos: [], tratativas,
      alertaConfig: { critico: 15, atencao: 30, proximo: 90 },
      importacoesPendentes: [{ id: 9, contratoId: 1, status: 'aprovado', aprovadoEm: '2026-09-01', calculoValor: { valorInicial: 9000000 }, calculoVigencia: { mesesTotal: 12, termino: c.termino, avisos: [] }, regimeLegal: { lei: '14.133' }, ...proposta }],
      mapasRisco: mapa ? [{ id: 1, contratoId: 1, geradoEm: '2026-09-20T00:00:00Z', ...mapa }] : []
    }
  };
}
const codigos = eixo => eixo.motivos.filter(m => m.codigo).map(m => m.codigo);

test('contrato caro, sem acréscimo, com reajuste em dia e prazo folgado: nenhum risco financeiro nem de prazo', () => {
  const { db, contrato } = cenario({ contrato: { valor: 562494.58 }, aditivos: [{ natureza: 'prorrogação', valor: 6000000, numero: '10/2025' }] });
  const e = calcularEixos(db, contrato);
  assert.strictEqual(e.financeiro.nivel, 'baixo');
  assert.strictEqual(e.prazo.nivel, 'baixo');
  assert.deepStrictEqual(codigos(e.financeiro), []);
  assert.strictEqual(e.gestao.nivel, 'baixo');
});

test('acréscimos em 24% do valor inicial (045/2022): Médio, com a conta e a lei — a mesma régua do Registro', () => {
  const { db, contrato } = cenario({ aditivos: [{ natureza: 'acréscimo', valor: 2157913.6, numero: '77/2023' }] });
  const e = calcularEixos(db, contrato);
  assert.strictEqual(e.financeiro.nivel, 'medio');
  const m = e.financeiro.motivos.find(x => x.codigo === 'LIMITE_ACRESCIMO');
  assert.strictEqual(m.criticidade, 12);
  assert.match(m.texto, /24\.0% do valor inicial/);
  assert.match(m.fundamento, /art\. 125/);
});

test('acréscimos acima de 25%: Alto (Evitar)', () => {
  const { db, contrato } = cenario({ aditivos: [{ natureza: 'acréscimo', valor: 2500000, numero: '1/2024' }] });
  const e = calcularEixos(db, contrato);
  assert.strictEqual(e.financeiro.nivel, 'alto');
  assert.strictEqual(e.financeiro.motivos[0].criterio, 'Evitar');
});

test('066/2020: 72 meses pela Lei 8.666 — limite esgotado, "não pode mais ser prorrogado", Alto no Prazo', () => {
  const { db, contrato } = cenario({ contrato: { termino: emDias(120) }, proposta: { calculoVigencia: { mesesTotal: 72, termino: emDias(120), avisos: [] }, regimeLegal: { lei: '8.666' } } });
  const e = calcularEixos(db, contrato);
  assert.strictEqual(e.prazo.nivel, 'alto');
  const l = e.prazo.motivos.find(x => x.codigo === 'LIMITE_VIGENCIA');
  assert.match(l.titulo, /não pode mais ser prorrogado — vence em 120 dia/);
  assert.strictEqual(l.acao, 'nova_contratacao');
});

test('antecedência: 60 meses (só resta a excepcional) a menos de 180 dias do fim sobe para Alto; longe do fim é Médio', () => {
  const com = dias => {
    const { db, contrato } = cenario({ contrato: { termino: emDias(dias) }, proposta: { calculoVigencia: { mesesTotal: 60, termino: emDias(dias), avisos: [] }, regimeLegal: { lei: '8.666' } } });
    return calcularEixos(db, contrato).prazo.motivos.find(x => x.codigo === 'LIMITE_VIGENCIA');
  };
  assert.strictEqual(com(150).criticidade, 20, 'perto do fim: 5 × 4');
  assert.strictEqual(com(400).criticidade, 16, 'longe do fim: 4 × 4');
});

test('vencido: Prazo Alto, com a data (Registro: 5 × 5)', () => {
  const { db, contrato } = cenario({ contrato: { termino: emDias(-16) } });
  const e = calcularEixos(db, contrato);
  assert.strictEqual(e.prazo.nivel, 'alto');
  assert.match(e.prazo.motivos[0].titulo, /vencido há 16 dia/);
});

test('garantia vencida (006/2025): Financeiro Alto, com a frase do ofício', () => {
  const { db, contrato } = cenario({ contrato: { termino: emDias(140), garantiaVerificadaEm: '2026-09-28', garantiaDocumentos: 1,
    garantiaLida: { arquivo: 'Apolice Seguro Garantia Contrato Comercial 006_2025 ITD.pdf', inicio: '2025-02-13', fim: emDias(-227), citacao: 'vigência entre 13/02/2025 até 13/02/2026, referente ao Contrato nº 006/2025', porOcr: true } } });
  const e = calcularEixos(db, contrato);
  const g = e.financeiro.motivos.find(x => x.codigo === 'GARANTIA_VENCIDA');
  assert.strictEqual(e.financeiro.nivel, 'alto');
  assert.match(g.texto, /vigência entre 13\/02\/2025 até 13\/02\/2026/);
  assert.match(g.texto, /confira na apólice/, 'data lida por OCR vem marcada para conferência');
});

test('garantia exigida sem comprovante na pasta: só monitorar (a apólice original vai para a Fazenda)', () => {
  const { db, contrato } = cenario({ contrato: { garantiaVerificadaEm: '2026-09-28', garantiaDocumentos: 0, garantiaLida: null },
    mapa: { checklist: [{ id: 'garantia', item: 'Garantia', obrigatorio: true, situacao: 'atende' }] } });
  const g = calcularEixos(db, contrato).financeiro.motivos.find(x => x.codigo === 'GARANTIA_NAO_ARQUIVADA');
  assert.strictEqual(g.criterio, 'Aceitar e monitorar');
});

test('valor mensal não cadastrado entra no Financeiro; cooperação sem repasse: Financeiro "não se aplica"', () => {
  const semValor = cenario({ contrato: { valor: 0 } });
  assert.ok(codigos(calcularEixos(semValor.db, semValor.contrato).financeiro).includes('VALOR_NAO_CADASTRADO'));
  const coop = cenario({ contrato: { valor: 0, arquivoOrigem: 'F:\\P.A. 21.887_2023 - Cooperação - IFTEC\\Acordo de Cooperação - IFTEC.pdf' } });
  const f = calcularEixos(coop.db, coop.contrato).financeiro;
  assert.strictEqual(f.nivel, null);
  assert.strictEqual(f.naoSeAplica, true);
});

test('Gestão: sem gestor é Alto; risco registrado à mão pelo gestor também entra', () => {
  const { db, contrato } = cenario({ contrato: { responsavel: '(a definir)' } });
  db.registroRiscos = [{ id: 1, contratoId: 1, registro: 'risco', status: 'Ativo', descricao: 'Link redundante não instalado', probabilidade: 3, impacto: 4, criticidade: 12 }];
  const g = calcularEixos(db, contrato).gestao;
  assert.strictEqual(g.nivel, 'alto');
  assert.ok(g.motivos.some(m => /Registrado pelo gestor: Link redundante/.test(m.texto)));
});

test('risco geral é o pior dos 4 eixos, e o resumo cita cada um', () => {
  const { db, contrato } = cenario({ contrato: { responsavel: '(a definir)' }, mapa: { conteudo: { nivel: 'baixo', findings: [] } } });
  const r = riscoAtualDoContrato(db, contrato);
  assert.strictEqual(r.nivel, 'alto');
  assert.match(r.resumo, /Gestão Alto: Gestor do contrato não identificado/);
  assert.ok(r.riscos.some(x => x.codigo === 'SEM_GESTOR' && x.eixo === 'gestao'));
});

test('contrato já terminado (066/2020): garantia vencida antes do fim não é "cobrar a renovação" — só registrar o período sem garantia', () => {
  const { db, contrato } = cenario({ contrato: { termino: emDias(-54), garantiaVerificadaEm: '2026-09-28', garantiaDocumentos: 1,
    garantiaLida: { arquivo: 'Apolice 066_2020.pdf', inicio: '2023-08-06', fim: emDias(-784), citacao: 'vigência de 06/08/2023 a 06/08/2024', porOcr: false } } });
  const f = calcularEixos(db, contrato).financeiro;
  assert.ok(!codigos(f).includes('GARANTIA_VENCIDA'), 'sem "o contrato continua em vigor"');
  const g = f.motivos.find(x => x.codigo === 'GARANTIA_VENCEU_ANTES_DO_FIM');
  assert.strictEqual(g.criterio, 'Aceitar e monitorar');
  assert.match(g.texto, /antes do fim do contrato/);
  assert.match(g.resposta, /pendência com a contratada/);
  // Garantia que cobriu até o fim de um contrato já terminado: nada a apontar.
  const cobriu = cenario({ contrato: { termino: emDias(-54), garantiaVerificadaEm: '2026-09-28', garantiaDocumentos: 1,
    garantiaLida: { arquivo: 'A.pdf', fim: emDias(-54), citacao: 'x' } } });
  assert.ok(!codigos(calcularEixos(cobriu.db, cobriu.contrato).financeiro).some(c => /^GARANTIA_/.test(c)));
});

test('limite de duração com a vigência já terminada: a resposta é regularizar, não "cronograma antes do fim"', () => {
  const { db, contrato } = cenario({ contrato: { termino: emDias(-54) }, proposta: { calculoVigencia: { mesesTotal: 72, termino: emDias(-54), avisos: [] }, regimeLegal: { lei: '8.666' } } });
  const l = calcularEixos(db, contrato).prazo.motivos.find(x => x.codigo === 'LIMITE_VIGENCIA');
  assert.match(l.resposta, /já terminou/);
  assert.doesNotMatch(l.resposta, /antes do fim da vigência atual/);
});

/* ------------------------------------------------------------------
   Filtro "Encerrados" (02/10/2026): Prazo e Financeiro não se aplicam
------------------------------------------------------------------ */
const mapaRisco = require('../integrations/mapaRiscoContratos');

test('encerrado: Prazo e Financeiro "não se aplica"; o risco é o pior entre Conteúdo e Gestão', async () => {
  // Vencido há um ano e sem gestor: no ativo seria Alto pelo prazo; no encerrado, só a gestão pesa.
  const { db, contrato } = cenario({ contrato: { status: 'Encerrado', termino: emDias(-365), responsavel: null } });
  const r = await mapaRisco.gerarMapaRisco(db, () => {}, l => l.length + 1, contrato.id, 'Teste', { soCache: true });
  assert.strictEqual(r.encerrado, true);
  assert.strictEqual(r.prazo.naoSeAplica, true);
  assert.strictEqual(r.prazo.nivelLabel, 'Não se aplica');
  assert.strictEqual(r.financeiro.nivelLabel, 'Não se aplica');
  assert.strictEqual(r.riscoGeral, r.gestao.nivel, 'sem arquivo, o conteúdo fica de fora: vale a gestão');
  assert.ok(r.gestao.motivos.some(m => /gestor/i.test(m.titulo || '')), 'gestor não identificado pesa na gestão');
});

test('encerrado fica fora da lista "Em vigência" e entra na lista "Encerrados"', () => {
  const { db } = cenario({ contrato: { status: 'Encerrado', termino: emDias(-30), arquivoOrigem: 'F:\\x\\P.A. 1\\3. Contratos\\Contrato.pdf' },
    mapa: { riscoGeral: 'alto', conteudo: { nivel: 'medio', findings: [] }, checklist: [{ id: 'reajuste', situacao: 'falha' }, { id: 'pagamento', situacao: 'atende' }] } });
  assert.strictEqual(mapaRisco.listarElegiveisComUltimoMapa(db).length, 0);
  const [e] = mapaRisco.listarEncerradosComUltimoMapa(db);
  assert.strictEqual(e.encerrado, true);
  assert.strictEqual(e.eixosAtuais.prazo.naoSeAplica, true);
  assert.strictEqual(e.riscoAtual.nivel, 'medio', 'o pior entre Conteúdo (médio) e Gestão (baixo) — não o "alto" antigo, que vinha do prazo');
  assert.strictEqual(e.paraConferencia, 1);
  assert.strictEqual(riscoAtualDoContrato(db, db.contratos[0]).encerrado, true, 'Painel e Contratos continuam mostrando "Encerrado"');
});
