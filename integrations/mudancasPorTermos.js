/* ===================================================================
   integrations/mudancasPorTermos.js

   Mudança no contrato vinda de um termo novo (07/10/2026). O término, o
   valor mensal e o gestor/suplente de um contrato aprovado são gravados na
   aprovação. Duas coisas podem mudá-los depois, e as duas viram PENDÊNCIA
   em Pendências de leitura — o cadastro só muda quando alguém confirma:

     1. termo novo arquivado na pasta (prorrogação, acréscimo, apostilamento
        de gestão): a varredura cria uma proposta nova para o contrato; a
        pendência mostra o que a aprovação vai mudar e leva à Fila;
     2. o "Recalcular pelas regras" (regra de leitura melhorada) relê os
        documentos do contrato aprovado e o resultado difere do cadastro:
        confirmar ou descartar campo a campo (o mesmo modelo do termo de
        encerramento).

   Não sugere:
     - apagar dado: releitura que não achou o campo não vira pendência;
     - trocar dado informado à mão (procedência "manual"): quem conferiu
       na fonte assumiu a informação;
     - de novo o que já foi descartado com o mesmo valor;
     - nada em contrato encerrado.

   Funções puras (sem disco e sem rede): quem relê os documentos é
   ingestaoContratos.recalcularPropostasPendentes.
=================================================================== */

const CAMPOS = {
  termino: { rotulo: 'Término', tipo: 'data' },
  valor: { rotulo: 'Valor mensal', tipo: 'valor' },
  responsavel: { rotulo: 'Gestor', tipo: 'texto' },
  suplente: { rotulo: 'Suplente', tipo: 'texto' }
};

const vazio = v => v === undefined || v === null || v === '';
const normalizar = s => String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

function diferente(campo, a, b) {
  if (vazio(a) || vazio(b)) return vazio(a) !== vazio(b);
  const tipo = (CAMPOS[campo] || {}).tipo;
  if (tipo === 'valor') return Math.abs(Number(a) - Number(b)) > 0.02;
  if (tipo === 'texto') return normalizar(a) !== normalizar(b);
  return String(a) !== String(b);
}

/* De onde veio a mudança, em uma frase (e o documento, quando se sabe). */
function motivoDe(campo, lido) {
  if (campo === 'termino') {
    const per = ((lido.calculoVigencia && lido.calculoVigencia.periodos) || []).filter(p => /^termo/i.test(String(p.origem || '')));
    const ultimo = per[per.length - 1];
    if (ultimo) return { texto: `prorrogação pelo ${ultimo.origem} (${ultimo.meses} meses)`, documento: (String(ultimo.base || '').match(/\(([^()]+)\)\s*$/) || [])[1] || null };
    return { texto: (lido.calculoVigencia && lido.calculoVigencia.memoria) || 'vigência recalculada pelos documentos', documento: null };
  }
  if (campo === 'valor') return { texto: (lido.calculoValor && lido.calculoValor.memoria) ? `média mensal: ${lido.calculoValor.memoria}` : 'valor mensal recalculado pelos documentos', documento: null };
  const doc = (lido.origemRegra || {})[campo];
  return { texto: campo === 'responsavel' ? 'gestor no ato de gestão mais recente' : 'suplente no ato de gestão mais recente', documento: typeof doc === 'string' ? doc : null };
}

/* Compara o que a releitura deu (`lido`: { campos, calculoValor,
   calculoVigencia, origemRegra }) com o cadastro e grava em
   contrato.mudancasDetectadas a lista atual. Devolve só as NOVAS. */
function detectar(contrato, proposta, lido, agora) {
  if (!contrato) return [];
  const antes = contrato.mudancasDetectadas || [];
  if (contrato.status === 'Encerrado' || !lido || !lido.campos) {
    delete contrato.mudancasDetectadas;
    return [];
  }
  const proc = (proposta && proposta.procedencia) || {};
  const descartadas = contrato.mudancasDescartadas || [];
  const lista = [];
  for (const campo of Object.keys(CAMPOS)) {
    const para = lido.campos[campo];
    if (vazio(para) || proc[campo] === 'manual') continue;
    if (!diferente(campo, contrato[campo], para)) continue;
    if (descartadas.some(d => d.campo === campo && !diferente(campo, d.para, para))) continue;
    const mesma = antes.find(m => m.campo === campo && !diferente(campo, m.para, para));
    const motivo = motivoDe(campo, lido);
    lista.push({
      campo, rotulo: CAMPOS[campo].rotulo, de: vazio(contrato[campo]) ? null : contrato[campo], para,
      motivo: motivo.texto, documento: motivo.documento,
      // O cálculo que acompanha a mudança: na confirmação, a proposta passa
      // a guardá-lo (a tela de Aditivos e o valor total usam essas contas).
      calculo: campo === 'termino' ? (lido.calculoVigencia || null) : campo === 'valor' ? (lido.calculoValor || null) : null,
      detectadoEm: mesma ? mesma.detectadoEm : agora
    });
  }
  if (lista.length) contrato.mudancasDetectadas = lista; else delete contrato.mudancasDetectadas;
  return lista.filter(m => !antes.some(a => a.campo === m.campo && !diferente(m.campo, a.para, m.para)));
}

/* Termo novo arquivado na pasta de um contrato JÁ cadastrado: a varredura
   lê a pasta de novo e cria uma proposta pendente ligada ao contrato
   (contratoExistenteId). Aprovar essa proposta na Fila é a confirmação —
   aqui só se mostra o que ela vai mudar no contrato. */
function daFila(db) {
  const contratosPorId = new Map((db.contratos || []).map(c => [String(c.id), c]));
  const out = [];
  const vistos = new Set();
  const pendentes = (db.importacoesPendentes || []).filter(p => p.status === 'pendente' && p.contratoExistenteId != null)
    .sort((a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')));
  for (const p of pendentes) {
    const c = contratosPorId.get(String(p.contratoExistenteId));
    if (!c || c.status === 'Encerrado' || vistos.has(String(c.id))) continue;
    vistos.add(String(c.id)); // a proposta mais recente do contrato vale
    const mudancas = Object.keys(CAMPOS)
      .filter(k => !vazio((p.campos || {})[k]) && diferente(k, c[k], p.campos[k]))
      .map(k => ({ campo: k, rotulo: CAMPOS[k].rotulo, tipo: CAMPOS[k].tipo, de: vazio(c[k]) ? null : c[k], para: p.campos[k], documento: ((p.origemRegra || {})[k] && typeof p.origemRegra[k] === 'string') ? p.origemRegra[k] : null }));
    if (mudancas.length) out.push({ contratoId: c.id, numero: c.numero, empresa: c.empresa || null, naFila: true, propostaId: p.id, lidoEm: p.criadoEm || null, mudancas });
  }
  return out;
}

/* Para a tela de Pendências de leitura: as duas origens juntas. */
function listar(db) {
  const doRecalculo = (db.contratos || [])
    .filter(c => c.status !== 'Encerrado' && (c.mudancasDetectadas || []).length)
    .map(c => ({
      contratoId: c.id, numero: c.numero, empresa: c.empresa || null, naFila: false,
      mudancas: c.mudancasDetectadas.map(({ calculo, ...m }) => ({ ...m, tipo: (CAMPOS[m.campo] || {}).tipo }))
    }));
  return [...daFila(db), ...doRecalculo];
}

/* 'confirmar': o cadastro recebe o valor novo (e a proposta aprovada, o
   cálculo que o justifica). 'descartar': não volta a ser sugerido enquanto
   a releitura der o mesmo valor. Devolve o que mudou, para a Auditoria. */
function decidir(db, contratoId, campo, acao, usuarioNome, agora) {
  const c = (db.contratos || []).find(x => String(x.id) === String(contratoId));
  if (!c) throw new Error('Contrato não encontrado.');
  const m = (c.mudancasDetectadas || []).find(x => x.campo === campo);
  if (!m) throw new Error('Não há mudança pendente deste campo para este contrato.');
  const quem = usuarioNome || 'Usuário';
  if (acao === 'confirmar') {
    c[campo] = m.para;
    const p = (db.importacoesPendentes || [])
      .filter(x => x.status === 'aprovado' && String(x.contratoId) === String(c.id))
      .sort((a, b) => String(b.aprovadoEm || '').localeCompare(String(a.aprovadoEm || '')))[0];
    if (p && m.calculo) p[campo === 'termino' ? 'calculoVigencia' : 'calculoValor'] = m.calculo;
    if (p) { p.campos = p.campos || {}; p.campos[campo] = m.para; }
    c.mudancasConfirmadas = [...(c.mudancasConfirmadas || []), { campo, de: m.de, para: m.para, motivo: m.motivo, documento: m.documento, por: quem, em: agora }];
  } else if (acao === 'descartar') {
    c.mudancasDescartadas = [...(c.mudancasDescartadas || []).filter(d => d.campo !== campo), { campo, para: m.para, por: quem, em: agora }];
  } else {
    throw new Error('Ação inválida — use "confirmar" ou "descartar".');
  }
  c.mudancasDetectadas = c.mudancasDetectadas.filter(x => x.campo !== campo);
  if (!c.mudancasDetectadas.length) delete c.mudancasDetectadas;
  return { numero: c.numero, campo, rotulo: m.rotulo, de: m.de, para: m.para, motivo: m.motivo, documento: m.documento, acao };
}

module.exports = { CAMPOS, detectar, listar, decidir, _paraTeste: { diferente, motivoDe, daFila } };
