/* ===================================================================
   integrations/conferenciaSgc.js

   Conferência do SGC contra os documentos da pasta de rede: para cada
   contrato sincronizado do SGC que tem pasta de processo ("P.A. ..."),
   recalcula a média mensal a partir do contrato e dos termos aditivos
   (regra do SGC — ver valorContratual.js) e diz, quando não bate, o
   PORQUÊ provável:

     - o SGC não considerou um termo — e se esse termo está cadastrado no
       próprio SGC (em "Aditivos"), a média é que ficou desatualizada.
       Caso real: 010/2024, 009/2023 e 108/2024 batem ao centavo sem o
       último acréscimo, que o SGC registra desde 2025/2026;
     - diferença de fator 10, 100... — erro de casa decimal na digitação
       (caso real: 006/2025, 93.250 no SGC para 932.500 nos documentos);
     - as PARCELAS do próprio SGC (valor total, aditivos de valor,
       vigência — guardadas pela sincronização desde 21/09/2026) não
       fecham com a média gravada (096/2025: R$ 26.100.000 em 12 meses e
       média de R$ 2.075,07), ou mostram o que ficou de fora (086/2021);
     - o que sobrar é divergência sem explicação — conferir manualmente.

   Também confere o CNPJ: quantidade de dígitos e dígitos verificadores
   (010/2024 tem 11 dígitos no SGC) e se é o mesmo do documento — com a
   ressalva de matriz/filial (mesma raiz) e de alteração subjetiva
   registrada em aditivo (incorporação da contratada).

   Só lê documento que já está no cache de texto (ver
   extratorDocumento.js, `apenasCache`): abrir a tela nunca dispara OCR.
   Documento ainda não lido aparece como tal — a varredura agendada ou
   `npm run avaliacao:semear-cache` resolvem. Nada aqui altera o SGC nem
   o data.json: é um relatório.
=================================================================== */

const fs = require('fs');
const path = require('path');
const servidorArquivos = require('./servidorArquivos');
const extratorDocumento = require('./extratorDocumento');
const leituraPorRegra = require('./leituraPorRegra');

/* "P.A. 01.275_2025 - ..." e "01.275/2025" -> "01.275/2025". */
function normalizarPa(texto) {
  const m = String(texto || '').match(/(\d{1,2})\.?(\d{3})\s*[_/]\s*(\d{4})/);
  return m ? `${m[1].padStart(2, '0')}.${m[2]}/${m[3]}` : null;
}

/* Pastas de processo ("P.A. ...") nas raízes configuradas — direto na raiz
   ou um nível abaixo: desde 25/09/2026 a raiz é "9. Gestão de Contratos",
   e os processos ficam em "3. ... em Vigência", "4. ... Encerrados" e "5.
   ... Outras Secretarias". */
function processosNaRede() {
  const processos = [];
  const olhar = (pasta, nivel) => {
    let entradas = [];
    try { entradas = fs.readdirSync(pasta, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entradas) {
      if (!e.isDirectory()) continue;
      if (servidorArquivos.ehPastaDeProcesso(e.name)) {
        const pa = normalizarPa(e.name);
        if (pa) processos.push({ nome: e.name, caminho: path.join(pasta, e.name), pa });
      } else if (nivel < 1) olhar(path.join(pasta, e.name), nivel + 1);
    }
  };
  for (const raiz of servidorArquivos._config.pastas) olhar(raiz, 0);
  return processos;
}

/* Documentos da(s) subpasta(s) de contratos do processo — a mesma regra
   da varredura ("3. Contratos, Aditivos e Termos", "2. Contrato e
   Aditivos", uma pasta por contrato...). */
function documentosDoProcesso(caminhoProcesso) {
  let subpastas = [];
  try {
    subpastas = fs.readdirSync(caminhoProcesso, { withFileTypes: true })
      .filter(e => e.isDirectory() && servidorArquivos.ehSubpastaDeContratos(e.name))
      .map(e => path.join(caminhoProcesso, e.name));
  } catch (e) { return []; }
  return subpastas.flatMap(s => servidorArquivos.listarDocumentosDaPasta(s));
}

/* CNPJ: 14 dígitos e os dois verificadores. */
function cnpjValido(cnpj) {
  const d = String(cnpj || '').replace(/\D/g, '');
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const dv = n => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((s, p, i) => s + Number(d[i]) * p, 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}

const fmt = v => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const bate = (a, b) => Math.abs(Number(a) - Number(b)) <= 0.021;
const media = (valor, meses) => Math.round((valor / meses) * 100) / 100;
const dataBr = iso => /^\d{4}-\d{2}-\d{2}/.test(String(iso || '')) ? String(iso).slice(0, 10).split('-').reverse().join('/') : (iso || 'sem data');

/* Termos do SGC (aditivos/apostilamentos cadastrados) deste contrato,
   por número ("268/2025" -> 268). */
function termosNoSgc(db, numeroContrato) {
  const lista = [
    ...(db.aditivos || []).filter(a => a.contrato === numeroContrato).map(a => ({ ...a, especie: 'aditivo' })),
    ...(db.apostilamentos || []).filter(a => a.contrato === numeroContrato).map(a => ({ ...a, especie: 'apostilamento' }))
  ];
  return lista.map(t => ({ ...t, numeroSimples: Number(String(t.numero || '').split('/')[0].replace(/\D/g, '')) }));
}

/* O que as PARCELAS do próprio SGC (valor total, aditivos de valor,
   vigência — ver contratosApi.parcelasDoValorSgc) dizem sobre a média
   registrada. Casos reais que motivaram cada regra:
     - 096/2025: 26.100.000 em 12 meses dá 2.175.000, mas a média
       gravada é 2.075,07 — a média contradiz as parcelas do próprio SGC;
     - 006/2025: 11.190.000 ÷ 93.250 = 120 — dividiu por 120 meses;
     - 086/2021: valor do SGC com 1 aditivo de valor; os documentos têm 3
       prorrogações — as duas mais recentes não entraram. */
function diagnosticarParcelasSgc(sgc, calc) {
  const diagnosticos = [];
  if (!sgc || !(sgc.valorContrato > 0) || !(sgc.valorMediaMensal > 0)) return diagnosticos;

  const mesesImplicitos = sgc.valorContrato / sgc.valorMediaMensal;
  const inteiro = Math.round(mesesImplicitos);
  if (Math.abs(mesesImplicitos - inteiro) > 0.01) {
    const pelaVigencia = sgc.vigenciaMeses > 0 ? ` — com a vigência cadastrada no próprio SGC (${sgc.vigenciaMeses} meses), a média seria R$ ${fmt(sgc.valorContrato / sgc.vigenciaMeses)}` : '';
    diagnosticos.push(`A média gravada no SGC (R$ ${fmt(sgc.valorMediaMensal)}) não corresponde às parcelas do próprio SGC: valor total R$ ${fmt(sgc.valorContrato)}${pelaVigencia}. Provável erro de digitação na média.`);
  } else if (calc.mesesTotal && inteiro !== calc.mesesTotal) {
    const decimal = inteiro % 10 === 0 && [calc.mesesIniciais, calc.mesesTotal].includes(inteiro / 10);
    diagnosticos.push(`O SGC divide R$ ${fmt(sgc.valorContrato)} por ${inteiro} meses; pelos documentos são ${calc.mesesTotal} meses${decimal ? ` — provavelmente ${inteiro / 10} digitado como ${inteiro}` : ''}.`);
  }

  // Termos dos documentos que não aparecem entre os aditivos de valor do SGC.
  if (!sgc.somenteInicial && calc.valorTotal && Math.abs(sgc.valorContrato - calc.valorTotal) > 1) {
    const restantes = [...(sgc.aditivosDeValor || [])];
    const fora = [];
    (calc.aditivos || []).filter(a => a.natureza !== 'reajuste' && a.valor).forEach(a => {
      const i = restantes.findIndex(v => Math.abs(v - a.valor) <= 1);
      if (i >= 0) restantes.splice(i, 1); else fora.push(a);
    });
    if (fora.length) {
      diagnosticos.push(`Termos dos documentos que não estão entre os aditivos de valor do SGC: ${fora.map(a => `${a.termo} (${a.natureza}, R$ ${fmt(a.valor)}${a.meses ? `, ${a.meses} meses` : ''})`).join('; ')}.`);
    }
    const baseSgc = sgc.valorContrato - (sgc.aditivosDeValor || []).reduce((s, v) => s + v, 0);
    if (calc.valorInicial && Math.abs(baseSgc - calc.valorInicial) > 1) {
      const reajustes = (calc.aditivos || []).filter(a => a.natureza === 'reajuste' && a.valor);
      diagnosticos.push(`Valor base no SGC (total menos aditivos de valor): R$ ${fmt(baseSgc)}; contrato original: R$ ${fmt(calc.valorInicial)} (diferença de R$ ${fmt(baseSgc - calc.valorInicial)})` +
        (reajustes.length ? ` — os documentos têm reajuste de R$ ${fmt(reajustes.reduce((s, a) => s + a.valor, 0))} (termo ${reajustes.map(a => a.termo).join(', ')}), que o SGC soma ao valor base.` : '.'));
    }
  } else if (sgc.somenteInicial && (calc.aditivos || []).some(a => a.valor || a.meses)) {
    diagnosticos.push(`No SGC, o valor está marcado como só o inicial (R$ ${fmt(sgc.valorContrato)}); os documentos têm ${calc.aditivos.length} termo(s) que mudam valor ou prazo.`);
  }
  return diagnosticos;
}

/* Por que a média do SGC não bate com a dos documentos. */
function diagnosticarMedia(valorSgc, calc, termosSgc, sgcValores) {
  const r = diagnosticarPorDocumentos(valorSgc, calc, termosSgc);
  const pelasParcelas = diagnosticarParcelasSgc(sgcValores, calc);
  if (!pelasParcelas.length) return r;
  // Com as parcelas do SGC, a divergência deixa de ser "sem explicação".
  const diagnosticos = r.explicado ? [...r.diagnosticos, ...pelasParcelas] : [...pelasParcelas, ...r.diagnosticos.filter(d => !/Sem explicação automática/.test(d))];
  return { explicado: true, diagnosticos };
}

function diagnosticarPorDocumentos(valorSgc, calc, termosSgc) {
  const diagnosticos = [];
  const aditivos = calc.aditivos || [];

  // 1. Algum subconjunto de termos que o SGC não considerou? (o menor)
  if (aditivos.length && aditivos.length <= 8) {
    let melhor = null;
    for (let mascara = 1; mascara < (1 << aditivos.length); mascara++) {
      const fora = aditivos.filter((_, i) => mascara & (1 << i));
      const dentro = aditivos.filter((_, i) => !(mascara & (1 << i)));
      const valor = calc.valorInicial + dentro.reduce((s, a) => s + a.valor, 0);
      const meses = calc.mesesIniciais + dentro.reduce((s, a) => s + a.meses, 0);
      if (meses > 0 && bate(media(valor, meses), valorSgc) && (!melhor || fora.length < melhor.length)) melhor = fora;
    }
    if (melhor) {
      melhor.forEach(a => {
        const noSgc = termosSgc.find(t => t.especie === (a.tipo === 'apostilamento' ? 'apostilamento' : 'aditivo') && t.numeroSimples === Number(a.termo));
        const parcela = `${a.valor ? (a.valor < 0 ? '− R$ ' : '+ R$ ') + fmt(Math.abs(a.valor)) : ''}${a.meses ? `${a.valor ? ', ' : ''}+ ${a.meses} meses` : ''}`;
        diagnosticos.push(noSgc
          ? `A média do SGC não inclui o termo ${a.termo} (${a.natureza}, ${parcela}), embora ele esteja cadastrado no SGC (${noSgc.numero}, "${String(noSgc.tipo || '').trim()}", ${dataBr(noSgc.data)}) — a média mensal ficou desatualizada.`
          : `A média do SGC não inclui o termo ${a.termo} (${a.natureza}, ${parcela}), que também não está cadastrado no SGC.`);
      });
      return { explicado: true, diagnosticos };
    }
  }

  // 2. Casa decimal: o SGC é o valor dos documentos × 10^k.
  const razao = valorSgc / calc.mediaMensal;
  const k = Math.round(Math.log10(razao));
  if (k !== 0 && Math.abs(razao / Math.pow(10, k) - 1) < 0.005) {
    diagnosticos.push(`O valor do SGC (R$ ${fmt(valorSgc)}) é o dos documentos (R$ ${fmt(calc.mediaMensal)}) ${k < 0 ? 'dividido' : 'multiplicado'} por ${Math.pow(10, Math.abs(k)).toLocaleString('pt-BR')} — provável erro de digitação (casa decimal) no SGC.`);
    return { explicado: true, diagnosticos };
  }

  diagnosticos.push(`O SGC registra R$ ${fmt(valorSgc)}; pelos documentos, ${calc.memoria}. Sem explicação automática — conferir o cadastro no SGC e os termos da pasta.`);
  return { explicado: false, diagnosticos };
}

function conferirCnpj(cnpjSgc, cnpjDocumento, termosSgc) {
  const digitos = String(cnpjSgc || '').replace(/\D/g, '');
  const doc = String(cnpjDocumento || '').replace(/\D/g, '');
  if (!digitos) return { situacao: 'sem_cnpj', mensagem: 'O SGC não tem CNPJ para este contrato.' };
  if (digitos.length !== 14) return { situacao: 'invalido', mensagem: `O CNPJ do SGC tem ${digitos.length} dígitos ("${String(cnpjSgc).trim()}") — deveria ter 14.` };
  if (!cnpjValido(digitos)) return { situacao: 'invalido', mensagem: `O CNPJ do SGC (${String(cnpjSgc).trim()}) tem dígitos verificadores inválidos.` };
  if (!doc || doc === digitos) return { situacao: 'confere', mensagem: null };
  if (doc.slice(0, 8) === digitos.slice(0, 8)) {
    return { situacao: 'filial', mensagem: `Mesma empresa (raiz ${digitos.slice(0, 8)}), estabelecimento diferente: o documento traz ${cnpjDocumento} e o SGC ${String(cnpjSgc).trim()} (matriz/filial).` };
  }
  const alteracao = termosSgc.find(t => /cnpj|subjetiva|raz[ãa]o social|incorpora/i.test(`${t.tipo} ${t.objeto || ''}`));
  if (alteracao) {
    return { situacao: 'alterado', mensagem: `O contrato original traz ${cnpjDocumento}; o SGC tem ${String(cnpjSgc).trim()} — coerente com o termo ${alteracao.numero} ("${String(alteracao.tipo || '').trim()}").` };
  }
  return { situacao: 'diverge', mensagem: `O documento traz ${cnpjDocumento} e o SGC ${String(cnpjSgc).trim()} — empresas diferentes. Conferir.` };
}

/* Relatório completo. Assíncrono só por causa do extrator (que, com
   `apenasCache`, não faz OCR nem demora). */
async function conferir(db) {
  if (!servidorArquivos.isConfigured()) {
    return { configurado: false, linhas: [], totais: {} };
  }
  const processos = processosNaRede();
  const porPa = new Map();
  processos.forEach(p => { if (!porPa.has(p.pa)) porPa.set(p.pa, []); porPa.get(p.pa).push(p); });

  const linhas = [];
  const cacheTexto = new Map(); // processos com mais de um contrato no SGC leem os documentos uma vez só
  for (const c of db.contratos || []) {
    if (!c.origemExterna) continue;
    const pa = normalizarPa(c.pa);
    const processo = pa && porPa.get(pa) && porPa.get(pa)[0];
    const base = { contratoId: c.id, numero: c.numero, empresa: c.empresa, pa: c.pa ? String(c.pa).trim() : null, valorSgc: c.valor ?? null };
    if (!processo) { linhas.push({ ...base, situacao: 'sem_pasta', diagnosticos: [] }); continue; }

    if (!cacheTexto.has(processo.caminho)) {
      const docs = documentosDoProcesso(processo.caminho);
      const blocos = [];
      let naoLidos = 0;
      for (const d of docs) {
        let r = null;
        try { r = await extratorDocumento.extrairTexto(d.caminho, { apenasCache: true }); } catch (e) { r = null; }
        if (!r) { naoLidos++; continue; }
        if (!r.semTexto) blocos.push(`=== Arquivo: ${d.nome} ===\n${r.texto}`);
      }
      cacheTexto.set(processo.caminho, { texto: blocos.join('\n\n'), documentos: docs.length, naoLidos });
    }
    const { texto, documentos, naoLidos } = cacheTexto.get(processo.caminho);
    const linha = { ...base, processo: processo.nome, documentos, naoLidos, diagnosticos: [] };
    if (!texto) { linhas.push({ ...linha, situacao: 'sem_documentos' }); continue; }

    const termosSgc = termosNoSgc(db, c.numero);
    const local = leituraPorRegra.lerCampos(texto);
    linha.cnpj = conferirCnpj(c.cnpjEmpresa, local.campos.cnpjEmpresa, termosSgc);

    const calc = leituraPorRegra.calcularMediaMensal(texto, c.numero);
    linha.valorDocumentos = calc.mediaMensal ?? null;
    linha.memoria = calc.memoria;
    linha.avisosCalculo = calc.avisos;
    linha.aditivos = calc.aditivos.map(a => ({ termo: a.termo, natureza: a.natureza, valor: a.valor, meses: a.meses, documento: a.documento, detalhe: a.detalhe || null }));
    if (!(calc.mediaMensal > 0)) {
      linha.situacao = 'sem_calculo';
      linha.diagnosticos.push('Não foi possível calcular a média pelos documentos (valor global ou vigência não encontrados no contrato).');
    } else if (!(Number(c.valor) > 0)) {
      linha.situacao = 'diverge';
      linha.diagnosticos.push(`O SGC não tem valor mensal; pelos documentos, ${calc.memoria}.`);
    } else if (bate(calc.mediaMensal, c.valor)) {
      linha.situacao = 'confere';
    } else {
      const d = diagnosticarMedia(Number(c.valor), calc, termosSgc, c.sgcValores);
      linha.situacao = d.explicado ? 'sgc_desatualizado_ou_erro' : 'diverge';
      linha.diagnosticos.push(...d.diagnosticos);
    }
    if (linha.cnpj.mensagem && linha.cnpj.situacao !== 'confere') linha.diagnosticos.push(linha.cnpj.mensagem);
    linhas.push(linha);
  }

  const conta = s => linhas.filter(l => l.situacao === s).length;
  return {
    configurado: true,
    geradoEm: new Date().toISOString(),
    linhas,
    totais: {
      contratos: linhas.length,
      comPasta: linhas.filter(l => l.situacao !== 'sem_pasta').length,
      confere: conta('confere'),
      explicado: conta('sgc_desatualizado_ou_erro'),
      diverge: conta('diverge'),
      semCalculo: conta('sem_calculo') + conta('sem_documentos'),
      semPasta: conta('sem_pasta'),
      cnpjComProblema: linhas.filter(l => l.cnpj && ['invalido', 'diverge'].includes(l.cnpj.situacao)).length,
      documentosNaoLidos: [...cacheTexto.values()].reduce((s, p) => s + p.naoLidos, 0),
      // Contratos sincronizados antes de a sincronização guardar as parcelas do
      // valor (21/09/2026): sincronizar de novo traz as parcelas.
      semParcelasSgc: (db.contratos || []).filter(c => c.origemExterna && !c.sgcValores).length
    }
  };
}

/* Planilha das correções a pedir para o SGC: só os contratos cuja média
   ou CNPJ não conferem, com o valor pelos documentos, a memória de
   cálculo e o porquê. Mesmo formato da Base de Contratos (BOM, ";",
   CRLF, fórmulas neutralizadas) — abre direto no Excel. */
const ROTULO_SITUACAO = {
  confere: 'Confere', sgc_desatualizado_ou_erro: 'SGC desatualizado / erro', diverge: 'Diverge — conferir',
  sem_calculo: 'Sem cálculo', sem_documentos: 'Documentos não lidos', sem_pasta: 'Sem pasta na rede'
};

function gerarCsvCorrecoes(relatorio) {
  const planilhaCsv = require('./planilhaCsv');
  const aCorrigir = relatorio.linhas.filter(l => ['sgc_desatualizado_ou_erro', 'diverge'].includes(l.situacao)
    || (l.cnpj && ['invalido', 'diverge'].includes(l.cnpj.situacao)));
  const num = v => (v === null || v === undefined) ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const cabecalho = ['Contrato', 'Empresa', 'P.A.', 'Situação', 'Média mensal no SGC', 'Média mensal pelos documentos', 'Memória de cálculo', 'O que corrigir / por quê', 'CNPJ'];
  const corpo = aCorrigir.map(l => [
    l.numero, l.empresa, l.pa, ROTULO_SITUACAO[l.situacao] || l.situacao,
    num(l.valorSgc), num(l.valorDocumentos), l.memoria || '',
    (l.diagnosticos || []).filter(d => !(l.cnpj && d === l.cnpj.mensagem)).join(' | '),
    l.cnpj && l.cnpj.situacao !== 'confere' ? (l.cnpj.mensagem || '') : ''
  ]);
  return planilhaCsv.montar(cabecalho, corpo);
}

module.exports = { conferir, gerarCsvCorrecoes, _paraTeste: { normalizarPa, cnpjValido, diagnosticarMedia, diagnosticarParcelasSgc, conferirCnpj } };
