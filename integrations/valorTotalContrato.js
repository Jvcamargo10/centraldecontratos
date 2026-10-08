/* ===================================================================
   integrations/valorTotalContrato.js

   Valor TOTAL do contrato (07/10/2026): o numerador da regra da média
   mensal do SGC (ver valorContratual.js) —

     valor total = valor inicial + termos de valor (prorrogações com o
                   valor do novo período, acréscimos, supressões negativas)
     média mensal = valor total ÷ (meses iniciais + meses prorrogados)

   Sai do cálculo guardado na proposta (`calculoValor`): o valor inicial e
   os termos que ENTRARAM na conta (os que ficaram fora não estão na
   lista). Assim o total nunca diverge da média mostrada.

   Só vale quando a média desse cálculo é o valor mensal gravado no
   contrato: se alguém informou o valor mensal à mão (Pendências de
   leitura) ou a aprovação manteve outro valor, o total desta conta não é
   o do contrato — fica em branco, em vez de mostrar um número que não
   fecha com o valor mensal.

   Só leitura: não escreve nada e não chama rede.
=================================================================== */

const arredondar = v => Math.round(v * 100) / 100;

/* Do cálculo de uma proposta: { valor, meses, mediaMensal } ou null. */
function doCalculo(calc) {
  if (!calc || calc.valorInicial == null || !Number(calc.mesesIniciais)) return null;
  const termos = Array.isArray(calc.aditivos) ? calc.aditivos : [];
  const valor = arredondar(Number(calc.valorInicial) + termos.reduce((s, a) => s + (Number(a.valor) || 0), 0));
  const meses = Number(calc.mesesIniciais) + termos.reduce((s, a) => s + (Number(a.meses) || 0), 0);
  if (!(meses > 0)) return null;
  return { valor, meses, mediaMensal: arredondar(valor / meses) };
}

/* A proposta aprovada mais recente do contrato (é a que gravou o cadastro). */
function propostaAprovada(db, contratoId) {
  return (db.importacoesPendentes || [])
    .filter(p => p.status === 'aprovado' && String(p.contratoId) === String(contratoId))
    .sort((a, b) => String(b.aprovadoEm || '').localeCompare(String(a.aprovadoEm || '')) || (Number(b.id) - Number(a.id)))[0] || null;
}

/* Confere com o valor mensal: diferença de até 2 centavos é arredondamento. */
const fechaComOMensal = (r, mensal) => r && mensal != null && mensal !== '' && Math.abs(r.mediaMensal - Number(mensal)) <= 0.02;

function doContrato(db, contrato, proposta) {
  if (!contrato) return null;
  const p = proposta || propostaAprovada(db, contrato.id);
  const r = p ? doCalculo(p.calculoValor) : null;
  return fechaComOMensal(r, contrato.valor) ? { valor: r.valor, meses: r.meses } : null;
}

/* { [contratoId]: { valor, meses } } — só os contratos com total conhecido. */
function porContrato(db) {
  const out = {};
  for (const c of db.contratos || []) {
    const r = doContrato(db, c);
    if (r) out[c.id] = r;
  }
  return out;
}

/* Proposta ainda pendente: o total da leitura, conferido com o valor mensal lido. */
function daProposta(p) {
  const r = doCalculo(p && p.calculoValor);
  return fechaComOMensal(r, p && p.campos && p.campos.valor) ? { valor: r.valor, meses: r.meses } : null;
}

module.exports = { doCalculo, doContrato, porContrato, daProposta, propostaAprovada };
