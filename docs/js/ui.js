/* ===================================================================
   js/ui.js — Peças de interface sem estado: ícones, cores, cards, tabelas, filtros, ajuda.
   Módulo ES (import/export) da Central de Contratos; ver js/app.js.
=================================================================== */
import { esc, escAttr } from './util.js';

export const ICONS = {
  home:'<path d="M3 11l9-7 9 7"/><path d="M5 10v9h5v-6h4v6h5v-9"/>',
  check:'<path d="M20 6L9 17l-5-5"/>',
  doc:'<path d="M6 3h9l5 5v13H6z"/><path d="M14 3v5h5"/>',
  file:'<path d="M6 3h9l5 5v13H6z"/><path d="M14 3v5h5"/>',
  // Aditivo (documento com +) e apostilamento (documento com anotação).
  docMais:'<path d="M6 3h9l5 5v13H6z"/><path d="M14 3v5h5"/><path d="M13 11v6"/><path d="M10 14h6"/>',
  docNota:'<path d="M6 3h9l5 5v13H6z"/><path d="M14 3v5h5"/><path d="M9.5 13h7"/><path d="M9.5 16.5h4.5"/>',
  chart:'<path d="M4 20V10"/><path d="M11 20V4"/><path d="M18 20v-7"/>',
  users:'<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 2.5-5 6-5s6 2 6 5"/><circle cx="17.5" cy="8.5" r="2.4"/><path d="M17 13.2c2.4.4 3.8 2.1 3.8 4.4"/>',
  folder:'<path d="M3 6.5h6l2 2h10v11H3z"/>',
  tool:'<path d="M14.7 6.3l3 3-8.4 8.4-3-3z"/><path d="M17.5 3.5l3 3-2.2 2.2-3-3z"/><path d="M5 19l1.5-1.5"/>',
  plus:'<path d="M12 5v14"/><path d="M5 12h14"/>',
  close:'<path d="M5 5l14 14"/><path d="M19 5L5 19"/>',
  search:'<circle cx="10" cy="10" r="6.2"/><path d="M20 20l-5.2-5.2"/>',
  shield:'<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
  bell:'<path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6z"/><path d="M10 19a2 2 0 0 0 4 0"/>',
  edit:'<path d="M4 20h4l11-11-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  logout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  menu:'<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>',
  download:'<path d="M12 3v13"/><path d="M7 11l5 5 5-5"/><path d="M5 21h14"/>',
  lock:'<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  layers:'<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
  stamp:'<circle cx="12" cy="8" r="4"/><path d="M6 21h12l-2-6H8z"/>',
  inbox:'<path d="M3 12h5l2 3h4l2-3h5"/><path d="M5 4h14l2 8v7H3v-7z"/>',
  coin:'<circle cx="12" cy="12" r="8"/><path d="M9.3 9.7c0-1.1 1.1-1.7 2.7-1.7s2.7.8 2.7 1.8-1.1 1.5-2.7 2-2.7 1-2.7 2.1 1.1 1.7 2.7 1.7 2.7-.7 2.7-1.7"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  eye:'<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  chevronLeft:'<path d="m15 18-6-6 6-6"/>',
  refresh:'<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
  calendario:'<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16"/><path d="M9 3v4"/><path d="M15 3v4"/>',
  alerta:'<path d="M12 4l9 16H3z"/><path d="M12 10v4"/><path d="M12 17v.01"/>',
  relogio:'<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  email:'<rect x="3.5" y="6" width="17" height="12" rx="2"/><path d="M4 7l8 6 8-6"/>',
  engrenagem:'<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
  bandeira:'<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>'
};

export function icon(name,size=18){ return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]||''}</svg>`; }

export const COLORS = {
  s1:'#345a88', s2:'#eb6834', s3:'#1baf7a', s4:'#eda100', s5:'#e87ba4', s6:'#008300', s7:'#4a3aa7', s8:'#e34948',
  good:'#0ca30c', warning:'#fab219', serious:'#ec835a', critical:'#d03b3b', muted:'#c3c2b7', gridline:'#e1e0d9', mutedText:'#898781'
};

export const SERIES = [COLORS.s1,COLORS.s2,COLORS.s3,COLORS.s4,COLORS.s5,COLORS.s6,COLORS.s7,COLORS.s8];

/* `pagina: true` = tabela principal da tela (ocupa até o fim da janela,
   cabeçalho fixo — ver .tabela-pagina no CSS). */
/* Explicação de como a tela funciona, recolhida por padrão: quem já sabe
   usar não precisa ler o mesmo parágrafo toda vez; quem precisa, abre. */
/* Esqueleto de carregamento: blocos no formato do conteúdo que vem (mais
   calmo e mais rápido de "ler" do que um "Carregando..." solto). */
export function esqueleto(linhas, rotulo){
  const n = linhas || 5;
  return `<div role="status" aria-label="${rotulo||'Carregando'}" style="display:flex;flex-direction:column;gap:10px;padding:4px 0;">
    ${Array.from({length:n}, (_,i)=>`<span class="skeleton" style="height:${i===0?16:12}px;width:${[42,96,88,92,70,84][i%6]}%;"></span>`).join('')}
  </div>`;
}

export function badge(status){
  const map = {
    'Vencido':['badge-critical','Vencido'],
    'Crítico':['badge-serious','Crítico'],
    'Atenção':['badge-warning','Atenção'],
    'Próximo':['badge-muted','Próximo do vencimento'],
    'Confortável':['badge-good','Confortável'],
    'Sem término':['badge-muted','Sem término'],
    'Ativo':['badge-good','Ativo'],
    'Encerrado':['badge-muted','Encerrado'],
    'Em andamento':['badge-warning','Em andamento'],
    'Resolvido':['badge-good','Resolvido'],
    'Rascunho':['badge-muted','Rascunho'],
    'Em revisão':['badge-warning','Em revisão'],
    'Aprovado':['badge-good','Aprovado'],
    'Concluído':['badge-good','Concluído'],
    'Vigente':['badge-good','Vigente'],
    'Revisão pendente':['badge-warning','Revisão pendente'],
    'Aceito':['badge-good','Aceito'],
    'Pendente':['badge-warning','Pendente'],
    'Alto risco':['badge-critical','Alto risco'],
    'Médio risco':['badge-warning','Médio risco'],
    'Baixo risco':['badge-good','Baixo risco']
  };
  const [cls,text] = map[status] || ['badge-muted', status];
  return `<span class="badge ${cls}">${text}</span>`;
}

export function table(headers, rows, opcoes){
  // Cabeçalho que já vem como <th ...> (ordenável, fixo) entra como está.
  const vazio = (opcoes && opcoes.vazio) || 'Nenhum registro encontrado';
  return `<div class="table-wrap${opcoes&&opcoes.pagina?' tabela-pagina':''}"><table><thead><tr>${headers.map(h=>/^<th[\s>]/.test(h)?h:`<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.length ? rows.join('') : `<tr><td colspan="${headers.length}" class="empty-cell">${vazio}</td></tr>`}</tbody></table></div>`;
}

/* Filtro em botões (em vez de lista suspensa): as opções e a contagem de
   cada uma ficam à vista, e trocar é um clique. */
export function segmentos(filtroId, opcoes, atual, rotulo){
  return `<div class="segmentos" role="group" aria-label="${escAttr(rotulo||'Filtro')}">${opcoes.map(([v,rot,n])=>`<button type="button" class="segmento${atual===v?' ativo':''}" aria-pressed="${atual===v}" onclick="app.setFilter('${filtroId}','${v}')">${rot}${n!=null?`<span class="segmento-n">${n}</span>`:''}</button>`).join('')}</div>`;
}

export function searchBox(id, placeholder, currentValue){
  // O termo digitado volta para dentro de value="..." a cada re-render —
  // sem esc(), digitar uma aspa quebrava o próprio campo de busca.
  return `<div class="search-input">${icon('search',15)}<input id="${id}" type="search" placeholder="${placeholder}" aria-label="${escAttr(String(placeholder).replace(/\.\.\.$|…$/, ''))}" value="${esc(currentValue||'')}" oninput="app.setFilter('${id}', this.value)"></div>`;
}

export function ajuda(conteudo, titulo){
  return `<details class="ajuda"><summary>${icon('bell',14)} ${titulo||'Como funciona esta tela'}</summary><div class="ajuda-corpo">${conteudo}</div></details>`;
}

/* Card de número (02/10/2026, no modelo dos "section cards"): o rótulo em
   cima, à esquerda, com o ícone num selo à direita; o número grande; e a
   linha de apoio no rodapé, quando houver. Mesma assinatura de antes. */
export function statCard(iconName,color,value,label,sub,onclick){
  return `<div class="stat-card${onclick?' clickable':''}" ${onclick?`onclick="${onclick}" role="button" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click();}"`:''}>
    <div class="stat-topo"><span class="stat-label">${label}</span><span class="stat-icon" style="--cor:${color}" aria-hidden="true">${icon(iconName,18)}</span></div>
    <div class="stat-value${String(value).replace(/<[^>]*>/g,'').length>9?' longo':''}">${value}</div>
    ${sub?`<div class="stat-sub">${sub}</div>`:''}
  </div>`;
}

/* Filtro num botão que abre a lista de opções (cada uma com contagem e
   cor), para listas estreitas onde botões lado a lado quebram em duas
   linhas. opcoes: [valor, rótulo, contagem, cor (token CSS), dica]. */
/* Filtro num botão que abre a lista de opções, para listas estreitas
   onde botões lado a lado quebram em duas linhas.
   opcoes: [valor, rótulo, contagem, cor (token CSS), dica, ícone].
   O ícone diz o QUE é a situação e a cor diz a gravidade — cor sozinha
   (a bolinha de antes) não é lida por quem não distingue as cores. */
export function seletorDeFiltro(filtroId, opcoes, atual, rotulo){
  const sel = opcoes.find(o=>o[0]===atual) || opcoes[0];
  // O fundo do círculo sai da própria cor do ícone (ver .seletor-icone no CSS).
  const marca = ([,, , cor, , ic]) => `<span class="seletor-icone" style="color:${cor||'var(--muted)'};">${icon(ic||'layers',14)}</span>`;
  return `<details class="menu-mais seletor-filtro">
    <summary class="seletor-filtro-botao" aria-haspopup="listbox" title="Filtrar por ${escAttr(rotulo.toLowerCase())}">
      ${marca(sel)}<span class="seletor-filtro-rotulo">${rotulo}:</span><span class="seletor-filtro-valor">${sel[1]}</span><span class="segmento-n">${sel[2]}</span><span class="seletor-seta" aria-hidden="true"></span>
    </summary>
    <div class="menu-mais-lista seletor-filtro-lista" role="listbox" aria-label="${escAttr(rotulo)}">
      ${opcoes.map(o=>{
        const [v,r,n,,dica] = o;
        return `<button type="button" role="option" aria-selected="${v===atual}" class="${v===atual?'ativo':''}" onclick="this.closest('details').open=false;app.setFilter('${filtroId}','${v}')">${marca(o)}<span class="seletor-opcao-texto">${r}${dica?`<small>${dica}</small>`:''}</span><span class="segmento-n">${n}</span><span class="seletor-check" aria-hidden="true">${v===atual?'✓':''}</span></button>`;
      }).join('')}
    </div>
  </details>`;
}

export function chipRisco(label){
  const map = { 'Alto':'badge-critical', 'Médio':'badge-warning', 'Baixo':'badge-good' };
  // Rótulo com "(parcial)" (conteúdo não analisado — ver riscoGeralParcial
  // em mapaRiscoContratos.js) cai de propósito no estilo neutro: um
  // "Baixo" que ninguém conferiu não pode aparecer em verde, como seguro.
  const parcial = /\(parcial\)$/.test(String(label));
  return `<span class="badge ${parcial ? 'badge-muted' : (map[label]||'badge-muted')}"${parcial ? ' title="Parcial: o conteúdo do contrato não foi analisado — este nível considera só prazo e financeiro."' : ''}>${esc(label)}</span>`;
}
