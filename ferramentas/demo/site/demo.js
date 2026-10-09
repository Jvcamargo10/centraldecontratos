/* ===================================================================
   Modo demonstração (GitHub Pages) — script clássico, carregado ANTES do
   app. Responde às chamadas que a interface faz ao servidor (/api/...) com
   as respostas gravadas em demo/dados.json (geradas por
   ferramentas/demo/montarDemo.js, com o servidor real e dados fictícios).

   - consultas (GET): a resposta gravada;
   - busca nos documentos: roda aqui, sobre o texto dos documentos fictícios;
   - downloads (CSV/PDF): os arquivos gravados em demo/arquivos/;
   - o que gravaria (POST/PUT/DELETE): responde que nada é gravado.
=================================================================== */
(function () {
  'use strict';
  const PASTA = document.currentScript.src.replace(/[^/]*$/, '');
  const fetchOriginal = window.fetch.bind(window);
  const dadosP = fetchOriginal(PASTA + 'dados.json').then(r => r.json());
  const MSG = 'Demonstração: nada é gravado. Os dados são fictícios — para usar de verdade, rode o sistema a partir do código no GitHub.';
  const CHAVE_SAIU = 'central-contratos-demo:saiu';
  window.__demo = { faltando: [] };

  /* A mesma chave do montarDemo.js: caminho decodificado + parâmetros em ordem. */
  function chave(url) {
    const u = new URL(url, 'http://x');
    const ps = [...u.searchParams.entries()].sort((a, b) => (a[0] + '\u0000' + a[1]).localeCompare(b[0] + '\u0000' + b[1]));
    return decodeURIComponent(u.pathname) + (ps.length ? '?' + ps.map(([k, v]) => `${k}=${v}`).join('&') : '');
  }
  const ehApi = url => /^(?:https?:\/\/[^/]+)?\/(?:api|auth)\//.test(url);
  const caminhoDe = url => url.replace(/^https?:\/\/[^/]+/, '');
  const json = (corpo, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
  const saiu = () => { try { return sessionStorage.getItem(CHAVE_SAIU) === '1'; } catch (e) { return false; } };
  const marcarSaida = v => { try { v ? sessionStorage.setItem(CHAVE_SAIU, '1') : sessionStorage.removeItem(CHAVE_SAIU); } catch (e) { /* sem armazenamento */ } };

  /* ---------- busca nos documentos (a mesma regra de integrations/buscaDocumentos.js) ---------- */
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function interpretarConsulta(q) {
    const texto = String(q || '').trim();
    const frases = [...texto.matchAll(/"([^"]{2,})"/g)].map(m => norm(m[1]).trim()).filter(Boolean);
    const palavras = norm(texto.replace(/"[^"]*"/g, ' ')).split(/\s+/).map(w => w.replace(/^[^a-z0-9]+|[^a-z0-9./-]+$/g, '')).filter(w => w.length >= 2);
    return [...new Set([...frases, ...palavras])];
  }
  function trecho(texto, pos, tamanho) {
    const ini = Math.max(0, pos - 90), fim = Math.min(texto.length, pos + tamanho + 90);
    return { antes: (ini > 0 ? '…' : '') + texto.slice(ini, pos).replace(/\s+/g, ' '), achado: texto.slice(pos, pos + tamanho), depois: texto.slice(pos + tamanho, fim).replace(/\s+/g, ' ') + (fim < texto.length ? '…' : '') };
  }
  function buscar(documentos, q, categoria) {
    const termos = interpretarConsulta(q);
    if (!termos.length) return json({ error: 'Digite ao menos uma palavra (2 letras ou mais).' }, 400);
    const resultados = [];
    let totalDocumentos = 0;
    for (const d of documentos) {
      if (categoria && categoria !== 'todos' && d.categoria !== categoria) continue;
      const paginas = d.paginas.map(p => ({ numero: p.numero, texto: p.texto, normal: norm(p.texto) }));
      if (!termos.every(t => paginas.some(p => p.normal.includes(t)))) continue;
      totalDocumentos++;
      const achados = [];
      for (const p of paginas) for (const t of termos) for (let i = p.normal.indexOf(t); i >= 0; i = p.normal.indexOf(t, i + t.length)) achados.push({ p, t, i });
      const trechos = [];
      const incluir = ({ p, t, i }) => {
        if (trechos.length >= 3 || trechos.some(x => x.pagina === p.numero && Math.abs(x.pos - i) < 120)) return;
        trechos.push({ pagina: p.numero, pos: i, ...trecho(p.normal.length === p.texto.length ? p.texto : p.normal, i, t.length) });
      };
      for (const t of termos) { const a = achados.find(x => x.t === t); if (a) incluir(a); }
      achados.forEach(incluir);
      trechos.sort((a, b) => (a.pagina - b.pagina) || (a.pos - b.pos));
      resultados.push({ caminho: d.caminho, nome: d.nome, ocorrencias: achados.length, trechos: trechos.map(({ pos, ...x }) => x), processo: d.processo, contrato: d.contrato, categoria: d.categoria });
    }
    resultados.sort((a, b) => b.ocorrencias - a.ocorrencias);
    return json({ termos, totalDocumentos, documentosNoIndice: documentos.length, resultados });
  }

  /* ---------- as chamadas da interface ---------- */
  async function responder(url, metodo) {
    const d = await dadosP;
    const k = chave(caminhoDe(url));
    const caminho = k.split('?')[0];
    if (caminho === '/api/login' && metodo === 'POST') { marcarSaida(false); return json(d.respostas['/api/session'].corpo); }
    if (caminho === '/api/logout') { marcarSaida(true); return json({ ok: true }); }
    if (caminho === '/api/session' && saiu()) return json({ error: 'Não autenticado.' }, 401);
    if (metodo !== 'GET') return json({ error: MSG }, 403);
    if (caminho === '/api/busca-documentos') { const u = new URL(caminhoDe(url), 'http://x'); return buscar(d.documentos, u.searchParams.get('q'), u.searchParams.get('categoria')); }
    const r = d.respostas[k] || d.respostas[caminho];
    if (r) return json(r.corpo, r.status);
    window.__demo.faltando.push(k);
    console.info('[demonstração] consulta sem resposta gravada:', k);
    return json({ error: 'Esta consulta não está disponível na demonstração.' }, 404);
  }

  window.fetch = function (entrada, opcoes) {
    const url = typeof entrada === 'string' ? entrada : (entrada && entrada.url) || String(entrada);
    if (!ehApi(url)) return fetchOriginal(entrada, opcoes);
    const metodo = String((opcoes && opcoes.method) || (entrada && entrada.method) || 'GET').toUpperCase();
    return responder(url, metodo);
  };

  /* ---------- downloads e links para o servidor ---------- */
  function aviso(texto) {
    const raiz = document.getElementById('toast-root');
    if (!raiz) { alert(texto); return; }
    const el = document.createElement('div');
    el.className = 'toast toast-info';
    el.setAttribute('role', 'status');
    el.textContent = texto;
    el.onclick = () => el.remove();
    raiz.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => el.remove(), 6000);
  }
  document.addEventListener('click', async e => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!ehApi(href)) return;
    e.preventDefault();
    e.stopPropagation();
    const d = await dadosP;
    const [semAncora, ancora] = href.split('#');
    const arq = d.arquivos[chave(semAncora)];
    if (!arq) { aviso('Este arquivo não está disponível na demonstração.'); return; }
    const link = document.createElement('a');
    link.href = PASTA + arq.arquivo + (ancora && arq.tipo === 'application/pdf' ? `#${ancora}` : '');
    if (a.hasAttribute('download') || arq.tipo !== 'application/pdf') link.download = arq.nome;
    else { link.target = '_blank'; link.rel = 'noopener'; }
    document.body.appendChild(link); link.click(); link.remove();
  }, true);

  /* ---------- faixa "demonstração" ---------- */
  document.addEventListener('DOMContentLoaded', async () => {
    const d = await dadosP;
    const faixa = document.createElement('div');
    faixa.className = 'demo-faixa';
    faixa.setAttribute('role', 'note');
    const data = String(d.geradoEm || '').split('-').reverse().join('/');
    faixa.innerHTML = `<b>Demonstração</b> · dados fictícios de ${data} · nada é gravado`;
    const estilo = document.createElement('style');
    estilo.textContent = '.demo-faixa{position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:300;background:#1a3a5c;color:#fff;font:500 12.5px/1.3 var(--fonte,system-ui);padding:7px 14px;border-radius:999px;box-shadow:0 6px 18px rgba(0,0,0,.25);pointer-events:none;white-space:nowrap;max-width:calc(100vw - 24px);overflow:hidden;text-overflow:ellipsis}.demo-faixa b{color:#70c7aa}';
    document.head.appendChild(estilo);
    document.body.appendChild(faixa);
  });
})();
