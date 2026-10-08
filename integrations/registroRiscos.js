/* ===================================================================
   integrations/registroRiscos.js

   Registro de riscos por contrato, no MODELO DO SGC — a planilha "MAPA DE
   RISCOS EM CONTRATOS DA PM ITAVERDE v.1.1" (Hugo Freitas Moura,
   nov/2024), que os gestores preenchem à mão. Trazido para o sistema em
   23/09/2026, com três ganhos sobre a planilha:

     1. a mesma METODOLOGIA, sem copiar os erros dela — probabilidade e
        impacto de 1 a 5, criticidade = P × I, critério de aceitação pela
        faixa (a fórmula da coluna R), tipos, classificação interna/externa
        e categorias da aba "Dados";
     2. RISCOS AUTOMÁTICOS, calculados a partir dos documentos lidos da
        pasta (vigência, termos, gestor, valor), para as situações que a
        legislação de contratos públicos torna previsíveis — o gestor não
        precisa lembrar de registrá-las;
     3. um lugar único por contrato, com histórico e auditoria, em vez de
        uma planilha por contrato salva em pasta.

   Funções puras (sem disco e sem rede), exceto as de gravação no fim,
   que recebem db e save.
=================================================================== */

/* ------------------------------------------------------------------
   Metodologia da planilha (abas "Leia-me" e "Dados")
------------------------------------------------------------------ */
const ESCALA_PROBABILIDADE = {
  5: 'Praticamente certo — muito alto',
  4: 'Muito provável — alto',
  3: 'Provável — moderado',
  2: 'Pouco provável — baixo',
  1: 'Raro — muito baixo'
};
/* Na planilha, o "Leia-me" repete "4 - Moderado" (B50); o certo é 3,
   como está na aba "Dados" (B59). Aqui usamos o da aba "Dados". */
const ESCALA_IMPACTO = { 5: 'Muito alto', 4: 'Alto', 3: 'Moderado', 2: 'Baixo', 1: 'Muito baixo' };

const TIPOS_DE_RISCO = ['Estratégico', 'Operacional', 'Tecnologia', 'Conformidade', 'Projeto', 'Integridade',
  'Legal / Regulatório', 'Financeiro / Orçamentário', 'Negócio', 'Imagem', 'Comunicação', 'Físico', 'Químico',
  'Ergonômico', 'Acesso indevido', 'Cibernético', 'Biológico', 'Outro'];
const CLASSIFICACOES = {
  Interna: ['Infraestrutura', 'Pessoal', 'Processo', 'Conformidade', 'Comunicação', 'Estratégico', 'Operacional', 'Outro'],
  Externa: ['Político', 'Social', 'Ambiental', 'Orçamentário', 'Imagem', 'Outro']
};
const STATUS_RISCO = ['Ativo', 'Fechado', 'Não ocorreu', 'Rejeitado'];
const NATUREZAS = ['Risco', 'Oportunidade'];
// Aba "Issues"
const STATUS_ISSUE = ['Em progresso', 'Adiado', 'Encerrado', 'Cancelado'];
const PRIORIDADES = ['Alta', 'Média', 'Baixa'];
const FASES = ['Planejamento', 'Início', 'Implementação', 'Entrega', 'Faturamento', 'Encerramento', 'Operação assiseteca', 'Suporte'];
const CATEGORIAS_ISSUE = ['Implementação', 'Mudança', 'Contrato', 'Custo', 'Data', 'Migração / Move', 'Design', 'Infraestrutura',
  'Gestão', 'Risco', 'Cronograma', 'Escopo', 'Suporte', 'Recursos', 'Equipe', 'Testes', 'Capacitação'];

function criticidade(p, i) {
  const P = Number(p), I = Number(i);
  if (!(P >= 1 && P <= 5 && I >= 1 && I <= 5)) return 0;
  return Math.round(P) * Math.round(I);
}

/* Mesma decisão da coluna R da planilha:
     =IF(Q=0,"defina P e I", IF(Q<3,"Registrar", IF(8<=Q<15,"MITIGAR",
      IF(2<Q<=6,"ACEITAR MONITORAR","EVITAR"))))
   Com P e I inteiros de 1 a 5, os produtos possíveis são 1-6, 8-10, 12,
   15, 16, 20 e 25 — a fórmula cobre todos. */
function criterioDeAceitacao(q) {
  if (!(q > 0)) return null;
  if (q < 3) return 'Registrar';
  if (q >= 8 && q < 15) return 'Mitigar';
  if (q > 2 && q <= 6) return 'Aceitar e monitorar';
  return 'Evitar';
}

/* Cor da criticidade, pelo "Leia-me": verde pode ser aceito, amarelo
   exige monitoramento, vermelho está acima do tolerável. */
function faixaDeCriticidade(q) {
  if (!(q > 0)) return null;
  if (q < 3) return 'baixa';        // verde — Registrar
  if (q <= 6) return 'moderada';    // amarelo — Aceitar e monitorar
  if (q < 15) return 'alta';        // vermelho — Mitigar
  return 'critica';                 // vermelho escuro — Evitar
}

/* ------------------------------------------------------------------
   Riscos automáticos — o que a legislação torna previsível
------------------------------------------------------------------ */
const DIA = 86400000;
const diasEntre = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DIA);
const br = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—';
const reais = v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/* Regime legal do contrato, pelo texto: Lei 8.666/1993 (revogada em
   30/12/2023, mas rege os contratos firmados sob ela até o fim) ou Lei
   14.133/2021. Sem citação, presume pela data de início. */
/* Citação da LEI, não o número solto: o CNPJ 11.244.553/0001-06 da
   contratada do 038/2023 fazia o contrato parecer da Lei 14.133. */
const RE_14133 = /lei[^.;]{0,40}?\b14\.?133\b|\b14\.?133\s*\/\s*(?:20)?21\b/i;
const RE_8666 = /lei[^.;]{0,40}?\b8\.?666\b|\b8\.?666\s*\/\s*(?:19)?93\b/i;

/* Qual lei o texto cita PRIMEIRO. No contrato, é o preâmbulo ("nos termos
   da Lei Federal nº ...") — a lei que rege o contrato. */
function leiCitadaPrimeiro(texto) {
  const a = texto.search(RE_14133);
  const b = texto.search(RE_8666);
  if (a < 0 && b < 0) return null;
  if (a < 0) return '8.666';
  if (b < 0) return '14.133';
  return a < b ? '14.133' : '8.666';
}

/* `numero` (opcional): o ano do número do contrato decide quando não há
   citação nem data de início. */
function regimeLegal(textoOuCitacoes, inicio, numero) {
  const t = String(textoOuCitacoes || '');
  /* Primeiro, o documento do CONTRATO: a pasta junta aditivos e extratos
     de anos depois, e um aditivo de 2025 de um contrato de 2020 cita a
     lei nova. Medido em 24/09/2026: olhando a pasta inteira, 048/2026,
     006/2025 e 015/2024 saíam como Lei 8.666. */
  if (/=== Arquivo:/.test(t)) {
    const { dividirEmDocumentos, classificarDocumento } = require('./valorContratual').pecas;
    const contratos = dividirEmDocumentos(t).filter(d => { const c = classificarDocumento(d.nome); return c.tipo === 'contrato' && !c.extrato; });
    for (const d of contratos) {
      const lei = leiCitadaPrimeiro(String(d.texto).slice(0, 6000));
      if (lei) return { lei, presumido: false };
    }
  }
  const cita14133 = RE_14133.test(t);
  const cita8666 = RE_8666.test(t);
  if (cita8666 && !cita14133) return { lei: '8.666', presumido: false };
  if (cita14133 && !cita8666) return { lei: '14.133', presumido: false };
  const ano = inicio ? String(inicio).slice(0, 4) : (String(numero || '').match(/\/\s*(\d{4})\b/) || [])[1];
  if (cita8666 && cita14133) {
    if (ano) return { lei: ano < '2024' ? '8.666' : '14.133', presumido: false };
    return { lei: leiCitadaPrimeiro(t), presumido: true };
  }
  if (!ano) return { lei: null, presumido: true };
  return { lei: ano < '2024' ? '8.666' : '14.133', presumido: true };
}

function risco(codigo, campos) {
  const q = criticidade(campos.probabilidade, campos.impacto);
  return {
    id: `auto:${codigo}`,
    codigo,
    automatico: true,
    natureza: 'Risco',
    status: 'Ativo',
    ...campos,
    criticidade: q,
    criterio: criterioDeAceitacao(q),
    faixa: faixaDeCriticidade(q)
  };
}

/* Cada regra olha UMA situação e devolve um risco no formato do
   registro, com o fundamento legal e a evidência que o disparou. Nenhuma
   inventa dado: sem a informação necessária, a regra não dispara (ou
   dispara o risco de a informação faltar). */
const REGRAS = [
  /* Relatório mensal de atividades faltando na pasta (01/10/2026): é ele
     que comprova a execução e a fiscalização do mês — sem ele, o atesto e
     o pagamento ficam sem lastro, e a resposta ao Tribunal fica sem
     documento. Pesa o que falta nos ÚLTIMOS 6 MESES; falta antiga só
     registra. Vem de relatoriosMensais.js (a leitura das pastas). */
  function relatoriosMensaisFaltando(c, ctx) {
    const cob = ctx.relatorios;
    if (!cob || cob.naoExige || !(cob.faltando || []).length) return null;
    // Os 6 últimos meses COBRADOS: o mês ainda no prazo de entrega (até o dia 10) não conta.
    const limite = (() => { const [a, m] = String(cob.fim).split('-').map(Number); const d = new Date(a, m - 1 - 5 - (cob.aguardando ? 1 : 0), 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();
    const recentes = cob.faltando.filter(x => x >= limite);
    const n = recentes.length;
    // Contrato encerrado: a falta fica registrada (o Tribunal pode pedir), mas não há mais o que cobrar no mês a mês.
    const encerrado = c.status === 'Encerrado';
    const [p, i] = encerrado ? [2, 2] : n >= 3 ? [4, 3] : n === 2 ? [3, 3] : n === 1 ? [2, 3] : [2, 2];
    const mesBr = x => `${x.slice(5, 7)}/${x.slice(0, 4)}`;
    return risco('RELATORIO_MENSAL_FALTANDO', {
      acao: 'relatorios',
      titulo: encerrado ? `Contrato encerrado com ${cob.faltando.length} mês(es) sem relatório mensal na pasta` : n ? `${n} mês(es) recente(s) sem relatório mensal na pasta` : `${cob.faltando.length} mês(es) antigo(s) sem relatório mensal na pasta`,
      descricao: 'O relatório mensal de atividades comprova a execução e a fiscalização do mês. Sem ele na pasta, o atesto e o pagamento ficam sem lastro, e a resposta a uma requisição do Tribunal fica sem documento.',
      impactoDescricao: 'Pagamento sem comprovação da execução; apontamento em fiscalização.',
      tipo: 'Conformidade', classificacao: 'Interna', categoria: 'Processo',
      probabilidade: p, impacto: i,
      resposta: 'Cobrar da contratada os relatórios que faltam e arquivar na pasta "Relatórios mensais de atividades", com o nome "AAAA_MM - Relatório Mensal - Empresa - Mês".',
      fundamento: 'Lei 14.133/2021, arts. 117 (fiscalização) e 140 (recebimento); Lei 8.666/1993, art. 67.',
      evidencia: `Sem relatório: ${cob.faltando.slice(-8).map(mesBr).join(', ')}${cob.faltando.length > 8 ? ` e mais ${cob.faltando.length - 8}` : ''}. ${cob.entregues} de ${cob.esperados} mês(es) da vigência com relatório (${cob.processo}).`
    });
  },

  // 1. Vencimento — a mais concreta de todas.
  function vencimento(c, ctx) {
    if (!c.termino) return null;
    const dias = diasEntre(ctx.hoje, c.termino);
    /* Faixas das Configurações de alerta (crítico / atenção / próximo),
       as mesmas do Painel — desde 28/09/2026 o Mapa de risco usa este
       registro como o eixo Prazo. */
    const a = ctx.alertaConfig;
    let p, i, titulo;
    if (dias < 0) { p = 5; i = 5; titulo = `Contrato vencido há ${-dias} dia(s) (${br(c.termino)})`; }
    else if (dias <= a.critico) { p = 5; i = 4; titulo = `Vence em ${dias} dia(s) (${br(c.termino)}) — prazo crítico`; }
    else if (dias <= a.atencao) { p = 4; i = 4; titulo = `Vence em ${dias} dias (${br(c.termino)})`; }
    else if (dias <= a.proximo) { p = 3; i = 4; titulo = `Vence em ${dias} dias (${br(c.termino)})`; }
    else if (dias <= 180) { p = 2; i = 3; titulo = `Vence em ${dias} dias (${br(c.termino)})`; }
    else return null;
    return risco('VENCIMENTO', {
      titulo,
      descricao: dias < 0
        ? 'A vigência terminou sem prorrogação lida nos documentos. Se o serviço continua sendo prestado, há execução sem cobertura contratual.'
        : 'A vigência termina em breve. Prorrogar exige termo aditivo assinado ANTES do fim; nova contratação exige processo licitatório, que leva meses.',
      impactoDescricao: 'Interrupção do serviço ou execução sem contrato (pagamento por indenização, apuração de responsabilidade).',
      tipo: 'Legal / Regulatório', classificacao: 'Interna', categoria: 'Processo',
      probabilidade: p, impacto: i,
      resposta: dias < 0
        ? 'Confirmar se há termo de prorrogação fora da pasta; se não houver, suspender a execução ou regularizar e comunicar a Procuradoria.'
        : 'Decidir já entre prorrogar (com vantajosidade demonstrada) e abrir nova contratação; iniciar o termo aditivo com antecedência.',
      fundamento: 'Lei 14.133/2021, arts. 105 a 107 e 95, § 2º; Lei 8.666/1993, art. 57 e art. 60, parágrafo único.',
      evidencia: `Término ${br(c.termino)} (calculado pela vigência lida dos documentos).${a.origem && a.origem !== 'padrao' ? ` Prazos de alerta deste contrato: ${a.nome} (crítico ${a.critico}, atenção ${a.atencao}, próximo ${a.proximo} dias).` : ''}`
    });
  },

  // 2. Limite de duração do contrato.
  function limiteDeVigencia(c, ctx) {
    const meses = ctx.mesesTotais;
    if (!meses) return null;
    const regime = ctx.regime;
    /* Antecedência (28/09/2026): contrato que não pode mais ser prorrogado
       precisa de NOVA CONTRATAÇÃO, que leva meses. Quanto mais perto do
       fim, mais grave — sem esperar a faixa de 90 dias do vencimento. */
    const dias = c.termino ? diasEntre(ctx.hoje, c.termino) : null;
    const prazo = dias === null ? '' : dias < 0 ? ` — venceu em ${br(c.termino)}` : ` — vence em ${dias} dia(s) (${br(c.termino)})`;
    const perto = dias !== null && dias <= 180;
    // Já terminou: não há mais prorrogação a planejar — é regularizar (29/09/2026).
    const jaTerminou = dias !== null && dias < 0;
    const respostaTerminou = 'A vigência já terminou no limite legal: não há prorrogação possível. Se o serviço continua, regularizar com nova contratação (ou contratação emergencial justificada) e comunicar a Procuradoria; se parou, confirmar o encerramento.';
    if (regime.lei === '8.666') {
      const excepcional = ctx.termos.some(t => /excepcional/i.test(`${t.objeto || ''} ${t.tipo || ''}`));
      /* 60 meses + até 12 excepcionais = 72 no máximo. Passou de 72, está
         esgotado mesmo sem achar a palavra "excepcional" no termo (o
         066/2020 soma 72 meses e a regra só olhava o texto). */
      if (meses >= 72 || (meses >= 60 && excepcional)) {
        return risco('LIMITE_VIGENCIA', {
          acao: 'nova_contratacao',
          titulo: `Limite legal de duração esgotado (${meses} meses${excepcional ? ', com prorrogação excepcional' : ''}) — não pode mais ser prorrogado${prazo}`,
          descricao: 'Pela Lei 8.666, serviço contínuo vai até 60 meses, mais até 12 em caráter excepcional. A excepcional já foi usada: não cabe nova prorrogação.',
          impactoDescricao: 'Descontinuidade do serviço se a nova contratação não estiver pronta no fim da vigência.',
          tipo: 'Legal / Regulatório', classificacao: 'Interna', categoria: 'Conformidade',
          probabilidade: 5, impacto: 5,
          resposta: jaTerminou ? respostaTerminou : 'Nova contratação (pela Lei 14.133) em andamento, com cronograma que termine antes do fim da vigência atual.',
          fundamento: 'Lei 8.666/1993, art. 57, II e § 4º.',
          evidencia: `${meses} meses somados na vigência lida${excepcional ? '; termo com prorrogação "excepcional" na pasta' : ''}.${regime.presumido ? ' Regime presumido pela data de início.' : ''}`
        });
      }
      if (meses >= 60) {
        return risco('LIMITE_VIGENCIA', {
          acao: 'nova_contratacao',
          titulo: `60 meses atingidos (${meses} meses) — só resta a prorrogação excepcional${prazo}`,
          descricao: 'O limite ordinário de 60 meses da Lei 8.666 foi alcançado. Nova prorrogação só em caráter excepcional, justificada e autorizada pela autoridade superior, por até 12 meses.',
          impactoDescricao: 'Prorrogação sem os requisitos da excepcionalidade é irregular; sem ela, o serviço para.',
          tipo: 'Legal / Regulatório', classificacao: 'Interna', categoria: 'Conformidade',
          // Perto do fim (até 180 dias), sem nova contratação pronta: 5 × 4.
          probabilidade: perto ? 5 : 4, impacto: 4,
          resposta: jaTerminou ? 'A vigência terminou sem prorrogação excepcional lida na pasta: se ela foi assinada antes do fim, arquivá-la; se não, regularizar com nova contratação e comunicar a Procuradoria.' : 'Iniciar a nova contratação; usar a excepcional só com justificativa formal e autorização.',
          fundamento: 'Lei 8.666/1993, art. 57, II e § 4º.',
          evidencia: `${meses} meses somados na vigência lida.${regime.presumido ? ' Regime presumido pela data de início.' : ''}`
        });
      }
      if (meses >= 48) {
        return risco('LIMITE_VIGENCIA', {
          acao: 'planejar_contratacao',
          titulo: `Próximo do limite de 60 meses (${meses} meses)${prazo}`,
          descricao: 'A próxima prorrogação ordinária pode ser a última. Planejar a nova contratação agora evita depender da excepcional.',
          impactoDescricao: 'Nova contratação feita às pressas, ou dependência de prorrogação excepcional.',
          tipo: 'Legal / Regulatório', classificacao: 'Interna', categoria: 'Processo',
          probabilidade: perto ? 4 : 3, impacto: 3,
          resposta: 'Incluir a nova contratação no plano de contratações do ano.',
          fundamento: 'Lei 8.666/1993, art. 57, II.',
          evidencia: `${meses} meses somados na vigência lida.${regime.presumido ? ' Regime presumido pela data de início.' : ''}`
        });
      }
      return null;
    }
    if (regime.lei === '14.133') {
      if (meses >= 120) {
        return risco('LIMITE_VIGENCIA', {
          acao: 'nova_contratacao',
          titulo: `Limite de 10 anos esgotado (${meses} meses) — não pode mais ser prorrogado${prazo}`,
          descricao: 'Serviços e fornecimentos contínuos podem durar até 5 anos, prorrogáveis até 10. O limite foi alcançado.',
          impactoDescricao: 'Não há como prorrogar; o serviço para se a nova contratação não estiver pronta.',
          tipo: 'Legal / Regulatório', classificacao: 'Interna', categoria: 'Conformidade',
          probabilidade: 5, impacto: 5,
          resposta: jaTerminou ? respostaTerminou : 'Nova contratação com cronograma compatível com o fim da vigência.',
          fundamento: 'Lei 14.133/2021, arts. 106 e 107.',
          evidencia: `${meses} meses somados na vigência lida.`
        });
      }
      if (meses >= 108) {
        return risco('LIMITE_VIGENCIA', {
          acao: 'planejar_contratacao',
          titulo: `Próximo do limite de 10 anos (${meses} meses)${prazo}`,
          descricao: 'Serviços e fornecimentos contínuos têm limite de 10 anos. Planejar a nova contratação.',
          impactoDescricao: 'Nova contratação feita às pressas.',
          tipo: 'Legal / Regulatório', classificacao: 'Interna', categoria: 'Processo',
          probabilidade: perto ? 4 : 3, impacto: 4,
          resposta: 'Incluir a nova contratação no plano de contratações anual.',
          fundamento: 'Lei 14.133/2021, arts. 106 e 107.',
          evidencia: `${meses} meses somados na vigência lida.`
        });
      }
    }
    return null;
  },

  // 3. Acréscimos acima do limite legal.
  function limiteDeAcrescimos(c, ctx) {
    const inicial = Number(ctx.valorInicial);
    if (!(inicial > 0)) return null;
    // Acréscimos e supressões contam SEPARADOS — não se compensam (TCU).
    const acrescimos = ctx.termos.filter(t => t.natureza === 'acréscimo' && Number(t.valor) > 0);
    const soma = acrescimos.reduce((s, t) => s + Number(t.valor), 0);
    if (!soma) return null;
    const pct = soma / inicial * 100;
    if (pct < 15) return null;
    const acima = pct > 25;
    /* Uma régua só (28/09/2026) — antes, 20 a 25% era "Evitar" aqui e
       "Médio" no Mapa de risco. Perto do limite não é irregular: é pouca
       margem (Mitigar). Acima, sim (Evitar). */
    const [p, i] = acima ? [5, 5] : pct >= 20 ? [3, 4] : [2, 3];
    return risco('LIMITE_ACRESCIMO', {
      acao: 'controlar_acrescimo',
      titulo: acima ? `Acréscimos somam ${pct.toFixed(1)}% do valor inicial — acima do limite de 25%` : `Acréscimos somam ${pct.toFixed(1)}% do valor inicial (limite: 25%)`,
      descricao: 'A contratada é obrigada a aceitar acréscimos de até 25% do valor inicial atualizado (50% em reforma de edifício ou equipamento). Acréscimos e supressões contam separados, sem compensação.',
      impactoDescricao: acima ? 'Alteração acima do limite legal: risco de apontamento do Tribunal de Contas e de nulidade do termo.' : 'Pouca margem para novo acréscimo; nova demanda pode exigir nova contratação.',
      tipo: 'Legal / Regulatório', classificacao: 'Interna', categoria: 'Conformidade',
      probabilidade: p, impacto: i,
      resposta: acima ? 'Conferir a base de cálculo com a Procuradoria (valor inicial atualizado, se é reforma) e regularizar.' : 'Controlar o saldo de acréscimo antes de qualquer novo termo.',
      fundamento: 'Lei 14.133/2021, art. 125; Lei 8.666/1993, art. 65, §§ 1º e 2º.',
      evidencia: `${reais(soma)} em ${acrescimos.length} termo(s) de acréscimo (${acrescimos.map(t => t.numero).filter(Boolean).join(', ')}) sobre valor inicial de ${reais(inicial)}. Não considera atualização monetária do valor inicial.`
    });
  },

  // 4. Fiscalização sem gestor designado.
  function gestaoDoContrato(c) {
    const vazio = v => !v || /^\(a definir\)$|^\*+$/.test(String(v).trim());
    if (vazio(c.responsavel)) {
      return risco('SEM_GESTOR', {
        titulo: 'Gestor do contrato não identificado',
        descricao: 'Não foi encontrado nos documentos da pasta o ato que designa o gestor (contrato, apostilamento ou portaria).',
        impactoDescricao: 'Execução sem acompanhamento formal: medição, atestes e aplicação de penalidades ficam sem responsável.',
        tipo: 'Conformidade', classificacao: 'Interna', categoria: 'Pessoal',
        probabilidade: 4, impacto: 4,
        resposta: 'Localizar ou emitir o ato de designação e arquivá-lo na pasta do contrato.',
        fundamento: 'Lei 14.133/2021, art. 117; Lei 8.666/1993, art. 67.',
        evidencia: 'Campo "responsável" vazio no cadastro.'
      });
    }
    if (vazio(c.suplente)) {
      return risco('SEM_SUPLENTE', {
        titulo: 'Suplente do gestor não identificado',
        descricao: 'Há gestor, mas nenhum suplente designado nos documentos da pasta.',
        impactoDescricao: 'Na ausência do gestor (férias, afastamento, exoneração), o contrato fica sem acompanhamento.',
        tipo: 'Operacional', classificacao: 'Interna', categoria: 'Pessoal',
        probabilidade: 3, impacto: 2,
        resposta: 'Designar suplente por apostilamento.',
        fundamento: 'Lei 14.133/2021, art. 117, § 1º (registro e acompanhamento contínuos).',
        evidencia: 'Campo "suplente" vazio no cadastro.'
      });
    }
    return null;
  },

  /* 4-b. Preposto da contratada não indicado (24/09/2026). A lei exige
     que a contratada mantenha preposto aceito pela Administração; o nome
     vem num ofício da empresa (ver acharPreposto em camposPorRegra.js). */
  function prepostoDaContratada(c, ctx) {
    const vazio = v => !v || /^\(a definir\)$|^\*+$|^-+$/.test(String(v).trim());
    if (!vazio(c.preposto)) return null;
    const lei = ctx.regime && ctx.regime.lei === '8.666' ? 'Lei 8.666/1993, art. 68' : 'Lei 14.133/2021, art. 118';
    return risco('SEM_PREPOSTO', {
      titulo: 'Preposto da contratada não indicado',
      descricao: ctx.prepostoSemValor || 'Nenhuma indicação de preposto nos documentos do processo.',
      impactoDescricao: 'Sem preposto formalmente aceito, não há quem responda pela contratada na execução — ocorrências, notificações e reuniões ficam sem interlocutor oficial.',
      tipo: 'Operacional', classificacao: 'Externa', categoria: 'Outro',
      probabilidade: 3, impacto: 2,
      resposta: 'Solicitar à contratada o ofício de indicação do preposto e arquivá-lo no processo.',
      fundamento: `${lei} (a contratada mantém preposto aceito pela Administração).`,
      evidencia: ctx.prepostoSemValor || 'Campo "preposto" vazio no cadastro.'
    });
  },

  // 5. Reajuste não aplicado há muito tempo.
  function reajusteAtrasado(c, ctx) {
    if (!c.inicio) return null;
    if (ctx.instrumento && ctx.instrumento.semRepasse) return null; // cooperação sem dinheiro: não há o que reajustar
    /* Termo de reajuste sem data lida conta pelo ano do número (240/2021 ->
       31/12/2021): conservador, para não acusar atraso que não existe. */
    const anoDoNumero = n => { const m = String(n || '').match(/\/(\d{4})$/); return m ? `${m[1]}-12-31` : null; };
    const reajustes = ctx.termos.filter(t => t.natureza === 'reajuste' || /reajust|repactua/i.test(t.tipo || ''))
      .map(t => t.data || anoDoNumero(t.numero))
      .filter(Boolean).sort();
    const base = reajustes.length ? reajustes[reajustes.length - 1] : c.inicio;
    const meses = Math.floor(diasEntre(base, ctx.hoje) / 30.4);
    /* Desde 28/09/2026 avisa já no aniversário (12 meses), com peso baixo, e
       sobe com o tempo: o reajuste não pedido acumula e pode vir retroativo.
       Medido: 17 contratos com mais de 12 meses e nenhum termo de reajuste
       na pasta (os aditivos "Outro" de maio/2025 são a cláusula da LGPD). */
    if (meses < 12) return null;
    const [p, i] = meses >= 36 ? [3, 3] : meses >= 24 ? [2, 3] : [2, 2];
    return risco('REAJUSTE', {
      acao: 'reajuste',
      titulo: meses >= 24 ? `Sem reajuste há ${meses} meses` : `Aniversário do contrato passou (${meses} meses) sem reajuste na pasta`,
      descricao: `O último reajuste lido na pasta é de ${br(base)}${reajustes.length ? '' : ' (início do contrato — nenhum reajuste encontrado)'}. Reajuste não concedido na data-base pode ser pedido depois, com efeito retroativo.`,
      impactoDescricao: 'Passivo financeiro não previsto no orçamento (reajuste acumulado e retroativo).',
      tipo: 'Financeiro / Orçamentário', classificacao: 'Externa', categoria: 'Orçamentário',
      // Probabilidade baixa: é comum a contratada não pedir (ou renunciar).
      probabilidade: p, impacto: i,
      resposta: 'Verificar se a contratada renunciou ao reajuste (por escrito) ou provisionar o valor no orçamento.',
      fundamento: 'Lei 14.133/2021, art. 92, V e § 3º, e art. 135; Lei 8.666/1993, art. 40, XI, e art. 55, III.',
      evidencia: `Base: ${br(base)}; ${reajustes.length} termo(s) de reajuste na pasta.`
    });
  },

  // 6. Vigência que os documentos não comprovam.
  function vigenciaNaoComprovada(c, ctx) {
    if (ctx.termoNaoCalculado) {
      return risco('VIGENCIA_NAO_COMPROVADA', {
        titulo: 'Término da vigência não comprovado pelos documentos',
        descricao: ctx.avisoVigencia || 'O término não pôde ser calculado a partir dos documentos da pasta (falta a Ordem de Início, a assinatura ou o termo de prorrogação).',
        impactoDescricao: 'O prazo usado nos alertas pode estar errado — o contrato pode já ter vencido sem que ninguém perceba.',
        tipo: 'Conformidade', classificacao: 'Interna', categoria: 'Processo',
        probabilidade: 3, impacto: 3,
        resposta: 'Arquivar na pasta o documento que falta (normalmente a Ordem de Início) ou informar a data em "Pendências de leitura".',
        fundamento: 'Lei 14.133/2021, art. 92, VII (vigência como cláusula necessária) e art. 12, VI (processo com os atos documentados).',
        evidencia: ctx.avisoVigencia || 'Vigência sem término calculado.'
      });
    }
    /* Término contado da ASSINATURA porque a Ordem de Início não está na
       pasta (regra do usuário, 24/09/2026): é uma data calculada, não
       documentada — se a Ordem for posterior, o contrato vence depois. */
    if (ctx.marcoPresumido) {
      return risco('VIGENCIA_PRESUMIDA', {
        titulo: 'Término calculado a partir da assinatura (Ordem de Início não arquivada)',
        descricao: ctx.avisoVigencia || 'A vigência foi contada da assinatura porque a Ordem de Início não está nos documentos da pasta.',
        impactoDescricao: 'Se a Ordem de Início for posterior à assinatura, o contrato vence depois da data mostrada — alertas e prorrogação seriam antecipados.',
        tipo: 'Conformidade', classificacao: 'Interna', categoria: 'Processo',
        probabilidade: 2, impacto: 3,
        resposta: 'Arquivar a Ordem de Início na pasta "Ordem de Início de Serviço" do processo (o término é recalculado) ou informar a data em "Pendências de leitura".',
        fundamento: 'Lei 14.133/2021, art. 12, VI (processo com os atos documentados) e art. 92, VII.',
        evidencia: ctx.avisoVigencia || 'Início presumido pela assinatura.'
      });
    }
    return null;
  },

  // 7. Dependência de um mesmo fornecedor.
  function concentracaoDeFornecedor(c, ctx) {
    const cnpj = String(c.cnpjEmpresa || '').replace(/\D/g, '');
    if (cnpj.length !== 14) return null;
    const ativos = ctx.contratosAtivos;
    const doMesmo = ativos.filter(x => String(x.cnpjEmpresa || '').replace(/\D/g, '') === cnpj);
    const total = ativos.reduce((s, x) => s + (Number(x.valor) || 0), 0);
    const doFornecedor = doMesmo.reduce((s, x) => s + (Number(x.valor) || 0), 0);
    const pct = total ? doFornecedor / total * 100 : 0;
    if (doMesmo.length < 3 && pct < 25) return null;
    return risco('CONCENTRACAO', {
      titulo: `Dependência do fornecedor: ${doMesmo.length} contrato(s), ${pct.toFixed(0)}% do valor mensal`,
      descricao: 'Muitos contratos ou grande parte do gasto concentrados na mesma empresa. Problema nela (falência, sanção, greve) afeta vários serviços ao mesmo tempo.',
      impactoDescricao: 'Interrupção simultânea de serviços e perda de poder de negociação.',
      tipo: 'Estratégico', classificacao: 'Externa', categoria: 'Outro',
      probabilidade: 2, impacto: 4,
      resposta: 'Mapear os serviços críticos dessa empresa e ter plano de contingência para cada um.',
      fundamento: 'Lei 14.133/2021, art. 11, I (seleção da proposta mais vantajosa) e art. 18 (planejamento e gestão de riscos).',
      evidencia: `${doMesmo.length} contrato(s) ativos com o CNPJ ${c.cnpjEmpresa}; ${pct.toFixed(1)}% do valor mensal dos contratos ativos.`
    });
  },

  // 8. Termos só com extrato (o termo em si não está na pasta).
  function termoSemDocumento(c, ctx) {
    const soExtrato = ctx.termos.filter(t => t.soExtrato);
    if (!soExtrato.length) return null;
    return risco('TERMO_SEM_DOCUMENTO', {
      titulo: `${soExtrato.length} termo(s) só com extrato publicado`,
      descricao: 'A pasta tem a publicação do termo, mas não o termo assinado.',
      impactoDescricao: 'Sem o termo assinado, não há como conferir cláusulas (valor, prazo, condições) em auditoria.',
      tipo: 'Conformidade', classificacao: 'Interna', categoria: 'Processo',
      probabilidade: 2, impacto: 2,
      resposta: 'Arquivar o termo assinado na pasta "3. Contratos, Aditivos e Termos".',
      fundamento: 'Lei 14.133/2021, art. 12, VI, e art. 91 (formalização por escrito).',
      evidencia: soExtrato.map(t => `${t.especie} ${t.numero || ''}`.trim()).join(', ')
    });
  },

  /* 9. Valor mensal não cadastrado (28/09/2026 — vinha do eixo Financeiro
     do Mapa de risco). Sem dado não é "sem risco". Acordo de cooperação
     sem repasse não tem valor: não se aplica. */
  function valorNaoCadastrado(c, ctx) {
    if (Number(c.valor) > 0) return null;
    if (ctx.instrumento && ctx.instrumento.semRepasse) return null;
    return risco('VALOR_NAO_CADASTRADO', {
      titulo: 'Valor mensal não cadastrado',
      descricao: 'O cadastro não tem o valor mensal do contrato, e ele não pôde ser calculado dos documentos (valor global ou vigência não encontrados).',
      impactoDescricao: 'Sem o valor, não há como controlar acréscimos, reajuste, empenho e o peso do contrato na carteira.',
      tipo: 'Financeiro / Orçamentário', classificacao: 'Interna', categoria: 'Processo',
      probabilidade: 3, impacto: 3,
      resposta: 'Informar o valor mensal em "Pendências de leitura", conferido no contrato.',
      fundamento: 'Lei 14.133/2021, art. 92, V (preço como cláusula necessária).',
      evidencia: 'Campo "valor" vazio ou zero no cadastro.'
    });
  },

  /* 10. Pendências em aberto no Histórico administrativo do contrato
     (antes, só as tratativas; desde 06/10/2026 as tratativas são registros
     do histórico, ao lado das solicitações do TCE e dos diretores). */
  function tratativasEmAndamento(c, ctx) {
    const n = ctx.tratativasAbertas || 0;
    if (!n) return null;
    return risco('TRATATIVAS_ABERTAS', {
      titulo: `${n} registro(s) em aberto no histórico do contrato`,
      descricao: 'Há solicitações ou tratativas registradas no histórico deste contrato que ainda não foram respondidas ou concluídas.',
      impactoDescricao: 'Pendências abertas com a contratada tendem a virar atraso, glosa ou penalidade.',
      tipo: 'Operacional', classificacao: 'Interna', categoria: 'Processo',
      probabilidade: n >= 3 ? 4 : 3, impacto: 3,
      resposta: 'Acompanhar cada pendência até a resposta, registrando o desfecho no histórico do contrato.',
      fundamento: 'Lei 14.133/2021, art. 117, § 1º (registro das ocorrências da execução).',
      evidencia: `${n} registro(s) com situação "Em aberto" no histórico do contrato.`
    });
  },

  /* 11. Garantia contratual (28/09/2026). A apólice ou o comprovante fica em
     "16. Outros documentos" do processo; a validade vem do ofício que a
     encaminha ("vigência entre 13/02/2025 até 13/02/2026, referente ao
     Contrato nº 006/2025") — ver garantiaContratual.js. Medido: 006/2025
     com a garantia vencida em 13/02/2026 e o contrato até 13/02/2027.
     Só roda depois que "Recalcular pelas regras" procurou a garantia. */
  function garantiaContratual(c, ctx) {
    const g = ctx.garantia;
    if (!g || !g.verificada) return null;
    const lida = g.lida;
    if (!lida && g.documentos > 0) {
      return risco('GARANTIA_SEM_VALIDADE', {
        acao: 'garantia',
        titulo: 'Documento de garantia na pasta, mas a validade não foi lida',
        descricao: 'Há apólice ou comprovante de garantia no processo, mas o período de validade com o número deste contrato não foi encontrado no texto (documento digitalizado ou sem o número do contrato).',
        impactoDescricao: 'Não dá para saber se a garantia ainda cobre o contrato.',
        tipo: 'Financeiro / Orçamentário', classificacao: 'Interna', categoria: 'Processo',
        probabilidade: 2, impacto: 3,
        resposta: 'Conferir a validade na apólice e, se necessário, cobrar a renovação.',
        fundamento: 'Lei 14.133/2021, arts. 96 a 100; Lei 8.666/1993, art. 56.',
        evidencia: `${g.documentos} documento(s) de garantia no processo, sem período legível.`
      });
    }
    if (!lida) {
      if (!g.exigida) return null;
      return risco('GARANTIA_NAO_ARQUIVADA', {
        acao: 'garantia',
        titulo: 'Garantia exigida no contrato, mas o comprovante não está na pasta',
        descricao: 'O contrato prevê garantia contratual, e nenhuma apólice, caução ou fiança com o número deste contrato foi encontrada nos documentos do processo. A apólice original costuma ir para a Secretaria de Finanças; a pasta pode estar só sem a cópia.',
        impactoDescricao: 'Sem garantia vigente, a Prefeitura não tem como cobrir multa, prejuízo ou verbas trabalhistas se a contratada falhar.',
        tipo: 'Financeiro / Orçamentário', classificacao: 'Interna', categoria: 'Processo',
        /* 2 × 3 (Aceitar e monitorar): é lacuna de documentação — medido em
           28/09/2026, só 8 de 37 processos guardam a cópia da apólice, e os
           ofícios dizem que ela é "remetida à Secretaria de Finanças". */
        probabilidade: 2, impacto: 3,
        resposta: 'Localizar a apólice (ou comprovante de caução/fiança) e arquivar em "16. Outros documentos" do processo; se não houver, cobrar da contratada.',
        fundamento: 'Lei 14.133/2021, arts. 96 a 100; Lei 8.666/1993, art. 56.',
        evidencia: 'Cláusula de garantia lida no contrato; nenhum documento de garantia do contrato na pasta.'
      });
    }
    if (!lida.fim || c.status === 'Encerrado') return null;
    const dias = diasEntre(ctx.hoje, lida.fim);
    const ocr = lida.porOcr ? ' Data lida de documento digitalizado — confira na apólice.' : '';
    /* Contrato que JÁ terminou (29/09/2026): garantia vencida não é mais
       "cobrar a renovação" — é o período final que ficou sem garantia, o que
       só pesa se houver pendência com a contratada. Antes o 066/2020 dizia
       "o contrato continua em vigor" depois de vencido. */
    const contratoTerminou = c.termino && c.termino < ctx.hoje;
    if (dias < 0 && contratoTerminou) {
      if (lida.fim >= c.termino) return null;
      return risco('GARANTIA_VENCEU_ANTES_DO_FIM', {
        acao: 'garantia_historico',
        titulo: `Garantia venceu em ${br(lida.fim)}, antes do fim do contrato (${br(c.termino)})`,
        descricao: `O contrato já terminou, e de ${br(lida.fim)} a ${br(c.termino)} a execução ficou sem garantia lida na pasta (ou a renovação não foi arquivada).`,
        impactoDescricao: 'Multa, prejuízo ou verba trabalhista pendente desse período sem garantia para executar.',
        tipo: 'Financeiro / Orçamentário', classificacao: 'Externa', categoria: 'Orçamentário',
        probabilidade: 2, impacto: 3,
        resposta: 'Se houver pendência com a contratada (multa, verba trabalhista), cobrar diretamente; arquivar a renovação da garantia, se ela existiu.',
        fundamento: 'Lei 14.133/2021, arts. 96 a 100; Lei 8.666/1993, art. 56.',
        evidencia: `${lida.arquivo}: "${lida.citacao}".${ocr}`
      });
    }
    if (dias < 0) {
      return risco('GARANTIA_VENCIDA', {
        acao: 'garantia',
        titulo: `Garantia vencida em ${br(lida.fim)}${c.termino ? ` — o contrato vai até ${br(c.termino)}` : ''}`,
        descricao: 'A garantia mais recente arquivada na pasta perdeu a validade, e o contrato continua em vigor. Se a renovação foi entregue e não arquivada, basta arquivá-la no processo.',
        impactoDescricao: 'Multa, prejuízo ou verba trabalhista sem cobertura da garantia.',
        tipo: 'Financeiro / Orçamentário', classificacao: 'Externa', categoria: 'Orçamentário',
        probabilidade: 4, impacto: 4,
        resposta: 'Conferir se a renovação foi entregue (e arquivá-la em "16. Outros documentos"); se não, exigir da contratada o endosso da apólice.',
        fundamento: 'Lei 14.133/2021, arts. 96 a 100; Lei 8.666/1993, art. 56.',
        evidencia: `${lida.arquivo}: "${lida.citacao}".${ocr}`
      });
    }
    if (c.termino && lida.fim < c.termino) {
      return risco('GARANTIA_NAO_COBRE', {
        acao: 'garantia',
        titulo: `Garantia vale até ${br(lida.fim)}, antes do fim do contrato (${br(c.termino)})`,
        descricao: 'A garantia não cobre toda a vigência. Precisa ser renovada antes de vencer.',
        impactoDescricao: 'Período final do contrato sem garantia.',
        tipo: 'Financeiro / Orçamentário', classificacao: 'Externa', categoria: 'Orçamentário',
        probabilidade: dias <= 90 ? 4 : 3, impacto: 3,
        resposta: `Cobrar a renovação da garantia antes de ${br(lida.fim)}.`,
        fundamento: 'Lei 14.133/2021, arts. 96 a 100; Lei 8.666/1993, art. 56.',
        evidencia: `${lida.arquivo}: "${lida.citacao}".${ocr}`
      });
    }
    return null;
  }
];

/* Itens obrigatórios do checklist da Lei 14.133 (Mapa de risco, eixo
   Conteúdo) que faltam no contrato também entram no registro. */
function riscosDoChecklist(mapa) {
  const itens = ((mapa && mapa.checklist) || []).filter(x => x.obrigatorio !== false && ['nao_atende', 'nao_localizado'].includes(x.situacao));
  return itens.map(x => risco(`CHECKLIST_${String(x.id || x.item).toUpperCase()}`, {
    titulo: `Cláusula ausente ou insuficiente: ${x.item}`,
    descricao: `A análise do contrato não encontrou (ou achou insuficiente) a cláusula exigida: ${x.item}.`,
    impactoDescricao: 'Sem a cláusula, a Prefeitura não tem como exigir a obrigação ou aplicar a consequência prevista.',
    tipo: 'Conformidade', classificacao: 'Interna', categoria: 'Conformidade',
    probabilidade: x.situacao === 'nao_atende' ? 3 : 2, impacto: 4,
    resposta: 'Conferir no contrato assinado; se faltar, avaliar termo aditivo com a Procuradoria.',
    fundamento: x.referencia || 'Lei 14.133/2021, art. 92.',
    evidencia: `Mapa de risco (análise de ${br(mapa.geradoEm)}): "${x.situacao === 'nao_atende' ? 'Não atende' : 'Não localizado'}".`
  }));
}

/* Acordo/termo de cooperação pelo cadastro (caminho, objeto, tipo) — o
   Mapa de risco passa o que leu no texto, quando tem. */
function instrumentoPeloCadastro(c) {
  const { RE_COOPERACAO } = require('./checklistPorRegra');
  const cooperacao = RE_COOPERACAO.test([c.arquivoOrigem, c.objeto, c.tipo === 'Convênio' ? 'convênio' : ''].join(' \n '));
  return { cooperacao, semRepasse: cooperacao && !(Number(c.valor) > 0) };
}

/* Monta o contexto e roda as regras. `dados`: { contrato, proposta,
   termos, contratos, mapa, hoje, alertaConfig (prazos DO CONTRATO — ver
   prazosContrato.js), historico, instrumento }. */
function riscosAutomaticos(dados) {
  const { contrato: c } = dados;
  if (!c) return [];
  const hoje = dados.hoje || hojeLocal();
  const p = dados.proposta || {};
  const cv = p.calculoVigencia || {};
  const cval = p.calculoValor || {};
  const termos = dados.termos || [];
  const citacoes = [p.previaTexto, ...termos.map(t => t.objeto)].filter(Boolean).join(' ');
  const ctx = {
    hoje,
    termos,
    // Regime lido do texto completo na leitura (ver ingestaoContratos.js);
    // sem ele, pela prévia e pelos termos.
    regime: (p.regimeLegal && p.regimeLegal.lei) ? p.regimeLegal : regimeLegal(citacoes, c.inicio, c.numero),
    mesesTotais: cv.mesesTotal || null,
    valorInicial: cval.valorInicial || null,
    termoNaoCalculado: !c.termino || (p.id && !cv.termino && (cv.avisos || []).length > 0),
    avisoVigencia: (cv.avisos || [])[0] || null,
    marcoPresumido: !!cv.marcoPresumido,
    prepostoSemValor: (p.origemRegra && p.origemRegra.preposto_semValor) || null,
    contratosAtivos: (dados.contratos || []).filter(x => x.status !== 'Encerrado'),
    // Prazos de alerta DESTE contrato (perfil de trâmite ou Padrão — ver prazosContrato.js), os mesmos da tela.
    alertaConfig: { critico: 15, atencao: 30, proximo: 90, ...(dados.alertaConfig || {}) },
    // Acordo/termo de cooperação sem repasse: regras de dinheiro não se aplicam.
    instrumento: dados.instrumento || instrumentoPeloCadastro(c),
    // Cobertura dos relatórios mensais na pasta (relatoriosMensais.js); null se não lida.
    relatorios: dados.relatorios || null,
    tratativasAbertas: (dados.historico || []).filter(h => String(h.contratoId) === String(c.id) && h.situacao === 'aberta').length,
    garantia: {
      verificada: !!c.garantiaVerificadaEm,
      lida: c.garantiaLida || null,
      documentos: Number(c.garantiaDocumentos) || 0,
      // A cláusula de garantia foi lida no contrato (checklist do Mapa de risco).
      exigida: (((dados.mapa && dados.mapa.checklist) || []).find(x => x.id === 'garantia') || {}).situacao === 'atende'
        || ((((dados.mapa && dados.mapa.checklist) || []).find(x => x.id === 'garantia') || {}).situacao === 'atende_parcialmente')
    }
  };
  const achados = [];
  for (const regra of REGRAS) {
    try { const r = regra(c, ctx); if (r) achados.push({ ...r, regime: ctx.regime.lei }); }
    catch (e) { /* uma regra com dado estranho não derruba as outras */ }
  }
  achados.push(...riscosDoChecklist(dados.mapa));
  return achados.sort((a, b) => b.criticidade - a.criticidade);
}

/* ------------------------------------------------------------------
   Registro manual (as abas "Riscos" e "Issues" da planilha)
------------------------------------------------------------------ */
const CAMPOS_RISCO = ['natureza', 'status', 'dataCriacao', 'dataEncerramento', 'objetoEstudo', 'descricao', 'tipo',
  'classificacao', 'categoria', 'impactoDescricao', 'resposta', 'contingencia', 'responsavel', 'probabilidade',
  'impacto', 'criterioParaAceitacao', 'codigoAutomatico'];
const CAMPOS_ISSUE = ['titulo', 'status', 'dataReuniao', 'dataCriacao', 'dataEncerramento', 'prioridade', 'descricao',
  'fase', 'categoria', 'impactoDescricao', 'resposta', 'responsavel', 'riscoRelacionado'];

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const texto = (v, max) => (v === undefined || v === null) ? '' : String(v).trim().slice(0, max || 2000);

/* Valida contra as listas da planilha — valor fora da lista não é
   gravado (a planilha usa listas suspensas para o mesmo fim). */
function validarRisco(d) {
  const erros = [];
  const r = {};
  CAMPOS_RISCO.forEach(k => { r[k] = texto(d[k]); });
  r.natureza = NATUREZAS.includes(r.natureza) ? r.natureza : 'Risco';
  // Status vazio vira o padrão; status fora da lista é erro (antes virava
  // "Ativo" em silêncio e a tela dizia que tinha gravado).
  if (r.status && !STATUS_RISCO.includes(r.status)) erros.push(`Status deve ser um de: ${STATUS_RISCO.join(', ')}.`);
  if (!r.status) r.status = 'Ativo';
  if (r.tipo && !TIPOS_DE_RISCO.includes(r.tipo)) erros.push('Tipo de risco fora da lista.');
  if (r.classificacao && !CLASSIFICACOES[r.classificacao]) erros.push('Classificação deve ser Interna ou Externa.');
  if (r.categoria && r.classificacao && CLASSIFICACOES[r.classificacao] && !CLASSIFICACOES[r.classificacao].includes(r.categoria)) {
    erros.push(`Categoria "${r.categoria}" não pertence à classificação ${r.classificacao}.`);
  }
  for (const k of ['dataCriacao', 'dataEncerramento']) if (r[k] && !DATA_ISO.test(r[k])) erros.push(`Data inválida em ${k}.`);
  if (r.dataCriacao && r.dataEncerramento && r.dataEncerramento < r.dataCriacao) erros.push('A data de encerramento é anterior à de criação.');
  for (const k of ['probabilidade', 'impacto']) {
    const n = Number(r[k]);
    if (!(Number.isInteger(n) && n >= 1 && n <= 5)) erros.push(`${k === 'impacto' ? 'Impacto' : 'Probabilidade'} deve ser um número inteiro de 1 a 5.`);
    else r[k] = n;
  }
  if (!r.descricao && !r.codigoAutomatico) erros.push('Descreva o risco.');
  if (erros.length) throw new Error(erros.join(' '));
  r.criticidade = criticidade(r.probabilidade, r.impacto);
  r.criterio = criterioDeAceitacao(r.criticidade);
  return r;
}

function validarIssue(d) {
  const erros = [];
  const r = {};
  CAMPOS_ISSUE.forEach(k => { r[k] = texto(d[k]); });
  if (r.status && !STATUS_ISSUE.includes(r.status)) erros.push(`Status deve ser um de: ${STATUS_ISSUE.join(', ')}.`);
  if (!r.status) r.status = 'Em progresso';
  if (r.prioridade && !PRIORIDADES.includes(r.prioridade)) erros.push('Prioridade fora da lista.');
  if (r.fase && !FASES.includes(r.fase)) erros.push('Fase fora da lista.');
  if (r.categoria && !CATEGORIAS_ISSUE.includes(r.categoria)) erros.push('Categoria fora da lista.');
  for (const k of ['dataReuniao', 'dataCriacao', 'dataEncerramento']) if (r[k] && !DATA_ISO.test(r[k])) erros.push(`Data inválida em ${k}.`);
  if (r.dataCriacao && r.dataEncerramento && r.dataEncerramento < r.dataCriacao) erros.push('A data de encerramento é anterior à de criação.');
  if (!r.titulo) erros.push('Dê um título ao problema.');
  if (erros.length) throw new Error(erros.join(' '));
  // "Vigência do problema" (coluna G da planilha): dias entre criação e encerramento.
  r.duracaoDias = (r.dataCriacao && r.dataEncerramento) ? diasEntre(r.dataCriacao, r.dataEncerramento) : null;
  return r;
}

function proximoId(lista) {
  return (lista || []).reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;
}

function registrar(db, contratoId, tipoRegistro, dados, usuario) {
  if (!['risco', 'issue'].includes(tipoRegistro)) throw new Error('Tipo de registro inválido.');
  if (!(db.contratos || []).some(c => String(c.id) === String(contratoId))) throw new Error('Contrato não encontrado.');
  const campos = tipoRegistro === 'risco' ? validarRisco(dados || {}) : validarIssue(dados || {});
  if (!Array.isArray(db.registroRiscos)) db.registroRiscos = [];
  const agora = new Date().toISOString();
  const registro = {
    id: proximoId(db.registroRiscos),
    contratoId: Number(contratoId) || contratoId,
    registro: tipoRegistro,
    ...campos,
    dataCriacao: campos.dataCriacao || agora.slice(0, 10),
    criadoPor: usuario || 'Usuário', criadoEm: agora,
    atualizadoPor: usuario || 'Usuário', atualizadoEm: agora
  };
  db.registroRiscos.push(registro);
  return registro;
}

function atualizar(db, contratoId, id, dados, usuario) {
  const r = (db.registroRiscos || []).find(x => String(x.id) === String(id) && String(x.contratoId) === String(contratoId));
  if (!r) throw new Error('Registro não encontrado.');
  const campos = r.registro === 'risco' ? validarRisco({ ...r, ...(dados || {}) }) : validarIssue({ ...r, ...(dados || {}) });
  Object.assign(r, campos, { atualizadoPor: usuario || 'Usuário', atualizadoEm: new Date().toISOString() });
  return r;
}

/* Tudo o que a tela mostra de um contrato: o "Painel" da planilha, os
   riscos automáticos (com a resposta que o gestor registrou para eles,
   se houver), os riscos e os problemas registrados à mão. */
function montarRegistro(db, contratoId, hoje, opcoes = {}) {
  const c = (db.contratos || []).find(x => String(x.id) === String(contratoId));
  if (!c) return null;
  const proposta = (db.importacoesPendentes || []).filter(p => p.status === 'aprovado' && String(p.contratoId) === String(c.id))
    .sort((a, b) => String(b.aprovadoEm || '').localeCompare(String(a.aprovadoEm || '')))[0] || null;
  const termos = [...(db.aditivos || []).map(t => ({ ...t, especie: 'Aditivo' })), ...(db.apostilamentos || []).map(t => ({ ...t, especie: 'Apostilamento' }))]
    .filter(t => t.contrato === c.numero || String(t.contratoId) === String(c.id))
    .map(t => ({ ...t, soExtrato: t.soExtrato || false }));
  const mapa = (db.mapasRisco || []).filter(m => String(m.contratoId) === String(c.id))
    .sort((a, b) => String(b.geradoEm || '').localeCompare(String(a.geradoEm || '')))[0] || null;

  const manuais = (db.registroRiscos || []).filter(r => String(r.contratoId) === String(c.id));
  const tratamentoDoAutomatico = new Map(manuais.filter(r => r.registro === 'risco' && r.codigoAutomatico).map(r => [r.codigoAutomatico, r]));

  const automaticos = riscosAutomaticos({ contrato: c, proposta, termos, contratos: db.contratos, mapa, hoje, alertaConfig: require('./prazosContrato').faixasDoContrato(db, c.id), historico: db.historicoContratos, instrumento: opcoes.instrumento,
    relatorios: (() => { try { return require('./relatoriosMensais').coberturaDoContrato(db, c, hoje ? new Date(`${hoje}T12:00:00`) : new Date()); } catch (e) { return null; } })() })
    .map(a => {
      const tratado = tratamentoDoAutomatico.get(a.codigo);
      if (!tratado) return a;
      // O gestor registrou resposta/status para o risco automático: vale o dele.
      return {
        ...a, tratamentoId: tratado.id,
        status: tratado.status || a.status,
        resposta: tratado.resposta || a.resposta,
        contingencia: tratado.contingencia || null,
        responsavel: tratado.responsavel || null,
        probabilidade: tratado.probabilidade || a.probabilidade,
        impacto: tratado.impacto || a.impacto,
        criticidade: tratado.criticidade || a.criticidade,
        criterio: tratado.criterio || a.criterio,
        faixa: faixaDeCriticidade(tratado.criticidade || a.criticidade),
        atualizadoPor: tratado.atualizadoPor, atualizadoEm: tratado.atualizadoEm
      };
    });

  const riscos = manuais.filter(r => r.registro === 'risco' && !r.codigoAutomatico)
    .map(r => ({ ...r, faixa: faixaDeCriticidade(r.criticidade) }))
    .sort((a, b) => (b.criticidade || 0) - (a.criticidade || 0));
  const issues = manuais.filter(r => r.registro === 'issue')
    .sort((a, b) => String(b.dataCriacao || '').localeCompare(String(a.dataCriacao || '')));

  const ativos = [...automaticos, ...riscos].filter(r => r.status === 'Ativo');
  const ultima = manuais.map(r => r.atualizadoEm).filter(Boolean).sort().pop() || null;
  const ultimoGestor = termos.filter(t => t.gestor || t.fiscal).sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));

  return {
    painel: {
      contrato: c.numero, pa: c.pa || null, contratada: c.empresa || null, objeto: c.objeto || null,
      gestor: c.responsavel || null, suplenteGestor: c.suplente || null,
      fiscal: (ultimoGestor.find(t => t.fiscal) || {}).fiscal || null,
      inicio: c.inicio || null, termino: c.termino || null, valorMensal: c.valor ?? null,
      dataUltimaRevisao: ultima
    },
    automaticos, riscos, issues,
    resumo: {
      riscosAtivos: ativos.length,
      maiorCriticidade: ativos.reduce((m, r) => Math.max(m, r.criticidade || 0), 0),
      porCriterio: ativos.reduce((acc, r) => { if (r.criterio) acc[r.criterio] = (acc[r.criterio] || 0) + 1; return acc; }, {}),
      issuesAbertos: issues.filter(i => ['Em progresso', 'Adiado'].includes(i.status)).length,
      // Matriz 5×5 (probabilidade × impacto) com a contagem de riscos ativos.
      matriz: ativos.reduce((m, r) => { const k = `${r.probabilidade}x${r.impacto}`; m[k] = (m[k] || 0) + 1; return m; }, {})
    }
  };
}

/* Visão de todos os contratos para a lista do Mapa de risco. */
function resumirTodos(db, hoje) {
  return (db.contratos || []).map(c => {
    const r = montarRegistro(db, c.id, hoje);
    return { contratoId: c.id, ...r.resumo, faixa: faixaDeCriticidade(r.resumo.maiorCriticidade), criterio: criterioDeAceitacao(r.resumo.maiorCriticidade) };
  });
}

const LISTAS = { ESCALA_PROBABILIDADE, ESCALA_IMPACTO, TIPOS_DE_RISCO, CLASSIFICACOES, STATUS_RISCO, NATUREZAS, STATUS_ISSUE, PRIORIDADES, FASES, CATEGORIAS_ISSUE };

module.exports = {
  LISTAS, criticidade, criterioDeAceitacao, faixaDeCriticidade, regimeLegal,
  riscosAutomaticos, montarRegistro, resumirTodos, registrar, atualizar,
  _paraTeste: { validarRisco, validarIssue, REGRAS, riscosDoChecklist, instrumentoPeloCadastro }
};

/* ------------------------------------------------------------------
   Exportação no LAYOUT DA PLANILHA — mesmas colunas das abas "Riscos" e
   "Issues", na mesma ordem, para colar no modelo do SGC se for preciso.
------------------------------------------------------------------ */
const planilhaCsv = require('./planilhaCsv');
const { hojeLocal } = require('./dataLocal');
const dataBr = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '';

function gerarCsvRiscos(registro) {
  const cabecalho = ['Id. do RISCO', 'Status', 'Risco, Oportunidade?', 'Data da criação', 'Data do encerramento',
    'OBJETO DO ESTUDO (Fonte do Risco)', 'DESCRIÇÃO do RISCO (Risco Primário)', 'TIPO de RISCO', 'CLASSIFICAÇÃO', 'CATEGORIA',
    'DESCRIÇÃO do IMPACTO (Risco Secundário)', 'DESCRIÇÃO DA RESPOSTA (Plano de ação)', 'DESCRIÇÃO DA CONTINGÊNCIA',
    'RESPONSÁVEL', 'PROBABILIDADE', 'IMPACTO (Severidade)', 'CRITICIDADE (Nível de risco)', 'CRITÉRIO de ACEITAÇÃO',
    'CRITÉRIO para ACEITAÇÃO', 'Origem', 'Fundamento legal', 'Evidência'];
  const linhas = [...registro.automaticos, ...registro.riscos].map(r => [
    r.automatico ? r.codigo : r.id, r.status, r.natureza || 'Risco', dataBr(r.dataCriacao), dataBr(r.dataEncerramento),
    r.objetoEstudo || '', r.automatico ? `${r.titulo}. ${r.descricao || ''}` : (r.descricao || ''), r.tipo || '', r.classificacao || '', r.categoria || '',
    r.impactoDescricao || '', r.resposta || '', r.contingencia || '', r.responsavel || '',
    r.probabilidade || '', r.impacto || '', r.criticidade || '', r.criterio || '', r.criterioParaAceitacao || '',
    r.automatico ? 'Automático (documentos)' : 'Registrado pelo gestor', r.fundamento || '', r.evidencia || ''
  ]);
  return planilhaCsv.montar(cabecalho, linhas);
}

function gerarCsvIssues(registro) {
  const cabecalho = ['Id. do Problema', 'Título', 'Status', 'Data da reunião', 'Data da criação', 'Data do encerramento',
    'Vigência do Problema (dias)', 'PRIORIDADE', 'DESCRIÇÃO do PROBLEMA', 'FASE DO PROJETO (Contrato)', 'CATEGORIA',
    'DESCRIÇÃO do IMPACTO', 'DESCRIÇÃO DA RESPOSTA (Plano de ação)', 'RESPONSÁVEL', 'Risco relacionado'];
  const linhas = registro.issues.map(i => [
    i.id, i.titulo, i.status, dataBr(i.dataReuniao), dataBr(i.dataCriacao), dataBr(i.dataEncerramento),
    i.duracaoDias ?? '', i.prioridade || '', i.descricao || '', i.fase || '', i.categoria || '',
    i.impactoDescricao || '', i.resposta || '', i.responsavel || '', i.riscoRelacionado || ''
  ]);
  return planilhaCsv.montar(cabecalho, linhas);
}

module.exports.gerarCsvRiscos = gerarCsvRiscos;
module.exports.gerarCsvIssues = gerarCsvIssues;
