/* ===================================================================
   integrations/mapaRiscoContratos.js

   Orquestrador do mapa de risco por contrato (Ferramenta 2): liga
   extratorDocumento.js (texto de todos os documentos do contrato) ->
   mascaramento de CPF -> checklistRisco.js (eixo Conteúdo, por regra) +
   cálculo a partir de prazo/valor/aditivos/tratativas (eixos Prazo,
   Financeiro e Gestão) -> um registro em db.mapasRisco.

   Só roda SOB DEMANDA — alguém clica em "Gerar/Atualizar análise" na tela
   Mapa de Risco — nunca em segundo plano, seguindo a recomendação da
   proposta de arquitetura ("recomendo sob demanda + fila de revisão pra
   começar, dado o histórico deste projeto com mapeamento automático de
   campo"). E só é possível para contratos com `arquivoOrigem` (hoje, os
   que vieram da Ferramenta 1) — sem arquivo, não há o que analisar no
   eixo Conteúdo; o mapa ainda pode ser gerado, mas só com Prazo e
   Financeiro, com um aviso explicando por quê.

   Regra de combinação do risco geral: o PIOR dos eixos disponíveis
   (Conteúdo, Prazo, Financeiro) — um contrato com prazo confortável mas
   uma cláusula de multa ambígua ainda deveria chamar atenção, não ficar
   escondido atrás de uma média.
=================================================================== */

const path = require('path');
const extratorDocumento = require('./extratorDocumento');
const servidorArquivos = require('./servidorArquivos');
const checklistRisco = require('./checklistRisco');

/* Máscara de CPF no texto que vai para as citações do mapa (gestor,
   fiscal, preposto aparecem nos documentos). A máscara em si mora em
   mascaraDados.js (cobre as variações do OCR e o CPF colado ao nome na
   assinatura digital); aqui só é reexportada. */
const { mascararCpf } = require('./mascaraDados');
const { hojeLocal } = require('./dataLocal');

function diasAteVencimento(contrato) {
  if (!contrato.termino) return null;
  const partes = String(contrato.termino).split('-').map(Number);
  const [y, m, d] = partes;
  if (!y || !m || !d) return null;
  const termino = new Date(y, m - 1, d);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.round((termino - hoje) / 86400000);
}

const brl = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataBr = iso => { const [y, m, d] = String(iso || '').split('-'); return d ? `${d}/${m}/${y}` : String(iso || ''); };

/* Acordo/termo de cooperação SEM repasse (valor zero): o Financeiro não
   se aplica (nível null, "Não se aplica"). O texto do documento principal,
   quando lido, confirma o tipo de instrumento. */
function instrumentoDoContrato(contrato, textoPrincipal) {
  const { RE_COOPERACAO } = require('./checklistPorRegra');
  const onde = [contrato.arquivoOrigem, contrato.objeto, contrato.tipo === 'Convênio' ? 'convênio' : '', String(textoPrincipal || '').slice(0, 3000)].join(' \n ');
  const cooperacao = RE_COOPERACAO.test(onde);
  return { cooperacao, semRepasse: cooperacao && !(Number(contrato.valor) > 0) };
}

/* ------------------------------------------------------------------
   Eixos Prazo, Financeiro e Gestão — pelo REGISTRO DE RISCOS (28/09/2026)
   ------------------------------------------------------------------
   Até 28/09/2026 havia dois motores de risco: este arquivo pontuava
   Prazo e Financeiro por conta própria, e registroRiscos.js calculava os
   riscos da lei (limite de 60 meses, reajuste, gestor, preposto...) com
   probabilidade × impacto — que o Mapa NÃO usava. Resultado medido: o
   066/2020 somava 72 meses pela Lei 8.666 (limite esgotado) e o Mapa só
   dizia "venceu"; o acréscimo de 25% era calculado duas vezes, com
   faixas diferentes. Agora o motor é um só: cada eixo é o risco MAIS
   CRÍTICO do registro que cai nele, com a régua da planilha do SGC, e o
   "Como chegamos a este nível" mostra cada risco com P × I, evidência e
   fundamento legal. Os riscos registrados à mão pelo gestor entram em
   Gestão; um risco automático que o gestor tratou (fechou, rejeitou)
   deixa de pesar. O eixo Conteúdo continua sendo o checklist das
   cláusulas. */
const EIXO_POR_CODIGO = {
  VENCIMENTO: 'prazo', LIMITE_VIGENCIA: 'prazo', VIGENCIA_NAO_COMPROVADA: 'prazo', VIGENCIA_PRESUMIDA: 'prazo', TRATATIVAS_ABERTAS: 'prazo',
  LIMITE_ACRESCIMO: 'financeiro', REAJUSTE: 'financeiro', VALOR_NAO_CADASTRADO: 'financeiro', CONCENTRACAO: 'financeiro',
  GARANTIA_VENCIDA: 'financeiro', GARANTIA_VENCEU_ANTES_DO_FIM: 'financeiro', GARANTIA_NAO_COBRE: 'financeiro', GARANTIA_NAO_ARQUIVADA: 'financeiro', GARANTIA_SEM_VALIDADE: 'financeiro',
  SEM_GESTOR: 'gestao', SEM_SUPLENTE: 'gestao', SEM_PREPOSTO: 'gestao', TERMO_SEM_DOCUMENTO: 'gestao', RELATORIO_MENSAL_FALTANDO: 'gestao'
};
const REGUA = 'O nível do eixo é o do risco mais crítico dele (probabilidade × impacto, de 1 a 25): Alto de 15 a 25 (Evitar), Médio de 8 a 14 (Mitigar), Baixo até 6.';
function nivelDaCriticidade(q) { return q >= 15 ? 'alto' : q >= 8 ? 'medio' : 'baixo'; }

function calcularEixos(db, contrato, instrumento = instrumentoDoContrato(contrato)) {
  const registro = require('./registroRiscos').montarRegistro(db, contrato.id, undefined, { instrumento });
  const porEixo = { prazo: [], financeiro: [], gestao: [] };
  const ativos = registro ? [...registro.automaticos, ...registro.riscos].filter(r => r.status === 'Ativo') : [];
  for (const r of ativos) {
    const eixo = r.automatico ? EIXO_POR_CODIGO[r.codigo] : 'gestao';
    if (!eixo) continue; // CHECKLIST_*: é o eixo Conteúdo
    porEixo[eixo].push({
      codigo: r.codigo || null, acao: r.acao || null,
      criticidade: r.criticidade || 0, pontos: r.criticidade || 0, criterio: r.criterio || null,
      probabilidade: r.probabilidade, impacto: r.impacto,
      titulo: r.titulo || r.descricao,
      texto: r.automatico ? `${r.titulo}.${r.evidencia ? ` ${r.evidencia}` : ''}` : `Registrado pelo gestor: ${r.descricao}`,
      resposta: r.resposta || null, fundamento: r.fundamento || null, tratadoPeloGestor: !!r.tratamentoId
    });
  }
  const montar = (lista, semRisco, extras = {}) => {
    lista.sort((a, b) => b.criticidade - a.criticidade);
    const maior = lista.length ? lista[0].criticidade : 0;
    return { pontos: maior, nivel: nivelDaCriticidade(maior), motivos: lista.length ? lista : [{ pontos: 0, criticidade: 0, texto: semRisco }], regua: REGUA, ...extras };
  };

  const dias = diasAteVencimento(contrato);
  const prazo = montar(porEixo.prazo, dias === null ? 'Sem término cadastrado.' : `Vence em ${dias} dia(s) (${dataBr(contrato.termino)}); nenhum risco de prazo.`, { dias });

  const valor = Number(contrato.valor) || 0;
  const qtdAditivos = (db.aditivos || []).filter(a => a.contrato === contrato.numero).length;
  let financeiro;
  if (instrumento && instrumento.semRepasse && !porEixo.financeiro.length) {
    financeiro = { pontos: 0, nivel: null, naoSeAplica: true, valor, qtdAditivos,
      motivos: [{ pontos: 0, criticidade: 0, texto: 'Acordo/termo de cooperação sem repasse de recursos: o eixo financeiro não se aplica.' }], regua: 'Não se aplica.' };
  } else {
    financeiro = montar(porEixo.financeiro, 'Nenhum risco financeiro: valor cadastrado, acréscimos abaixo de 15% do valor inicial, reajuste e garantia sem pendência lida.', { valor, qtdAditivos });
    // Materialidade: só informa (valor entre os 25% maiores da carteira), não pesa.
    const carteira = (db.contratos || []).filter(c => c.status !== 'Encerrado').map(c => Number(c.valor) || 0).filter(v => v > 0).sort((a, b) => a - b);
    const corte = carteira.length >= 4 ? carteira[Math.floor(carteira.length * 0.75)] : null;
    if (valor > 0 && corte && valor >= corte) financeiro.motivos.push({ pontos: 0, criticidade: 0, informativo: true, texto: `Valor mensal de ${brl(valor)} está entre os 25% maiores da carteira (a partir de ${brl(corte)}): um problema aqui pesa mais no orçamento.` });
  }

  const gestao = montar(porEixo.gestao, 'Gestor, suplente e preposto identificados; nenhum termo só com extrato; nenhum risco registrado pelo gestor.');
  return { prazo, financeiro, gestao };
}
// Nome antigo, mantido para quem já chamava (agora devolve também `gestao`).
const calcularRiscoPrazoFinanceiro = calcularEixos;

/* Contrato ENCERRADO (02/10/2026, filtro "Encerrados" do Mapa): Prazo e
   Financeiro não se aplicam — o contrato acabou, e "vencido" daria Alto
   para todos. Ficam o Conteúdo (as cláusulas que a lei exige estavam lá?)
   e a Gestão (gestor, suplente, preposto, termos, relatórios), úteis para
   responder ao Tribunal sobre um contrato antigo. */
function eixosDoEncerrado(eixos) {
  const naoSeAplica = texto => ({ pontos: 0, nivel: null, naoSeAplica: true, encerrado: true, motivos: [{ pontos: 0, criticidade: 0, texto }], regua: 'Não se aplica.' });
  return {
    prazo: naoSeAplica('Contrato encerrado: o prazo não se aplica.'),
    financeiro: naoSeAplica('Contrato encerrado: o eixo financeiro não se aplica.'),
    gestao: eixos.gestao
  };
}

const ORDEM_NIVEL = { baixo: 0, medio: 1, alto: 2 };

// Ignora eixos indisponíveis (null) e devolve o PIOR entre os que existem.
function combinarRiscoGeral(niveis) {
  const disponiveis = niveis.filter(Boolean);
  if (!disponiveis.length) return 'baixo';
  return disponiveis.reduce((pior, n) => (ORDEM_NIVEL[n] > ORDEM_NIVEL[pior] ? n : pior), 'baixo');
}

function labelNivel(nivel) {
  return { baixo: 'Baixo', medio: 'Médio', alto: 'Alto' }[nivel] || nivel;
}

/* ------------------------------------------------------------------
   Leitura de TODOS os documentos do contrato
   ------------------------------------------------------------------
   Até 21/09/2026 o eixo Conteúdo lia só o arquivo de origem, e só os
   primeiros 3.500 caracteres dele — uma página e meia de um contrato de
   17. As cláusulas que importam para risco (penalidades, garantia,
   rescisão) ficam do meio para o fim e nunca eram lidas. Agora
   lê todos os documentos da pasta do contrato (contrato, aditivos,
   extratos) e, como roda sob demanda para UM contrato, faz OCR do
   documento inteiro em vez das 10 páginas da varredura em lote.
------------------------------------------------------------------ */
const CONFIG_RISCO = {
  // Os mesmos limites da leitura completa (um lugar só: extratorDocumento.js).
  maxPaginasOcr: extratorDocumento.LEITURA_COMPLETA.maxPaginasOcr,
  // Por documento. Um contrato de ~20 páginas escaneado leva uns 2 min
  // de OCR nesta máquina; o teto só evita que um arquivo gigante prenda
  // a geração indefinidamente.
  timeoutOcrMs: extratorDocumento.LEITURA_COMPLETA.timeoutOcrMs,
  tamanhoTrecho: 1400
};

/* Texto de um documento SÓ do cache (lote "Atualizar todas"): a leitura
   completa, se já foi feita; senão a parcial da varredura (vem com
   leituraCompleta=false, e aí o checklist não afirma ausência). Nunca
   dispara OCR — o que ainda não foi lido fica para "Atualizar a análise"
   daquele contrato, que lê o documento inteiro. */
async function textoSoDoCache(caminho) {
  return (await extratorDocumento.extrairTexto(caminho, { maxPaginasOcr: CONFIG_RISCO.maxPaginasOcr, timeoutOcrMs: CONFIG_RISCO.timeoutOcrMs, apenasCache: true }))
    || (await extratorDocumento.extrairTexto(caminho, { apenasCache: true }));
}

async function lerDocumentosDoContrato(contrato, aoProgredir, opcoes = {}) {
  const avisos = [];
  let lista;
  try {
    lista = servidorArquivos.listarDocumentosDaPasta(servidorArquivos.pastaDoGrupo(contrato.arquivoOrigem));
  } catch (err) {
    // Pasta fora das configuradas, ou inacessível agora: ainda dá pra
    // analisar o arquivo de origem sozinho — com o aviso de que os demais
    // documentos do contrato ficaram de fora.
    avisos.push(`Não foi possível listar os demais documentos da pasta do contrato (${err.message}); só o arquivo de origem foi lido.`);
    lista = [{ nome: path.basename(contrato.arquivoOrigem), caminho: contrato.arquivoOrigem }];
  }
  // Contrato principal primeiro: é a fonte que vale quando dois
  // documentos tratam do mesmo item (o extrato é um resumo).
  lista.sort((a, b) => (a.caminho === contrato.arquivoOrigem ? -1 : b.caminho === contrato.arquivoOrigem ? 1 : 0));

  const documentos = [];
  for (let i = 0; i < lista.length; i++) {
    const { nome, caminho } = lista[i];
    if (aoProgredir && !opcoes.soCache) aoProgredir(`lendo documento ${i + 1} de ${lista.length}: ${nome} (com OCR do documento inteiro, se for digitalizado — pode levar alguns minutos)`);
    try {
      const extraido = opcoes.soCache
        ? await textoSoDoCache(caminho)
        : await extratorDocumento.extrairTexto(caminho, { maxPaginasOcr: CONFIG_RISCO.maxPaginasOcr, timeoutOcrMs: CONFIG_RISCO.timeoutOcrMs });
      if (!extraido) {
        avisos.push(`"${nome}" ainda não foi lido (a atualização em lote só usa o texto já lido; "Atualizar a análise" deste contrato lê o arquivo).`);
        documentos.push({ nome, caminho, texto: '', paginas: [], semTexto: true, leituraCompleta: false, totalPaginas: 0, avisoOcr: 'ainda não lido' });
        continue;
      }
      documentos.push({
        nome, caminho,
        // CPF mascarado antes de virar citação no mapa.
        texto: mascararCpf(extraido.texto),
        paginas: extraido.paginas.map(p => ({ numero: p.numero, texto: mascararCpf(p.texto) })),
        semTexto: extraido.semTexto,
        leituraCompleta: extraido.leituraCompleta && !extraido.semTexto,
        totalPaginas: extraido.paginas.length,
        avisoOcr: extraido.ocr && extraido.ocr.aviso
      });
    } catch (err) {
      avisos.push(`"${nome}" não pôde ser lido: ${err.message}`);
      documentos.push({ nome, caminho, texto: '', paginas: [], semTexto: true, leituraCompleta: false, totalPaginas: 0, avisoOcr: err.message });
    }
  }
  return { documentos, avisos };
}

/* Estado da geração em andamento — só em memória, como o progresso da
   varredura (ver ingestaoContratos.js). A geração lê vários documentos,
   com OCR completo dos digitalizados: pode levar minutos. Por isso roda
   em segundo plano, e a tela acompanha por aqui em vez de segurar uma
   requisição aberta. */
let progresso = { emAndamento: false, contratoId: null, etapa: null, itemAtual: 0, totalItens: 0, iniciadoEm: null, ultimoErro: null, ultimoConcluido: null };

function obterProgresso() {
  return progresso;
}

/* Dispara a geração em segundo plano e devolve na hora. Erros de
   validação (contrato inexistente, outra geração rodando) são lançados
   AQUI, para a rota responder 4xx; o que falhar depois fica em
   `progresso.ultimoErro`. `aoConcluir(registro)` / `aoFalhar(erro)`:
   opcionais, para quem chama registrar auditoria. */
function iniciarGeracaoMapaRisco(db, save, nextId, contratoId, usuarioNome, aoConcluir, aoFalhar) {
  if (progresso.emAndamento) {
    throw new Error('Já existe um mapa de risco sendo gerado (nesta ou em outra aba) — aguarde ele terminar.');
  }
  const contrato = (db.contratos || []).find(c => String(c.id) === String(contratoId));
  if (!contrato) throw new Error('Contrato não encontrado.');

  progresso = {
    emAndamento: true, contratoId: contrato.id, etapa: 'iniciando', itemAtual: 0, totalItens: 0,
    iniciadoEm: new Date().toISOString(), ultimoErro: null, ultimoConcluido: null
  };
  gerarMapaRisco(db, save, nextId, contrato.id, usuarioNome)
    .then(registro => {
      progresso.ultimoConcluido = { contratoId: contrato.id, registroId: registro.id, em: new Date().toISOString() };
      if (aoConcluir) aoConcluir(registro);
    })
    .catch(err => {
      progresso.ultimoErro = { contratoId: contrato.id, mensagem: err.message, em: new Date().toISOString() };
      if (aoFalhar) aoFalhar(err);
    })
    .finally(() => {
      progresso.emAndamento = false;
      progresso.etapa = null;
    });
  return { iniciado: true, contratoId: contrato.id };
}

/* ------------------------------------------------------------------
   Atualizar TODAS as análises de uma vez (25/09/2026)
   ------------------------------------------------------------------
   Depois de uma mudança nas regras do checklist, os mapas salvos ficam com
   o resultado antigo até alguém gerar de novo, um por um. A análise é
   só regra — milissegundos por contrato — então dá para refazer todos.
   Para não pesar na máquina:
     - todos os contratos com documentos, encerrados inclusive (só Conteúdo
       e Gestão — ver eixosDoEncerrado);
     - só o texto JÁ lido (cache): nenhum OCR novo;
     - um contrato por vez, cedendo a vez ao servidor entre um e outro;
     - a mesma trava da geração individual: nunca duas ao mesmo tempo. */
function iniciarAtualizacaoEmLote(db, save, nextId, usuarioNome, aoConcluir) {
  if (progresso.emAndamento) {
    throw new Error('Já existe um mapa de risco sendo gerado (nesta ou em outra aba) — aguarde ele terminar.');
  }
  const alvos = (db.contratos || []).filter(c => !!c.arquivoOrigem).map(c => c.id);
  if (!alvos.length) throw new Error('Nenhum contrato com documentos para analisar.');

  progresso = {
    emAndamento: true, contratoId: null, etapa: 'iniciando a atualização de todas as análises', itemAtual: 0, totalItens: 0,
    iniciadoEm: new Date().toISOString(), ultimoErro: null, ultimoConcluido: null,
    lote: { total: alvos.length, feitos: 0, falhas: [] }
  };
  (async () => {
    for (const id of alvos) {
      const contrato = (db.contratos || []).find(c => c.id === id);
      if (!contrato) continue; // excluído durante o lote
      progresso.contratoId = id;
      progresso.etapa = `atualizando ${progresso.lote.feitos + 1} de ${alvos.length}: contrato ${contrato.numero || id}`;
      try {
        await gerarMapaRisco(db, save, nextId, id, usuarioNome, { soCache: true });
      } catch (err) {
        progresso.lote.falhas.push({ contratoId: id, numero: contrato.numero, mensagem: err.message });
      }
      progresso.lote.feitos++;
      await new Promise(r => setImmediate(r)); // deixa o servidor atender as telas entre um e outro
    }
  })()
    .catch(err => { progresso.ultimoErro = { contratoId: null, mensagem: err.message, em: new Date().toISOString() }; })
    .finally(() => {
      progresso.ultimoConcluido = { contratoId: null, lote: { ...progresso.lote }, em: new Date().toISOString() };
      progresso.emAndamento = false;
      progresso.etapa = null;
      progresso.contratoId = null;
      if (aoConcluir) aoConcluir(progresso.ultimoConcluido.lote);
    });
  return { iniciado: true, total: alvos.length };
}

/* Gera (ou regenera) o mapa de risco de um contrato. `opcoes.soCache`:
   só o texto já lido (atualização em lote) — ver iniciarAtualizacaoEmLote. */
async function gerarMapaRisco(db, save, nextId, contratoId, usuarioNome, opcoes = {}) {
  const contrato = (db.contratos || []).find(c => String(c.id) === String(contratoId));
  if (!contrato) throw new Error('Contrato não encontrado.');
  const etapa = texto => { if (progresso.emAndamento && !progresso.lote) progresso.etapa = texto; };

  // Tipo de instrumento pelo cadastro; refinado abaixo com o texto do documento principal.
  let instrumento = instrumentoDoContrato(contrato);
  let prazoFinanceiro = calcularRiscoPrazoFinanceiro(db, contrato, instrumento);

  let conteudo = null;
  let avisoConteudo = null;
  let documentosLidos = [];
  let checklist = null;
  if (contrato.arquivoOrigem) {
    try {
      const { documentos, avisos } = await lerDocumentosDoContrato(contrato, etapa, { soCache: !!opcoes.soCache });
      documentosLidos = documentos.map(d => ({ nome: d.nome, totalPaginas: d.totalPaginas, leituraCompleta: d.leituraCompleta, semTexto: d.semTexto, aviso: d.avisoOcr || null }));
      /* Documento que o lote pulou (ainda não lido) pode ter a cláusula que
         falta: sem ele, nenhum item pode ser dado como "não localizado". */
      const faltouLer = documentos.some(d => d.avisoOcr === 'ainda não lido');
      const comTexto = documentos.filter(d => !d.semTexto).map(d => faltouLer ? { ...d, leituraCompleta: false } : d);
      const avisosLeitura = [...avisos];
      if (comTexto.length && !instrumento.cooperacao) {
        instrumento = instrumentoDoContrato(contrato, comTexto[0].texto); // o principal vem primeiro
        if (instrumento.cooperacao) prazoFinanceiro = calcularRiscoPrazoFinanceiro(db, contrato, instrumento);
      }

      if (!comTexto.length) {
        avisoConteudo = 'Nenhum documento deste contrato tem texto extraível (mesmo com OCR) — só foi possível calcular os eixos Prazo e Financeiro.';
      } else {
        // Lei 8.666 ou 14.133: muda a referência de cada item do checklist.
        // Com o nome de cada documento: vale a lei do preâmbulo do contrato.
        const regime = require('./registroRiscos').regimeLegal(
          comTexto.map(d => `=== Arquivo: ${d.nome} ===\n${d.texto}`).join('\n\n'), contrato.inicio, contrato.numero);
        const analise = await checklistRisco.analisarPorChecklist({
          regime,
          instrumento,
          documentos: comTexto,
          tamanhoTrecho: CONFIG_RISCO.tamanhoTrecho,
          aoProgredir: ({ itemAtual, totalItens, item }) => {
            if (!progresso.emAndamento || progresso.lote) return;
            progresso.itemAtual = itemAtual;
            progresso.totalItens = totalItens;
            progresso.etapa = `conferindo item ${itemAtual} de ${totalItens} do checklist: ${item}`;
          }
        });
        checklist = analise.checklist;
        // nivelDoConteudo ignora apontamentos de citação não conferida —
        // ver a nota na função.
        conteudo = { nivel: checklistRisco.nivelDoConteudo(analise.findings), findings: analise.findings };
        if (!analise.leituraCompleta) {
          avisosLeitura.push('A leitura de algum documento ficou incompleta (OCR parcial ou interrompido) — itens do checklist não localizados NÃO foram tratados como ausentes, porque podem estar nas páginas que não foram lidas.');
        }
        if (analise.paraConferencia) {
          const aConferir = analise.checklist.filter(i => i.situacao === 'falha').map(i => i.item.toLowerCase());
          avisosLeitura.push(`${analise.resolvidosPorRegra} item(ns) do checklist foram conferidos pela leitura automática. Ficam para conferência manual (a leitura automática não conclui sozinha): ${aConferir.join('; ')}.`);
        }
      }
      if (avisosLeitura.length) avisoConteudo = avisosLeitura.join(' ');
    } catch (err) {
      avisoConteudo = `Não foi possível analisar os documentos do contrato (${err.message}) — só foi possível calcular os eixos Prazo e Financeiro.`;
    }
  } else {
    avisoConteudo = 'Este contrato não tem um arquivo de origem associado (não veio da Ferramenta 1 de ingestão) — só foi possível calcular os eixos Prazo e Financeiro.';
  }

  const encerrado = contrato.status === 'Encerrado';
  if (encerrado) prazoFinanceiro = eixosDoEncerrado(prazoFinanceiro);

  const riscoGeral = combinarRiscoGeral([
    conteudo ? conteudo.nivel : null,
    prazoFinanceiro.prazo.nivel,
    prazoFinanceiro.financeiro.nivel,
    prazoFinanceiro.gestao.nivel
  ]);

  const registro = {
    id: nextId(db.mapasRisco),
    contratoId: contrato.id,
    contratoNumero: contrato.numero,
    geradoEm: new Date().toISOString(),
    geradoPor: usuarioNome || 'Usuário',
    // "lote": atualização de todas as análises, só com o texto já lido (sem OCR novo);
    // "aprovacao": gerado sozinho ao aprovar o contrato na Fila (também só o texto já lido).
    modo: opcoes.modo || (opcoes.soCache ? 'lote' : 'individual'),
    // Encerrado: só Conteúdo e Gestão (ver eixosDoEncerrado).
    ...(encerrado ? { encerrado: true } : {}),
    // Acordo/termo de cooperação (e se há repasse de recursos) — muda o que se aplica.
    instrumento,
    arquivoOrigem: contrato.arquivoOrigem || null,
    riscoGeral,
    /* "Parcial" quando o eixo Conteúdo não foi analisado (sem arquivo,
       ou sem texto). combinarRiscoGeral() ignora o eixo
       que falta e devolve o pior dos que sobraram — então um contrato cujo
       conteúdo NINGUÉM analisou saía como "Risco geral: Baixo", o que se
       lê como "contrato seguro". O nível continua calculado; o rótulo diz
       que é parcial. */
    riscoGeralParcial: !conteudo,
    riscoGeralLabel: labelNivel(riscoGeral) + (conteudo ? '' : ' (parcial)'),
    conteudo: conteudo ? { ...conteudo, nivelLabel: labelNivel(conteudo.nivel) } : null,
    avisoConteudo,
    // Quais documentos foram lidos e se por inteiro — e o checklist item a
    // item. Ficam no registro para a tela poder mostrar o que embasou a
    // análise, não só o resultado.
    documentosLidos,
    checklist,
    prazo: { ...prazoFinanceiro.prazo, nivelLabel: prazoFinanceiro.prazo.nivel ? labelNivel(prazoFinanceiro.prazo.nivel) : 'Não se aplica' },
    financeiro: { ...prazoFinanceiro.financeiro, nivelLabel: prazoFinanceiro.financeiro.nivel ? labelNivel(prazoFinanceiro.financeiro.nivel) : 'Não se aplica' },
    // Quarto eixo (28/09/2026): gestor, suplente, preposto, termos e os riscos registrados pelo gestor.
    gestao: { ...prazoFinanceiro.gestao, nivelLabel: labelNivel(prazoFinanceiro.gestao.nivel) }
  };

  db.mapasRisco.unshift(registro);
  podarHistorico(db, contrato.id);
  save();
  return registro;
}

/* Guarda só as MAPAS_POR_CONTRATO análises mais recentes de cada contrato.
   Cada "Atualizar todas as análises" acrescenta uma por contrato (~8KB
   cada); sem limite, o data.json cresceria a cada uso (25/09/2026). As
   análises ficam em ordem da mais nova para a mais antiga. */
const MAPAS_POR_CONTRATO = Number(process.env.MAPA_RISCO_HISTORICO) || 5;
function podarHistorico(db, contratoId) {
  let vistos = 0;
  db.mapasRisco = db.mapasRisco.filter(m => String(m.contratoId) !== String(contratoId) || ++vistos <= MAPAS_POR_CONTRATO);
}

/* Risco ATUAL de cada contrato, o mesmo para o Mapa, o Painel e a tabela
   de Contratos (25/09/2026). Antes, o Painel tinha uma fórmula própria
   (valor mensal a partir de R$ 20 mil pesando muito) e 17 dos 27
   contratos apareciam com um risco no Painel e outro no Mapa. Prazo e
   Financeiro são recalculados agora (o prazo muda com o tempo); o
   Conteúdo vem da análise mais recente das cláusulas. */
function riscoAtualDoContrato(db, contrato) {
  // Encerrado: fora do mapa de risco (o prazo "vencido" seria ruído).
  if (contrato.status === 'Encerrado') {
    return { contratoId: contrato.id, nivel: null, encerrado: true, parcial: false, label: 'Encerrado', pontos: -1, resumo: 'Contrato encerrado — fora do mapa de risco.' };
  }
  const m = mapaMaisRecente(db, contrato.id);
  const instrumento = (m && m.instrumento) || instrumentoDoContrato(contrato);
  const pf = calcularRiscoPrazoFinanceiro(db, contrato, instrumento);
  const conteudo = m && m.conteudo ? m.conteudo.nivel : null;
  const nivel = combinarRiscoGeral([conteudo, pf.prazo.nivel, pf.financeiro.nivel, pf.gestao.nivel]);
  // Só o título do risco (29/09/2026): com a evidência, o resumo do Painel
  // trazia a citação inteira da apólice, com o ruído do OCR.
  const primeiroMotivo = e => { const x = (e.motivos || []).find(y => y.pontos > 0) || (e.motivos || [])[0] || {}; return x.titulo || x.texto || ''; };
  const nFindings = m && m.conteudo ? (m.conteudo.findings || []).length : 0;
  const resumo = [
    conteudo ? `Conteúdo ${labelNivel(conteudo)}${nFindings ? ` (${nFindings} ponto(s) nas cláusulas)` : ''}` : 'Conteúdo não analisado',
    `Prazo ${labelNivel(pf.prazo.nivel)}: ${primeiroMotivo(pf.prazo)}`,
    `Financeiro ${pf.financeiro.nivel ? labelNivel(pf.financeiro.nivel) : 'não se aplica'}: ${primeiroMotivo(pf.financeiro)}`,
    `Gestão ${labelNivel(pf.gestao.nivel)}: ${primeiroMotivo(pf.gestao)}`
  ].join(' · ');
  return {
    contratoId: contrato.id,
    nivel,
    parcial: !conteudo,
    label: labelNivel(nivel) + (conteudo ? '' : ' (parcial)'),
    // Para ordenar "maior risco primeiro": o nível manda; os pontos desempatam.
    pontos: ORDEM_NIVEL[nivel] * 1000 + pf.prazo.pontos + (pf.financeiro.pontos || 0) + pf.gestao.pontos + nFindings * 5,
    resumo,
    // Nível de cada eixo AGORA (prazo e registro recalculados; conteúdo da última análise).
    eixos: { conteudo: conteudo || null, prazo: pf.prazo.nivel, financeiro: pf.financeiro.nivel, gestao: pf.gestao.nivel },
    // Riscos de cada eixo (código, ação, criticidade) — o quadro "O que fazer agora".
    riscos: ['prazo', 'financeiro', 'gestao'].flatMap(e => (pf[e].motivos || []).filter(x => x.codigo).map(x => ({ eixo: e, codigo: x.codigo, acao: x.acao, criticidade: x.criticidade, titulo: x.titulo })))
  };
}

function riscosAtuais(db) {
  const r = {};
  for (const c of db.contratos || []) {
    try { r[c.id] = riscoAtualDoContrato(db, c); } catch (e) { /* contrato com dado estranho não derruba a lista */ }
  }
  return r;
}

/* Planilha das LACUNAS da análise mais recente de cada contrato
   (25/09/2026): cláusula exigida que não atende, atende em parte, não foi
   localizada ou ficou para conferência, e cada apontamento com a frase
   citada — para levar à Procuradoria ou ao gestor sem abrir contrato por
   contrato. Mesmo formato das outras exportações (planilhaCsv.js). */
const SITUACOES_LACUNA = {
  nao_atende: 'Não atende',
  atende_parcialmente: 'Atende parcialmente',
  nao_localizado: 'Não localizado no texto',
  nao_localizado_leitura_incompleta: 'Não localizado (leitura incompleta)',
  falha: 'Para conferência manual'
};
function gerarCsvLacunas(db) {
  const { montar, formatarValor } = require('./planilhaCsv');
  const linhas = [];
  for (const c of (db.contratos || []).slice().sort((a, b) => String(a.numero).localeCompare(String(b.numero)))) {
    const m = mapaMaisRecente(db, c.id);
    if (!m) continue;
    const data = formatarValor({ tipo: 'data' }, m.geradoEm ? hojeLocal(String(m.geradoEm)) : '');
    const base = [c.numero, c.empresa, c.pa, c.status === 'Encerrado' ? 'Encerrado' : 'Em vigência'];
    for (const i of m.checklist || []) {
      if (!SITUACOES_LACUNA[i.situacao]) continue;
      linhas.push([...base, 'Cláusula exigida', i.item, SITUACOES_LACUNA[i.situacao],
        (i.faltando || []).length ? `Não encontrado no texto: ${i.faltando.join('; ')}` : (i.erro || ''),
        i.referencia, '', (i.documentos || []).map(d => d.nome).join('; '), (i.documentos || []).map(d => d.pagina).filter(Boolean).join('; '), data]);
    }
    for (const f of (m.conteudo && m.conteudo.findings) || []) {
      linhas.push([...base, 'Apontamento', f.titulo, labelNivel(f.nivel), f.citacao || '', '', f.recomendacao || '', f.documento || '', f.pagina || '', data]);
    }
  }
  return montar(['Contrato', 'Empresa', 'Processo (P.A.)', 'Situação do contrato', 'Tipo', 'Item ou apontamento', 'Situação ou nível', 'O que falta ou frase citada', 'Referência legal', 'Recomendação', 'Documento', 'Página', 'Data da análise'], linhas);
}

/* Mapa mais recente de um contrato (ou null se nunca foi gerado). */
function mapaMaisRecente(db, contratoId) {
  return (db.mapasRisco || []).find(m => String(m.contratoId) === String(contratoId)) || null;
}

/* Para cada contrato ELEGÍVEL (com arquivoOrigem), devolve o mapa mais
   recente já gerado (ou null, se nunca foi) — usado pela tela Mapa de
   Risco pra montar a lista inteira sem precisar de uma chamada por
   contrato. Contratos sem arquivoOrigem (por exemplo, sincronizados só
   da API do SGC, sem passar pela Ferramenta 1) ainda não aparecem aqui —
   ver limitação documentada no README. */
/* Os encerrados com documentos, para o filtro "Encerrados" do Mapa. O
   risco de hoje é o pior entre o Conteúdo da última análise e a Gestão
   calculada agora (Prazo e Financeiro não se aplicam). */
function listarEncerradosComUltimoMapa(db) {
  return (db.contratos || []).filter(c => !!c.arquivoOrigem && c.status === 'Encerrado').map(c => {
    const doContrato = (db.mapasRisco || []).filter(m => String(m.contratoId) === String(c.id));
    const ultimoMapa = doContrato[0] || null;
    const eixosAtuais = eixosDoEncerrado(calcularEixos(db, c, (ultimoMapa && ultimoMapa.instrumento) || instrumentoDoContrato(c)));
    const nivel = ultimoMapa ? combinarRiscoGeral([ultimoMapa.conteudo ? ultimoMapa.conteudo.nivel : null, eixosAtuais.gestao.nivel]) : null;
    return {
      encerrado: true,
      contrato: { id: c.id, numero: c.numero, empresa: c.empresa, tipo: c.tipo, secretaria: c.secretaria, inicio: c.inicio, termino: c.termino, valor: c.valor },
      ultimoMapa, eixosAtuais,
      riscoAtual: nivel ? { nivel, label: labelNivel(nivel) + (ultimoMapa.conteudo ? '' : ' (parcial)'), parcial: !ultimoMapa.conteudo } : null,
      paraConferencia: ultimoMapa ? (ultimoMapa.checklist || []).filter(i => i.situacao === 'falha').length : null
    };
  });
}

function listarElegiveisComUltimoMapa(db) {
  const elegiveis = (db.contratos || []).filter(c => !!c.arquivoOrigem && c.status !== 'Encerrado'); // encerrado não entra no mapa de risco
  return elegiveis.map(c => {
    // Tendência (28/09/2026): a análise anterior, para a tela dizer se o risco subiu ou desceu.
    const doContrato = (db.mapasRisco || []).filter(m => String(m.contratoId) === String(c.id));
    const anterior = doContrato[1] || null;
    return {
      contrato: { id: c.id, numero: c.numero, empresa: c.empresa, tipo: c.tipo, secretaria: c.secretaria, termino: c.termino, valor: c.valor },
      ultimoMapa: doContrato[0] || null,
      // Prazo, financeiro e gestão de HOJE, com a conta (29/09/2026): a análise
      // guardada mostrava "venceu há 19 dias" no dia em que a lista já dizia 20.
      eixosAtuais: calcularEixos(db, c, (doContrato[0] && doContrato[0].instrumento) || instrumentoDoContrato(c)),
      mapaAnterior: anterior ? { riscoGeral: anterior.riscoGeral, riscoGeralLabel: anterior.riscoGeralLabel, geradoEm: anterior.geradoEm } : null
    };
  });
}

/* "O que fazer agora" (28/09/2026): os riscos da carteira agrupados pela
   AÇÃO que resolvem, do mais urgente ao menos — para a equipe começar a
   semana sabendo o que licitar, prorrogar, cobrar e arquivar, em vez de
   abrir contrato por contrato. Vem dos mesmos riscos do Mapa. */
const ACOES = [
  { chave: 'nova_contratacao', titulo: 'Iniciar nova contratação', explicacao: 'No limite legal de duração: não pode mais ser prorrogado (ou só pela prorrogação excepcional). Licitação leva meses.',
    casa: r => r.codigo === 'LIMITE_VIGENCIA' && r.acao === 'nova_contratacao' },
  { chave: 'regularizar_vencido', titulo: 'Regularizar contrato vencido', explicacao: 'O término lido nos documentos já passou: arquivar o termo de prorrogação que falta, ou confirmar o encerramento.',
    casa: r => r.codigo === 'VENCIMENTO' && /vencido/i.test(r.titulo || '') },
  { chave: 'decidir_prorrogacao', titulo: 'Decidir a prorrogação', explicacao: 'Vence dentro da faixa de alerta: prorrogar exige termo aditivo assinado antes do fim.',
    casa: r => r.codigo === 'VENCIMENTO' && !/vencido/i.test(r.titulo || '') && r.criticidade >= 8 },
  { chave: 'garantia', titulo: 'Cobrar a garantia contratual', explicacao: 'Garantia vencida ou que não cobre a vigência inteira.',
    casa: r => /^GARANTIA_(VENCIDA|NAO_COBRE)$/.test(r.codigo) },
  { chave: 'designar_gestor', titulo: 'Designar gestor ou suplente', explicacao: 'Sem o ato de designação na pasta.',
    casa: r => r.codigo === 'SEM_GESTOR' || r.codigo === 'SEM_SUPLENTE' },
  { chave: 'relatorios', titulo: 'Cobrar relatórios mensais', explicacao: 'Meses recentes da vigência sem o relatório mensal de atividades na pasta (ver Relatórios mensais).',
    casa: r => r.codigo === 'RELATORIO_MENSAL_FALTANDO' && r.criticidade >= 6 },
  { chave: 'planejar_contratacao', titulo: 'Planejar a próxima contratação', explicacao: 'A próxima prorrogação ordinária pode ser a última.',
    casa: r => r.acao === 'planejar_contratacao' },
  { chave: 'acrescimo', titulo: 'Controlar o saldo de acréscimo', explicacao: 'Acréscimos perto ou acima do limite legal de 25% do valor inicial.',
    casa: r => r.codigo === 'LIMITE_ACRESCIMO' },
  { chave: 'reajuste', titulo: 'Reajuste: verificar pedido ou renúncia', explicacao: 'Três anos ou mais sem termo de reajuste na pasta — pode virar passivo retroativo.',
    casa: r => r.codigo === 'REAJUSTE' && r.criticidade >= 8 },
  { chave: 'documentos', titulo: 'Arquivar documentos que faltam', explicacao: 'Ordem de Início, termo assinado (só há extrato) ou cópia da apólice.',
    casa: r => ['VIGENCIA_NAO_COMPROVADA', 'VIGENCIA_PRESUMIDA', 'TERMO_SEM_DOCUMENTO', 'GARANTIA_NAO_ARQUIVADA', 'GARANTIA_SEM_VALIDADE'].includes(r.codigo) },
  { chave: 'preposto', titulo: 'Pedir a indicação do preposto', explicacao: 'A contratada não indicou preposto nos documentos do processo.',
    casa: r => r.codigo === 'SEM_PREPOSTO' }
];

function acoesDaCarteira(db) {
  const riscos = riscosAtuais(db);
  const contratos = new Map((db.contratos || []).map(c => [String(c.id), c]));
  const grupos = ACOES.map(a => ({ chave: a.chave, titulo: a.titulo, explicacao: a.explicacao, itens: [] }));
  for (const [id, r] of Object.entries(riscos)) {
    if (!r || r.encerrado) continue;
    const c = contratos.get(String(id));
    if (!c || !c.arquivoOrigem) continue;
    for (const risco of r.riscos || []) {
      const i = ACOES.findIndex(a => a.casa(risco));
      if (i < 0) continue;
      const g = grupos[i];
      if (g.itens.some(x => String(x.contratoId) === String(id))) continue; // um contrato aparece uma vez por ação
      g.itens.push({ contratoId: c.id, numero: c.numero, empresa: c.empresa, detalhe: risco.titulo, criticidade: risco.criticidade });
    }
  }
  // Termos de encerramento esperando confirmação (Pendências de leitura).
  const aConfirmar = (db.contratos || []).filter(c => c.encerramentoDetectado && c.status !== 'Encerrado');
  const encerrar = { chave: 'confirmar_encerramento', titulo: 'Confirmar encerramento', explicacao: 'Há termo de encerramento na pasta; confirme em Pendências de leitura.',
    itens: aConfirmar.map(c => ({ contratoId: c.id, numero: c.numero, empresa: c.empresa, detalhe: `Termo "${c.encerramentoDetectado.arquivo}"${c.encerramentoDetectado.data ? ` — encerrado em ${dataBr(c.encerramentoDetectado.data)}` : ''}`, criticidade: 25 })) };
  return [encerrar, ...grupos]
    .map(g => ({ ...g, itens: g.itens.sort((a, b) => b.criticidade - a.criticidade) }))
    .filter(g => g.itens.length);
}

module.exports = {
  listarEncerradosComUltimoMapa, eixosDoEncerrado,
  mascararCpf,
  calcularRiscoPrazoFinanceiro,
  calcularEixos,
  instrumentoDoContrato,
  riscoAtualDoContrato,
  riscosAtuais,
  gerarCsvLacunas,
  acoesDaCarteira,
  gerarMapaRisco,
  iniciarGeracaoMapaRisco,
  iniciarAtualizacaoEmLote,
  obterProgresso,
  mapaMaisRecente,
  listarElegiveisComUltimoMapa
};
