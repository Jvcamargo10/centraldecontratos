/* ===================================================================
   integrations/ufm.js

   UFM e gratificação dos gestores de contrato (GFE — Gratificação por
   Função Extraordinária), 06/10/2026. Reproduz a planilha "Planilha
   cálculo de pag. GFE - Gestores de Contratos" (abas GERAL e Calculo):

     valor mensal do contrato = (contrato + aditivos) ÷ meses de vigência
                                (o mesmo valor mensal que a Central já
                                calcula para cada contrato)
     valor em UFM            = valor mensal ÷ valor da UFM
     gratificação (R$)        = a da faixa em que o valor em UFM cai

   Faixas como na fórmula da planilha (aba GERAL, coluna M):
     SE(UFM < 4.001; faixa 1; SE(UFM < 20.001; faixa 2;
     SE(UFM < 80.001; faixa 3; faixa 4)))
   — guardadas como "até" (4.000, 20.000, 80.000 e sem limite): o
   contrato fica na primeira faixa em que UFM < até + 1.

   TABELA COM HISTÓRICO: o valor da UFM muda (decreto municipal) e a
   tabela de faixas pode mudar. Cada mudança é uma VERSÃO nova, com a data
   em que passa a valer, o ato que a fundamenta, quem registrou e quando.
   Nada se apaga. Vale, em cada data, a versão com a maior "vigente desde"
   até aquela data; se duas têm a mesma data, vale a registrada por último
   (é assim que se corrige um lançamento errado sem apagar o anterior).
=================================================================== */
const { hojeLocal } = require('./dataLocal');

/* Tabela da aba "Calculo" da planilha (UFM em B1; faixas em A4:D7). */
const VERSAO_INICIAL = {
  id: 1,
  vigenteDesde: null, // sem data: é o ponto de partida (vale até a primeira alteração)
  valorUfm: 5,
  faixas: [
    { ate: 4000, percentual: 5, valor: 150, limiteContratos: 10 },
    { ate: 20000, percentual: 12.5, valor: 390, limiteContratos: 8 },
    { ate: 80000, percentual: 25, valor: 750, limiteContratos: 4 },
    { ate: null, percentual: 50, valor: 1500, limiteContratos: 2 }
  ],
  fundamento: 'Planilha "cálculo de pag. GFE - Gestores de Contratos", aba Calculo',
  observacao: 'Valores trazidos da planilha usada até a criação desta tela.',
  registradoPor: 'Sistema', registradoEm: null
};

function garantirTabela(db) {
  if (!db.ufm || !Array.isArray(db.ufm.versoes) || !db.ufm.versoes.length) {
    db.ufm = { versoes: [{ ...VERSAO_INICIAL, faixas: VERSAO_INICIAL.faixas.map(f => ({ ...f })), registradoEm: new Date().toISOString() }] };
    return true;
  }
  return false;
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;
/* Número digitado: aceita "12,5", "12.5", "1.500,00" e "4.381" (milhar). */
function decimal(x) {
  if (x === '' || x == null) return null;
  if (typeof x === 'number') return x;
  let t = String(x).trim();
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}
const ordemVigencia = (a, b) => String(a.vigenteDesde || '').localeCompare(String(b.vigenteDesde || '')) || (a.id - b.id);

/* Versão que vale numa data (padrão: hoje). */
function versaoEm(db, data = hojeLocal()) {
  const versoes = ((db.ufm && db.ufm.versoes) || []).slice().sort(ordemVigencia);
  let vale = null;
  for (const v of versoes) if (!v.vigenteDesde || v.vigenteDesde <= data) vale = v;
  return vale || versoes[0] || VERSAO_INICIAL;
}

function faixaDe(versao, ufm) {
  const i = versao.faixas.findIndex(f => f.ate == null || ufm < f.ate + 1);
  return i < 0 ? versao.faixas.length - 1 : i;
}

/* Cálculo de um contrato com uma versão da tabela. */
function calcular(contrato, versao) {
  const mensal = Number(contrato && contrato.valor);
  if (!Number.isFinite(mensal) || mensal <= 0) return { semValor: true };
  const ufm = mensal / versao.valorUfm;
  const i = faixaDe(versao, ufm);
  return { valorMensal: mensal, valorEmUfm: ufm, faixa: i + 1, gratificacao: versao.faixas[i].valor };
}

const rotuloFaixa = (versao, i) => {
  const f = versao.faixas[i], antes = i > 0 ? versao.faixas[i - 1].ate + 1 : null;
  const n = x => x.toLocaleString('pt-BR');
  return f.ate == null ? `acima de ${n(versao.faixas[i - 1].ate)}` : antes == null ? `até ${n(f.ate)}` : `${n(antes)} a ${n(f.ate)}`;
};

/* A planilha tem a coluna "%" ao lado do valor; os valores são digitados.
   Se um valor não bate com o % da mesma base das outras faixas, avisa
   (na tabela de exemplo: 390,00 é 13% de 3.000,00, não 12,5%). */
function conferirPercentuais(versao) {
  const bases = versao.faixas.filter(f => f.percentual > 0).map(f => f.valor / (f.percentual / 100));
  if (bases.length < 2) return [];
  const contagem = {};
  for (const b of bases) { const k = b.toFixed(2); contagem[k] = (contagem[k] || 0) + 1; }
  const base = Number(Object.entries(contagem).sort((a, b) => b[1] - a[1])[0][0]);
  const reais = n => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const devido = f => Math.round(base * f.percentual) / 100; // centavos arredondados (406,575 → 406,58)
  return versao.faixas.map((f, i) => ({ f, i })).filter(({ f }) => f.percentual > 0 && Math.abs(f.valor - devido(f)) > 0.01)
    .map(({ f, i }) => `Faixa ${i + 1} (${rotuloFaixa(versao, i)} UFM): R$ ${reais(f.valor)} não é ${String(f.percentual).replace('.', ',')}% de R$ ${reais(base)} (a base das outras faixas) — seria R$ ${reais(devido(f))}. O cálculo usa o valor em reais, como a planilha.`);
}

/* A tela: tabela vigente, contratos, resumo por gestor e o histórico. */
function montar(db, hoje = hojeLocal()) {
  const versao = versaoEm(db, hoje);
  const linhas = (db.contratos || []).map(c => ({
    id: c.id, numero: c.numero, empresa: c.empresa, gestor: c.responsavel || '', suplente: c.suplente || '',
    status: c.status, encerrado: c.status === 'Encerrado', termino: c.termino || null, ...calcular(c, versao)
  }));
  // Mesmo gestor com o nome lido com e sem acento ou em maiúsculas ("Antônio"/"Antonio") vira uma linha só.
  const chaveNome = n => String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/s+/g, ' ').trim();
  const gestores = {};
  for (const l of linhas.filter(x => !x.encerrado && !x.semValor)) {
    const k = chaveNome(l.gestor) || '(sem gestor)';
    const g = gestores[k] = gestores[k] || { gestor: (l.gestor || '').trim() || '(sem gestor)', contratos: 0, porFaixa: versao.faixas.map(() => 0), total: 0 };
    // Entre as grafias, mostra a acentuada ("Antônio" no lugar de "Antonio").
    const acentos = n => (String(n || '').normalize('NFD').match(/[̀-ͯ]/g) || []).length;
    if (acentos(l.gestor) > acentos(g.gestor)) g.gestor = l.gestor.trim();
    g.contratos++; g.porFaixa[l.faixa - 1]++; g.total += l.gratificacao;
  }
  const porGestor = Object.values(gestores).map(g => ({
    ...g, total: Math.round(g.total * 100) / 100,
    acimaDoLimite: g.porFaixa.map((n, i) => (versao.faixas[i].limiteContratos && n > versao.faixas[i].limiteContratos) ? i + 1 : null).filter(Boolean)
  })).sort((a, b) => b.total - a.total || a.gestor.localeCompare(b.gestor));
  const versoes = ((db.ufm && db.ufm.versoes) || []).slice().sort(ordemVigencia).reverse()
    .map(v => ({ ...v, situacao: v.id === versao.id ? 'vigente' : (v.vigenteDesde && v.vigenteDesde > hoje) ? 'agendada' : 'anterior' }));
  return {
    hoje, versao: { ...versao, rotulos: versao.faixas.map((_, i) => rotuloFaixa(versao, i)) },
    avisos: conferirPercentuais(versao), linhas, porGestor, versoes
  };
}

/* Nova versão da tabela (alteração do valor da UFM e/ou das faixas). */
function registrarVersao(db, dados, autor, agora = new Date().toISOString()) {
  garantirTabela(db);
  const d = dados || {};
  const valorUfm = decimal(d.valorUfm);
  if (!Number.isFinite(valorUfm) || valorUfm <= 0 || valorUfm > 1000) return { erro: 'Informe o valor da UFM em reais (ex.: 5,0000).' };
  const vigenteDesde = String(d.vigenteDesde || '').trim();
  if (!DATA.test(vigenteDesde) || isNaN(new Date(`${vigenteDesde}T12:00:00`))) return { erro: 'Informe a data a partir da qual o novo valor vale.' };
  const fundamento = String(d.fundamento || '').trim().slice(0, 300);
  if (!fundamento) return { erro: 'Informe o ato que fundamenta a alteração (ex.: Decreto nº ..., de ...).' };
  const atual = versaoEm(db, vigenteDesde);
  const brutas = Array.isArray(d.faixas) && d.faixas.length ? d.faixas : atual.faixas;
  const faixas = brutas.map((f, i) => ({
    ate: i === brutas.length - 1 ? null : decimal(f.ate),
    percentual: decimal(f.percentual) || 0,
    valor: Math.round(decimal(f.valor) * 100) / 100,
    limiteContratos: decimal(f.limiteContratos) || null
  }));
  if (faixas.length < 2 || faixas.length > 10) return { erro: 'A tabela precisa ter de 2 a 10 faixas.' };
  for (let i = 0; i < faixas.length; i++) {
    const f = faixas[i];
    if (i < faixas.length - 1 && !(Number.isInteger(f.ate) && f.ate > 0)) return { erro: `Faixa ${i + 1}: o limite "até" precisa ser um número inteiro de UFM.` };
    if (i > 0 && i < faixas.length - 1 && f.ate <= faixas[i - 1].ate) return { erro: `Faixa ${i + 1}: o limite precisa ser maior que o da faixa anterior.` };
    if (!(f.valor > 0)) return { erro: `Faixa ${i + 1}: informe o valor da gratificação em reais.` };
  }
  const versao = {
    id: db.ufm.versoes.reduce((m, v) => Math.max(m, v.id), 0) + 1,
    vigenteDesde, valorUfm: Math.round(valorUfm * 10000) / 10000, faixas, fundamento,
    observacao: String(d.observacao || '').trim().slice(0, 500), registradoPor: autor, registradoEm: agora
  };
  db.ufm.versoes.push(versao);
  return { versao };
}

/* Planilha da tela (para a folha de pagamento / conferência). */
function gerarCsv(tela) {
  const { montar: montarCsv } = require('./planilhaCsv');
  const v = tela.versao;
  const br = (n, casas = 2) => n == null ? '' : n.toFixed(casas).replace('.', ',');
  const cab = ['Contrato', 'Empresa', 'Gestor', 'Suplente', 'Situação', 'Valor mensal (R$)', `Valor em UFM (UFM = R$ ${br(v.valorUfm, 4)})`, 'Faixa', 'Gratificação por contrato (R$)'];
  const linhas = tela.linhas.map(l => [l.numero, l.empresa, l.gestor, l.suplente, l.encerrado ? 'Encerrado' : (l.status || ''),
    l.semValor ? '' : br(l.valorMensal), l.semValor ? 'sem valor mensal' : br(l.valorEmUfm, 1), l.semValor ? '' : `${l.faixa} (${v.rotulos[l.faixa - 1]})`, l.semValor ? '' : br(l.gratificacao)]);
  return montarCsv(cab, linhas);
}

module.exports = { VERSAO_INICIAL, garantirTabela, versaoEm, faixaDe, calcular, conferirPercentuais, montar, registrarVersao, gerarCsv };
