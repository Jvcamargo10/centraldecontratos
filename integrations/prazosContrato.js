/* ===================================================================
   integrations/prazosContrato.js

   Criticidade individual de cada contrato (06/10/2026, sugestão da
   gestão): cada contrato tem trâmites diferentes na Prefeitura — uma
   prorrogação por aditivo leva um tempo, uma nova licitação leva muito
   mais —, então "crítico a 15 dias do fim" não serve para todos.

   - Perfis de trâmite (Alertas de vencimento): cada perfil tem os três
     prazos (crítico / atenção / próximo, em dias antes do término). O
     perfil "Padrão" é o de sempre (db.alertaConfig).
   - Cada contrato usa o Padrão, um perfil, ou prazos próprios — sempre
     com quem escolheu, quando e por quê (e na Auditoria).
   - faixasDoContrato() é a ÚNICA fonte dos prazos de um contrato: tela
     (classificação), e-mail de alertas e Registro de riscos (eixo Prazo
     do Mapa) usam a mesma resposta.
=================================================================== */
const PADRAO_INICIAL = { critico: 15, atencao: 30, proximo: 90 };
const MAX_DIAS = 3650;

function validarFaixas(dados) {
  const nums = ['critico', 'atencao', 'proximo'].map(k => Number(dados && dados[k]));
  if (nums.some(n => !Number.isInteger(n) || n <= 0 || n > MAX_DIAS)) return { erro: `Os prazos precisam ser números inteiros de 1 a ${MAX_DIAS} dias.` };
  if (!(nums[0] < nums[1] && nums[1] < nums[2])) return { erro: 'Os prazos precisam estar em ordem crescente (crítico < atenção < próximo).' };
  return { faixas: { critico: nums[0], atencao: nums[1], proximo: nums[2] } };
}

const padraoDe = db => ({ ...PADRAO_INICIAL, ...(db.alertaConfig || {}) });

function listarPerfis(db) {
  const usos = {};
  for (const p of Object.values(db.prazosContrato || {})) if (p && p.perfilId) usos[p.perfilId] = (usos[p.perfilId] || 0) + 1;
  const ativos = new Set((db.contratos || []).map(c => String(c.id)));
  const proprios = Object.entries(db.prazosContrato || {}).filter(([id, p]) => p && p.proprio && ativos.has(id)).length;
  const padrao = padraoDe(db);
  return {
    perfis: [
      { id: 'padrao', nome: 'Padrão', descricao: 'Vale para todo contrato sem perfil escolhido.', critico: padrao.critico, atencao: padrao.atencao, proximo: padrao.proximo, padrao: true,
        contratos: (db.contratos || []).length - Object.values(db.prazosContrato || {}).filter(p => p && (p.perfilId || p.proprio)).length },
      ...(db.perfisPrazo || []).map(p => ({ ...p, contratos: usos[p.id] || 0 }))
    ],
    contratosComPrazoProprio: proprios
  };
}

/* Prazos que valem para o contrato agora. */
function faixasDoContrato(db, contratoId) {
  const escolha = (db.prazosContrato || {})[String(contratoId)];
  const padrao = padraoDe(db);
  const base = { critico: padrao.critico, atencao: padrao.atencao, proximo: padrao.proximo, origem: 'padrao', nome: 'Padrão' };
  if (!escolha) return base;
  const extra = { motivo: escolha.motivo || '', definidoPor: escolha.por || '', definidoEm: escolha.em || '' };
  if (escolha.proprio) return { ...escolha.proprio, origem: 'proprio', nome: 'Prazos próprios', ...extra };
  const perfil = (db.perfisPrazo || []).find(p => p.id === escolha.perfilId);
  if (!perfil) return base; // perfil excluído: volta ao Padrão
  return { critico: perfil.critico, atencao: perfil.atencao, proximo: perfil.proximo, origem: 'perfil', perfilId: perfil.id, nome: perfil.nome, ...extra };
}

/* Só os contratos que NÃO estão no Padrão (o cliente usa o Padrão para os demais). */
function faixasForaDoPadrao(db) {
  const saida = {};
  for (const id of Object.keys(db.prazosContrato || {})) {
    const f = faixasDoContrato(db, id);
    if (f.origem !== 'padrao') saida[id] = f;
  }
  return saida;
}

function nomeValido(nome) {
  const n = String(nome || '').trim();
  if (n.length < 2 || n.length > 60) return { erro: 'Dê um nome ao perfil (2 a 60 caracteres).' };
  return { nome: n };
}

function criarPerfil(db, dados) {
  const n = nomeValido(dados && dados.nome); if (n.erro) return n;
  const f = validarFaixas(dados); if (f.erro) return f;
  db.perfisPrazo = db.perfisPrazo || [];
  if (n.nome.toLowerCase() === 'padrão' || db.perfisPrazo.some(p => p.nome.toLowerCase() === n.nome.toLowerCase())) return { erro: 'Já existe um perfil com esse nome.' };
  const numero = db.perfisPrazo.reduce((m, p) => Math.max(m, Number(String(p.id).slice(1)) || 0), 0) + 1;
  const perfil = { id: `p${numero}`, nome: n.nome, descricao: String((dados && dados.descricao) || '').trim().slice(0, 200), ...f.faixas };
  db.perfisPrazo.push(perfil);
  return { perfil };
}

function atualizarPerfil(db, id, dados) {
  if (id === 'padrao') {
    const f = validarFaixas(dados); if (f.erro) return f;
    db.alertaConfig = f.faixas;
    return { perfil: { id: 'padrao', nome: 'Padrão', ...f.faixas } };
  }
  const perfil = (db.perfisPrazo || []).find(p => p.id === id);
  if (!perfil) return { erro: 'Perfil não encontrado.', status: 404 };
  const n = nomeValido(dados && dados.nome); if (n.erro) return n;
  const f = validarFaixas(dados); if (f.erro) return f;
  if (n.nome.toLowerCase() === 'padrão' || db.perfisPrazo.some(p => p.id !== id && p.nome.toLowerCase() === n.nome.toLowerCase())) return { erro: 'Já existe um perfil com esse nome.' };
  Object.assign(perfil, { nome: n.nome, descricao: String((dados && dados.descricao) || '').trim().slice(0, 200), ...f.faixas });
  return { perfil };
}

/* Perfil em uso não é excluído: os contratos dele mudariam de prazo sem
   ninguém decidir. Primeiro se passa esses contratos para outro perfil. */
function excluirPerfil(db, id) {
  if (id === 'padrao') return { erro: 'O perfil Padrão não pode ser excluído.' };
  const perfil = (db.perfisPrazo || []).find(p => p.id === id);
  if (!perfil) return { erro: 'Perfil não encontrado.', status: 404 };
  const emUso = Object.values(db.prazosContrato || {}).filter(p => p && p.perfilId === id).length;
  if (emUso) return { erro: `O perfil "${perfil.nome}" está em uso por ${emUso} contrato(s). Troque o perfil desses contratos antes de excluir.` };
  db.perfisPrazo = db.perfisPrazo.filter(p => p.id !== id);
  return { perfil };
}

/* escolha: { perfilId: 'padrao' | 'pN' | 'proprio', critico, atencao, proximo, motivo } */
function definirDoContrato(db, contratoId, escolha, autor, agoraIso = new Date().toISOString()) {
  const c = (db.contratos || []).find(x => String(x.id) === String(contratoId));
  if (!c) return { erro: 'Contrato não encontrado.', status: 404 };
  const motivo = String((escolha && escolha.motivo) || '').trim().slice(0, 500);
  const perfilId = String((escolha && escolha.perfilId) || 'padrao');
  db.prazosContrato = db.prazosContrato || {};
  if (perfilId === 'padrao') {
    delete db.prazosContrato[String(c.id)];
  } else if (perfilId === 'proprio') {
    const f = validarFaixas(escolha); if (f.erro) return f;
    if (!motivo) return { erro: 'Explique por que este contrato tem prazos próprios (ex.: tempo do trâmite de renovação).' };
    db.prazosContrato[String(c.id)] = { proprio: f.faixas, motivo, por: autor, em: agoraIso };
  } else {
    if (!(db.perfisPrazo || []).some(p => p.id === perfilId)) return { erro: 'Perfil não encontrado.' };
    db.prazosContrato[String(c.id)] = { perfilId, motivo, por: autor, em: agoraIso };
  }
  return { contrato: c, faixas: faixasDoContrato(db, c.id) };
}

module.exports = { validarFaixas, listarPerfis, faixasDoContrato, faixasForaDoPadrao, criarPerfil, atualizarPerfil, excluirPerfil, definirDoContrato, PADRAO_INICIAL };
