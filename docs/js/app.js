/* ===================================================================
   js/app.js — telas da Central de Contratos (módulo ES de entrada).

   Os outros módulos: js/api.js (conversa com o servidor), js/util.js
   (escape, datas, dinheiro, comparação) e js/ui.js (ícones, cards,
   tabelas, filtros). Sem framework e sem etapa de build: o navegador
   carrega os módulos direto (index.html, <script type="module">).
=================================================================== */
import { COLORS, SERIES, ajuda, badge, chipRisco, esqueleto, icon, searchBox, segmentos, seletorDeFiltro, statCard, table } from './ui.js';
import { chaveDoNumero, compararValores, dataHora, esc, escAttr, formatBytesArquivo, formatDataCurta, formatDate, formatarCnpj, hojeIsoLocal, idCurto, money, numBr, reaisUfm, tempoRelativo } from './util.js';
import { aoExpirarSessao, api } from './api.js';


/* ===================== API ===================== */


/* ===================== DATA MODEL (carregado do servidor) ===================== */
let TODAY = new Date();
// Data de hoje (aaaa-mm-dd) pelo relógio local, a mesma de TODAY.
const hojeIso = () => `${TODAY.getFullYear()}-${String(TODAY.getMonth()+1).padStart(2,'0')}-${String(TODAY.getDate()).padStart(2,'0')}`;


let TIPOS_SERVICO = [];
let SECRETARIAS_NOMES = [];
let PAPEIS = [];
let contas = [];

let contratos = [];
let alertaConfig = { critico:15, atencao:30, proximo:90 };
/* Criticidade por contrato (06/10/2026): perfis de trâmite e os prazos dos
   contratos que não estão no Padrão (os demais usam alertaConfig). */
let perfisPrazo = { perfis:[], contratosComPrazoProprio:0 };
let faixasContrato = {};
/* Histórico administrativo: registros em aberto (aviso do Início). */
let historicoPendentes = [];
/* Por contrato: { total, abertos } — cor do sino na coluna Ações de Contratos. */
let historicoResumo = {};
/* Valor total de cada contrato: valor inicial + aditivos/apostilamentos de
   valor (o numerador da média mensal). { [contratoId]: { valor, meses } } */
let valoresTotais = {};
/* Contratos com término, valor ou gestor mudado por termo novo, esperando
   confirmação (Pendências de leitura) — ver mudancasPorTermos.js. */
let mudancasPendentes = [];
const valorTotalDe = c => (valoresTotais[c.id] ? valoresTotais[c.id].valor : null);
/* Mesma lista de integrations/historicoContrato.js (o servidor confere). */
const HIST_TIPOS = { solicitacao_tce:'Solicitação do TCE', solicitacao_diretor:'Solicitação de diretor/secretário', oficio_recebido:'Ofício recebido', oficio_enviado:'Ofício enviado', despacho:'Despacho', notificacao_contratada:'Notificação à contratada', reuniao:'Reunião', tratativa:'Tratativa interna', outro:'Outro' };
const HIST_SITUACOES = { aberta:'Em aberto', respondida:'Respondida', concluida:'Concluída', informativo:'Só registro' };
const faixasDe = c => faixasContrato[c.id] || alertaConfig;
const prazosIndividuais = () => Object.keys(faixasContrato).length > 0;
let currentUser = null;

/* Aditivos e apostilamentos do cadastro (telas próprias e detalhe do contrato). */
let aditivos = [];
let apostilamentos = [];
let integracaoStatus = null;
let integracaoCarregando = false;
let contasCarregadas = false;
let contasCarregando = false;
let auditoria = [];
let auditoriaCarregada = false;
let auditoriaCarregando = false;
let alertaEmailStatus = null;
let alertaEmailCarregando = false;
let arquivosStatus = null;
let arquivosStatusCarregando = false;
let importacoes = [];
let importacoesCarregadas = false;
let importacoesCarregando = false;
let varreduraEmAndamento = false; // true tanto durante a varredura automática quanto durante uma extração manual (ver comProgresso) — o backend usa o mesmo mutex pras duas, então a tela trata as duas como uma coisa só que "ocupa" a IA local
let progressoVarreduraAtual = null; // { emAndamento, totalGrupos, grupoAtual, pastaAtual, etapa } — ver comProgresso()
let painelManualAberto = false; // seção "Selecionar arquivos manualmente" expandida ou não
let manualPilha = []; // breadcrumb: [{nome, caminho}, ...] da raiz até a pasta atual (raiz = pilha vazia)
let manualConteudo = null; // { caminho, pastas:[{nome,caminho}], arquivos:[{nome,caminho,tamanho,modificadoEm}] } da pasta atual
let manualCarregando = false;
let manualSelecionados = new Set(); // caminhos de arquivo marcados pra extração
let mapasRiscoDados = null;
let mapasRiscoCarregando = false;
let mapasRiscoGerandoIds = new Set(); // contratoIds com geração em andamento, pra desabilitar o botão só daquela linha
let conferenciaSgcDados = null;
let conferenciaSgcCarregando = false;
let baseContratosDados = null;
let baseContratosCarregando = false;
let fichasCadastroDados = null;
let fichasCadastroCarregando = false;
let fichasCadastroGerandoIds = new Set(); // contratoIds com geração de ficha em andamento


/* ===================== HELPERS ===================== */
/* null quando o contrato não tem término conhecido (vigência não lida dos
   documentos) — antes o sistema gravava "hoje" para não quebrar aqui. */
function daysUntil(iso){ if(!iso) return null; const [y,m,d]=String(iso).split('-').map(Number); if(!y||!m||!d) return null; return Math.round((new Date(y,m-1,d)-TODAY)/86400000); }

function classificarContrato(c){
  if(c.status==='Encerrado') return 'Encerrado';
  const d = daysUntil(c.termino);
  if(d===null) return 'Sem término';
  if(d<0) return 'Vencido';
  const f = faixasDe(c); // prazos do perfil de trâmite do contrato, ou o Padrão
  if(d<=f.critico) return 'Crítico';
  if(d<=f.atencao) return 'Atenção';
  if(d<=f.proximo) return 'Próximo';
  return 'Confortável';
}
function prazoTexto(c){
  const d = daysUntil(c.termino);
  if(d===null) return 'Término não informado';
  if(d<0) return `Venceu há ${Math.abs(d)} dia(s)`;
  if(d===0) return 'Vence hoje';
  return `Vence em ${d} dia(s)`;
}

/* Risco por contrato — o MESMO do Mapa de risco (25/09/2026), calculado no
   servidor (mapaRiscoContratos.riscoAtualDoContrato) e entregue no
   /api/bootstrap. Antes havia aqui uma fórmula própria (valor mensal a
   partir de R$ 20 mil pesando muito): 17 dos 27 contratos apareciam com
   um risco no Painel e outro no Mapa. `resumo` explica o nível (título do
   selo). */
let riscosPorContrato = {};
function calcularRisco(c){
  const r = riscosPorContrato[c.id];
  if(!r) return { pontos: -1, nivel: 'Sem análise', resumo: 'Risco ainda não calculado para este contrato.' };
  if(r.encerrado) return { pontos: -1, nivel: 'Encerrado', resumo: r.resumo };
  const rotulo = { alto:'Alto risco', medio:'Médio risco', baixo:'Baixo risco' }[r.nivel] || 'Sem análise';
  return { pontos: r.pontos, nivel: rotulo + (r.parcial ? ' (parcial)' : ''), rotuloBase: rotulo, parcial: r.parcial, resumo: r.resumo };
}
// Selo de risco com o porquê ao passar o mouse; "parcial" (cláusulas não analisadas) sai neutro.
function seloRisco(c){
  const r = calcularRisco(c);
  const cls = r.parcial || !r.rotuloBase ? 'badge-muted' : ({'Alto risco':'badge-critical','Médio risco':'badge-warning','Baixo risco':'badge-good'}[r.rotuloBase]||'badge-muted');
  return `<span class="badge ${cls}" title="${escAttr(r.resumo||'')}">${esc(r.nivel)}</span>`;
}


function donutChart(data,size){
  size = size||150;
  // Sem nenhum contrato: anel neutro e 0 no centro (antes mostrava 1).
  const soma = data.reduce((s,d)=>s+d.value,0);
  const total = soma || 1;
  let acc=0;
  const stops = data.map(d=>{ const start=acc/total*360; acc+=d.value; const end=acc/total*360; return `${d.color} ${start}deg ${end}deg`; }).join(', ');
  const legend = data.map(d=>`<div class="legend-row"><span class="legend-dot" style="background:${d.color}"></span><span class="legend-label">${esc(d.label)}</span><span class="legend-value">${d.value} · ${Math.round(d.value/total*100)}%</span></div>`).join('');
  return `<div class="donut-wrap">
    <div class="donut" style="width:${size}px;height:${size}px;background:${soma ? `conic-gradient(${stops})` : 'var(--surface-3)'}">
      <div class="donut-hole"><div class="donut-total">${soma}</div><div class="donut-total-label">Contratos ativos</div></div>
    </div>
    <div class="legend">${legend}</div>
  </div>`;
}

/* `formatar` (opcional): como escrever o número ao lado da barra. Sem
   ele, o valor em reais saía cru ("18644298") no Painel. */
/* Rótulo vazio (ex.: contrato sem secretaria no cadastro) aparece como
   "Não informado", em cinza — antes a linha ficava sem nome. */
function barList(data, formatar, rotuloVazio){
  const max = Math.max(...data.map(d=>d.value),1);
  return `<div class="bar-list">${data.map(d=>{
    const rotulo = String(d.label==null?'':d.label).trim();
    const valor = formatar?formatar(d.value):d.value;
    return `
    <div class="bar-row">
      <div class="bar-label${rotulo?'':' vazio'}" title="${escAttr(rotulo || rotuloVazio || 'Não informado')}">${esc(rotulo || rotuloVazio || 'Não informado')}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(d.value/max*100).toFixed(1)}%;background:${d.color}"></div></div>
      <div class="bar-value${Number(d.value)?'':' zero'}" title="${escAttr(String(valor))}">${valor}</div>
    </div>`;}).join('')}</div>`;
}


/* Cabeçalho ordenável: clicar alterna crescente/decrescente. O estado fica
   em state.filters[filtroId] como "chave:asc|desc". */
function thOrdenavel(chave, rotulo, filtroId, classe){
  const [atual, dir] = String(state.filters[filtroId]||'').split(':');
  const ativo = atual===chave;
  const prox = ativo && dir==='asc' ? 'desc' : 'asc';
  return `<th class="${classe||''}" aria-sort="${ativo?(dir==='asc'?'ascending':'descending'):'none'}"><button type="button" class="th-ordenar${ativo?' ativo':''}" onclick="app.setFilter('${filtroId}','${chave}:${prox}')" title="Ordenar por ${escAttr(rotulo)}">${rotulo}<span class="seta" aria-hidden="true">${ativo?(dir==='asc'?'▲':'▼'):'↕'}</span></button></th>`;
}


function contratoActionsCell(idx){
  const c = contratos[idx];
  return `<div class="row-actions acoes-em-linha">
    ${(()=>{ // Sino: vermelho com registro em andamento; verde com tudo encerrado; neutro sem registro.
      const h = historicoResumo[c.id];
      const [classe, estado] = !h || !h.total ? ['', 'nada registrado'] : h.abertos ? ['sino-aberto', `${h.abertos} em andamento`] : ['sino-encerrado', 'tudo encerrado'];
      return `<button type="button" class="icon-btn ${classe}" title="Histórico do contrato: ${estado}" aria-label="Histórico do contrato ${escAttr(c.numero||'')}: ${estado}" onclick="app.openHistorico(${c.id})">${icon('bell',14)}</button>`; })()}
  </div>`;
}


/* ===================== STATE ===================== */
const state = { view:'inicio', param:null, filters:{} };

/* Menu organizado pela TAREFA de quem usa (22/09/2026): acompanhar
   contratos; trabalhar os documentos; conferir a qualidade do SGC;
   administrar. Antes, "Integrações" misturava a sincronização técnica com
   as ferramentas do dia a dia. */
/* Menu (07/10/2026): o do dia a dia à vista; configuração e administração
   num grupo recolhível. [id, rótulo, ícone, só admin] */
const NAV = [
  { group:'', items:[
      ['inicio','Início','home'],
      ['painel','Painel de indicadores','chart']
  ] },
  { group:'Contratos', items:[
      ['contratos','Contratos','doc'],
      ['aditivos','Aditivos','docMais'],
      ['apostilamentos','Apostilamentos','docNota'],
      ['mapaRisco','Mapa de risco','shield'],
      ['relatoriosMensais','Relatórios mensais','calendario'],
      ['requisicoes','Requisições','stamp'],
      ['ufm','UFM e gratificação','coin']
  ] },
  { group:'Documentos', items:[
      ['importacoes','Fila de importação','inbox'],
      ['baseContratos','Base de dados','grid'],
      ['buscaDocumentos','Busca nos documentos','search'],
      ['pendenciasLeitura','Pendências de leitura','alerta'],
      ['conferenciaSgc','Conferência com o SGC','layers']
  ] },
  { group:'Configurações', id:'config', recolhivel:true, icone:'engrenagem', items:[
      ['config','Alertas de vencimento','bell'],
      ['integracoes','Sincronização com o SGC','email'],
      ['contas','Contas de acesso','lock', true],
      ['auditoria','Trilha de auditoria','relogio', true],
      ['leiturasReportadas','Leituras reportadas','bandeira', true]
  ] }
];
const CHAVE_MENU_CONFIG = 'central-contratos:menu-configuracoes';
function grupoAberto(g){
  if(g.items.some(([id])=>id===telaDoMenu())) return true; // a tela aberta está nele
  try{ return localStorage.getItem(CHAVE_MENU_CONFIG)==='1'; }catch(e){ return false; }
}
function alternarGrupoDoMenu(){
  const aberto = !(document.getElementById('grupo-config-itens') || {}).hidden;
  try{ localStorage.setItem(CHAVE_MENU_CONFIG, aberto ? '0' : '1'); }catch(e){}
  renderSidebar();
}
const VIEW_LABELS = Object.fromEntries(NAV.flatMap(g=>g.items).map(([id,label])=>[id,label]));

/* ===================== VIEWS ===================== */
function renderInicio(){
  const ativos = contratos.filter(c=>c.status!=='Encerrado');
  const bandas = { 'Vencido':[], 'Crítico':[], 'Atenção':[], 'Próximo':[], 'Confortável':[], 'Sem término':[] };
  ativos.forEach(c=>{ const b = classificarContrato(c); if(bandas[b]) bandas[b].push(c); });
  const encerrados = contratos.filter(c=>c.status==='Encerrado').length;

  const donutData = [
    {label:'Vencido',value:bandas['Vencido'].length,color:COLORS.critical},
    {label:'Crítico',value:bandas['Crítico'].length,color:COLORS.serious},
    {label:'Atenção',value:bandas['Atenção'].length,color:COLORS.warning},
    {label:'Próximo',value:bandas['Próximo'].length,color:COLORS.muted},
    {label:'Confortável',value:bandas['Confortável'].length,color:COLORS.good},
    {label:'Sem término',value:bandas['Sem término'].length,color:'#b8c2d0'}
  ].filter(x=>x.value || x.label!=='Sem término');

  const porTipo = {}; ativos.forEach(c=>{ porTipo[c.tipo]=(porTipo[c.tipo]||0)+1; });
  const tipoData = Object.entries(porTipo).sort((a,b)=>b[1]-a[1]).map(([label,value],i)=>({label,value,color:SERIES[i%SERIES.length]}));

  const bandOrder = [
    ['Vencido', COLORS.critical],
    ['Crítico', COLORS.serious],
    ['Atenção', COLORS.warning],
    ['Próximo', COLORS.muted]
  ];
  const alertSections = bandOrder.map(([nome,color])=>{
    const lista = bandas[nome];
    if(!lista.length) return '';
    const rows = lista.slice().sort((a,b)=>daysUntil(a.termino)-daysUntil(b.termino)).map(c=>{
      const idx = contratos.indexOf(c);
      return `<div class="alert-row clicavel" onclick="if(!event.target.closest('button,a'))app.viewContrato(${idx})">
        <div class="alert-row-main">
          <div class="alert-row-title"><a class="alert-row-link" href="#/contrato/${c.id}">${esc(c.numero)} · ${esc(c.empresa)}</a></div>
          <div class="alert-row-sub">${esc(c.tipo)} · Responsável: ${esc(c.responsavel)}</div>
        </div>
        <div class="alert-row-days" style="color:color-mix(in srgb, ${color} 50%, var(--text))">${prazoTexto(c)}</div>
        <div class="alert-row-actions">
          ${podeEscrever() ? `<button type="button" class="icon-btn" onclick="app.registrarNoHistorico(${c.id})" title="Registrar no histórico" aria-label="Registrar no histórico do contrato ${escAttr(c.numero)}">${icon('edit',14)}</button>` : ''}
          <span class="seta-linha" aria-hidden="true">${icon('chevronLeft',14)}</span>
        </div>
      </div>`;
    }).join('');
    return `<div class="alert-band">
      <div class="alert-band-header"><span class="badge ${nome==='Vencido'?'badge-critical':nome==='Crítico'?'badge-serious':nome==='Atenção'?'badge-warning':'badge-muted'}">${nome}</span><span class="alert-band-count">${lista.length} contrato(s)</span></div>
      ${rows}
    </div>`;
  }).join('');

  return `
    <div class="page-header"><div><h1 class="page-title">Visão geral dos contratos</h1><p class="page-subtitle">Secretaria Municipal de Tecnologia · ${TODAY.toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'})}</p></div></div>
    ${montarAvisoRespostasTce()}
    ${montarAvisoHistorico()}
    ${montarAvisoMudancas()}
    <div class="stat-grid">
      ${statCard('bell',COLORS.critical,bandas['Vencido'].length,'Vencidos', null, "app.goToBand('Vencido')")}
      ${statCard('bell',COLORS.serious,bandas['Crítico'].length, prazosIndividuais() ? 'Críticos' : `Críticos (≤ ${alertaConfig.critico} dias)`, prazosIndividuais() ? 'pelo prazo de cada contrato' : null, "app.goToBand('Crítico')")}
      ${statCard('bell',COLORS.warning,bandas['Atenção'].length, prazosIndividuais() ? 'Atenção' : `Atenção (≤ ${alertaConfig.atencao} dias)`, prazosIndividuais() ? 'pelo prazo de cada contrato' : null, "app.goToBand('Atenção')")}
      ${statCard('doc',COLORS.muted,bandas['Próximo'].length, prazosIndividuais() ? 'Próximos' : `Próximos (≤ ${alertaConfig.proximo} dias)`, prazosIndividuais() ? 'pelo prazo de cada contrato' : null, "app.goToBand('Próximo')")}
    </div>
    <div class="resumo-faixas">
      <button type="button" class="chip-resumo" onclick="app.goToBand('Confortável')"><span class="ponto ok"></span><b>${bandas['Confortável'].length}</b> confortáveis</button>
      <button type="button" class="chip-resumo" onclick="app.goToBand('Encerrado')"><span class="ponto"></span><b>${encerrados}</b> encerrados</button>
      ${bandas['Sem término'].length ? `<button type="button" class="chip-resumo aviso" onclick="app.goToBand('Sem término')" title="Resolva em Pendências de leitura"><span class="ponto warn"></span><b>${bandas['Sem término'].length}</b> sem término informado</button>` : ''}
    </div>
    <div class="grid-2">
      <div class="card"><h2 class="card-title">Situação dos contratos em vigência</h2><p class="card-subtitle">Distribuição por urgência de vencimento</p>${donutChart(donutData)}</div>
      <div class="card"><h2 class="card-title">Tipos de serviço</h2><p class="card-subtitle">Distribuição dos contratos ativos por categoria</p>${barList(tipoData.length?tipoData:[{label:'Sem dados',value:0,color:COLORS.muted}])}</div>
    </div>
    <div class="card">
      <h2 class="card-title">Avisos</h2><p class="card-subtitle">Dos mais urgentes aos menos urgentes — clique para abrir o contrato</p>
      ${alertSections || `<div class="empty-state">${icon('shield',34)}<div class="empty-state-title">Nenhum alerta no momento</div><div>Todos os contratos ativos estão fora das faixas de atenção configuradas.</div></div>`}
    </div>`;
}

/* Histórico administrativo (06/10/2026): pedidos com prazo de resposta em
   aberto — atrasados e os que vencem em até 5 dias em destaque. */
function montarAvisoHistorico(){
  const urgentes = historicoPendentes.filter(p=>p.situacao==='atrasada' || p.situacao==='vence_logo');
  if(!urgentes.length) return '';
  const linha = p => `<li><button type="button" class="link-btn" onclick="app.openHistorico(${p.contratoId})">Contrato ${esc(p.numero)}</button> · ${esc(p.tipoRotulo)}${p.solicitante?` (${esc(p.solicitante)})`:''}${p.documento?` · ${esc(p.documento)}`:''} — <span style="font-weight:600;">${p.dias<0?`atrasado ${-p.dias} dia(s)`:p.dias===0?'vence hoje':`vence em ${p.dias} dia(s)`}</span> (${formatDate(p.prazoResposta)})</li>`;
  return `<div class="callout callout-warn" style="margin:0 0 16px;align-items:flex-start;">${icon('bell',16)}<div style="flex:1;">
      <b>Pedidos registrados no histórico aguardando resposta</b>
      <ul style="margin:6px 0 0 18px;padding:0;">${urgentes.map(linha).join('')}</ul>
    </div></div>`;
}

/* Término, valor ou gestor mudados por termo novo, esperando confirmação. */
function montarAvisoMudancas(){
  if(!mudancasPendentes.length) return '';
  const linha = m => `<li><a href="#/contrato/${Number(m.contratoId)}">Contrato ${esc(m.numero)}</a> · ${esc(m.campos.join(', '))}${m.naFila?' <span class="cel-sub">(proposta nova na Fila)</span>':''}</li>`;
  return `<div class="callout callout-warn" style="margin:0 0 16px;align-items:flex-start;">${icon('bell',16)}<div style="flex:1;">
      <b>Termos novos mudam dados de contratos — confirme</b>
      <ul style="margin:6px 0 0 18px;padding:0;">${mudancasPendentes.map(linha).join('')}</ul>
      <div style="margin-top:8px;"><button type="button" class="btn-ghost btn-small" onclick="app.setView('pendenciasLeitura')">Abrir Pendências de leitura</button></div>
    </div></div>`;
}

/* Requisições do TCE com resposta pendente (01/10/2026): atrasadas e as que
   vencem em até 5 dias aparecem em destaque; as no prazo, numa linha. */
function montarAvisoRespostasTce(){
  const urgentes = respostasTce.filter(r=>r.situacao==='atrasada' || r.situacao==='vence_logo');
  const noPrazo = respostasTce.filter(r=>r.situacao==='no_prazo');
  if(!urgentes.length && !noPrazo.length) return '';
  const linha = r => `<li><b>${esc(r.requisicao)}</b>${r.contrato?` · contrato ${esc(r.contrato)}`:''} · prazo ${formatDate(r.prazo)} — <span style="font-weight:600;">${esc(r.rotulo)}</span>${r.origem==='enviada'?' <span class="cel-sub">(enviada pela tela)</span>':''}</li>`;
  return `<div class="callout ${urgentes.length?'callout-warn':'callout-info'}" style="margin:0 0 16px;align-items:flex-start;">${icon('bell',16)}<div style="flex:1;">
      <b>Requisições do Tribunal de Contas aguardando resposta</b>
      ${urgentes.length?`<ul style="margin:6px 0 0 18px;padding:0;">${urgentes.map(linha).join('')}</ul>`:''}
      ${noPrazo.length?`<div class="cel-sub" style="margin-top:6px;">No prazo: ${noPrazo.map(r=>`${esc(r.requisicao)} (até ${formatDate(r.prazo)})`).join('; ')}</div>`:''}
      <div style="margin-top:8px;"><button type="button" class="btn-ghost btn-small" onclick="app.setFilter('aba-req','tce');app.setView('requisicoes')">Abrir Requisições</button></div>
    </div></div>`;
}

/* Soma no rodapé da tabela (Contratos e Base de dados): total dos
   contratos listados e, à parte, o mensal dos que estão em vigência.
   Contrato sem valor total calculado fica fora da soma, e isso é dito. */
function somaDosValores(itens){
  const comTotal = itens.filter(i=>i.total!=null);
  if(!comTotal.length) return '';
  const total = comTotal.reduce((s,i)=>s+Number(i.total),0);
  const mensais = itens.filter(i=>i.mensal!=null && i.mensal!=='' && Number(i.mensal));
  const mensal = mensais.reduce((s,i)=>s+Number(i.mensal),0);
  const fora = itens.length - comTotal.length;
  return `<span class="soma-valores" title="Valor total = valor inicial + aditivos e apostilamentos de valor, somado nos contratos listados${fora?` (${fora} sem o cálculo do valor ficam fora)`:''}">
      Valor total: <b>${money(total)}</b>${fora?` <span class="cel-sub">(${comTotal.length} de ${itens.length})</span>`:''}${mensais.length?` · mensal em vigência: <b>${money(mensal)}</b>`:''}
    </span>`;
}

function renderContratos(){
  const q = (state.filters['search-contratos']||'').toLowerCase();
  const fBand = state.filters['filter-band-contratos']||'';
  const fTipo = state.filters['filter-tipo-contratos']||'';
  const filtered = contratos
    .filter(c=>(c.numero+c.empresa+c.tipo+c.responsavel).toLowerCase().includes(q))
    .filter(c=> !fBand || classificarContrato(c)===fBand)
    .filter(c=> !fTipo || c.tipo===fTipo);

  // Ordenação por coluna, como na Base de dados (02/10/2026).
  if(!state.filters['ordem-contratos']) state.filters['ordem-contratos'] = 'numero:desc';
  const [ordChave, ordDir] = state.filters['ordem-contratos'].split(':');
  const ORDEM_SITUACAO = ['Vencido','Crítico','Atenção','Próximo','Confortável','Sem término','Encerrado'];
  const chaveOrdem = c => ({
    numero: chaveDoNumero(c.numero), empresa: c.empresa, tipo: c.tipo,
    situacao: ORDEM_SITUACAO.indexOf(classificarContrato(c)),
    risco: (r => r.pontos < 0 ? null : r.pontos)(calcularRisco(c)),
    termino: c.termino || null, valor: Number(c.valor) || null, valorTotal: valorTotalDe(c), responsavel: c.responsavel
  })[ordChave];
  const ordenados = filtered.slice().sort((a, b) => compararValores(chaveOrdem(a), chaveOrdem(b), ordDir));
  // Número fixo à esquerda e ações fixas à direita: a tabela rola para o
  // lado em tela menor, mas "qual contrato" e "abrir" ficam à vista. A
  // linha inteira abre os detalhes; os botões servem ao teclado.
  const rows = ordenados.map(c=>{ const idx=contratos.indexOf(c); return `<tr class="linha-clicavel" onclick="if(!event.target.closest('button,a'))app.viewContrato(${idx})">
      <td class="col-fixa-esq"><a class="cel-contrato-num link-linha" href="#/contrato/${c.id}">${esc(c.numero)}</a></td>
      <td><span class="celula-texto" title="${escAttr(c.empresa||'')}">${esc(c.empresa)}</span></td>
      <td>${esc(c.tipo)}</td><td class="col-situacao">${badge(classificarContrato(c))}</td><td>${seloRisco(c)}</td>
      <td class="num nowrap">${formatDate(c.termino)}</td><td class="num nowrap">${money(c.valor)}</td><td class="num nowrap">${valorTotalDe(c)!=null?money(valorTotalDe(c)):'<span class="cel-vazia" title="Sem o cálculo do valor (valor inicial e termos)">—</span>'}</td><td>${esc(c.responsavel)}</td>
      <td class="col-fixa-dir">${contratoActionsCell(idx)}</td></tr>`; });
  const filtrando = q || fBand || fTipo;
  const limpar = `<button type="button" class="link-btn" onclick="app.limparFiltros(['search-contratos','filter-band-contratos','filter-tipo-contratos'])">limpar filtros</button>`;
  const cabecalhos = [
    thOrdenavel('numero', 'Contrato', 'ordem-contratos', 'col-fixa-esq'),
    thOrdenavel('empresa', 'Empresa', 'ordem-contratos'),
    thOrdenavel('tipo', 'Tipo', 'ordem-contratos'),
    thOrdenavel('situacao', 'Situação', 'ordem-contratos'),
    thOrdenavel('risco', 'Risco', 'ordem-contratos'),
    thOrdenavel('termino', 'Término', 'ordem-contratos', 'num'),
    thOrdenavel('valor', 'Valor mensal', 'ordem-contratos', 'num'),
    thOrdenavel('valorTotal', 'Valor total', 'ordem-contratos', 'num'),
    thOrdenavel('responsavel', 'Responsável', 'ordem-contratos'),
    '<th class="col-fixa-dir">Histórico</th>'
  ];

  return `
    <div class="page-header">
      <div><h1 class="page-title">Contratos</h1><p class="page-subtitle">${window.__sgcDesligado ? 'Contratos lidos dos documentos da pasta de rede e aprovados na Fila de importação' : 'Contratos sincronizados a partir do SGC e lidos da pasta de rede'}</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn-ghost" onclick="app.exportContratosCSV()">${icon('download',15)} Exportar CSV</button>
      </div>
    </div>
    <div class="card">
      <div class="toolbar">
        ${searchBox('search-contratos','Buscar por número, empresa, tipo ou responsável...', state.filters['search-contratos'])}
        <select class="filter-select" aria-label="Situação" onchange="app.setFilter('filter-band-contratos', this.value)">
          <option value="">Todas as situações</option>
          ${['Vencido','Crítico','Atenção','Próximo','Confortável','Sem término','Encerrado'].map(s=>`<option value="${s}" ${fBand===s?'selected':''}>${s}</option>`).join('')}
        </select>
        <select class="filter-select" aria-label="Tipo de serviço" onchange="app.setFilter('filter-tipo-contratos', this.value)">
          <option value="">Todos os tipos</option>
          ${TIPOS_SERVICO.map(t=>`<option value="${t}" ${fTipo===t?'selected':''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="tabela-meta">
        <span><b>${filtered.length}</b> de ${contratos.length} contrato(s)${filtrando?` · ${limpar}`:''}</span>
        ${somaDosValores(filtered.map(c=>({ mensal: c.status==='Encerrado' ? null : c.valor, total: valorTotalDe(c) })))}
      </div>
      ${table(cabecalhos, rows, {pagina:true, vazio:`Nenhum contrato encontrado${filtrando?` · ${limpar}`:''}`})}
    </div>`;
}

function renderConfiguracoes(){
  const souAdmin = currentUser && currentUser.role==='admin';
  const foraDoPadrao = contratos.filter(c=>faixasContrato[c.id]);
  const linhasPerfis = perfisPrazo.perfis.map(p=>`<tr>
      <td><b>${esc(p.nome)}</b>${p.descricao?`<div class="cel-sub">${esc(p.descricao)}</div>`:''}</td>
      <td class="num">${p.critico}</td><td class="num">${p.atencao}</td><td class="num">${p.proximo}</td><td class="num">${p.contratos}</td>
      <td class="num">${souAdmin?`<div class="row-actions acoes-em-linha">
        <button type="button" class="icon-btn" title="Editar" aria-label="Editar o perfil ${escAttr(p.nome)}" onclick="app.editarPerfilPrazo('${escAttr(p.id)}')">${icon('edit',14)}</button>
        ${p.padrao?'':`<button type="button" class="icon-btn danger" title="Excluir" aria-label="Excluir o perfil ${escAttr(p.nome)}" onclick="app.excluirPerfilPrazo('${escAttr(p.id)}')">${icon('close',14)}</button>`}</div>`:''}</td></tr>`);
  const cardPerfis = `<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">
        <div><h2 class="card-title">Perfis de trâmite</h2><p class="card-subtitle">Dias antes do término em que o contrato entra em cada faixa. Cada contrato usa um perfil (no detalhe do contrato, "Prazos de alerta"); sem escolha, vale o Padrão.</p></div>
        ${souAdmin?`<button type="button" class="btn-primary btn-small" onclick="app.editarPerfilPrazo()">${icon('plus',13)} Novo perfil</button>`:''}
      </div>
      ${table(['Perfil','<th class="num">Crítico</th>','<th class="num">Atenção</th>','<th class="num">Próximo</th>','<th class="num">Contratos</th>','<th class="num">Ações</th>'], linhasPerfis)}
    </div>
    ${foraDoPadrao.length?`<div class="card"><h2 class="card-title">Contratos com prazo diferente do Padrão</h2><p class="card-subtitle">${foraDoPadrao.length} contrato(s)</p>
      ${table(['Contrato','Prazos','Motivo','Definido por'], foraDoPadrao.map(c=>{ const f = faixasContrato[c.id]; return `<tr class="linha-clicavel" onclick="app.viewContrato(${contratos.indexOf(c)})"><td class="nowrap"><b>${esc(c.numero)}</b><div class="cel-sub">${esc(c.empresa)}</div></td><td>${esc(f.nome)}<div class="cel-sub">${f.critico} / ${f.atencao} / ${f.proximo} dias</div></td><td>${esc(f.motivo||'—')}</td><td>${esc(f.definidoPor||'—')}${f.definidoEm?`<div class="cel-sub">${formatDate(String(f.definidoEm).slice(0,10))}</div>`:''}</td></tr>`; }))}
    </div>`:''}`;
  return cardPerfis + `
    ${ajuda('Cada contrato tem trâmites diferentes na Prefeitura: uma prorrogação por aditivo leva um tempo, uma nova licitação leva meses. Crie um <b>perfil de trâmite</b> para cada caso (crítico, atenção e próximo em dias antes do término) e escolha o perfil no detalhe de cada contrato, em "Prazos de alerta" — ou dê prazos próprios a um contrato, com o motivo. A classificação (Vencido, Crítico, Atenção, Próximo, Confortável) vale igual no Início, em Contratos, no e-mail de alertas e no eixo Prazo do Mapa de risco. Mudar um perfil muda todos os contratos dele; tudo fica na Trilha de auditoria.')}`;
}
function editarPerfilPrazo(id){
  const p = id ? perfisPrazo.perfis.find(x=>x.id===id) : null;
  const campos = [
    ...(p && p.padrao ? [] : [{name:'nome', label:'Nome do perfil', required:true, value: p && p.nome, hint:'Ex.: Prorrogação por aditivo, Nova licitação, Serviço contínuo essencial.'},
      {name:'descricao', label:'Descrição (opcional)', value: p && p.descricao}]),
    {name:'critico', label:'Crítico — até quantos dias antes do término', type:'number', required:true, value: p ? p.critico : ''},
    {name:'atencao', label:'Atenção — até quantos dias antes do término', type:'number', required:true, value: p ? p.atencao : ''},
    {name:'proximo', label:'Próximo — até quantos dias antes do término', type:'number', required:true, value: p ? p.proximo : ''}
  ];
  openForm(p ? `Editar perfil — ${esc(p.nome)}` : 'Novo perfil de trâmite', campos, async d=>{
    aplicarRespostaDosPrazos(await api.salvarPerfilPrazo(p ? p.id : null, d));
  }, { successMessage: p ? 'Perfil atualizado — vale para todos os contratos dele.' : 'Perfil criado.', intro: p && p.contratos ? `${p.contratos} contrato(s) usam este perfil e mudam junto.` : undefined });
}
async function excluirPerfilPrazo(id){
  const p = perfisPrazo.perfis.find(x=>x.id===id); if(!p) return;
  const ok = await confirmDialog(`Excluir o perfil "${esc(p.nome)}"?`, { danger:true, confirmLabel:'Excluir' });
  if(!ok) return;
  try{ aplicarRespostaDosPrazos(await api.excluirPerfilPrazo(id)); toast('Perfil excluído.', 'success'); render(); }
  catch(err){ toast(err.message, 'error'); }
}

function renderPainel(){
  const ativos = contratos.filter(c=>c.status!=='Encerrado');
  const valorTotal = ativos.reduce((s,c)=>s+(Number(c.valor)||0),0);

  // Sem secretaria no cadastro: grupo vazio, mostrado como "Secretaria não informada".
  const porSecretaria = {}; ativos.forEach(c=>{ const k=String(c.secretaria||'').trim(); porSecretaria[k]=(porSecretaria[k]||0)+(Number(c.valor)||0); });
  const secretariaData = Object.entries(porSecretaria).sort((a,b)=>b[1]-a[1]).map(([label,value],i)=>({label,value,color:SERIES[i%SERIES.length]}));

  const porTipo = {}; ativos.forEach(c=>{ porTipo[c.tipo]=(porTipo[c.tipo]||0)+1; });
  const tipoData = Object.entries(porTipo).sort((a,b)=>b[1]-a[1]).map(([label,value],i)=>({label,value,color:SERIES[i%SERIES.length]}));

  const porAno = {}; contratos.forEach(c=>{ const y=c.inicio ? String(c.inicio).slice(0,4) : 'Sem data'; porAno[y]=(porAno[y]||0)+1; });
  const anoData = Object.entries(porAno).sort((a,b)=>a[0].localeCompare(b[0])).map(([label,value])=>({label,value,color:COLORS.s1}));

  const porEmpresa = {}; ativos.forEach(c=>{ const k=String(c.empresa||'').trim(); porEmpresa[k]=(porEmpresa[k]||0)+(Number(c.valor)||0); });
  const empresaData = Object.entries(porEmpresa).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([label,value],i)=>({label,value,color:SERIES[i%SERIES.length]}));

  // Prioriza pelo risco do Mapa (cláusulas, prazo e financeiro — o pior dos
  // três, com os pontos desempatando) em vez de só pela data de vencimento.
  const riscoRanking = ativos
    .map(c=>({ c, risco:calcularRisco(c) }))
    .sort((a,b)=>b.risco.pontos-a.risco.pontos)
    .slice(0,5);
  const riscoRows = riscoRanking.map(({c,risco})=>`<div class="alert-row clicavel" onclick="if(!event.target.closest('a,button'))app.viewContrato(${contratos.indexOf(c)})">
      <div class="alert-row-main">
        <div class="alert-row-title"><a class="alert-row-link" href="#/contrato/${c.id}">${esc(c.numero)} · ${esc(c.empresa)}</a></div>
        <div class="alert-row-sub linhas-2">${esc(risco.resumo || `${c.tipo} · ${money(c.valor)}/mês`)}</div>
      </div>
      <div class="alert-row-days">${seloRisco(c)}</div>
      <span class="seta-linha" aria-hidden="true">${icon('chevronLeft',14)}</span>
    </div>`).join('');

  return `
    <div class="page-header"><div><h1 class="page-title">Painel de indicadores</h1><p class="page-subtitle">Visão consolidada de valores e distribuição dos contratos</p></div></div>
    <div class="stat-grid">
      ${statCard('doc',COLORS.s1,contratos.length,'Total de contratos')}
      ${statCard('doc',COLORS.good,ativos.length,'Contratos ativos')}
      ${statCard('chart',COLORS.s6,money(valorTotal),'Valor mensal contratado')}
    </div>
    <div class="grid-2">
      <div class="card"><h2 class="card-title">Valor contratado por secretaria</h2><p class="card-subtitle">Soma do valor mensal dos contratos ativos</p>${barList(secretariaData.length?secretariaData:[{label:'Sem dados',value:0,color:COLORS.muted}], money, 'Secretaria não informada')}</div>
      <div class="card"><h2 class="card-title">Contratos por tipo de serviço</h2><p class="card-subtitle">Contratos ativos por categoria</p>${donutChart(tipoData.length?tipoData:[{label:'Sem dados',value:1,color:COLORS.muted}],140)}</div>
    </div>
    <div class="grid-2">
      <div class="card"><h2 class="card-title">Evolução por ano</h2><p class="card-subtitle">Contratos por ano de início</p>${barList(anoData.length?anoData:[{label:'Sem dados',value:0,color:COLORS.muted}])}</div>
      <div class="card"><h2 class="card-title">Empresas com maior valor</h2><p class="card-subtitle">Soma do valor mensal dos contratos em vigência de cada empresa</p>${barList(empresaData.length?empresaData:[{label:'Sem dados',value:0,color:COLORS.muted}], money, 'Empresa não informada')}</div>
    </div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
        <div><h2 class="card-title">Maior risco</h2><p class="card-subtitle">Os 5 contratos ativos de maior risco (o pior dos quatro eixos do Mapa de risco)</p></div>
        <a class="btn-ghost btn-small" href="#/mapaRisco" style="text-decoration:none;">Ver todos no Mapa de risco</a>
      </div>
      ${riscoRows || `<div class="related-empty">Nenhum contrato ativo para calcular risco.</div>`}
    </div>`;
}


/* ===================== INTEGRAÇÃO COM O SGC (desligada) =====================
   Status da sincronização e o cartão dos alertas por e-mail. Com a
   integração desligada, a tela mostra só os alertas por e-mail. */

function carregarIntegracaoStatus(){
  if(integracaoCarregando) return;
  integracaoCarregando = true;
  api.integracaoStatus().then(s=>{
    integracaoStatus = s; integracaoCarregando = false;
    if(state.view==='integracoes') render();
  }).catch(err=>{
    integracaoStatus = { erro: err.message }; integracaoCarregando = false;
    if(state.view==='integracoes') render();
  });
}

function carregarAlertaEmailStatus(){
  if(alertaEmailCarregando) return;
  alertaEmailCarregando = true;
  api.alertaEmailStatus().then(s=>{
    alertaEmailStatus = s; alertaEmailCarregando = false;
    if(state.view==='integracoes') render();
  }).catch(err=>{
    alertaEmailStatus = { erro: err.message }; alertaEmailCarregando = false;
    if(state.view==='integracoes') render();
  });
}

async function enviarResumoAlertasAgora(){
  const ok = await confirmDialog('Enviar agora o resumo de alertas por e-mail para todos os responsáveis (e destinatários fixos)?', { confirmLabel:'Enviar agora' });
  if(!ok) return;
  try{
    const resultado = await api.alertaEmailEnviarAgora();
    alertaEmailStatus = null; // força recarregar o status (último envio mudou)
    if(resultado.enviado){
      toast(`Resumo enviado — ${resultado.totalContratos} contrato(s) em alerta.`, 'success');
    } else {
      toast(resultado.motivo || 'Nada foi enviado.', 'info');
    }
  }catch(err){ toast(err.message, 'error'); }
  render();
}

function carregarContas(){
  if(contasCarregando) return;
  contasCarregando = true;
  Promise.all([api.listarContas(), api.listarPedidosAcesso().catch(()=>({ entraLigado:false, pedidos:[] }))]).then(([lista, p])=>{
    contas = lista; pedidosAcesso = p.pedidos || []; entraLigado = !!p.entraLigado;
    contasCarregadas = true; contasCarregando = false;
    if(state.view==='contas') render();
  }).catch(err=>{
    contasCarregando = false;
    if(state.view==='contas'){ toast(err.message,'error'); render(); }
  });
}

const PAPEL_LABEL = { admin:'Administrador', gestor:'Gestor', fiscal:'Fiscal', consulta:'Consulta' };
/* Login com a conta da Prefeitura (06/10/2026): quem tentou entrar sem ter
   conta na Central aparece aqui para um admin liberar. */
let pedidosAcesso = [];
let entraLigado = false;

function renderContas(){
  if(!contasCarregadas && !contasCarregando) carregarContas();
  if(!contasCarregadas){
    return `
      <div class="page-header"><div><h1 class="page-title">Contas de acesso</h1><p class="page-subtitle">Login e papéis de quem usa a Central de Contratos</p></div></div>
      <div class="card"><p class="card-subtitle">Carregando contas...</p></div>`;
  }
  const comoEntra = c => {
    const partes = [];
    if(c.email) partes.push(`<span class="nowrap">${icon('users',13)} Conta da Prefeitura</span><span class="cel-sub" style="display:block;">${esc(c.email)}${c.ligadaAoAd?'':' · ainda não entrou'}</span>`);
    if(c.temSenha) partes.push(`<span class="nowrap">${icon('lock',13)} Senha da Central</span>`);
    return partes.join('<br>') || '<span class="cel-sub">—</span>';
  };
  const rows = contas.map((c,idx)=>`<tr>
    <td>${esc(c.usuario)}</td><td>${esc(c.nome)}</td><td>${comoEntra(c)}</td><td>${badge(PAPEL_LABEL[c.role]||c.role)}</td>
    <td><div class="row-actions">
      <button class="icon-btn" title="Editar" aria-label="Editar a conta ${escAttr(c.usuario)}" onclick="app.editConta(${idx})">${icon('edit',14)}</button>
      ${c.id===(currentUser&&currentUser.id) ? '' : `<button class="icon-btn danger" title="Excluir" aria-label="Excluir a conta ${escAttr(c.usuario)}" onclick="app.deleteConta(${idx})">${icon('close',14)}</button>`}
    </div></td></tr>`);
  return `
    <div class="page-header">
      <div><h1 class="page-title">Contas de acesso</h1><p class="page-subtitle">Quem entra na Central de Contratos e o que cada um pode fazer</p></div>
      <button class="btn-primary" onclick="app.newConta()">${icon('plus',15)} Nova conta</button>
    </div>
    ${entraLigado ? '' : `<div class="callout callout-info" style="margin:0 0 16px;">${icon('users',16)}<span>O login com a conta da Prefeitura (Microsoft) ainda não está ligado: falta a TI registrar a Central no Entra ID e passar os IDs para o <code>.env</code> (ver README, "Login com a conta da Prefeitura"). Enquanto isso, só as contas com senha entram.</span></div>`}
    ${pedidosAcesso.length ? `<div class="card">
      <h2 class="card-title">Pedidos de acesso</h2><p class="card-subtitle">Entraram com a conta da Prefeitura, mas ainda não têm conta na Central</p>
      ${table(['Nome','E-mail da Prefeitura','Tentou entrar em','<th class="num">Ações</th>'], pedidosAcesso.map(p=>`<tr>
        <td>${esc(p.nome)}</td><td>${esc(p.email)}</td><td class="nowrap">${dataHora(p.em,{dateStyle:'short',timeStyle:'short'})}</td>
        <td class="num"><div class="row-actions acoes-em-linha">
          <button type="button" class="btn-primary btn-small" onclick="app.liberarPedidoAcesso('${escAttr(p.oid)}')">${icon('plus',13)} Liberar acesso</button>
          <button type="button" class="btn-ghost btn-small" onclick="app.dispensarPedidoAcesso('${escAttr(p.oid)}')">Dispensar</button>
        </div></td></tr>`))}
    </div>` : ''}
    <div class="card">
      <h2 class="card-title">Contas</h2><p class="card-subtitle">${contas.length} conta(s)</p>
      ${table(['Usuário','Nome','Entra com','Papel','<th class="num">Ações</th>'], rows)}
    </div>`;
}

function contaFields(it){
  return [
    {name:'usuario', label:'Usuário (login)', required:!it, value: it&&it.usuario},
    {name:'nome', label:'Nome', required:true, value: it&&it.nome},
    {name:'email', label:'E-mail da Prefeitura', type:'email', value: it&&it.email,
      hint:'Para entrar com a conta da Prefeitura (Microsoft), a mesma do e-mail. Com ele, a senha é opcional.'},
    {name:'role', label:'Papel', type:'select', options:PAPEIS, required:true, value: it ? it.role : 'consulta'},
    {name:'senha', label: it?'Nova senha (deixe em branco para manter)':'Senha da Central', type:'password',
      hint: it ? '' : 'Obrigatória só sem e-mail da Prefeitura. Mínimo de 10 caracteres.'}
  ];
}
/* pre: dados de um pedido de acesso (nome e e-mail já preenchidos). */
function newConta(pre){
  const campos = contaFields(pre ? { usuario: pre.email.split('@')[0], nome: pre.nome, email: pre.email, role: 'consulta' } : null);
  openForm(pre ? 'Liberar acesso' : 'Nova conta', campos, async d=>{
    if(!d.senha) delete d.senha;
    const rec = await api.criarConta(d);
    contas.push(rec);
    if(rec.email) pedidosAcesso = pedidosAcesso.filter(p => p.email !== rec.email);
  }, { successMessage: pre ? 'Acesso liberado. A pessoa já pode entrar com a conta da Prefeitura.' : 'Conta criada.',
       intro: pre ? 'Escolha o papel. A pessoa entra com a conta da Prefeitura, sem senha da Central.' : undefined });
}
function liberarPedidoAcesso(oid){
  const p = pedidosAcesso.find(x => x.oid === oid); if(!p) return;
  newConta(p);
}
async function dispensarPedidoAcesso(oid){
  const p = pedidosAcesso.find(x => x.oid === oid); if(!p) return;
  const ok = await confirmDialog(`Dispensar o pedido de ${esc(p.nome)}? A pessoa continua sem acesso; se tentar entrar de novo, o pedido volta.`, { confirmLabel:'Dispensar' });
  if(!ok) return;
  try{ await api.dispensarPedidoAcesso(oid); }catch(err){ toast(err.message, 'error'); return; }
  pedidosAcesso = pedidosAcesso.filter(x => x.oid !== oid);
  render();
}
function editConta(idx){
  const it = contas[idx]; if(!it) return;
  const campos = contaFields(it).filter(f=>f.name!=='usuario'); // usuário não muda depois de criado
  openForm(`Editar conta — ${esc(it.usuario)}`, campos, async d=>{
    if(!d.senha) delete d.senha;
    d.email = (d.email || '').trim();
    const rec = await api.atualizarConta(it.id, d);
    Object.assign(it, rec);
  }, { submitLabel:'Salvar alterações', successMessage:'Conta atualizada.' });
}
async function deleteConta(idx){
  const it = contas[idx]; if(!it) return;
  const ok = await confirmDialog(`Excluir a conta "${esc(it.usuario)}"? Quem estiver logado com ela perde o acesso imediatamente.`, { danger:true, confirmLabel:'Excluir' });
  if(!ok) return;
  try{ await api.excluirConta(it.id); }catch(err){ toast(err.message, 'error'); return; }
  contas.splice(idx,1);
  render();
  toast('Conta excluída.', 'success');
}

function carregarAuditoria(){
  if(auditoriaCarregando) return;
  auditoriaCarregando = true;
  api.listarAuditoria().then(lista=>{
    auditoria = lista; auditoriaCarregada = true; auditoriaCarregando = false;
    if(state.view==='auditoria') render();
  }).catch(err=>{
    auditoriaCarregando = false;
    if(state.view==='auditoria'){ toast(err.message,'error'); render(); }
  });
}

const ACAO_LABEL = { criar:'Criação', editar:'Edição', excluir:'Exclusão', sincronizar:'Leitura das pastas', aprovar:'Aprovação', rejeitar:'Rejeição', gerar:'Geração', exportar:'Exportação', consultar:'Consulta', corrigir:'Correção automática', login:'Entrada', 'login-falhou':'Entrada recusada' };
const ENTIDADE_LABEL = { sessao:'Acesso', contrato:'Contrato', requisicao:'Requisição', relatorio_mensal:'Relatório mensal', registro_riscos:'Registro de riscos', leitura_reportada:'Leitura reportada', ficha_sgc:'Ficha do SGC', conferencia_sgc:'Conferência SGC', busca_documentos:'Busca nos documentos', base_termos:'Aditivos e apostilamentos', comentario:'Comentário', ufm:'UFM / gratificação', historico:'Histórico do contrato', perfil_prazo:'Perfil de trâmite', conta:'Conta de acesso', tratativa:'Tratativa', configuracao:'Configuração de alerta', importacao:'Importação de arquivo', mapa_risco:'Mapa de risco', ficha_cadastro:'Ficha de cadastro', base_contratos:'Base de contratos' };

/* Registros antigos (da época da IA) terminam em "Modelo: null." — só na
   tela: o registro gravado na trilha não é alterado. */
function detalheDaAuditoria(t){
  const limpo = String(t || '').replace(/\s*Modelo:\s*(null|undefined)\.?/g, '').trim();
  return limpo || '—';
}

function renderAuditoria(){
  if(!auditoriaCarregada && !auditoriaCarregando) carregarAuditoria();
  if(!auditoriaCarregada){
    return `
      <div class="page-header"><div><h1 class="page-title">Trilha de auditoria</h1><p class="page-subtitle">Quem fez o quê, e quando, nas telas que gravam dados</p></div></div>
      <div class="card"><p class="card-subtitle">Carregando registros...</p></div>`;
  }
  const q = (state.filters['search-auditoria']||'').toLowerCase();
  const fAcao = state.filters['filter-acao-auditoria']||'';
  const fEntidade = state.filters['filter-entidade-auditoria']||'';
  const entidadesPresentes = [...new Set(auditoria.map(a=>a.entidade))];
  const filtered = auditoria
    .filter(a=>(a.usuario+' '+(a.detalhes||'')).toLowerCase().includes(q))
    .filter(a=> !fAcao || a.acao===fAcao)
    .filter(a=> !fEntidade || a.entidade===fEntidade);
  const rows = filtered.map(a=>`<tr>
    <td>${dataHora(a.data)}</td>
    <td>${esc(a.usuario)}</td>
    <td>${esc(PAPEL_LABEL[a.papel]||a.papel||'—')}</td>
    <td>${esc(ACAO_LABEL[a.acao]||a.acao||'—')}</td>
    <td>${esc(ENTIDADE_LABEL[a.entidade]||a.entidade||'—')}</td>
    <td>${esc(detalheDaAuditoria(a.detalhes))}</td></tr>`);
  return `
    <div class="page-header">
      <div><h1 class="page-title">Trilha de auditoria</h1><p class="page-subtitle">Quem fez o quê e quando — só leitura, restrito a administradores</p></div>
    </div>
    <div class="card">
      <h2 class="card-title">Registros</h2><p class="card-subtitle">${filtered.length} de ${auditoria.length} registros</p>
      <div class="toolbar">
        ${searchBox('search-auditoria','Buscar por usuário ou detalhes...', state.filters['search-auditoria'])}
        <select class="filter-select" aria-label="Ação" onchange="app.setFilter('filter-acao-auditoria', this.value)">
          <option value="">Todas as ações</option>
          ${[...new Set(auditoria.map(a=>a.acao))].sort((x,y)=>String(ACAO_LABEL[x]||x).localeCompare(String(ACAO_LABEL[y]||y))).map(a=>`<option value="${esc(a)}" ${fAcao===a?'selected':''}>${esc(ACAO_LABEL[a]||a)}</option>`).join('')}
        </select>
        <select class="filter-select" aria-label="Entidade" onchange="app.setFilter('filter-entidade-auditoria', this.value)">
          <option value="">Todas as entidades</option>
          ${entidadesPresentes.map(e=>`<option value="${e}" ${fEntidade===e?'selected':''}>${ENTIDADE_LABEL[e]||e}</option>`).join('')}
        </select>
      </div>
      ${table(['Data/hora','Usuário','Papel','Ação','Entidade','Detalhes'], rows, {pagina:true})}
    </div>`;
}

/* Cartão do resumo diário de alertas por e-mail (Microsoft Graph). Fica
   separado porque aparece em duas telas: junto da sincronização com o SGC
   e, com a integração desligada, sozinho em "Alertas por e-mail". */
function montarCardEmailAlertas(){
  const souAdmin = currentUser && currentUser.role==='admin';
  const es = alertaEmailStatus;
  let emailCard;
  if(alertaEmailCarregando && !es){
    emailCard = `<div class="card">${esqueleto(3, 'Consultando o resumo por e-mail')}</div>`;
  } else if(!es || es.erro){
    emailCard = `<div class="card"><div class="empty-state">${icon('shield',30)}<div class="empty-state-title">Não foi possível consultar o status</div><div>${(es&&es.erro)||'Tente novamente em instantes.'}</div></div></div>`;
  } else {
    const ultimoResultado = es.ultimoResultado || {};
    emailCard = `
      <div class="stat-grid">
        ${statCard('bell', es.configurado?COLORS.good:COLORS.muted, es.configurado?'Configurado':'Não configurado', 'Microsoft Graph')}
        ${statCard('doc', COLORS.s1, es.ultimoEnvio ? formatDate(es.ultimoEnvio) : 'Nunca', 'Último envio')}
      </div>
      <div class="card">
        <h2 class="card-title">Resumo diário de alertas por e-mail</h2><p class="card-subtitle">Contratos nas faixas Vencido/Crítico/Atenção — um e-mail por responsável, mais uma cópia consolidada</p>
        <div class="detail-list">
          <div class="detail-row"><span class="detail-label">Remetente</span><span class="detail-value">${es.remetente || '(não definido)'}</span></div>
          <div class="detail-row"><span class="detail-label">Destinatários fixos (cópia consolidada)</span><span class="detail-value">${(es.destinatariosFixos&&es.destinatariosFixos.length) ? es.destinatariosFixos.join(', ') : '(nenhum — ALERTA_EMAIL_DESTINATARIOS)'}</span></div>
          ${!es.configurado?`<div class="detail-row"><span class="detail-label">Pendente</span><span class="detail-value">Falta GRAPH_MAIL_TENANT_ID/CLIENT_ID/CLIENT_SECRET/REMETENTE no .env do servidor</span></div>`:''}
        </div>
        ${ultimoResultado.enviado!==undefined ? `<div class="note-card" style="margin-top:12px;">${ultimoResultado.enviado ? `Último envio: ${ultimoResultado.totalContratos||0} contrato(s) em alerta, ${(ultimoResultado.resultados||[]).filter(r=>r.enviado).length} destinatário(s) com sucesso${(ultimoResultado.resultados||[]).some(r=>!r.enviado)?`, ${(ultimoResultado.resultados||[]).filter(r=>!r.enviado).length} com erro`:''}.` : (ultimoResultado.motivo||'Nada foi enviado na última verificação.')}</div>` : ''}
        ${souAdmin ? `<div style="margin-top:12px;"><button class="btn-ghost" onclick="app.enviarResumoAlertasAgora()" ${!es.configurado?'disabled title="Configure o Microsoft Graph primeiro"':''}>${icon('download',15)} Enviar agora</button></div>` : ''}
      </div>`;
  }
  return emailCard;
}

function renderAlertasPorEmail(){
  if(alertaEmailStatus===null && !alertaEmailCarregando) carregarAlertaEmailStatus();
  return `
    <div class="page-header">
      <div><h1 class="page-title">Alertas por e-mail</h1><p class="page-subtitle">Envio diário dos contratos perto do vencimento</p></div>
    </div>
    <div class="callout callout-info">${icon('bell',15)}<span><b>A integração com o SGC está desligada.</b> A Central não consulta nem importa mais nada do SGC; os contratos passam a entrar só pela Fila de importação, a partir dos documentos da pasta de rede.</span></div>
    ${ajuda('O envio usa o Microsoft Graph. Fica inativo enquanto não for configurado no servidor. Quando configurado, o servidor confere de hora em hora se já passou do horário definido e ainda não enviou o resumo do dia — por isso o servidor precisa ficar ligado o dia todo.', 'Como o envio funciona')}
    ${montarCardEmailAlertas()}`;
}

function renderIntegracoes(){
  if(window.__sgcDesligado) return renderAlertasPorEmail();
  if(integracaoStatus===null && !integracaoCarregando) carregarIntegracaoStatus();
  if(alertaEmailStatus===null && !alertaEmailCarregando) carregarAlertaEmailStatus();
  const s = integracaoStatus;
  const carregando = integracaoCarregando && !s;

  const ENTIDADES_SGC = [
    ['contratos','Contratos'], ['aditivos','Aditivos'], ['apostilamentos','Apostilamentos'],
    ['requisicoes','Requisições'], ['gratificacoes','Gratificações']
  ];

  let statusCard;
  if(carregando){
    statusCard = `<div class="card">${esqueleto(5, 'Consultando a sincronização')}</div>`;
  } else if(!s || s.erro){
    statusCard = `<div class="card"><div class="empty-state">${icon('shield',30)}<div class="empty-state-title">Não foi possível consultar o status</div><div>${(s&&s.erro)||'Tente novamente em instantes.'}</div></div></div>`;
  } else {
    const ultimoResumo = s.ultimoResumo || {};
    const entidadesStatus = (s.entidades) || {};
    const linhasEntidades = ENTIDADES_SGC.map(([key,label])=>{
      const cfg = entidadesStatus[key] || {};
      const r = ultimoResumo[key];
      const situacao = cfg.configurado ? badge('Ativo') : badge('Encerrado');
      const contagem = !cfg.configurado ? '<span style="color:var(--text-muted);">Aguardando configuração</span>'
        : (r ? `${r.criados||0} criado(s) · ${r.atualizados||0} atualizado(s) · ${r.ignorados||0} ignorado(s)${r.erros&&r.erros.length?` · ${r.erros.length} erro(s)`:''}`
             : '<span style="color:var(--text-muted);">Ainda não sincronizado</span>');
      return `<div class="detail-row"><span class="detail-label">${label}</span><span class="detail-value">${situacao} &nbsp; ${contagem}</span></div>`;
    }).join('');
    const todosErros = ENTIDADES_SGC.flatMap(([key,label])=>{
      const r = ultimoResumo[key];
      return (r && r.erros && r.erros.length) ? r.erros.slice(0,5).map(e=>`${label}: ${e}`) : [];
    });
    statusCard = `
      <div class="stat-grid">
        ${statCard('shield', s.configurado?COLORS.good:COLORS.muted, s.configurado?'Configurada':'Não configurada', 'Situação da integração')}
        ${statCard('doc', COLORS.s1, s.ultimaSincronizacao ? formatDate(s.ultimaSincronizacao) : 'Nunca', 'Última sincronização')}
      </div>
      <div class="card">
        <h2 class="card-title">Entidades do SGC</h2><p class="card-subtitle">Cada uma fica inativa até sua própria URL ser configurada no servidor — veja o README</p>
        <div class="detail-list">${linhasEntidades}</div>
      </div>
      ${todosErros.length ? `<div class="callout callout-err" style="margin-top:16px;">${icon('close',15)}<span><b>${todosErros.length} registro(s) com erro na última sincronização:</b><br>${todosErros.map(esc).join('<br>')}</span></div>` : ''}
      <details class="ajuda" style="margin-top:16px;">
        <summary>${icon('tool',14)} Detalhes técnicos da configuração</summary>
        <div class="ajuda-corpo" style="padding-left:14px;">
        <p style="margin:0 0 8px;color:var(--muted);">Definida pelas variáveis de ambiente do servidor — veja o README para a lista completa.</p>
        <div class="detail-list">
          <div class="detail-row"><span class="detail-label">CONTRATOS_API_URL</span><span class="detail-value" style="overflow-wrap:anywhere;">${esc(s.url || '(não definida)')}</span></div>
          <div class="detail-row"><span class="detail-label">Tipo de autenticação</span><span class="detail-value">${esc(s.autenticacao)}</span></div>
          ${s.azureTenantId?`<div class="detail-row"><span class="detail-label">Azure AD — Tenant</span><span class="detail-value">${esc(s.azureTenantId)}</span></div>`:''}
          ${s.azureClientId?`<div class="detail-row"><span class="detail-label">Azure AD — Client ID</span><span class="detail-value">${esc(s.azureClientId)}</span></div>`:''}
          ${!s.configurado?`<div class="detail-row"><span class="detail-label">Pendente</span><span class="detail-value">Falta alguma variável no .env (confira o client_secret, se for Azure AD)</span></div>`:''}
        </div>
        </div>
      </details>`;
  }

  const emailCard = montarCardEmailAlertas();

  return `
    <div class="page-header">
      <div><h1 class="page-title">Sincronização com o SGC</h1><p class="page-subtitle">Contratos, aditivos, apostilamentos, requisições e gratificações trazidos do SGC</p></div>
      <button class="btn-primary" onclick="app.sincronizarContratosApi()" ${s&&!s.configurado?'disabled title="Configure CONTRATOS_API_URL primeiro"':''}>${icon('download',15)} Sincronizar agora</button>
    </div>
    ${ajuda('Enquanto a API do SGC não estiver configurada no servidor, a sincronização fica inativa e a Central continua funcionando com os dados locais. Campos próprios da Central em Contratos (secretaria, responsável, e-mail do responsável, observações) nunca são sobrescritos pela sincronização.')}
    ${statusCard}
    <div class="page-header" style="margin-top:24px;">
      <div><h2 class="page-title" style="font-size:17px;">Resumo de alertas por e-mail</h2><p class="page-subtitle">Envio diário dos contratos perto do vencimento</p></div>
    </div>
    ${ajuda('O envio usa o Microsoft Graph (a mesma família de credenciais do Azure AD da sincronização). Fica inativo enquanto não for configurado no servidor. Quando configurado, o servidor confere de hora em hora se já passou do horário definido e ainda não enviou o resumo do dia — por isso o servidor precisa ficar ligado o dia todo.', 'Como o envio funciona')}
    ${emailCard}`;
}

async function sincronizarContratosApi(){
  try{
    const res = await api.integracaoSincronizar();
    const r = res.resumo || {};
    const c = r.contratos || {};
    const partes = [`Contratos: ${c.criados||0} criado(s), ${c.atualizados||0} atualizado(s)`];
    [['aditivos','Aditivos'],['apostilamentos','Apostilamentos'],['requisicoes','Requisições'],['gratificacoes','Gratificações']].forEach(([key,label])=>{
      const e = r[key];
      if(e && e.configurado) partes.push(`${label}: ${e.criados||0} criado(s), ${e.atualizados||0} atualizado(s)`);
    });
    toast(`Sincronizado — ${partes.join(' · ')}.`, 'success');
  }catch(err){ toast(err.message, 'error'); }
  integracaoStatus = null;
  await recarregarDadosAposSincronizacao();
}

async function recarregarDadosAposSincronizacao(){
  try{
    const data = await api.bootstrap();
    contratos = data.contratos || contratos;
    riscosPorContrato = data.riscos || riscosPorContrato;
    respostasTce = data.respostasTce || respostasTce;
    aditivos = data.aditivos || aditivos;
    apostilamentos = data.apostilamentos || apostilamentos;
    valoresTotais = data.valoresTotais || valoresTotais;
    mudancasPendentes = data.mudancasPendentes || mudancasPendentes;
  }catch(e){ /* mantém os dados atuais em memória se o reload falhar */ }
  render();
}

/* ===================== FILA DE IMPORTAÇÃO (Ferramenta 1 — ingestão automatizada) =====================
   Tela de revisão humana das propostas geradas por servidorArquivos.js +
   extratorDocumento.js + leituraPorRegra.js + ingestaoContratos.js no backend.
   Mesmo esquema de campos usado em Contratos (ver viewContrato),
   para que aprovar uma proposta produza um contrato com a cara de sempre. */
const CAMPOS_IMPORTACAO = [
  {key:'numero', label:'Número do contrato'},
  {key:'empresa', label:'Empresa'},
  {key:'cnpjEmpresa', label:'CNPJ da empresa'},
  {key:'tipo', label:'Tipo de serviço'},
  {key:'objeto', label:'Objeto', type:'textarea'},
  {key:'inicio', label:'Início', type:'date'},
  {key:'termino', label:'Término', type:'date'},
  {key:'valor', label:'Valor mensal', type:'number'},
  {key:'secretaria', label:'Secretaria'},
  {key:'responsavel', label:'Responsável (Gestor)'},
  {key:'suplente', label:'Suplente'},
  {key:'pa', label:'Processo administrativo (PA)'},
  {key:'preposto', label:'Preposto da empresa'},
  {key:'tipoContratacao', label:'Modalidade de contratação'}
];

function statusImportacaoBadge(status){
  const map = {
    pendente: ['badge-warning','Pendente de revisão'],
    sem_texto: ['badge-muted','Sem texto legível'],
    erro: ['badge-critical','Erro ao ler'],
    aprovado: ['badge-good','Aprovada'],
    rejeitado: ['badge-muted','Rejeitada']
  };
  const [cls,text] = map[status] || ['badge-muted', status];
  return `<span class="badge ${cls}">${text}</span>`;
}

function carregarArquivosStatus(){
  if(arquivosStatusCarregando) return;
  arquivosStatusCarregando = true;
  api.arquivosStatus().then(s=>{
    arquivosStatus = s; arquivosStatusCarregando = false;
    if(state.view==='importacoes') render();
  }).catch(err=>{
    arquivosStatus = { erro: err.message }; arquivosStatusCarregando = false;
    if(state.view==='importacoes') render();
  });
}

function carregarImportacoes(){
  if(importacoesCarregando) return;
  importacoesCarregando = true;
  api.listarImportacoes().then(lista=>{
    importacoes = lista; importacoesCarregadas = true; importacoesCarregando = false;
    if(state.view==='importacoes') render();
  }).catch(err=>{
    importacoesCarregando = false;
    if(state.view==='importacoes'){ toast(err.message,'error'); render(); }
  });
}

/* Envolve qualquer operação que ocupe o mutex de progresso do backend
   (varredura automática OU extração manual — ver ingestaoContratos.js)
   com o mesmo polling de progresso e a mesma limpeza de estado ao final.
   Existe pra não duplicar essa lógica entre varrerArquivosAgora() e
   extrairSelecionadosManual(): as duas competem pela mesma máquina (OCR),
   o backend só deixa uma rodar de cada vez, e a tela mostra o mesmo tipo
   de indicador pras duas. */
async function comProgresso(chamada){
  varreduraEmAndamento = true;
  progressoVarreduraAtual = null;
  render();
  // A operação em si pode levar minutos (OCR de PDF escaneado) — sem isto, a tela ficava com "Varrendo..." parado
  // e nada mais, indistinguível de estar travada. Consulta o progresso a
  // cada poucos segundos e atualiza a tela, em paralelo com a operação.
  const consultaProgresso = setInterval(async ()=>{
    try{
      const p = await api.progressoVarredura();
      if(p && p.emAndamento){ progressoVarreduraAtual = p; render(); }
    }catch(e){ /* consulta de progresso é best-effort — nunca interrompe a operação por causa disso */ }
  }, 2000);
  try{
    return await chamada();
  } finally {
    clearInterval(consultaProgresso);
    varreduraEmAndamento = false;
    progressoVarreduraAtual = null;
    arquivosStatus = null; importacoesCarregadas = false; // força recarregar os dois na próxima renderização
    render();
  }
}

/* Reaplica as regras de valor e vigência às propostas pendentes, com o
   texto já lido — ver recalcularPropostasPendentes no servidor. */
let recalculandoPropostas = false;
async function recalcularPropostas(){
  if(recalculandoPropostas) return;
  recalculandoPropostas = true; render();
  try{
    const r = await api.recalcularImportacoes();
    const vig = r.vigenciasDeAprovados || [];
    const enc = r.encerramentosDetectados || [];
    const gar = r.garantiasLidas || [];
    toast(`Recálculo concluído — ${r.recalculadas} proposta(s) conferida(s), ${r.alteradas} com valor ou data atualizados${r.semTexto?`, ${r.semTexto} sem texto guardado (serão lidas na próxima varredura)`:''}${vig.length?`; vigência preenchida em ${vig.length} contrato(s) aprovado(s): ${vig.map(v=>`${v.contrato} (término ${formatDate(v.depois.termino)})`).join(', ')}`:''}${enc.length?`; termo de encerramento encontrado em ${enc.length} contrato(s) (${enc.map(e=>e.contrato).join(', ')}) — confirme em Pendências de leitura`:''}${gar.length?`; validade da garantia lida em ${gar.length} contrato(s) (${gar.map(g=>`${g.contrato} até ${formatDate(g.fim)}`).join(', ')})`:''}.`, 'success');
    importacoesCarregadas = false; baseContratosDados = null; pendenciasDados = null;
    if(vig.length) await recarregarDadosAposSincronizacao();
  }catch(err){ toast(err.message, 'error'); }
  recalculandoPropostas = false; render();
}

async function varrerArquivosAgora(){
  if(varreduraEmAndamento) return;
  try{
    const res = await comProgresso(()=>api.varrerArquivos());
    const r = res.resumo || {};
    toast(`Varredura concluída — ${r.propostas||0} proposta(s) nova(s), ${r.semTexto||0} sem texto legível, ${r.erros||0} com erro, de ${r.totalArquivosAlterados??r.totalCandidatos??0} arquivo(s) novo(s)/alterado(s) (${r.totalCandidatos||0} encontrado(s) no total).`, 'success');
  }catch(err){ toast(err.message, 'error'); }
}

/* ===================== Seleção manual de arquivos (Ferramenta 1) =====================
   Em vez de esperar a varredura automática decidir sozinha o que é
   "novo/alterado", esta seção deixa navegar pelas pastas configuradas e
   escolher exatamente quais arquivos processar agora — com a opção de
   pedir campos extras além dos 14 do cadastro (ver README). */


function togglePainelManual(){
  painelManualAberto = !painelManualAberto;
  if(painelManualAberto && !manualConteudo && !manualCarregando) carregarPastaManual();
  // Prepara no servidor o índice da pasta de rede (15-20 s na primeira vez),
  // para "Escolher arquivos"/arrastar responder na hora.
  if(painelManualAberto) api.localizarArquivos([]).catch(()=>{});
  render();
}

function carregarPastaManual(){
  manualCarregando = true;
  render();
  const caminhoAtual = manualPilha.length ? manualPilha[manualPilha.length-1].caminho : null;
  api.listarPastasManual(caminhoAtual).then(c=>{
    manualConteudo = c; manualCarregando = false;
    if(state.view==='importacoes') render();
  }).catch(err=>{
    manualCarregando = false;
    toast(err.message, 'error');
    if(state.view==='importacoes') render();
  });
}

function navegarPastaManual(nome, caminho){
  manualPilha.push({ nome, caminho });
  manualConteudo = null;
  carregarPastaManual();
}

function irParaBreadcrumbManual(indice){
  // indice === -1 volta pra raiz (pilha vazia); qualquer outro valor
  // corta a pilha até ali (equivalente a clicar num item do meio do
  // caminho e "subir" até ele).
  manualPilha = indice < 0 ? [] : manualPilha.slice(0, indice+1);
  manualConteudo = null;
  carregarPastaManual();
}

function toggleSelecionarArquivoManual(caminho, nome){
  if(manualSelecionados.has(caminho)) manualSelecionados.delete(caminho);
  else { manualSelecionados.add(caminho); if(nome) manualNomes.set(caminho, nome); }
  render();
}

async function extrairSelecionadosManual(){
  if(varreduraEmAndamento) return;
  if(manualSelecionados.size===0){ toast('Selecione ao menos um arquivo antes de extrair.', 'error'); return; }
  const caminhos = Array.from(manualSelecionados);
  try{
    const res = await comProgresso(()=>api.extrairSelecionados(caminhos));
    const rotuloStatus = { pendente:'proposta pronta pra revisão', sem_texto:'sem texto legível — precisa de preenchimento manual' }[res.status] || res.status;
    toast(`Extração concluída (${caminhos.length} arquivo(s)) — ${rotuloStatus}. Veja na fila abaixo.`, 'success');
    manualSelecionados = new Set();
  }catch(err){ toast(err.message, 'error'); }
}

/* ---- Seleção a partir do Explorer do Windows ----
   O navegador não entrega o CAMINHO dos arquivos escolhidos (só nome,
   tamanho, data e, numa pasta escolhida inteira, o caminho dentro dela) —
   ver servidorArquivos.js. Por isso: (1) caminho colado do Explorer abre
   a pasta aqui mesmo; (2) arquivos escolhidos ou arrastados são achados
   na pasta de rede pelo servidor, por nome + tamanho + data. */
let manualNomes = new Map();          // caminho -> nome, para a lista de selecionados
let manualAmbiguos = [];              // [{ nome, candidatos:[caminho] }] — o mesmo arquivo em mais de um lugar
let manualNaoReconhecidos = [];       // nomes que não estão na pasta de rede configurada
let manualLocalizando = false;

function nomeDoCaminho(c){ return String(c||'').split(/[\\/]/).pop(); }
function pastaDoCaminho(c){ const partes = String(c||'').split(/[\\/]/); return partes.length > 1 ? partes[partes.length-2] : ''; }

async function irParaCaminhoColado(){
  const campo = document.getElementById('manual-caminho-colado');
  const texto = campo ? campo.value : '';
  if(!texto.trim()){ toast('Cole o caminho de uma pasta ou arquivo (copie da barra de endereço do Explorer).', 'error'); return; }
  try{
    const r = await api.resolverCaminho(texto);
    manualPilha = r.pilha;
    manualConteudo = null;
    if(r.arquivo){
      manualSelecionados.add(r.arquivo.caminho);
      manualNomes.set(r.arquivo.caminho, r.arquivo.nome);
      toast(`"${r.arquivo.nome}" selecionado.`, 'success');
    }
    carregarPastaManual();
  }catch(err){ toast(err.message, 'error'); }
}

function teclaCaminhoColado(event){
  if(event.key === 'Enter'){ event.preventDefault(); irParaCaminhoColado(); }
}

function arquivosEscolhidosManual(input){
  const arquivos = Array.from(input.files || []);
  input.value = ''; // permite escolher os mesmos arquivos de novo
  localizarArquivosDoComputador(arquivos.map(f => ({ file: f, caminhoRelativo: f.webkitRelativePath || '' })));
}

/* Arrastar do Explorer: arquivos soltos e pastas inteiras (lidas pela
   API de entradas do navegador, com o caminho relativo de cada arquivo). */
async function soltarNoPainelManual(event){
  event.preventDefault();
  const zona = document.getElementById('manual-zona-soltar');
  if(zona) zona.classList.remove('arrastando');
  const itens = Array.from((event.dataTransfer && event.dataTransfer.items) || []);
  const entradas = itens.map(i => i.webkitGetAsEntry ? i.webkitGetAsEntry() : null).filter(Boolean);
  if(!entradas.length){
    return localizarArquivosDoComputador(Array.from(event.dataTransfer.files || []).map(f => ({ file: f, caminhoRelativo: '' })));
  }
  const coletados = [];
  const lerArquivo = e => new Promise(ok => e.file(f => ok(f), () => ok(null)));
  const lerPasta = leitor => new Promise(ok => leitor.readEntries(ok, () => ok([])));
  async function visitar(e){
    if(e.isFile){
      const f = await lerArquivo(e);
      if(f) coletados.push({ file: f, caminhoRelativo: e.fullPath.replace(/^\//, '') });
    } else if(e.isDirectory){
      const leitor = e.createReader();
      for(;;){ const lote = await lerPasta(leitor); if(!lote.length) break; for(const x of lote) await visitar(x); }
    }
  }
  for(const e of entradas) await visitar(e);
  localizarArquivosDoComputador(coletados);
}

function arrastandoSobrePainelManual(event, dentro){
  event.preventDefault();
  const zona = document.getElementById('manual-zona-soltar');
  if(zona) zona.classList.toggle('arrastando', !!dentro);
}

async function localizarArquivosDoComputador(lista){
  const EXTENSOES = /\.(pdf|docx)$/i;
  const candidatos = lista.filter(x => x.file && EXTENSOES.test(x.file.name) && !x.file.name.startsWith('~$'));
  const ignorados = lista.length - candidatos.length;
  if(!candidatos.length){
    toast(lista.length ? 'Nenhum PDF ou DOCX entre os arquivos escolhidos.' : 'Nenhum arquivo recebido.', 'error');
    return;
  }
  // Avisos valem para ESTA seleção; os arquivos já marcados continuam.
  manualAmbiguos = []; manualNaoReconhecidos = [];
  manualLocalizando = true; render();
  try{
    const r = await api.localizarArquivos(candidatos.map(x => ({
      nome: x.file.name, tamanho: x.file.size, modificadoEm: x.file.lastModified, caminhoRelativo: x.caminhoRelativo
    })));
    let novos = 0;
    r.resultado.forEach(x => {
      if(x.situacao === 'encontrado'){
        if(!manualSelecionados.has(x.caminho)) novos++;
        manualSelecionados.add(x.caminho); manualNomes.set(x.caminho, x.nome);
      } else if(x.situacao === 'ambiguo'){
        if(!manualAmbiguos.some(a => a.nome === x.nome)) manualAmbiguos.push({ nome: x.nome, candidatos: x.candidatos });
      } else if(x.situacao === 'nao_encontrado'){
        if(!manualNaoReconhecidos.includes(x.nome)) manualNaoReconhecidos.push(x.nome);
      }
    });
    const amb = r.resultado.filter(x => x.situacao === 'ambiguo').length;
    const nao = r.resultado.filter(x => x.situacao === 'nao_encontrado').length;
    const partes = [`${novos} arquivo(s) reconhecido(s) na pasta de rede e selecionado(s)`];
    if(r.foraDaSubpasta) partes.push(`${r.foraDaSubpasta} de outras subpastas do processo (edital, propostas, notas fiscais…) deixado(s) de fora — só entra a pasta de contratos, aditivos e termos`);
    if(amb) partes.push(`${amb} em mais de um lugar — escolha abaixo`);
    if(nao) partes.push(`${nao} não está(ão) na pasta de rede configurada`);
    if(ignorados) partes.push(`${ignorados} ignorado(s) por não ser PDF/DOCX`);
    if(r.ignoradosPorLimite) partes.push(`${r.ignoradosPorLimite} além do limite de 500 por vez`);
    toast(partes.join('; ') + '.', (nao || amb) ? 'error' : 'success');
  }catch(err){ toast(err.message, 'error'); }
  manualLocalizando = false; render();
}

function escolherCandidatoAmbiguo(indice, caminho){
  const a = manualAmbiguos[indice]; if(!a) return;
  manualSelecionados.add(caminho); manualNomes.set(caminho, a.nome);
  manualAmbiguos.splice(indice, 1);
  render();
}

function descartarAvisosManual(){
  manualAmbiguos = []; manualNaoReconhecidos = [];
  render();
}

function limparSelecionadosManual(){
  manualSelecionados = new Set();
  render();
}

function montarPainelManual(){
  if(!painelManualAberto) return '';

  const breadcrumbHtml = [
    `<a href="#" onclick="event.preventDefault();app.irParaBreadcrumbManual(-1)">${icon('folder',13)} Raiz</a>`,
    ...manualPilha.map((p,i)=>`<a href="#" onclick="event.preventDefault();app.irParaBreadcrumbManual(${i})">${esc(p.nome)}</a>`)
  ].join(' <span style="color:var(--text-muted);">/</span> ');

  let corpo;
  if(manualCarregando){
    corpo = esqueleto(4, 'Carregando a pasta');
  } else if(!manualConteudo){
    corpo = `<div class="related-empty">Não foi possível carregar esta pasta.</div>`;
  } else if(manualConteudo.pastas.length===0 && manualConteudo.arquivos.length===0){
    corpo = `<div class="related-empty">Pasta vazia (ou sem arquivos com a extensão/padrão configurados).</div>`;
  } else {
    // Nome e caminho vêm da pasta de rede — dado de fora, sempre escapado.
    const pastasHtml = manualConteudo.pastas.map(p => `
      <div class="detail-row" style="cursor:pointer;" onclick="app.navegarPastaManual('${escAttr(p.nome)}','${escAttr(p.caminho)}')">
        <span class="detail-label">${icon('folder',13)} ${esc(p.nome)}</span><span class="detail-value">abrir ›</span>
      </div>`).join('');
    const arquivosHtml = manualConteudo.arquivos.map(a => {
      const marcado = manualSelecionados.has(a.caminho);
      return `<div class="detail-row">
        <label style="cursor:pointer;display:flex;gap:8px;align-items:center;">
          <input type="checkbox" ${marcado?'checked':''} onchange="app.toggleSelecionarArquivoManual('${escAttr(a.caminho)}','${escAttr(a.nome)}')">
          ${icon('file',13)} ${esc(a.nome)}
        </label>
        <span class="detail-value">${formatBytesArquivo(a.tamanho)}</span>
      </div>`;
    }).join('');
    corpo = pastasHtml + arquivosHtml;
  }

  const total = manualSelecionados.size;

  // Selecionados de qualquer pasta (inclusive os vindos do Explorer), com opção de tirar.
  const selecionadosHtml = total ? `
    <div style="margin-top:12px;">
      <div style="display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:600;margin-bottom:4px;">
        ${total} arquivo(s) selecionado(s)
        <a href="#" style="font-weight:400;" onclick="event.preventDefault();app.limparSelecionadosManual()">limpar</a>
      </div>
      <div style="max-height:150px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:2px 10px;">
        ${Array.from(manualSelecionados).map(c => `<div class="detail-row">
          <span class="detail-label" title="${escAttr(c)}">${icon('file',13)} ${esc(manualNomes.get(c) || nomeDoCaminho(c))} <span style="color:var(--text-muted);font-weight:400;">— ${esc(pastaDoCaminho(c))}</span></span>
          <a href="#" class="detail-value" onclick="event.preventDefault();app.toggleSelecionarArquivoManual('${escAttr(c)}')">tirar</a>
        </div>`).join('')}
      </div>
    </div>` : '';

  const avisosHtml = (manualAmbiguos.length || manualNaoReconhecidos.length) ? `
    <div class="note-card" style="margin-top:12px;">
      ${manualAmbiguos.map((a,i) => `<div style="margin-bottom:8px;"><b>${esc(a.nome)}</b> existe em mais de um lugar na pasta de rede — qual deles?
        <div style="margin-top:4px;">${a.candidatos.map(c => `<div><a href="#" onclick="event.preventDefault();app.escolherCandidatoAmbiguo(${i},'${escAttr(c)}')">${esc(c)}</a></div>`).join('')}</div></div>`).join('')}
      ${manualNaoReconhecidos.length ? `<div><b>Não estão na pasta de rede configurada</b> (ou foram alterados depois de copiados): ${manualNaoReconhecidos.map(esc).join(', ')}. O sistema só processa documentos da pasta de rede — salve-os lá e tente de novo.</div>` : ''}
      <div style="margin-top:6px;"><a href="#" onclick="event.preventDefault();app.descartarAvisosManual()">dispensar</a></div>
    </div>` : '';

  return `<div class="card" style="margin-bottom:16px;">
    <h2 class="card-title">Selecionar arquivos manualmente</h2>
    <p class="card-subtitle" style="margin-bottom:10px;">Escolha exatamente quais arquivos processar agora — pelo Explorer do Windows, colando o caminho de uma pasta ou navegando abaixo. Não depende da varredura automática.</p>

    <div id="manual-zona-soltar" class="zona-soltar-manual" ondragover="app.arrastandoSobrePainelManual(event,true)" ondragleave="app.arrastandoSobrePainelManual(event,false)" ondrop="app.soltarNoPainelManual(event)">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:center;">
        <label class="btn-primary btn-small" style="cursor:pointer;">${icon('file',13)} Escolher arquivos…
          <input type="file" multiple accept=".pdf,.docx" style="display:none;" onchange="app.arquivosEscolhidosManual(this)">
        </label>
        <label class="btn-ghost btn-small" style="cursor:pointer;">${icon('folder',13)} Escolher pasta…
          <input type="file" webkitdirectory directory style="display:none;" onchange="app.arquivosEscolhidosManual(this)">
        </label>
        <span style="font-size:12.5px;color:var(--text-muted);">${manualLocalizando ? 'Procurando na pasta de rede...' : 'ou arraste arquivos e pastas do Explorer para cá'}</span>
      </div>
      <div style="font-size:11.5px;color:var(--text-muted);margin-top:6px;text-align:center;">Abra o Explorer na pasta de rede (F:). O sistema acha cada arquivo lá pelo nome, tamanho e data — nenhum arquivo é enviado.</div>
    </div>

    <div style="display:flex;gap:8px;margin:12px 0 10px;">
      <input id="manual-caminho-colado" type="text" style="flex:1;" placeholder="Ou cole o caminho de uma pasta ou arquivo (barra de endereço do Explorer, ou &quot;Copiar como caminho&quot;)" onkeydown="app.teclaCaminhoColado(event)">
      <button class="btn-ghost btn-small" onclick="app.irParaCaminhoColado()">Abrir</button>
    </div>

    <div style="font-size:12.5px;margin-bottom:8px;">${breadcrumbHtml}</div>
    <div style="max-height:280px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:2px 10px;">${corpo}</div>
    ${avisosHtml}
    ${selecionadosHtml}
    <div class="row-actions" style="margin-top:12px;">
      <button class="btn-primary btn-small" onclick="app.extrairSelecionadosManual()" ${(total===0||varreduraEmAndamento)?'disabled':''}>${icon('shield',13)} Extrair campos de ${total} arquivo(s) selecionado(s)</button>
    </div>
  </div>`;
}

function abrirAprovacaoImportacao(id){
  const it = importacoes.find(i=>String(i.id)===String(id)); if(!it) return;
  const campos = it.campos || {};
  /* Contrato que vai ser ATUALIZADO por esta aprovação (quando a proposta
     casou com um número já cadastrado). Sem ele à vista, quem aprova só
     enxerga o que foi lido e não tem como saber que está trocando um
     dado já gravado — inclusive dado vindo da fonte oficial (SGC). Caso
     real: uma proposta correta em número/empresa trazia vigência e valor
     do extrato do Diário que, se aprovados, teriam substituído a vigência
     oficial e mudado o valor do contrato por um fator de 12.500 (o campo
     `valor` é MENSAL; o extrato traz o total). */
  const contratoAtual = it.contratoExistenteId ? contratos.find(c=>c.id===it.contratoExistenteId) : null;
  const mostrarValor = (f, v) => {
    if(v===undefined || v===null || v==='') return null;
    return f.type==='number' ? money(v) : (f.type==='date' ? formatDate(v) : String(v));
  };
  const fields = CAMPOS_IMPORTACAO.map(f=>{
    const conf = it.confiancas ? it.confiancas[f.key] : null;
    // Confiança só nas leituras antigas da IA (a regra lê o valor escrito).
    const confTxt = ((it.procedencia||{})[f.key]==='ia' && conf!==undefined && conf!==null) ? ` — leitura antiga da IA, ${Math.round(conf*100)}%` : '';
    let hint = null;
    if(contratoAtual){
      const atual = mostrarValor(f, contratoAtual[f.key]);
      const sugerido = mostrarValor(f, campos[f.key]);
      if(sugerido && atual && String(contratoAtual[f.key])!==String(campos[f.key])){
        hint = `⚠ Hoje no contrato: <b>${esc(atual)}</b> — será substituído por este valor. Apague o campo para manter o que já está gravado.`;
      } else if(sugerido && !atual){
        hint = 'Vazio no contrato hoje — será preenchido.';
      } else if(atual && !sugerido){
        hint = `Hoje no contrato: ${esc(atual)} — campo vazio aqui, o valor atual é mantido.`;
      }
    }
    return { name:f.key, label:f.label+confTxt, type:f.type, hint, value: (campos[f.key]!=null?campos[f.key]:'') };
  });
  const numeroRef = campos.numero || '';
  const aSubstituir = contratoAtual ? CAMPOS_IMPORTACAO.filter(f=>{
    const a = contratoAtual[f.key], s = campos[f.key];
    return s!==undefined && s!==null && s!=='' && a!==undefined && a!==null && a!=='' && String(a)!==String(s);
  }) : [];
  const intro = [
    // `observacao` vem do texto lido do documento — dado de fora, escapado.
    ['Campos lidos dos documentos por regras — confira antes de aprovar. O que ficou em branco vai para "Pendências de leitura".', esc(it.observacao)].filter(Boolean).join(' '),
    it.contratoExistenteId ? `Já existe um contrato com o número ${esc(numeroRef)} — aprovar vai atualizar esse contrato em vez de criar um novo.` : 'Nenhum contrato com este número foi encontrado — aprovar vai criar um contrato novo.',
    // Aviso destacado: o contrato veio da fonte oficial, então cada campo
    // sobrescrito troca dado do SGC por leitura de documento. Não bloqueia (às
    // vezes corrigir o SGC é exatamente o que se quer), só deixa de ser
    // invisível.
    (contratoAtual && contratoAtual.origemExterna)
      ? `ATENÇÃO: este contrato veio sincronizado do SGC (fonte oficial). Cada campo preenchido abaixo vai sobrescrever o dado oficial — confira um por um.`
      : null,
    (it.calculoValor && it.calculoValor.memoria)
      ? `Valor mensal calculado pela regra do SGC (valor inicial + aditivos ÷ vigência + prorrogações): ${esc(it.calculoValor.memoria)}.${(it.calculoValor.avisos||[]).length?' Atenção: '+it.calculoValor.avisos.map(esc).join(' '):''}`
      : null,
    aSubstituir.length
      ? `${aSubstituir.length} campo(s) já preenchido(s) serão substituídos: ${aSubstituir.map(f=>esc(f.label)).join(', ')}. Apague o campo no formulário para manter o valor atual.`
      : null
  ].filter(Boolean)
    // Um aviso por assunto, em vez de um parágrafo único: o alerta sobre dado
    // oficial do SGC em destaque; o resto como informação.
    .map(t => /^ATENÇÃO/.test(t) || /serão substituídos/.test(t)
      ? `<div class="callout callout-warn" style="margin:0 0 8px;">${icon('bell',15)}<span>${t}</span></div>`
      : `<div class="callout callout-info" style="margin:0 0 8px;">${icon('doc',15)}<span>${t}</span></div>`)
    .join('');
  openForm(`Revisar e aprovar — ${campos.numero ? 'Contrato '+esc(campos.numero) : esc(it.arquivo.nome)}`, fields, async d=>{
    const { _mapaRisco, ...contrato } = await api.aprovarImportacao(id, d);
    avisarMapaDaAprovacao(contrato, _mapaRisco);
    const idx = importacoes.findIndex(i=>String(i.id)===String(id));
    if(idx!==-1) Object.assign(importacoes[idx], { status:'aprovado', contratoId:contrato.id, aprovadoPor:(currentUser&&currentUser.nome)||'Você', aprovadoEm:new Date().toISOString() });
    const existente = contratos.find(c=>c.id===contrato.id);
    if(existente) Object.assign(existente, contrato); else contratos.unshift(contrato);
    fichasCadastroDados = null; // o contrato aprovado passa a poder gerar a ficha de cadastro
    irParaProximaPendente(id);
  }, { wide:true, submitLabel:'Aprovar e gravar no contrato', successMessage:'Proposta aprovada — contrato gravado. Abrindo a próxima pendente.', intro });
}

/* O servidor gera o mapa de risco do contrato ativo ao aprovar (só com o
   texto já lido). Aqui só se avisa e se força o Mapa a recarregar. */
function avisarMapaDaAprovacao(contrato, mapa){
  if(!mapa) return;
  mapasRiscoDados = null; registroResumoDados = null;
  if(mapa.erro) toast(`Mapa de risco do ${contrato.numero} não foi gerado: ${mapa.erro}`, 'error');
  else toast(`Mapa de risco do ${contrato.numero} gerado: risco geral ${mapa.riscoGeralLabel}.`, 'success');
}

function abrirRejeicaoImportacao(id){
  const it = importacoes.find(i=>String(i.id)===String(id)); if(!it) return;
  openForm(`Rejeitar proposta — ${esc(it.arquivo.nome)}`, [
    {name:'motivo', label:'Motivo (opcional, fica registrado para consulta futura)', type:'textarea'}
  ], async d=>{
    const proposta = await api.rejeitarImportacao(id, d.motivo);
    const idx = importacoes.findIndex(i=>String(i.id)===String(id));
    if(idx!==-1) importacoes[idx] = proposta;
    irParaProximaPendente(id);
  }, { submitLabel:'Rejeitar proposta', successMessage:'Proposta rejeitada.' });
}

/* Memória de cálculo da média mensal (ver valorContratual.js): de onde
   saiu cada parcela, para conferir antes de aprovar. Tudo que vem dos
   documentos (nomes de arquivo, avisos) é escapado. */
function montarCalculoValorHtml(calc){
  if(!calc || (!calc.memoria && !(calc.avisos||[]).length)) return '';
  const linhas = [];
  if(calc.valorInicial!=null) linhas.push(`<li>Contrato: ${money(calc.valorInicial)}${calc.mesesIniciais?` em ${calc.mesesIniciais} meses`:''}${calc.fonteInicial?` <span style="color:var(--text-muted);">(${esc(calc.fonteInicial)})</span>`:''}</li>`);
  (calc.aditivos||[]).forEach(a=>linhas.push(`<li>${a.tipo==='apostilamento'?'Apostilamento':'Aditivo'} ${esc(a.termo||'')} — ${esc(a.natureza||'')}: ${a.valor?(a.valor<0?'− ':'+ ')+money(Math.abs(a.valor)):'sem valor'}${a.meses?`, + ${a.meses} meses`:''}${a.detalhe?` — ${esc(a.detalhe)}`:''} <span style="color:var(--text-muted);">(${esc(a.documento||'')})</span></li>`));
  (calc.avisos||[]).forEach(a=>linhas.push(`<li style="color:var(--warning);">${esc(a)}</li>`));
  return `<details style="margin-top:10px;"><summary style="cursor:pointer;font-size:13px;color:var(--text-2);">Como o valor mensal foi calculado${calc.memoria?': '+esc(calc.memoria):''}</summary><ul style="margin:6px 0 0 18px;font-size:13px;line-height:1.6;">${linhas.join('')}</ul></details>`;
}

/* Ficha de cadastro do SGC (antes uma tela própria): gerar, baixar e ver,
   direto na proposta aprovada — é o passo seguinte de quem aprova. */
function montarAcoesFicha(contratoId, souAprovador){
  if(!contratoId) return '';
  const item = ((fichasCadastroDados && fichasCadastroDados.itens) || []).find(i=>String(i.contrato.id)===String(contratoId));
  if(!item) return '';
  const f = item.ultimaFicha;
  const gerando = fichasCadastroGerandoIds.has(contratoId);
  return `<div class="row-actions" style="margin-top:10px;align-items:center;">
    ${souAprovador?`<button class="btn-primary btn-small" onclick="app.gerarFichaCadastro(${contratoId}, false)" ${gerando?'disabled':''}>${icon('file',13)} ${gerando?'Gerando ficha...':(f?'Atualizar ficha de cadastro':'Gerar ficha de cadastro (SGC)')}</button>`:''}
    ${f?`<a class="btn-ghost btn-small" style="text-decoration:none;" href="/api/fichas-cadastro/${f.id}/arquivo" target="_blank" rel="noopener">${icon('doc',13)} Baixar ficha (PDF)</a>
      <button class="btn-ghost btn-small" onclick="app.abrirDetalheFichaCadastro(${contratoId})">${icon('search',13)} Ver ficha</button>
      <span style="font-size:12px;color:var(--text-muted);">gerada em ${formatDate(f.geradoEm)}</span>`:''}
  </div>`;
}

/* ===================== FILA DE IMPORTAÇÃO — lista + proposta aberta =====================
   Layout aprovado em 22/09/2026 (prévia public/previa-fila-importacao.html):
   à esquerda a lista das propostas, cada uma dizendo o que pede atenção; à
   direita a proposta selecionada, com os campos agrupados por assunto e a
   barra de ações sempre visível. Ao aprovar/rejeitar, abre a próxima
   pendente. Teclado: ↑/↓ troca de proposta, A aprova, R rejeita. */
const GRUPOS_IMPORTACAO = [
  ['Identificação', ['numero','pa','tipoContratacao','tipo']],
  ['Empresa', ['empresa','cnpjEmpresa','preposto']],
  ['Objeto', ['objeto']],
  ['Vigência e valor', ['inicio','termino','valor']],
  ['Gestão', ['secretaria','responsavel','suplente']]
];
const ROTULO_FONTE_FILA = {
  ia:                      ['IA', 'Leitura antiga da IA (retirada em 01/10/2026)', 'ia'],
  busca_local:             ['texto', 'Lido do documento por regra', ''],
  busca_local_corrigiu_ia: ['texto', 'Lido do documento por regra (corrigiu a leitura antiga da IA)', ''],
  inferido:                ['inferido', 'NÃO está escrito no documento (leitura antiga da IA). Confira antes de aprovar.', 'inf'],
  calculo:                 ['cálculo', 'Calculado pelas regras do SGC (valor mensal / vigência) a partir do contrato e dos termos', 'calc'],
  manual:                  ['à mão', 'Informado à mão em Pendências de leitura, por quem conferiu na fonte', 'manual']
};

const vazioFila = v => v===undefined || v===null || v==='';
function contratoDaProposta(it){ return it.contratoExistenteId ? contratos.find(c=>c.id===it.contratoExistenteId) : null; }
function fonteDoCampo(it, k){
  if(k==='valor' && it.calculoValor && it.calculoValor.mediaMensal!=null && (it.procedencia||{})[k]!=='inferido') return 'calculo';
  if((k==='inicio' || k==='termino') && it.calculoVigencia && it.calculoVigencia[k] && (it.procedencia||{})[k]!=='inferido') return 'calculo';
  return (it.procedencia||{})[k] || null;
}
/* Campos que a aprovação vai TROCAR no contrato já cadastrado (os dois
   preenchidos e diferentes) — mesma regra do formulário de aprovação. */
function camposQueMudam(it){
  const c = contratoDaProposta(it);
  if(!c) return [];
  const campos = it.campos || {};
  return CAMPOS_IMPORTACAO.filter(f => !vazioFila(campos[f.key]) && !vazioFila(c[f.key]) && !mesmoValorDeCampo(f, c[f.key], campos[f.key]));
}
/* "Mesmo valor" ignorando só a forma de escrever: CNPJ com ou sem pontos,
   maiúsculas, acentos e pontuação no texto, centavos no valor. Senão a
   lista acusava "muda 6 campos" num contrato idêntico. */
function mesmoValorDeCampo(f, a, b){
  if(f.type==='number') return Math.abs(Number(a) - Number(b)) < 0.01;
  if(f.type==='date') return String(a).slice(0,10)===String(b).slice(0,10);
  if(f.key==='cnpjEmpresa' || f.key==='pa') return String(a).replace(/\D/g,'')===String(b).replace(/\D/g,'');
  const norm = v => String(v).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const na = norm(a), nb = norm(b);
  // "Secretaria de Tecnologia..." e "Secretaria de Tecnologia... - SETEC":
  // um texto longo que é começo do outro é o mesmo valor com a sigla a mais.
  return na===nb || (Math.min(na.length, nb.length) >= 20 && (na.startsWith(nb) || nb.startsWith(na)));
}
function camposInferidos(it){ return Object.keys(it.procedencia||{}).filter(k => it.procedencia[k]==='inferido' && !vazioFila((it.campos||{})[k])); }
function camposLidos(it){ return CAMPOS_IMPORTACAO.filter(f => !vazioFila((it.campos||{})[f.key])).length; }
function statusComProblema(s){ return s==='sem_texto' || s==='erro'; }

function quandoCurto(iso){
  const d = new Date(iso);
  if(isNaN(d)) return '';
  const hora = d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
  const hoje = new Date(); const ontem = new Date(); ontem.setDate(hoje.getDate()-1);
  if(d.toDateString()===hoje.toDateString()) return `hoje, ${hora}`;
  if(d.toDateString()===ontem.toDateString()) return `ontem, ${hora}`;
  return `${d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' })}, ${hora}`;
}

function filtroFila(){ return state.filters['filter-status-importacoes'] || 'pendente'; }
function propostasVisiveis(){
  const f = filtroFila();
  const q = (state.filters['search-fila']||'').trim().toLowerCase();
  return importacoes
    .filter(i => f==='todas' ? true : f==='problema' ? statusComProblema(i.status) : i.status===f)
    .filter(i => !q || [(i.campos||{}).numero, (i.campos||{}).empresa, i.arquivo && i.arquivo.nome, (i.campos||{}).pa].some(v => String(v||'').toLowerCase().includes(q)));
}
function propostaSelecionada(){
  const vis = propostasVisiveis();
  const sel = state.filters['fila-sel'];
  return vis.find(i => String(i.id)===String(sel)) || vis[0] || null;
}
function selecionarProposta(id){
  state.filters['fila-sel'] = id;
  render();
  // Mantém o item escolhido à vista na lista (navegação por teclado).
  const el = document.querySelector(`.fila-item[data-id="${CSS.escape(String(id))}"]`);
  if(el) el.scrollIntoView({ block:'nearest' });
  const corpo = document.querySelector('.detalhe');
  if(corpo && corpo.getBoundingClientRect().top < 0) corpo.scrollIntoView({ block:'start' });
}
/* Depois de decidir uma proposta: a próxima pendente da lista (a seguinte;
   se era a última, a primeira que sobrar). */
function irParaProximaPendente(idDecidido){
  const vis = importacoes.filter(i => i.status==='pendente' || String(i.id)===String(idDecidido));
  const i = vis.findIndex(x => String(x.id)===String(idDecidido));
  const prox = vis.slice(i+1).find(x => x.status==='pendente') || vis.find(x => x.status==='pendente');
  state.filters['fila-sel'] = prox ? prox.id : null;
}

function tagsDaProposta(it){
  const t = [];
  if(it.status==='sem_texto') t.push('<span class="tag">sem texto legível</span>');
  if(it.status==='erro') t.push('<span class="tag err">erro</span>');
  if(it.status==='aprovado') t.push('<span class="tag ok">aprovada</span>');
  if(it.status==='rejeitado') t.push('<span class="tag">rejeitada</span>');
  // De qual pasta de "9. Gestão de Contratos" veio o processo.
  const origemPasta = String((it.arquivo && it.arquivo.caminho) || '');
  if(/contratos\s+encerrados/i.test(origemPasta)) t.push('<span class="tag" title="Veio de &quot;Contratos Encerrados&quot; — aprovar cadastra como Encerrado">encerrado</span>');
  else if(/outras\s+secretarias/i.test(origemPasta)) t.push('<span class="tag info" title="Veio de &quot;Processos de Outras Secretarias&quot;">outra secretaria</span>');
  if(it.status==='pendente'){
    const inf = camposInferidos(it).length;
    if(inf) t.push(`<span class="tag err" title="Campos que não estão escritos no documento">${inf} inferido${inf>1?'s':''}</span>`);
    const muda = camposQueMudam(it).length;
    if(muda) t.push(`<span class="tag warn" title="Aprovar troca estes campos no contrato já cadastrado">muda ${muda} campo${muda>1?'s':''} do contrato</span>`);
    else if(it.contratoExistenteId) t.push('<span class="tag info" title="Já existe um contrato com este número — aprovar atualiza, sem duplicar">atualiza cadastro</span>');
    if(camposLidos(it) < CAMPOS_IMPORTACAO.length/2) t.push('<span class="tag" title="Menos da metade dos campos foi encontrada">poucos dados</span>');
  }
  return t.join('');
}

function montarItemFila(it, ativo){
  const c = it.campos || {};
  const lidos = camposLidos(it), total = CAMPOS_IMPORTACAO.length;
  return `<button type="button" class="fila-item${ativo?' ativo':''}" data-id="${escAttr(String(it.id))}" ${ativo?'aria-current="true"':''} onclick="app.selecionarProposta(${JSON.stringify(it.id).replace(/"/g,'&quot;')})">
    <div class="fila-item-l1"><span class="fila-item-num">${c.numero?esc(c.numero):'Sem número identificado'}</span><span class="fila-item-quando">${esc(quandoCurto(it.criadoEm))}</span></div>
    <div class="fila-item-emp">${esc(c.empresa || (it.arquivo&&it.arquivo.nome) || '')}</div>
    <div class="fila-item-tags">${tagsDaProposta(it)}${statusComProblema(it.status)?'':`<span class="completude" title="${lidos} de ${total} campos encontrados nos documentos"><i><b style="width:${Math.round(lidos/total*100)}%"></b></i>${lidos}/${total}</span>`}</div>
  </button>`;
}

/* Cadeia de gestores e suplentes do contrato, do ato mais recente para o
   mais antigo (ver camposPorRegra.js). Antes, o sistema só sabia dizer
   quem é o gestor HOJE — quem era o gestor na época de um fato ficava
   perdido, porque o apostilamento seguinte substituía o nome. */
function montarHistoricoGestaoHtml(historico, aberto){
  const lista = Array.isArray(historico) ? historico.filter(h=>h && (h.responsavel || h.suplente)) : [];
  if(!lista.length) return '';
  const linhas = lista.map(h=>{
    const quem = [
      h.responsavel ? `<b>Gestor:</b> ${esc(h.responsavel)}` : '',
      h.suplente ? `<b>Suplente:</b> ${esc(h.suplente)}` : ''
    ].filter(Boolean).join(' · ');
    return `<tr>
      <td class="nowrap">${h.termo?`${esc(String(h.termo))}${h.ano?`/${esc(String(h.ano))}`:''}`:'<span class="cel-vazia">—</span>'}</td>
      <td>${quem}${h.atual?' <span class="status-mini ok" title="É o nome que vale hoje">vale hoje</span>':''}</td>
      <td style="font-size:12.5px;color:var(--text-2);overflow-wrap:anywhere;">${esc(h.documento||'')}</td>
    </tr>`;
  });
  return `<details class="ajuda" style="margin:12px 0 0;" ${aberto?'open':''}>
    <summary>${icon('users',14)} Histórico de gestão (${lista.length} ato${lista.length>1?'s':''})</summary>
    <div class="ajuda-corpo" style="padding-left:14px;">${table(['Termo','Quem passou a constar','Documento'], linhas)}</div>
  </details>`;
}

function montarDetalheImportacao(it, souAprovador){
  if(!it) return `<section class="detalhe"><div class="vazio-detalhe">${icon('inbox',30)}<div style="font-size:15px;font-weight:700;color:var(--text);">Nada para mostrar</div><div>${importacoes.length?'Nenhuma proposta neste filtro.':'A fila está vazia — clique em "Varrer pastas agora" para ler as pastas de rede.'}</div></div></section>`;
  const campos = it.campos || {};
  const contratoAtual = contratoDaProposta(it);
  const mudam = camposQueMudam(it);
  const inferidos = camposInferidos(it);
  const fontes = it.arquivosFonte || [];
  const rotulo = k => (CAMPOS_IMPORTACAO.find(f=>f.key===k)||{}).label || k;
  const tipo = k => (CAMPOS_IMPORTACAO.find(f=>f.key===k)||{}).type;
  const formatar = (k, v) => vazioFila(v) ? null : tipo(k)==='number' ? money(v) : tipo(k)==='date' ? formatDate(v) : esc(v);

  const grupos = GRUPOS_IMPORTACAO.map(([titulo, chaves]) => {
    const cards = chaves.map(k => {
      const v = campos[k];
      const f = fonteDoCampo(it, k);
      const muda = mudam.some(m => m.key===k);
      const cls = ['campo', k==='objeto'?'largo':'', vazioFila(v)?'vazio':'', f==='inferido'?'inferido':'', muda?'diferente':''].filter(Boolean).join(' ');
      const rf = !vazioFila(v) && ROTULO_FONTE_FILA[f];
      const conf = (f==='ia' && it.confiancas && it.confiancas[k]!=null) ? ` · ${Math.round(it.confiancas[k]*100)}%` : '';
      const fonte = rf ? `<span class="fonte ${rf[2]}" title="${escAttr(rf[1])}">${rf[0]}${conf}</span>` : '';
      // De qual documento a regra tirou o valor (gestor, suplente, objeto).
      // Até duas linhas, com reticências; o nome inteiro fica no title.
      const deOnde = (it.origemRegra && it.origemRegra[k] && !vazioFila(v))
        ? `<div class="campo-origem" title="Lido de: ${escAttr(String(it.origemRegra[k]))}">${icon('file',12)}<span>${esc(String(it.origemRegra[k]))}</span></div>`
        : '';
      // Campo vazio com explicação da regra (ex.: "o contrato exige preposto, mas...").
      const semValor = (it.origemRegra && it.origemRegra[k + '_semValor'] && vazioFila(v))
        ? `<div class="campo-nota">${esc(String(it.origemRegra[k + '_semValor']))}</div>` : '';
      const antes = muda ? `<div class="antes">No cadastro hoje: ${formatar(k, contratoAtual[k])}</div>`
        : (contratoAtual && vazioFila(v) && !vazioFila(contratoAtual[k])) ? `<div class="campo-nota">Mantém o do cadastro: ${formatar(k, contratoAtual[k])}</div>` : '';
      return `<div class="${cls}"><div class="campo-rotulo">${rotulo(k)}${fonte}</div><div class="campo-valor">${formatar(k, v) || 'não encontrado'}</div>${semValor}${antes}${deOnde}</div>`;
    }).join('');
    const extra = titulo==='Vigência e valor'
      ? montarCalculoValorHtml(it.calculoValor) + montarCalculoVigenciaHtml(it.calculoVigencia)
      : titulo==='Gestão' ? montarHistoricoGestaoHtml(it.gestaoHistorico)
      : '';
    return `<div class="grupo"><h4>${titulo}</h4><div class="campos">${cards}</div>${extra}</div>`;
  }).join('');


  // Alertas no topo: o que precisa de atenção antes de decidir.
  const alertas = [];
  if(it.erro) alertas.push(`<div class="callout callout-err">${icon('close',15)}<span><b>Erro ao processar:</b> ${esc(it.erro)}</span></div>`);
  if(it.status==='sem_texto') alertas.push(`<div class="callout callout-warn">${icon('bell',15)}<span>Não foi possível ler o texto deste arquivo: ele é uma imagem digitalizada e o reconhecimento de texto não conseguiu decifrá-la. Abra o PDF para conferir se é um contrato; se não for, arquive.</span></div>`);
  if(it.status==='pendente'){
    if(inferidos.length) alertas.push(`<div class="callout callout-err">${icon('bell',15)}<span><b>${inferidos.length} campo(s) inferido(s)</b> — ${inferidos.map(k=>esc(rotulo(k))).join(', ')}: não estão escritos no documento. Confira antes de aprovar.</span></div>`);
    if(mudam.length) alertas.push(`<div class="callout callout-warn">${icon('edit',15)}<span><b>Aprovar muda ${mudam.length} campo(s)</b> do contrato ${esc((contratoAtual&&contratoAtual.numero)||'')} já cadastrado${contratoAtual&&contratoAtual.origemExterna?' — dado vindo do SGC (fonte oficial)':''}. Estão destacados em amarelo, com o valor atual; use "Revisar e aprovar" para manter algum.</span></div>`);
    else if(contratoAtual) alertas.push(`<div class="callout callout-info">${icon('doc',15)}<span>Atualiza o contrato já cadastrado <b>${esc(contratoAtual.numero||'')}</b> — só preenche o que estiver vazio nele, sem duplicar.</span></div>`);
    if(camposLidos(it) < CAMPOS_IMPORTACAO.length/2) alertas.push(`<div class="callout callout-info">${icon('doc',15)}<span>Poucos campos encontrados (${camposLidos(it)} de ${CAMPOS_IMPORTACAO.length}). Talvez faltem documentos na pasta — ou o arquivo não seja um contrato.</span></div>`);
  }
  const avisosDaRegra = (it.origemRegra && it.origemRegra._avisos) || [];
  avisosDaRegra.forEach(a => alertas.push(`<div class="callout callout-warn">${icon('bell',15)}<span>${esc(a)}</span></div>`));
  if(it.observacao) alertas.push(`<div class="callout callout-info">${icon('bell',15)}<span>${esc(it.observacao)}</span></div>`);

  const badgeArquivoFonte = f => f.erroExtracao ? ` <span class="badge badge-muted" title="${escAttr(f.erroExtracao)}">erro de leitura</span>`
    : f.semTexto ? ' <span class="badge badge-muted">sem texto</span>'
    : (f.ocr && f.ocr.tentado) ? ' <span class="badge badge-muted" title="O arquivo é uma imagem digitalizada; o texto foi reconhecido automaticamente e pode ter erros">texto reconhecido de imagem</span>' : '';
  const origem = `<details style="margin-top:4px;font-size:12.5px;"><summary style="cursor:pointer;color:var(--muted);">Documentos lidos${fontes.length?` (${fontes.length})`:''} e um trecho do texto</summary>
      ${fontes.length?`<ul style="margin:8px 0 0 18px;color:var(--text-2);">${fontes.map(f=>`<li>${esc(f.nome)}${badgeArquivoFonte(f)}</li>`).join('')}</ul>`:''}
      ${it.recalculo && it.recalculo.length ? `<div class="cel-sub" style="margin-top:8px;">Recalculado pelas regras em ${dataHora(it.recalculadoEm)}: ${it.recalculo.map(m=>`${esc(m.campo)} ${m.de==null?'—':esc(m.de)} → ${m.para==null?'(apagado — data inferida pela IA, não confirmada)':esc(m.para)}`).join('; ')}</div>` : ''}
      ${it.previaTexto?`<div style="white-space:pre-wrap;font-size:12px;background:var(--surface-2);border:1px solid var(--line);border-radius:8px;padding:10px;margin-top:8px;max-height:240px;overflow:auto;">${esc(it.previaTexto)}</div>`:''}
    </details>`;

  // Aprovar direto só quando não há nada a decidir campo a campo; senão o
  // botão principal abre o formulário de revisão.
  const podeAprovarDireto = it.status==='pendente' && !inferidos.length && !mudam.length;
  let acoes = '';
  if(it.status==='pendente' && souAprovador){
    acoes = `<span class="atalhos"><span><kbd class="kbd">↑</kbd> <kbd class="kbd">↓</kbd> navegar</span><span><kbd class="kbd">A</kbd> ${podeAprovarDireto?'aprovar':'revisar e aprovar'}</span><span><kbd class="kbd">R</kbd> rejeitar</span></span>
      <button type="button" class="btn-ghost" onclick="app.abrirRejeicaoImportacao(${it.id})">Rejeitar</button>
      ${podeAprovarDireto
        ? `<button type="button" class="btn-ghost" onclick="app.abrirAprovacaoImportacao(${it.id})">${icon('edit',14)} Editar campos</button>
           <button type="button" class="btn-primary" onclick="app.aprovarImportacaoDireto(${it.id})">${icon('check',15)} Aprovar</button>`
        : `<button type="button" class="btn-primary" onclick="app.abrirAprovacaoImportacao(${it.id})" title="Há campos inferidos ou que mudam o cadastro — confira no formulário">${icon('shield',15)} Revisar e aprovar</button>`}`;
  } else if(statusComProblema(it.status) && souAprovador){
    acoes = `<span class="atalhos"></span><button type="button" class="btn-ghost" onclick="app.abrirRejeicaoImportacao(${it.id})">Arquivar</button>`;
  } else if(it.status==='aprovado'){
    const trocas = (it.camposSobrescritos && it.camposSobrescritos.length)
      ? ` · <details style="display:inline;"><summary style="display:inline;cursor:pointer;text-decoration:underline;">${it.camposSobrescritos.length} campo(s) substituído(s)</summary><ul style="margin:6px 0 0 18px;">${it.camposSobrescritos.map(s=>`<li><b>${esc(s.campo)}</b>: "${esc(s.de)}" → "${esc(s.para)}"</li>`).join('')}</ul></details>`
      : '';
    acoes = `<span class="atalhos">Aprovada por ${esc(it.aprovadoPor||'—')}${it.aprovadoEm?` em ${new Date(it.aprovadoEm).toLocaleString('pt-BR')}`:''}${trocas}</span>${montarAcoesFicha(it.contratoId, souAprovador).replace('style="margin-top:10px;align-items:center;"','style="align-items:center;"')}`;
  } else if(it.status==='rejeitado'){
    acoes = `<span class="atalhos">Rejeitada por ${esc(it.rejeitadoPor||'—')}${it.motivoRejeicao?` — ${esc(it.motivoRejeicao)}`:''}</span>`;
  }

  const titulo = campos.numero ? `Contrato ${esc(campos.numero)}` : esc((it.arquivo&&it.arquivo.nome) || 'Proposta sem número');
  return `<section class="detalhe" aria-label="Proposta selecionada">
    <div class="detalhe-topo">
      <div style="min-width:0;flex:1;">
        <div class="detalhe-titulo">${titulo}</div>
        <div class="detalhe-sub" title="${escAttr((it.arquivo&&it.arquivo.caminho)||'')}">${campos.empresa?`${esc(campos.empresa)} · `:''}${icon('file',12)} ${esc((it.arquivo&&it.arquivo.nome)||'')}${fontes.length>1?` e mais ${fontes.length-1}`:''}${it.origemManual?' · seleção manual':''} · lido ${esc(quandoCurto(it.criadoEm))}${it.stub?' · sem IA real (só busca local)':''}</div>
      </div>
      ${statusImportacaoBadge(it.status)}
    </div>
    <div class="detalhe-corpo">
      ${alertas.join('')}
      ${statusComProblema(it.status) ? '' : grupos}
      ${origem}
    </div>
    ${acoes?`<div class="acoes-fixas">${acoes}</div>`:''}
  </section>`;
}

async function aprovarImportacaoDireto(id){
  const it = importacoes.find(i=>String(i.id)===String(id)); if(!it || it.status!=='pendente') return;
  const dados = {};
  const atual = contratoDaProposta(it);
  // Campo vazio = mantém o que já está gravado. Quando o valor lido é o
  // mesmo do cadastro (só escrito diferente), mantém a grafia do cadastro.
  CAMPOS_IMPORTACAO.forEach(f => {
    const v = (it.campos||{})[f.key];
    const igual = atual && !vazioFila(atual[f.key]) && !vazioFila(v) && mesmoValorDeCampo(f, atual[f.key], v);
    dados[f.key] = (vazioFila(v) || igual) ? '' : String(v);
  });
  try{
    const { _mapaRisco, ...contrato } = await api.aprovarImportacao(id, dados);
    avisarMapaDaAprovacao(contrato, _mapaRisco);
    Object.assign(it, { status:'aprovado', contratoId:contrato.id, aprovadoPor:(currentUser&&currentUser.nome)||'Você', aprovadoEm:new Date().toISOString() });
    const existente = contratos.find(c=>c.id===contrato.id);
    if(existente) Object.assign(existente, contrato); else contratos.unshift(contrato);
    fichasCadastroDados = null;
    irParaProximaPendente(id);
    toast(`Contrato ${(it.campos||{}).numero||''} aprovado.`, 'success');
  }catch(err){ toast(err.message, 'error'); }
  render();
}

/* Estado da varredura numa faixa só: rodando / falhou / última varredura
   (com o que trouxe) — e o progresso da revisão da fila. */
function montarStatusVarredura(s){
  const quando = iso => dataHora(iso, { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
  const p = (varreduraEmAndamento && progressoVarreduraAtual) || (s && s.progresso && s.progresso.emAndamento ? s.progresso : null);
  if(varreduraEmAndamento || p){
    const onde = p && p.totalGrupos ? `processo ${p.grupoAtual} de ${p.totalGrupos}${p.pastaAtual?` — <b>${esc(p.pastaAtual)}</b>`:''}` : 'iniciando';
    return `<div class="faixa-varredura"><span class="spinner" aria-hidden="true"></span><span>Varredura em andamento: ${onde}${p&&p.etapa?` <span class="cel-sub">(${esc(p.etapa)})</span>`:''}</span></div>`;
  }
  if(!s) return `<div class="faixa-varredura"><span class="spinner" aria-hidden="true"></span><span>Carregando...</span></div>`;
  if(s.erro) return `<div class="faixa-varredura err">${icon('bell',16)}<span>Não foi possível consultar a varredura: ${esc(s.erro)}</span></div>`;
  if(!s.pastas || !s.pastas.configurado) return `<div class="faixa-varredura err">${icon('bell',16)}<span>Pastas de rede não configuradas — defina CONTRATOS_ARQUIVOS_PASTAS no .env do servidor.</span></div>`;
  if(s.ultimoErro && (!s.ultimaVarredura || s.ultimoErro.em > s.ultimaVarredura)){
    return `<div class="faixa-varredura err">${icon('bell',16)}<span><b>A varredura de ${quando(s.ultimoErro.em)} falhou:</b> ${esc(s.ultimoErro.mensagem)}</span></div>`;
  }
  // Progresso da revisão: quanto da fila já foi decidido.
  const n = st => importacoes.filter(i=>i.status===st).length;
  const total = importacoes.length, apr = n('aprovado'), rej = n('rejeitado'), pen = n('pendente');
  const pct = x => total ? (x/total*100).toFixed(1) : 0;
  const progresso = (importacoesCarregadas && total) ? `<span class="sep"></span>
    <div class="progresso-revisao"><span class="nowrap"><b>Revisão:</b> ${apr+rej} de ${total} concluídas</span>
      <div class="barra" role="img" aria-label="${apr} aprovadas, ${rej} rejeitadas, ${pen} pendentes"><span style="width:${pct(apr)}%;background:var(--good)"></span><span style="width:${pct(rej)}%;background:var(--line-strong)"></span><span style="width:${pct(pen)}%;background:var(--warning)"></span></div></div>` : '';
  if(!s.ultimaVarredura) return `<div class="faixa-varredura">${icon('folder',16)}<span>Nenhuma varredura feita ainda — clique em "Varrer pastas agora".</span>${progresso}</div>`;

  const r = s.ultimoResumo || {};
  const problemas = r.erros || 0;
  // Todos os avisos (antes só os 10 primeiros, com "16 aviso(s)" no título),
  // numa linha própria quando abertos — ver .faixa-avisos no CSS.
  const avisos = (r.avisos||[]).length
    ? `<details class="faixa-avisos"><summary>${r.avisos.length} aviso(s)</summary><ul>${r.avisos.map(a=>`<li>${esc(a)}</li>`).join('')}</ul></details>`
    : '';
  return `<div class="faixa-varredura${problemas?' warn':''}">
    <span class="ponto" aria-hidden="true"></span>
    <span><b>Última varredura</b> ${quando(s.ultimaVarredura)}</span>
    <span class="sep"></span>
    ${(!r.propostas && !r.semTexto && !r.erros) ? '<span>nada novo ou alterado nas pastas</span>' : `<span><span class="n">${r.propostas||0}</span> nova(s)</span>${r.semTexto?`<span><span class="n">${r.semTexto}</span> sem texto legível</span>`:''}${r.erros?`<span><span class="n">${r.erros}</span> com erro</span>`:''}`}
    ${avisos}${progresso}
  </div>`;
}

function renderImportacoes(){
  if(arquivosStatus===null && !arquivosStatusCarregando) carregarArquivosStatus();
  if(!importacoesCarregadas && !importacoesCarregando) carregarImportacoes();
  const souAprovador = currentUser && (currentUser.role==='admin' || currentUser.role==='gestor');

  const s = arquivosStatus;
  // Varredura rodando no servidor (iniciada em outra aba, pela agenda da
  // madrugada, ou antes de a página ser recarregada): acompanha sozinho.
  if(s && s.progresso && s.progresso.emAndamento && !varreduraEmAndamento){
    clearTimeout(window.__statusVarreduraTimer);
    window.__statusVarreduraTimer = setTimeout(()=>{ if(state.view==='importacoes'){ arquivosStatus = null; importacoesCarregadas = false; render(); } }, 3000);
  }
  // A ficha de cadastro é ação da proposta aprovada.
  if(fichasCadastroDados===null && !fichasCadastroCarregando) carregarFichasCadastro();

  const semPastas = !s || !s.pastas || !s.pastas.configurado;
  const conta = f => importacoes.filter(i => f==='todas' ? true : f==='problema' ? statusComProblema(i.status) : i.status===f).length;
  const fStatus = filtroFila();
  const visiveis = propostasVisiveis();
  const sel = propostaSelecionada();
  if(sel) state.filters['fila-sel'] = sel.id;

  const lista = !importacoesCarregadas
    ? `<div style="padding:14px;">${esqueleto(8, 'Carregando as propostas')}</div>`
    : visiveis.length ? visiveis.map(it => montarItemFila(it, sel && it.id===sel.id)).join('')
    : `<div class="related-empty" style="padding:24px 16px;text-align:center;">Nenhuma proposta neste filtro.${state.filters['search-fila']?` <button type="button" class="link-btn" onclick="app.limparFiltros(['search-fila'])">Limpar busca</button>`:''}</div>`;

  return `
    <div class="page-header">
      <div><h1 class="page-title">Fila de importação</h1><p class="page-subtitle">Revise e aprove o que foi lido dos documentos das pastas de rede</p></div>
      ${souAprovador?`<div class="row-actions" style="flex-wrap:nowrap;align-items:center;">
        <button type="button" class="btn-primary" onclick="app.varrerArquivosAgora()" ${(semPastas||varreduraEmAndamento)?'disabled':''} ${semPastas?'title="Configure CONTRATOS_ARQUIVOS_PASTAS primeiro"':''}>${varreduraEmAndamento?'<span class="spinner" style="width:13px;height:13px;border-color:rgba(255,255,255,.4);border-top-color:#fff;"></span> Varrendo...':`${icon('download',15)} Varrer pastas agora`}</button>
        <details class="menu-mais">
          <summary class="btn-ghost" aria-haspopup="menu">Mais ações ▾</summary>
          <div class="menu-mais-lista" role="menu">
            <button type="button" role="menuitem" onclick="this.closest('details').open=false;app.togglePainelManual()" ${semPastas?'disabled':''}>${painelManualAberto?'Fechar a seleção manual':'Selecionar arquivos manualmente'}<small>Colar um caminho, escolher arquivos ou arrastar da pasta</small></button>
            <button type="button" role="menuitem" onclick="this.closest('details').open=false;app.recalcularPropostas()" ${(recalculandoPropostas||varreduraEmAndamento)?'disabled':''}>${recalculandoPropostas?'Recalculando...':'Recalcular pelas regras'}<small>Reaplica as regras de valor, vigência, objeto e gestor às pendentes e preenche início e término em branco dos contratos aprovados, com o texto já lido — sem IA, em segundos</small></button>
          </div>
        </details>
      </div>`:''}
    </div>
    ${montarStatusVarredura(s)}
    ${souAprovador ? montarPainelManual() : ''}
    <div class="fila">
      <section class="fila-lista" aria-label="Propostas">
        <div class="fila-lista-topo">
          ${searchBox('search-fila', 'Buscar número, empresa, P.A. ou arquivo...', state.filters['search-fila'])}
          ${seletorDeFiltro('filter-status-importacoes', [
            ['pendente','Pendentes',conta('pendente'),'var(--warning)','Lidas e ainda não revisadas','inbox'],
            ['problema','Com problema',conta('problema'),'var(--critical)','Sem texto legível ou erro na leitura','bell'],
            ['aprovado','Aprovadas',conta('aprovado'),'var(--good)','Já gravadas no contrato','check'],
            ['rejeitado','Rejeitadas',conta('rejeitado'),'var(--muted)','Descartadas ou arquivadas','close'],
            ['todas','Todas',conta('todas'),null,'Todas as propostas da fila','layers']
          ], fStatus, 'Situação')}
        </div>
        <div class="fila-itens">${lista}</div>
      </section>
      ${importacoesCarregadas ? montarDetalheImportacao(sel, souAprovador) : `<section class="detalhe"><div class="detalhe-corpo">${esqueleto(10, 'Carregando a proposta')}</div></section>`}
    </div>`;
}

/* Teclado na Fila: ↑/↓ troca de proposta; A aprova (ou abre a revisão);
   R rejeita. Só quando não há janela aberta nem campo em edição. */
document.addEventListener('keydown', function(e){
  if(state.view!=='importacoes' || (modalRoot && modalRoot.innerHTML) || e.ctrlKey || e.metaKey || e.altKey) return;
  const ativo = document.activeElement || {};
  if(/^(INPUT|TEXTAREA|SELECT)$/.test(ativo.tagName||'') || ativo.isContentEditable) return;
  const vis = propostasVisiveis();
  const sel = propostaSelecionada();
  const i = sel ? vis.findIndex(x => x.id===sel.id) : -1;
  if(e.key==='ArrowDown' && i < vis.length-1){ e.preventDefault(); selecionarProposta(vis[i+1].id); return; }
  if(e.key==='ArrowUp' && i > 0){ e.preventDefault(); selecionarProposta(vis[i-1].id); return; }
  const souAprovador = currentUser && (currentUser.role==='admin' || currentUser.role==='gestor');
  if(!sel || sel.status!=='pendente' || !souAprovador) return;
  if(e.key==='a' || e.key==='A'){
    e.preventDefault();
    if(!camposInferidos(sel).length && !camposQueMudam(sel).length) aprovarImportacaoDireto(sel.id);
    else abrirAprovacaoImportacao(sel.id);
  }
  if(e.key==='r' || e.key==='R'){ e.preventDefault(); abrirRejeicaoImportacao(sel.id); }
});
document.addEventListener('click', function(e){
  document.querySelectorAll('details.menu-mais[open]').forEach(d => { if(!d.contains(e.target)) d.open = false; });
});

/* ===================== MAPA DE RISCO (Ferramenta 2) =====================
   Combina o eixo Conteúdo (checklist da lei conferido por regra nos
   documentos do contrato) com os eixos Prazo e
   Financeiro (calculados no servidor a partir de prazo/valor/aditivos/
   tratativas — ver calcularRiscoPrazoFinanceiro em
   integrations/mapaRiscoContratos.js). Só existe para contratos com
   arquivoOrigem; sempre sob demanda, nunca automático. */

function corPorNivel(nivel){
  return { alto:COLORS.critical, medio:COLORS.warning, baixo:COLORS.good }[nivel] || COLORS.muted;
}

/* ===================== BASE DE CONTRATOS =====================
   Os dados que a Ferramenta 1 leu dos arquivos, numa tabela pensada para
   virar base de dados. A regra que manda nesta tela (ver
   integrations/baseContratos.js): leitura automática não se mistura com
   dado conferido. Linha aprovada mostra o registro CONFIRMADO; linha
   pendente mostra a leitura dos documentos, com a procedência de cada célula. */
function carregarBaseContratos(){
  if(baseContratosCarregando) return;
  baseContratosCarregando = true;
  api.baseContratos().then(d=>{
    baseContratosDados = d; baseContratosCarregando = false;
    if(state.view==='baseContratos') render();
  }).catch(err=>{
    baseContratosDados = { erro: err.message }; baseContratosCarregando = false;
    if(state.view==='baseContratos') render();
  });
}

/* Marcador ao lado do valor da célula — o que diz de onde ele veio. Só
   aparece quando há algo a conferir; "lido do documento" e "confirmado" são o
   caso normal da linha e não ganham marcador, pra tabela não virar ruído. */
const MARCA_PROCEDENCIA = {
  inferido:               { simbolo:'⚠', cor:'var(--critical, #c0392b)', titulo:'INFERIDO (leitura antiga da IA) — este valor não está escrito no documento. Confira na fonte.' },
  // "Busca local" não ganha marcador desde 22/09/2026: hoje ela é a origem da
  // maior parte dos campos, e um 🔎 em quase toda célula só ocupava espaço.
  // A procedência de cada campo continua no "Visualizar".
  atualizado_na_aprovacao:{ simbolo:'✎', cor:'var(--text-muted)', titulo:'Este campo do contrato foi atualizado na aprovação, a partir da leitura do documento.' },
  manual:                 { simbolo:'✍', cor:'var(--primary)', titulo:'Informado à mão em Pendências de leitura — quem conferiu assumiu o dado; não veio do documento lido.' }
};

// Colunas de texto livre; as demais (número, P.A., CNPJ, datas, valor) ficam numa linha só.
const COLUNAS_TEXTO_LONGO = ['empresa', 'objeto', 'secretaria', 'tipoContratacao'];

function celulaBase(coluna, valor, procedencia){
  let texto;
  if(valor===null || valor===undefined || valor===''){
    texto = '<span class="cel-vazia" aria-label="não lido">—</span>';
  } else if(coluna.tipo==='data'){
    texto = formatDataCurta(valor);
  } else if(coluna.tipo==='valor'){
    texto = money(valor);
  } else if(coluna.chave==='cnpjEmpresa'){
    texto = esc(formatarCnpj(valor));
  } else {
    const s = String(valor);
    // Texto longo (objeto, empresa, secretaria): até duas linhas na tabela,
    // texto inteiro ao passar o mouse e no "Visualizar".
    texto = COLUNAS_TEXTO_LONGO.includes(coluna.chave) ? `<span class="celula-texto" title="${esc(s)}">${esc(s)}</span>` : esc(s);
  }
  // Marcador no canto da célula (não na linha do texto): não empurra o
  // conteúdo nem cai sozinho numa linha de baixo.
  const marca = MARCA_PROCEDENCIA[procedencia];
  const marcaHtml = marca ? `<span class="cel-marca" title="${esc(marca.titulo)}" style="color:${marca.cor};">${marca.simbolo}</span>` : '';
  const classes = [
    procedencia==='inferido' ? 'cel-inferida' : '',
    marca ? 'cel-com-marca' : '',
    coluna.tipo==='valor' ? 'num' : '',
    COLUNAS_TEXTO_LONGO.includes(coluna.chave) ? '' : 'nowrap'
  ].filter(Boolean).join(' ');
  return `<td${classes?` class="${classes}"`:''}>${texto}${marcaHtml}</td>`;
}


/* Como a vigência foi calculada (ver vigenciaContratual.js): cada período
   (contrato e prorrogações) com início, fim e de onde saiu o marco. */
function montarCalculoVigenciaHtml(calc, aberto){
  if(!calc || (!calc.memoria && !(calc.avisos||[]).length)) return '';
  const periodos = (calc.periodos||[]).map(p => `<li>${esc(p.origem)}: ${p.meses} meses${p.inicio?` de ${formatDate(p.inicio)}`:''}${p.fim?` a <b>${formatDate(p.fim)}</b>${p.fimEscrito?' (data escrita no termo)':''}`:' — término não calculado'} <span style="color:var(--text-muted);">(${esc(p.base||'')})</span></li>`);
  const linhas = [
    calc.inicio ? `<li>${esc(calc.rotuloInicio || 'Início da vigência')}: <b>${formatDate(calc.inicio)}</b>${calc.fonteInicio?` <span style="color:var(--text-muted);">(${esc(calc.fonteInicio)})</span>`:''}</li>` : '',
    calc.assinatura && calc.assinatura !== calc.inicio ? `<li>Assinatura do contrato: ${formatDate(calc.assinatura)}</li>` : '',
    ...(periodos.length ? periodos : (calc.memoria ? [`<li>${esc(calc.memoria)}</li>`] : [])),
    ...(calc.avisos||[]).map(a=>`<li style="color:var(--warning);">${esc(a)}</li>`)
  ].filter(Boolean);
  const resumo = calc.termino ? `término em ${formatDate(calc.termino)}` : 'término não calculado';
  return `<details style="margin-top:8px;" ${aberto?'open':''}><summary style="cursor:pointer;font-size:13px;color:var(--text-2);">Como a vigência foi calculada: ${resumo} (meses contados da assinatura ou da Ordem de Início, prorrogação a prorrogação)</summary><ul style="margin:6px 0 0 18px;font-size:13px;line-height:1.6;">${linhas.join('')}</ul></details>`;
}

/* "Visualizar" da Base de Contratos: tudo o que foi lido e calculado para
   o contrato, inclusive o que a tabela não mostra. */
const ROTULO_PROCEDENCIA_DETALHE = {
  ia:'leitura antiga da IA', busca_local:'lido do documento', busca_local_corrigiu_ia:'lido do documento (corrigiu a IA)',
  inferido:'INFERIDO — não está no documento', atualizado_na_aprovacao:'atualizado na aprovação', confirmado:'confirmado',
  manual:'informado à mão (Pendências de leitura)'
};

async function abrirDetalheBase(propostaId){
  janela.innerHTML = `<div class="modal-overlay" onclick="if(event.target===this) app.closeModal()"><div role="dialog" aria-modal="true" tabindex="-1" class="modal-card wide">${esqueleto(8, 'Carregando o detalhe')}</div></div>`;
  let d;
  try{ d = await api.detalheBaseContratos(propostaId); }
  catch(err){ app.closeModal(); toast(err.message, 'error'); return; }
  const p = d.proposta, c = d.contrato;
  const valorCampo = (f, v) => (v===undefined||v===null||v==='') ? '<span style="color:var(--text-muted);">—</span>'
    : f.type==='number' ? money(v) : f.type==='date' ? formatDate(v) : esc(v);

  // 1. Os 14 campos lidos — com procedência e confiança.
  const camposHtml = CAMPOS_IMPORTACAO.map(f => {
    const proc = p.procedencia[f.key];
    const conf = p.confiancas[f.key];
    return `<tr><td>${f.label}</td><td>${valorCampo(f, p.campos[f.key])}${botaoLeituraErrada({ onde:'Base de dados', referencia: p.campos.numero || (c&&c.numero) || null, campo: f.label, valorLido: p.campos[f.key]==null?null:String(p.campos[f.key]), documento: (p.arquivo && p.arquivo.nome) || null })}</td>
      <td style="font-size:12px;color:${proc==='inferido'?'var(--critical)':'var(--text-muted)'};">${proc?esc(ROTULO_PROCEDENCIA_DETALHE[proc]||proc):''}${(conf!=null&&p.campos[f.key]!=null)?` · ${Math.round(conf*100)}%`:''}</td>
      ${c?`<td>${valorCampo(f, c[f.key])}</td>`:''}</tr>`;
  }).join('');

  // 2. Parcelas do valor no SGC.
  const dv = c && c.sgcValores;
  const sgcHtml = dv ? `<div class="detail-list">
      <div class="detail-row"><span class="detail-label">Valor total no SGC</span><span class="detail-value">${dv.valorContrato!=null?money(dv.valorContrato):'—'}${dv.somenteInicial?' (só o valor inicial)':''}</span></div>
      <div class="detail-row"><span class="detail-label">Aditivos de valor no SGC</span><span class="detail-value">${(dv.aditivosDeValor||[]).length?dv.aditivosDeValor.map(money).join(' + '):'nenhum'}</span></div>
      <div class="detail-row"><span class="detail-label">Vigência cadastrada no SGC</span><span class="detail-value">${dv.vigenciaMeses!=null?`${dv.vigenciaMeses} meses${dv.vigenciaDeAditivo?' (do último aditivo)':''}`:'—'}</span></div>
      <div class="detail-row"><span class="detail-label">Média mensal no SGC</span><span class="detail-value">${dv.valorMediaMensal!=null?money(dv.valorMediaMensal):'—'}</span></div>
    </div>` : '';

  const termosHtml = (d.termosSgc||[]).length
    ? table(['Espécie','Número','Tipo','Data'], d.termosSgc.map(t=>`<tr><td>${esc(t.especie)}</td><td>${esc(t.numero)}</td><td>${esc(t.tipo)}</td><td>${t.data?formatDate(t.data):'—'}</td></tr>`))
    : '<div class="related-empty">Nenhum aditivo ou apostilamento no cadastro deste contrato.</div>';

  const docsHtml = (p.arquivosFonte||[]).length
    ? `<ul style="margin:0 0 0 18px;font-size:12.5px;">${p.arquivosFonte.map(f=>`<li>${esc(f.nome)}${f.semTexto?' <span class="badge badge-muted">sem texto</span>':''}${(f.ocr&&f.ocr.tentado)?' <span class="badge badge-muted" title="O arquivo é uma imagem digitalizada; o texto foi reconhecido automaticamente e pode ter erros">texto reconhecido de imagem</span>':''}${f.erroExtracao?` <span class="badge badge-muted" title="${escAttr(f.erroExtracao)}">erro de leitura</span>`:''}</li>`).join('')}</ul>`
    : '<div class="related-empty">—</div>';

  const secao = (titulo, conteudo) => conteudo ? `<section class="modal-secao"><h4>${titulo}</h4>${conteudo}</section>` : '';
  const situacao = p.status==='aprovado'
    ? `<span class="badge badge-good">Aprovada</span> <span style="font-size:12px;color:var(--text-muted);">por ${esc(p.aprovadoPor||'—')}${p.aprovadoEm?` em ${new Date(p.aprovadoEm).toLocaleString('pt-BR')}`:''}</span>`
    : `<span class="badge badge-warning">Pendente de revisão</span>`;

  janela.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this) app.closeModal()">
      <div role="dialog" aria-modal="true" tabindex="-1" class="modal-card xl">
        <div class="modal-header"><h3>Contrato ${esc(p.campos.numero || (c&&c.numero) || 'sem número')}<span class="modal-sub">${esc(p.campos.empresa || (c&&c.empresa) || '')}</span></h3><button type="button" class="icon-btn modal-fechar" aria-label="Fechar" title="Fechar (Esc)" onclick="app.closeModal()">${icon('close',16)}</button></div>
        <div style="margin:0 0 18px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">${situacao}${p.criadoEm?` <span style="font-size:12px;color:var(--text-muted);">· lido em ${new Date(p.criadoEm).toLocaleString('pt-BR')}</span>`:''}</div>
        ${p.observacao?`<div class="callout callout-info">${icon('bell',15)}<span>${esc(p.observacao)}</span></div>`:''}
        ${secao('Campos lidos dos documentos', table(['Campo','Lido dos documentos','Procedência', ...(c?['No cadastro hoje']:[])], [camposHtml]))}
        ${secao('Cálculos', montarCalculoValorHtml(p.calculoValor) + montarCalculoVigenciaHtml(p.calculoVigencia, true))}
        ${secao('Gestão do contrato', montarHistoricoGestaoHtml(p.gestaoHistorico, true))}
        ${secao('Parcelas do valor no SGC', sgcHtml)}
        ${secao('Aditivos e apostilamentos do contrato', c ? termosHtml : '')}
        ${secao('Documentos lidos', docsHtml)}
        ${(d.ficha||d.mapaRisco)?secao('Outras ferramentas', `<div class="detail-list">
          ${d.ficha?`<div class="detail-row"><span class="detail-label">Ficha de cadastro (SGC)</span><span class="detail-value">gerada em ${formatDate(d.ficha.geradoEm)} · <a href="/api/fichas-cadastro/${d.ficha.id}/arquivo" target="_blank" rel="noopener">baixar PDF</a></span></div>`:''}
          ${d.mapaRisco?`<div class="detail-row"><span class="detail-label">Mapa de risco</span><span class="detail-value">${chipRisco(d.mapaRisco.riscoGeralLabel||'—')} · ${formatDate(d.mapaRisco.geradoEm)}</span></div>`:''}
        </div>`):''}
        <div class="modal-actions">
          ${p.status==='pendente'?`<button class="btn-ghost" onclick="app.closeModal();app.setView('importacoes')">Abrir na Fila de importação</button>`:''}
          <button class="btn-primary" onclick="app.closeModal()">Fechar</button>
        </div>
      </div>
    </div>`;
}

/* Base de dados: contratos numa aba, aditivos e apostilamentos nas
   outras (mesma tabela, mesma exportação) — ver renderBaseTermos. */
function renderBaseContratos(){
  const aba = state.filters['aba-base'] || 'contratos';
  const tt = (baseTermosDados && !baseTermosDados.erro) ? baseTermosDados.totais : null;
  const tc = (baseContratosDados && !baseContratosDados.erro) ? baseContratosDados.totais : null;
  const botaoAba = (v, rotulo, n) => `<button type="button" role="tab" aria-selected="${aba===v}" class="aba${aba===v?' ativa':''}" onclick="app.setFilter('aba-base','${v}')">${rotulo}${n!=null?`<span class="aba-n">${n}</span>`:''}</button>`;
  const cabecalho = `<div class="page-header">
      <div><h1 class="page-title">Base de dados</h1><p class="page-subtitle">${window.__sgcDesligado ? 'O que foi lido dos documentos da pasta de rede' : 'O que foi lido dos documentos e o que o SGC tem cadastrado'} — contratos, aditivos e apostilamentos</p></div>
    </div>
    <div class="abas" role="tablist">
      ${botaoAba('contratos','Contratos', tc?tc.contratos:null)}
      ${botaoAba('aditivos','Aditivos', tt?tt.aditivos:null)}
      ${botaoAba('apostilamentos','Apostilamentos', tt?tt.apostilamentos:null)}
    </div>`;
  // As abas de termos carregam os seus próprios dados.
  if(baseTermosDados===null && !baseTermosCarregando) carregarBaseTermos();
  if(aba==='aditivos') return cabecalho + renderBaseTermos('Aditivo');
  if(aba==='apostilamentos') return cabecalho + renderBaseTermos('Apostilamento');
  if(baseContratosDados===null && !baseContratosCarregando) carregarBaseContratos();
  const d = baseContratosDados;
  if(!d) return cabecalho + `<div class="card">${esqueleto(8, 'Carregando a base de contratos')}</div>`;
  if(d.erro) return cabecalho + `<div class="card"><div class="note-card">${esc(d.erro)}</div></div>`;

  const fSit = state.filters['filter-situacao-base'] || 'todas';
  const q = (state.filters['search-base']||'').trim().toLowerCase();
  if(!state.filters['ordem-base']) state.filters['ordem-base'] = 'numero:desc';
  const [ordChave, ordDir] = state.filters['ordem-base'].split(':');
  const chaveOrdem = (l) => ordChave==='numero' ? chaveDoNumero(l.valores.numero) : l.valores[ordChave];
  const temInferido = l => d.colunas.some(c => l.procedencia[c.chave]==='inferido');
  const t = d.totais;
  const nInferidas = d.linhas.filter(temInferido).length;

  const linhas = d.linhas
    .filter(l => fSit==='todas' || (fSit==='inferidos' ? temInferido(l) : l.situacao===fSit))
    .filter(l => !q || d.colunas.some(c => String(l.valores[c.chave]==null?'':l.valores[c.chave]).toLowerCase().includes(q)))
    .slice()
    .sort((a, b) => compararValores(chaveOrdem(a), chaveOrdem(b), ordDir));

  // A coluna "Contrato" junta número e situação e fica fixa à esquerda; a
  // de ação fica fixa à direita — a tabela é larga e rola para o lado, mas
  // "qual contrato" e "abrir" nunca saem da tela. A linha inteira abre o
  // detalhe; o botão existe para teclado e para quem não sabe que dá.
  const colunas = d.colunas.filter(c => c.chave!=='numero');
  const cabecalhos = [
    thOrdenavel('numero', 'Contrato', 'ordem-base', 'col-fixa-esq'),
    ...colunas.map(c => thOrdenavel(c.chave, esc(c.rotuloCurto||c.rotulo), 'ordem-base', c.tipo==='valor'?'num':''))
  ];
  const rows = linhas.map(l => {
    const aprovada = l.situacao==='aprovada';
    const situacao = aprovada
      ? `<span class="status-mini ok" title="${escAttr(`Conferido por ${l.revisadoPor||'—'}${l.revisadoEm?' em '+new Date(l.revisadoEm).toLocaleDateString('pt-BR'):''}`)}">Aprovada</span>`
      : `<span class="status-mini warn" title="Leitura ainda não conferida — revise na Fila de importação">Pendente</span>`;
    const lidos = colunas.filter(c => l.valores[c.chave]!=null && l.valores[c.chave]!=='').length;
    const semDados = lidos===0 ? `<span class="status-mini muted" title="Nenhum campo foi encontrado nos documentos deste contrato">nada lido</span>` : '';
    return `<tr class="linha-clicavel" onclick="if(!event.target.closest('button,a'))app.abrirDetalheBase(${l.propostaId})">
      <td class="col-fixa-esq"><div class="cel-contrato"><a class="cel-contrato-num link-linha" href="#/leitura/${l.propostaId}">${esc(l.valores.numero||'s/ número')}</a><span class="cel-contrato-status">${situacao}${semDados}</span></div></td>
      ${colunas.map(c=>celulaBase(c, l.valores[c.chave], l.procedencia[c.chave])).join('')}
    </tr>`;
  });

  const filtrando = fSit!=='todas' || q;
  const limpar = `<button type="button" class="link-btn" onclick="app.limparFiltros(['search-base','filter-situacao-base'])">limpar filtros</button>`;
  const legenda = `<div class="tabela-legenda">
      ${nInferidas ? '<span><span style="color:var(--critical,#c0392b);">⚠</span> Inferido (leitura antiga da IA) — confira</span>' : ''}
      <span>✎ Atualizado na aprovação</span>
    </div>`;

  return cabecalho + `
    ${t.camposInferidos ? `<div class="callout callout-warn" style="margin:0 0 16px;">${icon('bell',16)}<span><b>${t.camposInferidos} campo(s) inferido(s)</b> em ${nInferidas} contrato(s) — leitura antiga, confira. <button type="button" class="link-btn" onclick="app.setFilter('filter-situacao-base','inferidos')">Ver só esses</button></span></div>` : ''}
    ${ajuda('<b>Linhas aprovadas</b> mostram o registro <b>confirmado</b> por revisão humana — que pode ter mantido o dado oficial do SGC onde a leitura do documento estava errada. <b>Linhas pendentes</b> mostram a leitura dos documentos, ainda não conferida. A exportação padrão traz só as aprovadas. Clique numa linha (ou em "Ver") para abrir tudo o que foi lido do contrato; clique no título de uma coluna para ordenar.', 'Como ler esta tabela')}
    <div class="card">
      <div class="filters-bar">
        ${searchBox('search-base','Buscar por número, empresa, CNPJ, objeto...', state.filters['search-base'])}
        ${segmentos('filter-situacao-base', [
          ['todas','Todas',t.contratos], ['aprovada','Aprovadas',t.aprovadas], ['pendente','Pendentes',t.pendentes],
          ...(nInferidas ? [['inferidos','Com inferidos',nInferidas]] : [])
        ], fSit, 'Situação')}
        <span style="flex:1;"></span>
        <details class="menu-mais menu-exportar menu-a-direita">
          <summary class="btn-ghost">${icon('download',15)} Exportar <span class="seletor-seta" aria-hidden="true"></span></summary>
          <div class="menu-mais-lista" role="menu">
            <a role="menuitem" href="/api/base-contratos/exportar?escopo=aprovadas" download>Só aprovados<small>Planilha para Excel com os contratos já conferidos</small></a>
            <a role="menuitem" href="/api/base-contratos/exportar?escopo=todas" download>Todos<small>Inclui leituras ainda não conferidas, marcadas como pendentes</small></a>
          </div>
        </details>
      </div>
      ${t.contratos===0
        ? `<div class="empty-state">${icon('grid',30)}<div class="empty-state-title">A base ainda está vazia</div><div>Ela é formada pelos contratos lidos na <a href="#" onclick="event.preventDefault();app.setView('importacoes')">Fila de importação</a>. Varra as pastas e revise as propostas para começar.</div></div>`
        : `<div class="tabela-meta">
            <span><b>${linhas.length}</b> de ${t.contratos} contrato(s)${filtrando?` · ${limpar}`:''}</span>
            ${somaDosValores(linhas.map(l=>({ mensal: null, total: l.valores.valorTotal })))}
            ${legenda}
          </div>
          ${table(cabecalhos, rows, {pagina:true, vazio: `Nenhum contrato encontrado${q?` para "${esc(q)}"`:''} · ${limpar}`})}`}
    </div>`;
}

/* ===================== BASE DE TERMOS (aditivos e apostilamentos) =====================
   As abas "Aditivos" e "Apostilamentos" da Base de dados: o cadastro do
   SGC cruzado com o efeito que a leitura calculou em cada termo (valor e
   prazo) — ver integrations/baseTermos.js. */
let baseTermosDados = null;
let baseTermosCarregando = false;

function carregarBaseTermos(){
  if(baseTermosCarregando) return;
  baseTermosCarregando = true;
  api.baseTermos().then(d=>{
    baseTermosDados = d; baseTermosCarregando = false;
    if(state.view==='baseContratos') render();
  }).catch(err=>{
    baseTermosDados = { erro: err.message }; baseTermosCarregando = false;
    if(state.view==='baseContratos') render();
  });
}

/* Desde 23/09/2026 os termos vêm dos documentos da pasta (ver
   integrations/baseTermos.js): mesma regra da Base de Contratos. */
const SITUACAO_TERMO = {
  aprovado: { rotulo:'Aprovado', classe:'badge-good', dica:'No cadastro: o contrato foi aprovado na Fila de importação e este termo foi gravado junto.' },
  pendente: { rotulo:'Pendente', classe:'badge-warning', dica:'Lido da pasta de um contrato cuja proposta ainda não foi aprovada na Fila de importação.' }
};

function celulaTermo(coluna, valor){
  if(valor===null || valor===undefined || valor==='') return `<td class="${coluna.tipo==='valor'||coluna.tipo==='numero'?'num ':''}"><span class="cel-vazia">—</span></td>`;
  if(coluna.tipo==='data') return `<td class="nowrap">${formatDataCurta(valor)}</td>`;
  if(coluna.tipo==='valor') return `<td class="num nowrap">${money(valor)}</td>`;
  if(coluna.tipo==='numero') return `<td class="num nowrap">${esc(String(valor))}</td>`;
  const longo = ['empresa','tipo','objeto','gestor','suplente'].includes(coluna.chave);
  return `<td${longo?'':' class="nowrap"'}>${longo?`<span class="celula-texto" title="${escAttr(String(valor))}">${esc(String(valor))}</span>`:esc(String(valor))}</td>`;
}

function renderBaseTermos(especie){
  if(baseTermosDados===null && !baseTermosCarregando) carregarBaseTermos();
  const d = baseTermosDados;
  if(!d) return `<div class="card">${esqueleto(8, 'Carregando os termos')}</div>`;
  if(d.erro) return `<div class="card"><div class="callout callout-err" style="margin:0;">${icon('close',15)}<span>${esc(d.erro)}</span></div></div>`;

  const doTipo = d.linhas.filter(l => l.valores.especie===especie);
  const t = {
    termos: doTipo.length,
    aprovados: doTipo.filter(l=>l.situacao==='aprovado').length,
    pendentes: doTipo.filter(l=>l.situacao==='pendente').length,
    comGestao: doTipo.filter(l=>l.valores.gestor||l.valores.suplente).length,
    contratos: new Set(doTipo.map(l=>l.valores.contrato).filter(Boolean)).size,
    valor: doTipo.reduce((s,l)=> s + (Number(l.valores.valor)||0), 0)
  };

  const fSit = state.filters['filter-situacao-termos'] || 'todas';
  const q = (state.filters['search-termos']||'').trim().toLowerCase();
  if(!state.filters['ordem-termos']) state.filters['ordem-termos'] = 'data:desc';
  const [ordChave, ordDir] = state.filters['ordem-termos'].split(':');
  const chave = l => ordChave==='contrato' ? chaveDoNumero(l.valores.contrato)
    : ordChave==='numero' ? chaveDoNumero(l.valores.numero)
    : ordChave==='situacao' ? l.situacao
    : l.valores[ordChave];

  const linhas = doTipo
    .filter(l => fSit==='todas' || l.situacao===fSit)
    .filter(l => !q || ['contrato','numero','empresa','tipo','objeto','natureza'].some(c => String(l.valores[c]||'').toLowerCase().includes(q)))
    .slice()
    .sort((a,b)=> compararValores(chave(a), chave(b), ordDir));

  const colunas = d.colunas.filter(c => c.chave!=='especie' && c.chave!=='contrato' && c.chave!=='numero');
  const cabecalhos = [
    thOrdenavel('contrato','Contrato','ordem-termos','col-fixa-esq'),
    thOrdenavel('numero','Termo','ordem-termos'),
    ...colunas.map(c => thOrdenavel(c.chave, esc(c.rotuloCurto||c.rotulo), 'ordem-termos', (c.tipo==='valor'||c.tipo==='numero')?'num':'')),
    thOrdenavel('situacao','Situação','ordem-termos'),
    ''
  ];
  const rows = linhas.map(l => {
    const s = SITUACAO_TERMO[l.situacao] || { rotulo:l.situacao, classe:'badge-muted', dica:'' };
    return `<tr>
      <td class="col-fixa-esq"><div class="cel-contrato"><span class="cel-contrato-num">${esc(l.valores.contrato||'—')}</span>${l.documento?`<span class="cel-sub celula-texto" title="${escAttr(l.documento)}">${esc(l.documento)}</span>`:''}</div></td>
      <td class="nowrap" style="font-weight:600;">${esc(l.valores.numero||'—')}${l.fonte==='SGC'?'<div class="status-mini muted" title="Veio da API do SGC — sai com a remoção dos dados do SGC">SGC</div>':''}</td>
      ${colunas.map(c=>celulaTermo(c, l.valores[c.chave])).join('')}
      <td><span class="badge ${s.classe}" title="${escAttr(s.dica)}">${s.rotulo}</span></td>
      <td>${l.termoId ? `<button type="button" class="btn-ghost btn-small" title="Campos do formulário do SGC para cadastrar este termo" onclick="app.abrirFichaSgc('termo/${especie==='Aditivo'?'aditivo':'apostilamento'}/${encodeURIComponent(l.termoId)}')">${icon('file',13)} Ficha</button>` : ''}</td>
    </tr>`;
  });

  const nome = especie==='Aditivo' ? 'aditivo' : 'apostilamento';
  const escopo = especie==='Aditivo' ? 'aditivos' : 'apostilamentos';
  const filtrando = fSit!=='todas' || q;
  const limpar = `<button type="button" class="link-btn" onclick="app.limparFiltros(['search-termos','filter-situacao-termos'])">limpar filtros</button>`;

  return `
    <div class="stat-grid">
      ${statCard('layers', COLORS.s1, t.termos, `${especie}s no total`, `em ${t.contratos} contrato(s)`)}
      ${statCard('shield', COLORS.good, t.aprovados, 'Aprovados', 'no cadastro do contrato')}
      ${statCard('inbox', t.pendentes?COLORS.warning:COLORS.muted, t.pendentes, 'Pendentes de revisão', t.pendentes?'aprove o contrato na Fila':null)}
      ${statCard('users', COLORS.s1, t.comGestao, 'Com gestor ou suplente', 'lido do próprio termo')}
    </div>
    ${d.totais.propostasSemLeituraDeTermos ? `<div class="callout callout-info">${icon('bell',15)}<span>${d.totais.propostasSemLeituraDeTermos} proposta(s) foram lidas antes de o sistema ler os termos da pasta. Na Fila de importação, use <b>Mais ações → Recalcular pelas regras</b> para trazê-los.</span></div>` : ''}
    ${ajuda(`Cada linha é um ${nome} lido da pasta de rede do contrato ("3. Contratos, Aditivos e Termos"): número, data de assinatura, o que ele faz, quanto somou ao valor e quantos meses prorrogou — e, nos de gestão, quem passou a constar como gestor ou suplente. <b>Aprovado</b> é termo gravado no cadastro junto com o contrato; <b>pendente</b> é termo de contrato ainda não aprovado na Fila de importação.`, 'Como ler esta tabela')}
    <div class="card">
      <div class="filters-bar">
        ${searchBox('search-termos', `Buscar por contrato, termo, empresa ou tipo...`, state.filters['search-termos'])}
        ${segmentos('filter-situacao-termos', [
          ['todas','Todos',t.termos], ['aprovado','Aprovados',t.aprovados], ['pendente','Pendentes',t.pendentes]
        ], fSit, 'Situação')}
        <span style="flex:1;"></span>
        <a class="btn-primary btn-small" style="text-decoration:none;" href="/api/base-termos/exportar?escopo=${escopo}" download>${icon('download',13)} Exportar ${escopo}</a>
        <a class="btn-ghost btn-small" style="text-decoration:none;" href="/api/base-termos/exportar?escopo=aprovados" download title="Só os termos que já estão no cadastro">${icon('download',13)} Exportar aprovados</a>
      </div>
      <div class="tabela-meta">
        <span><b>${linhas.length}</b> de ${t.termos} ${nome}(s)${filtrando?` · ${limpar}`:''}</span>
        <span class="tabela-legenda"><span>Efeito somado no valor: <b>${money(t.valor)}</b></span></span>
      </div>
      ${table(cabecalhos, rows, {pagina:true, vazio:`Nenhum ${nome} neste filtro · ${limpar}`})}
    </div>`;
}

/* ===================== PENDÊNCIAS DE LEITURA =====================
   As propostas pendentes agrupadas pelo motivo de faltar término, início
   ou valor — e o formulário que resolve o grupo inteiro em série. Ver
   integrations/pendenciasLeitura.js. */
let pendenciasDados = null;
let pendenciasCarregando = false;

function carregarPendencias(){
  if(pendenciasCarregando) return;
  pendenciasCarregando = true;
  api.pendenciasLeitura().then(d=>{
    pendenciasDados = d; pendenciasCarregando = false;
    if(state.view==='pendenciasLeitura') render();
  }).catch(err=>{
    pendenciasDados = { erro: err.message }; pendenciasCarregando = false;
    if(state.view==='pendenciasLeitura') render();
  });
}

function renderPendenciasLeitura(){
  if(pendenciasDados===null && !pendenciasCarregando) carregarPendencias();
  const d = pendenciasDados;
  const souAprovador = currentUser && (currentUser.role==='admin' || currentUser.role==='gestor');
  const cabecalho = `<div class="page-header">
      <div><h1 class="page-title">Pendências de leitura</h1><p class="page-subtitle">Por que o término, o início ou o valor não foram calculados — e o que resolve cada caso</p></div>
    </div>`;
  if(!d) return cabecalho + `<div class="card">${esqueleto(8, 'Carregando as pendências')}</div>`;
  if(d.erro) return cabecalho + `<div class="card"><div class="callout callout-err" style="margin:0;">${icon('close',15)}<span>${esc(d.erro)}</span></div></div>`;

  const t = d.totais;
  const grupos = d.grupos.map(g => {
    const linhas = g.itens.map(i => `<tr>
        <td class="nowrap"><div class="cel-contrato"><span class="cel-contrato-num">${esc(i.numero||'sem número')}</span>${i.pa?`<span class="cel-sub">P.A. ${esc(i.pa)}</span>`:''}</div></td>
        <td><span class="celula-texto" title="${escAttr(i.empresa||'')}">${esc(i.empresa||'—')}</span></td>
        <td class="nowrap">${i.meses?`${i.meses} meses`:'<span class="cel-vazia">—</span>'}</td>
        <td class="nowrap">${i.inicio?formatDataCurta(i.inicio):'<span class="cel-vazia">—</span>'}</td>
        <td class="nowrap">${i.valor!=null?money(i.valor):'<span class="cel-vazia">—</span>'}</td>
        <td>${i.dadosManuais?`<span class="status-mini ok" title="${escAttr(`Informado por ${i.dadosManuais.por||'—'}`)}">dado informado</span>`:''}</td>
        <td class="col-fixa-dir">${souAprovador
          ? `<button type="button" class="btn-primary btn-small" onclick="app.abrirPendencia('${g.chave}', ${JSON.stringify(i.propostaId).replace(/"/g,'&quot;')})">${icon('edit',13)} Resolver</button>`
          : `<button type="button" class="btn-ghost btn-small" onclick="app.abrirPendencia('${g.chave}', ${JSON.stringify(i.propostaId).replace(/"/g,'&quot;')})">${icon('eye',13)} Ver trechos</button>`}</td>
      </tr>`);
    return `<section class="card" style="margin-bottom:16px;">
      <div class="page-header" style="margin:0 0 10px;align-items:flex-start;">
        <div>
          <h2 class="card-title">${esc(g.titulo)} <span class="badge badge-warning" style="margin-left:6px;">${g.itens.length}</span></h2>
          <p class="card-subtitle" style="margin:4px 0 0;max-width:760px;">${esc(g.explicacao)}</p>
        </div>
      </div>
      <div class="callout callout-info" style="margin:0 0 12px;">${icon('check',15)}<span><b>Como resolver:</b> ${esc(g.comoResolver)}</span></div>
      ${table(['Contrato','Empresa','Vigência lida','Início','Valor mensal','','Ações'], linhas)}
    </section>`;
  }).join('');

  /* Termos de encerramento achados na pasta, esperando confirmação — o
     contrato só vira Encerrado quando alguém confirma (termoEncerramento.js). */
  const enc = d.encerramentos || [];
  const secaoEncerramentos = enc.length ? `<section class="card" style="margin-bottom:16px;">
      <h2 class="card-title">Confirmar encerramento <span class="badge badge-warning" style="margin-left:6px;">${enc.length}</span></h2>
      <p class="card-subtitle" style="margin:4px 0 12px;max-width:780px;">Foi encontrado um termo de encerramento na pasta do processo, citando o número do contrato. O cadastro <b>não</b> foi alterado: confirme para o contrato passar a <b>Encerrado</b> (sai do Mapa de risco e dos ativos), ou descarte se o termo não for o encerramento deste contrato.</p>
      ${enc.map(e=>`<div class="encerramento-item">
        <div class="encerramento-topo">
          <div class="cel-contrato"><span class="cel-contrato-num">${esc(e.numero||'—')}</span><span class="cel-sub">${esc(e.empresa||'')}${e.pa?` · P.A. ${esc(e.pa)}`:''}</span></div>
          <div class="encerramento-datas">
            <span><span class="cel-sub">Encerrado em (termo)</span><b>${e.data?formatDate(e.data):'data não lida'}</b></span>
            <span><span class="cel-sub">Término no cadastro</span><b>${e.termino?formatDate(e.termino):'—'}</b></span>
          </div>
        </div>
        ${e.motivo?`<div class="cel-sub" style="margin-top:6px;"><b>Motivo:</b> ${esc(e.motivo)}</div>`:''}
        ${e.citacao?`<q class="evid-frase" style="margin-top:6px;">${esc(e.citacao)}</q>`:''}
        <div class="encerramento-rodape">
          <span class="campo-origem" title="${escAttr(e.caminho||'')}">${icon('file',12)}<span>${esc(e.arquivo||'')}</span></span>
          ${souAprovador?`<span class="row-actions" style="flex-wrap:nowrap;">
            <button type="button" class="btn-ghost btn-small" onclick="app.decidirEncerramento(${JSON.stringify(e.contratoId).replace(/"/g,'&quot;')}, 'descartar')">Não é o encerramento</button>
            <button type="button" class="btn-primary btn-small" onclick="app.decidirEncerramento(${JSON.stringify(e.contratoId).replace(/"/g,'&quot;')}, 'confirmar')">${icon('check',13)} Confirmar encerramento</button>
          </span>`:'<span class="cel-sub">Um gestor ou administrador confirma.</span>'}
        </div>
      </div>`).join('')}
    </section>` : '';

  /* Término, valor ou gestor que mudaram por termo novo (ver
     mudancasPorTermos.js): da Fila (aprovar a proposta confirma) ou do
     recálculo de um contrato aprovado (confirmar campo a campo). */
  const mud = d.mudancas || [];
  const valorDaMudanca = (m, v) => v==null || v==='' ? '—' : m.tipo==='data' ? formatDate(v) : m.tipo==='valor' ? money(v) : esc(v);
  const secaoMudancas = mud.length ? `<section class="card" style="margin-bottom:16px;">
      <h2 class="card-title">Mudanças vindas de termos novos <span class="badge badge-warning" style="margin-left:6px;">${mud.length}</span></h2>
      <p class="card-subtitle" style="margin:4px 0 12px;max-width:780px;">A releitura dos documentos dá um término, valor mensal ou gestor diferente do cadastro — em geral, uma prorrogação, um acréscimo ou um apostilamento arquivado depois da aprovação. O cadastro <b>não</b> foi alterado: confira e confirme.</p>
      ${mud.map(x=>`<div class="encerramento-item">
        <div class="encerramento-topo">
          <div class="cel-contrato"><a class="cel-contrato-num" href="#/contrato/${x.contratoId}">${esc(x.numero||'—')}</a><span class="cel-sub">${esc(x.empresa||'')}${x.naFila?' · proposta nova na Fila de importação':' · releitura pelas regras'}</span></div>
        </div>
        <div class="table-wrap" style="margin-top:8px;"><table><thead><tr><th>Campo</th><th>No cadastro</th><th>Relido</th><th>De onde</th>${!x.naFila && souAprovador?'<th class="num">Decisão</th>':''}</tr></thead><tbody>
          ${x.mudancas.map(m=>`<tr><td><b>${esc(m.rotulo)}</b></td><td class="nowrap">${valorDaMudanca(m, m.de)}</td><td class="nowrap"><b>${valorDaMudanca(m, m.para)}</b></td>
            <td>${m.motivo?esc(m.motivo):''}${m.documento?`<div class="cel-sub">${icon('file',11)} ${esc(m.documento)}</div>`:''}</td>
            ${!x.naFila && souAprovador?`<td class="num nowrap"><span class="row-actions" style="flex-wrap:nowrap;justify-content:flex-end;">
              <button type="button" class="btn-ghost btn-small" onclick="app.decidirMudanca(${Number(x.contratoId)}, '${m.campo}', 'descartar')">Descartar</button>
              <button type="button" class="btn-primary btn-small" onclick="app.decidirMudanca(${Number(x.contratoId)}, '${m.campo}', 'confirmar')">${icon('check',13)} Confirmar</button></span></td>`:''}
          </tr>`).join('')}
        </tbody></table></div>
        <div class="encerramento-rodape">
          ${x.naFila ? `<span class="cel-sub">Aprovar a proposta na Fila atualiza o contrato (a revisão mostra cada campo que muda).</span><button type="button" class="btn-primary btn-small" onclick="app.setFilter('search-fila', ${escAttr(JSON.stringify(x.numero||''))});app.setView('importacoes')">${icon('inbox',13)} Revisar na Fila</button>`
            : (souAprovador ? '<span class="cel-sub">Confirmar grava o valor novo no contrato; descartar não volta a sugerir o mesmo valor. A decisão fica na Auditoria.</span>' : '<span class="cel-sub">Um gestor ou administrador confirma.</span>')}
        </div>
      </div>`).join('')}
    </section>` : '';

  return cabecalho + `
    ${secaoMudancas}
    ${secaoEncerramentos}
    ${!grupos ? '' : `<div class="stat-grid">
      ${statCard('inbox', COLORS.s1, t.pendentes, 'Propostas pendentes', 'na Fila de importação')}
      ${statCard('bell', t.semTermino?COLORS.critical:COLORS.good, t.semTermino, 'Sem término calculado')}
      ${statCard('bell', t.semInicio?COLORS.warning:COLORS.good, t.semInicio, 'Sem início')}
      ${statCard('coin', t.semValor?COLORS.warning:COLORS.good, t.semValor, 'Sem valor mensal')}
    </div>`}
    ${ajuda('Esta tela agrupa as propostas da Fila pelo <b>motivo</b> de o cálculo não ter saído, porque o motivo quase sempre se repete — o caso mais comum é o contrato contar a vigência da Ordem de Início, documento que costuma ficar fora da pasta de rede. Ao informar a data, o término é calculado pela regra de sempre (data + meses + prorrogações); nada é digitado "pronto". O dado informado fica marcado como <b>informado à mão</b> na proposta e na Base de dados, com quem informou e quando, e não é sobrescrito pelo recálculo.', 'Como esta tela funciona')}
    ${grupos || (mud.length || enc.length ? '' : `<div class="card"><div class="empty-state">${icon('check',30)}<div class="empty-state-title">Nenhuma pendência de leitura</div><div>Todas as propostas pendentes têm início, término e valor calculados.</div></div></div>`)}`;
}

async function decidirMudanca(contratoId, campo, acao){
  const x = ((pendenciasDados && pendenciasDados.mudancas) || []).find(i=>String(i.contratoId)===String(contratoId) && !i.naFila);
  const m = x && x.mudancas.find(i=>i.campo===campo);
  if(!m) return;
  const v = val => val==null || val==='' ? '—' : m.tipo==='data' ? formatDate(val) : m.tipo==='valor' ? money(val) : val;
  const ok = await confirmDialog(acao==='confirmar'
    ? `${esc(m.rotulo)} do contrato <b>${esc(x.numero)}</b>: <b>${esc(v(m.de))}</b> → <b>${esc(v(m.para))}</b>${m.motivo?` (${esc(m.motivo)})`:''}. Alertas, situação, valor total e gratificação passam a usar o valor novo. A decisão fica na Auditoria.`
    : `O ${esc(m.rotulo.toLowerCase())} relido (${esc(v(m.para))}) deixa de ser sugerido para o contrato <b>${esc(x.numero)}</b>. O cadastro continua ${esc(v(m.de))}.`,
    { title: acao==='confirmar' ? 'Confirmar a mudança?' : 'Descartar esta mudança?', confirmLabel: acao==='confirmar' ? 'Confirmar' : 'Descartar' });
  if(!ok) return;
  try{
    await api.decidirMudanca(contratoId, campo, acao);
    toast(acao==='confirmar' ? `${m.rotulo} do contrato ${x.numero} atualizado.` : `Mudança descartada para o contrato ${x.numero}.`, 'success');
    pendenciasDados = null; mapasRiscoDados = null; termosDados.aditivos = null; termosDados.apostilamentos = null;
    await recarregarDadosAposSincronizacao();
  }catch(err){ toast(err.message, 'error'); }
}

async function decidirEncerramento(contratoId, acao){
  const e = ((pendenciasDados && pendenciasDados.encerramentos) || []).find(x=>String(x.contratoId)===String(contratoId));
  if(!e) return;
  const ok = await confirmDialog(acao==='confirmar'
    ? `O contrato <b>${esc(e.numero)}</b> passa a <b>Encerrado</b>${e.data?` em ${esc(formatDate(e.data))}`:''}, com base no termo "${esc(e.arquivo)}". Ele sai do Mapa de risco e da lista de ativos. A decisão fica na Auditoria.`
    : `O termo "${esc(e.arquivo)}" deixa de ser sugerido para o contrato <b>${esc(e.numero)}</b> (enquanto o arquivo não mudar). O cadastro não muda.`,
    { title: acao==='confirmar' ? 'Confirmar encerramento?' : 'Descartar este termo?', confirmLabel: acao==='confirmar' ? 'Confirmar encerramento' : 'Descartar' });
  if(!ok) return;
  try{
    await api.decidirEncerramento(contratoId, acao);
    toast(acao==='confirmar' ? `Contrato ${e.numero} encerrado.` : `Termo descartado para o contrato ${e.numero}.`, 'success');
    pendenciasDados = null; mapasRiscoDados = null;
    await recarregarDadosAposSincronizacao();
  }catch(err){ toast(err.message, 'error'); }
}

/* Janela de uma pendência: os trechos dos documentos que falam do
   assunto (para conferir sem abrir o PDF) e o formulário do dado que
   falta. */
async function abrirPendencia(grupoChave, propostaId){
  const d = pendenciasDados || {};
  const grupo = (d.grupos||[]).find(g=>g.chave===grupoChave);
  const item = grupo && grupo.itens.find(i=>String(i.propostaId)===String(propostaId));
  if(!grupo || !item) return;
  const souAprovador = currentUser && (currentUser.role==='admin' || currentUser.role==='gestor');

  const campos = grupo.pedidos.map(p => {
    const valor = p.chave==='meses' && item.meses ? item.meses : '';
    return `<label class="field">
      <span>${esc(p.rotulo)}</span>
      <span style="display:block;font-weight:500;font-size:12px;color:var(--muted);margin:2px 0 4px;">${esc(p.dica)}</span>
      <input type="${p.tipo}" name="${esc(p.chave)}" ${p.tipo==='number'?'step="0.01" min="0"':''} value="${escAttr(String(valor))}" ${souAprovador?'':'disabled'}>
    </label>`;
  }).join('');

  const cabecalhoJanela = `
    <div class="modal-header"><h3>${esc(item.numero||'Proposta')}<span class="modal-sub">${esc(item.empresa||'')} · ${esc(grupo.titulo)}</span></h3><button type="button" class="icon-btn modal-fechar" aria-label="Fechar" title="Fechar (Esc)" onclick="app.closeModal()">${icon('close',16)}</button></div>
    <div class="callout callout-warn">${icon('bell',15)}<span>${esc(item.detalhe||grupo.explicacao)}</span></div>`;

  modalRoot.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this) app.closeModal()">
      <div role="dialog" aria-modal="true" tabindex="-1" class="modal-card wide">
        ${cabecalhoJanela}
        <section class="modal-secao"><h4>Trechos dos documentos</h4><div id="trechos-pendencia">${esqueleto(4, 'Procurando nos documentos lidos')}</div></section>
        <section class="modal-secao">
          <h4>Informar o dado que falta</h4>
          ${souAprovador ? `<form id="form-pendencia">${campos}
            <label class="field"><span>Onde você conferiu (opcional)</span><input type="text" name="observacao" maxlength="120" placeholder="ex.: Ordem de Início no processo 12.345/2023, fl. 87"></label>
          </form>` : `<div class="related-empty">Só administradores e gestores podem informar dados.</div>`}
          <p class="modal-nota">O término é recalculado pela regra (marco + meses + prorrogações). O campo fica marcado como <b>informado à mão</b>, com seu nome e a data.</p>
        </section>
        <div class="modal-actions">
          ${item.dadosManuais?`<span class="acoes-esq">Já informado por ${esc(item.dadosManuais.por||'—')}${item.dadosManuais.em?` em ${new Date(item.dadosManuais.em).toLocaleDateString('pt-BR')}`:''}</span>`:''}
          <button type="button" class="btn-ghost" onclick="app.closeModal()">Fechar</button>
          ${souAprovador?`<button type="button" class="btn-primary" id="btn-pendencia" onclick="app.salvarPendencia('${grupo.chave}', ${JSON.stringify(item.propostaId).replace(/"/g,'&quot;')})">${icon('check',15)} Gravar e recalcular</button>`:''}
        </div>
      </div>
    </div>`;

  try{
    const r = await api.trechosPendencia(propostaId, grupoChave);
    const alvo = document.getElementById('trechos-pendencia');
    if(!alvo) return;
    alvo.innerHTML = r.trechos.length
      ? r.trechos.map(t=>`<div style="border:1px solid var(--line);border-radius:var(--r);padding:10px 12px;margin-bottom:8px;">
          <div class="cel-sub" style="margin-bottom:4px;">${icon('file',12)} ${esc(t.documento)}</div>
          <div style="font-size:12.5px;line-height:1.55;">${esc(t.trecho)}</div>
        </div>`).join('')
      : `<div class="callout callout-info" style="margin:0;">${icon('doc',15)}<span>${esc(r.aviso||'Nada encontrado.')}</span></div>`;
  }catch(err){
    const alvo = document.getElementById('trechos-pendencia');
    if(alvo) alvo.innerHTML = `<div class="callout callout-err" style="margin:0;">${icon('close',15)}<span>${esc(err.message)}</span></div>`;
  }
}

async function salvarPendencia(grupoChave, propostaId){
  const form = document.getElementById('form-pendencia');
  if(!form) return;
  const dados = Object.fromEntries(new FormData(form).entries());
  const botao = document.getElementById('btn-pendencia');
  if(botao){ botao.disabled = true; botao.textContent = 'Gravando...'; }
  try{
    const r = await api.aplicarPendencia(propostaId, dados);
    closeModal();
    const resumo = r.alterados.length
      ? r.alterados.map(a=>`${a.campo === 'termino' ? 'término' : a.campo}: ${a.para ? (a.campo==='valor'?money(a.para):formatDataCurta(a.para)) : '—'}`).join(' · ')
      : 'nenhum campo mudou';
    toast(`${r.numero||'Proposta'} atualizada — ${resumo}.`, 'success');
    if(r.semTexto) toast('Os documentos desta pasta ainda não foram lidos: o término só será calculado depois da próxima varredura.', 'error');
    pendenciasDados = null; importacoesCarregadas = false; baseContratosDados = null;
    carregarPendencias();
    render();
  }catch(err){
    toast(err.message, 'error');
    if(botao){ botao.disabled = false; botao.textContent = 'Gravar e recalcular'; }
  }
}

/* ===================== CONFERÊNCIA SGC =====================
   O SGC contra os documentos da pasta de rede: a média mensal recalculada
   pela regra do SGC (com os termos aditivos) e o CNPJ. Quando não bate,
   diz o porquê provável — ver integrations/conferenciaSgc.js. É só um
   relatório: nada aqui altera o SGC. */
function carregarConferenciaSgc(){
  if(conferenciaSgcCarregando) return;
  conferenciaSgcCarregando = true;
  api.conferenciaSgc().then(d=>{
    conferenciaSgcDados = d; conferenciaSgcCarregando = false;
    if(state.view==='conferenciaSgc') render();
  }).catch(err=>{
    conferenciaSgcDados = { erro: err.message }; conferenciaSgcCarregando = false;
    if(state.view==='conferenciaSgc') render();
  });
}

const SITUACAO_CONFERENCIA = {
  diverge:                   { rotulo:'Diverge', classe:'badge-critical', dica:'A média do SGC não bate com os documentos e não há explicação automática — conferir.' },
  sgc_desatualizado_ou_erro: { rotulo:'SGC desatualizado', classe:'badge-warning', dica:'Não bate, mas o motivo foi identificado (termo não lançado, erro de digitação, divisão errada…).' },
  sem_calculo:               { rotulo:'Sem cálculo', classe:'badge-muted', dica:'Valor global ou vigência não encontrados nos documentos.' },
  sem_documentos:            { rotulo:'Documentos não lidos', classe:'badge-muted', dica:'A pasta existe, mas nenhum documento foi lido pela varredura ainda.' },
  confere:                   { rotulo:'Confere', classe:'badge-good', dica:'A média do SGC bate com a calculada pelos documentos.' },
  sem_pasta:                 { rotulo:'Sem pasta na rede', classe:'badge-muted', dica:'Nenhuma pasta com este P.A. em "Contratos em Vigência".' }
};
// Divergências primeiro: é o que pede ação.
const ORDEM_CONFERENCIA = { diverge:0, sgc_desatualizado_ou_erro:1, sem_calculo:2, sem_documentos:3, confere:4, sem_pasta:5 };

function diferencaConferencia(l){
  if(l.valorSgc==null || l.valorDocumentos==null) return null;
  const abs = Number(l.valorSgc) - Number(l.valorDocumentos);
  const pct = Number(l.valorDocumentos) ? abs / Number(l.valorDocumentos) * 100 : null;
  return { abs, pct };
}

function formatarDiferenca(dif, situacao){
  if(!dif) return '<span class="cel-vazia">—</span>';
  if(situacao==='confere' || Math.abs(dif.abs) < 0.01) return '<span class="status-mini ok">igual</span>';
  const cor = situacao==='diverge' ? 'var(--err)' : 'var(--warn)';
  const sinal = dif.abs > 0 ? '+' : '−';
  return `<div style="color:${cor};font-weight:600;">${sinal} ${money(Math.abs(dif.abs))}</div>${dif.pct!=null?`<div class="cel-sub">${sinal}${Math.abs(dif.pct).toLocaleString('pt-BR',{maximumFractionDigits:1})}% sobre os documentos</div>`:''}`;
}

function renderConferenciaSgc(){
  if(window.__sgcDesligado) return `<div class="page-header"><div><h1 class="page-title">Conferência com o SGC</h1></div></div>
    <div class="card"><div class="empty-state">${icon('layers',30)}<div class="empty-state-title">Integração com o SGC desligada</div><div>A conferência compara o cadastro do SGC com os documentos da pasta de rede. Com a integração desligada e os dados do SGC removidos, não há o que comparar.</div></div></div>`;
  if(conferenciaSgcDados===null && !conferenciaSgcCarregando) carregarConferenciaSgc();
  const d = conferenciaSgcDados;
  const acaoReconferir = `<button type="button" class="btn-ghost btn-small" onclick="app.reconferirSgc()" ${conferenciaSgcCarregando?'disabled':''} title="Conferir de novo, com os documentos lidos até agora">${icon('refresh',13)} Conferir de novo</button>`;
  const cabecalho = `<div class="page-header">
      <div><h1 class="page-title">Conferência com o SGC</h1><p class="page-subtitle">O cadastro do SGC comparado com os documentos da pasta de rede — média mensal e CNPJ</p></div>
      ${d && !d.erro && d.configurado ? `<div style="display:flex;align-items:center;gap:10px;">${d.geradoEm?`<span class="cel-sub">Conferido às ${new Date(d.geradoEm).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</span>`:''}${acaoReconferir}</div>` : ''}
    </div>`;
  if(!d) return cabecalho + `<div class="card"><p class="card-subtitle" style="display:flex;align-items:center;gap:8px;"><span class="spinner" aria-hidden="true"></span>Conferindo o SGC com os documentos...</p>${esqueleto(6)}</div>`;
  if(d.erro) return cabecalho + `<div class="card"><div class="callout callout-err" style="margin:0;">${icon('close',15)}<span>${esc(d.erro)}</span></div><div style="margin-top:12px;">${acaoReconferir}</div></div>`;
  if(!d.configurado) return cabecalho + `<div class="card"><div class="empty-state">${icon('folder',30)}<div class="empty-state-title">Pasta de rede não configurada</div><div>Defina <code>CONTRATOS_ARQUIVOS_PASTAS</code> no <code>.env</code> para conferir o SGC com os documentos.</div></div></div>`;

  const t = d.totais;
  const temCnpj = l => l.cnpj && ['invalido','diverge'].includes(l.cnpj.situacao);
  const nSemCalculo = d.linhas.filter(l => l.situacao==='sem_calculo' || l.situacao==='sem_documentos').length;
  const fSit = state.filters['filter-situacao-conf'] || 'com_pasta';
  const q = (state.filters['search-conf']||'').trim().toLowerCase();
  const passaFiltro = l => fSit==='todas' ? true
    : fSit==='com_pasta' ? l.situacao!=='sem_pasta'
    : fSit==='cnpj' ? temCnpj(l)
    : fSit==='sem_calculo' ? (l.situacao==='sem_calculo' || l.situacao==='sem_documentos')
    : l.situacao===fSit;
  if(!state.filters['ordem-conf']) state.filters['ordem-conf'] = 'situacao:asc';
  const [ordChave, ordDir] = state.filters['ordem-conf'].split(':');
  const chave = l => ordChave==='situacao' ? (ORDEM_CONFERENCIA[l.situacao] ?? 9)
    : ordChave==='contrato' ? chaveDoNumero(l.numero)
    : ordChave==='sgc' ? l.valorSgc
    : ordChave==='documentos' ? l.valorDocumentos
    : ordChave==='diferenca' ? (diferencaConferencia(l) ? Math.abs(diferencaConferencia(l).abs) : null)
    : null;
  const linhas = d.linhas
    .filter(passaFiltro)
    .filter(l => !q || [l.numero, l.empresa, l.pa].some(v => String(v||'').toLowerCase().includes(q)))
    .slice()
    .sort((a,b) => compararValores(chave(a), chave(b), ordDir)
      || compararValores(diferencaConferencia(a) ? Math.abs(diferencaConferencia(a).abs) : null, diferencaConferencia(b) ? Math.abs(diferencaConferencia(b).abs) : null, 'desc'));

  const rows = linhas.map(l => {
    const s = SITUACAO_CONFERENCIA[l.situacao] || { rotulo:l.situacao, classe:'badge-muted', dica:'' };
    const diag = (l.diagnosticos||[])[0];
    const mais = Math.max(0, (l.diagnosticos||[]).length - 1);
    const motivo = diag
      ? `<span class="celula-texto" style="max-width:460px;" title="${escAttr((l.diagnosticos||[]).join('\n'))}">${esc(diag)}</span>${mais?`<span class="cel-sub">+ ${mais} observação(ões)</span>`:''}`
      : l.situacao==='confere' ? `<span class="cel-sub">${l.aditivos && l.aditivos.length ? `Inclui ${l.aditivos.length} termo(s) aditivo(s)` : 'Sem termos com efeito no valor'}</span>`
      : `<span class="cel-sub">${esc(s.dica)}</span>`;
    const clicavel = l.situacao!=='sem_pasta';
    return `<tr class="${clicavel?'linha-clicavel':''}" ${clicavel?`onclick="if(!event.target.closest('button,a'))app.abrirDetalheConferencia(${JSON.stringify(String(l.contratoId)).replace(/"/g,'&quot;')})"`:''}>
      <td class="col-fixa-esq"><div class="cel-contrato"><span class="cel-contrato-num">${esc(l.numero||'—')}</span><span class="celula-texto cel-sub" title="${escAttr(l.empresa||'')}">${esc(l.empresa||'')}</span>${l.pa?`<span class="cel-sub">P.A. ${esc(l.pa)}</span>`:''}</div></td>
      <td><span class="badge ${s.classe}" title="${escAttr(s.dica)}">${s.rotulo}</span>${temCnpj(l)?`<div style="margin-top:6px;"><span class="status-mini warn" title="${escAttr(l.cnpj.mensagem||'')}">CNPJ</span></div>`:''}${l.naoLidos?`<div class="cel-sub" style="margin-top:4px;" title="Documentos da pasta ainda não lidos pela varredura">${l.naoLidos} doc. não lido(s)</div>`:''}</td>
      <td class="num">${l.valorSgc!=null?money(l.valorSgc):'<span class="cel-vazia">—</span>'}</td>
      <td class="num">${l.valorDocumentos!=null?money(l.valorDocumentos):'<span class="cel-vazia">—</span>'}</td>
      <td class="num">${formatarDiferenca(diferencaConferencia(l), l.situacao)}</td>
      <td style="min-width:260px;">${motivo}</td>
      <td class="col-fixa-dir">${clicavel?`<button type="button" class="btn-ghost btn-small" onclick="app.abrirDetalheConferencia(${JSON.stringify(String(l.contratoId)).replace(/"/g,'&quot;')})">${icon('eye',14)} Ver cálculo</button>`:''}</td>
    </tr>`;
  });

  const filtrando = fSit!=='com_pasta' || q;
  const limpar = `<button type="button" class="link-btn" onclick="app.limparFiltros(['search-conf','filter-situacao-conf'])">limpar filtros</button>`;
  const pct = t.comPasta ? Math.round(t.confere / t.comPasta * 100) : 0;

  return cabecalho + `
    <div class="stat-grid">
      ${statCard('shield', COLORS.good, `${t.confere}<span style="font-size:14px;color:var(--muted);font-weight:600;"> / ${t.comPasta}</span>`, 'Média mensal confere', `${pct}% dos contratos com pasta`, `app.setFilter('filter-situacao-conf','confere')`)}
      ${statCard('bell', t.diverge?COLORS.critical:COLORS.muted, t.diverge, 'Divergem — conferir', t.diverge?'Sem explicação automática':null, `app.setFilter('filter-situacao-conf','diverge')`)}
      ${statCard('layers', t.explicado?COLORS.warning:COLORS.muted, t.explicado, 'SGC desatualizado ou com erro', t.explicado?'Motivo identificado':null, `app.setFilter('filter-situacao-conf','sgc_desatualizado_ou_erro')`)}
      ${statCard('grid', t.cnpjComProblema?COLORS.critical:COLORS.muted, t.cnpjComProblema, 'CNPJ com problema', null, `app.setFilter('filter-situacao-conf','cnpj')`)}
    </div>
    ${t.semParcelasSgc?`<div class="callout callout-warn">${icon('bell',15)}<span><b>${t.semParcelasSgc} contrato(s) ainda sem as parcelas do valor no SGC</b> (valor total, aditivos de valor, vigência) — elas explicam boa parte das divergências. <a href="#" onclick="event.preventDefault();app.setView('integracoes')">Sincronize com o SGC</a> e confira de novo.</span></div>`:''}
    ${ajuda('A média mensal é recalculada pela regra do SGC — <b>(valor inicial + aditivos de valor) ÷ (vigência inicial + prorrogações)</b> — a partir do contrato e dos termos aditivos da pasta "3. Contratos, Aditivos e Termos". Só entram documentos já lidos pela varredura; nada aqui altera o SGC. <b>Diferença</b> = média no SGC − média pelos documentos. "Exportar correções" gera a planilha para encaminhar a quem mantém o SGC.', 'Como a conferência é feita')}
    <div class="card">
      <div class="filters-bar">
        ${searchBox('search-conf','Buscar por número, empresa ou P.A....', state.filters['search-conf'])}
        ${segmentos('filter-situacao-conf', [
          ['com_pasta','Com pasta',t.comPasta], ['diverge','Divergem',t.diverge], ['sgc_desatualizado_ou_erro','SGC desatualizado',t.explicado],
          ['confere','Conferem',t.confere], ...(nSemCalculo?[['sem_calculo','Sem cálculo',nSemCalculo]]:[]), ...(t.cnpjComProblema?[['cnpj','CNPJ',t.cnpjComProblema]]:[]),
          ['sem_pasta','Sem pasta',t.semPasta], ['todas','Todos',t.contratos]
        ], fSit, 'Situação')}
        <span style="flex:1;"></span>
        <a class="btn-primary btn-small" style="text-decoration:none;" href="/api/conferencia-sgc/exportar" download title="Planilha para Excel com os contratos a corrigir no SGC e o motivo de cada um">${icon('download',13)} Exportar correções</a>
      </div>
      <div class="tabela-meta">
        <span><b>${linhas.length}</b> de ${t.contratos} contrato(s)${filtrando?` · ${limpar}`:''}</span>
        <span class="tabela-legenda">${t.documentosNaoLidos?`<span>${t.documentosNaoLidos} documento(s) da rede ainda não lido(s) — rode a varredura para incluí-los</span>`:''}<span>Clique na linha para ver o cálculo termo a termo</span></span>
      </div>
      ${table([
        thOrdenavel('contrato','Contrato','ordem-conf','col-fixa-esq'),
        thOrdenavel('situacao','Situação','ordem-conf'),
        thOrdenavel('sgc','Média no SGC','ordem-conf','num'),
        thOrdenavel('documentos','Pelos documentos','ordem-conf','num'),
        thOrdenavel('diferenca','Diferença','ordem-conf','num'),
        'Por quê',
        '<th class="col-fixa-dir">Ações</th>'
      ], rows, {pagina:true, vazio:`Nenhum contrato neste filtro · ${limpar}`})}
    </div>`;
}

/* Detalhe de uma linha da conferência: os dois valores lado a lado, o
   cálculo termo a termo e cada diagnóstico por extenso. */
function abrirDetalheConferencia(contratoId){
  const l = ((conferenciaSgcDados && conferenciaSgcDados.linhas) || []).find(x=>String(x.contratoId)===String(contratoId));
  if(!l) return;
  const s = SITUACAO_CONFERENCIA[l.situacao] || { rotulo:l.situacao, classe:'badge-muted', dica:'' };
  const dif = diferencaConferencia(l);
  const bloco = (rotulo, valor, dica, extra) => `<div class="resumo-bloco${extra||''}"><div class="resumo-rotulo">${rotulo}</div><div class="resumo-valor">${valor}</div>${dica?`<div class="resumo-dica">${dica}</div>`:''}</div>`;
  const classeDif = !dif ? '' : (l.situacao==='confere' || Math.abs(dif.abs)<0.01) ? ' nivel-baixo' : l.situacao==='diverge' ? ' nivel-alto' : ' nivel-medio';

  const aditivos = (l.aditivos||[]).map(a=>`<tr>
      <td class="nowrap" style="font-weight:600;">${esc(a.termo||'—')}</td>
      <td>${esc(a.natureza||'—')}${a.detalhe?`<div class="cel-sub">${esc(a.detalhe)}</div>`:''}</td>
      <td class="num">${a.valor!=null?money(a.valor):'<span class="cel-vazia">—</span>'}</td>
      <td class="num">${a.meses!=null?`${a.meses} meses`:'<span class="cel-vazia">—</span>'}</td>
      <td style="font-size:12.5px;color:var(--text-2);overflow-wrap:anywhere;">${esc(a.documento||'—')}</td>
    </tr>`);

  const diagnosticos = (l.diagnosticos||[]).map(x=>`<li style="margin-bottom:6px;">${esc(x)}</li>`).join('');
  const avisos = (l.avisosCalculo||[]).map(x=>`<li style="margin-bottom:4px;">${esc(x)}</li>`).join('');

  janela.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this) app.closeModal()">
      <div role="dialog" aria-modal="true" tabindex="-1" class="modal-card wide" aria-label="Conferência do contrato ${escAttr(l.numero||'')}">
        <div class="modal-header"><h3>Conferência — ${esc(l.numero||'—')}<span class="modal-sub">${esc(l.empresa||'')}${l.pa?` · P.A. ${esc(l.pa)}`:''}${l.processo?` · pasta ${esc(l.processo)}`:''}</span></h3><button type="button" class="icon-btn modal-fechar" aria-label="Fechar" title="Fechar (Esc)" onclick="app.closeModal()">${icon('close',16)}</button></div>
        <div style="margin:0 0 18px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;"><span class="badge ${s.classe}">${s.rotulo}</span><span class="cel-sub">${esc(s.dica)}</span></div>
        <section class="modal-secao">
          <h4>Média mensal</h4>
          <div class="resumo-blocos">
            ${bloco('No SGC', l.valorSgc!=null?money(l.valorSgc):'—', 'Como está cadastrado hoje')}
            ${bloco('Pelos documentos', l.valorDocumentos!=null?money(l.valorDocumentos):'—', 'Calculada pela regra do SGC', ' destaque')}
            ${bloco('Diferença', dif ? (Math.abs(dif.abs)<0.01 ? 'Nenhuma' : `${dif.abs>0?'+':'−'} ${money(Math.abs(dif.abs))}`) : '—', dif && dif.pct!=null && Math.abs(dif.abs)>=0.01 ? `${Math.abs(dif.pct).toLocaleString('pt-BR',{maximumFractionDigits:1})}% ${dif.abs>0?'acima':'abaixo'} do valor pelos documentos` : '', classeDif)}
          </div>
          ${l.memoria?`<p class="modal-nota" style="margin:10px 0 0;"><b>Cálculo:</b> ${esc(l.memoria)}</p>`:''}
        </section>
        ${diagnosticos?`<section class="modal-secao"><h4>Por que não bate <span class="contagem">${(l.diagnosticos||[]).length}</span></h4><ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.55;">${diagnosticos}</ul></section>`:''}
        ${aditivos.length?`<section class="modal-secao"><h4>Termos considerados no cálculo <span class="contagem">${aditivos.length}</span></h4>${table(['Termo','Natureza','Valor','Prazo','Documento'], aditivos)}</section>`:''}
        ${l.cnpj && l.cnpj.situacao!=='confere' && l.cnpj.mensagem?`<section class="modal-secao"><h4>CNPJ</h4><div class="callout ${['invalido','diverge'].includes(l.cnpj.situacao)?'callout-err':'callout-info'}" style="margin:0;">${icon('doc',15)}<span>${esc(l.cnpj.mensagem)}</span></div></section>`:''}
        ${avisos||l.naoLidos?`<section class="modal-secao"><h4>Observações da leitura</h4><ul style="margin:0;padding-left:18px;font-size:12.5px;color:var(--text-2);line-height:1.5;">${avisos}${l.naoLidos?`<li>${l.naoLidos} de ${l.documentos||'?'} documento(s) da pasta ainda não foram lidos — entram depois da próxima varredura.</li>`:''}</ul></section>`:''}
        <div class="modal-actions">
          <span class="acoes-esq">Só leitura — nada aqui altera o SGC</span>
          <button type="button" class="btn-primary" onclick="app.closeModal()">Fechar</button>
        </div>
      </div>
    </div>`;
}

function carregarMapasRisco(){
  if(mapasRiscoCarregando) return;
  mapasRiscoCarregando = true;
  api.mapasRiscoStatus().then(d=>{
    mapasRiscoDados = d; mapasRiscoCarregando = false;
    if(state.view==='mapaRisco') render();
  }).catch(err=>{
    mapasRiscoDados = { erro: err.message }; mapasRiscoCarregando = false;
    if(state.view==='mapaRisco') render();
  });
}

/* A geração roda em segundo plano no servidor (lê todos os documentos,
   com OCR dos digitalizados — pode levar minutos). Aqui só se
   dispara e se acompanha o andamento, sem segurar requisição aberta. */
let mapaRiscoProgresso = null;      // último estado lido de /api/mapas-risco/progresso
let mapaRiscoAcompanhando = false;  // evita dois laços de consulta ao mesmo tempo

async function gerarOuAtualizarMapaRisco(contratoId, reabrirModal){
  try{
    await api.gerarMapaRisco(contratoId);
  }catch(err){ toast(err.message, 'error'); return; }
  mapasRiscoGerandoIds.add(contratoId);
  toast('Geração do mapa de risco iniciada — isto leva alguns minutos. Pode continuar usando o sistema.', 'success');
  render();
  if(reabrirModal) recarregarPagina('analise-risco', contratoId);
  acompanharMapaRisco(reabrirModal ? contratoId : null);
}

/* Refaz a análise de todos os contratos (só administrador). O servidor
   nunca faz OCR novo aqui — ver mapaRiscoContratos.js. */
async function atualizarTodosMapasRisco(){
  const total = (mapasRiscoDados && mapasRiscoDados.itens || []).length + (mapasRiscoDados && mapasRiscoDados.encerrados || []).length;
  const ok = await confirmDialog(
    `Refaz a análise dos ${total} contrato(s) com as regras atuais, usando só o texto que já foi lido dos documentos — nenhum PDF é lido de novo, e leva poucos segundos. As análises anteriores continuam no histórico.`,
    { title: 'Atualizar todas as análises?', confirmLabel: 'Atualizar todas' });
  if(!ok) return;
  try{ await api.atualizarTodosMapasRisco(); }
  catch(err){ toast(err.message, 'error'); return; }
  toast('Atualização das análises iniciada.', 'success');
  acompanharMapaRisco(null);
}

async function acompanharMapaRisco(contratoIdModal){
  if(mapaRiscoAcompanhando) return;
  mapaRiscoAcompanhando = true;
  try{
    for(;;){
      try{ mapaRiscoProgresso = await api.progressoMapaRisco(); }catch(e){ /* rede instável: tenta de novo no próximo ciclo */ }
      const p = mapaRiscoProgresso;
      if(p && p.emAndamento){
        if(p.contratoId!=null) mapasRiscoGerandoIds.add(p.contratoId);
        atualizarAndamentoNaTela();
        await new Promise(r=>setTimeout(r, 3000));
        continue;
      }
      // Terminou (ou nada rodando): libera os botões e recarrega os mapas.
      const concluidoId = p && ((p.ultimoConcluido && p.ultimoConcluido.contratoId) || (p.ultimoErro && p.ultimoErro.contratoId));
      mapasRiscoGerandoIds.clear();
      atualizarAndamentoNaTela();
      const lote = p && p.ultimoConcluido && p.ultimoConcluido.lote;
      if(p && p.ultimoErro) toast(`O mapa de risco não pôde ser gerado: ${p.ultimoErro.mensagem}`, 'error');
      else if(lote) toast(`Análises atualizadas: ${lote.feitos - lote.falhas.length} de ${lote.total}${lote.falhas.length?` · ${lote.falhas.length} falharam (ver Auditoria)`:''}.`, lote.falhas.length?'error':'success');
      else if(p && p.ultimoConcluido) toast('Mapa de risco concluído.', 'success');
      mapasRiscoDados = null;               // força recarregar a lista com o mapa novo
      carregarMapasRisco();
      api.riscosAtuais().then(r=>{ riscosPorContrato = r || riscosPorContrato; }).catch(()=>{}); // Painel e Contratos
      if(contratoIdModal && String(contratoIdModal)===String(concluidoId)){
        // Reabre o detalhe quando os dados novos chegarem.
        const esperar = setInterval(()=>{ if(mapasRiscoDados && mapasRiscoDados.itens){ clearInterval(esperar); recarregarPagina('analise-risco', contratoIdModal); } }, 300);
      }
      break;
    }
  } finally {
    mapaRiscoAcompanhando = false;
  }
}

/* Atualiza só o texto do andamento, sem re-renderizar a página inteira
   a cada 3s (perderia rolagem e foco). */
function atualizarAndamentoNaTela(){
  const p = mapaRiscoProgresso;
  const texto = p && p.emAndamento ? (p.etapa || 'gerando...') : '';
  document.querySelectorAll('[data-andamento-mapa-risco]').forEach(el=>{ el.textContent = texto; el.hidden = !texto; });
}

/* Um apontamento do mapa de risco. De onde veio (documento e página) é
   descoberto conferindo a citação contra o texto lido — não é o que o
   modelo AFIRMA. Citação que não aparece nos documentos é marcada: pode
   ter sido parafraseada ou inventada, e não pode ser lida como trecho
   do contrato. */
function montarFindingHtml(f){
  const nivelLabel = {alto:'Alto', medio:'Médio', baixo:'Baixo'}[f.nivel] || f.nivel;
  const origem = [f.documento ? esc(f.documento) : null, f.pagina ? `página ${f.pagina}` : null].filter(Boolean).join(' · ');
  const alertaCitacao = f.citacaoVerificada===false
    ? `<div class="alert-row-sub" style="color:var(--critical,#c0392b);">⚠ Esta citação não foi encontrada nos documentos lidos (análise antiga, da época da IA). Confira no original antes de usar.</div>`
    : '';
  return `<div class="alert-row" style="align-items:flex-start;">
    <div class="alert-row-main">
      <div class="alert-row-title">${chipRisco(nivelLabel)} <span style="margin-left:6px;">${esc(f.titulo)}</span>${f.clausula?` <span style="color:var(--text-muted);font-weight:400;">— ${esc(f.clausula)}</span>`:''}${origem?` <span style="color:var(--text-muted);font-weight:400;">· ${origem}</span>`:''}</div>
      ${f.citacao?`<div style="font-style:italic;color:var(--text-secondary);margin:6px 0;padding:8px 10px;border-left:3px solid var(--border);background:var(--surface-2);border-radius:4px;">"${esc(f.citacao)}"</div>`:''}
      ${alertaCitacao}
      ${f.recomendacao?`<div class="alert-row-sub"><b>Recomendação:</b> ${esc(f.recomendacao)}</div>`:''}
    </div>
  </div>`;
}

const SITUACAO_CHECKLIST = {
  atende:                             { rotulo:'Atende', classe:'badge-good', cor:'var(--good)' },
  atende_parcialmente:                { rotulo:'Atende parcialmente', classe:'badge-warning', cor:'var(--warning)' },
  nao_atende:                         { rotulo:'Não atende', classe:'badge-critical', cor:'var(--critical)' },
  nao_localizado:                     { rotulo:'Não localizado', classe:'badge-critical', cor:'var(--critical)' },
  nao_localizado_leitura_incompleta:  { rotulo:'Não localizado — leitura incompleta', classe:'badge-muted', cor:'var(--line-strong)' },
  nao_se_aplica:                      { rotulo:'Não previsto (opcional)', classe:'badge-muted', cor:'var(--line-strong)' },
  falha:                              { rotulo:'Para conferência manual', classe:'badge-muted', cor:'var(--line-strong)' }
};

/* O porquê de cada eixo do mapa de risco, em uma linha. */
function dicaPrazoRisco(p){
  if(!p) return '';
  if(p.naoSeAplica) return 'não se aplica: contrato encerrado';
  return [p.dias!=null ? (p.dias<0 ? `venceu há ${-p.dias} dia(s)` : `vence em ${p.dias} dia(s)`) : 'sem data de término',
    p.tratativasAbertas ? `${p.tratativasAbertas} tratativa(s) em aberto` : ''].filter(Boolean).join(' · ');
}
function dicaFinanceiroRisco(f){
  if(!f) return '';
  if(f.naoSeAplica) return f.encerrado ? 'não se aplica: contrato encerrado' : 'não se aplica: acordo/termo de cooperação sem repasse de recursos';
  // Análise feita depois da recalibração (25/09/2026): o motivo que pesou.
  if(Array.isArray(f.motivos)){
    const pesaram = f.motivos.filter(m=>m.pontos>0);
    if(!pesaram.length) return f.percentualAcrescimo!=null ? `acréscimos: ${(f.percentualAcrescimo*100).toLocaleString('pt-BR',{maximumFractionDigits:1})}% do valor inicial (limite legal: 25%)` : 'nenhum sinal de risco financeiro';
    return pesaram.map(m=>m.titulo || m.texto.split(' — ')[0].split(': ')[0]).join(' · ');
  }
  return [f.valor!=null ? `${money(f.valor)}/mês` : 'sem valor', f.qtdAditivos ? `${f.qtdAditivos} aditivo(s)` : 'nenhum aditivo'].join(' · ');
}
function dicaGestaoRisco(g){
  if(!g) return 'eixo criado depois desta análise';
  const pesaram = (g.motivos||[]).filter(m=>m.criticidade>0);
  return pesaram.length ? pesaram.map(m=>m.titulo||m.texto).join(' · ') : 'gestor, suplente e preposto identificados';
}

/* "O que fazer agora" (28/09/2026): os riscos da carteira agrupados pela
   ação que resolve, do mais urgente ao menos (ver acoesDaCarteira no
   servidor). Os três primeiros grupos já vêm abertos. */
function montarAcoesDaCarteiraHtml(acoes){
  if(!acoes.length) return '';
  const URGENTES = ['confirmar_encerramento','nova_contratacao','regularizar_vencido','decidir_prorrogacao','garantia'];
  const grupos = acoes.map((g, i)=>{
    const abrir = g.chave==='confirmar_encerramento'
      ? `app.setView('pendenciasLeitura')`
      : null;
    const itens = g.itens.map(it=>`<li>
        <button type="button" class="acao-contrato" onclick="${abrir || `app.abrirDetalheMapaRisco(${JSON.stringify(it.contratoId).replace(/"/g,'&quot;')})`}">
          <span class="acao-num">${esc(it.numero||'—')}</span>
          <span class="acao-emp">${esc(it.empresa||'')}</span>
          <span class="acao-det">${esc(it.detalhe||'')}</span>
        </button>
      </li>`).join('');
    return `<details class="acao-grupo${URGENTES.includes(g.chave)?' urgente':''}">
      <summary><span class="acao-titulo">${esc(g.titulo)}</span><span class="acao-contagem">${g.itens.length}</span><span class="acao-explicacao">${esc(g.explicacao||'')}</span></summary>
      <ul class="acao-lista">${itens}</ul>
    </details>`;
  }).join('');
  return `<section class="card acoes-carteira">
    <h2 class="card-title">${icon('bell',16)} O que fazer agora</h2>
    <p class="card-subtitle" style="margin:2px 0 10px;">Agrupado pela ação que resolve, do mais urgente ao menos. Abra um grupo para ver os contratos.</p>
    ${grupos}
  </section>`;
}

/* "Como chegamos a este nível": a conta de cada eixo, com o motivo e o
   dado de cada ponto, e a regra do risco geral (o pior dos eixos). */
function montarContaDoRiscoHtml(m){
  const cor = (n, rotulo) => n ? chipRisco({alto:'Alto',medio:'Médio',baixo:'Baixo'}[n]) : `<span class="badge badge-muted">${esc(rotulo||'n/d')}</span>`;
  // Desde 28/09/2026 cada motivo é um risco do Registro, com probabilidade ×
  // impacto = criticidade (1 a 25); análises antigas trazem "+pontos".
  const selo = x => x.informativo ? '<span class="conta-pts zero" title="Só informa; não pesa no nível">info</span>'
    : x.probabilidade && x.impacto ? `<span class="conta-pts" title="Probabilidade ${x.probabilidade} × impacto ${x.impacto}${x.criterio?` — ${escAttr(x.criterio)}`:''}">${x.probabilidade}×${x.impacto} = ${x.criticidade}</span>`
    : `<span class="conta-pts${x.pontos?'':' zero'}">${x.pontos?`+${x.pontos}`:'0'}</span>`;
  const lista = motivos => `<ul class="conta-motivos">${motivos.map(x=>`<li>${selo(x)}<span>${esc(x.texto)}${x.criterio?` <span class="cel-sub">— ${esc(x.criterio)}</span>`:''}${x.tratadoPeloGestor?' <span class="cel-sub">(com tratamento registrado)</span>':''}</span></li>`).join('')}</ul>`;
  const porCriticidade = e => Array.isArray(e.motivos) && e.motivos.some(x=>x.criticidade!=null);
  const eixoPontuado = (titulo, e) => `<div class="conta-eixo">
      <div class="conta-topo"><b>${titulo}</b>${cor(e.nivel, e.nivelLabel)}</div>
      ${!e.motivos && !e.nivel ? '<p class="modal-nota" style="margin:0;">Eixo criado depois desta análise. Clique em "Atualizar análise" para vê-lo.</p>'
        : Array.isArray(e.motivos)
        ? `${lista(e.motivos)}<div class="conta-total">${porCriticidade(e) ? `Maior criticidade: <b>${e.pontos}</b>` : `Total: <b>${e.pontos} ponto(s)</b>`} · ${esc(e.regua||'')}</div>`
        : `<p class="modal-nota" style="margin:0;">Análise anterior ao detalhamento dos pontos. Clique em "Atualizar análise" para ver a conta.</p>`}
    </div>`;
  const f = (m.conteudo && m.conteudo.findings) || [];
  const conteudo = `<div class="conta-eixo">
      <div class="conta-topo"><b>Conteúdo</b>${m.conteudo ? cor(m.conteudo.nivel) : cor(null)}</div>
      ${!m.conteudo ? '<p class="modal-nota" style="margin:0;">Não analisado — sem texto legível dos documentos.</p>'
        : f.length ? `<ul class="conta-motivos">${f.map(x=>`<li><span class="conta-pts nivel-${esc(x.nivel)}">${esc({alto:'alto',medio:'médio',baixo:'baixo'}[x.nivel]||x.nivel)}</span><span>${esc(x.titulo)}</span></li>`).join('')}</ul><div class="conta-total">O nível é o do ponto mais grave.</div>`
        : '<p class="modal-nota" style="margin:0;">Nenhum ponto de risco nas cláusulas conferidas.</p>'}
    </div>`;
  const gestao = m.gestao || {};
  const nome = {alto:'Alto',medio:'Médio',baixo:'Baixo'};
  const partes = [`Conteúdo ${nome[m.conteudo && m.conteudo.nivel]||'n/d'}`, `Prazo ${nome[m.prazo.nivel]||'n/d'}`,
    `Financeiro ${nome[m.financeiro.nivel]||(m.financeiro.nivelLabel||'n/d').toLowerCase()}`];
  if(m.gestao) partes.push(`Gestão ${nome[gestao.nivel]||'n/d'}`);
  return `<section class="modal-secao">
    <h4>Como chegamos a este nível</h4>
    <p class="modal-nota" style="margin:0 0 10px;">O risco geral é o <b>pior</b> dos ${m.gestao?'quatro':'três'} eixos, não a média (eixo que não se aplica fica de fora): ${esc(partes.slice(0,-1).join(', '))} e ${esc(partes[partes.length-1])} → <b>${esc(m.riscoGeralLabel)}</b>. Em Prazo, Financeiro e Gestão cada risco vem do Registro de riscos: probabilidade × impacto (1 a 25); 15 ou mais é Alto, 8 a 14 é Médio.</p>
    <div class="conta-eixos">${conteudo}${eixoPontuado('Prazo', m.prazo)}${eixoPontuado('Financeiro', m.financeiro)}${eixoPontuado('Gestão', gestao)}</div>
  </section>`;
}

/* Uma evidência do checklist: o elemento que ela comprova e a frase do
   contrato. Até ~200 caracteres, inteira; mais que isso, o começo (numa
   palavra inteira) e um <details> nativo que abre a frase completa. */
const EVIDENCIA_CURTA = 200;
function montarEvidenciaHtml(e){
  const frase = String(e.citacao||'');
  const rotulo = `<span class="evid-rotulo">${icon('check',11)} ${esc(e.rotulo||'Trecho')}</span>`;
  if(frase.length <= EVIDENCIA_CURTA) return `<div class="evid">${rotulo}<q class="evid-frase">${esc(frase)}</q></div>`;
  const corte = frase.lastIndexOf(' ', EVIDENCIA_CURTA - 40);
  const inicio = frase.slice(0, corte > 80 ? corte : EVIDENCIA_CURTA - 40);
  return `<details class="evid">
    <summary>${rotulo}<q class="evid-frase evid-inicio">${esc(inicio)}…</q><span class="evid-acao"></span></summary>
    <q class="evid-frase">${esc(frase)}</q>
  </details>`;
}

function montarChecklistHtml(checklist){
  if(!Array.isArray(checklist) || !checklist.length) return '';
  // Resumo antes da tabela: quantos itens em cada situação, numa barra.
  const contagem = {};
  checklist.forEach(c=>{ contagem[c.situacao] = (contagem[c.situacao]||0) + 1; });
  const ordem = Object.keys(SITUACAO_CHECKLIST).filter(k=>contagem[k]);
  const barra = `<div class="barra-prop" role="img" aria-label="${escAttr(ordem.map(k=>`${contagem[k]} ${SITUACAO_CHECKLIST[k].rotulo}`).join(', '))}">${ordem.map(k=>`<span style="width:${contagem[k]/checklist.length*100}%;background:${SITUACAO_CHECKLIST[k].cor};"></span>`).join('')}</div>
    <div class="legenda-prop">${ordem.map(k=>`<span><i style="background:${SITUACAO_CHECKLIST[k].cor};"></i>${contagem[k]} ${SITUACAO_CHECKLIST[k].rotulo.toLowerCase()}</span>`).join('')}</div>`;

  const linhas = checklist.map(c=>{
    // "Não se aplica" com motivo (acordo de cooperação sem repasse); sem motivo é o opcional não previsto.
    const s = (c.situacao==='nao_se_aplica' && c.observacao) ? { rotulo:'Não se aplica', classe:'badge-muted' }
      : (SITUACAO_CHECKLIST[c.situacao] || { rotulo:c.situacao, classe:'badge-muted' });
    const onde = (c.documentos||[]).map(d=>`<div>${esc(d.nome)}${d.pagina?` <span class="cel-sub">p. ${d.pagina}</span>`:''}</div>`).join('');
    // Item conferido pela regra (fato escrito, com a frase como prova).
    // Ver integrations/checklistPorRegra.js.
    const fonte = c.fonte==='regra' ? '<div class="cel-sub" style="margin-top:4px;">Leitura automática</div>' : '';
    // Todas as evidências, cada uma com o que ela prova. A frase longa
    // mostra o começo e abre inteira no lugar ("ver frase inteira") —
    // antes era cortada em 160 caracteres, sem jeito de ler o resto.
    const prova = (c.evidencias||[]).length ? `<div class="evidencias">${c.evidencias.map(montarEvidenciaHtml).join('')}</div>` : '';
    const falta = (c.faltando||[]).length && c.situacao!=='atende'
      ? `<div class="cel-sub" style="margin-top:4px;">Não encontrado no texto: ${esc(c.faltando.join('; '))}</div>` : '';
    return `<tr>
      <td style="min-width:200px;"><div style="font-weight:600;">${esc(c.item)}${c.obrigatorio?'':' <span class="cel-sub" style="font-weight:400;">(quando for o caso)</span>'}</div><div class="cel-sub" style="margin-top:2px;">${esc(c.referencia)}</div></td>
      <td style="min-width:170px;"><span class="badge ${s.classe}"${c.erro?` title="${escAttr(c.erro)}"`:''}>${s.rotulo}</span>${fonte}${falta}${c.observacao?`<div class="cel-sub" style="margin-top:4px;">${esc(c.observacao)}</div>`:""}</td>
      <td style="font-size:12.5px;color:var(--text-2);overflow-wrap:anywhere;">${onde||'<span class="cel-vazia">—</span>'}${prova}</td>
    </tr>`;
  });
  return `<section class="modal-secao">
      <h4>Cláusulas exigidas — ${checklist.some(c=>/8.666/.test(c.referencia||'')) ? 'Lei 8.666/1993, art. 55' : 'Lei 14.133/2021, art. 92'} <span class="contagem">${checklist.length} itens</span></h4>
      ${barra}
      <div style="margin-top:12px;">${table(['Cláusula','Situação','Onde foi localizada'], linhas)}</div>
      <p class="modal-nota" style="margin:8px 0 0;">Régua de partida técnica — precisa ser validada pelo jurídico da Prefeitura antes de uso oficial. A leitura automática confere o que está escrito (percentual da multa, índice do reajuste, garantia) e mostra a frase como prova; o que depende de interpretação fica para conferência manual.</p>
    </section>`;
}

function montarDocumentosLidosHtml(docs){
  if(!Array.isArray(docs) || !docs.length) return '';
  const itens = docs.map(d=>{
    const estado = d.semTexto ? '<span class="badge badge-muted">sem texto legível</span>'
      : d.leituraCompleta ? `<span class="status-mini ok">${d.totalPaginas} pág. · lido por inteiro</span>`
      : `<span class="status-mini warn">${d.totalPaginas} pág. · leitura incompleta</span>`;
    return `<li style="display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--line);"><span style="overflow-wrap:anywhere;">${icon('file',13)} ${esc(d.nome)}</span>${estado}</li>`;
  }).join('');
  return `<section class="modal-secao"><h4>Documentos lidos <span class="contagem">${docs.length}</span></h4><ul style="list-style:none;margin:0;padding:0;font-size:13px;">${itens}</ul></section>`;
}

function abrirDetalheMapaRisco(contratoId){
  const item = [...((mapasRiscoDados && mapasRiscoDados.itens) || []), ...((mapasRiscoDados && mapasRiscoDados.encerrados) || [])].find(i=>String(i.contrato.id)===String(contratoId));
  if(!item) return;
  const c = item.contrato;
  const souAprovador = currentUser && (currentUser.role==='admin' || currentUser.role==='gestor');
  const atual = riscosPorContrato[c.id] || null;
  /* Prazo, financeiro e gestão de HOJE (item.eixosAtuais), não os do dia da
     análise; o conteúdo (cláusulas) é o da análise. Risco geral: o de hoje,
     o mesmo da lista e do Painel. */
  const ROTULO = {alto:'Alto',medio:'Médio',baixo:'Baixo'};
  const comRotulo = e => e ? { ...e, nivelLabel: e.naoSeAplica ? 'Não se aplica' : (ROTULO[e.nivel] || '—') } : e;
  const vivo = item.eixosAtuais;
  // Encerrado: o risco de hoje vem da lista (Conteúdo + Gestão), não do Painel.
  const riscoHoje = item.encerrado ? item.riscoAtual : atual;
  const m = item.ultimoMapa && vivo ? { ...item.ultimoMapa,
      prazo: comRotulo(vivo.prazo), financeiro: comRotulo(vivo.financeiro), gestao: comRotulo(vivo.gestao),
      ...(riscoHoje && riscoHoje.nivel ? { riscoGeral: riscoHoje.nivel, riscoGeralLabel: riscoHoje.label.replace(/ \(parcial\)$/,''), riscoGeralParcial: !!riscoHoje.parcial } : {}) }
    : item.ultimoMapa;
  const gerando = mapasRiscoGerandoIds.has(contratoId);

  const bloco = (rotulo, nivel, label, dica, destaque) => `<div class="resumo-bloco nivel-${nivel||'nd'}${destaque?' destaque':''}">
      <div class="resumo-rotulo">${rotulo}</div>
      <div class="resumo-valor" style="color:${nivel?corPorNivel(nivel):'var(--muted)'};">${esc(label)}</div>
      ${dica?`<div class="resumo-dica">${dica}</div>`:''}
    </div>`;

  const nFindings = m && m.conteudo ? m.conteudo.findings.length : 0;
  const corpo = !m ? `<div class="empty-state">${icon('shield',30)}<div class="empty-state-title">Nenhuma análise gerada ainda</div><div>${souAprovador?'Clique em "Gerar análise" para avaliar este contrato.':'Peça a um gestor para gerar a análise deste contrato.'}</div></div>` : `
    ${m.instrumento && m.instrumento.cooperacao ? `<div class="callout callout-info">${icon('doc',15)}<span><b>Acordo/termo de cooperação${m.instrumento.semRepasse ? ' sem repasse de recursos' : ''}.</b> ${m.instrumento.semRepasse ? 'Multa, reajuste, pagamento, garantia e o eixo Financeiro não se aplicam (Lei 14.133/2021, art. 184: a lei vale para esses ajustes "no que couber"); vigência, extinção, gestão e obrigações continuam sendo conferidas.' : 'Há repasse de recursos: os itens financeiros continuam sendo conferidos.'}</span></div>` : ''}
    ${item.encerrado ? `<div class="callout callout-info">${icon('doc',15)}<span><b>Contrato encerrado${c.termino?` em ${esc(formatDate(c.termino))}`:''}.</b> Prazo e Financeiro não se aplicam; ficam as cláusulas exigidas (Conteúdo) e a documentação da gestão — útil para responder ao Tribunal sobre um contrato antigo.</span></div>` : ''}
    ${m.avisoConteudo ? `<div class="callout callout-warn">${icon('bell',15)}<span>${esc(m.avisoConteudo)}</span></div>` : ''}
    <section class="modal-secao">
      <h4>Resumo</h4>
      <div class="resumo-blocos">
        ${bloco('Risco geral', m.riscoGeralParcial ? null : m.riscoGeral, m.riscoGeralLabel, m.riscoGeralParcial ? 'Parcial: o conteúdo não foi analisado' : item.encerrado ? 'O pior entre conteúdo e gestão' : `O pior dos ${m.gestao?'quatro':'três'} eixos`, true)}
        ${bloco('Conteúdo', m.conteudo && m.conteudo.nivel, m.conteudo ? m.conteudo.nivelLabel : 'Indisponível', m.conteudo ? (nFindings ? `${nFindings} ponto(s) de risco` : 'Nenhum ponto de risco') : 'Não analisado')}
        ${bloco('Prazo', m.prazo.nivel, m.prazo.nivelLabel, esc(dicaPrazoRisco(m.prazo)))}
        ${bloco('Financeiro', m.financeiro.nivel, m.financeiro.nivelLabel, esc(dicaFinanceiroRisco(m.financeiro)))}
        ${bloco('Gestão', m.gestao && m.gestao.nivel, m.gestao ? m.gestao.nivelLabel : 'Não analisado', esc(dicaGestaoRisco(m.gestao)))}
      </div>
      <p class="modal-nota" style="margin:10px 0 0;">Prazo, financeiro e gestão: calculados hoje, com o cadastro e os documentos de agora. Conteúdo: da análise de ${esc(formatDate(item.ultimoMapa.geradoEm))}${item.ultimoMapa.riscoGeral && item.ultimoMapa.riscoGeral!==m.riscoGeral ? ` (naquele dia o risco geral era ${esc(ROTULO[item.ultimoMapa.riscoGeral]||item.ultimoMapa.riscoGeral)})` : ''}.</p>
    </section>
    ${montarContaDoRiscoHtml(m)}
    ${m.conteudo ? `<section class="modal-secao">
      <h4>Pontos de risco no conteúdo <span class="contagem">${nFindings}</span></h4>
      ${nFindings ? m.conteudo.findings.map(montarFindingHtml).join('') : `<div class="callout callout-ok" style="margin:0;">${icon('check',15)}<span>Nenhum ponto de risco de conteúdo encontrado pela régua atual.</span></div>`}
    </section>` : ''}
    ${montarChecklistHtml(m.checklist)}
    ${montarDocumentosLidosHtml(m.documentosLidos)}
    <section class="modal-secao">${ajuda('O checklist é conferido por leitura automática dos documentos, nesta máquina: nenhum texto de contrato sai para serviço externo. O que depende de interpretação fica para conferência manual. O CPF é escondido nas citações.', 'Sobre a leitura e os dados pessoais')}</section>
  `;

  const sub = [esc(c.empresa||''), m ? `análise de ${formatDate(m.geradoEm)} (${tempoRelativo(m.geradoEm)}) por ${esc(m.geradoPor||'—')}` : ''].filter(Boolean).join(' · ');
  janela.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this) app.closeModal()">
      <div role="dialog" aria-modal="true" tabindex="-1" class="modal-card wide" aria-label="Mapa de risco ${escAttr(c.numero||'')}">
        <div class="modal-header"><h3>Mapa de risco — ${esc(c.numero)}<span class="modal-sub">${sub}</span></h3><button type="button" class="icon-btn modal-fechar" aria-label="Fechar" title="Fechar (Esc)" onclick="app.closeModal()">${icon('close',16)}</button></div>
        ${corpo}
        <div class="callout callout-info" data-andamento-mapa-risco style="margin:16px 0 0;" ${gerando && mapaRiscoProgresso && mapaRiscoProgresso.etapa ? '' : 'hidden'}>${gerando && mapaRiscoProgresso ? esc(mapaRiscoProgresso.etapa || '') : ''}</div>
        <div class="modal-actions">
          ${m && m.arquivoOrigem ? `<span class="acoes-esq" title="${escAttr(m.arquivoOrigem)}">${icon('file',12)} ${esc(String(m.arquivoOrigem).split(/[\\/]/).pop())}</span>` : ''}
          <button type="button" class="btn-ghost" onclick="app.closeModal()">Fechar</button>
          <button type="button" class="btn-ghost" onclick="app.abrirRegistroRiscos(${c.id})">${icon('layers',15)} Registro de riscos</button>
          ${souAprovador?`<button type="button" class="btn-primary" onclick="app.gerarOuAtualizarMapaRisco(${c.id}, true)" ${gerando?'disabled':''}>${gerando?'<span class="spinner" style="width:13px;height:13px;border-color:rgba(255,255,255,.4);border-top-color:#fff;"></span> Gerando… (pode fechar)':`${icon(m?'refresh':'shield',15)} ${m?'Atualizar análise':'Gerar análise'}`}</button>`:''}
        </div>
      </div>
    </div>`;
}

/* ===================== REGISTRO DE RISCOS (modelo SGC) =====================
   A planilha "MAPA DE RISCOS EM CONTRATOS DA PM ITAVERDE" dentro do sistema:
   painel do contrato, matriz probabilidade × impacto, riscos automáticos
   (legislação de contratos, a partir dos documentos) e o registro do
   gestor — riscos e problemas. Ver integrations/registroRiscos.js. */
let registroResumoDados = null;
let registroResumoCarregando = false;
let registroAberto = null;          // { contratoId, dados }

function carregarRegistroResumo(){
  if(registroResumoCarregando) return;
  registroResumoCarregando = true;
  api.registroRiscosResumo().then(d=>{
    registroResumoDados = d; registroResumoCarregando = false;
    if(state.view==='mapaRisco') render();
  }).catch(()=>{ registroResumoDados = { itens:[] }; registroResumoCarregando = false; });
}

const ROTULO_FAIXA = { baixa:'Registrar', moderada:'Aceitar e monitorar', alta:'Mitigar', critica:'Evitar' };

/* Selo da criticidade: número (P × I) + critério, na cor da planilha. */
function chipCriticidade(q, criterio){
  if(!(q>0)) return '<span class="cel-vazia">—</span>';
  const faixa = q<3 ? 'baixa' : q<=6 ? 'moderada' : q<15 ? 'alta' : 'critica';
  return `<span class="crit crit-${faixa}" title="Criticidade = probabilidade × impacto">${q}<span class="crit-rotulo">${esc(criterio||ROTULO_FAIXA[faixa])}</span></span>`;
}

/* Matriz 5 × 5, como na metodologia da planilha: probabilidade nas
   linhas (5 em cima), impacto nas colunas; cada célula na cor da faixa e
   com a quantidade de riscos ativos. */
function montarMatrizRiscos(matriz){
  let html = '<div class="matriz-riscos" role="table" aria-label="Matriz probabilidade × impacto">';
  html += '<div class="matriz-eixo-y" aria-hidden="true">Probabilidade</div>';
  for(let p=5;p>=1;p--){
    html += `<div class="matriz-rotulo" role="rowheader">${p}</div>`;
    for(let i=1;i<=5;i++){
      const q = p*i, n = (matriz||{})[`${p}x${i}`] || 0;
      const faixa = q<3 ? 'baixa' : q<=6 ? 'moderada' : q<15 ? 'alta' : 'critica';
      html += `<div class="matriz-celula crit-${faixa}${n?' com-risco':''}" role="cell" title="P ${p} × I ${i} = ${q} (${ROTULO_FAIXA[faixa]})${n?` — ${n} risco(s)`:''}">${n||''}</div>`;
    }
  }
  // Duas células vazias: a coluna do título "Probabilidade" e a dos números.
  html += '<div></div><div></div>' + [1,2,3,4,5].map(i=>`<div class="matriz-rotulo">${i}</div>`).join('') + '<div></div><div></div><div class="matriz-eixo-x" aria-hidden="true">Impacto</div></div>';
  return html;
}

async function abrirRegistroRiscos(contratoId){
  janela.innerHTML = `<div class="modal-overlay" onclick="if(event.target===this) app.closeModal()"><div role="dialog" aria-modal="true" tabindex="-1" class="modal-card xl">${esqueleto(10, 'Carregando o registro de riscos')}</div></div>`;
  let d;
  try{ d = await api.registroDoContrato(contratoId); }
  catch(err){ closeModal(); toast(err.message, 'error'); return; }
  registroAberto = { contratoId, dados: d };
  desenharRegistroRiscos();
}

function desenharRegistroRiscos(){
  if(!registroAberto) return;
  const { contratoId, dados: d } = registroAberto;
  const souAprovador = currentUser && (currentUser.role==='admin' || currentUser.role==='gestor');
  const pn = d.painel, rs = d.resumo;
  const kv = (rotulo, valor) => `<div class="kv"><div class="kv-label">${rotulo}</div><div class="kv-value${valor?'':' vazio'}">${valor||'não identificado'}</div></div>`;
  const idJs = JSON.stringify(contratoId).replace(/"/g,'&quot;');

  const linhaRisco = r => {
    const tratar = souAprovador ? (r.automatico
      ? `<button type="button" class="btn-ghost btn-small" onclick="app.formRisco(${idJs}, ${JSON.stringify(r.codigo).replace(/"/g,'&quot;')})">${r.tratamentoId?'Editar resposta':'Tratar'}</button>`
      : `<button type="button" class="btn-ghost btn-small" onclick="app.formRisco(${idJs}, null, ${r.id})">Editar</button>`) : '';
    return `<tr>
      <td class="nowrap">${r.automatico?'<span class="status-mini info" title="Calculado a partir dos documentos lidos">automático</span>':`<b>${esc(String(r.id))}</b>`}</td>
      <td style="min-width:260px;">
        <div style="font-weight:600;">${esc(r.titulo || r.descricao || '')}</div>
        ${r.automatico && r.descricao ? `<div class="cel-sub" style="margin-top:2px;">${esc(r.descricao)}</div>` : ''}
        ${r.resposta ? `<div style="margin-top:6px;font-size:12.5px;"><b>Resposta:</b> ${esc(r.resposta)}</div>` : ''}
        ${r.fundamento ? `<div class="cel-sub" style="margin-top:4px;" title="${escAttr(r.evidencia||'')}">${icon('doc',11)} ${esc(r.fundamento)}</div>` : ''}
      </td>
      <td><span class="celula-texto">${esc(r.tipo||'—')}</span><div class="cel-sub">${esc([r.classificacao, r.categoria].filter(Boolean).join(' · '))}</div></td>
      <td class="num">${r.probabilidade||'—'}</td>
      <td class="num">${r.impacto||'—'}</td>
      <td>${chipCriticidade(r.criticidade, r.criterio)}</td>
      <td class="nowrap">${esc(r.status||'Ativo')}${r.responsavel?`<div class="cel-sub">${esc(r.responsavel)}</div>`:''}</td>
      <td class="col-fixa-dir">${tratar}</td>
    </tr>`;
  };

  const riscosAtivos = [...d.automaticos, ...d.riscos];
  const tabelaRiscos = riscosAtivos.length
    ? table(['Id','Risco','Tipo','P','I','Criticidade','Situação','Ações'], riscosAtivos.map(linhaRisco))
    : `<div class="callout callout-ok" style="margin:0;">${icon('check',15)}<span>Nenhum risco identificado nos documentos e nenhum registrado pelo gestor.</span></div>`;

  const linhaIssue = i => `<tr>
      <td><b>${esc(String(i.id))}</b></td>
      <td style="min-width:220px;"><div style="font-weight:600;">${esc(i.titulo)}</div>${i.descricao?`<div class="cel-sub">${esc(i.descricao)}</div>`:''}${i.resposta?`<div style="margin-top:4px;font-size:12.5px;"><b>Resposta:</b> ${esc(i.resposta)}</div>`:''}</td>
      <td class="nowrap">${esc(i.status)}</td>
      <td class="nowrap">${esc(i.prioridade||'—')}</td>
      <td class="nowrap">${formatDataCurta(i.dataCriacao)}${i.dataEncerramento?` → ${formatDataCurta(i.dataEncerramento)}`:''}${i.duracaoDias!=null?`<div class="cel-sub">${i.duracaoDias} dia(s)</div>`:''}</td>
      <td>${esc(i.responsavel||'—')}</td>
      <td class="col-fixa-dir">${souAprovador?`<button type="button" class="btn-ghost btn-small" onclick="app.formProblema(${idJs}, ${i.id})">Editar</button>`:''}</td>
    </tr>`;
  const tabelaIssues = d.issues.length
    ? table(['Id','Problema','Situação','Prioridade','Período','Responsável','Ações'], d.issues.map(linhaIssue))
    : '<div class="related-empty">Nenhum problema registrado.</div>';

  const porCriterio = rs.porCriterio || {};
  janela.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this) app.fecharRegistroRiscos()">
      <div role="dialog" aria-modal="true" tabindex="-1" class="modal-card xl" aria-label="Registro de riscos do contrato ${escAttr(pn.contrato||'')}">
        <div class="modal-header"><h3>Registro de riscos — ${esc(pn.contrato||'')}<span class="modal-sub">${esc(pn.contratada||'')}${pn.pa?` · P.A. ${esc(pn.pa)}`:''} · modelo "Mapa de riscos em contratos da PM Itaverde"</span></h3><button type="button" class="icon-btn modal-fechar" aria-label="Fechar" title="Fechar (Esc)" onclick="app.fecharRegistroRiscos()">${icon('close',16)}</button></div>

        <section class="modal-secao"><h4>Painel</h4>
          <div class="kv-grid" style="margin-top:0;">
            ${kv('Gestor do contrato', esc(pn.gestor||''))}${kv('Suplente do gestor', esc(pn.suplenteGestor||''))}${kv('Fiscal do contrato', esc(pn.fiscal||''))}
            ${kv('Vigência', pn.inicio||pn.termino ? `${formatDataCurta(pn.inicio)||'—'} a ${pn.termino?formatDataCurta(pn.termino):'não comprovado'}` : '')}
            ${kv('Valor mensal', pn.valorMensal!=null?money(pn.valorMensal):'')}
            ${kv('Última revisão do registro', pn.dataUltimaRevisao?new Date(pn.dataUltimaRevisao).toLocaleString('pt-BR'):'')}
            <div class="kv largo"><div class="kv-label">Objeto do contrato</div><div class="kv-value${pn.objeto?'':' vazio'}">${esc(pn.objeto||'não identificado')}</div></div>
          </div>
        </section>

        <section class="modal-secao"><h4>Situação</h4>
          <div class="registro-topo">
            <div class="resumo-blocos" style="flex:1;">
              <div class="resumo-bloco destaque"><div class="resumo-rotulo">Maior criticidade</div><div class="resumo-valor">${chipCriticidade(rs.maiorCriticidade)}</div></div>
              <div class="resumo-bloco nivel-alto"><div class="resumo-rotulo">Evitar / Mitigar</div><div class="resumo-valor">${(porCriterio['Evitar']||0)} / ${(porCriterio['Mitigar']||0)}</div><div class="resumo-dica">acima do limite tolerável</div></div>
              <div class="resumo-bloco nivel-medio"><div class="resumo-rotulo">Aceitar e monitorar</div><div class="resumo-valor">${porCriterio['Aceitar e monitorar']||0}</div></div>
              <div class="resumo-bloco"><div class="resumo-rotulo">Problemas em aberto</div><div class="resumo-valor">${rs.issuesAbertos||0}</div></div>
            </div>
            ${montarMatrizRiscos(rs.matriz)}
          </div>
        </section>

        <section class="modal-secao"><h4>Riscos <span class="contagem">${riscosAtivos.length}</span></h4>${tabelaRiscos}</section>
        <section class="modal-secao"><h4>Problemas (issues) <span class="contagem">${d.issues.length}</span></h4>${tabelaIssues}</section>
        <section class="modal-secao">${ajuda('Metodologia da planilha do SGC: <b>criticidade = probabilidade × impacto</b> (1 a 5 cada). Até 2: <b>Registrar</b>; de 3 a 6: <b>Aceitar e monitorar</b>; de 8 a 14: <b>Mitigar</b>; de 15 a 25: <b>Evitar</b>. A decisão de aceitar é do gestor do contrato. Os riscos marcados como <b>automático</b> são calculados pelos documentos lidos da pasta (vigência, termos, gestor, valor) com base nas Leis 14.133/2021 e 8.666/1993 — use "Tratar" para registrar a resposta e o responsável.', 'Como o registro funciona')}</section>

        <div class="modal-actions">
          <span class="acoes-esq"><a href="/api/registro-riscos/${encodeURIComponent(contratoId)}/exportar?aba=riscos" download>${icon('download',12)} Riscos (planilha)</a> · <a href="/api/registro-riscos/${encodeURIComponent(contratoId)}/exportar?aba=issues" download>Problemas (planilha)</a></span>
          ${souAprovador?`<button type="button" class="btn-ghost" onclick="app.formProblema(${idJs})">${icon('plus',14)} Registrar problema</button>
          <button type="button" class="btn-primary" onclick="app.formRisco(${idJs})">${icon('plus',14)} Registrar risco</button>`:'<button type="button" class="btn-primary" onclick="app.fecharRegistroRiscos()">Fechar</button>'}
        </div>
      </div>
    </div>`;
}

function fecharRegistroRiscos(){ registroAberto = null; registroResumoDados = null; closeModal(); if(state.view==='mapaRisco') render(); }

/* Formulário de risco no layout da aba "Riscos". Para risco automático
   (codigo), grava o TRATAMENTO dele: resposta, contingência, responsável,
   status e — se o gestor discordar — probabilidade e impacto. */
function formRisco(contratoId, codigoAutomatico, id){
  const d = registroAberto && registroAberto.dados; if(!d) return;
  const L = d.listas;
  const auto = codigoAutomatico ? d.automaticos.find(a=>a.codigo===codigoAutomatico) : null;
  const atual = id ? d.riscos.find(r=>String(r.id)===String(id))
    : auto ? { ...auto, id: auto.tratamentoId || null } : {};
  const regId = auto ? (auto.tratamentoId || null) : (id || null);
  const opt = (lista, v) => lista.map(o=>`<option value="${escAttr(o)}" ${String(v||'')===String(o)?'selected':''}>${esc(o)}</option>`).join('');
  const escala = (obj, v) => Object.entries(obj).sort((a,b)=>b[0]-a[0]).map(([k,t])=>`<option value="${k}" ${String(v||'')===k?'selected':''}>${k} — ${esc(t)}</option>`).join('');
  const classif = atual.classificacao || 'Interna';

  modalRoot.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this) app.voltarAoRegistro()">
      <div role="dialog" aria-modal="true" tabindex="-1" class="modal-card wide">
        <div class="modal-header"><h3>${auto?'Tratar risco automático':(id?'Editar risco':'Registrar risco')}<span class="modal-sub">${esc(d.painel.contrato||'')}${auto?` · ${esc(auto.titulo)}`:''}</span></h3><button type="button" class="icon-btn modal-fechar" aria-label="Voltar" title="Voltar (Esc)" onclick="app.voltarAoRegistro()">${icon('close',16)}</button></div>
        ${auto?`<div class="callout callout-info">${icon('doc',15)}<span>${esc(auto.descricao||'')}<br><span class="cel-sub">${esc(auto.fundamento||'')} — ${esc(auto.evidencia||'')}</span></span></div>`:''}
        <form id="form-risco">
          <div class="form-grade">
            ${auto?'':`<label class="field">Risco ou oportunidade<select name="natureza">${opt(L.NATUREZAS, atual.natureza||'Risco')}</select></label>`}
            <label class="field">Situação<select name="status">${opt(L.STATUS_RISCO, atual.status||'Ativo')}</select></label>
            ${auto?'':`<label class="field">Tipo de risco<select name="tipo"><option value="">—</option>${opt(L.TIPOS_DE_RISCO, atual.tipo)}</select></label>
            <label class="field">Classificação<select name="classificacao" onchange="app.atualizarCategorias(this.value)">${opt(Object.keys(L.CLASSIFICACOES), classif)}</select></label>
            <label class="field">Categoria<select name="categoria" id="sel-categoria"><option value="">—</option>${opt(L.CLASSIFICACOES[classif]||[], atual.categoria)}</select></label>`}
            <label class="field">Probabilidade (1 a 5)<select name="probabilidade" required>${escala(L.ESCALA_PROBABILIDADE, atual.probabilidade)}</select></label>
            <label class="field">Impacto (1 a 5)<select name="impacto" required>${escala(L.ESCALA_IMPACTO, atual.impacto)}</select></label>
            <label class="field">Responsável<input type="text" name="responsavel" maxlength="120" value="${escAttr(atual.responsavel||'')}"></label>
            <label class="field">Data de criação<input type="date" name="dataCriacao" value="${escAttr(atual.dataCriacao||hojeIsoLocal())}"></label>
            <label class="field">Data de encerramento<input type="date" name="dataEncerramento" value="${escAttr(atual.dataEncerramento||'')}"></label>
          </div>
          ${auto?'':`<label class="field">Objeto do estudo (fonte do risco)<input type="text" name="objetoEstudo" maxlength="300" value="${escAttr(atual.objetoEstudo||'')}" placeholder="Produto, serviço ou local onde o risco pode se materializar — ex.: Data Center"></label>
          <label class="field">Descrição do risco (risco primário)<textarea name="descricao" required>${esc(atual.descricao||'')}</textarea></label>
          <label class="field">Descrição do impacto (risco secundário)<textarea name="impactoDescricao">${esc(atual.impactoDescricao||'')}</textarea></label>`}
          <label class="field">Descrição da resposta (plano de ação)<textarea name="resposta">${esc(auto && !auto.tratamentoId ? '' : (atual.resposta||''))}</textarea></label>
          <label class="field">Descrição da contingência (caso o evento se materialize)<textarea name="contingencia">${esc(atual.contingencia||'')}</textarea></label>
          <label class="field">Critério para aceitação<input type="text" name="criterioParaAceitacao" maxlength="300" value="${escAttr(atual.criterioParaAceitacao||'')}" placeholder="Como será o processo de aceitação do evento"></label>
          <div class="callout callout-info" id="previa-criticidade" style="margin:4px 0 0;"></div>
          <div class="modal-actions">
            <button type="button" class="btn-ghost" onclick="app.voltarAoRegistro()">Voltar</button>
            <button type="submit" class="btn-primary" id="btn-risco">${icon('check',15)} Gravar</button>
          </div>
        </form>
      </div>
    </div>`;

  const form = document.getElementById('form-risco');
  const previa = () => {
    const q = Number(form.probabilidade.value) * Number(form.impacto.value);
    document.getElementById('previa-criticidade').innerHTML = `${icon('shield',15)}<span>Criticidade: ${chipCriticidade(q)} — a decisão de aceitar é do gestor do contrato.</span>`;
  };
  form.probabilidade.addEventListener('change', previa);
  form.impacto.addEventListener('change', previa);
  previa();
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const dados = Object.fromEntries(new FormData(form).entries());
    dados.registro = 'risco';
    if(auto){ dados.codigoAutomatico = auto.codigo; dados.descricao = auto.titulo; dados.tipo = auto.tipo; dados.classificacao = auto.classificacao; dados.categoria = auto.categoria; }
    const b = document.getElementById('btn-risco'); b.disabled = true; b.textContent = 'Gravando...';
    try{
      if(regId) await api.atualizarRegistroRisco(contratoId, regId, dados);
      else await api.registrarRisco(contratoId, dados);
      toast('Risco gravado.', 'success');
      await abrirRegistroRiscos(contratoId);
    }catch(err){ toast(err.message, 'error'); b.disabled = false; b.textContent = 'Gravar'; }
  });
}

function atualizarCategorias(classificacao){
  const d = registroAberto && registroAberto.dados; const sel = document.getElementById('sel-categoria');
  if(!d || !sel) return;
  sel.innerHTML = '<option value="">—</option>' + (d.listas.CLASSIFICACOES[classificacao]||[]).map(o=>`<option value="${escAttr(o)}">${esc(o)}</option>`).join('');
}

/* Formulário de problema no layout da aba "Issues". */
function formProblema(contratoId, id){
  const d = registroAberto && registroAberto.dados; if(!d) return;
  const L = d.listas;
  const atual = id ? d.issues.find(i=>String(i.id)===String(id)) || {} : {};
  const opt = (lista, v) => lista.map(o=>`<option value="${escAttr(o)}" ${String(v||'')===String(o)?'selected':''}>${esc(o)}</option>`).join('');
  modalRoot.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this) app.voltarAoRegistro()">
      <div role="dialog" aria-modal="true" tabindex="-1" class="modal-card wide">
        <div class="modal-header"><h3>${id?'Editar problema':'Registrar problema'}<span class="modal-sub">${esc(d.painel.contrato||'')} · registro de problemas e decisões</span></h3><button type="button" class="icon-btn modal-fechar" aria-label="Voltar" title="Voltar (Esc)" onclick="app.voltarAoRegistro()">${icon('close',16)}</button></div>
        <form id="form-problema">
          <label class="field">Título<input type="text" name="titulo" required maxlength="160" value="${escAttr(atual.titulo||'')}"></label>
          <div class="form-grade">
            <label class="field">Situação<select name="status">${opt(L.STATUS_ISSUE, atual.status||'Em progresso')}</select></label>
            <label class="field">Prioridade<select name="prioridade"><option value="">—</option>${opt(L.PRIORIDADES, atual.prioridade)}</select></label>
            <label class="field">Fase do contrato<select name="fase"><option value="">—</option>${opt(L.FASES, atual.fase)}</select></label>
            <label class="field">Categoria<select name="categoria"><option value="">—</option>${opt(L.CATEGORIAS_ISSUE, atual.categoria)}</select></label>
            <label class="field">Data da reunião<input type="date" name="dataReuniao" value="${escAttr(atual.dataReuniao||'')}"></label>
            <label class="field">Data de criação<input type="date" name="dataCriacao" value="${escAttr(atual.dataCriacao||hojeIsoLocal())}"></label>
            <label class="field">Data de encerramento<input type="date" name="dataEncerramento" value="${escAttr(atual.dataEncerramento||'')}"></label>
            <label class="field">Responsável<input type="text" name="responsavel" maxlength="120" value="${escAttr(atual.responsavel||'')}"></label>
            <label class="field">Risco relacionado<select name="riscoRelacionado"><option value="">—</option>${[...d.automaticos.map(a=>[a.codigo, a.titulo]), ...d.riscos.map(r=>[String(r.id), r.descricao])].map(([v,t])=>`<option value="${escAttr(v)}" ${String(atual.riscoRelacionado||'')===v?'selected':''}>${esc(String(t).slice(0,80))}</option>`).join('')}</select></label>
          </div>
          <label class="field">Descrição do problema<textarea name="descricao">${esc(atual.descricao||'')}</textarea></label>
          <label class="field">Descrição do impacto<textarea name="impactoDescricao">${esc(atual.impactoDescricao||'')}</textarea></label>
          <label class="field">Descrição da resposta (plano de ação)<textarea name="resposta">${esc(atual.resposta||'')}</textarea></label>
          <div class="modal-actions">
            <button type="button" class="btn-ghost" onclick="app.voltarAoRegistro()">Voltar</button>
            <button type="submit" class="btn-primary" id="btn-problema">${icon('check',15)} Gravar</button>
          </div>
        </form>
      </div>
    </div>`;
  const form = document.getElementById('form-problema');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const dados = Object.fromEntries(new FormData(form).entries());
    dados.registro = 'issue';
    const b = document.getElementById('btn-problema'); b.disabled = true; b.textContent = 'Gravando...';
    try{
      if(id) await api.atualizarRegistroRisco(contratoId, id, dados);
      else await api.registrarRisco(contratoId, dados);
      toast('Problema gravado.', 'success');
      await abrirRegistroRiscos(contratoId);
    }catch(err){ toast(err.message, 'error'); b.disabled = false; b.textContent = 'Gravar'; }
  });
}

function voltarAoRegistro(){ if(registroAberto) desenharRegistroRiscos(); else closeModal(); }

function renderMapaRisco(){
  if(registroResumoDados===null && !registroResumoCarregando) carregarRegistroResumo();
  if(mapasRiscoDados===null && !mapasRiscoCarregando){
    carregarMapasRisco();
    // Se uma geração começou antes (outra aba, ou a página foi
    // recarregada no meio), retoma o acompanhamento em vez de deixar o
    // botão liberado enquanto o servidor ainda está trabalhando.
    if(!mapaRiscoAcompanhando) api.progressoMapaRisco().then(p=>{ if(p && p.emAndamento) acompanharMapaRisco(null); }).catch(()=>{});
  }
  const souAprovador = currentUser && (currentUser.role==='admin' || currentUser.role==='gestor');
  const d = mapasRiscoDados;

  if(mapasRiscoCarregando && !d){
    return `<div class="page-header"><div><h1 class="page-title">Mapa de risco</h1><p class="page-subtitle">&nbsp;</p></div></div><div class="card">${esqueleto(6, 'Carregando os mapas de risco')}</div>`;
  }
  if(!d || d.erro){
    return `<div class="page-header"><div><h1 class="page-title">Mapa de risco</h1></div></div><div class="card"><div class="empty-state">${icon('shield',30)}<div class="empty-state-title">Não foi possível carregar</div><div>${(d&&d.erro)||'Tente novamente em instantes.'}</div></div></div>`;
  }

  const itens = d.itens || [];
  const encerrados = d.encerrados || [];
  const abaMapa = state.filters['aba-mapa'] || 'vigentes';
  const botaoAbaMapa = (v, rotulo, n) => `<button type="button" role="tab" aria-selected="${abaMapa===v}" class="aba${abaMapa===v?' ativa':''}" onclick="app.setFilter('aba-mapa','${v}')">${rotulo}<span class="aba-n">${n}</span></button>`;
  const abasMapa = `<div class="abas" role="tablist">${botaoAbaMapa('vigentes','Em vigência', itens.length)}${botaoAbaMapa('encerrados','Encerrados', encerrados.length)}</div>`;
  const acoesTopo = (itens.length || encerrados.length) ? `<div class="row-actions" style="flex-wrap:nowrap;align-items:center;">
        <a class="btn-ghost" href="/api/mapas-risco/lacunas/exportar" download title="Planilha com as cláusulas exigidas que faltam ou ficaram para conferência e os apontamentos, com a frase citada — da análise mais recente de cada contrato">${icon('download',15)} Exportar lacunas (CSV)</a>
        ${currentUser && currentUser.role==='admin' ? `<button type="button" class="btn-ghost" onclick="app.atualizarTodosMapasRisco()" ${mapaRiscoAcompanhando?'disabled':''} title="Refaz a análise de todos os contratos (em vigência e encerrados) com as regras atuais, só com o texto já lido (sem ler os PDFs de novo)">${icon('refresh',15)} Atualizar todas as análises</button>` : ''}
      </div>` : '';
  const andamentoMapa = `<div class="callout callout-info" data-andamento-mapa-risco style="margin:0 0 16px;" ${mapaRiscoProgresso && mapaRiscoProgresso.emAndamento && mapaRiscoProgresso.etapa ? '' : 'hidden'}>${mapaRiscoProgresso && mapaRiscoProgresso.emAndamento ? esc(mapaRiscoProgresso.etapa || '') : ''}</div>`;
  if(abaMapa==='encerrados'){
    return `<div class="page-header">
        <div><h1 class="page-title">Mapa de risco</h1><p class="page-subtitle">Contratos encerrados: as cláusulas exigidas e a documentação da gestão</p></div>
        ${acoesTopo}
      </div>${abasMapa}${andamentoMapa}${renderMapaEncerrados(encerrados, souAprovador)}`;
  }
  // Nível de cada contrato para filtrar e ordenar: pior primeiro; quem
  // nunca foi analisado fica numa categoria própria ("sem análise").
  // O nível de HOJE (o mesmo do Painel: prazo e registro recalculados agora;
  // conteúdo da última análise) — ver riscoAtualDoContrato no servidor.
  const atualDe = (item) => riscosPorContrato[item.contrato.id] || null;
  const nivelDe = (item) => item.ultimoMapa ? ((atualDe(item) && atualDe(item).nivel) || item.ultimoMapa.riscoGeral || 'sem') : 'sem';
  const PESO = { alto:3, medio:2, baixo:1, sem:0 };
  const conta = (n) => itens.filter(i=>nivelDe(i)===n).length;
  const nSem = conta('sem'), nAlto = conta('alto'), nMedio = conta('medio'), nBaixo = conta('baixo');

  const fNivel = state.filters['filter-nivel-risco'] || 'todos';
  const q = (state.filters['search-risco']||'').trim().toLowerCase();
  // Padrão: o registro de riscos (vale para todo contrato, mesmo sem análise dos documentos).
  if(!state.filters['ordem-risco']) state.filters['ordem-risco'] = 'registro:desc';
  const regDe = (item) => ((registroResumoDados && registroResumoDados.itens) || []).find(x=>String(x.contratoId)===String(item.contrato.id)) || {};
  const [ordChave, ordDir] = state.filters['ordem-risco'].split(':');
  const chave = (item) => ordChave==='registro' ? (regDe(item).maiorCriticidade || 0)
    : ordChave==='risco' ? PESO[nivelDe(item)]
    : ordChave==='analise' ? (item.ultimoMapa ? item.ultimoMapa.geradoEm : null)
    : ordChave==='empresa' ? item.contrato.empresa
    : chaveDoNumero(item.contrato.numero);
  const visiveis = itens
    .filter(i => fNivel==='todos' || nivelDe(i)===fNivel)
    .filter(i => !q || [i.contrato.numero, i.contrato.empresa, i.contrato.secretaria].some(v => String(v||'').toLowerCase().includes(q)))
    .slice()
    .sort((a, b) => compararValores(chave(a), chave(b), ordDir) || compararValores(chaveDoNumero(a.contrato.numero), chaveDoNumero(b.contrato.numero), 'desc'));

  // O porquê de cada eixo, ao passar o mouse — o nível sozinho não diz nada.
  const dicaPrazo = dicaPrazoRisco, dicaFin = dicaFinanceiroRisco;
  const eixo = (rotulo, label, dica) => `<div class="eixo" title="${escAttr(dica||'')}"><span class="eixo-rotulo">${rotulo}</span>${label}</div>`;

  const linhas = visiveis.map(item=>{
    const c = item.contrato; const m = item.ultimoMapa;
    const gerando = mapasRiscoGerandoIds.has(c.id);
    const diasDesde = m ? Math.floor((Date.now() - new Date(m.geradoEm).getTime())/86400000) : null;
    // Prazo muda com o tempo: análise de mais de 30 dias pode não valer mais.
    const antiga = diasDesde!=null && diasDesde>30;

    const atual = atualDe(item);
    const NOME = { alto:'Alto', medio:'Médio', baixo:'Baixo' };
    const ORD = { baixo:0, medio:1, alto:2 };
    // Tendência: o risco de hoje comparado com o da última análise gravada.
    const tendencia = (atual && atual.nivel && m && m.riscoGeral && atual.nivel!==m.riscoGeral)
      ? (ORD[atual.nivel] > ORD[m.riscoGeral]
          ? `<span class="tendencia sobe" title="Subiu desde a análise de ${escAttr(formatDate(m.geradoEm))} (era ${escAttr(NOME[m.riscoGeral]||'')})">▲</span>`
          : `<span class="tendencia desce" title="Desceu desde a análise de ${escAttr(formatDate(m.geradoEm))} (era ${escAttr(NOME[m.riscoGeral]||'')})">▼</span>`)
      : '';
    const risco = gerando
      ? `<span class="status-mini info"><span class="spinner" style="width:11px;height:11px;"></span> Gerando…</span>`
      : m ? `<span class="risco-com-tendencia" title="${escAttr((atual&&atual.resumo)||'')}">${chipRisco(atual && atual.label ? atual.label : m.riscoGeralLabel)}${tendencia}</span>` : `<span class="status-mini muted">Sem análise</span>`;
    // Motivos de um eixo (títulos dos riscos do registro), para o title.
    const motivosDoEixo = e => ((atual && atual.riscos) || []).filter(x=>x.eixo===e).map(x=>`${x.titulo} (${x.criticidade})`).join(' · ');
    const chipEixo = n => n ? chipRisco(NOME[n]) : '<span class="badge badge-muted">n/a</span>';
    const eixos = m
      ? `<div class="eixos">
          ${eixo('Conteúdo', m.conteudo ? chipRisco(m.conteudo.nivelLabel) : '<span class="badge badge-muted" title="O conteúdo do contrato não foi analisado">n/d</span>', m.avisoConteudo || 'Cláusulas exigidas, conferidas por leitura automática')}
          ${atual && atual.eixos
            ? `${eixo('Prazo', chipEixo(atual.eixos.prazo), motivosDoEixo('prazo') || 'Nenhum risco de prazo')}
               ${eixo('Financeiro', chipEixo(atual.eixos.financeiro), motivosDoEixo('financeiro') || (atual.eixos.financeiro ? 'Nenhum risco financeiro' : 'Não se aplica: cooperação sem repasse'))}
               ${eixo('Gestão', chipEixo(atual.eixos.gestao), motivosDoEixo('gestao') || 'Nenhum risco de gestão')}`
            : `${eixo('Prazo', chipRisco(m.prazo.nivelLabel), dicaPrazo(m.prazo))}
               ${eixo('Financeiro', chipRisco(m.financeiro.nivelLabel), dicaFin(m.financeiro))}`}
        </div>`
      : `<span class="cel-sub">Gere a análise para ver os eixos</span>`;
    const analise = m
      ? `<div class="nowrap">${formatDate(m.geradoEm)}</div><div class="cel-sub${antiga?' cel-sub-alerta':''}" title="${antiga?'O risco de prazo muda com o tempo — vale atualizar':''}">${tempoRelativo(m.geradoEm)}${antiga?' · atualizar':''}</div>`
      : '<span class="cel-vazia">—</span>';
    const reg = ((registroResumoDados && registroResumoDados.itens) || []).find(x=>String(x.contratoId)===String(c.id));
    const acoes = [
      `<button type="button" class="icon-btn" onclick="app.abrirRegistroRiscos(${c.id})" title="Registro de riscos" aria-label="Registro de riscos de ${escAttr(c.numero)}">${icon('layers',14)}</button>`,
      souAprovador ? (m
        ? `<button type="button" class="icon-btn" title="Atualizar a análise" aria-label="Atualizar a análise de ${escAttr(c.numero)}" onclick="app.gerarOuAtualizarMapaRisco(${c.id}, false)" ${gerando?'disabled':''}>${icon('refresh',14)}</button>`
        : `<button type="button" class="btn-primary btn-small" onclick="app.gerarOuAtualizarMapaRisco(${c.id}, false)" ${gerando?'disabled':''}>${icon('shield',13)} ${gerando?'Gerando…':'Gerar análise'}</button>`) : '',
      (!m && !souAprovador) ? '<span class="cel-sub">Aguardando análise</span>' : ''
    ].join('');

    return `<tr class="${m?'linha-clicavel':''}" ${m?`onclick="if(!event.target.closest('button,a'))app.abrirDetalheMapaRisco(${c.id})"`:''}>
      <td><div class="cel-contrato"><span class="cel-contrato-num">${esc(c.numero||'s/ número')}</span><span class="celula-texto cel-sub" title="${escAttr(c.empresa||'')}">${esc(c.empresa||'—')}</span></div></td>
      <td><div class="eixo" style="cursor:default;"><span class="eixo-rotulo" aria-hidden="true">&nbsp;</span>${risco}</div></td>
      <td>${eixos}</td>
      <td>${reg ? `${chipCriticidade(reg.maiorCriticidade, reg.criterio)}<div class="cel-sub" style="margin-top:4px;">${reg.riscosAtivos} risco(s)${reg.issuesAbertos?` · ${reg.issuesAbertos} problema(s)`:''}</div>` : '<span class="cel-vazia">—</span>'}</td>
      <td>${analise}</td>
      <td><div class="row-actions" style="justify-content:flex-end;flex-wrap:wrap;max-width:210px;margin-left:auto;">${acoes}</div></td>
    </tr>`;
  });

  const filtrando = fNivel!=='todos' || q;
  const limpar = `<button type="button" class="link-btn" onclick="app.limparFiltros(['search-risco','filter-nivel-risco'])">limpar filtros</button>`;

  return `
    <div class="page-header">
      <div><h1 class="page-title">Mapa de risco</h1><p class="page-subtitle">Risco de cada contrato em quatro eixos: cláusulas do documento, prazo, financeiro e gestão</p></div>
      ${acoesTopo}
    </div>
    ${abasMapa}
    ${andamentoMapa}
    <div class="stat-grid">
      ${statCard('bell', nAlto?COLORS.critical:COLORS.muted, nAlto, 'Risco alto', nAlto?'Priorize estes':null, `app.setFilter('filter-nivel-risco','alto')`)}
      ${statCard('shield', nMedio?COLORS.warning:COLORS.muted, nMedio, 'Risco médio', null, `app.setFilter('filter-nivel-risco','medio')`)}
      ${statCard('layers', nSem?COLORS.s1:COLORS.muted, nSem, 'Sem análise', nSem&&souAprovador?'Gere para completar o mapa':null, `app.setFilter('filter-nivel-risco','sem')`)}
      ${(()=>{ // Só os contratos desta tela (encerrado sai do Mapa; antes contava aqui e o card discordava do "Risco alto").
        const naTela = new Set((d.itens||[]).map(i=>String(i.contrato.id)));
        const ev = ((registroResumoDados&&registroResumoDados.itens)||[]).filter(x=>x.criterio==='Evitar' && naTela.has(String(x.contratoId))).length; return statCard('bell', ev?COLORS.critical:COLORS.muted, ev, 'Registro: a evitar', ev?'criticidade de 15 a 25':null, "app.setFilter('ordem-risco','registro:desc')"); })()}
    </div>
    ${ajuda('Só dá para gerar o mapa de risco de contratos com documentos de origem (os aprovados na Fila de importação). A análise é gerada ao aprovar o contrato na Fila e pode ser atualizada a qualquer momento; o eixo de prazo muda com o tempo, por isso análises com mais de 30 dias aparecem marcadas para atualizar. Passe o mouse sobre um eixo para ver o motivo do nível. A leitura é feita nesta máquina, e o CPF é mascarado nas citações.')}
    ${montarAcoesDaCarteiraHtml(d.acoes || [])}
    <div class="card">
      ${itens.length ? `
        <div class="toolbar">
          ${searchBox('search-risco','Buscar por número, empresa ou secretaria...', state.filters['search-risco'])}
          ${segmentos('filter-nivel-risco', [
            ['todos','Todos',itens.length], ['alto','Alto',nAlto], ['medio','Médio',nMedio], ['baixo','Baixo',nBaixo], ['sem','Sem análise',nSem]
          ], fNivel, 'Nível de risco')}
        </div>
        <div class="tabela-meta"><span><b>${visiveis.length}</b> de ${itens.length} contrato(s)${filtrando?` · ${limpar}`:''}</span><span class="tabela-legenda"><span>Do maior risco para o menor</span></span></div>
        ${table([
          thOrdenavel('contrato', 'Contrato', 'ordem-risco'),
          thOrdenavel('risco', 'Risco geral', 'ordem-risco'),
          '<th>Eixos</th>',
          thOrdenavel('registro', 'Registro de riscos', 'ordem-risco'),
          thOrdenavel('analise', 'Última análise', 'ordem-risco'),
          '<th class="num">Ações</th>'
        ], linhas, {pagina:true, vazio:`Nenhum contrato neste filtro · ${limpar}`})}`
      : `<div class="empty-state">${icon('shield',34)}<div class="empty-state-title">Nenhum contrato com documentos ainda</div><div>Só dá para analisar contratos que tenham documentos lidos — aprove uma proposta na <a href="#" onclick="event.preventDefault();app.setView('importacoes')">Fila de importação</a> primeiro.</div></div>`}
    </div>`;
}

/* Aba "Encerrados" do Mapa de risco (02/10/2026): Prazo e Financeiro não
   se aplicam; o risco é o pior entre o Conteúdo (cláusulas da última
   análise) e a Gestão (calculada agora). Ver listarEncerradosComUltimoMapa
   no servidor. */
function renderMapaEncerrados(lista, souAprovador){
  const NOME = { alto:'Alto', medio:'Médio', baixo:'Baixo' };
  const nivelDe = i => (i.riscoAtual && i.riscoAtual.nivel) || 'sem';
  const conta = n => lista.filter(i=>nivelDe(i)===n).length;
  const fNivel = state.filters['filter-nivel-risco-enc'] || 'todos';
  const q = (state.filters['search-risco-enc']||'').trim().toLowerCase();
  if(!state.filters['ordem-risco-enc']) state.filters['ordem-risco-enc'] = 'risco:desc';
  const [ordChave, ordDir] = state.filters['ordem-risco-enc'].split(':');
  const PESO = { alto:3, medio:2, baixo:1, sem:0 };
  const chave = i => ordChave==='risco' ? PESO[nivelDe(i)]
    : ordChave==='termino' ? i.contrato.termino
    : ordChave==='conferir' ? (i.paraConferencia || 0)
    : ordChave==='analise' ? (i.ultimoMapa ? i.ultimoMapa.geradoEm : null)
    : chaveDoNumero(i.contrato.numero);
  const visiveis = lista
    .filter(i => fNivel==='todos' || nivelDe(i)===fNivel)
    .filter(i => !q || [i.contrato.numero, i.contrato.empresa, i.contrato.secretaria].some(v => String(v||'').toLowerCase().includes(q)))
    .slice()
    .sort((a, b) => compararValores(chave(a), chave(b), ordDir) || compararValores(chaveDoNumero(a.contrato.numero), chaveDoNumero(b.contrato.numero), 'desc'));
  const chipEixo = n => n ? chipRisco(NOME[n]) : '<span class="badge badge-muted">n/d</span>';
  const linhas = visiveis.map(i => {
    const c = i.contrato, m = i.ultimoMapa;
    const gerando = mapasRiscoGerandoIds.has(c.id);
    const g = i.eixosAtuais && i.eixosAtuais.gestao;
    const motivosGestao = g ? (g.motivos||[]).filter(x=>x.criticidade>0).map(x=>`${x.titulo||x.texto} (${x.criticidade})`).join(' · ') : '';
    const risco = gerando ? `<span class="status-mini info"><span class="spinner" style="width:11px;height:11px;"></span> Gerando…</span>`
      : i.riscoAtual ? chipRisco(i.riscoAtual.label) : '<span class="status-mini muted">Sem análise</span>';
    const acoes = [
      `<button type="button" class="icon-btn" onclick="app.abrirRegistroRiscos(${c.id})" title="Registro de riscos" aria-label="Registro de riscos de ${escAttr(c.numero)}">${icon('layers',14)}</button>`,
      souAprovador ? (m
        ? `<button type="button" class="icon-btn" title="Atualizar a análise" aria-label="Atualizar a análise de ${escAttr(c.numero)}" onclick="app.gerarOuAtualizarMapaRisco(${c.id}, false)" ${gerando?'disabled':''}>${icon('refresh',14)}</button>`
        : `<button type="button" class="btn-primary btn-small" onclick="app.gerarOuAtualizarMapaRisco(${c.id}, false)" ${gerando?'disabled':''}>${icon('shield',13)} ${gerando?'Gerando…':'Gerar análise'}</button>`) : ''
    ].join('');
    return `<tr class="${m?'linha-clicavel':''}" ${m?`onclick="if(!event.target.closest('button,a'))app.abrirDetalheMapaRisco(${c.id})"`:''}>
      <td><div class="cel-contrato"><span class="cel-contrato-num">${esc(c.numero||'s/ número')}</span><span class="celula-texto cel-sub" title="${escAttr(c.empresa||'')}">${esc(c.empresa||'—')}</span></div></td>
      <td class="nowrap">${c.termino ? formatDate(c.termino) : '<span class="cel-vazia">sem término</span>'}</td>
      <td>${risco}</td>
      <td><div class="eixos">
        <div class="eixo" title="${escAttr((m && m.avisoConteudo) || 'Cláusulas exigidas, conferidas por leitura automática')}"><span class="eixo-rotulo">Conteúdo</span>${m ? (m.conteudo ? chipRisco(m.conteudo.nivelLabel) : '<span class="badge badge-muted">n/d</span>') : '<span class="cel-vazia">—</span>'}</div>
        <div class="eixo" title="${escAttr(motivosGestao || 'Gestor, suplente e preposto identificados')}"><span class="eixo-rotulo">Gestão</span>${chipEixo(g && g.nivel)}</div>
      </div></td>
      <td class="num">${i.paraConferencia!=null ? (i.paraConferencia ? `<span title="Itens do checklist que a leitura automática não conclui sozinha">${i.paraConferencia}</span>` : '0') : '<span class="cel-vazia">—</span>'}</td>
      <td>${m ? `<div class="nowrap">${formatDate(m.geradoEm)}</div><div class="cel-sub">${tempoRelativo(m.geradoEm)}</div>` : '<span class="cel-vazia">—</span>'}</td>
      <td><div class="row-actions" style="justify-content:flex-end;flex-wrap:wrap;max-width:210px;margin-left:auto;">${acoes}</div></td>
    </tr>`;
  });
  const filtrando = fNivel!=='todos' || q;
  const limpar = `<button type="button" class="link-btn" onclick="app.limparFiltros(['search-risco-enc','filter-nivel-risco-enc'])">limpar filtros</button>`;
  return `${ajuda('Contratos encerrados não entram nos números da carteira, no Painel nem em "O que fazer agora". Aqui ficam só os eixos que ainda dizem algo depois do fim: <b>Conteúdo</b> (as cláusulas que a lei exige estavam no contrato?) e <b>Gestão</b> (gestor, suplente, preposto, termos e relatórios mensais na pasta). Prazo e Financeiro não se aplicam. Útil para responder a uma requisição do Tribunal sobre um contrato antigo.', 'Por que só dois eixos')}
    <div class="card">
      ${lista.length ? `
        <div class="toolbar">
          ${searchBox('search-risco-enc','Buscar por número, empresa ou secretaria...', state.filters['search-risco-enc'])}
          ${segmentos('filter-nivel-risco-enc', [
            ['todos','Todos',lista.length], ['alto','Alto',conta('alto')], ['medio','Médio',conta('medio')], ['baixo','Baixo',conta('baixo')], ['sem','Sem análise',conta('sem')]
          ], fNivel, 'Nível')}
        </div>
        <div class="tabela-meta"><span><b>${visiveis.length}</b> de ${lista.length} contrato(s) encerrado(s)${filtrando?` · ${limpar}`:''}</span></div>
        ${table([
          thOrdenavel('contrato', 'Contrato', 'ordem-risco-enc'),
          thOrdenavel('termino', 'Término', 'ordem-risco-enc'),
          thOrdenavel('risco', 'Risco', 'ordem-risco-enc'),
          '<th>Eixos</th>',
          thOrdenavel('conferir', 'Para conferir', 'ordem-risco-enc', 'num'),
          thOrdenavel('analise', 'Última análise', 'ordem-risco-enc'),
          '<th class="num">Ações</th>'
        ], linhas, {pagina:true, vazio:`Nenhum contrato neste filtro · ${limpar}`})}`
      : `<div class="empty-state">${icon('shield',34)}<div class="empty-state-title">Nenhum contrato encerrado com documentos</div><div>Os contratos da pasta "Contratos Encerrados" aparecem aqui depois de aprovados na Fila de importação.</div></div>`}
    </div>`;
}

/* ===================== FICHA DE CADASTRO — SGC (Ferramenta 3) =====================
   Preenche, a partir do arquivo de origem já usado pela Ferramenta 1, os
   mesmos campos do formulário real "Cadastrar Contrato" do SGC
   (levantado manualmente — ver README) e gera um PDF salvo dentro da
   própria Central de Contratos — nunca escreve nem envia nada pro SGC de
   verdade. Só existe para contratos com arquivoOrigem; sempre sob
   demanda. Estrutura de tela é deliberadamente igual à do Mapa de Risco
   (mesma família de padrão: elegíveis + gerar/atualizar sob demanda). */
function carregarFichasCadastro(){
  if(fichasCadastroCarregando) return;
  fichasCadastroCarregando = true;
  api.fichasCadastroStatus().then(d=>{
    fichasCadastroDados = d; fichasCadastroCarregando = false;
    if(state.view==='importacoes') render();
  }).catch(err=>{
    fichasCadastroDados = { erro: err.message }; fichasCadastroCarregando = false;
    if(state.view==='importacoes') render();
  });
}

async function gerarFichaCadastro(contratoId, reabrirModal){
  fichasCadastroGerandoIds.add(contratoId);
  render();
  if(reabrirModal) abrirDetalheFichaCadastro(contratoId);
  try{
    const registro = await api.gerarFichaCadastro(contratoId);
    if(fichasCadastroDados && fichasCadastroDados.itens){
      const item = fichasCadastroDados.itens.find(i=>String(i.contrato.id)===String(contratoId));
      if(item) item.ultimaFicha = registro;
    }
    toast('Ficha de cadastro gerada — confira os campos antes de usar.', 'success');
  }catch(err){ toast(err.message, 'error'); }
  fichasCadastroGerandoIds.delete(contratoId);
  render();
  if(reabrirModal) abrirDetalheFichaCadastro(contratoId);
}

function linhaFichaPessoa(titulo, p){
  if(!p || (!p.nome && !p.cargo && !p.dataDesignacao && !p.dataTermino && !p.status)){
    return `<div class="detail-row"><span class="detail-label">${titulo}</span><span class="detail-value" style="color:var(--text-muted);">Não identificado — preencher manualmente</span></div>`;
  }
  return `<div class="detail-row"><span class="detail-label">${titulo}</span><span class="detail-value">${esc(p.nome||'—')}${p.cargo?` (${esc(p.cargo)})`:''}${p.status?` · ${esc(p.status)}`:''}</span></div>`;
}

function abrirDetalheFichaCadastro(contratoId){
  const item = ((fichasCadastroDados && fichasCadastroDados.itens) || []).find(i=>String(i.contrato.id)===String(contratoId));
  if(!item) return;
  const c = item.contrato;
  const f = item.ultimaFicha;
  const gerando = fichasCadastroGerandoIds.has(contratoId);
  const souAprovador = currentUser && (currentUser.role==='admin' || currentUser.role==='gestor');

  const corpo = !f ? `<div class="empty-state">${icon('file',30)}<div class="empty-state-title">Nenhuma ficha gerada ainda</div><div>Clique em "Gerar ficha" para preencher os campos a partir dos documentos lidos do contrato.</div></div>` : `
    <div class="detail-list">
      <div class="detail-row"><span class="detail-label">Número</span><span class="detail-value">${esc(f.campos.numero||'—')}</span></div>
      <div class="detail-row"><span class="detail-label">Processo Administrativo</span><span class="detail-value">${esc(f.campos.processoAdministrativo||'—')}</span></div>
      <div class="detail-row"><span class="detail-label">Objeto</span><span class="detail-value">${esc(f.campos.objeto||'—')}</span></div>
      <div class="detail-row"><span class="detail-label">Empresa</span><span class="detail-value">${esc(f.campos.empresa||'—')}${f.campos.cnpjEmpresa?` (${esc(f.campos.cnpjEmpresa)})`:''}</span></div>
      <div class="detail-row"><span class="detail-label">Vigência</span><span class="detail-value">${f.campos.dataInicioVigencia?formatDate(f.campos.dataInicioVigencia):'—'} até ${f.campos.dataTerminoVigencia?formatDate(f.campos.dataTerminoVigencia):'—'}</span></div>
      <div class="detail-row"><span class="detail-label">Valor do Contrato</span><span class="detail-value">${f.campos.valorContrato!=null?money(f.campos.valorContrato):'—'}</span></div>
      <div class="detail-row"><span class="detail-label">Portaria / IOM</span><span class="detail-value" style="color:var(--text-muted);">${esc(f.campos.portaria||'—')} / ${esc(f.campos.iom||'—')}${(!f.campos.portaria&&!f.campos.iom)?' (raramente vêm do texto do contrato — normal ficar em branco)':''}</span></div>
      ${linhaFichaPessoa('Gestor', f.gestor)}
      ${linhaFichaPessoa('Suplente', f.suplente)}
      <div class="detail-row"><span class="detail-label">Fiscais</span><span class="detail-value">${(f.fiscais&&f.fiscais.filter(x=>x&&x.nome).length)?f.fiscais.filter(x=>x&&x.nome).map(x=>esc(x.nome)).join(', '):'Nenhum identificado — preencher manualmente'}</span></div>
    </div>
    <div class="alert-row-sub" style="margin-top:14px;">Gerada por ${esc(f.geradoPor||'—')} em ${dataHora(f.geradoEm)} · arquivo: ${esc(f.arquivoOrigem||'—')}</div>
  `;

  modalRoot.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this) app.closeModal()">
      <div role="dialog" aria-modal="true" tabindex="-1" class="modal-card wide">
        <div class="modal-header"><h3>Ficha de cadastro — ${esc(c.numero)} <span class="modal-sub">${esc(c.empresa)}</span></h3><button type="button" class="icon-btn modal-fechar" aria-label="Fechar" title="Fechar (Esc)" onclick="app.closeModal()">${icon('close',16)}</button></div>
        <div class="note-card" style="margin-bottom:14px;">Documento de apoio interno — os campos aqui espelham o formulário "Cadastrar Contrato" do SGC, mas nada é enviado nem gravado lá automaticamente. Confira cada campo antes de usar como registro ou de digitar manualmente no SGC.</div>
        ${corpo}
        <div class="modal-actions" style="margin-top:14px;">
          <button class="btn-ghost" onclick="app.closeModal()">Fechar</button>
          ${f?`<a class="btn-ghost" href="/api/fichas-cadastro/${f.id}/arquivo" target="_blank" rel="noopener">${icon('doc',15)} Baixar PDF</a>`:''}
          ${souAprovador?`<button class="btn-primary" onclick="app.gerarFichaCadastro(${c.id}, true)" ${gerando?'disabled':''}>${icon('download',15)} ${gerando?'Gerando...':(f?'Atualizar ficha':'Gerar ficha')}</button>`:''}
        </div>
      </div>
    </div>`;
}

/* ===================== REQUISIÇÕES (TCE-SP e SisFin) =====================
   Lidas dos documentos da pasta de rede (29/09/2026), como os contratos e
   o Mapa de risco: a regra lê, a tela mostra a frase de onde saiu cada
   campo, e quem confere corrige e confirma. Duas abas:
     - TCE-SP: o que o SGC chama de requisição; a ficha tem os campos do
       formulário "Cadastrar Requisição" do SGC (Contrato, Requisição,
       Data, Observações, TC, Ofício, Arquivo), em PDF para digitar lá;
     - SisFin: a requisição do sistema contábil (RC de serviços e AD de
       alteração contratual), com itens, valores e programação mensal.
   Ver integrations/requisicoes.js. */
// Requisições do TCE com resposta pendente (do bootstrap) — aviso do Início.
let respostasTce = [];
let requisicoesDados = null;
let requisicoesCarregando = false;
let requisicoesAcompanhando = false;
let requisicoesNaTela = []; // os grupos da tela, na ordem — os botões apontam pelo índice

function carregarRequisicoes(){
  requisicoesCarregando = true;
  api.requisicoes().then(d=>{
    requisicoesDados = d; requisicoesCarregando = false;
    if(state.view==='requisicoes') render();
    if(d.progresso && d.progresso.emAndamento) acompanharLeituraRequisicoes();
  }).catch(err=>{
    requisicoesDados = { erro: err.message }; requisicoesCarregando = false;
    if(state.view==='requisicoes') render();
  });
}

const SITUACAO_REQ = { lida:['A conferir','warn'], conferida:['Conferida','ok'], descartada:['Descartada','muted'] };
const valorReq = (g, k) => (g.camposConferidos && g.camposConferidos[k]!==undefined) ? g.camposConferidos[k] : g.campos[k];
const souAprovadorReq = () => currentUser && (currentUser.role==='admin' || currentUser.role==='gestor');

function renderRequisicoes(){
  const aba = state.filters['aba-req'] || 'tce';
  if(requisicoesDados===null && !requisicoesCarregando) carregarRequisicoes();
  const d = requisicoesDados;
  const lendo = requisicoesAcompanhando || !!(d && d.progresso && d.progresso.emAndamento);
  const botaoAba = (v, rotulo, n) => `<button type="button" role="tab" aria-selected="${aba===v}" class="aba${aba===v?' ativa':''}" onclick="app.setFilter('aba-req','${v}')">${rotulo}${n!=null?`<span class="aba-n">${n}</span>`:''}</button>`;
  const ultima = d && d.ultimaLeitura;
  const cabecalho = `<div class="page-header">
      <div><h1 class="page-title">Requisições</h1><p class="page-subtitle">Requisições do Tribunal de Contas (TCE-SP) e do SisFin, lidas da pasta de rede</p></div>
      <div class="row-actions" style="flex-wrap:wrap;align-items:center;">
        ${aba==='tce' ? botaoAnalisarReq() : ''}
        <a class="btn-ghost" href="/api/requisicoes/exportar?origem=${aba}" download title="Planilha da aba aberta (sem as descartadas)">${icon('download',15)} Exportar CSV</a>
        ${souAprovadorReq() ? `<button type="button" class="btn-primary" onclick="app.lerRequisicoes()" ${lendo?'disabled':''} title="Procura os documentos de requisição em todos os processos e lê cada um (só leitura; o que já foi lido vem do cache)">${lendo?'<span class="spinner" style="width:13px;height:13px;border-color:rgba(255,255,255,.4);border-top-color:#fff;"></span> Lendo…':`${icon('refresh',15)} Ler as pastas agora`}</button>` : ''}
      </div>
    </div>
    <div class="callout callout-info" data-andamento-req style="margin:0 0 14px;" ${lendo?'':'hidden'}>${lendo ? esc(textoAndamentoReq(d && d.progresso)) : ''}</div>
    ${ultima && ultima.ultimaLeitura ? `<p class="cel-sub" style="margin:-6px 0 12px;">Última leitura: ${esc(new Date(ultima.ultimaLeitura).toLocaleString('pt-BR'))} — ${ultima.ultimoResumo ? `${ultima.ultimoResumo.documentos} documento(s) lido(s), ${ultima.ultimoResumo.anexos} anexo(s) sem requisição ignorado(s)${ultima.ultimoResumo.erros ? `, ${ultima.ultimoResumo.erros} com erro` : ''}` : ''}</p>` : ''}
    <div class="abas" role="tablist">
      ${botaoAba('tce','TCE-SP', d && !d.erro ? d.tce.length : null)}
      ${botaoAba('sisfin','SisFin', d && !d.erro ? d.sisfin.length : null)}
    </div>`;
  if(!d) return cabecalho + `<div class="card">${esqueleto(8, 'Carregando as requisições')}</div>`;
  if(d.erro) return cabecalho + `<div class="card"><div class="note-card">${esc(d.erro)}</div></div>`;
  if(!d.tce.length && !d.sisfin.length){
    return cabecalho + (aba==='tce' ? montarCardAnalisesHtml(d) : '') + `<div class="card"><div class="empty-state">${icon('inbox',30)}<div class="empty-state-title">Nenhuma requisição lida ainda</div><div>${souAprovadorReq() ? 'Clique em "Ler as pastas agora": a Central procura, em cada processo, a subpasta "19. Sisfin / 1. Requisição" e os documentos do Tribunal de Contas (pastas e arquivos com TCE, TCESP ou Tribunal de Contas no nome).' : 'Peça a um gestor para ler as pastas.'}</div></div></div>`;
  }

  const todos = aba==='tce' ? d.tce : d.sisfin;
  const fSit = state.filters['filtro-req'] || 'todas';
  const q = (state.filters['busca-req']||'').trim().toLowerCase();
  const conta = s => todos.filter(g=>g.status===s).length;
  const texto = g => [g.chave, g.pa, g.contrato && g.contrato.numero, g.contrato && g.contrato.empresa, ...Object.values(g.campos).map(v=>Array.isArray(v)?v.join(' '):v), ...g.documentos.map(x=>x.nome)].filter(Boolean).join(' ').toLowerCase();
  const lista = todos.filter(g => fSit==='todas' || g.status===fSit).filter(g => !q || texto(g).includes(q));
  requisicoesNaTela = lista;
  const situacao = g => { const [rot, cls] = SITUACAO_REQ[g.status] || SITUACAO_REQ.lida; return `<span class="status-mini ${cls}" title="${escAttr(g.conferidoPor ? `${rot} por ${g.conferidoPor} em ${dataHora(g.conferidoEm)}` : 'Leitura automática — confira no documento')}">${rot}</span>`; };
  const contratoCel = g => g.contrato
    ? `<div class="nowrap" style="font-weight:600;">${esc(g.contrato.numero)}</div><div class="cel-sub">${esc(g.pa ? `PA ${g.pa}` : 'na Central')}</div>`
    : `<div class="nowrap">${esc(valorReq(g,'contrato') || '—')}</div><div class="cel-sub">${esc(g.pa ? `PA ${g.pa}` : '')}${valorReq(g,'contrato') ? ' · fora da Central' : ''}</div>`;
  const abrir = i => `onclick="if(!event.target.closest('button,a'))app.abrirRequisicao(${i})"`;

  let cabecalhos, linhas;
  if(aba==='tce'){
    cabecalhos = ['Requisição', 'TC', 'Data', 'Ofício', 'Contrato', 'Resposta ao TCE', 'Situação', '<th class="num">Ficha</th>'];
    linhas = lista.map((g, i) => `<tr class="linha-clicavel" ${abrir(i)}>
      <td><div style="font-weight:600;">${esc(g.ficha.requisicao || '—')}</div><div class="cel-sub">${esc(g.campos.tipo || '')}</div></td>
      <td class="nowrap">${esc(g.ficha.tc || '—')}</td>
      <td class="nowrap">${g.ficha.data ? formatDate(g.ficha.data) : '<span class="cel-vazia">—</span>'}</td>
      <td>${esc(g.ficha.oficio || '—')}</td>
      <td>${contratoCel(g)}</td>
      <td>${seloResposta(g.resposta)}<div class="cel-sub">${g.documentos.length} documento(s)</div></td>
      <td>${situacao(g)}</td>
      <td class="num"><a class="icon-btn" href="/api/requisicoes/ficha?chave=${esc(encodeURIComponent(g.chave))}" download title="Baixar a ficha do SGC" aria-label="Baixar a ficha do SGC da requisição ${escAttr(g.ficha.requisicao || g.ficha.tc || '')}">${icon('download',14)}</a></td>
    </tr>`);
  } else {
    cabecalhos = ['Requisição', 'Data', 'Contrato', 'Fornecedor', '<th class="num">Valor total</th>', '<th class="num">Reservado</th>', 'SisFin', 'Situação'];
    linhas = lista.map((g, i) => `<tr class="linha-clicavel" ${abrir(i)}>
      <td><div class="nowrap" style="font-weight:600;">${esc(`${g.campos.codigo||''} ${valorReq(g,'numero')||''}`.trim())}</div><div class="cel-sub">${esc(g.campos.tipoDocumento||'')}${g.documentos.length>1?` · ${g.documentos.length} versões`:''}</div></td>
      <td class="nowrap">${valorReq(g,'data') ? formatDate(valorReq(g,'data')) : '—'}</td>
      <td>${contratoCel(g)}</td>
      <td><span class="celula-texto" title="${escAttr(g.campos.fornecedor||'')}">${esc(g.campos.fornecedor || '—')}</span></td>
      <td class="num nowrap">${valorReq(g,'valorTotal')!=null ? money(valorReq(g,'valorTotal')) : '—'}</td>
      <td class="num nowrap">${valorReq(g,'valorReservado')!=null ? money(valorReq(g,'valorReservado')) : '—'}</td>
      <td><span class="cel-sub">${esc(valorReq(g,'situacao') || '—')}</span></td>
      <td>${situacao(g)}</td>
    </tr>`);
  }
  const comContrato = todos.filter(g=>g.contrato).length;
  return cabecalho + (aba==='tce' ? montarCardAnalisesHtml(d) : '') + `
    <div class="stat-grid">
      ${statCard('inbox', COLORS.s1, todos.length, aba==='tce' ? 'Requisições do TCE-SP' : 'Requisições do SisFin', aba==='tce' ? 'a requisição e as respostas juntas' : 'versões da mesma juntas')}
      ${statCard('bell', conta('lida')?COLORS.warning:COLORS.muted, conta('lida'), 'A conferir', null, "app.setFilter('filtro-req','lida')")}
      ${statCard('check', COLORS.s3, conta('conferida'), 'Conferidas', null, "app.setFilter('filtro-req','conferida')")}
      ${statCard('doc', COLORS.s7, comContrato, 'Com contrato na Central', `${todos.length-comContrato} de processo encerrado ou fora da Central`)}
    </div>
    ${ajuda(aba==='tce'
      ? 'Os documentos do Tribunal de Contas não têm pasta fixa: a Central procura, em cada processo, pastas e arquivos com "TCE", "TCESP" ou "Tribunal de Contas" no nome, e junta numa linha a requisição e os documentos que respondem a ela (mesmo nº de requisição ou, sem nº, mesmo TC). Arquivo que não cita o Tribunal (relatório de instalação, termo de encerramento anexado) fica de fora. A ficha traz os campos do formulário "Cadastrar Requisição" do SGC; no SGC, "Ofício" é o número do protocolo digital — sem ele, vai o número do ofício de resposta. Confira no documento antes de cadastrar.'
      : 'Em cada processo, a subpasta "19. Sisfin / 1. Requisição" (e arquivos com "Requisição" ou "RQ_" na pasta do SisFin). RC é a requisição de serviços (itens, dotação, valor a reservar); AD é a alteração contratual (renovação, reajuste — com fornecedor, licitação, AF/OS e a programação mensal). Quando há mais de uma versão da mesma requisição (a reemissão para o empenho do ano, por exemplo), vale a impressa por último. O texto é digital: não passa por OCR.')}
    <div class="card">
      <div class="toolbar">
        ${searchBox('busca-req', aba==='tce' ? 'Buscar por requisição, TC, ofício, contrato...' : 'Buscar por requisição, processo, fornecedor...', state.filters['busca-req'])}
        ${segmentos('filtro-req', [['todas','Todas',todos.length],['lida','A conferir',conta('lida')],['conferida','Conferidas',conta('conferida')],['descartada','Descartadas',conta('descartada')]], fSit, 'Situação')}
      </div>
      <p class="card-subtitle" style="margin:10px 0;"><b>${lista.length}</b> de ${todos.length}</p>
      ${table(cabecalhos, linhas, { vazio: 'Nenhuma requisição neste filtro' })}
    </div>`;
}

function textoAndamentoReq(p){
  if(!p) return 'Lendo as pastas…';
  return p.total ? `Lendo ${p.feitos||0} de ${p.total} documento(s)${p.atual ? ` — ${p.atual}` : ''}` : (p.atual ? `Procurando os documentos nas pastas…` : 'Lendo as pastas…');
}

async function lerRequisicoesAgora(){
  const ok = await confirmDialog('Procura os documentos de requisição (TCE-SP e SisFin) em todos os processos da pasta de rede e lê cada um. Só lê — nenhum arquivo é alterado. O que já foi lido vem do cache (poucos segundos); documento escaneado novo passa por OCR. As conferências já feitas continuam valendo.',
    { title:'Ler as pastas agora?', confirmLabel:'Ler as pastas' });
  if(!ok) return;
  try{ await api.lerRequisicoes(); }
  catch(err){ toast(err.message, 'error'); return; }
  acompanharLeituraRequisicoes();
}

async function acompanharLeituraRequisicoes(){
  if(requisicoesAcompanhando) return;
  requisicoesAcompanhando = true;
  if(state.view==='requisicoes') render();
  let p = null;
  try{
    for(;;){
      try{ p = await api.progressoRequisicoes(); }catch(e){ /* tenta de novo */ }
      if(p && p.emAndamento){
        const el = document.querySelector('[data-andamento-req]');
        if(el){ el.hidden = false; el.textContent = textoAndamentoReq(p); }
        await new Promise(r=>setTimeout(r, 1500));
        continue;
      }
      break;
    }
  } finally {
    requisicoesAcompanhando = false;
  }
  if(p && p.ultimoErro) toast(`A leitura das requisições falhou: ${p.ultimoErro}`, 'error');
  else if(p && p.ultimoResumo){
    const r = p.ultimoResumo;
    toast(`Leitura concluída — ${r.sisfin} documento(s) do SisFin e ${r.tce} do TCE-SP; ${r.anexos} anexo(s) ignorado(s)${r.erros && r.erros.length ? `; ${r.erros.length} com erro: ${r.erros.slice(0,3).map(e=>e.arquivo).join(', ')}` : ''}.`, r.erros && r.erros.length ? 'error' : 'success');
  }
  requisicoesDados = null;
  if(state.view==='requisicoes') render();
}

/* Situação da resposta ao Tribunal (01/10/2026). */
const CLASSE_RESPOSTA = { respondida:'ok', atrasada:'err', vence_logo:'warn', no_prazo:'muted', sem_prazo:'muted', historico:'muted' };
function seloResposta(r){
  if(!r) return '<span class="cel-vazia">—</span>';
  return `<span class="status-mini ${CLASSE_RESPOSTA[r.situacao]||'muted'}" title="${escAttr(r.prazo?`Prazo de entrega: ${formatDate(r.prazo)}`:'Prazo não lido no documento')}">${esc(r.rotulo)}</span>${r.prazo && r.situacao!=='respondida' ? `<div class="cel-sub">prazo ${formatDate(r.prazo)}</div>` : ''}`;
}
function montarSecaoResposta(r, alvo){
  const pode = currentUser && ['admin','gestor','fiscal'].includes(currentUser.role);
  const marcada = r && r.manual;
  return `<section class="modal-secao"><h4>Resposta ao Tribunal</h4>
    <p style="margin:0 0 8px;">${seloResposta(r)}${r && r.prazo ? ` <span class="cel-sub">· prazo de entrega ${formatDate(r.prazo)}</span>` : ''}</p>
    ${marcada ? `<p class="cel-sub" style="margin:0 0 8px;">Registrada por ${esc(marcada.por)}${marcada.oficio?` · ${esc(marcada.oficio)}`:''}.</p>` : ''}
    ${r && r.fonte==='pasta' ? '<p class="cel-sub" style="margin:0 0 8px;">Há ofício de resposta entre os documentos desta requisição na pasta.</p>' : ''}
    ${pode ? (marcada ? `<button type="button" class="btn-ghost btn-small" onclick="app.registrarRespostaTce(${alvo}, 'reabrir')">Desfazer "respondida"</button>`
      : `<button type="button" class="btn-ghost btn-small" onclick="app.registrarRespostaTce(${alvo}, 'respondida')">${icon('check',13)} Marcar como respondida</button>`) : ''}
  </section>`;
}
async function registrarRespostaTce(alvo, acao){
  // alvo: {chave} (pasta) ou {analiseId} (enviada pela tela)
  const corpo = { ...alvo, acao };
  if(acao==='respondida'){
    openForm('Registrar a resposta ao Tribunal', [
      { name:'em', label:'Data em que a resposta foi enviada', type:'date', value:hojeIsoLocal(), required:true },
      { name:'oficio', label:'Ofício ou protocolo da resposta', hint:'Ex.: "Ofício STI/SF nº 87/2026" ou o protocolo digital.' }
    ], async d=>{
      await api.registrarRespostaTce({ ...corpo, em:d.em, oficio:d.oficio });
      requisicoesDados = null; carregarRequisicoes(); recarregarDadosAposSincronizacao();
    }, { submitLabel:'Registrar', successMessage:'Resposta registrada.' });
    return;
  }
  try{ await api.registrarRespostaTce(corpo); }catch(err){ toast(err.message, 'error'); return; }
  closeModal(); requisicoesDados = null; render(); recarregarDadosAposSincronizacao(); toast('Volta a pendente.', 'success');
}

/* Detalhe: cada campo com a linha do documento de onde saiu. */
function abrirRequisicao(i){
  const g = requisicoesNaTela[i];
  if(!g) return;
  const ev = Object.assign({}, ...g.documentos.slice().reverse().map(x=>x.evidencias||{}));
  const prova = k => ev[k] ? `<div class="cel-sub" style="margin-top:2px;">“${esc(ev[k])}”</div>` : '';
  const corrigido = k => g.camposConferidos && g.camposConferidos[k]!==undefined && String(g.camposConferidos[k]??'')!==String(g.campos[k]??'')
    ? ` <span class="status-mini ok" title="Lido: ${escAttr(g.campos[k]==null?'(vazio)':String(g.campos[k]))}">corrigido</span>` : '';
  const refReq = g.origem==='tce' ? (g.ficha.requisicao || g.ficha.tc || 'TCE') : `${g.campos.codigo||''} ${g.campos.numero||''}`.trim();
  const valorLidoDe = k => g.campos[k]==null ? null : (Array.isArray(g.campos[k]) ? g.campos[k].join('; ') : String(g.campos[k]));
  const linha = (rot, valor, k) => `<tr><td style="width:190px;font-weight:600;">${rot}</td><td>${valor==null||valor===''?'<span class="cel-vazia">—</span>':valor}${k?corrigido(k):''}${k?botaoLeituraErrada({ onde: g.origem==='tce' ? 'Requisições TCE' : 'Requisições SisFin', referencia: refReq, campo: rot.replace(/\s*\*$/,''), valorLido: valorLidoDe(k), documento: (g.documentos[0]||{}).nome || null }):''}${k?prova(k):''}</td></tr>`;
  const [rotSit, clsSit] = SITUACAO_REQ[g.status] || SITUACAO_REQ.lida;
  const docs = `<section class="modal-secao"><h4>Documentos <span class="contagem">${g.documentos.length}</span></h4>
    <ul style="list-style:none;margin:0;padding:0;font-size:13px;">${g.documentos.map((x, j)=>`<li style="display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--line);">
      <span style="overflow-wrap:anywhere;" title="${escAttr(x.caminho)}">${icon('file',13)} ${esc(x.nome)}${g.origem==='sisfin' && g.documentos.length>1 ? (j===0?' <span class="status-mini ok">versão usada</span>':' <span class="status-mini muted">versão anterior</span>') : ''}</span>
      <span class="cel-sub nowrap">${esc(x.tipo||'')}${x.data?` · ${formatDate(x.data)}`:''}${x.emitidoEm?` · impresso em ${formatDate(x.emitidoEm)}`:''}${x.porOcr?' · OCR':''}</span></li>`).join('')}</ul></section>`;

  let corpo;
  if(g.origem==='tce'){
    const f = g.ficha;
    corpo = `<section class="modal-secao">
        <h4>Ficha de cadastro — formulário "Cadastrar Requisição" do SGC</h4>
        ${table(['Campo','Valor e de onde foi lido'], [
          linha('Contrato *', f.contrato ? `${esc(f.contrato)}${g.contrato?' <span class="cel-sub">(cadastrado na Central)</span>':''}` : null, 'contrato'),
          linha('Requisição', f.requisicao ? esc(f.requisicao) : null, 'requisicao'),
          linha('Data *', f.data ? formatDate(f.data) : null, 'data'),
          linha('Observações', f.observacoes ? esc(f.observacoes) : null, 'observacoes'),
          linha('TC', f.tc ? esc(f.tc) : null, 'tc'),
          linha('Ofício', f.oficio ? esc(f.oficio) : null, g.campos.protocolo ? 'protocolo' : 'oficio'),
          linha('Arquivo', esc(f.arquivo), null),
          ...((f.relacionados||[]).length ? [linha('Documentos relacionados', `${esc(f.relacionados.join('; '))}<div class="cel-sub">Respostas e anexos na mesma pasta — ficam fora do formulário do SGC.</div>`, null)] : [])
        ])}
        <p class="modal-nota" style="margin:8px 0 0;">No SGC, "Ofício" é o número do protocolo digital; sem ele no texto, vai o número do ofício de resposta. * obrigatório no SGC.</p>
      </section>
      <section class="modal-secao"><h4>Outros dados lidos</h4>${table(['Campo','Valor'], [
        linha('Tipo', esc(g.campos.tipo||''), null),
        linha('Diretoria de fiscalização', g.campos.diretoria ? esc(g.campos.diretoria) : null, null),
        linha('Prazo de entrega (TCE)', g.campos.prazo ? formatDate(g.campos.prazo) : null, 'prazo'),
        linha('Contratada', g.campos.contratada ? esc(g.campos.contratada) : null, null),
        linha('Assunto', g.campos.assunto ? esc(g.campos.assunto) : null, 'assunto'),
        linha('Ofícios de resposta', (g.campos.oficios||[]).length ? esc(g.campos.oficios.join('; ')) : null, null),
        linha('Processo (PA)', g.pa ? esc(g.pa) : null, null)
      ])}</section>`;
  } else {
    const c = g.campos;
    const itens = (g.itens||[]).length ? table(['Código','Descrição','<th class="num">Qtd.</th>','Unid.','<th class="num">Valor unit.</th>','<th class="num">Total</th>'],
      g.itens.map(x=>`<tr><td class="nowrap">${esc(x.codigo)}</td><td>${esc(x.descricao||'')}${x.tipoAlteracao?`<div class="cel-sub">${esc(x.tipoAlteracao)}</div>`:''}</td><td class="num">${(x.quantidade??'').toLocaleString('pt-BR')}</td><td>${esc(x.unidade||'')}</td><td class="num nowrap">${money(x.valorUnitario)}</td><td class="num nowrap">${money(x.valorEstimado)}</td></tr>`)) : '<p class="cel-sub">Nenhum item lido.</p>';
    const prog = (g.programacao||[]).length ? table(['Ano', ...['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'].map(m=>`<th class="num">${m}</th>`), '<th class="num">Total</th>'],
      g.programacao.map(p=>`<tr><td style="font-weight:600;">${p.ano}</td>${p.meses.map(v=>`<td class="num nowrap">${v?Number(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}):'—'}</td>`).join('')}<td class="num nowrap" style="font-weight:600;">${money(p.total)}</td></tr>`)) : '';
    corpo = `<section class="modal-secao"><h4>O que foi lido</h4>${table(['Campo','Valor e de onde foi lido'], [
        linha('Requisição', esc(`${c.codigo||''} ${valorReq(g,'numero')||''} — ${c.tipoDocumento||''}`), 'numero'),
        linha('Data', valorReq(g,'data') ? formatDate(valorReq(g,'data')) : null, 'data'),
        linha('Processo (PA)', valorReq(g,'processo') ? esc(valorReq(g,'processo')) + (g.contrato ? ` <span class="cel-sub">— contrato ${esc(g.contrato.numero)} na Central</span>` : '') : null, 'processo'),
        linha('Situação no SisFin', valorReq(g,'situacao') ? esc(valorReq(g,'situacao')) : null, 'situacao'),
        linha('Fornecedor', c.fornecedor ? `${esc(c.fornecedor)} <span class="cel-sub">${esc(c.fornecedorCnpj||'')}</span>` : null, 'fornecedor'),
        linha('Licitação', c.licitacao ? esc(c.licitacao) : null, 'licitacao'),
        linha('AF/OS', c.afOs ? esc(c.afOs) : null, 'afOs'),
        linha('Nº de integração', c.integracao ? esc(c.integracao) : null, 'integracao'),
        linha('Unidade requisitante', c.unidade ? esc(c.unidade) : null, 'unidade'),
        linha('Dotação', (c.dotacoes||[]).length ? esc(c.dotacoes.join('; ')) : null, 'dotacoes'),
        linha('Elemento da despesa', c.elementoDespesa ? esc(c.elementoDespesa) : null, 'elementoDespesa'),
        linha('Iniciativa estratégica', c.iniciativa ? esc(c.iniciativa) : null, 'iniciativa'),
        linha('Valor total', valorReq(g,'valorTotal')!=null ? money(valorReq(g,'valorTotal')) : null, 'valorTotal'),
        linha('Valor reservado', valorReq(g,'valorReservado')!=null ? money(valorReq(g,'valorReservado')) : null, 'valorReservado'),
        linha('Justificativa', c.justificativa ? esc(c.justificativa) : null, null)
      ])}</section>
      <section class="modal-secao"><h4>Itens <span class="contagem">${(g.itens||[]).length}</span></h4>${itens}</section>
      ${prog ? `<section class="modal-secao"><h4>Programação de pagamento</h4>${prog}</section>` : ''}`;
  }
  const podeConferir = souAprovadorReq();
  janela.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this) app.closeModal()">
      <div role="dialog" aria-modal="true" tabindex="-1" class="modal-card wide" aria-label="Requisição">
        <div class="modal-header"><h3>${g.origem==='tce' ? `Requisição do TCE-SP — ${esc(g.ficha.requisicao || g.ficha.tc || 'sem número')}` : `Requisição do SisFin — ${esc(`${g.campos.codigo} ${valorReq(g,'numero')||''}`)}`}<span class="modal-sub"><span class="status-mini ${clsSit}">${rotSit}</span>${g.conferidoPor?` por ${esc(g.conferidoPor)} em ${esc(dataHora(g.conferidoEm))}`:' · leitura automática, sem IA'}</span></h3><button type="button" class="icon-btn modal-fechar" aria-label="Fechar" title="Fechar (Esc)" onclick="app.closeModal()">${icon('close',16)}</button></div>
        ${corpo}
        ${g.origem==='tce' ? montarSecaoResposta(g.resposta, esc(JSON.stringify({ chave: g.chave }))) : ''}
        ${g.origem==='tce' ? `<section class="modal-secao"><h4>Onde está a resposta <span class="contagem">${(g.itensPedidos||[]).length} item(ns)</span></h4><div id="direcao-grupo">${esqueleto(4, 'Procurando as pastas do processo')}</div></section>` : ''}
        ${docs}
        <div class="modal-actions">
          <button type="button" class="btn-ghost" onclick="app.closeModal()">Fechar</button>
          ${g.origem==='tce' ? `<a class="btn-ghost" href="/api/requisicoes/ficha?chave=${esc(encodeURIComponent(g.chave))}" download>${icon('download',15)} Baixar ficha (PDF)</a>` : ''}
          ${podeConferir && g.status!=='lida' ? `<button type="button" class="btn-ghost" onclick="app.decidirRequisicao(${i},'reabrir')">Voltar para "a conferir"</button>` : ''}
          ${podeConferir && g.status==='lida' ? `<button type="button" class="btn-ghost" onclick="app.decidirRequisicao(${i},'descartar')" title="Não é requisição (ou é duplicata): some das listas e da planilha">Descartar</button>` : ''}
          ${podeConferir ? `<button type="button" class="btn-primary" onclick="app.conferirRequisicao(${i})">${icon('check',15)} ${g.status==='conferida'?'Corrigir':'Conferir'}</button>` : ''}
        </div>
      </div>
    </div>`;
  if(g.origem==='tce') carregarDirecionamentoDoGrupo(g.chave);
}

function conferirRequisicao(i){
  const g = requisicoesNaTela[i];
  if(!g) return;
  const v = k => { const x = g.origem==='tce' ? (k in g.ficha ? g.ficha[k] : valorReq(g,k)) : valorReq(g,k); return x==null ? '' : x; };
  const campos = g.origem==='tce' ? [
    { name:'contrato', label:'Contrato *', value:v('contrato'), required:true, hint:'Nº do contrato no SGC, como "058/2020".' },
    { name:'requisicao', label:'Requisição', value:v('requisicao') },
    { name:'data', label:'Data *', type:'date', value:v('data'), required:true },
    { name:'observacoes', label:'Observações', type:'textarea', value:v('observacoes') },
    { name:'tc', label:'TC', value:v('tc'), hint:'Processo no Tribunal, como "023162.989.20-6".' },
    { name:'oficio', label:'Ofício', value:v('oficio'), hint:'No SGC, o número do protocolo digital.' }
  ] : [
    { name:'numero', label:'Número da requisição', value:v('numero'), required:true },
    { name:'data', label:'Data da requisição', type:'date', value:v('data') },
    { name:'processo', label:'Processo (PA)', value:v('processo') },
    { name:'valorTotal', label:'Valor total (R$)', type:'number', value:v('valorTotal') },
    { name:'valorReservado', label:'Valor reservado (R$)', type:'number', value:v('valorReservado') },
    { name:'situacao', label:'Situação no SisFin', value:v('situacao') }
  ];
  campos.forEach(c=>{ if(c.type==='number') c.value = c.value===''?'':String(c.value); });
  openForm(`Conferir requisição — ${esc(g.origem==='tce' ? (g.ficha.requisicao||g.ficha.tc||'TCE-SP') : `${g.campos.codigo} ${valorReq(g,'numero')||''}`)}`, campos, async d=>{
    await api.conferirRequisicao(g.chave, 'conferir', d);
    requisicoesDados = null;
  }, { wide:true, submitLabel:'Confirmar conferência', successMessage:'Requisição conferida.',
       intro:'Confira cada campo no documento. O que você corrigir fica registrado, com o valor lido antes, na Trilha de auditoria.' });
  // Campo de valor aceita centavos.
  document.querySelectorAll('#modal-form input[type="number"]').forEach(el=>el.step='0.01');
}

async function decidirRequisicao(i, acao){
  const g = requisicoesNaTela[i];
  if(!g) return;
  if(acao==='descartar'){
    const ok = await confirmDialog('Descartar tira esta requisição das listas e da planilha (o documento continua na pasta). Dá para desfazer em "Descartadas".', { title:'Descartar requisição?', confirmLabel:'Descartar' });
    if(!ok) return;
  }
  try{ await api.conferirRequisicao(g.chave, acao, null); }
  catch(err){ toast(err.message, 'error'); return; }
  closeModal();
  toast(acao==='descartar' ? 'Requisição descartada.' : 'Requisição voltou para "a conferir".', 'success');
  requisicoesDados = null;
  render();
}

/* ---------- Onde está a resposta (29/09/2026) ----------
   A Central não responde a requisição: lê o documento de pergunta, separa
   os itens pedidos e aponta, para cada um, a pasta do processo onde está o
   documento da resposta — com o caminho para copiar e abrir no Explorer.
   Ver integrations/direcionamentoRequisicao.js. */
let processosReqCache = null;

function botaoCopiarCaminho(caminho, rotulo){
  return `<button type="button" class="btn-ghost btn-small" data-caminho="${esc(caminho)}" onclick="app.copiarCaminho(this)" title="Copia o caminho completo — cole na barra do Explorer do Windows">${icon('folder',13)} ${rotulo||'Copiar caminho'}</button>`;
}
async function copiarCaminho(botao){
  const caminho = botao && botao.dataset.caminho;
  if(!caminho) return;
  const ehCaminho = /^[a-z]:\\|^\\\\/i.test(caminho);
  try{ await navigator.clipboard.writeText(caminho); toast(ehCaminho ? 'Caminho copiado — cole na barra de endereço do Explorer.' : 'Copiado.', 'success'); }
  catch(e){ window.prompt('Copie o caminho:', caminho); }
}

function montarDirecionamentoHtml(d, processo){
  const itens = (d && d.itens) || [];
  if(!itens.length) return `<div class="callout callout-warn" style="margin:0;">${icon('bell',15)}<span>Não achei a lista de itens pedidos neste documento (itens numerados como "1)", "2)" ou "a)"). Leia o documento e procure no processo${processo?` "${esc(processo.nome)}"`:''}.</span></div>`;
  const semProcesso = !processo;
  return `<ol class="direcao-lista">${itens.map(it=>{
    const pastas = (it.pastas||[]).map(p=>`<li class="direcao-pasta">
        <div class="direcao-pasta-topo"><span class="direcao-caminho">${icon('folder',14)} ${esc(p.rel)}</span><span class="cel-sub nowrap">${p.arquivos} arquivo(s)</span>${botaoCopiarCaminho(p.caminho)}</div>
        ${p.subpastas && p.subpastas.length ? `<div class="cel-sub">Subpastas: ${esc(p.subpastas.join(' · '))}</div>` : ''}
        ${!p.arquivos ? '<div class="cel-sub" style="color:var(--warn);">Pasta vazia hoje — o documento pode não ter sido arquivado ainda.</div>' : ''}
      </li>`).join('');
    const arquivos = (it.arquivos||[]).length ? `<div class="direcao-arquivos"><div class="cel-sub" style="font-weight:600;">Arquivos com nome relacionado:</div><ul>${it.arquivos.map(a=>`<li><span>${icon('file',12)} ${esc(a.rel)}</span>${botaoCopiarCaminho(a.caminho, 'Copiar')}</li>`).join('')}</ul></div>` : '';
    const chips = (it.assuntos||[]).map(a=>`<span class="direcao-chip">${esc(a)}</span>`).join('');
    const aviso = !it.assuntos.length
      ? '<div class="cel-sub" style="color:var(--warn);">Assunto não identificado (texto do item pode ter saído truncado pelo OCR) — leia no documento.</div>'
      : semProcesso ? '<div class="cel-sub">Escolha o processo acima para ver as pastas.</div>'
      : !it.pastas.length ? '<div class="cel-sub" style="color:var(--warn);">Nenhuma pasta deste assunto no processo — pode exigir declaração negativa ou documento de outro setor.</div>' : '';
    return `<li class="direcao-item">
      <div class="direcao-pedido"><span class="direcao-num">${esc(it.numero)})</span> <span>${esc(it.texto)}</span></div>
      <div class="direcao-meta">${chips}${it.manifestacao?'<span class="direcao-chip gestor" title="O item pede informação ou declaração: a resposta é escrita pelo gestor, com apoio dos documentos abaixo">Pede manifestação do gestor</span>':''}</div>
      ${aviso}
      ${pastas ? `<ul class="direcao-pastas">${pastas}</ul>` : ''}
      ${arquivos}
    </li>`;
  }).join('')}</ol>`;
}

async function carregarDirecionamentoDoGrupo(chave){
  const alvo = document.getElementById('direcao-grupo');
  if(!alvo) return;
  try{
    const d = await api.direcionamentoRequisicao(chave);
    if(!document.getElementById('direcao-grupo')) return;
    alvo.innerHTML = `${d.processo ? `<p class="modal-nota" style="margin:0 0 10px;">Processo: <b>${esc(d.processo.nome)}</b> (${esc(d.processo.como)}) ${botaoCopiarCaminho(d.processo.caminho, 'Copiar caminho do processo')}</p>` : ''}
      ${d.itensDe ? `<p class="cel-sub" style="margin:0 0 8px;">Itens lidos de: ${esc(d.itensDe)}</p>` : ''}
      ${montarDirecionamentoHtml(d, d.processo)}`;
  }catch(err){ alvo.innerHTML = `<div class="note-card">${esc(err.message)}</div>`; }
}

function escolherArquivoRequisicao(){
  const input = document.getElementById('input-analisar-requisicao');
  if(input){ input.value = ''; input.click(); }
}
async function enviarRequisicaoParaAnalise(input){
  const arquivo = input.files && input.files[0];
  if(!arquivo) return;
  if(!/\.(pdf|docx)$/i.test(arquivo.name)){ toast('Envie o PDF ou o Word (.docx) da requisição.', 'error'); return; }
  if(arquivo.size > 25*1024*1024){ toast('Arquivo maior que 25 MB.', 'error'); return; }
  const botao = document.getElementById('btn-analisar-requisicao');
  if(botao){ botao.disabled = true; botao.innerHTML = '<span class="spinner" style="width:13px;height:13px;"></span> Lendo o documento…'; }
  toast('Lendo a requisição — documento escaneado passa por OCR e pode levar alguns segundos.', 'info');
  try{
    const a = await api.analisarRequisicao(arquivo);
    requisicoesDados = null;
    analisesRecentes[a.id] = a;
    irPara('analise-requisicao', a.id);
  }catch(err){
    toast(err.message, 'error');
    if(botao){ botao.disabled = false; botao.innerHTML = `${icon('search',15)} Analisar requisição recebida`; }
  }
}

function abrirAnaliseRequisicao(id, dado){
  const a = dado || ((requisicoesDados && requisicoesDados.analisadas) || []).find(x=>String(x.id)===String(id));
  if(!a) return;
  const c = a.campos || {};
  const kv = (rot, v) => v ? `<div><span class="cel-sub">${rot}</span><div style="font-weight:600;">${v}</div></div>` : '';
  const p = a.processo;
  janela.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this) app.closeModal()">
      <div role="dialog" aria-modal="true" tabindex="-1" class="modal-card wide" aria-label="Onde está a resposta">
        <div class="modal-header"><h3>Onde está a resposta — ${esc(c.requisicao || a.nomeArquivo)}<span class="modal-sub">${esc(a.nomeArquivo)} · lido em ${esc(dataHora(a.analisadoEm))} por ${esc(a.por||'—')}${a.porOcr?' · por OCR':''}</span></h3><button type="button" class="icon-btn modal-fechar" aria-label="Fechar" title="Fechar (Esc)" onclick="app.closeModal()">${icon('close',16)}</button></div>
        <div class="callout callout-info" style="margin:0 0 14px;">${icon('bell',15)}<span>A Central não responde a requisição: ela lê o que o Tribunal pede e indica, item a item, a pasta do processo onde está o documento da resposta. Confira antes de enviar.</span></div>
        <section class="modal-secao"><div class="direcao-resumo">
          ${kv('Requisição', esc(c.requisicao||''))}${kv('TC', esc(c.tc||''))}${kv('Data', c.data?formatDate(c.data):'')}${kv('Prazo de entrega', c.prazo?formatDate(c.prazo):'')}${kv('Contrato', esc(c.contrato||''))}${kv('Contratada', esc(c.contratada||''))}
        </div></section>
        ${montarSecaoResposta(a.resposta || ((requisicoesDados && requisicoesDados.analisadas || []).find(x=>String(x.id)===String(a.id))||{}).resposta, esc(JSON.stringify({ analiseId: a.id })))}
        <section class="modal-secao">
          <h4>Processo</h4>
          ${p ? `<p style="margin:0 0 6px;"><b>${esc(p.nome)}</b> <span class="cel-sub">— ${esc(p.como)}</span> ${botaoCopiarCaminho(p.caminho, 'Copiar caminho do processo')}</p>${p.alternativas?`<p class="cel-sub" style="margin:0 0 6px;">Outros processos da mesma empresa: ${esc(p.alternativas.join('; '))}</p>`:''}`
              : '<div class="callout callout-warn" style="margin:0 0 8px;">'+icon('bell',15)+'<span>Não consegui achar o processo pelo documento (PA, contrato cadastrado ou nome da empresa). Escolha abaixo.</span></div>'}
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <select id="select-processo-req" aria-label="Processo" style="min-width:min(320px, 100%);max-width:100%;"><option value="">${p?'Trocar de processo…':'Escolha o processo…'}</option></select>
            <button type="button" class="btn-ghost btn-small" onclick="app.trocarProcessoAnalise(${a.id})">${p?'Trocar':'Usar este'}</button>
            ${p ? `<button type="button" class="btn-ghost btn-small" onclick="app.trocarProcessoAnalise(${a.id}, true)" title="Lista de novo as pastas do processo — depois de arquivar documentos">${icon('refresh',13)} Atualizar pastas</button>` : ''}
          </div>
        </section>
        <section class="modal-secao">
          <h4>Itens pedidos e onde está a resposta <span class="contagem">${(a.itensPedidos||[]).length}</span></h4>
          ${montarDirecionamentoHtml(a.direcionamento, p)}
        </section>
        <div class="modal-actions">
          ${souAprovadorReq() ? `<button type="button" class="btn-ghost" onclick="app.removerAnaliseRequisicao(${a.id})">Remover da lista</button>` : ''}
          <button type="button" class="btn-primary" onclick="app.closeModal()">Fechar</button>
        </div>
      </div>
    </div>`;
  preencherSelectProcessos(p && p.caminho);
}

async function preencherSelectProcessos(atual){
  const sel = document.getElementById('select-processo-req');
  if(!sel) return;
  try{
    if(!processosReqCache) processosReqCache = await api.processosRequisicao();
    const grupos = [['vigencia','Em vigência'],['encerrado','Encerrados'],['outra_secretaria','Outras secretarias']];
    sel.insertAdjacentHTML('beforeend', grupos.map(([k,rot])=>{
      const ps = processosReqCache.filter(x=>x.categoria===k);
      return ps.length ? `<optgroup label="${escAttr(rot)}">${ps.map(x=>`<option value="${escAttr(x.caminho)}" ${x.caminho===atual?'disabled':''}>${esc(x.nome)}</option>`).join('')}</optgroup>` : '';
    }).join(''));
  }catch(e){ /* sem lista: o botão avisa */ }
}

async function trocarProcessoAnalise(id, soAtualizar){
  const sel = document.getElementById('select-processo-req');
  const caminho = soAtualizar ? null : (sel && sel.value);
  if(!soAtualizar && !caminho){ toast('Escolha o processo na lista.', 'error'); return; }
  try{
    const a = await api.refazerAnaliseRequisicao(id, caminho);
    requisicoesDados = null;
    abrirAnaliseRequisicao(a.id, a);
    toast(soAtualizar ? 'Pastas atualizadas.' : 'Processo trocado.', 'success');
    if(state.view==='requisicoes') carregarRequisicoes();
  }catch(err){ toast(err.message, 'error'); }
}

async function removerAnaliseRequisicao(id){
  const ok = await confirmDialog('Remove esta análise da lista (o documento não foi guardado; dá para enviar de novo).', { title:'Remover análise?', confirmLabel:'Remover' });
  if(!ok) return;
  try{ await api.removerAnaliseRequisicao(id); }catch(err){ toast(err.message, 'error'); return; }
  closeModal(); requisicoesDados = null; render(); toast('Análise removida.', 'success');
}

const podeAnalisarReq = () => currentUser && ['admin','gestor','fiscal'].includes(currentUser.role);
/* Botão do topo de Requisições: envia uma requisição recebida do Tribunal para a Central apontar onde está a resposta. */
const botaoAnalisarReq = () => podeAnalisarReq() ? `<input type="file" id="input-analisar-requisicao" accept=".pdf,.docx" hidden onchange="app.enviarRequisicaoParaAnalise(this)">
  <button type="button" class="btn-ghost" id="btn-analisar-requisicao" onclick="app.escolherArquivoRequisicao()" title="Chegou uma requisição do Tribunal? Envie o PDF ou Word: a Central lê os itens pedidos e aponta, para cada um, a pasta do processo onde está o documento da resposta. O arquivo não fica guardado.">${icon('search',15)} Analisar requisição recebida</button>` : '';
function montarCardAnalisesHtml(d){
  const lista = (d.analisadas||[]);
  if(!lista.length) return '';
  return `<div class="card" style="margin-bottom:16px;">
    <h2 class="card-title">${icon('search',16)} Requisições recebidas analisadas</h2><p class="card-subtitle">Onde está a resposta de cada item pedido pelo Tribunal</p>
    ${lista.length ? `<div style="margin-top:12px;">${table(['Documento','Requisição','Processo','Itens','Resposta ao TCE','Analisado em','<th class="num">Ações</th>'],
      lista.map(a=>`<tr class="linha-clicavel" onclick="if(!event.target.closest('button'))app.abrirAnaliseRequisicao(${a.id})">
        <td><span class="celula-texto" title="${escAttr(a.nomeArquivo)}">${esc(a.nomeArquivo)}</span></td>
        <td>${esc(a.campos.requisicao || '—')}${a.campos.tc?`<div class="cel-sub">TC ${esc(a.campos.tc)}</div>`:''}</td>
        <td>${a.processo ? `<span class="celula-texto" title="${escAttr(a.processo.nome)}">${esc(a.processo.nome)}</span>` : '<span class="status-mini warn">escolher</span>'}</td>
        <td class="num">${(a.itensPedidos||[]).length}</td>
        <td>${seloResposta(a.resposta)}</td>
        <td class="nowrap">${formatDate(a.analisadoEm)}<div class="cel-sub">${esc(a.por)}</div></td>
        <td><button type="button" class="btn-ghost btn-small" onclick="app.abrirAnaliseRequisicao(${a.id})">${icon('eye',14)} Ver</button></td>
      </tr>`))}</div>` : ''}
  </div>`;
}

/* ===================== LEITURA ERRADA (01/10/2026) =====================
   Botão ao lado de cada campo lido de documento: quem confere registra o
   que foi lido e o que é o certo. A lista (Administração > Leituras
   reportadas) é a base para ajustar as regras com casos reais. Ver
   integrations/leiturasReportadas.js. */
function botaoLeituraErrada(ctx){
  if(!currentUser || !['admin','gestor','fiscal'].includes(currentUser.role)) return '';
  return ` <button type="button" class="btn-leitura-errada" title="Leitura errada? Registre o valor certo" aria-label="Reportar leitura errada de ${escAttr(ctx.campo||'')}" onclick="event.stopPropagation();app.reportarLeitura(${esc(JSON.stringify(ctx))})">⚑</button>`;
}
function reportarLeitura(ctx){
  openForm(`Leitura errada — ${esc(ctx.campo||'campo')}`, [
    { name:'valorCorreto', label:'Valor certo', value:'', hint:`Lido: "${esc(String(ctx.valorLido==null?'(vazio)':ctx.valorLido).slice(0,120))}"${ctx.documento?` · documento: ${esc(ctx.documento)}`:''}` },
    { name:'observacao', label:'Observação (opcional)', type:'textarea', value:'' }
  ], async d=>{
    await api.reportarLeitura({ ...ctx, valorCorreto:d.valorCorreto, observacao:d.observacao });
  }, { submitLabel:'Registrar', successMessage:'Registrado — obrigado. A leitura será revista.',
       intro:'Isto não corrige o dado (corrija na conferência ou na aprovação, como sempre): registra o erro para a regra de leitura ser ajustada.' });
}

let leiturasDados = null;
function renderLeiturasReportadas(){
  if(leiturasDados===null){
    leiturasDados = undefined;
    api.leiturasReportadas().then(d=>{ leiturasDados=d; if(state.view==='leiturasReportadas') render(); })
      .catch(err=>{ leiturasDados={ erro: err.message }; if(state.view==='leiturasReportadas') render(); });
  }
  const d = leiturasDados;
  const cab = `<div class="page-header"><div><h1 class="page-title">Leituras reportadas</h1><p class="page-subtitle">Campos lidos dos documentos que alguém marcou como errados</p></div>
    <div class="row-actions"><a class="btn-ghost" href="/api/leituras-reportadas/exportar" download>${icon('download',15)} Exportar CSV</a></div></div>`;
  if(!d) return cab + `<div class="card">${esqueleto(5)}</div>`;
  if(d.erro) return cab + `<div class="card"><div class="note-card">${esc(d.erro)}</div></div>`;
  const abertas = d.filter(x=>x.status==='aberta').length;
  return cab + `<div class="card"><p class="card-subtitle" style="margin:0 0 10px;">${d.length} registro(s) · ${abertas} em aberto</p>
    ${table(['Onde','Campo','Lido','Certo','Documento','Por','Situação',''], d.map(r=>`<tr>
      <td>${esc(r.onde)}${r.referencia?`<div class="cel-sub">${esc(r.referencia)}</div>`:''}</td>
      <td style="font-weight:600;">${esc(r.campo)}</td>
      <td><span class="cel-sub">${esc(r.valorLido||'(vazio)')}</span></td>
      <td>${esc(r.valorCorreto||'—')}${r.observacao?`<div class="cel-sub">${esc(r.observacao)}</div>`:''}</td>
      <td><span class="celula-texto cel-sub" title="${escAttr(r.documento||'')}">${esc(r.documento||'—')}</span></td>
      <td class="nowrap">${esc(r.por)}<div class="cel-sub">${formatDate(r.em)}</div></td>
      <td><span class="status-mini ${r.status==='resolvida'?'ok':'warn'}">${r.status==='resolvida'?'Resolvida':'Em aberto'}</span></td>
      <td>${currentUser && currentUser.role==='admin' ? `<button type="button" class="btn-ghost btn-small" onclick="app.resolverLeitura(${r.id})">${r.status==='resolvida'?'Reabrir':'Resolvida'}</button>` : ''}</td>
    </tr>`), { vazio:'Nenhuma leitura reportada.' })}</div>`;
}
async function resolverLeitura(id){
  try{ await api.resolverLeitura(id); leiturasDados = null; render(); }catch(err){ toast(err.message, 'error'); }
}

/* ===================== BUSCA NOS DOCUMENTOS (01/10/2026) =====================
   Busca no texto de todos os documentos que a Central já leu (contratos,
   aditivos, apólices, requisições, termos): a palavra, a frase entre aspas
   ou um CNPJ, com a página e o trecho. O PDF abre na página. Ver
   integrations/buscaDocumentos.js. */
let buscaResultado = null;
let buscaCarregando = false;

function renderBuscaDocumentos(){
  const q = state.filters['busca-doc-q'] || '';
  const cat = state.filters['busca-doc-cat'] || 'todos';
  const r = buscaResultado;
  // Trocou a pasta com uma busca feita: busca de novo.
  if(r && !r.erro && q && r.categoria !== cat && !buscaCarregando) setTimeout(()=>buscarNosDocumentos(q), 0);
  const destacar = t => `${esc(t.antes)}<mark>${esc(t.achado)}</mark>${esc(t.depois)}`;
  const resultados = r && !r.erro ? r.resultados.map(d=>`<div class="busca-doc">
      <div class="busca-doc-topo">
        <div><div style="font-weight:600;overflow-wrap:anywhere;">${icon('file',14)} ${esc(d.nome)}</div>
          <div class="cel-sub">${d.contrato?`Contrato <b>${esc(d.contrato.numero)}</b>${d.contrato.status==='Encerrado'?' (encerrado)':''} · `:''}${esc(d.processo||'')} · ${d.ocorrencias} ocorrência(s)</div></div>
        <div class="row-actions" style="flex-wrap:nowrap;">
          <a class="btn-ghost btn-small" href="/api/busca-documentos/arquivo?caminho=${encodeURIComponent(d.caminho)}${d.trechos[0]?`#page=${d.trechos[0].pagina}`:''}" target="_blank" rel="noopener">${icon('eye',13)} Abrir</a>
          ${botaoCopiarCaminho(d.caminho,'Copiar caminho')}
        </div>
      </div>
      ${d.trechos.map(t=>`<div class="busca-trecho"><a class="busca-pagina" href="/api/busca-documentos/arquivo?caminho=${encodeURIComponent(d.caminho)}#page=${t.pagina}" target="_blank" rel="noopener" title="Abrir nesta página">p. ${t.pagina}</a> <span>${destacar(t)}</span></div>`).join('')}
    </div>`).join('') : '';
  return `<div class="page-header"><div><h1 class="page-title">Busca nos documentos</h1><p class="page-subtitle">Procure uma palavra, frase entre aspas ou CNPJ em todos os documentos lidos</p></div></div>
    <div class="card">
      <form class="toolbar" onsubmit="event.preventDefault();app.buscarNosDocumentos(this.q.value)" style="align-items:center;">
        <div class="search-input" style="flex:1 1 360px;">${icon('search',15)}<input name="q" id="busca-doc-input" type="search" placeholder='Ex.: multa  ·  "multa de mora"  ·  11.253.441/0001-11' value="${esc(q)}" autofocus></div>
        ${segmentos('busca-doc-cat', [['todos','Todas as pastas'],['vigencia','Em vigência'],['encerrado','Encerrados'],['outra_secretaria','Outras secretarias']], cat, 'Pastas')}
        <button type="submit" class="btn-primary" ${buscaCarregando?'disabled':''}>${buscaCarregando?'Buscando…':`${icon('search',15)} Buscar`}</button>
      </form>
      ${r && r.erro ? `<div class="note-card" style="margin-top:12px;">${esc(r.erro)}</div>` : ''}
      ${r && !r.erro ? `<p class="card-subtitle" style="margin:12px 0;">${r.totalDocumentos} documento(s) com ${r.termos.map(t=>`"${esc(t)}"`).join(' e ')}, entre ${r.documentosNoIndice} lido(s) pela Central${r.totalDocumentos>r.resultados.length?` — mostrando os ${r.resultados.length} com mais ocorrências`:''}.</p>${resultados || '<div class="empty-state"><div class="empty-state-title">Nada encontrado</div><div>Tente outra palavra, sem aspas, ou outra pasta.</div></div>'}` : ''}
      ${!r ? '<p class="cel-sub" style="margin-top:12px;">Palavras soltas: o documento precisa ter todas. Entre aspas: a frase exata. Sem diferença de maiúsculas e acentos. Só entra o que a Central já leu (contratos, aditivos, apólices, requisições, termos) — nota fiscal, por exemplo, não. CPF aparece mascarado.</p>' : ''}
    </div>`;
}

async function buscarNosDocumentos(q){
  q = String(q||'').trim();
  state.filters['busca-doc-q'] = q;
  if(!q) return;
  buscaCarregando = true; render();
  const categoria = state.filters['busca-doc-cat'] || 'todos';
  try{ buscaResultado = { ...(await api.buscarDocumentos(q, categoria)), categoria }; }
  catch(err){ buscaResultado = { erro: err.message }; }
  buscaCarregando = false; render();
}

/* ===================== RELATÓRIOS MENSAIS (29/09/2026) =====================
   Os relatórios mensais de todos os contratos, da subpasta "Relatórios
   mensais de atividades" de cada processo: o mês de cada arquivo, a faixa
   dos últimos 12 meses e os meses da vigência sem relatório. O PDF abre
   pelo servidor (só arquivo achado na leitura). Ver
   integrations/relatoriosMensais.js. */
let relatoriosDados = null;
let relatoriosCarregando = false;
let relatoriosLendo = false;
let relatoriosNaTela = [];
const NOMES_MES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const mesBr = c => c ? `${NOMES_MES[Number(c.slice(5,7))-1]}/${c.slice(0,4)}` : '—';
const ROTULO_TIPO_REL = { relatorio:'Relatório', gestao:'Relatório do gestor', acompanhamento:'Acompanhamento', planilha:'Planilha', cronograma:'Cronograma', incompleto:'Download incompleto', outro:'Outro' };

function carregarRelatorios(){
  relatoriosCarregando = true;
  api.relatoriosMensais().then(d=>{ relatoriosDados = d; relatoriosCarregando = false; if(state.view==='relatoriosMensais') render(); })
    .catch(err=>{ relatoriosDados = { erro: err.message }; relatoriosCarregando = false; if(state.view==='relatoriosMensais') render(); });
}
const podeLerRelatorios = () => currentUser && ['admin','gestor','fiscal'].includes(currentUser.role);

function faixaMeses(cob){
  if(!cob || !(cob.ultimos12||[]).length) return '<span class="cel-vazia">—</span>';
  const titulo = { ok:'com relatório', falta:'sem relatório', aguardando:'no prazo de entrega', fora:'fora da vigência' };
  return `<div class="faixa-meses" role="img" aria-label="${escAttr(cob.ultimos12.map(m=>`${mesBr(m.mes)}: ${titulo[m.estado]}`).join('; '))}">${cob.ultimos12.map(m=>`<span class="faixa-mes ${m.estado}" title="${escAttr(`${mesBr(m.mes)} — ${titulo[m.estado]}`)}">${({ok:'✓',falta:'!',aguardando:'…',fora:'·'})[m.estado]}</span>`).join('')}</div>
    <div class="cel-sub" style="margin-top:2px;">${esc(mesBr(cob.ultimos12[0].mes))} → ${esc(mesBr(cob.ultimos12[cob.ultimos12.length-1].mes))}</div>`;
}

function renderRelatoriosMensais(){
  if(relatoriosDados===null && !relatoriosCarregando) carregarRelatorios();
  const d = relatoriosDados;
  const cabecalho = `<div class="page-header">
      <div><h1 class="page-title">Relatórios mensais</h1><p class="page-subtitle">Relatórios mensais de atividades de cada contrato e os meses da vigência sem relatório</p></div>
      <div class="row-actions" style="flex-wrap:wrap;align-items:center;">
        <details class="menu-mais menu-exportar">
          <summary class="btn-ghost">${icon('download',15)} Exportar <span class="seletor-seta" aria-hidden="true"></span></summary>
          <div class="menu-mais-lista" role="menu">
            <a role="menuitem" href="/api/relatorios-mensais/exportar?tipo=faltas" download>Meses sem relatório<small>Contrato e mês de cada relatório que falta</small></a>
            <a role="menuitem" href="/api/relatorios-mensais/exportar?tipo=arquivos" download>Lista de relatórios<small>Todos os arquivos, com o mês de cada um</small></a>
            <a role="menuitem" href="/api/relatorios-mensais/exportar?tipo=fora_do_padrao" download>Fora do padrão de nome<small>Com o nome sugerido, para a equipe renomear</small></a>
          </div>
        </details>
        ${podeLerRelatorios() ? `<button type="button" class="btn-primary" onclick="app.lerRelatoriosMensais()" ${relatoriosLendo?'disabled':''}>${relatoriosLendo?'<span class="spinner" style="width:13px;height:13px;border-color:rgba(255,255,255,.4);border-top-color:#fff;"></span> Lendo as pastas…':`${icon('refresh',15)} Ler as pastas agora`}</button>` : ''}
      </div>
    </div>
    ${d && d.lidoEm ? `<p class="cel-sub" style="margin:-6px 0 12px;">Última leitura: ${esc(new Date(d.lidoEm).toLocaleString('pt-BR'))} — ${d.resumo.arquivos} arquivo(s) em ${d.resumo.comPasta} processo(s)${d.resumo.semMes?`; ${d.resumo.semMes} sem mês no nome`:''}. Só lista os arquivos: nada é alterado.</p>` : ''}`;
  if(!d) return cabecalho + `<div class="card">${esqueleto(8, 'Carregando os relatórios mensais')}</div>`;
  if(d.erro) return cabecalho + `<div class="card"><div class="note-card">${esc(d.erro)}</div></div>`;
  if(!d.lidoEm) return cabecalho + `<div class="card"><div class="empty-state">${icon('file',30)}<div class="empty-state-title">As pastas ainda não foram lidas</div><div>${podeLerRelatorios() ? 'Clique em "Ler as pastas agora": a Central lista a subpasta "Relatórios mensais de atividades" de cada processo (leva uns 15 segundos).' : 'Peça a um gestor ou fiscal para ler as pastas.'}</div></div></div>`;

  const cat = state.filters['cat-rel'] || 'vigencia';
  const sit = state.filters['sit-rel'] || 'todos';
  const q = (state.filters['busca-rel']||'').trim().toLowerCase();
  const situacao = p => p.naoExige ? 'nao_exige' : !p.pastas.length ? 'sem_pasta' : !p.totalArquivos ? 'vazia' : (p.cobertura && p.cobertura.faltando.length) ? 'falta' : 'em_dia';
  const daCategoria = d.processos.filter(p => cat==='todos' || p.categoria===cat);
  const conta = s => daCategoria.filter(p=>situacao(p)===s).length;
  const lista = daCategoria
    .filter(p => sit==='todos' || situacao(p)===sit || (sit==='vazia' && situacao(p)==='sem_pasta'))
    .filter(p => !q || [p.nome, p.pa, p.contrato && p.contrato.numero, p.contrato && p.contrato.empresa].filter(Boolean).join(' ').toLowerCase().includes(q))
    .sort((a,b) => ((b.cobertura?b.cobertura.faltando.length:-1) - (a.cobertura?a.cobertura.faltando.length:-1)) || a.nome.localeCompare(b.nome,'pt-BR',{numeric:true}));
  relatoriosNaTela = lista;
  const faltasTotal = daCategoria.reduce((s,p)=>s+(p.cobertura?p.cobertura.faltando.length:0),0);
  const ROT_SIT = { falta:['Com mês faltando','warn'], em_dia:['Em dia','ok'], vazia:['Pasta vazia','muted'], sem_pasta:['Sem pasta de relatórios','muted'], nao_exige:['Não exige','muted'] };
  const linhas = lista.map((p, i) => {
    const c = p.cobertura;
    const [rot, cls] = ROT_SIT[situacao(p)];
    return `<tr class="linha-clicavel" onclick="if(!event.target.closest('button,a'))app.abrirRelatoriosDoProcesso(${i})">
      <td>${p.contrato ? `<div style="font-weight:600;" class="nowrap">${esc(p.contrato.numero)}</div>` : ''}<span class="celula-texto cel-sub" title="${escAttr(p.nome)}">${esc(p.nome.replace(/^P\.?\s*A\.?\s*/i,'PA '))}</span></td>
      <td>${faixaMeses(c)}</td>
      <td class="num nowrap">${c && c.esperados ? `<b>${c.entregues}/${c.esperados}</b><div class="cel-sub">${c.percentual}%</div>` : '<span class="cel-vazia">—</span>'}</td>
      <td>${c && c.ultimo ? `<span class="nowrap">${mesBr(c.ultimo)}</span>` : (p.totalArquivos ? '<span class="cel-sub">sem mês no nome</span>' : '<span class="cel-vazia">—</span>')}</td>
      <td class="col-faltando">${c && c.faltando.length ? `<span class="cel-sub">${esc(c.faltando.slice(-4).reverse().map(mesBr).join(', '))}${c.faltando.length>4?` e mais ${c.faltando.length-4}`:''}</span>` : ''}${c && c.aguardando ? `<div class="cel-sub">${esc(mesBr(c.aguardando))}: no prazo de entrega</div>` : ''}</td>
      <td><span class="status-mini ${cls}">${rot}</span>${p.porTipo.incompleto?`<div class="cel-sub" style="color:var(--warn);">${p.porTipo.incompleto} download(s) incompleto(s)</div>`:''}${p.foraDoPadrao?`<div class="cel-sub" title="Nome sem o prefixo AAAA_MM — veja o nome sugerido no detalhe">${p.foraDoPadrao} fora do padrão de nome</div>`:''}</td>
      <td class="col-fixa-dir"><button type="button" class="btn-ghost btn-small" onclick="app.abrirRelatoriosDoProcesso(${i})" aria-label="Ver os relatórios de ${escAttr(p.contrato ? p.contrato.numero : p.nome)}">${icon('eye',14)} Ver</button></td>
    </tr>`;
  });
  return cabecalho + `
    <div class="stat-grid">
      ${statCard('file', COLORS.s1, d.resumo.arquivos, 'Arquivos nas pastas de relatórios', `${d.resumo.comPasta} processo(s)`)}
      ${statCard('bell', faltasTotal?COLORS.warning:COLORS.muted, faltasTotal, 'Meses sem relatório', 'na vigência, até o mês passado', "app.setFilter('sit-rel','falta')")}
      ${statCard('check', COLORS.s3, conta('em_dia'), 'Em dia', null, "app.setFilter('sit-rel','em_dia')")}
      ${statCard('folder', COLORS.muted, conta('vazia')+conta('sem_pasta'), 'Pasta vazia ou sem pasta', null, "app.setFilter('sit-rel','vazia')")}
    </div>
    ${ajuda('A Central lista a subpasta "Relatórios mensais de atividades" de cada processo e descobre o mês de cada arquivo pelo nome ("2025_08 - Relatório Mensal ... - Agosto", "02.2025") ou pela subpasta ("2024/Dezembro"). Os meses esperados vão do início ao término do contrato cadastrado, até o mês passado; o relatório de um mês é entregue no seguinte, então até o dia 10 o mês passado fica "no prazo". Processo sem contrato cadastrado conta do primeiro ao último relatório da pasta. Contrato de compra ou licença, sem relatório mensal, pode ser marcado "não exige" no detalhe. Arquivo ".crdownload" é download que não terminou: o relatório não está inteiro na pasta.')}
    <div class="card">
      <div class="toolbar">
        ${searchBox('busca-rel', 'Buscar por contrato, empresa ou processo...', state.filters['busca-rel'])}
        ${segmentos('cat-rel', [['vigencia','Em vigência',d.processos.filter(p=>p.categoria==='vigencia').length],['encerrado','Encerrados',d.processos.filter(p=>p.categoria==='encerrado').length],['outra_secretaria','Outras secretarias',d.processos.filter(p=>p.categoria==='outra_secretaria').length],['todos','Todos',d.processos.length]], cat, 'Processos')}
        ${segmentos('sit-rel', [['todos','Todos',daCategoria.length],['falta','Com mês faltando',conta('falta')],['em_dia','Em dia',conta('em_dia')],['vazia','Vazia',conta('vazia')+conta('sem_pasta')],['nao_exige','Não exige',conta('nao_exige')]], sit, 'Situação')}
      </div>
      <p class="card-subtitle" style="margin:10px 0;">${lista.length} processo(s) · últimos 12 meses: <span class="faixa-legenda"><span class="faixa-mes ok">✓</span> com relatório <span class="faixa-mes falta">!</span> sem relatório <span class="faixa-mes aguardando">…</span> no prazo <span class="faixa-mes fora">·</span> fora da vigência</span></p>
      ${table(['Contrato / processo','Últimos 12 meses','<th class="num">Com relatório</th>','Último','Faltando','Situação','<th class="col-fixa-dir">Ações</th>'], linhas, { vazio:'Nenhum processo neste filtro' })}
    </div>`;
}

async function lerRelatoriosMensaisAgora(){
  relatoriosLendo = true; render();
  try{
    const r = await api.lerRelatoriosMensais();
    toast(`Pastas lidas — ${r.arquivos} arquivo(s) em ${r.comPasta} processo(s), em ${Math.round(r.duracaoMs/1000)} s.`, 'success');
  }catch(err){ toast(err.message, 'error'); }
  relatoriosLendo = false; relatoriosDados = null; render();
}

async function abrirRelatoriosDoProcesso(i){
  const resumo = relatoriosNaTela[i];
  if(!resumo) return;
  // Os arquivos vêm só no detalhe (a lista vai sem eles).
  let p;
  try{ p = await api.relatorioMensalProcesso(resumo.caminho); }
  catch(err){ toast(err.message, 'error'); return; }
  const c = p.cobertura;
  const porMes = new Map();
  p.arquivos.forEach(a=>{ const k = a.competencia || 'sem'; if(!porMes.has(k)) porMes.set(k, []); porMes.get(k).push(a); });
  const anos = [...new Set([...p.arquivos.filter(a=>a.competencia).map(a=>a.competencia.slice(0,4)), ...(c?c.faltando.map(m=>m.slice(0,4)):[])])].sort().reverse();
  const faltando = new Set(c ? c.faltando : []);
  const grade = anos.map(ano=>`<div class="grade-ano"><b>${ano}</b>${NOMES_MES.map((n, k)=>{
      const m = `${ano}-${String(k+1).padStart(2,'0')}`;
      const tem = (porMes.get(m)||[]).some(a=>['relatorio','gestao'].includes(a.tipo));
      const est = tem ? 'ok' : faltando.has(m) ? 'falta' : (c && m===c.aguardando) ? 'aguardando' : 'fora';
      return `<span class="faixa-mes ${est}" title="${escAttr(`${mesBr(m)}${tem?` — ${(porMes.get(m)||[]).length} arquivo(s)`:est==='falta'?' — sem relatório':''}`)}">${n}</span>`;
    }).join('')}</div>`).join('');
  const linhaArquivo = a => `<li class="rel-arquivo">
      <span class="rel-nome">${icon('file',13)} ${esc(a.nome)}<span class="cel-sub"> · ${esc(ROTULO_TIPO_REL[a.tipo]||a.tipo)} · ${esc(a.rel.split('/').slice(0,-1).join('/'))}${a.aviso?` · <span style="color:var(--warn);">${esc(a.aviso)}</span>`:''}</span>${a.foraDoPadrao?`<span class="rel-sugestao"><span class="status-mini muted">fora do padrão</span>${a.nomeSugerido?` sugerido: <b>${esc(a.nomeSugerido)}</b> ${botaoCopiarCaminho(a.nomeSugerido,'Copiar nome')}`:' <span class="cel-sub">mês não identificado — renomear à mão</span>'}</span>`:''}</span>
      <span class="rel-acoes">${a.tipo!=='incompleto' ? `<a class="btn-ghost btn-small" href="/api/relatorios-mensais/arquivo?id=${a.id}" target="_blank" rel="noopener">${icon('eye',13)} ${/\.pdf$/i.test(a.nome)?'Abrir':'Baixar'}</a>` : '<span class="status-mini warn">download incompleto</span>'}${botaoCopiarCaminho(a.caminho,'Copiar')}</span>
    </li>`;
  const meses = [...porMes.keys()].filter(k=>k!=='sem').sort().reverse();
  const listaMeses = meses.map(m=>`<div class="rel-mes"><div class="rel-mes-titulo">${esc(mesBr(m).replace(/^./, x=>x.toUpperCase()))}</div><ul>${porMes.get(m).map(linhaArquivo).join('')}</ul></div>`).join('')
    + (porMes.has('sem') ? `<div class="rel-mes"><div class="rel-mes-titulo">Sem mês no nome <span class="cel-sub">(entregas, planilhas, cronogramas)</span></div><ul>${porMes.get('sem').map(linhaArquivo).join('')}</ul></div>` : '');
  const souAprovador = currentUser && (currentUser.role==='admin' || currentUser.role==='gestor');
  janela.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this) app.closeModal()">
      <div role="dialog" aria-modal="true" tabindex="-1" class="modal-card wide" aria-label="Relatórios mensais">
        <div class="modal-header"><h3>Relatórios mensais — ${esc(p.contrato ? p.contrato.numero : p.nome)}<span class="modal-sub">${esc(p.nome)}${p.contrato?` · ${esc(p.contrato.empresa||'')}`:''}</span></h3><button type="button" class="icon-btn modal-fechar" aria-label="Fechar" title="Fechar (Esc)" onclick="app.closeModal()">${icon('close',16)}</button></div>
        ${p.naoExige ? `<div class="callout callout-info" style="margin:0 0 14px;">${icon('bell',15)}<span>Marcado como <b>não exige relatório mensal</b> por ${esc(p.naoExige.por)} em ${esc(new Date(p.naoExige.em).toLocaleDateString('pt-BR'))}${p.naoExige.motivo?`: ${esc(p.naoExige.motivo)}`:''}.</span></div>` : ''}
        ${c ? `<section class="modal-secao"><h4>Cobertura</h4>
          <p style="margin:0 0 8px;"><b>${c.entregues} de ${c.esperados}</b> mês(es) com relatório (${c.percentual ?? '—'}%) · de ${esc(mesBr(c.inicio))} a ${esc(mesBr(c.fim))} <span class="cel-sub">(${esc(c.base)})</span></p>
          ${c.faltando.length ? `<p style="margin:0 0 8px;"><span class="status-mini warn">Sem relatório</span> ${esc(c.faltando.map(mesBr).join(', '))}</p>` : '<p style="margin:0 0 8px;"><span class="status-mini ok">Todos os meses com relatório</span></p>'}
          ${c.aguardando ? `<p class="cel-sub" style="margin:0 0 8px;">${esc(mesBr(c.aguardando))}: ainda no prazo de entrega (até o dia 10).</p>` : ''}
          <div class="grade-meses">${grade}</div>
        </section>` : ''}
        ${p.arquivos.length ? `<section class="modal-secao"><h4>Indicadores do conteúdo</h4>
          <div id="indicadores-relatorios"><p class="cel-sub" style="margin:0 0 8px;">Disponibilidade, chamados, horas e SLA lidos de dentro dos últimos 12 relatórios, com o trecho de onde cada número saiu. A primeira leitura de um processo leva alguns segundos.</p>
          <button type="button" class="btn-ghost btn-small" onclick="app.lerIndicadoresRelatorios(${i})">${icon('search',13)} Ler os indicadores</button></div>
        </section>` : ''}
        <section class="modal-secao"><h4>Arquivos <span class="contagem">${p.arquivos.length}</span></h4>
          ${p.pastas.length ? `<p class="cel-sub" style="margin:0 0 8px;">Pasta: ${p.pastas.map(x=>`${esc(x.nome)} ${botaoCopiarCaminho(x.caminho,'Copiar caminho')}`).join(' ')}</p>` : '<p class="cel-sub">Este processo não tem a subpasta "Relatórios mensais de atividades".</p>'}
          ${p.arquivos.length ? `<div class="rel-lista">${listaMeses}</div>` : (p.pastas.length ? '<p class="cel-sub">A pasta está vazia.</p>' : '')}
        </section>
        <div class="modal-actions">
          ${souAprovador && p.pastas.length ? `<button type="button" class="btn-ghost" onclick="app.alternarNaoExigeRelatorio(${i})">${p.naoExige?'Voltar a exigir relatório mensal':'Não exige relatório mensal'}</button>` : ''}
          <button type="button" class="btn-primary" onclick="app.closeModal()">Fechar</button>
        </div>
      </div>
    </div>`;
}

/* Indicadores do conteúdo dos relatórios (01/10/2026). Ver integrations/indicadoresRelatorios.js. */
async function lerIndicadoresRelatorios(i){
  const resumo = relatoriosNaTela[i];
  const alvo = document.getElementById('indicadores-relatorios');
  if(!resumo || !alvo) return;
  alvo.innerHTML = esqueleto(3, 'Lendo os últimos relatórios');
  let d;
  try{ d = await api.indicadoresRelatorios(resumo.caminho); }
  catch(err){ const el = document.getElementById('indicadores-relatorios'); if(el) el.innerHTML = `<div class="note-card">${esc(err.message)}</div>`; return; }
  const el = document.getElementById('indicadores-relatorios');
  if(!el) return;
  const CHAVES = [['disponibilidade','Disponibilidade'],['chamados','Chamados'],['horas','Horas'],['sla','SLA']];
  const usadas = CHAVES.filter(([k]) => d.meses.some(m => (m.indicadores||[]).some(x=>x.chave===k)));
  const celula = (m, k) => {
    const x = (m.indicadores||[]).find(y=>y.chave===k);
    if(!x) return '<td><span class="cel-vazia">—</span></td>';
    return `<td><span title="${esc(x.trecho)}">${esc(x.valor)}</span>${x.pagina?` <a class="busca-pagina" href="/api/relatorios-mensais/arquivo?id=${encodeURIComponent(m.arquivo.id)}#page=${x.pagina}" target="_blank" rel="noopener" title="${esc(x.trecho)}">p. ${x.pagina}</a>`:''}</td>`;
  };
  const linhas = d.meses.map(m => `<tr>
    <td class="nowrap" style="font-weight:600;">${esc(mesBr(m.competencia))}</td>
    ${m.erro ? `<td colspan="${Math.max(1, usadas.length)}"><span class="cel-sub">${esc(m.erro)}</span></td>`
      : m.semTexto ? `<td colspan="${Math.max(1, usadas.length)}"><span class="status-mini muted">digitalizado</span> <span class="cel-sub">sem texto para ler (imagem)</span></td>`
      : usadas.length ? usadas.map(([k])=>celula(m, k)).join('') : '<td><span class="cel-sub">nenhum indicador reconhecido</span></td>'}
    <td><span class="cel-sub celula-texto" title="${esc(m.arquivo.nome)}">${esc(m.arquivo.nome)}</span></td>
  </tr>`);
  const r = d.resumo;
  el.innerHTML = `<p class="cel-sub" style="margin:0 0 8px;">${r.analisados} relatório(s) lido(s) · ${r.comIndicador} com indicador reconhecido${r.semTexto?` · ${r.semTexto} digitalizado(s), sem texto`:''}. Passe o mouse sobre o valor para ver o trecho; "p. N" abre o relatório na página.</p>
    ${usadas.length ? '' : '<div class="callout callout-info" style="margin:0 0 8px;">'+icon('bell',15)+'<span>Os relatórios deste processo não trazem disponibilidade, chamados, horas nem SLA em formato reconhecível — confira no próprio documento.</span></div>'}
    ${table(['Mês', ...(usadas.length ? usadas.map(([,r])=>r) : ['Indicadores']), 'Relatório'], linhas, { vazio:'Nenhum relatório com mês identificado.' })}`;
}

async function alternarNaoExigeRelatorio(i){
  const p = relatoriosNaTela[i];
  if(!p) return;
  let motivo = null;
  if(!p.naoExige){
    const ok = await confirmDialog('Os meses sem relatório deste processo deixam de ser cobrados (ex.: contrato de compra ou de licença, sem relatório mensal). Dá para desfazer.', { title:'Não exige relatório mensal?', confirmLabel:'Confirmar' });
    if(!ok) return;
    motivo = 'contrato sem relatório mensal (compra, licença ou entrega única)';
  }
  try{ await api.marcarNaoExigeRelatorio(p.caminho, !p.naoExige, motivo); }
  catch(err){ toast(err.message, 'error'); return; }
  closeModal(); relatoriosDados = null; render();
  toast(p.naoExige ? 'Volta a exigir relatório mensal.' : 'Marcado como "não exige relatório mensal".', 'success');
}

const VIEWS = {
  inicio:renderInicio, contratos:renderContratos, aditivos:renderAditivos, apostilamentos:renderApostilamentos, config:renderConfiguracoes, painel:renderPainel,
  integracoes:renderIntegracoes, importacoes:renderImportacoes, baseContratos:renderBaseContratos, pendenciasLeitura:renderPendenciasLeitura, conferenciaSgc:renderConferenciaSgc, mapaRisco:renderMapaRisco, requisicoes:renderRequisicoes, relatoriosMensais:renderRelatoriosMensais, ufm:renderUfm, buscaDocumentos:renderBuscaDocumentos, leiturasReportadas:renderLeiturasReportadas, contas:renderContas, auditoria:renderAuditoria
};

/* ===================== APP SHELL / RENDER ===================== */
function mountShell(){
  document.getElementById('app-root').innerHTML = `
    <div class="sidebar-scrim" id="sidebar-scrim" onclick="app.toggleSidebar(false, true)"></div>
    <div class="sidebar-wrap">
      <aside class="sidebar" id="sidebar"></aside>
      <button type="button" class="sidebar-toggle" id="sidebar-toggle" onclick="app.recolherMenu()">${icon('chevronLeft',15)}</button>
    </div>
    <div class="main">
      <div class="topbar">
        <div style="display:flex;align-items:center;gap:12px;">
          <button type="button" class="icon-btn hamburger" title="Abrir o menu" aria-label="Abrir o menu" aria-controls="sidebar" aria-expanded="false" onclick="app.toggleSidebar(undefined, true)">${icon('menu',17)}</button>
          <div class="breadcrumb" id="breadcrumb"></div>
        </div>
        <div class="global-search" id="global-search">
          <div class="search-input">${icon('search',15)}<input id="global-search-input" type="search" placeholder="Buscar contrato, termo ou empresa..." aria-label="Buscar contratos, aditivos e apostilamentos" oninput="app.buscaGlobal(this.value)" onfocus="app.buscaGlobal(this.value)"><kbd class="kbd" title="Atalho: tecla /">/</kbd>
          </div>
          <div class="global-search-results" id="global-search-results" hidden></div>
        </div>
        <div class="user-chip">
          <div class="avatar" id="topbar-avatar">${esc((((currentUser&&currentUser.nome)||'Usuário').match(/[A-Za-zÀ-ÿ]+/g)||['U']).filter(p=>p.length>2||/^[A-ZÀ-Ý]/.test(p)).slice(0,2).map(s=>s[0]).join('').toUpperCase())}</div>
          <div class="user-texto">
            <div class="user-name" id="topbar-user-name">${esc((currentUser&&currentUser.nome)||'Usuário')}</div>
            <div class="user-role" id="topbar-user-role">Secretaria de Tecnologia</div>
          </div>
          <button type="button" class="icon-btn" title="Sair" aria-label="Sair do sistema" onclick="app.logout()">${icon('logout',15)}</button>
        </div>
      </div>
      <main class="content" id="view-root"></main>
    </div>`;
  aplicarMenuRecolhido(lerMenuRecolhido());
  document.addEventListener('click', function(e){
    const wrap = document.getElementById('global-search');
    if(wrap && !wrap.contains(e.target)) app.fecharBuscaGlobal();
  });
}

/* Tabelas no celular (02/10/2026): o CSS (≤ 640 px) mostra cada linha como
   um cartão "coluna: valor". Aqui cada célula recebe o nome da coluna e a
   tabela recebe os papéis ARIA (display:block tira a semântica de tabela
   em alguns navegadores). Roda sozinho a cada mudança da tela ou de uma
   janela aberta. */
function rotularTabelas(raiz){
  (raiz || document).querySelectorAll('.table-wrap table:not([data-rotulada])').forEach(t => {
    const ths = [...t.querySelectorAll('thead th')];
    const nomes = ths.map(th => (th.innerText || th.textContent || '').replace(/[▲▼↕]/g, '').replace(/\s+/g, ' ').trim());
    t.setAttribute('role', 'table');
    t.querySelectorAll('thead, tbody').forEach(g => g.setAttribute('role', 'rowgroup'));
    t.querySelectorAll('tr').forEach(tr => tr.setAttribute('role', 'row'));
    ths.forEach(th => th.setAttribute('role', 'columnheader'));
    t.querySelectorAll('tbody tr').forEach(tr => {
      let col = 0;
      [...tr.children].forEach(td => {
        td.setAttribute('role', 'cell');
        const span = Number(td.getAttribute('colspan')) || 1;
        if(span===1 && nomes[col]){
          td.setAttribute('data-label', nomes[col]);
          // Conteúdo num bloco só, ao lado do rótulo (no cartão do celular, uma
          // célula com dois elementos não espalha o segundo embaixo do rótulo).
          if(!td.querySelector(':scope > .td-conteudo') && td.childNodes.length){
            const bloco = document.createElement('div');
            bloco.className = 'td-conteudo';
            while(td.firstChild) bloco.appendChild(td.firstChild);
            td.appendChild(bloco);
          }
        }
        col += span;
      });
    });
    t.setAttribute('data-rotulada', '1');
  });
}
(function observarTabelas(){
  let pendente = false;
  const obs = new MutationObserver(() => {
    if(pendente) return;
    pendente = true;
    requestAnimationFrame(() => { pendente = false; rotularTabelas(document); });
  });
  const iniciar = () => obs.observe(document.body, { childList:true, subtree:true });
  if(document.body) iniciar(); else document.addEventListener('DOMContentLoaded', iniciar);
})();

/* Menu lateral recolhível (só em tela larga): recolhido mostra só os
   ícones, com o nome ao passar o mouse. A escolha fica guardada neste
   navegador. Atalho: tecla [. */
const CHAVE_MENU_RECOLHIDO = 'central-contratos:menu-recolhido';
function lerMenuRecolhido(){
  let salvo = null;
  try{ salvo = localStorage.getItem(CHAVE_MENU_RECOLHIDO); }catch(e){}
  if(salvo!==null) return salvo==='1';
  // Sem escolha guardada: em tela média (tablet, notebook pequeno) começa
  // recolhido, para o conteúdo não ficar espremido (02/10/2026).
  return window.innerWidth > 900 && window.innerWidth <= 1180;
}
function aplicarMenuRecolhido(recolhido){
  const appRoot = document.getElementById('app-root');
  if(appRoot) appRoot.classList.toggle('sidebar-recolhido', !!recolhido);
  const b = document.getElementById('sidebar-toggle');
  if(b){
    const t = recolhido ? 'Expandir o menu' : 'Recolher o menu';
    b.title = t + ' ( [ )'; b.setAttribute('aria-label', t); b.setAttribute('aria-expanded', String(!recolhido));
  }
}
function recolherMenu(forcar){
  const appRoot = document.getElementById('app-root');
  const recolhido = forcar!==undefined ? !!forcar : !(appRoot && appRoot.classList.contains('sidebar-recolhido'));
  try{ localStorage.setItem(CHAVE_MENU_RECOLHIDO, recolhido ? '1' : '0'); }catch(e){}
  aplicarMenuRecolhido(recolhido);
}
document.addEventListener('keydown', function(e){
  if(e.key!=='[' || e.ctrlKey || e.metaKey || e.altKey || (modalRoot && modalRoot.innerHTML)) return;
  const a = document.activeElement || {};
  if(/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName||'') || a.isContentEditable) return;
  if(document.getElementById('sidebar-toggle')){ e.preventDefault(); recolherMenu(); }
});

/* Menu do celular (≤ 900 px). moverFoco: ao abrir pelo botão ☰, o foco vai
   para o item da tela atual; ao fechar pelo Esc ou pelo fundo, volta ao ☰
   (quem usa teclado ou leitor de tela não se perde). Ao fechar porque
   escolheu uma tela, o foco fica com a tela nova. Com o menu aberto a
   página de trás não rola. */
function toggleSidebar(force, moverFoco){
  const appRoot = document.getElementById('app-root');
  if(!appRoot) return;
  const estava = appRoot.classList.contains('sidebar-open');
  const show = force!==undefined ? force : !estava;
  appRoot.classList.toggle('sidebar-open', show);
  const celular = window.innerWidth <= 900;
  document.documentElement.classList.toggle('menu-aberto', show && celular);
  const botao = document.querySelector('.hamburger');
  if(botao){
    botao.setAttribute('aria-expanded', String(show));
    botao.setAttribute('aria-label', show ? 'Fechar o menu' : 'Abrir o menu');
    botao.title = show ? 'Fechar o menu' : 'Abrir o menu';
  }
  if(!moverFoco || !celular || show===estava) return;
  if(show){
    const item = document.querySelector('#sidebar .nav-item.active') || document.querySelector('#sidebar .nav-item');
    if(item) setTimeout(() => { try{ item.focus({ preventScroll:true }); }catch(e){} }, 60);
  } else if(botao){ botao.focus(); }
}

/* Pendências ao lado do item do menu: o que pede ação de quem usa. */
/* Número ao lado do item do menu. Dois sentidos, duas cores: âmbar é
   PENDÊNCIA (pede ação de quem usa) e neutro é QUANTIDADE (quantos
   registros a tela tem) — senão todo número no menu vira alerta. */
function contadorDoMenu(id){
  if(id==='importacoes'){
    const lista = importacoesCarregadas ? importacoes : (window.__importacoesIniciais || []);
    const n = lista.filter(i=>i.status==='pendente').length;
    return n ? { n, tipo:'pendencia', titulo:`${n} proposta(s) esperando revisão` } : null;
  }
  if(id==='pendenciasLeitura'){
    const n = mudancasPendentes.length;
    return n ? { n, tipo:'pendencia', titulo:`${n} contrato(s) com mudança vinda de termo novo para confirmar` } : null;
  }
  return null;
}

/* Com a integração com o SGC desligada (23/09/2026), o menu não oferece
   o que só existe por causa dela. */
function itemDeMenuVisivel(id){
  return !(window.__sgcDesligado && id==='conferenciaSgc');
}
function rotuloDoMenu(id, label){
  return (window.__sgcDesligado && id==='integracoes') ? 'Alertas por e-mail' : label;
}

function renderSidebar(){
  const souAdmin = currentUser && currentUser.role==='admin';
  document.getElementById('sidebar').innerHTML = `
    <div class="brand com-logo">
      <img class="brand-logo" src="img/logo.svg" alt="Central de Contratos" width="400" height="100">
      <img class="brand-marca" src="img/marca.svg" alt="Central de Contratos" width="64" height="64">
    </div>
    ${NAV.map(g=>{
      const itens = g.items.filter(([id,,,soAdmin])=>itemDeMenuVisivel(id) && (!soAdmin || souAdmin));
      if(!itens.length) return '';
      const aberto = !g.recolhivel || grupoAberto(g);
      const cabeca = g.recolhivel
        ? `<button type="button" class="nav-group-toggle" title="${g.group}" aria-expanded="${aberto}" aria-controls="grupo-${g.id}-itens" onclick="app.alternarGrupoDoMenu()">${icon(g.icone,15)}<span>${g.group}</span><span class="nav-group-seta" aria-hidden="true"></span></button>`
        : (g.group ? `<div class="nav-group-label">${g.group}</div>` : '');
      return `
      <div class="nav-group${g.recolhivel?' recolhivel':''}${g.group?'':' sem-titulo'}">
        ${cabeca}
        <div class="nav-group-itens" ${g.recolhivel?`id="grupo-${g.id}-itens" ${aberto?'':'hidden'}`:''}>
        ${itens.map(([id,rotuloOriginal,ic])=>{
          const label = rotuloDoMenu(id, rotuloOriginal);
          const n = contadorDoMenu(id);
          return `<div class="nav-item ${telaDoMenu()===id?'active':''}" role="link" tabindex="0" title="${label}${n?` — ${n.titulo}`:''}" ${telaDoMenu()===id?'aria-current="page"':''} onclick="app.setView('${id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click();}">${icon(ic,17)}<span>${label}</span>${n?`<span class="nav-count ${n.tipo==='info'?'info':''}" title="${escAttr(n.titulo)}">${n.n}</span>`:''}</div>`;
        }).join('')}
        </div>
      </div>`; }).join('')}`;
}

/* ===================== BUSCA GLOBAL ===================== */
/* Busca em memória (os dados já vieram todos via /api/bootstrap) por
   contratos. Não mexe em `state`/render() principal — atualiza só o
   dropdown de resultados, para não perder o foco nem o texto digitado a cada
   tecla. */
function buscaGlobal(termo){
  const box = document.getElementById('global-search-results');
  if(!box) return;
  const q = (termo||'').trim().toLowerCase();
  if(q.length < 2){ box.hidden = true; box.innerHTML = ''; return; }

  /* Regra deste arquivo para escape de HTML: o DADO fica cru até a hora
     de virar HTML, e só o RENDER escapa (ver esc()). Escapar aqui, na
     montagem, fazia duas coisas erradas ao mesmo tempo: a busca comparava
     com texto escapado (procurar "Silva & Filhos" não achava
     "Silva &amp; Filhos") e o render escapava de novo, mostrando
     "&amp;" literal na tela. */
  const grupos = [];
  const mContratos = contratos.filter(c=>`${c.numero} ${c.empresa} ${c.tipo}`.toLowerCase().includes(q)).slice(0,6);
  if(mContratos.length) grupos.push({ label:'Contratos', icon:'doc', items: mContratos.map(c=>({
    titulo:`${c.numero} — ${c.empresa}`, sub:c.tipo, onclick:`app.fecharBuscaGlobal();app.viewContrato(${contratos.indexOf(c)})`
  })) });
  // Aditivos e apostilamentos (07/10/2026): pelo número do termo, do contrato ou pela empresa.
  [['Aditivos', aditivos, 'aditivo', 'docMais'], ['Apostilamentos', apostilamentos, 'apostilamento', 'docNota']].forEach(([label, lista, pagina, ic])=>{
    const achados = lista.filter(t=>`${t.numero||''} ${t.contrato||''} ${t.empresa||''}`.toLowerCase().includes(q)).slice(0,4);
    if(achados.length) grupos.push({ label, icon:ic, items: achados.map(t=>({
      titulo:`${t.numero||'sem nº'} — contrato ${t.contrato||'—'}`, sub:[t.tipo, t.empresa].filter(Boolean).join(' · '), onclick:`app.fecharBuscaGlobal();app.irPara('${pagina}', ${Number(t.id)})`
    })) });
  });

  if(!grupos.length){
    box.innerHTML = `<div class="global-search-empty">Nenhum resultado para "${esc(termo)}"</div>`;
    box.hidden = false;
    return;
  }
  box.innerHTML = grupos.map(g=>`
    <div class="global-search-group">
      <div class="global-search-group-label">${g.label}</div>
      ${g.items.map(it=>`<div class="global-search-item" onclick="${it.onclick}">
        <span class="global-search-item-icon">${icon(g.icon,14)}</span>
        <span class="global-search-item-body"><span class="global-search-item-title">${esc(it.titulo)}</span><span class="global-search-item-sub">${esc(it.sub||'')}</span></span>
      </div>`).join('')}
    </div>`).join('');
  box.hidden = false;
}
function fecharBuscaGlobal(){
  const box = document.getElementById('global-search-results');
  if(box){ box.hidden = true; box.innerHTML = ''; }
  const input = document.getElementById('global-search-input');
  if(input) input.value = '';
}

/* ===================== PÁGINAS E ENDEREÇOS (07/10/2026) =====================
   Cada tela tem endereço (#/contratos, #/contrato/24): o "voltar" do
   navegador, o F5 e o link copiado funcionam. Os detalhes que eram janelas
   grandes (contrato, análise de risco, registro de riscos, requisição,
   relatórios do processo, leitura da base, conferência) viraram PÁGINAS:
   a mesma função monta o conteúdo, e "janela" decide onde ele aparece —
   na página aberta, ou num modal quando não há página (formulários curtos
   e confirmações continuam modais). */
const PAGINAS = {
  contrato: { pai:'contratos', rotulo:'Contrato', abrir: id => { const i = contratos.findIndex(c=>String(c.id)===String(id)); if(i<0) return false; viewContrato(i); } },
  aditivo: { pai:'aditivos', rotulo:'Aditivo', abrir: id => abrirTermo('aditivos', id) },
  apostilamento: { pai:'apostilamentos', rotulo:'Apostilamento', abrir: id => abrirTermo('apostilamentos', id) },
  leitura: { pai:'baseContratos', rotulo:'Leitura do contrato', abrir: id => abrirDetalheBase(id) },
  'analise-risco': { pai:'mapaRisco', rotulo:'Análise de risco', abrir: async id => {
      if(!mapasRiscoDados || !mapasRiscoDados.itens){ mapasRiscoDados = await api.mapasRiscoStatus(); }
      const existe = [...(mapasRiscoDados.itens||[]), ...(mapasRiscoDados.encerrados||[])].some(i=>String(i.contrato.id)===String(id));
      if(!existe) return false; abrirDetalheMapaRisco(id); } },
  'registro-riscos': { pai:'mapaRisco', rotulo:'Registro de riscos', abrir: id => abrirRegistroRiscos(id) },
  requisicao: { pai:'requisicoes', rotulo:'Requisição', abrir: async chave => {
      if(!requisicoesDados || requisicoesDados.erro){ requisicoesDados = await api.requisicoes(); }
      const g = [...(requisicoesDados.tce||[]), ...(requisicoesDados.sisfin||[])].find(x=>idCurto(x.chave)===chave || x.chave===chave);
      if(!g) return false; requisicoesNaTela = [g]; abrirRequisicao(0); } },
  'analise-requisicao': { pai:'requisicoes', rotulo:'Onde está a resposta', abrir: async id => {
      let a = analisesRecentes[id] || ((requisicoesDados && requisicoesDados.analisadas) || []).find(x=>String(x.id)===String(id));
      if(!a){ requisicoesDados = await api.requisicoes(); a = (requisicoesDados.analisadas||[]).find(x=>String(x.id)===String(id)); }
      if(!a) return false; abrirAnaliseRequisicao(a.id, a); } },
  'relatorios-processo': { pai:'relatoriosMensais', rotulo:'Relatórios do processo', abrir: async caminho => {
      if(!relatoriosDados || !relatoriosDados.processos){ relatoriosDados = await api.relatoriosMensais(); }
      const r = (relatoriosDados.processos||[]).find(p=>idCurto(p.caminho)===caminho || p.caminho===caminho);
      if(!r) return false; relatoriosNaTela = [r]; return abrirRelatoriosDoProcesso(0); } },
  conferencia: { pai:'conferenciaSgc', rotulo:'Conferência com o SGC', abrir: async id => {
      if(!conferenciaSgcDados || !conferenciaSgcDados.linhas){ conferenciaSgcDados = await api.conferenciaSgc(); }
      if(!(conferenciaSgcDados.linhas||[]).some(x=>String(x.contratoId)===String(id))) return false; abrirDetalheConferencia(id); } }
};
const analisesRecentes = {};
/* Caminho percorrido dentro da Central (para o "Voltar" da página): voltar
   pelo navegador tira a última tela; ir para outra tela acrescenta. */
const pilhaRotas = [];
function registrarRota(h){
  if(pilhaRotas.length > 1 && pilhaRotas[pilhaRotas.length - 2] === h) pilhaRotas.pop();
  else if(pilhaRotas[pilhaRotas.length - 1] !== h) pilhaRotas.push(h);
}
let rolarParaAoMontar = null;
let tokenPagina = 0;

const hashDe = (view, param) => '#/' + view + (param!=null && param!=='' ? '/' + encodeURIComponent(param) : '');
function lerHash(){
  const m = /^#\/([^/]+)(?:\/(.+))?$/.exec(location.hash || '');
  if(!m || !(VIEWS[m[1]] || PAGINAS[m[1]])) return null;
  let param = null; try{ param = m[2]!=null ? decodeURIComponent(m[2]) : null; }catch(e){ param = m[2]; }
  return { view:m[1], param };
}
function irPara(view, param){
  const h = hashDe(view, param);
  if(location.hash === h){ aplicarRota(); return; }
  location.hash = h; // dispara hashchange -> aplicarRota
}
function aplicarRota(){
  const r = lerHash(); if(!r) return;
  const mudouDeTela = r.view !== state.view || String(r.param) !== String(state.param);
  state.view = r.view; state.param = r.param;
  registrarRota(location.hash);
  closeModal(); toggleSidebar(false); fecharBuscaGlobal && fecharBuscaGlobal();
  render();
  if(mudouDeTela) window.scrollTo({ top:0 });
}
window.addEventListener('hashchange', ()=>{ if(currentUser) aplicarRota(); });
// Painel "Como funciona" fecha ao clicar fora ou com Esc.
document.addEventListener('click', e=>{ document.querySelectorAll('details.ajuda-topo[open]').forEach(d=>{ if(!d.contains(e.target)) d.open = false; }); });
document.addEventListener('keydown', e=>{ if(e.key==='Escape') document.querySelectorAll('details.ajuda-topo[open]').forEach(d=>{ d.open = false; }); });
/* Voltar: o "voltar" do navegador quando veio de outra tela da Central;
   senão (link aberto direto), a lista de onde a página faz parte. */
function voltar(){
  const pg = PAGINAS[state.view];
  if(pilhaRotas.length > 1){ history.back(); return; }
  irPara(pg ? pg.pai : 'inicio');
}
const telaDoMenu = () => (PAGINAS[state.view] ? PAGINAS[state.view].pai : state.view);

/* Página de detalhe: monta o esqueleto e chama a função de detalhe, que
   escreve em "janela" (aqui, a página). */
function renderPaginaDetalhe(){
  const pg = PAGINAS[state.view];
  const token = ++tokenPagina;
  Promise.resolve().then(async ()=>{
    if(token !== tokenPagina) return;
    let r;
    try{ r = await pg.abrir(state.param); }
    catch(err){ r = false; toast(err.message || 'Não foi possível abrir esta página.', 'error'); }
    const alvo = document.getElementById('pagina-detalhe');
    if(token === tokenPagina && alvo && (r === false || !alvo.dataset.montada)){
      alvo.innerHTML = `<div class="empty-state">${icon('search',30)}<div class="empty-state-title">Não foi possível abrir esta página</div><div>O registro pode ter sido removido ou ainda não foi carregado.</div><button type="button" class="btn-ghost" style="margin-top:12px;" onclick="app.voltar()">${icon('chevronLeft',14)} Voltar</button></div>`;
    }
  });
  return `<div id="pagina-detalhe" class="pagina-detalhe"><div class="card">${esqueleto(8, 'Carregando')}</div></div>`;
}

/* Converte o HTML de janela (modal-card) em página: o cabeçalho vira o
   título da página, os botões do rodapé vão para o topo, e "Fechar" vira
   "Voltar". */
function montarPagina(alvo, html){
  const tpl = document.createElement('template'); tpl.innerHTML = html;
  const card = tpl.content.querySelector('.modal-card') || tpl.content;
  let titulo = '', sub = '';
  const cab = card.querySelector('.modal-header');
  if(cab){
    const h = cab.querySelector('h1,h2,h3');
    const subEl = h && h.querySelector('.modal-sub');
    if(subEl){ sub = subEl.innerHTML; subEl.remove(); }
    titulo = h ? h.innerHTML.trim() : '';
    cab.remove();
  }
  const rodape = [...card.querySelectorAll('.modal-actions')].pop();
  let acoes = '';
  if(rodape && !rodape.closest('form')){
    rodape.querySelectorAll('button').forEach(b=>{ const oc = (b.getAttribute('onclick')||'').trim(); if(/^app\.closeModal\(\);?$/.test(oc)) b.remove(); });
    acoes = rodape.innerHTML.trim(); rodape.remove();
  }
  // "Fechar" sozinho vira "Voltar"; "fechar e ir para..." perde o fechar.
  const ajustar = raiz => raiz.querySelectorAll('[onclick]').forEach(el=>{
    const oc = el.getAttribute('onclick');
    if(/^\s*app\.closeModal\(\);?\s*$/.test(oc)) el.setAttribute('onclick', 'app.voltar()');
    else if(/app\.closeModal\(\);/.test(oc)) el.setAttribute('onclick', oc.replace(/app\.closeModal\(\);\s*/g, ''));
  });
  ajustar(card);
  const corpo = document.createElement('div'); corpo.className = 'card pagina-corpo';
  corpo.append(...card.childNodes);
  const tituloTexto = (()=>{ const d = document.createElement('div'); d.innerHTML = titulo; return d.textContent.trim(); })();
  alvo.innerHTML = `<div class="page-header pagina-cabecalho">
      <div>
        <button type="button" class="btn-voltar" onclick="app.voltar()">${icon('chevronLeft',14)} ${esc(VIEW_LABELS[PAGINAS[state.view].pai] || 'Voltar')}</button>
        <h1 class="page-title">${titulo || esc(PAGINAS[state.view].rotulo)}</h1>
        ${sub ? `<p class="page-subtitle">${sub}</p>` : ''}
      </div>
      ${acoes ? `<div class="row-actions pagina-acoes">${acoes}</div>` : ''}
    </div>`;
  alvo.appendChild(corpo);
  alvo.querySelectorAll('.pagina-acoes').forEach(ajustar);
  alvo.dataset.montada = '1';
  const bc = document.querySelector('#breadcrumb b');
  if(bc && tituloTexto) bc.textContent = tituloTexto.length > 60 ? tituloTexto.slice(0, 60) + '…' : tituloTexto;
  if(rolarParaAoMontar){ const id = rolarParaAoMontar; setTimeout(()=>{ const el = document.getElementById(id); if(el){ el.scrollIntoView({ behavior:'smooth', block:'start' }); rolarParaAoMontar = null; } }, 350); }
}

/* "janela.innerHTML = ..." nas funções de detalhe: na página aberta, se
   houver; senão, num modal (como antes). */
const janela = {
  set innerHTML(html){
    const alvo = document.getElementById('pagina-detalhe');
    if(alvo && PAGINAS[state.view]){ modalRoot.innerHTML = ''; montarPagina(alvo, html); }
    else modalRoot.innerHTML = html;
  },
  get innerHTML(){ return modalRoot.innerHTML; }
};
/* Recarrega a página aberta (depois de gerar uma análise, por exemplo). */
function animarNumeros(raiz){
  if(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  raiz.querySelectorAll('.stat-value').forEach(el=>{
    const texto = el.textContent.trim();
    if(!/^\d{1,3}(\.\d{3})*$|^\d+$/.test(texto)) return; // só números inteiros (R$ e textos ficam como estão)
    const alvo = Number(texto.replace(/\./g,'')); if(!alvo || alvo > 100000) return;
    const t0 = performance.now(), dur = 650;
    const passo = t => { const p = Math.min(1, (t - t0) / dur); const v = Math.round(alvo * (1 - Math.pow(1 - p, 3)));
      el.textContent = v.toLocaleString('pt-BR'); if(p < 1) requestAnimationFrame(passo); };
    el.textContent = '0'; requestAnimationFrame(passo);
  });
}
function recarregarPagina(view, param){ if(state.view===view && String(state.param)===String(param)) render(); }

function render(){
  const active = document.activeElement;
  const activeId = active && active.id;
  const selStart = (active && typeof active.selectionStart==='number') ? active.selectionStart : null;
  renderSidebar();
  const pg = PAGINAS[state.view];
  document.getElementById('breadcrumb').innerHTML = pg
    ? `<span class="bc-raiz">Central de Contratos &nbsp;/&nbsp; </span><a href="${hashDe(pg.pai)}" class="bc-link">${esc(VIEW_LABELS[pg.pai]||'')}</a>&nbsp;/&nbsp;<b>${esc(pg.rotulo)}</b>`
    : `<span class="bc-raiz">Central de Contratos &nbsp;/&nbsp; </span><b>${rotuloDoMenu(state.view, VIEW_LABELS[state.view]||'')}</b>`;
  const fn = pg ? renderPaginaDetalhe : (VIEWS[state.view] || renderInicio);
  const raiz = document.getElementById('view-root');
  const chaveTela = state.view + '|' + (state.param||'');
  raiz.innerHTML = fn();
  // Entrada suave só quando muda de tela (não a cada filtro digitado).
  if(raiz.dataset.tela !== chaveTela){ raiz.dataset.tela = chaveTela; raiz.classList.remove('entrando'); void raiz.offsetWidth; raiz.classList.add('entrando'); animarNumeros(raiz); }
  // "Como funciona esta tela" vira um botão no cabeçalho (antes: uma faixa inteira no meio da tela).
  const ajudaDaTela = raiz.querySelector(':scope > details.ajuda');
  const cabecalhoDaTela = raiz.querySelector(':scope > .page-header');
  if(ajudaDaTela && cabecalhoDaTela){
    ajudaDaTela.classList.add('ajuda-topo');
    const s = ajudaDaTela.querySelector('summary'); if(s) s.innerHTML = `${icon('bell',14)} Como funciona`;
    let lugar = cabecalhoDaTela.querySelector(':scope > .row-actions, :scope > div[style*="display:flex"]');
    if(!lugar){ lugar = document.createElement('div'); lugar.className = 'acoes-topo'; cabecalhoDaTela.appendChild(lugar); }
    lugar.prepend(ajudaDaTela);
  }
  if(activeId){
    const el = document.getElementById(activeId);
    if(el){ el.focus(); if(selStart!=null && el.setSelectionRange){ try{ el.setSelectionRange(selStart, selStart); }catch(e){} } }
  }
}

/* ===================== TOASTS ===================== */
const toastRoot = document.getElementById('toast-root');
function toast(message, kind){
  kind = kind || 'info';
  if(!toastRoot) return;
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.setAttribute('role', kind==='error' ? 'alert' : 'status');
  el.innerHTML = `<span>${esc(message)}</span>`;
  el.title = 'Clique para fechar';
  const fechar = ()=>{ el.classList.remove('show'); setTimeout(()=> el.remove(), 250); };
  el.onclick = fechar;
  toastRoot.appendChild(el);
  requestAnimationFrame(()=> el.classList.add('show'));
  // ~ tempo de leitura: 3,5 s + 40 ms por caractere (erro fica mais).
  setTimeout(fechar, Math.min(12000, 3500 + String(message).length * 40 + (kind==='error' ? 2500 : 0)));
}

/* ===================== CONFIRMAÇÃO (substitui confirm() nativo) ===================== */
const modalRoot = document.getElementById('modal-root');
function closeModal(){ modalRoot.innerHTML=''; }

/* Foco do teclado: ao abrir uma janela, vai para o primeiro campo (ou para
   a própria janela); ao fechar, volta para onde estava — quem navega por
   teclado não fica "perdido" atrás do fundo escurecido. */
let focoAntesDaJanela = null;
new MutationObserver(()=>{
  const card = modalRoot.querySelector('.modal-card');
  if(card && !card.contains(document.activeElement)){
    if(!focoAntesDaJanela) focoAntesDaJanela = document.activeElement;
    const alvo = card.querySelector('input:not([type=hidden]):not([disabled]),select,textarea') || card;
    try{ alvo.focus({ preventScroll:true }); }catch(e){}
  } else if(!card && focoAntesDaJanela){
    try{ focoAntesDaJanela.focus({ preventScroll:true }); }catch(e){}
    focoAntesDaJanela = null;
  }
}).observe(modalRoot, { childList:true });

document.addEventListener('keydown', function(e){
  if(e.key==='Escape' && modalRoot && modalRoot.innerHTML){ e.preventDefault(); if(window.__confirmResolve){ resolveConfirmDialog(false); } else { closeModal(); } return; }
  const raizApp = document.getElementById('app-root');
  if(e.key==='Escape' && raizApp && raizApp.classList.contains('sidebar-open')){ e.preventDefault(); toggleSidebar(false, true); return; }
  const digitando = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement||{}).tagName||'') || (document.activeElement&&document.activeElement.isContentEditable);
  if(e.key==='/' && !digitando){
    const busca = document.getElementById('global-search-input');
    if(busca){ e.preventDefault(); busca.focus(); }
  }
});

function confirmDialog(message, opts){
  opts = opts || {};
  return new Promise(resolve=>{
    modalRoot.innerHTML = `
      <div class="modal-overlay" onclick="if(event.target===this){ app.__resolveConfirm(false); }">
        <div role="dialog" aria-modal="true" tabindex="-1" class="modal-card" style="max-width:400px;">
          <div class="modal-header"><h3>${opts.title||'Confirmar ação'}</h3><button class="icon-btn" onclick="app.__resolveConfirm(false)">${icon('close',15)}</button></div>
          <p style="font-size:13.5px;color:var(--text-secondary);line-height:1.5;margin:0 0 4px;">${message}</p>
          <div class="modal-actions">
            <button type="button" class="btn-ghost" onclick="app.__resolveConfirm(false)">Cancelar</button>
            <button type="button" class="btn-primary" style="${opts.danger?'background:var(--critical)':''}" onclick="app.__resolveConfirm(true)">${opts.confirmLabel||'Confirmar'}</button>
          </div>
        </div>
      </div>`;
    window.__confirmResolve = resolve;
  });
}
function resolveConfirmDialog(value){
  closeModal();
  if(window.__confirmResolve){ window.__confirmResolve(value); window.__confirmResolve = null; }
}

function openForm(title, fields, onSubmit, opts){
  opts = opts || {};
  /* `hint` (opcional) — uma linha curta abaixo do rótulo do campo. Criado
     para a aprovação de importação poder mostrar o valor que JÁ está
     gravado no contrato ao lado do lido do documento (ver
     abrirAprovacaoImportacao), mas serve para qualquer formulário que
     precise explicar um campo sem inflar o rótulo. */
  /* `label` e `hint` são escritos pelo app (podem conter HTML de layout);
     o VALOR do campo, não: ele vem do cadastro, do SGC ou do que se
     leu de um PDF. Sem escape, um valor com aspas fecha o atributo
     `value="..."` e o resto vira marcação — por isso `val` passa sempre
     por esc(). Mesma coisa para o `name` e para as opções do select. */
  const rotulo = f => `<span>${f.label}</span>${f.hint?`<span style="display:block;font-weight:500;font-size:12px;color:${/^⚠/.test(f.hint)?'var(--warn)':'var(--text-muted)'};margin:2px 0 4px;">${f.hint}</span>`:''}`;
  const inputs = fields.map(f=>{
    if(f.type==='select'){
      return `<label class="field">${rotulo(f)}<select name="${esc(f.name)}" ${f.required?'required':''}>
        <option value="" ${f.value?'':'selected'} disabled>Selecione...</option>${f.options.map(o=>`<option value="${esc(o)}" ${f.value===o?'selected':''}>${esc(o)}</option>`).join('')}
      </select></label>`;
    }
    if(f.type==='textarea'){
      const val = (f.value!==undefined && f.value!==null) ? f.value : '';
      return `<label class="field">${rotulo(f)}<textarea name="${esc(f.name)}" ${f.required?'required':''}>${esc(val)}</textarea></label>`;
    }
    const val = (f.value!==undefined && f.value!==null) ? f.value : '';
    return `<label class="field">${rotulo(f)}<input type="${esc(f.type||'text')}" name="${esc(f.name)}" ${f.required?'required':''} ${val!==''?`value="${esc(val)}"`:''}></label>`;
  }).join('');
  modalRoot.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this) app.closeModal()">
      <div role="dialog" aria-modal="true" tabindex="-1" class="modal-card${opts.wide?' wide':''}">
        <div class="modal-header"><h3>${title}</h3><button type="button" class="icon-btn modal-fechar" aria-label="Fechar" title="Fechar (Esc)" onclick="app.closeModal()">${icon('close',16)}</button></div>
        ${opts.intro?`<div style="margin:-4px 0 16px;">${/^s*</.test(opts.intro) ? opts.intro : `<p style="font-size:13px;color:var(--text-muted);margin:0;">${opts.intro}</p>`}</div>`:''}
        <form id="modal-form">
          ${inputs}
          <div class="modal-actions"><button type="button" class="btn-ghost" onclick="app.closeModal()">Cancelar</button><button type="submit" class="btn-primary" id="modal-submit">${opts.submitLabel||'Salvar'}</button></div>
        </form>
      </div>
    </div>`;
  document.getElementById('modal-form').addEventListener('submit', async function(e){
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    const submitBtn = document.getElementById('modal-submit');
    const originalLabel = submitBtn ? submitBtn.textContent : '';
    if(submitBtn){ submitBtn.disabled = true; submitBtn.textContent = 'Salvando...'; }
    try{
      await onSubmit(data);
    }catch(err){
      toast(err.message || 'Falha ao salvar registro.', 'error');
      if(submitBtn){ submitBtn.disabled = false; submitBtn.textContent = originalLabel; }
      return;
    }
    closeModal();
    render();
    toast(opts.successMessage || 'Registro salvo.', 'success');
    if(opts.onSuccess) opts.onSuccess();
  });
}

/* ===================== COMENTÁRIOS INTERNOS ===================== */
/* Bloco reutilizável de comentários, anexável a um contrato —
   usado dentro do modal. Como os modais são montados de forma
   síncrona (innerHTML direto) mas a lista de comentários precisa de uma
   busca assíncrona, o bloco nasce com um placeholder "Carregando..." e
   `carregarComentarios()` troca só o conteúdo daquele container pelo id,
   sem precisar re-render todo o modal. */
function comentariosContainerId(entidade, entidadeId){ return `comentarios-${entidade}-${entidadeId}`; }
/* Perfil "consulta" é só leitura: sem botão de comentar nem de registrar
   tratativa (o servidor também recusa — ver requireRole em server.js). */
function podeEscrever(){ return !!currentUser && currentUser.role !== 'consulta'; }

function montarBlocoComentarios(entidade, entidadeId){
  const containerId = comentariosContainerId(entidade, entidadeId);
  const taId = `novo-comentario-${entidade}-${entidadeId}`;
  return `
    <div class="section-title">Comentários internos</div>
    <div id="${containerId}"><div class="related-empty">Carregando comentários...</div></div>
    ${podeEscrever() ? `<div style="display:flex;gap:8px;margin-top:8px;align-items:flex-start;">
      <textarea id="${taId}" rows="2" placeholder="Escreva um comentário interno..." style="flex:1;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:12.8px;resize:vertical;"></textarea>
      <button class="btn-primary btn-small" onclick="app.criarComentario('${entidade}',${entidadeId})">Comentar</button>
    </div>` : ''}`;
}
async function carregarComentarios(entidade, entidadeId){
  const containerId = comentariosContainerId(entidade, entidadeId);
  try{
    const lista = await api.listarComentarios(entidade, entidadeId);
    const el = document.getElementById(containerId);
    if(!el) return; // modal já foi fechado
    el.innerHTML = lista.length ? lista.map(c=>{
      const podeExcluir = currentUser && ((c.autorId!==undefined ? c.autorId===currentUser.id : currentUser.nome===c.autor) || currentUser.role==='admin');
      return `<div class="tratativa-row">
        <div>${esc(c.texto)}</div>
        <div class="tratativa-meta">${formatDate(c.data)} ${c.data ? dataHora(c.data,{hour:"2-digit",minute:"2-digit"}) : ''} · ${esc(c.autor)}${podeExcluir?` · <a href="#" onclick="event.preventDefault();app.excluirComentario('${entidade}',${entidadeId},${c.id})">excluir</a>`:''}</div>
      </div>`;
    }).join('') : '<div class="related-empty">Nenhum comentário ainda.</div>';
  }catch(err){
    const el = document.getElementById(containerId);
    if(el) el.innerHTML = '<div class="related-empty">Não foi possível carregar os comentários.</div>';
  }
}
async function criarComentario(entidade, entidadeId){
  const ta = document.getElementById(`novo-comentario-${entidade}-${entidadeId}`);
  const texto = ta && ta.value.trim();
  if(!texto) return;
  try{
    await api.criarComentario({ entidade, entidadeId, texto });
  }catch(err){ toast(err.message, 'error'); return; }
  if(ta) ta.value = '';
  carregarComentarios(entidade, entidadeId);
}
async function excluirComentario(entidade, entidadeId, comentarioId){
  const ok = await confirmDialog('Excluir este comentário?', { danger:true, confirmLabel:'Excluir' });
  if(!ok) return;
  try{ await api.excluirComentario(comentarioId); }catch(err){ toast(err.message, 'error'); return; }
  carregarComentarios(entidade, entidadeId);
}

/* ===================== CONTRATOS — exibição (dados vêm do SGC) ===================== */
function viewContrato(idx){
  const c = contratos[idx]; if(!c) return;
  janela.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this) app.closeModal()">
      <div role="dialog" aria-modal="true" tabindex="-1" class="modal-card wide">
        <div class="modal-header"><h3>Contrato ${esc(c.numero)} <span class="modal-sub">${esc(c.empresa)}</span></h3><button type="button" class="icon-btn modal-fechar" aria-label="Fechar" title="Fechar (Esc)" onclick="app.closeModal()">${icon('close',16)}</button></div>
        <div id="visao-contrato">${esqueleto(4, 'Montando a visão do contrato')}</div>
        <div class="section-title" style="margin-top:6px;">Cadastro</div>
        <div class="detail-list">
          <div class="detail-row"><span class="detail-label">Empresa</span><span class="detail-value">${esc(c.empresa)}${c.cnpjEmpresa?` <span style="color:var(--text-muted);">(${esc(c.cnpjEmpresa)})</span>`:''} <a class="link-btn" href="/api/fichas-sgc/empresa/${c.id}?formato=pdf" download title="Ficha com os campos do cadastro de empresa do SGC">ficha da empresa (SGC)</a></span></div>
          <div class="detail-row"><span class="detail-label">Secretaria</span><span class="detail-value">${esc(c.secretaria||'—')}</span></div>
          <div class="detail-row"><span class="detail-label">Tipo de serviço</span><span class="detail-value">${esc(c.tipo)}</span></div>
          <div class="detail-row"><span class="detail-label">Objeto</span><span class="detail-value">${esc(c.objeto||'—')}</span></div>
          <div class="detail-row"><span class="detail-label">Modalidade de contratação</span><span class="detail-value">${esc(c.tipoContratacao||'—')}</span></div>
          <div class="detail-row"><span class="detail-label">Processo administrativo (PA)</span><span class="detail-value">${esc(c.pa||'—')}</span></div>
          <div class="detail-row"><span class="detail-label">Situação</span><span class="detail-value">${badge(classificarContrato(c))}</span></div>
          <div class="detail-row"><span class="detail-label">Prazos de alerta</span><span class="detail-value">${textoDosPrazos(c)}${podeAlterarPrazos() ? ` <button type="button" class="link-btn" onclick="app.alterarPrazosContrato(${c.id})">alterar</button>` : ''}<span id="sugestao-prazos"></span></span></div>
          <div class="detail-row"><span class="detail-label">Início</span><span class="detail-value">${formatDate(c.inicio)}</span></div>
          <div class="detail-row"><span class="detail-label">Término</span><span class="detail-value">${formatDate(c.termino)}</span></div>
          <div class="detail-row"><span class="detail-label">Valor mensal</span><span class="detail-value">${money(c.valor)}</span></div>
          <div class="detail-row"><span class="detail-label">Valor total</span><span class="detail-value">${valoresTotais[c.id] ? `${money(valoresTotais[c.id].valor)} <span class="cel-sub">em ${valoresTotais[c.id].meses} meses (valor inicial + aditivos e apostilamentos de valor)</span>` : '—'}</span></div>
          <div class="detail-row"><span class="detail-label">Responsável (Gestor)</span><span class="detail-value">${esc(c.responsavel)}</span></div>
          <div class="detail-row"><span class="detail-label">Suplente</span><span class="detail-value">${esc(c.suplente||'—')}</span></div>
          <div class="detail-row"><span class="detail-label">Preposto da empresa</span><span class="detail-value">${esc(c.preposto||'—')}</span></div>
          <div class="detail-row"><span class="detail-label">E-mail do responsável</span><span class="detail-value">${esc(c.emailResponsavel||'—')}</span></div>
          <div class="detail-row"><span class="detail-label">Observações</span><span class="detail-value">${esc(c.observacoes||'—')}</span></div>
        </div>
        ${termosDoContratoHtml(c.id)}
        <div class="section-title">Histórico administrativo</div>
        <div id="historico-contrato">${esqueleto(3, 'Carregando o histórico')}</div>
        ${montarBlocoComentarios('contrato', c.id)}
        <div class="modal-actions" style="margin-top:14px;">
          <button class="btn-ghost" onclick="app.closeModal()">Fechar</button>
          ${podeEscrever() ? `<button class="btn-primary" onclick="app.registrarNoHistorico(${c.id})">${icon('plus',15)} Registrar no histórico</button>` : ''}
        </div>
      </div>
    </div>`;
  carregarComentarios('contrato', c.id);
  carregarVisaoDoContrato(c.id);
  carregarHistoricoNoAlvo(c.id, 'historico-contrato');
}

/* Fichas do SGC para aditivo, apostilamento e empresa (01/10/2026): os
   campos do formulário "Cadastrar" do SGC com o que foi lido, e o PDF.
   Ver integrations/fichasSgc.js. */
async function abrirFichaSgc(caminho){
  let f;
  try{ f = await api.fichaSgc(caminho); }catch(err){ toast(err.message, 'error'); return; }
  const linhas = f.campos.map(c => `<div class="detail-row"><span class="detail-label">${esc(c.rotulo)}${c.obrigatorio?' *':''}</span><span class="detail-value">${c.valor?esc(c.valor):'<span class="cel-vazia">—</span>'}${c.valor?` <button type="button" class="link-btn" data-caminho="${esc(String(c.valor))}" onclick="app.copiarCaminho(this)">copiar</button>`:''}${c.aviso?`<div class="cel-sub" style="color:var(--warn);">${esc(c.aviso)}</div>`:''}</span></div>`).join('');
  modalRoot.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this) app.closeModal()">
      <div role="dialog" aria-modal="true" tabindex="-1" class="modal-card">
        <div class="modal-header"><h3>${esc(f.titulo)} <span class="modal-sub">${esc(f.referencia)}</span></h3><button type="button" class="icon-btn modal-fechar" aria-label="Fechar" title="Fechar (Esc)" onclick="app.closeModal()">${icon('close',16)}</button></div>
        <p class="card-subtitle" style="margin:0 0 10px;">Campos do formulário "Cadastrar" do SGC, preenchidos com o que a Central leu. Confira antes de cadastrar.</p>
        <div class="detail-list">${linhas}</div>
        ${f.observacao?`<div class="cel-sub" style="margin-top:8px;">${esc(f.observacao)}</div>`:''}
        <div class="modal-actions" style="margin-top:14px;">
          <button class="btn-ghost" onclick="app.closeModal()">Fechar</button>
          <a class="btn-primary" style="text-decoration:none;" href="/api/fichas-sgc/${caminho}?formato=pdf" download>${icon('download',15)} Baixar PDF</a>
        </div>
      </div>
    </div>`;
}

/* Visão do contrato (01/10/2026): o que hoje fica espalhado em 5 telas —
   risco, relatórios mensais, requisições, garantia, encerramento — no topo
   do detalhe. Ver integrations/visaoContrato.js. */
async function carregarVisaoDoContrato(id){
  const alvo = document.getElementById('visao-contrato');
  if(!alvo) return;
  let v;
  try{ v = await api.visaoContrato(id); }catch(err){ alvo.innerHTML = `<div class="note-card">${esc(err.message)}</div>`; return; }
  const el = document.getElementById('visao-contrato');
  if(el) el.innerHTML = montarVisaoHtml(v);
  // No limite legal de prorrogação: o próximo passo é nova licitação, que leva mais tempo.
  const sug = document.getElementById('sugestao-prazos');
  if(sug && v.risco && (v.risco.pontos||[]).some(p=>p.codigo==='LIMITE_VIGENCIA') && (!faixasContrato[id] || faixasContrato[id].origem==='padrao'))
    sug.innerHTML = `<div class="cel-sub" style="color:var(--warn);margin-top:4px;">No limite de prorrogação: o próximo passo é nova licitação — considere um perfil de trâmite com mais antecedência.</div>`;
}
function montarVisaoHtml(v){
  const blocos = [];
  // Risco
  const r = v.risco;
  blocos.push(`<div class="visao-bloco">
    <div class="visao-titulo">${icon('shield',14)} Risco</div>
    ${r.encerrado ? '<div class="cel-sub">Contrato encerrado — fora do Mapa de risco.</div>' : `
      <div style="margin-bottom:6px;">${chipRisco(r.label)}</div>
      ${r.pontos.length ? `<ul class="visao-lista">${r.pontos.map(p=>`<li class="com-pts"><span class="conta-pts" title="${escAttr(p.criterio||'')}">${p.criticidade}</span> ${esc(p.titulo)}</li>`).join('')}</ul>` : '<div class="cel-sub">Nenhum ponto de atenção no Registro.</div>'}
      <button type="button" class="btn-ghost btn-small" onclick="app.closeModal();app.setView('mapaRisco')">Abrir no Mapa de risco</button>`}
  </div>`);
  // Relatórios mensais
  const rel = v.relatorios;
  blocos.push(`<div class="visao-bloco">
    <div class="visao-titulo">${icon('file',14)} Relatórios mensais</div>
    ${rel.naoLido ? '<div class="cel-sub">As pastas de relatórios ainda não foram lidas (tela Relatórios mensais).</div>'
      : rel.naoExige ? '<div class="cel-sub">Marcado como "não exige relatório mensal".</div>'
      : rel.esperados !== undefined ? `${faixaMeses(rel)}
        <div style="margin-top:6px;"><b>${rel.entregues} de ${rel.esperados}</b> mês(es) com relatório${rel.ultimo?` · último: ${esc(mesBr(rel.ultimo))}`:''}</div>
        ${rel.faltando.length ? `<div class="cel-sub" style="color:var(--warn);">Sem relatório: ${esc(rel.faltando.slice(-6).map(mesBr).join(', '))}${rel.faltando.length>6?` e mais ${rel.faltando.length-6}`:''}</div>` : ''}`
      : '<div class="cel-sub">O processo não tem a pasta "Relatórios mensais de atividades".</div>'}
    <button type="button" class="btn-ghost btn-small" onclick="app.closeModal();app.setView('relatoriosMensais')">Abrir Relatórios mensais</button>
  </div>`);
  // Requisições
  const q = v.requisicoes;
  const tce = [...q.tce, ...q.enviadas];
  blocos.push(`<div class="visao-bloco">
    <div class="visao-titulo">${icon('stamp',14)} Requisições</div>
    ${tce.length ? `<div class="cel-sub" style="font-weight:600;">Tribunal de Contas</div><ul class="visao-lista">${tce.map(x=>`<li>${esc(x.requisicao||'—')}${x.data?` · ${formatDate(x.data)}`:''} ${seloResposta(x.resposta)}</li>`).join('')}</ul>` : '<div class="cel-sub">Nenhuma requisição do Tribunal ligada a este contrato.</div>'}
    ${q.sisfin.length ? `<div class="cel-sub" style="font-weight:600;margin-top:6px;">SisFin</div><ul class="visao-lista">${q.sisfin.slice(0,5).map(x=>`<li>${esc(x.requisicao)} · ${formatDate(x.data)} · ${x.valorTotal!=null?money(x.valorTotal):'—'}${x.situacao?` · <span class="cel-sub">${esc(x.situacao)}</span>`:''}</li>`).join('')}</ul>${q.sisfin.length>5?`<div class="cel-sub">e mais ${q.sisfin.length-5}</div>`:''}` : ''}
    <button type="button" class="btn-ghost btn-small" onclick="app.closeModal();app.setView('requisicoes')">Abrir Requisições</button>
  </div>`);
  // Garantia, encerramento, tratativas
  const g = v.garantia;
  const outros = [];
  if(g && g.fim) outros.push(`<li>Garantia até <b>${formatDate(g.fim)}</b> ${g.diasParaVencer<0?'<span class="status-mini err">vencida</span>':g.diasParaVencer<=90?'<span class="status-mini warn">vence em breve</span>':'<span class="status-mini ok">vigente</span>'}<div class="cel-sub">${esc(g.arquivo)}</div></li>`);
  else if(g && g.semValidade && g.documentos) outros.push(`<li>Garantia: ${g.documentos} documento(s) na pasta, sem validade legível</li>`);
  else outros.push('<li class="cel-sub">Garantia: nenhuma apólice lida na pasta.</li>');
  if(v.encerramento) outros.push(`<li><span class="status-mini warn">Termo de encerramento na pasta</span> ${esc(v.encerramento.arquivo)} — confirme em Pendências de leitura</li>`);
  if(v.historicoAbertos) outros.push(`<li>${v.historicoAbertos} registro(s) em aberto no histórico do contrato</li>`);
  blocos.push(`<div class="visao-bloco"><div class="visao-titulo">${icon('lock',14)} Garantia e pendências</div><ul class="visao-lista">${outros.join('')}</ul></div>`);
  return `<div class="visao-grade">${blocos.join('')}</div>`;
}

/* ===================== ADITIVOS E APOSTILAMENTOS (07/10/2026) =====================
   Duas telas no formato da de Contratos, com os campos do formulário
   "Cadastrar" do SGC. Os termos entram pela Fila de importação (lidos dos
   documentos da pasta e aprovados); aqui só se consulta. A página de cada
   termo segue os grupos do formulário do SGC: termo, vigência, valores,
   gestor/suplente e arquivo. Ver integrations/listaTermos.js. */
const termosDados = { aditivos:null, apostilamentos:null };
const termosPromessa = {};
const TELA_TERMO = {
  aditivos: { titulo:'Aditivos', singular:'Aditivo', artigo:'o', pagina:'aditivo', icone:'docMais',
    subtitulo:'Termos aditivos dos contratos, lidos dos documentos da pasta de rede e aprovados na Fila de importação' },
  apostilamentos: { titulo:'Apostilamentos', singular:'Apostilamento', artigo:'o', pagina:'apostilamento', icone:'docNota',
    subtitulo:'Apostilamentos dos contratos, lidos dos documentos da pasta de rede e aprovados na Fila de importação' }
};
function garantirTermos(qual){
  if(termosDados[qual] && !termosDados[qual].erro) return Promise.resolve(termosDados[qual]);
  if(!termosPromessa[qual]){
    termosPromessa[qual] = api.termos(qual)
      .then(d=>{ termosDados[qual] = d; return d; })
      .catch(err=>{ termosDados[qual] = { erro: err.message }; throw err; })
      .finally(()=>{ delete termosPromessa[qual]; });
  }
  return termosPromessa[qual];
}
const seloSituacaoContrato = s => s==='vigente' ? '<span class="status-mini ok">Em vigência</span>'
  : s==='encerrado' ? '<span class="status-mini muted">Encerrado</span>' : '<span class="status-mini warn">Contrato não encontrado</span>';
const efeitoNoPrazo = i => i.meses ? `+${i.meses} ${i.meses===1?'mês':'meses'}` : '—';

/* Filtros da tela, aplicados à lista (a tabela e o CSV usam os mesmos). */
function termosFiltrados(qual){
  const d = termosDados[qual];
  if(!d || !d.itens) return [];
  const q = (state.filters[`busca-${qual}`]||'').toLowerCase();
  const fTipo = state.filters[`tipo-${qual}`]||'';
  const fSit = state.filters[`sit-${qual}`]||'';
  return d.itens
    .filter(i=>[i.numero,i.contrato,i.empresa,i.tipo,i.objeto,i.gestor,i.suplente].join(' ').toLowerCase().includes(q))
    .filter(i=>!fTipo || i.tipo===fTipo)
    .filter(i=>!fSit || i.situacaoContrato===fSit);
}

function renderTermos(qual){
  const cfg = TELA_TERMO[qual];
  const d = termosDados[qual];
  if(!d && !termosPromessa[qual]) garantirTermos(qual).catch(()=>{}).finally(()=>{ if(state.view===qual) render(); });
  const plural = cfg.titulo.toLowerCase();
  const cabecalho = `<div class="page-header">
      <div><h1 class="page-title">${cfg.titulo}</h1><p class="page-subtitle">${cfg.subtitulo}</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" class="btn-ghost" onclick="app.exportarTermosCSV('${qual}')" ${d&&d.itens?'':'disabled'}>${icon('download',15)} Exportar CSV</button>
      </div>
    </div>
    ${ajuda(`<p>Os campos seguem o formulário "Cadastrar ${cfg.singular.toLowerCase()}" do SGC. Cada ${cfg.singular.toLowerCase()} é lido do documento na pasta do contrato e entra aqui quando a proposta do contrato é aprovada na <a href="#/importacoes">Fila de importação</a>.</p>
      <p><b>Data:</b> é a da assinatura do termo (o fecho "Itaverde, ..."). No SGC o campo é a data do <i>extrato</i> publicado, que costuma sair alguns dias depois.</p>
      <p><b>IOM e portaria</b> não são lidos dos documentos. A <b>ficha do SGC</b> (ícone na última coluna) traz os campos do formulário já preenchidos, para conferir e cadastrar lá.</p>`)}`;
  if(!d) return cabecalho + `<div class="card">${esqueleto(8, `Carregando os ${plural}`)}</div>`;
  if(d.erro) return cabecalho + `<div class="card"><div class="note-card">${esc(d.erro)} <button type="button" class="link-btn" onclick="app.setView('${qual}')">tentar de novo</button></div></div>`;

  const t = d.totais;
  const fTipo = state.filters[`tipo-${qual}`]||'';
  const fSit = state.filters[`sit-${qual}`]||'';
  const filtrados = termosFiltrados(qual);
  const chaveOrd = `ordem-${qual}`;
  if(!state.filters[chaveOrd]) state.filters[chaveOrd] = 'data:desc';
  const [ordChave, ordDir] = state.filters[chaveOrd].split(':');
  const chaveDe = i => ({
    numero: chaveDoNumero(i.numero), contrato: chaveDoNumero(i.contrato), empresa: i.empresa, tipo: i.tipo, data: i.data,
    meses: i.meses, valor: i.valor, gestor: i.gestor || i.suplente, situacao: i.situacaoContrato
  })[ordChave];
  const ordenados = filtrados.slice().sort((a, b) => compararValores(chaveDe(a), chaveDe(b), ordDir));
  const ehAditivo = qual==='aditivos';

  const rows = ordenados.map(i=>`<tr class="linha-clicavel" onclick="if(!event.target.closest('button,a'))app.irPara('${cfg.pagina}', ${i.id})">
      <td class="col-fixa-esq"><a class="cel-contrato-num link-linha" href="#/${cfg.pagina}/${i.id}">${esc(i.numero||'sem nº')}</a></td>
      <td class="nowrap">${i.contratoId!=null ? `<a href="#/contrato/${i.contratoId}">${esc(i.contrato||'—')}</a>` : esc(i.contrato||'—')}</td>
      <td><span class="celula-texto" title="${escAttr(i.empresa||'')}">${esc(i.empresa||'—')}</span></td>
      <td>${esc(i.tipo||'—')}</td>
      <td class="num nowrap">${formatDate(i.data)}</td>
      ${ehAditivo
        ? `<td class="num nowrap">${efeitoNoPrazo(i)}${i.novoTermino?`<div class="cel-sub">até ${formatDate(i.novoTermino)}</div>`:''}</td><td class="num nowrap">${i.valor!=null?money(i.valor):'—'}</td>`
        : `<td>${i.gestor?esc(i.gestor):'—'}${i.suplente?`<div class="cel-sub">Suplente: ${esc(i.suplente)}</div>`:''}</td>`}
      <td>${seloSituacaoContrato(i.situacaoContrato)}</td>
      <td class="col-fixa-dir"><div class="row-actions acoes-em-linha"><button type="button" class="icon-btn" title="Ficha do SGC" aria-label="Ficha do SGC d${cfg.artigo} ${cfg.singular.toLowerCase()} ${escAttr(i.numero||'')}" onclick="app.abrirFichaSgc('termo/${cfg.pagina}/${i.id}')">${icon('file',14)}</button></div></td>
    </tr>`);
  const filtros = [`busca-${qual}`, `tipo-${qual}`, `sit-${qual}`];
  const filtrando = filtros.some(f=>state.filters[f]);
  const limpar = `<button type="button" class="link-btn" onclick="app.limparFiltros(${escAttr(JSON.stringify(filtros))})">limpar filtros</button>`;
  const cabecalhos = [
    thOrdenavel('numero', 'Nº', chaveOrd, 'col-fixa-esq'),
    thOrdenavel('contrato', 'Contrato', chaveOrd),
    thOrdenavel('empresa', 'Empresa', chaveOrd),
    thOrdenavel('tipo', 'Tipo', chaveOrd),
    thOrdenavel('data', 'Assinatura', chaveOrd, 'num'),
    ...(ehAditivo ? [thOrdenavel('meses', 'Prazo', chaveOrd, 'num'), thOrdenavel('valor', 'Valor do termo', chaveOrd, 'num')] : [thOrdenavel('gestor', 'Gestor / suplente', chaveOrd)]),
    thOrdenavel('situacao', 'Contrato', chaveOrd),
    '<th class="col-fixa-dir">Ficha</th>'
  ];
  const pct = n => t.total ? Math.round(n / t.total * 100) : 0;
  const emp = t.empresaMaisTermosVigentes;
  const cards = `<div class="stat-grid">
      ${statCard(cfg.icone, COLORS.s1, t.total, `Total de ${plural}`, `em ${t.contratos} contrato(s)`, `app.limparFiltros(${escAttr(JSON.stringify(filtros))})`)}
      ${statCard('check', COLORS.good, t.deContratosVigentes, 'De contratos em vigência', `${pct(t.deContratosVigentes)}% do total`, `app.setFilter('sit-${qual}','vigente')`)}
      ${ehAditivo
        ? statCard('calendario', COLORS.s4, t.comPrazo, 'Prorrogam o prazo', `${t.comValor} mudam o valor`, null)
        : statCard('users', COLORS.s4, t.comGestao, 'Mudam gestor ou suplente', `${pct(t.comGestao)}% do total`, null)}
      ${statCard('grid', COLORS.muted, emp ? emp.n : 0, emp ? `<span class="celula-texto" title="${escAttr(emp.nome)}">${esc(emp.nome)}</span>` : 'Empresa com mais termos', emp ? `empresa com mais ${plural} em vigência` : 'nenhum contrato em vigência', emp ? `app.setFilter('busca-${qual}', ${escAttr(JSON.stringify(emp.nome))})` : null)}
    </div>`;
  const aviso = [
    t.pendentesNaFila ? `${t.pendentesNaFila} ${plural} lido(s) de contratos ainda pendentes na <a href="#/importacoes">Fila de importação</a> — entram aqui quando a proposta for aprovada.` : '',
    t.semData ? `${t.semData} sem data de assinatura lida no documento — confira o termo.` : ''
  ].filter(Boolean);

  return `${cabecalho}
    ${cards}
    ${aviso.length ? `<div class="callout callout-info" style="margin:0 0 16px;">${icon('bell',15)}<span>${aviso.join(' ')}</span></div>` : ''}
    <div class="card">
      <div class="toolbar">
        ${searchBox(`busca-${qual}`, `Buscar por número, contrato, empresa, tipo${ehAditivo?'':', gestor'} ou objeto...`, state.filters[`busca-${qual}`])}
        <select class="filter-select" aria-label="Tipo" onchange="app.setFilter('tipo-${qual}', this.value)">
          <option value="">Todos os tipos</option>
          ${t.porTipo.map(x=>`<option value="${escAttr(x.nome)}" ${fTipo===x.nome?'selected':''}>${esc(x.nome)} (${x.n})</option>`).join('')}
        </select>
        <select class="filter-select" aria-label="Situação do contrato" onchange="app.setFilter('sit-${qual}', this.value)">
          <option value="">Contratos em vigência e encerrados</option>
          <option value="vigente" ${fSit==='vigente'?'selected':''}>Só de contratos em vigência</option>
          <option value="encerrado" ${fSit==='encerrado'?'selected':''}>Só de contratos encerrados</option>
        </select>
      </div>
      <div class="tabela-meta"><span><b>${filtrados.length}</b> de ${t.total} ${plural}${filtrando?` · ${limpar}`:''}</span></div>
      ${table(cabecalhos, rows, {pagina:true, vazio:`Nenhum ${cfg.singular.toLowerCase()} encontrado${filtrando?` · ${limpar}`:''}`})}
    </div>`;
}
// Declarações de função (não const): o VIEWS lá em cima as usa antes desta linha rodar.
function renderAditivos(){ return renderTermos('aditivos'); }
function renderApostilamentos(){ return renderTermos('apostilamentos'); }

/* Página do termo: os grupos do formulário "Cadastrar" do SGC. */
async function abrirTermo(qual, id){
  const cfg = TELA_TERMO[qual];
  const d = await garantirTermos(qual);
  const i = (d.itens||[]).find(x=>String(x.id)===String(id));
  if(!i) return false;
  const linha = (rotulo, valor, nota) => `<div class="detail-row"><span class="detail-label">${rotulo}</span><span class="detail-value">${valor==null||valor===''?'<span class="cel-vazia">—</span>':valor}${nota?`<div class="cel-sub">${nota}</div>`:''}</span></div>`;
  const secao = (titulo, conteudo) => `<div class="section-title">${titulo}</div><div class="detail-list">${conteudo}</div>`;
  const naoLido = 'não é lido dos documentos — confira no termo';

  const termo = [
    linha(`Número d${cfg.artigo} ${cfg.singular.toLowerCase()}`, i.numero ? `<b>${esc(i.numero)}</b>` : null),
    linha('Tipo', esc(i.tipo||'')),
    linha('Data de assinatura', i.data ? formatDate(i.data) : null, i.data ? 'No SGC: "Data do extrato" — a do extrato publicado, que costuma sair alguns dias depois.' : 'não lida no documento — confira o extrato publicado'),
    linha('Objeto', esc(i.objeto||''), i.objeto ? 'Trecho do próprio termo ("Fica ...").' : null),
    linha('Contrato', i.contratoId!=null ? `<a href="#/contrato/${i.contratoId}">${esc(i.contrato||'')}</a> ${seloSituacaoContrato(i.situacaoContrato)}` : esc(i.contrato||'')),
    linha('Empresa', esc(i.empresa||'')),
    linha('IOM', esc(i.iom||''), i.iom ? null : naoLido),
    linha('Portaria', esc(i.portaria||''), i.portaria ? null : naoLido)
  ].join('');
  const vigencia = (i.meses || qual==='aditivos') ? secao('Vigência', [
    linha('Prorrogação', i.meses ? efeitoNoPrazo(i) : null, i.meses ? null : 'este termo não prorroga o prazo'),
    linha('Nova data de término', i.novoTermino ? formatDate(i.novoTermino) : null, i.meses && !i.novoTermino ? 'não calculada — confira pela vigência do contrato' : null),
    linha('Término atual do contrato', i.terminoContrato ? formatDate(i.terminoContrato) : null)
  ].join('')) : '';
  const valores = secao('Valores', [
    linha(`Valor d${cfg.artigo} ${cfg.singular.toLowerCase()}`, i.valor!=null ? money(i.valor) : null, i.valor!=null ? 'Quanto o termo soma ao valor do contrato (efeito lido no cálculo da média mensal).' : 'este termo não muda o valor'),
    linha('Valor mensal do contrato (hoje)', i.valorMensalContrato!=null ? money(i.valorMensalContrato) : null),
    linha('Garantia', null, 'veja a apólice na visão do contrato')
  ].join(''));
  const gestao = (i.gestor || i.suplente || /gestor|suplente/i.test(i.tipo||'')) ? secao('Gestor e suplente', [
    linha('Gestor', esc(i.gestor||'')),
    linha('Suplente', esc(i.suplente||'')),
    linha('Data de designação', i.data ? formatDate(i.data) : null, i.data ? 'a data do termo' : null)
  ].join('')) : '';
  const arquivo = secao('Arquivo', [
    linha('Documento lido', i.documento ? esc(i.documento) : null),
    linha('Origem', i.origem==='Documento' ? `Lido do documento e aprovado na Fila de importação${i.lidoEm?` em ${dataHora(i.lidoEm,{dateStyle:'short'})}`:''}` : esc(i.origem),
      i.propostaId ? `<a href="#/leitura/${i.propostaId}">Ver a leitura do contrato na Base de dados</a>` : null)
  ].join(''));

  // Os outros termos do mesmo contrato, em ordem de data (aditivos e apostilamentos).
  const doContrato = [
    ...aditivos.filter(t=>String(t.contratoId)===String(i.contratoId)).map(t=>({ ...t, pagina:'aditivo', especie:'Aditivo' })),
    ...apostilamentos.filter(t=>String(t.contratoId)===String(i.contratoId)).map(t=>({ ...t, pagina:'apostilamento', especie:'Apostilamento' }))
  ].sort((a, b) => String(a.data||'9999').localeCompare(String(b.data||'9999')));
  const outros = doContrato.length > 1 ? `<div class="section-title">Termos deste contrato <span class="contagem">${doContrato.length}</span></div>
    ${table(['Espécie','Nº','Tipo','<th class="num">Assinatura</th>'], doContrato.map(t=>{ const este = t.pagina===cfg.pagina && String(t.id)===String(i.id);
      return `<tr class="${este?'':'linha-clicavel'}" ${este?'':`onclick="app.irPara('${t.pagina}', ${t.id})"`}><td>${t.especie}${este?' <span class="status-mini muted">este</span>':''}</td><td class="nowrap">${este?esc(t.numero||'—'):`<a href="#/${t.pagina}/${t.id}">${esc(t.numero||'—')}</a>`}</td><td>${esc(t.tipo||'—')}</td><td class="num nowrap">${formatDate(t.data)}</td></tr>`; }))}` : '';

  janela.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this) app.closeModal()">
      <div role="dialog" aria-modal="true" tabindex="-1" class="modal-card wide">
        <div class="modal-header"><h3>${cfg.singular} ${esc(i.numero||'sem número')} <span class="modal-sub">Contrato ${esc(i.contrato||'—')} · ${esc(i.empresa||'')}</span></h3><button type="button" class="icon-btn modal-fechar" aria-label="Fechar" title="Fechar (Esc)" onclick="app.closeModal()">${icon('close',16)}</button></div>
        ${secao(cfg.singular, termo)}
        ${vigencia}
        ${valores}
        ${gestao}
        ${arquivo}
        ${outros}
        <div class="modal-actions" style="margin-top:14px;">
          <button class="btn-ghost" onclick="app.closeModal()">Fechar</button>
          ${i.contratoId!=null ? `<button type="button" class="btn-ghost" onclick="app.irPara('contrato', ${i.contratoId})">${icon('doc',15)} Abrir o contrato</button>` : ''}
          <button type="button" class="btn-primary" onclick="app.abrirFichaSgc('termo/${cfg.pagina}/${i.id}')">${icon('file',15)} Ficha do SGC</button>
        </div>
      </div>
    </div>`;
}

/* No detalhe do contrato: os aditivos e apostilamentos dele, com link para a página de cada um. */
function termosDoContratoHtml(contratoId){
  const lista = [
    ...aditivos.filter(t=>String(t.contratoId)===String(contratoId)).map(t=>({ ...t, pagina:'aditivo', especie:'Aditivo' })),
    ...apostilamentos.filter(t=>String(t.contratoId)===String(contratoId)).map(t=>({ ...t, pagina:'apostilamento', especie:'Apostilamento' }))
  ].sort((a, b) => String(a.data||'9999').localeCompare(String(b.data||'9999')));
  if(!lista.length) return '';
  return `<div class="section-title">Aditivos e apostilamentos <span class="contagem">${lista.length}</span></div>
    ${table(['Espécie','Nº','Tipo','<th class="num">Assinatura</th>','<th class="num">Efeito</th>'], lista.map(t=>`<tr class="linha-clicavel" onclick="if(!event.target.closest('a'))app.irPara('${t.pagina}', ${Number(t.id)})">
      <td>${t.especie}</td><td class="nowrap"><a href="#/${t.pagina}/${Number(t.id)}">${esc(t.numero||'—')}</a></td><td>${esc(t.tipo||'—')}</td><td class="num nowrap">${formatDate(t.data)}</td>
      <td class="num nowrap">${[t.meses?`+${t.meses} meses`:'', t.valor!=null&&t.valor!==''?money(t.valor):'', t.gestor?`gestor: ${esc(t.gestor)}`:''].filter(Boolean).join(' · ') || '—'}</td></tr>`))}`;
}

function exportarTermosCSV(qual){
  const cfg = TELA_TERMO[qual];
  const lista = termosFiltrados(qual);
  downloadCSV(`${qual}-${hojeIsoLocal()}.csv`,
    ['Número','Contrato','Empresa','Tipo','Data de assinatura','Prorrogação (meses)','Nova data de término',`Valor d${cfg.artigo} ${cfg.singular.toLowerCase()}`,'Gestor','Suplente','Situação do contrato','Objeto','Documento lido'],
    lista.map(i=>[i.numero||'', i.contrato||'', i.empresa||'', i.tipo||'', csvData(i.data), i.meses||'', csvData(i.novoTermino), csvValor(i.valor), i.gestor||'', i.suplente||'',
      i.situacaoContrato==='vigente'?'Em vigência':i.situacaoContrato==='encerrado'?'Encerrado':'Contrato não encontrado', i.objeto||'', i.documento||''])
  );
  toast(`${lista.length} ${lista.length===1?cfg.singular.toLowerCase():cfg.titulo.toLowerCase()} exportado(s).`, 'success');
}

/* ===================== UFM E GRATIFICAÇÃO DOS GESTORES (GFE) =====================
   (06/10/2026) A planilha "cálculo de pag. GFE - Gestores de Contratos":
   valor mensal ÷ valor da UFM = valor em UFM; a faixa dá a gratificação
   por contrato. A tabela (UFM e faixas) tem histórico: cada alteração é
   uma versão nova, com a data em que vale e o ato. Ver integrations/ufm.js. */
let ufmDados = null;
let ufmCarregando = false;
function carregarUfm(){
  if(ufmCarregando) return;
  ufmCarregando = true;
  api.ufm().then(d=>{ ufmDados = d; ufmCarregando = false; if(state.view==='ufm') render(); })
    .catch(err=>{ ufmDados = { erro: err.message }; ufmCarregando = false; if(state.view==='ufm') render(); });
}
const CORES_FAIXA = ['muted','info','warn','err'];
function faixaUfm(versao, ufm){ const i = versao.faixas.findIndex(f=>f.ate==null || ufm < f.ate + 1); return i<0 ? versao.faixas.length-1 : i; }

function renderUfm(){
  if(ufmDados===null && !ufmCarregando) carregarUfm();
  const souAdmin = currentUser && currentUser.role==='admin';
  const cabecalho = `<div class="page-header">
      <div><h1 class="page-title">UFM e gratificação</h1><p class="page-subtitle">Valor de cada contrato em UFM e a gratificação do gestor (GFE)</p></div>
      <div class="row-actions" style="display:flex;gap:8px;flex-wrap:wrap;">
        <a class="btn-ghost" style="text-decoration:none;" href="/api/ufm/exportar" download>${icon('download',15)} Exportar planilha</a>
        ${souAdmin ? `<button type="button" class="btn-primary" onclick="app.registrarAlteracaoUfm()">${icon('plus',15)} Registrar alteração</button>` : ''}
      </div>
    </div>`;
  const d = ufmDados;
  if(!d) return cabecalho + `<div class="card">${esqueleto(6, 'Calculando a UFM dos contratos')}</div>`;
  if(d.erro) return cabecalho + `<div class="card"><div class="note-card">${esc(d.erro)}</div></div>`;
  const v = d.versao;

  const aba = state.filters['filtro-ufm'] || 'vigencia';
  const q = (state.filters['busca-ufm']||'').trim().toLowerCase();
  if(!state.filters['ordem-ufm']) state.filters['ordem-ufm'] = 'ufm:desc';
  const [ordChave, ordDir] = state.filters['ordem-ufm'].split(':');
  const vigentes = d.linhas.filter(l=>!l.encerrado);
  const conta = { vigencia: vigentes.length, encerrados: d.linhas.length - vigentes.length, todos: d.linhas.length };
  const chave = l => ({ numero: chaveDoNumero(l.numero), empresa: l.empresa, gestor: l.gestor, mensal: l.semValor?null:l.valorMensal, ufm: l.semValor?null:l.valorEmUfm, gratificacao: l.semValor?null:l.gratificacao })[ordChave];
  const lista = d.linhas
    .filter(l => aba==='todos' || (aba==='encerrados' ? l.encerrado : !l.encerrado))
    .filter(l => !q || [l.numero, l.empresa, l.gestor, l.suplente].join(' ').toLowerCase().includes(q))
    .slice().sort((a,b)=>compararValores(chave(a), chave(b), ordDir));
  const comValor = vigentes.filter(l=>!l.semValor);
  const totalMensal = comValor.reduce((t,l)=>t+l.gratificacao, 0);
  const semValor = vigentes.filter(l=>l.semValor).length;

  const linhas = lista.map(l=>{ const idx = contratos.findIndex(c=>String(c.id)===String(l.id)); return `<tr class="linha-clicavel" onclick="if(!event.target.closest('button,a'))app.viewContrato(${idx})">
      <td class="col-fixa-esq"><span class="cel-contrato-num">${esc(l.numero)}</span>${l.encerrado?'<div class="cel-sub">encerrado</div>':''}</td>
      <td><span class="celula-texto" title="${escAttr(l.empresa||'')}">${esc(l.empresa||'')}</span></td>
      <td>${esc(l.gestor||'—')}${l.suplente?`<div class="cel-sub">Suplente: ${esc(l.suplente)}</div>`:''}</td>
      ${l.semValor ? '<td class="num" colspan="4"><span class="cel-sub">sem valor mensal lido — confira em Pendências de leitura</span></td>' : `
      <td class="num nowrap">${money(l.valorMensal)}</td>
      <td class="num nowrap"><b>${numBr(l.valorEmUfm)}</b></td>
      <td><span class="status-mini ${CORES_FAIXA[l.faixa-1]||'muted'}">Faixa ${l.faixa}</span><div class="cel-sub">${esc(v.rotulos[l.faixa-1])} UFM</div></td>
      <td class="num nowrap"><b>${money(l.gratificacao)}</b></td>`}
    </tr>`; });

  const tabelaFaixas = v.faixas.map((f,i)=>`<tr>
      <td><span class="status-mini ${CORES_FAIXA[i]||'muted'}">Faixa ${i+1}</span></td>
      <td>${esc(v.rotulos[i])} UFM</td>
      <td class="nowrap">${f.ate==null ? `acima de ${money((v.faixas[i-1].ate+1)*v.valorUfm)}` : `até ${money((f.ate+1)*v.valorUfm - 0.01)}`}<div class="cel-sub">valor mensal do contrato</div></td>
      <td class="num">${f.percentual ? String(f.percentual).replace('.',',')+'%' : '—'}</td>
      <td class="num"><b>${money(f.valor)}</b></td>
      <td class="num">${f.limiteContratos || '—'}</td>
    </tr>`);

  const porGestor = d.porGestor.map(g=>`<tr>
      <td>${esc(g.gestor)}${g.acimaDoLimite.length?`<div><span class="status-mini warn" title="Mais contratos nesta faixa do que a coluna &quot;qtde contratos até&quot; da planilha">acima do limite na faixa ${g.acimaDoLimite.join(', ')}</span></div>`:''}</td>
      <td class="num">${g.contratos}</td>
      <td>${g.porFaixa.map((n,i)=>n?`<span class="tag">F${i+1}: ${n}</span>`:'').join(' ')}</td>
      <td class="num nowrap"><b>${money(g.total)}</b></td>
    </tr>`);

  const historico = d.versoes.map(h=>`<tr>
      <td class="nowrap">${h.vigenteDesde ? formatDate(h.vigenteDesde) : '<span class="cel-sub">valor inicial</span>'}<div>${h.situacao==='vigente'?'<span class="status-mini ok">vigente</span>':h.situacao==='agendada'?'<span class="status-mini info">agendada</span>':'<span class="status-mini muted">anterior</span>'}</div></td>
      <td class="num nowrap"><b>${reaisUfm(h.valorUfm)}</b></td>
      <td class="nowrap">${h.faixas.map((f,i)=>`<div class="cel-sub">F${i+1}: ${money(f.valor)}</div>`).join('')}</td>
      <td>${esc(h.fundamento||'—')}${h.observacao?`<div class="cel-sub">${esc(h.observacao)}</div>`:''}</td>
      <td>${esc(h.registradoPor||'—')}${h.registradoEm?`<div class="cel-sub">${new Date(h.registradoEm).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})}</div>`:''}</td>
    </tr>`);

  return cabecalho + `
    <div class="stat-grid">
      ${statCard('coin', COLORS.s1, reaisUfm(v.valorUfm), 'Valor da UFM', v.vigenteDesde ? `desde ${formatDate(v.vigenteDesde)}` : 'valor inicial (planilha)')}
      ${statCard('doc', COLORS.s7, comValor.length, 'Contratos com gratificação', semValor ? `${semValor} sem valor mensal` : 'contratos em vigência')}
      ${statCard('users', COLORS.s3, d.porGestor.length, 'Gestores')}
      ${statCard('chart', COLORS.good, money(totalMensal), 'Total mensal das gratificações', 'soma por contrato em vigência')}
    </div>
    ${ajuda('<b>Como a planilha calcula:</b> valor mensal do contrato = (contrato + aditivos) ÷ meses de vigência — o mesmo valor mensal que a Central mostra em Contratos. Valor em UFM = valor mensal ÷ valor da UFM. A faixa em que o valor em UFM cai dá a gratificação por contrato. <b>Alteração:</b> quando muda o valor da UFM (decreto) ou a tabela, use "Registrar alteração" com a data em que passa a valer e o ato — o valor anterior fica no histórico; nada se apaga. Uma alteração com data futura fica agendada e passa a valer sozinha no dia.')}
    <div class="card">
      <h2 class="card-title">Tabela vigente</h2><p class="card-subtitle">UFM = ${reaisUfm(v.valorUfm)} · ${esc(v.fundamento||'')}</p>
      ${table(['Faixa','Valor em UFM','Em reais','<th class="num">%</th>','<th class="num">Gratificação por contrato</th>','<th class="num">Limite de contratos por gestor</th>'], tabelaFaixas)}
      ${d.avisos.length ? `<div class="nota-tabela">${icon('bell',13)}<span>${d.avisos.map(a=>esc(a)).join(' ')}</span></div>` : ''}
    </div>
    <div class="card">
      <h2 class="card-title">Por contrato</h2>
      <div class="toolbar">
        ${searchBox('busca-ufm','Buscar por contrato, empresa ou gestor...', state.filters['busca-ufm'])}
        ${segmentos('filtro-ufm', [['vigencia','Em vigência',conta.vigencia],['encerrados','Encerrados',conta.encerrados],['todos','Todos',conta.todos]], aba, 'Situação do contrato')}
      </div>
      <div class="tabela-meta"><span><b>${lista.length}</b> contrato(s)</span></div>
      ${table([thOrdenavel('numero','Contrato','ordem-ufm','col-fixa-esq'), thOrdenavel('empresa','Empresa','ordem-ufm'), thOrdenavel('gestor','Gestor','ordem-ufm'),
        thOrdenavel('mensal','Valor mensal','ordem-ufm','num'), thOrdenavel('ufm','Valor em UFM','ordem-ufm','num'), '<th>Faixa</th>', thOrdenavel('gratificacao','Gratificação','ordem-ufm','num')], linhas, {pagina:true, vazio:'Nenhum contrato neste filtro'})}
    </div>
    <div>
      <div class="card">
        <h2 class="card-title">Por gestor</h2><p class="card-subtitle">Contratos em vigência com valor mensal; total mensal das gratificações</p>
        ${table(['Gestor','<th class="num">Contratos</th>','Por faixa','<th class="num">Total mensal</th>'], porGestor, {vazio:'Nenhum contrato em vigência com valor mensal'})}
      </div>
      <div class="card">
        <h2 class="card-title">Histórico de alterações</h2><p class="card-subtitle">Cada valor da UFM e da tabela, com a data em que vale, o ato e quem registrou — nada se apaga</p>
        ${table(['Vale desde','<th class="num">UFM</th>','Gratificações','Ato / observação','Registrado por'], historico)}
      </div>
    </div>`;
}

/* Registrar alteração da UFM e/ou das faixas: vira uma versão nova. Mostra,
   antes de salvar, o efeito nos contratos em vigência. */
function registrarAlteracaoUfm(){
  const d = ufmDados; if(!d || d.erro) return;
  const v = d.versao;
  const linhaFaixa = (f,i) => `<tr>
      <td><b>Faixa ${i+1}</b></td>
      <td>${i===v.faixas.length-1 ? '<span class="cel-sub">acima da anterior</span>' : `<input type="number" name="ate${i}" min="1" step="1" value="${f.ate}" aria-label="Faixa ${i+1}: até quantas UFM" class="ufm-num">`}</td>
      <td><input type="text" inputmode="decimal" name="pct${i}" value="${String(f.percentual).replace('.',',')}" aria-label="Faixa ${i+1}: percentual" class="ufm-num"></td>
      <td><input type="text" inputmode="decimal" name="valor${i}" value="${f.valor.toFixed(2).replace('.',',')}" aria-label="Faixa ${i+1}: gratificação em reais" class="ufm-num" required></td>
      <td><input type="number" name="lim${i}" min="0" step="1" value="${f.limiteContratos||''}" aria-label="Faixa ${i+1}: limite de contratos por gestor" class="ufm-num"></td>
    </tr>`;
  modalRoot.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this) app.closeModal()">
      <div role="dialog" aria-modal="true" tabindex="-1" class="modal-card wide">
        <div class="modal-header"><h3>Registrar alteração da UFM</h3><button type="button" class="icon-btn modal-fechar" aria-label="Fechar" title="Fechar (Esc)" onclick="app.closeModal()">${icon('close',16)}</button></div>
        <p style="font-size:13px;color:var(--text-muted);margin:-4px 0 14px;">Vira uma versão nova da tabela, a partir da data informada. A atual (UFM ${reaisUfm(v.valorUfm)}) continua no histórico. Mude só o que mudou.</p>
        <form id="form-ufm">
          <div class="ufm-topo">
            <label class="field"><span>Valor da UFM (R$)</span><input type="text" inputmode="decimal" name="valorUfm" value="${String(v.valorUfm).replace('.',',')}" required></label>
            <label class="field"><span>Vale a partir de</span><input type="date" name="vigenteDesde" value="${hojeIso()}" required></label>
          </div>
          <label class="field"><span>Ato que fundamenta</span><input type="text" name="fundamento" required placeholder="Ex.: Decreto nº 12.345, de 02/01/2027 (atualização anual da UFM)"></label>
          <label class="field"><span>Observação (opcional)</span><input type="text" name="observacao"></label>
          <div class="section-title" style="margin-top:4px;">Faixas</div>
          <div class="table-wrap"><table><thead><tr><th>Faixa</th><th>Até (UFM)</th><th>%</th><th>Gratificação (R$)</th><th>Limite por gestor</th></tr></thead><tbody>${v.faixas.map(linhaFaixa).join('')}</tbody></table></div>
          <div id="ufm-previa" class="note-card" style="margin-top:12px;" aria-live="polite"></div>
          <div class="modal-actions"><button type="button" class="btn-ghost" onclick="app.closeModal()">Cancelar</button><button type="submit" class="btn-primary" id="ufm-salvar">Registrar alteração</button></div>
        </form>
      </div>
    </div>`;
  const form = document.getElementById('form-ufm');
  const dec = x => { let t = String(x||'').trim(); if(t.includes(',')) t = t.replace(/\./g,'').replace(',','.'); return Number(t); };
  const lerFaixas = () => v.faixas.map((f,i)=>({ ate: i===v.faixas.length-1 ? null : Number(form['ate'+i].value), percentual: dec(form['pct'+i].value), valor: dec(form['valor'+i].value), limiteContratos: Number(form['lim'+i].value)||null }));
  const previa = () => {
    const nova = { valorUfm: dec(form.valorUfm.value), faixas: lerFaixas() };
    const alvo = document.getElementById('ufm-previa');
    if(!(nova.valorUfm>0) || nova.faixas.some(f=>!(f.valor>0))){ alvo.textContent = 'Preencha o valor da UFM e as gratificações para ver o efeito.'; return; }
    const vig = d.linhas.filter(l=>!l.encerrado && !l.semValor);
    let mudam = 0, total = 0;
    for(const l of vig){ const i = faixaUfm(nova, l.valorMensal / nova.valorUfm); if(i+1 !== l.faixa) mudam++; total += nova.faixas[i].valor; }
    const atual = vig.reduce((t,l)=>t+l.gratificacao,0);
    alvo.innerHTML = `Com estes valores: <b>${mudam}</b> contrato(s) mudam de faixa; o total mensal das gratificações passa de <b>${money(atual)}</b> para <b>${money(total)}</b>.`;
  };
  form.addEventListener('input', previa); previa();
  form.addEventListener('submit', async e=>{
    e.preventDefault();
    const btn = document.getElementById('ufm-salvar'); btn.disabled = true; btn.textContent = 'Registrando...';
    try{
      const corpo = { valorUfm: form.valorUfm.value, vigenteDesde: form.vigenteDesde.value, fundamento: form.fundamento.value, observacao: form.observacao.value, faixas: lerFaixas() };
      ufmDados = await api.registrarVersaoUfm(corpo);
      app.closeModal(); render();
      toast(corpo.vigenteDesde > hojeIso() ? `Alteração agendada para ${formatDate(corpo.vigenteDesde)} — até lá, vale a tabela atual.` : 'Alteração registrada — a anterior ficou no histórico.', 'success');
    }catch(err){ toast(err.message, 'error'); btn.disabled = false; btn.textContent = 'Registrar alteração'; }
  });
}

/* ===================== HISTÓRICO ADMINISTRATIVO DO CONTRATO =====================
   (06/10/2026) Solicitações do TCE e dos diretores, ofícios, despachos,
   notificações, reuniões e tratativas — e o que a Central lê das pastas
   (aditivos, apostilamentos, requisições). Nada se apaga: correção guarda a
   versão anterior. Ver integrations/historicoContrato.js. */
function podeAlterarPrazos(){ return !!currentUser && ['admin','gestor'].includes(currentUser.role); }
function textoDosPrazos(c){
  const f = faixasDe(c);
  const nome = faixasContrato[c.id] ? f.nome : 'Padrão';
  return `<b>${esc(nome)}</b> — crítico ≤ ${f.critico}, atenção ≤ ${f.atencao}, próximo ≤ ${f.proximo} dias${faixasContrato[c.id] && f.motivo ? `<div class="cel-sub">${esc(f.motivo)}${f.definidoPor?` · ${esc(f.definidoPor)}`:''}</div>` : ''}`;
}

const HIST_ICONE = { solicitacao_tce:['bell','var(--critical)'], solicitacao_diretor:['users','var(--s7, #4a3aa7)'], oficio_recebido:['inbox','var(--primary)'], oficio_enviado:['doc','var(--primary)'], despacho:['stamp','#555'],
  notificacao_contratada:['shield','var(--warn)'], reuniao:['users','#555'], tratativa:['edit','#4a3aa7'], outro:['doc','#555'], aditivo:['doc','var(--primary)'], apostilamento:['stamp','#c2571d'], requisicao_tce:['bell','#8a5a00'], requisicao_sisfin:['coin','#8a5a00'] };
const CLASSE_SITUACAO = { aberta:'warn', respondida:'ok', concluida:'ok', informativo:'muted' };

function itemDoHistoricoHtml(i){
  const [ic, cor] = HIST_ICONE[i.tipo] || ['doc','#555'];
  const atraso = i.situacao==='aberta' && i.prazoResposta && i.prazoResposta < hojeIso();
  const meta = [i.solicitante && `Solicitante: ${esc(i.solicitante)}`, i.documento && esc(i.documento), i.prazoResposta && `prazo ${formatDate(i.prazoResposta)}`, i.respondidoEm && `respondido em ${formatDate(i.respondidoEm)}`].filter(Boolean).join(' · ');
  const versoes = (i.versoes||[]).length ? `<details class="hist-versoes"><summary>Correções (${i.versoes.length})</summary><ul>${i.versoes.slice().reverse().map(v=>`<li><b>${dataHora(v.alteradoEm,{dateStyle:'short',timeStyle:'short'})}</b> · ${esc(v.alteradoPor)} — ${esc(v.motivo||'')}<div class="cel-sub">Antes: ${(v.campos||[]).map(k=>`${({descricao:'descrição',prazoResposta:'prazo',respondidoEm:'respondido em',situacao:'situação'})[k]||k}: ${esc(k==='situacao'?(HIST_SITUACOES[v[k]]||v[k]):k==='tipo'?(HIST_TIPOS[v[k]]||v[k]):/^\d{4}-\d{2}-\d{2}$/.test(v[k]||'')?formatDate(v[k]):(v[k]||'—'))}`).join(' · ')}</div></li>`).join('')}</ul></details>` : '';
  const acoes = i.origem==='registro' && podeEscrever() ? `<div class="hist-acoes">
      ${i.situacao==='aberta' ? `<button type="button" class="btn-ghost btn-small" onclick="app.marcarHistorico(${i.id},'respondida',${i.contratoId})">${icon('check',13)} Marcar como respondida</button>` : ''}
      <button type="button" class="btn-ghost btn-small" onclick="app.corrigirNoHistorico(${i.id},${i.contratoId})">${icon('edit',13)} Corrigir</button></div>` : '';
  return `<div class="timeline-item">
      <span class="timeline-icon" style="background:${cor}">${icon(ic,13)}</span>
      <div class="timeline-body">
        <div class="timeline-title">${esc(i.tipoRotulo)}${i.origem==='pasta'?' <span class="tag">lido da pasta</span>':''}${i.situacaoRotulo && i.situacao!=='informativo'?` <span class="status-mini ${atraso?'err':CLASSE_SITUACAO[i.situacao]||'muted'}">${atraso?'Atrasado':esc(i.situacaoRotulo)}</span>`:''}</div>
        <div class="hist-descricao">${esc(i.descricao||'')}</div>
        ${meta?`<div class="timeline-meta">${meta}</div>`:''}
        ${i.arquivo?`<div class="timeline-meta">${esc(i.arquivo)} ${botaoCopiarCaminho(i.arquivo, 'Copiar o caminho do documento')}</div>`:''}
        ${i.registradoPor?`<div class="timeline-meta">Registrado por ${esc(i.registradoPor)} em ${dataHora(i.registradoEm,{dateStyle:'short',timeStyle:'short'})}</div>`:''}
        ${versoes}${acoes}
      </div>
      <div class="timeline-date">${i.data?formatDate(i.data):'—'}</div>
    </div>`;
}

function historicoHtml(h){
  const exportar = `<div class="hist-topo"><span class="cel-sub">${h.itens.length} evento(s)${h.abertos?` · <b>${h.abertos} em aberto</b>`:''}</span>
    <span class="hist-exportar"><a class="btn-ghost btn-small" style="text-decoration:none;" href="/api/contratos/${h.contrato.id}/historico/exportar?formato=pdf" download>${icon('download',13)} PDF</a>
    <a class="btn-ghost btn-small" style="text-decoration:none;" href="/api/contratos/${h.contrato.id}/historico/exportar" download>${icon('download',13)} Planilha</a></span></div>`;
  return exportar + (h.itens.length ? `<div class="timeline">${h.itens.map(itemDoHistoricoHtml).join('')}</div>`
    : '<div class="related-empty">Nada registrado ainda. Use "Registrar no histórico" para anotar solicitações do TCE e dos diretores, ofícios, despachos e tratativas.</div>');
}

async function carregarHistoricoNoAlvo(contratoId, alvoId){
  let h;
  try{ h = await api.historico(contratoId); }
  catch(err){ const a = document.getElementById(alvoId); if(a) a.innerHTML = `<div class="note-card">${esc(err.message)}</div>`; return; }
  const alvo = document.getElementById(alvoId);
  if(alvo) alvo.innerHTML = historicoHtml(h);
}

const chaveDe = (mapa, rotulo) => (Object.entries(mapa).find(([,r])=>r===rotulo) || [''])[0];
function camposDoHistorico(it){
  return [
    {name:'tipo', label:'Tipo', type:'select', options:Object.values(HIST_TIPOS), required:true, value: it ? HIST_TIPOS[it.tipo] : undefined},
    {name:'data', label:'Data', type:'date', required:true, value: it ? it.data : hojeIso()},
    {name:'solicitante', label:'Quem solicitou / de quem veio', value: it && it.solicitante, hint:'Ex.: TCE-SP, Diretor de Infraestrutura, Procuradoria.'},
    {name:'documento', label:'Nº do documento ou processo', value: it && it.documento, hint:'Ex.: Ofício 123/2026, TC-000123.989.26.'},
    {name:'descricao', label:'O que aconteceu ou o que foi pedido', type:'textarea', required:true, value: it && it.descricao},
    {name:'prazoResposta', label:'Prazo de resposta', type:'date', value: it && it.prazoResposta, hint:'Com prazo, o registro fica em aberto e aparece no Início quando faltar 5 dias ou atrasar.'},
    {name:'situacao', label:'Situação', type:'select', options:Object.values(HIST_SITUACOES), value: it ? HIST_SITUACOES[it.situacao] : undefined, hint: it ? '' : 'Sem escolher: solicitação ou registro com prazo fica "Em aberto"; o resto, "Só registro".'},
    {name:'arquivo', label:'Documento na pasta de rede (opcional)', value: it && it.arquivo, hint:'O caminho completo, como aparece no Explorer (Shift + clique direito → Copiar como caminho).'}
  ];
}
function dadosDoFormulario(d){
  const r = { ...d, tipo: chaveDe(HIST_TIPOS, d.tipo) };
  if(d.situacao) r.situacao = chaveDe(HIST_SITUACOES, d.situacao); else delete r.situacao;
  if(r.arquivo) r.arquivo = r.arquivo.trim().replace(/^"(.*)"$/, '$1');
  return r;
}
function depoisDeGravarNoHistorico(resp, contratoId){
  historicoPendentes = resp.pendentes || historicoPendentes;
  historicoResumo = resp.resumo || historicoResumo;
  // Na página do contrato, o render() do formulário já atualizou o histórico; de fora, abre a página.
  if(!(state.view==='contrato' && String(state.param)===String(contratoId))){ rolarParaAoMontar = 'historico-contrato'; irPara('contrato', contratoId); }
}

function registrarNoHistorico(contratoId, preset){
  const c = contratos.find(x=>String(x.id)===String(contratoId)); if(!c) return;
  let resp;
  openForm(`Registrar no histórico — ${esc(c.numero)}`, camposDoHistorico(preset || null), async d=>{
    resp = await api.registrarHistorico(c.id, dadosDoFormulario(d));
  }, { successMessage:'Registrado no histórico do contrato.', wide:true, onSuccess:()=>depoisDeGravarNoHistorico(resp, c.id),
       intro:'Fica no histórico do contrato com o seu nome e a hora. Não se apaga: se precisar, use "Corrigir" — a versão anterior continua visível.' });
}
// Compatibilidade: o antigo "Registrar tratativa" abre o histórico com o tipo já escolhido.
function registrarTratativa(contratoId){ registrarNoHistorico(contratoId, { tipo:'tratativa' }); }

async function corrigirNoHistorico(id, contratoId){
  let h; try{ h = await api.historico(contratoId); }catch(err){ toast(err.message,'error'); return; }
  const it = h.itens.find(x=>x.origem==='registro' && x.id===id); if(!it) return;
  let resp;
  openForm(`Corrigir registro — ${esc(HIST_TIPOS[it.tipo]||'')}`, [...camposDoHistorico(it),
    {name:'motivo', label:'Motivo da correção', type:'textarea', hint:'Obrigatório para mudar o conteúdo. A versão anterior continua no histórico.'}], async d=>{
    resp = await api.corrigirHistorico(id, dadosDoFormulario(d));
  }, { submitLabel:'Salvar correção', successMessage:'Correção registrada — a versão anterior ficou guardada.', wide:true, onSuccess:()=>depoisDeGravarNoHistorico(resp, contratoId) });
}
async function marcarHistorico(id, situacao, contratoId){
  try{
    const resp = await api.corrigirHistorico(id, { situacao });
    historicoPendentes = resp.pendentes || historicoPendentes;
    historicoResumo = resp.resumo || historicoResumo;
    render();
    toast('Marcado como respondido.', 'success');
    if(document.getElementById('historico-contrato')) carregarHistoricoNoAlvo(contratoId, 'historico-contrato');
  }catch(err){ toast(err.message, 'error'); }
}

/* ---------- Prazos de alerta do contrato (perfil de trâmite) ---------- */
function alterarPrazosContrato(contratoId){
  const c = contratos.find(x=>String(x.id)===String(contratoId)); if(!c) return;
  const atual = faixasContrato[c.id];
  const escolhido = !atual ? 'padrao' : atual.origem==='proprio' ? 'proprio' : atual.perfilId;
  const f = faixasDe(c);
  const opcoes = [...perfisPrazo.perfis.map(p=>[p.id, `${p.nome} — ${p.critico} / ${p.atencao} / ${p.proximo} dias`]), ['proprio','Prazos próprios deste contrato']];
  modalRoot.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this) app.closeModal()">
      <div role="dialog" aria-modal="true" tabindex="-1" class="modal-card">
        <div class="modal-header"><h3>Prazos de alerta — ${esc(c.numero)}</h3><button type="button" class="icon-btn modal-fechar" aria-label="Fechar" title="Fechar (Esc)" onclick="app.closeModal()">${icon('close',16)}</button></div>
        <p style="font-size:13px;color:var(--text-muted);margin:-4px 0 14px;">Quando este contrato entra em Crítico, Atenção e Próximo (dias antes do término). Use o perfil do trâmite que a renovação dele exige.</p>
        <form id="form-prazos">
          <label class="field"><span>Perfil de trâmite</span><select name="perfilId">${opcoes.map(([v,r])=>`<option value="${escAttr(v)}" ${v===escolhido?'selected':''}>${esc(r)}</option>`).join('')}</select></label>
          <fieldset id="prazos-proprios" class="prazos-proprios" ${escolhido==='proprio'?'':'disabled hidden'}>
            <legend>Prazos próprios (dias antes do término)</legend>
            <label class="field"><span>Crítico</span><input type="number" name="critico" min="1" max="3650" value="${f.critico}"></label>
            <label class="field"><span>Atenção</span><input type="number" name="atencao" min="1" max="3650" value="${f.atencao}"></label>
            <label class="field"><span>Próximo</span><input type="number" name="proximo" min="1" max="3650" value="${f.proximo}"></label>
          </fieldset>
          <label class="field"><span>Motivo</span><textarea name="motivo" placeholder="Ex.: renovação depende de nova licitação, que leva cerca de 8 meses">${esc((atual&&atual.motivo)||'')}</textarea></label>
          <div class="modal-actions"><button type="button" class="btn-ghost" onclick="app.closeModal()">Cancelar</button><button type="submit" class="btn-primary" id="prazos-salvar">Salvar</button></div>
        </form>
      </div>
    </div>`;
  const form = document.getElementById('form-prazos');
  form.perfilId.addEventListener('change', ()=>{ const fs_ = document.getElementById('prazos-proprios'); const p = form.perfilId.value==='proprio'; fs_.hidden = !p; fs_.disabled = !p; });
  form.addEventListener('submit', async e=>{
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form).entries());
    const btn = document.getElementById('prazos-salvar'); btn.disabled = true; btn.textContent = 'Salvando...';
    try{
      const r = await api.definirPrazosContrato(c.id, d);
      aplicarRespostaDosPrazos(r);
      app.closeModal(); toast(`Prazos de ${c.numero}: ${r.faixas.nome}.`, 'success'); render();
      render();
    }catch(err){ toast(err.message, 'error'); btn.disabled = false; btn.textContent = 'Salvar'; }
  });
}
function aplicarRespostaDosPrazos(r){
  if(r.perfis) perfisPrazo = { perfis:r.perfis, contratosComPrazoProprio:r.contratosComPrazoProprio||0 };
  if(r.faixasContrato) faixasContrato = r.faixasContrato;
  if(r.alertaConfig) alertaConfig = r.alertaConfig;
}

/* ===================== ONBOARDING / OFFBOARDING — CRUD ===================== */


/* ===================== CSV EXPORT ===================== */
/* O mesmo formato das exportações do servidor (integrations/planilhaCsv.js):
   célula que começa com = + - @ vira texto (senão o Excel executa como
   fórmula), data dd/mm/aaaa e valor com vírgula decimal — o Excel em
   português lia "562494.58" errado. */
function toCSVValue(v){
  let s = v===undefined||v===null ? '' : String(v).replace(/\r?\n/g,' ');
  if(/^[=+\-@\t\r]/.test(s)) s = "'"+s;
  return /[";]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
}
const csvData = iso => { const m = String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso||''); };
const csvValor = n => (n===undefined||n===null||n==='') ? '' : (Number.isFinite(Number(n)) ? Number(n).toFixed(2).replace('.',',') : String(n));
function downloadCSV(filename, headers, rows){
  const lines = [headers.map(toCSVValue).join(';')].concat(rows.map(r=>r.map(toCSVValue).join(';')));
  const blob = new Blob(['﻿'+lines.join('\r\n')+'\r\n'], { type:'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
function exportContratosCSV(){
  const q = (state.filters['search-contratos']||'').toLowerCase();
  const fBand = state.filters['filter-band-contratos']||'';
  const fTipo = state.filters['filter-tipo-contratos']||'';
  const filtered = contratos
    .filter(c=>(c.numero+c.empresa+c.tipo+c.responsavel).toLowerCase().includes(q))
    .filter(c=> !fBand || classificarContrato(c)===fBand)
    .filter(c=> !fTipo || c.tipo===fTipo);
  downloadCSV(`contratos-${hojeIsoLocal()}.csv`,
    ['Número','Empresa','CNPJ','Secretaria','Tipo','Modalidade','PA','Situação','Início','Término','Valor mensal','Valor total','Responsável','Suplente','E-mail do responsável'],
    filtered.map(c=>[c.numero,c.empresa,c.cnpjEmpresa||'',c.secretaria||'',c.tipo,c.tipoContratacao||'',c.pa||'',classificarContrato(c),csvData(c.inicio),csvData(c.termino),csvValor(c.valor),csvValor(valorTotalDe(c)),c.responsavel||'',c.suplente||'',c.emailResponsavel||''])
  );
  toast(`${filtered.length} contrato(s) exportado(s).`, 'success');
}


/* ===================== PUBLIC APP OBJECT ===================== */
window.app = {
  voltar, irPara,
  setView(id){ state.view=id; if(id==='integracoes'){ integracaoStatus=null; alertaEmailStatus=null; } if(id==='importacoes'){ arquivosStatus=null; importacoesCarregadas=false; fichasCadastroDados=null; } if(id==='mapaRisco'){ mapasRiscoDados=null; } if(id==='requisicoes'){ requisicoesDados=null; } if(id==='relatoriosMensais'){ relatoriosDados=null; } if(id==='ufm'){ ufmDados=null; } if(id==='leiturasReportadas'){ leiturasDados=null; } if(id==='baseContratos'){ baseContratosDados=null; } if(id==='conferenciaSgc'){ conferenciaSgcDados=null; } if(id==='aditivos' || id==='apostilamentos'){ termosDados[id]=null; } toggleSidebar(false); irPara(id); },
  sincronizarContratosApi,
  varrerArquivosAgora, abrirAprovacaoImportacao, abrirRejeicaoImportacao, aprovarImportacaoDireto, selecionarProposta,
  togglePainelManual, navegarPastaManual, irParaBreadcrumbManual,
  toggleSelecionarArquivoManual, extrairSelecionadosManual,
  irParaCaminhoColado, teclaCaminhoColado, arquivosEscolhidosManual, soltarNoPainelManual, arrastandoSobrePainelManual,
  escolherCandidatoAmbiguo, descartarAvisosManual, limparSelecionadosManual,
  gerarOuAtualizarMapaRisco, atualizarTodosMapasRisco, abrirDetalheMapaRisco,
  lerRequisicoes: lerRequisicoesAgora, abrirRequisicao, conferirRequisicao, decidirRequisicao,
  buscarNosDocumentos, reportarLeitura, resolverLeitura, abrirFichaSgc,
  lerRelatoriosMensais: lerRelatoriosMensaisAgora, abrirRelatoriosDoProcesso, alternarNaoExigeRelatorio, lerIndicadoresRelatorios,
  registrarRespostaTce, decidirMudanca,
  copiarCaminho, escolherArquivoRequisicao, enviarRequisicaoParaAnalise, abrirAnaliseRequisicao, trocarProcessoAnalise, removerAnaliseRequisicao,
  gerarFichaCadastro, abrirDetalheFichaCadastro, abrirDetalheBase, recalcularPropostas,
  abrirPendencia, salvarPendencia, decidirEncerramento,
  abrirRegistroRiscos, fecharRegistroRiscos, formRisco, formProblema, atualizarCategorias, voltarAoRegistro,
  abrirDetalheConferencia,
  reconferirSgc(){ conferenciaSgcDados = null; carregarConferenciaSgc(); render(); },
  setFilter(id,val){ state.filters[id]=val; render(); },
  limparFiltros(ids){ ids.forEach(id=>{ delete state.filters[id]; }); render(); },
  goToBand(band){ state.view='contratos'; state.filters['filter-band-contratos']=band; toggleSidebar(false); render(); },
  toggleSidebar, recolherMenu, logout, alternarGrupoDoMenu,
  viewContrato,
  registrarAlteracaoUfm,
  registrarTratativa, registrarNoHistorico, corrigirNoHistorico, marcarHistorico, alterarPrazosContrato, editarPerfilPrazo, excluirPerfilPrazo,
  exportContratosCSV, exportarTermosCSV, closeModal, __resolveConfirm: resolveConfirmDialog,
  newConta, editConta, deleteConta, liberarPedidoAcesso, dispensarPedidoAcesso,
  buscaGlobal, fecharBuscaGlobal,
  criarComentario, excluirComentario,
  enviarResumoAlertasAgora
};

/* Pontos de entrada das páginas de detalhe: os botões e linhas da Central
   chamam app.viewContrato(i), app.abrirRequisicao(i)... e vão para a página. */
Object.assign(window.app, {
  viewContrato: idx => { const c = contratos[idx]; if(c) irPara('contrato', c.id); },
  openHistorico: id => { rolarParaAoMontar = 'historico-contrato'; irPara('contrato', id); },
  abrirDetalheBase: id => irPara('leitura', id),
  abrirDetalheMapaRisco: id => irPara('analise-risco', id),
  abrirRegistroRiscos: id => irPara('registro-riscos', id),
  abrirRequisicao: i => { const g = requisicoesNaTela[i]; if(g) irPara('requisicao', idCurto(g.chave)); },
  abrirAnaliseRequisicao: id => irPara('analise-requisicao', id),
  abrirRelatoriosDoProcesso: i => { const r = relatoriosNaTela[i]; if(r) irPara('relatorios-processo', idCurto(r.caminho)); },
  abrirDetalheConferencia: id => irPara('conferencia', id)
});

/* ===================== LOGIN ===================== */
/* MODO DE TESTE (pedido do usuário em 22/09/2026): login já preenchido
   com a conta padrão. Desde 30/09/2026 quem decide é o SERVIDOR
   (/api/login-config): só nesta máquina, só enquanto a senha padrão está
   ativa, e LOGIN_PREENCHIDO_EM_TESTE=0 no .env desliga. A senha deixou
   de estar escrita aqui — este arquivo é público para quem abre a página. */
/* Retorno do login pela conta da Prefeitura (/auth/entra/retorno manda só
   um código; o texto fica aqui). */
const MENSAGENS_LOGIN = {
  'sem-acesso': 'Sua conta da Prefeitura ainda não tem acesso à Central de Contratos. O pedido já aparece para o administrador em Contas de acesso — você poderá entrar assim que ele liberar.',
  'cancelado': 'O login com a conta da Prefeitura foi cancelado.',
  'expirou': 'O login demorou demais ou foi aberto em outra aba. Tente de novo.',
  'falhou': 'Não foi possível confirmar o login com a Microsoft. Tente de novo; se continuar, avise o administrador.',
  'desligado': 'O login com a conta da Prefeitura não está ligado neste servidor. Use o usuário e a senha da Central.'
};
function mountLogin(message){
  const codigo = new URLSearchParams(location.search).get('login');
  if(codigo){
    if(!message && MENSAGENS_LOGIN[codigo]) message = MENSAGENS_LOGIN[codigo];
    try{ history.replaceState(null, '', location.pathname); }catch(e){}
  }
  document.getElementById('app-root').innerHTML = `
    <div class="login-screen">
      <section class="login-marca" aria-label="Central de Contratos">
        <img class="login-logo" src="img/logo.svg" alt="Central de Contratos" width="400" height="100">
        <div class="login-marca-texto">
          <span class="login-selo">Equipe de Tecnologia</span>
          <h2>Central de Contratos</h2>
          <p>Ferramentas de gestão de contratos da Secretaria Municipal de Tecnologia.</p>
        </div>
        <div class="login-rodape">© ${new Date().getFullYear()} Central de Contratos</div>
      </section>
      <main class="login-lado">
      <div class="login-card">
        <h1 class="login-titulo">Bem-vindo</h1><p id="login-instrucao" class="login-instrucao">Use a conta de acesso fornecida pelo administrador.</p>
        ${message?`<div class="note-card" role="alert" style="margin-bottom:14px;">${message}</div>`:''}
        <div id="login-entra" hidden>
          <a class="btn-primary btn-entra" href="/auth/entra/entrar">${icon('users',16)} Entrar com conta institucional</a>
          <div class="login-ou"><span>ou com usuário e senha da Central</span></div>
        </div>
        <form id="login-form">
          <label class="field"><span>Usuário</span><input type="text" name="usuario" required autofocus autocomplete="username"></label>
          <label class="field"><span>Senha</span><input type="password" name="senha" required autocomplete="current-password"></label>
          <div id="login-error" class="login-error" hidden></div>
          <button type="submit" class="btn-primary" id="login-submit" style="width:100%;justify-content:center;margin-top:4px;">${icon('lock',15)} Entrar</button>
        </form>
        <div class="login-hint" id="login-hint">Esqueceu a senha ou não tem acesso? Fale com o administrador da Central de Contratos.</div>
      </div>
      </main>
    </div>`;
  document.getElementById('login-form').addEventListener('submit', async function(e){
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    const btn = document.getElementById('login-submit');
    const errBox = document.getElementById('login-error');
    errBox.hidden = true;
    btn.disabled = true; btn.textContent = 'Entrando...';
    try{
      currentUser = await api.login(data.usuario, data.senha);
      await loadDataAndMount();
    }catch(err){
      errBox.hidden = false; errBox.textContent = err.message || 'Falha ao entrar.';
      btn.disabled = false; btn.innerHTML = `${icon('lock',15)} Entrar`;
    }
  });
  fetch('/api/login-config').then(r=>r.ok?r.json():null).then(c=>{
    if(c && c.entra){
      // Com o Entra ID ligado, a conta da Prefeitura é o caminho principal;
      // usuário e senha ficam para as contas locais (emergência).
      const bloco = document.getElementById('login-entra'), f = document.getElementById('login-form');
      if(bloco) bloco.hidden = false;
      const instrucao = document.getElementById('login-instrucao');
      if(instrucao) instrucao.textContent = 'Faça login com sua conta institucional para continuar — a mesma do e-mail e do Teams.';
      const btn = document.getElementById('login-submit');
      if(btn){ btn.classList.remove('btn-primary'); btn.classList.add('btn-ghost'); }
      if(f && document.activeElement===f.usuario && !f.usuario.value){ const a = bloco && bloco.querySelector('a'); if(a) a.focus(); }
    }
    if(!c || !c.preencher) return;
    const f = document.getElementById('login-form');
    if(!f || f.usuario.value || f.senha.value) return; // quem já começou a digitar não é atropelado
    f.usuario.value = c.usuario; f.senha.value = c.senha;
    const dica = document.getElementById('login-hint');
    if(dica) dica.textContent = 'Modo de teste: conta padrão já preenchida (só neste computador, enquanto a senha padrão não for trocada).';
  }).catch(()=>{});
}

async function logout(){
  await api.logout();
  currentUser = null;
  mountLogin();
}

aoExpirarSessao(() => mountLogin('Sua sessão expirou. Faça login novamente.'));

/* ===================== BOOT ===================== */
async function loadDataAndMount(){
  const data = await api.bootstrap();
  // Para o contador de pendências do menu antes de a Fila ser aberta.
  window.__importacoesIniciais = data.importacoesPendentes || [];
  contratos = data.contratos || [];
  riscosPorContrato = data.riscos || {};
  respostasTce = data.respostasTce || [];
  alertaConfig = data.alertaConfig || alertaConfig;
  perfisPrazo = data.perfisPrazo || perfisPrazo;
  faixasContrato = data.faixasContrato || {};
  historicoPendentes = data.historicoPendentes || [];
  historicoResumo = data.historicoResumo || {};
  valoresTotais = data.valoresTotais || {};
  mudancasPendentes = data.mudancasPendentes || [];
  aditivos = data.aditivos || [];
  apostilamentos = data.apostilamentos || [];
  if(data.meta){
    TIPOS_SERVICO = data.meta.tiposServico || TIPOS_SERVICO;
    SECRETARIAS_NOMES = data.meta.secretarias || SECRETARIAS_NOMES;
    PAPEIS = data.meta.papeis || PAPEIS;
    if(data.meta.hoje){ const [y,m,d]=data.meta.hoje.split('-').map(Number); TODAY = new Date(y,m-1,d); }
    window.__sgcDesligado = !!data.meta.sgcDesligado;
  }
  mountShell();
  const r = lerHash();
  if(r){ state.view = r.view; state.param = r.param; }
  else history.replaceState(null, '', hashDe(state.view));
  registrarRota(location.hash);
  render();
}

async function boot(){
  try{
    const user = await api.session();
    if(!user){ mountLogin(); return; }
    currentUser = user;
    await loadDataAndMount();
  }catch(err){
    document.getElementById('app-root').innerHTML = `<div class="boot-loading">Não foi possível carregar os dados do servidor. Verifique se o servidor (npm start) está rodando em ${esc(location.origin)} e recarregue a página.<br><br><code>${(err&&err.message)||err}</code></div>`;
  }
}

boot();
