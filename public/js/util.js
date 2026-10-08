/* ===================================================================
   js/util.js — Funções puras: escape de HTML, datas, dinheiro, comparação e códigos curtos.
   Módulo ES (import/export) da Central de Contratos; ver js/app.js.
=================================================================== */

export function escJs(str){
  // Escapa \ e ' pra poder embutir um caminho de rede do Windows (que usa
  // \ como separador) dentro de uma string JS de aspas simples num
  // atributo onclick="..." sem quebrar o HTML/JS gerado.
  // ATENÇÃO: isto resolve só a camada JS. Para ir dentro de um atributo
  // HTML, o resultado ainda precisa passar por esc() — ver escAttr().
  return String(str==null?'':str).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
}

/* Escape de HTML. A tela monta tudo por template string + innerHTML, e
   boa parte do que ela mostra NÃO é digitado por quem usa o sistema:
   nome de arquivo e de pasta da rede, texto lido do PDF,
   campos sincronizados do SGC. Um arquivo chamado
   `Contrato" onmouseover="alert(1)` escapava do atributo; um chamado
   `Contrato <img src=x onerror=...>.pdf` injetava tag. Como quem revisa
   importação é admin ou gestor, um script injetado assim rodaria com a
   sessão dessa pessoa e poderia chamar a API em nome dela.

   Regra: todo dado de fora (arquivo, texto lido, SGC) passa por esc() antes de
   entrar no HTML. Texto que o próprio app escreve (rótulos fixos, HTML
   de layout) não precisa — e não deve, senão vira texto literal. */
export function esc(str){
  return String(str==null?'':str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

/* Para um valor que vai DENTRO de uma string JS, DENTRO de um atributo
   HTML — caso do caminho de rede em onclick="app.abrir('...')". As duas
   camadas precisam ser tratadas, nessa ordem: primeiro a string JS
   (escJs), depois o atributo (esc). O navegador desfaz as entidades
   antes de o JS ser interpretado, então a composição funciona. */
export function escAttr(str){
  return esc(escJs(str));
}

export function formatDate(iso){ if(!iso) return '—';
  // Data e hora (geradoEm, aprovadoEm): o dia no fuso local, não o do UTC.
  if(/T\d{2}:/.test(String(iso))){ const t=new Date(iso); if(!isNaN(t)) return t.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'}); }
  const [y,m,d]=String(iso).slice(0,10).split('-').map(Number); if(!y||!m||!d) return '—'; return new Date(y,m-1,d).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'}); }

/* Data e hora em pt-BR (registradoEm, analisadoEm...). Valor vazio ou
   inválido vira "—": nunca aparece "Invalid Date" na tela. */
export function dataHora(v, opcoes){
  const d = new Date(v);
  return v == null || v === '' || isNaN(d) ? '—' : d.toLocaleString('pt-BR', opcoes);
}

export function formatDataCurta(iso){
  const m = String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : esc(iso);
}

// Hoje no fuso local (toISOString é UTC: depois das 21h já seria amanhã).
export function hojeIsoLocal(){ const d=new Date(), p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; }

export function money(n){ return (Number(n)||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}); }

/* Comparação para ordenar colunas: vazio sempre no fim; números e datas
   ISO pela ordem natural; texto em português, com "10" depois de "9". */
export function compararValores(a, b, dir){
  const va = (a===null||a===undefined||a==='') ? null : a;
  const vb = (b===null||b===undefined||b==='') ? null : b;
  if(va===null && vb===null) return 0;
  if(va===null) return 1;
  if(vb===null) return -1;
  const r = (typeof va==='number' && typeof vb==='number') ? va - vb
    : String(va).localeCompare(String(vb), 'pt-BR', { numeric:true, sensitivity:'base' });
  return dir==='desc' ? -r : r;
}

/* "048/2026" ordena pelo ano e depois pelo número ("2026-000048"): mais
   recente primeiro faz sentido; ordem alfabética misturaria os anos. */
export function chaveDoNumero(numero){
  const m = String(numero||'').match(/(\d+)\s*\/\s*(\d{4})/);
  return m ? `${m[2]}-${m[1].padStart(6,'0')}` : (numero || null);
}

export function tempoRelativo(iso){
  const d = new Date(iso);
  if(isNaN(d)) return '';
  // Dias de CALENDÁRIO (meia-noite a meia-noite), não blocos de 24 h: uma
  // análise de ontem às 20h vista hoje às 10h é "ontem", não "hoje".
  const meiaNoite = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dias = Math.round((meiaNoite(new Date()) - meiaNoite(d)) / 86400000);
  if(dias<=0) return 'hoje';
  if(dias===1) return 'ontem';
  if(dias<30) return `há ${dias} dias`;
  const meses = Math.floor(dias/30);
  if(meses<12) return `há ${meses} ${meses===1?'mês':'meses'}`;
  const anos = Math.floor(dias/365);
  return `há ${anos} ${anos===1?'ano':'anos'}`;
}

export function formatarCnpj(v){
  const d = String(v||'').replace(/\D/g,'');
  return d.length===14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : v;
}

export function formatBytesArquivo(n){
  if(n==null) return '';
  if(n < 1024) return `${n} B`;
  if(n < 1024*1024) return `${(n/1024).toFixed(1)} KB`;
  return `${(n/(1024*1024)).toFixed(1)} MB`;
}

/* Código curto e estável para endereço (requisição e processo têm o caminho da pasta como chave). */
export function idCurto(texto){ let h = 0x811c9dc5; for(const ch of String(texto)){ h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); }

/* Sem número (vazio ou inválido) mostra "—", nunca "NaN". */
const semNumero = n => n == null || n === '' || !Number.isFinite(Number(n));

export const reaisUfm = (n, casas=4) => semNumero(n) ? '—' : `R$ ${Number(n).toLocaleString('pt-BR',{minimumFractionDigits:casas, maximumFractionDigits:casas})}`;

export const numBr = (n, casas=1) => semNumero(n) ? '—' : Number(n).toLocaleString('pt-BR',{minimumFractionDigits:casas, maximumFractionDigits:casas});
