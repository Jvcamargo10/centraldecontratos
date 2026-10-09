/* ===================================================================
   ferramentas/demo/montarDemo.js — monta a DEMONSTRAÇÃO estática para o
   GitHub Pages (pasta docs/).        Uso:  npm run demo

   1. Gera uma pasta de rede FICTÍCIA (documentosFicticios.js).
   2. Sobe o servidor de verdade numa pasta de dados separada e faz o que a
      equipe faria: varrer as pastas, aprovar as propostas, ler relatórios e
      requisições, gerar os mapas de risco, registrar histórico, perfis,
      contas... — tudo pelas mesmas rotas da interface.
   3. Fotografa a resposta de cada consulta (GET) que as telas fazem, os
      arquivos para download (CSV/PDF) e o índice da busca nos documentos.
   4. Copia public/ para docs/ e liga o modo demonstração (docs/demo/demo.js),
      que responde às chamadas da interface com essas fotografias.

   Nada é gravado nos dados do sistema: tudo acontece em .demo-build/.
   Os caminhos locais da máquina viram "\\servidor-arquivos\contratos".
=================================================================== */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const fict = require('./documentosFicticios');

const RAIZ = path.resolve(__dirname, '..', '..');
const BUILD = path.join(RAIZ, '.demo-build');
const SITE = path.join(RAIZ, 'docs');
const PORTA = 3097;
const BASE_URL = `http://127.0.0.1:${PORTA}`;
const CAMINHO_PUBLICO = '\\\\servidor-arquivos\\contratos';
const espera = ms => new Promise(r => setTimeout(r, ms));
// Lista de uma resposta: a própria, ou o primeiro campo que for lista.
const comoLista = o => Array.isArray(o) ? o : (o && typeof o === 'object' && (Object.values(o).find(Array.isArray))) || [];
const log = (...a) => console.log('[demo]', ...a);

/* A mesma chave do lado do navegador (docs/demo/demo.js): caminho decodificado
   + parâmetros em ordem alfabética. */
function chave(url) {
  const u = new URL(url, 'http://x');
  const ps = [...u.searchParams.entries()].sort((a, b) => (a[0] + '\u0000' + a[1]).localeCompare(b[0] + '\u0000' + b[1]));
  return decodeURIComponent(u.pathname) + (ps.length ? '?' + ps.map(([k, v]) => `${k}=${v}`).join('&') : '');
}

/* ---------- cliente HTTP com sessão ---------- */
let cookie = '';
async function http(metodo, url, corpo) {
  const r = await fetch(BASE_URL + url, {
    method: metodo,
    headers: { ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}), Cookie: cookie, Origin: BASE_URL },
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined
  });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const tipo = r.headers.get('content-type') || '';
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, tipo, buf, json: /json/.test(tipo) ? JSON.parse(buf.toString('utf8') || 'null') : null, nome: (/filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '') || [])[1] };
}
const get = url => http('GET', url);
const post = (url, corpo = {}) => http('POST', url, corpo);
const put = (url, corpo = {}) => http('PUT', url, corpo);
async function exigir(p, oque) {
  const r = await p;
  if (r.status >= 400) throw new Error(`${oque}: HTTP ${r.status} ${r.buf.toString('utf8').slice(0, 300)}`);
  return r;
}
async function aguardar(url, campo = 'emAndamento', limite = 300) {
  for (let i = 0; i < limite; i++) {
    const r = await get(url);
    if (!(r.json && r.json[campo])) return r.json;
    await espera(1000);
  }
  throw new Error('tempo esgotado esperando ' + url);
}

/* ---------- 1 e 2: documentos, servidor e o trabalho da equipe ---------- */
async function popular(hoje) {
  fs.rmSync(BUILD, { recursive: true, force: true });
  const pastaRede = path.join(BUILD, 'pasta-rede');
  const { base, lista } = await fict.gerar(pastaRede, hoje);
  log(`${lista.length} processos fictícios em ${base}`);

  const servidor = spawn(process.execPath, ['server.js'], {
    cwd: RAIZ, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(PORTA), HOST: '127.0.0.1', NODE_ENV: 'development',
      CENTRAL_DADOS_PASTA: path.join(BUILD, 'dados'), CONTRATOS_ARQUIVOS_PASTAS: base,
      CONTRATOS_ARQUIVOS_SUBPASTA: '3. Contratos, Aditivos e Termos', CONTRATOS_API_DESLIGADA: '1',
      SESSION_SECRET: crypto.randomBytes(24).toString('hex'), LOGIN_PREENCHIDO_EM_TESTE: '0', SERVIDOR_PRIORIDADE: 'normal' }
  });
  let saida = '';
  servidor.stdout.on('data', d => { saida += d; });
  servidor.stderr.on('data', d => { saida += d; });
  for (let i = 0; i < 60; i++) { try { await get('/api/login-config'); break; } catch (e) { await espera(500); } }

  try {
    const senha = fs.readFileSync(path.join(RAIZ, 'db.js'), 'utf8').match(/hashSync\('([^']*)'/)[1];
    await exigir(post('/api/login', { usuario: 'admin', senha }), 'login');

    // Equipe e perfis de prazo.
    for (const [usuario, nome, role] of [['ana.ferreira', 'Ana Paula Ferreira Costa', 'gestor'], ['bruno.lima', 'Bruno Teixeira Lima', 'fiscal'], ['consulta.controladoria', 'Controladoria (consulta)', 'consulta']])
      await exigir(post('/api/contas', { usuario, nome, role, senha: crypto.randomBytes(12).toString('base64url') }), 'conta ' + usuario);
    await exigir(post('/api/perfis-prazo', { nome: 'Prorrogação por aditivo', critico: 30, atencao: 60, proximo: 120, descricao: 'Contrato que ainda pode ser prorrogado: o aditivo passa por manifestação da contratada, parecer jurídico e despacho.' }), 'perfil 1');
    await exigir(post('/api/perfis-prazo', { nome: 'Nova licitação', critico: 90, atencao: 180, proximo: 365, descricao: 'No limite legal de prorrogação: a próxima contratação exige licitação.' }), 'perfil 2');

    // Varredura e revisão na Fila.
    await exigir(post('/api/integracoes/arquivos/varrer'), 'varredura');
    const fila = (await exigir(get('/api/importacoes'), 'fila')).json;
    const itens = comoLista(fila);
    const pendentes = new Set(lista.filter(c => c.pendente).map(c => c.numero));
    let aprovadas = 0;
    for (const it of itens.filter(x => x.status === 'pendente')) {
      const numero = (it.campos || {}).numero;
      if (pendentes.has(numero)) continue;
      const r = await post(`/api/importacoes/${it.id}/aprovar`, {});
      if (r.status >= 400) log('não aprovou', numero, r.buf.toString('utf8').slice(0, 200)); else aprovadas++;
    }
    log(`${aprovadas} proposta(s) aprovada(s); ${itens.length - aprovadas} na Fila`);

    // Releitura (encerramento, garantias), relatórios, requisições, mapas de risco.
    await exigir(post('/api/importacoes/recalcular'), 'recalcular');
    await exigir(post('/api/relatorios-mensais/ler'), 'relatórios');
    await exigir(post('/api/requisicoes/ler'), 'requisições');
    await aguardar('/api/requisicoes/progresso');
    let boot = (await get('/api/bootstrap')).json;
    for (const c of boot.contratos.filter(x => x.status !== 'Encerrado')) {
      const r = await post(`/api/contratos/${c.id}/mapa-risco/gerar`);
      if (r.status >= 400) { log('mapa de risco', c.numero, r.buf.toString('utf8').slice(0, 160)); continue; }
      await aguardar('/api/mapas-risco/progresso');
    }
    const porNumero = n => boot.contratos.find(c => c.numero === n) || {};
    const f1 = await post(`/api/contratos/${porNumero('012/2024').id}/ficha-cadastro/gerar`);
    if (f1.status >= 400) log('ficha', f1.buf.toString('utf8').slice(0, 160));

    // Prazos de alerta e histórico administrativo.
    await put(`/api/contratos/${porNumero('044/2022').id}/prazos`, { perfilId: 'p1', motivo: 'A prorrogação precisa de parecer jurídico — começar o trâmite com 30 dias de folga.' });
    await put(`/api/contratos/${porNumero('041/2022').id}/prazos`, { perfilId: 'p2', motivo: 'Última prorrogação possível: preparar a nova licitação.' });
    const dia = d => new Date(Date.parse(`${hoje}T12:00:00Z`) + d * 86400000).toISOString().slice(0, 10);
    const historico = [
      ['027/2023', { tipo: 'solicitacao_tce', data: dia(-5), solicitante: 'Tribunal de Contas — DF-5.2', documento: 'Requisição DF-5.2 nº 214/2026', descricao: 'Pedido de cópia do contrato, dos aditivos, dos relatórios mensais e da garantia.', prazoResposta: dia(5) }],
      ['044/2022', { tipo: 'despacho', data: dia(-20), solicitante: 'Secretário de Tecnologia', documento: 'Despacho nº 88/2026', descricao: 'Autorizada a abertura do processo de prorrogação; aguardando manifestação da contratada.' }],
      ['044/2022', { tipo: 'oficio_enviado', data: dia(-18), documento: 'Ofício SETEC nº 412/2026', descricao: 'Consulta à contratada sobre interesse na prorrogação por mais 12 meses.', prazoResposta: dia(-3) }],
      ['012/2024', { tipo: 'reuniao', data: dia(-40), descricao: 'Reunião de acompanhamento da implantação do módulo de compras; cronograma mantido.' }],
      ['061/2024', { tipo: 'notificacao_contratada', data: dia(-12), documento: 'Notificação nº 7/2026', descricao: 'Indisponibilidade do monitoramento por 6 horas; pedido de relatório de causa.', prazoResposta: dia(10) }]
    ];
    for (const [numero, dados] of historico) {
      const r = await post(`/api/contratos/${porNumero(numero).id}/historico`, dados);
      if (r.status >= 400) log('histórico', numero, r.buf.toString('utf8').slice(0, 160));
    }
    await post('/api/comentarios', { entidade: 'contrato', entidadeId: porNumero('012/2024').id, texto: 'Relatório de maio pedido à contratada por e-mail.' });

    // Termo arquivado depois da aprovação: vira "mudança vinda de termo novo".
    await fict.termoNovo(lista, hoje);
    await exigir(post('/api/integracoes/arquivos/varrer'), 'segunda varredura');
    await exigir(post('/api/relatorios-mensais/ler'), 'relatórios (de novo)');
    return { servidor, lista, pastaRede, saida: () => saida };
  } catch (err) {
    servidor.kill();
    console.error(saida.slice(-3000));
    throw err;
  }
}

/* ---------- 3: fotografias ---------- */
async function fotografar(pastaRede) {
  const respostas = {};
  const arquivos = {};
  const pastaArquivos = path.join(SITE, 'demo', 'arquivos');
  fs.mkdirSync(pastaArquivos, { recursive: true });
  const guardar = async url => {
    if (respostas[chave(url)]) return respostas[chave(url)].corpo;
    const r = await get(url);
    respostas[chave(url)] = { status: r.status, corpo: r.json };
    return r.json;
  };
  const baixar = async (url, extensaoPadrao) => {
    if (arquivos[chave(url)]) return;
    const r = await get(url);
    if (r.status >= 400) return;
    const ext = /pdf/.test(r.tipo) ? '.pdf' : /csv/.test(r.tipo) ? '.csv' : extensaoPadrao || '.bin';
    const nomeArquivo = `${Object.keys(arquivos).length + 1}${ext}`;
    let conteudo = r.buf;
    if (ext === '.csv') conteudo = Buffer.from(publicar(r.buf.toString('utf8')), 'utf8');
    fs.writeFileSync(path.join(pastaArquivos, nomeArquivo), conteudo);
    arquivos[chave(url)] = { arquivo: `arquivos/${nomeArquivo}`, nome: r.nome || nomeArquivo, tipo: r.tipo.split(';')[0] };
  };
  // A ordem importa pouco; o que importa é cobrir tudo o que as telas pedem.
  for (const u of ['/api/session', '/api/login-config', '/api/bootstrap', '/api/importacoes', '/api/integracoes/arquivos/status', '/api/integracoes/arquivos/progresso',
    '/api/integracoes/arquivos/pastas', '/api/integracoes/contratos/status', '/api/integracoes/alertas-email/status', '/api/base-contratos', '/api/base-termos',
    '/api/termos/aditivos', '/api/termos/apostilamentos', '/api/pendencias-leitura', '/api/mapas-risco', '/api/mapas-risco/progresso', '/api/mapas-risco/riscos',
    '/api/registro-riscos', '/api/relatorios-mensais', '/api/requisicoes', '/api/requisicoes/progresso', '/api/requisicoes/processos', '/api/ufm',
    '/api/fichas-cadastro', '/api/contas', '/api/contas/pedidos', '/api/leituras-reportadas', '/api/conferencia-sgc']) await guardar(u);
  const boot = respostas[chave('/api/bootstrap')].corpo;
  for (const c of boot.contratos) {
    for (const u of [`/api/contratos/${c.id}/historico`, `/api/contratos/${encodeURIComponent(c.id)}/visao`, `/api/comentarios?entidade=contrato&entidadeId=${c.id}`,
      `/api/mapas-risco/${c.id}`, `/api/registro-riscos/${encodeURIComponent(c.id)}`]) await guardar(u);
    for (const u of [`/api/fichas-sgc/empresa/${c.id}?formato=pdf`, `/api/contratos/${c.id}/historico/exportar`, `/api/contratos/${c.id}/historico/exportar?formato=pdf`,
      `/api/registro-riscos/${encodeURIComponent(c.id)}/exportar?aba=riscos`, `/api/registro-riscos/${encodeURIComponent(c.id)}/exportar?aba=issues`]) await baixar(u);
    await guardar(`/api/fichas-sgc/empresa/${c.id}`);
  }
  for (const l of (respostas[chave('/api/base-contratos')].corpo.linhas || [])) await guardar(`/api/base-contratos/detalhe/${encodeURIComponent(l.propostaId)}`);
  for (const it of comoLista(respostas[chave('/api/importacoes')].corpo)) if (it && it.id != null) await guardar(`/api/base-contratos/detalhe/${encodeURIComponent(it.id)}`);
  const pend = respostas[chave('/api/pendencias-leitura')].corpo;
  for (const g of pend.grupos || []) for (const i of g.itens || []) await guardar(`/api/pendencias-leitura/${encodeURIComponent(i.propostaId)}/trechos?grupo=${encodeURIComponent(g.chave || '')}`);
  for (const [qual, especie] of [['aditivos', 'aditivo'], ['apostilamentos', 'apostilamento']]) {
    for (const t of respostas[chave(`/api/termos/${qual}`)].corpo.itens || []) {
      await guardar(`/api/fichas-sgc/termo/${especie}/${t.id}`);
      await baixar(`/api/fichas-sgc/termo/${especie}/${t.id}?formato=pdf`);
    }
  }
  const rel = respostas[chave('/api/relatorios-mensais')].corpo;
  for (const p of rel.processos || []) {
    const proc = await guardar(`/api/relatorios-mensais/processo?caminho=${encodeURIComponent(p.caminho)}`);
    await guardar(`/api/relatorios-mensais/indicadores?caminho=${encodeURIComponent(p.caminho)}`);
    const ids = new Set();
    (function achar(o) { if (!o || typeof o !== 'object') return; if (Array.isArray(o)) return o.forEach(achar); if (o.id != null && o.nome && /\.(pdf|docx?|xlsx?)$/i.test(o.nome)) ids.add(o.id); Object.values(o).forEach(achar); })([p, proc]);
    for (const id of ids) await baixar(`/api/relatorios-mensais/arquivo?id=${encodeURIComponent(id)}`, '.pdf');
  }
  const req = respostas[chave('/api/requisicoes')].corpo;
  for (const g of [...(req.tce || []), ...(req.sisfin || [])]) {
    await guardar(`/api/requisicoes/direcionamento?chave=${encodeURIComponent(g.chave)}`);
    await baixar(`/api/requisicoes/ficha?chave=${encodeURIComponent(g.chave)}`, '.pdf');
  }
  for (const f of comoLista(respostas[chave('/api/fichas-cadastro')].corpo)) if (f && f.id != null) await baixar(`/api/fichas-cadastro/${f.id}/arquivo`, '.pdf');
  for (const u of ['/api/base-contratos/exportar?escopo=aprovadas', '/api/base-contratos/exportar?escopo=todas', '/api/base-termos/exportar?escopo=todas',
    '/api/base-termos/exportar?escopo=aditivos', '/api/base-termos/exportar?escopo=apostilamentos', '/api/base-termos/exportar?escopo=aprovados', '/api/ufm/exportar',
    '/api/requisicoes/exportar?origem=tce', '/api/requisicoes/exportar?origem=sisfin', '/api/relatorios-mensais/exportar?tipo=arquivos',
    '/api/relatorios-mensais/exportar?tipo=faltas', '/api/relatorios-mensais/exportar?tipo=fora_do_padrao', '/api/leituras-reportadas/exportar',
    '/api/mapas-risco/lacunas/exportar', '/api/conferencia-sgc/exportar']) await baixar(u);
  // Auditoria por último: ela registra as consultas acima.
  await guardar('/api/auditoria');

  // Índice da busca nos documentos (a busca roda no navegador) e os PDFs.
  const busca = require(path.join(RAIZ, 'integrations', 'buscaDocumentos'));
  const { paDaPasta, chavePa } = require(path.join(RAIZ, 'integrations', 'requisicoes'));
  const indice = busca.obterIndice(path.join(BUILD, 'dados', '.texto-cache'));
  const documentos = [];
  for (const d of indice.documentos) {
    const pasta = d.caminho.split(/[\\/]/).find(p => /^P\.?\s*A\.?\s*\d/i.test(p)) || null;
    const pa = pasta ? paDaPasta(pasta) : null;
    const c = pa && boot.contratos.find(x => chavePa(x.pa) === chavePa(pa));
    documentos.push({ caminho: d.caminho, nome: d.nome, processo: pasta, contrato: c ? { id: c.id, numero: c.numero, status: c.status } : null,
      categoria: /contratos\s+encerrados/i.test(d.caminho) ? 'encerrado' : /outras\s+secretarias/i.test(d.caminho) ? 'outra_secretaria' : 'vigencia',
      paginas: d.paginas.map(p => ({ numero: p.numero, texto: p.texto })) });
    await baixar(`/api/busca-documentos/arquivo?caminho=${encodeURIComponent(d.caminho)}`, '.pdf');
  }
  return { respostas, arquivos, documentos };
}

/* Troca o caminho local da máquina pelo caminho fictício, em textos e chaves. */
let PREFIXOS = [];
function publicar(s) {
  let t = String(s);
  for (const p of PREFIXOS) t = t.split(p).join(CAMINHO_PUBLICO).split(p.replace(/\\/g, '/')).join(CAMINHO_PUBLICO.replace(/\\/g, '/'));
  return t;
}
const publicarTudo = o => typeof o === 'string' ? publicar(o) : Array.isArray(o) ? o.map(publicarTudo)
  : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [publicar(k), publicarTudo(v)])) : o;

/* ---------- 4: o site ---------- */
function copiarPasta(de, para) {
  fs.mkdirSync(para, { recursive: true });
  for (const e of fs.readdirSync(de, { withFileTypes: true })) {
    const a = path.join(de, e.name), b = path.join(para, e.name);
    if (e.isDirectory()) copiarPasta(a, b); else fs.copyFileSync(a, b);
  }
}

async function main() {
  const hoje = new Date().toISOString().slice(0, 10);
  fs.rmSync(SITE, { recursive: true, force: true });
  copiarPasta(path.join(RAIZ, 'public'), SITE);
  const { servidor, pastaRede, saida } = await popular(hoje);
  let fotos;
  try {
    PREFIXOS = [path.join(pastaRede, '9. Gestão de Contratos'), pastaRede, BUILD].sort((a, b) => b.length - a.length);
    fotos = await fotografar(pastaRede);
  } finally {
    servidor.kill();
  }
  const dados = publicarTudo({ geradoEm: hoje, ...fotos });
  const texto = JSON.stringify(dados);
  const proibido = /cgjoao|\\Users\\|\/Users\/|portfolio|\.demo-build|Osasco/i;
  if (proibido.test(texto)) throw new Error('dado local ou proibido no pacote: ' + texto.match(new RegExp(`.{0,60}${proibido.source}.{0,60}`, 'i'))[0]);
  fs.writeFileSync(path.join(SITE, 'demo', 'dados.json'), texto);
  fs.copyFileSync(path.join(__dirname, 'site', 'demo.js'), path.join(SITE, 'demo', 'demo.js'));
  // index.html: o modo demonstração entra ANTES do app (script clássico roda primeiro).
  const indexPath = path.join(SITE, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');
  html = html.replace('<script type="module" src="js/app.js"></script>', '<script src="demo/demo.js"></script>\n<script type="module" src="js/app.js"></script>');
  html = html.replace('<meta name="robots" content="noindex, nofollow">', '<meta name="robots" content="noindex">');
  fs.writeFileSync(indexPath, html);
  fs.writeFileSync(path.join(SITE, '.nojekyll'), '');
  fs.rmSync(path.join(SITE, 'robots.txt'), { force: true });
  const kb = Math.round(texto.length / 1024);
  log(`site em docs/: ${Object.keys(fotos.respostas).length} consultas, ${Object.keys(fotos.arquivos).length} arquivos, ${fotos.documentos.length} documentos na busca, dados.json ${kb} KB`);
  if (/erro|error/i.test(saida().slice(-2000))) log('últimas linhas do servidor:\n' + saida().slice(-1500));
}

main().catch(err => { console.error('[demo] FALHOU:', err.message); process.exit(1); });
