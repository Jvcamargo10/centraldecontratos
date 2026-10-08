/* ===================================================================
   integrations/listaTermos.js

   Telas "Aditivos" e "Apostilamentos" (07/10/2026), no mesmo formato da
   tela de Contratos e com os campos do formulário "Cadastrar" do SGC:
     - termo: número, tipo, data, objeto, contrato, IOM, portaria;
     - vigência: meses prorrogados e a nova data de término;
     - valores: valor do termo e o valor mensal do contrato;
     - gestor e suplente (termos de gestão; data de designação = data do termo);
     - arquivo: o documento lido.

   Fonte: o cadastro da Central (db.aditivos / db.apostilamentos), gravado
   quando a proposta do contrato é aprovada na Fila de importação. Termos
   só lidos (proposta ainda pendente) não entram — a mesma regra da tela
   de Contratos; aparecem só como contagem, para quem quiser revisá-los.

   IOM e portaria: a Central não lê esses números dos documentos — ficam
   vazios (o mesmo motivo de ficarem fora da ficha do SGC).

   A "data" é a da ASSINATURA do termo (o fecho "Itaverde, 14 de janeiro de
   2025"); no SGC o campo é a data do EXTRATO publicado, que costuma vir
   alguns dias depois.

   Só leitura: não escreve nada e não chama rede.
=================================================================== */

const fichasSgc = require('./fichasSgc');
const baseTermos = require('./baseTermos');

const ESPECIES = {
  aditivos: { lista: 'aditivos', rotulo: 'Aditivo', especieBase: 'Aditivo', ficha: 'aditivo' },
  apostilamentos: { lista: 'apostilamentos', rotulo: 'Apostilamento', especieBase: 'Apostilamento', ficha: 'apostilamento' }
};

const vazio = v => v === undefined || v === null || v === '';

/* Agrupa e conta, do maior para o menor (empate: ordem alfabética). */
function contar(itens, chave) {
  const m = new Map();
  for (const i of itens) {
    const k = chave(i);
    if (vazio(k)) continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].map(([nome, n]) => ({ nome, n }))
    .sort((a, b) => b.n - a.n || String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
}

function montarItem(db, t, cfg, contratosPorId) {
  const c = contratosPorId.get(String(t.contratoId)) || null;
  const encerrado = c ? c.status === 'Encerrado' : null;
  return {
    id: t.id,
    especie: cfg.ficha,
    // A aprovação grava "(sem número)" quando o número não foi lido: é vazio.
    numero: t.numero && !/^\(sem n/i.test(t.numero) ? t.numero : null,
    tipo: t.tipo ? String(t.tipo).trim() : null,
    data: t.data || null,
    objeto: t.objeto || null,
    contrato: t.contrato || (c && c.numero) || null,
    contratoId: t.contratoId ?? (c ? c.id : null),
    empresa: t.empresa || (c && c.empresa) || null,
    // Situação do CONTRATO do termo (o termo em si não vence).
    situacaoContrato: c ? (encerrado ? 'encerrado' : 'vigente') : 'sem_contrato',
    iom: t.iom || null,
    portaria: t.portaria || null,
    meses: vazio(t.meses) ? null : Number(t.meses),
    novoTermino: t.meses ? fichasSgc._paraTeste.novoTerminoDoTermo(db, t) : null,
    valor: vazio(t.valor) ? null : Number(t.valor),
    valorMensalContrato: c && !vazio(c.valor) ? Number(c.valor) : null,
    terminoContrato: c ? c.termino || null : null,
    gestor: t.gestor || null,
    suplente: t.suplente || null,
    documento: t.documento || null,
    origem: t.origemExterna ? 'SGC' : (t.origem === 'documento' ? 'Documento' : 'Cadastro'),
    propostaId: t.propostaId || null,
    lidoEm: t.lidoEm || null
  };
}

function listar(db, qual) {
  const cfg = ESPECIES[qual];
  if (!cfg) return null;
  const contratosPorId = new Map((db.contratos || []).map(c => [String(c.id), c]));
  const itens = (db[cfg.lista] || []).map(t => montarItem(db, t, cfg, contratosPorId));

  // Mais recentes primeiro; sem data, pelo número do contrato.
  itens.sort((a, b) => String(b.data || '').localeCompare(String(a.data || ''))
    || String(b.contrato || '').localeCompare(String(a.contrato || '')));

  // Termos lidos de propostas ainda pendentes na Fila (não entram na lista).
  const pendentesNaFila = baseTermos.montarBase(db).linhas
    .filter(l => l.situacao === 'pendente' && l.valores.especie === cfg.especieBase).length;

  const vigentes = itens.filter(i => i.situacaoContrato === 'vigente');
  const porEmpresaVigente = contar(vigentes, i => i.empresa);
  return {
    especie: cfg.ficha,
    rotulo: cfg.rotulo,
    itens,
    totais: {
      total: itens.length,
      deContratosVigentes: vigentes.length,
      contratos: new Set(itens.map(i => i.contratoId).filter(x => x != null)).size,
      comPrazo: itens.filter(i => i.meses).length,
      comValor: itens.filter(i => i.valor != null).length,
      comGestao: itens.filter(i => i.gestor || i.suplente).length,
      semData: itens.filter(i => !i.data).length,
      pendentesNaFila,
      porTipo: contar(itens, i => i.tipo),
      porContrato: contar(itens, i => i.contrato),
      porAno: contar(itens, i => i.data ? i.data.slice(0, 4) : null).sort((a, b) => String(b.nome).localeCompare(String(a.nome))),
      empresaMaisTermosVigentes: porEmpresaVigente[0] || null
    }
  };
}

module.exports = { ESPECIES, listar };
