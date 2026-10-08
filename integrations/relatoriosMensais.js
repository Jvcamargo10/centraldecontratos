/* ===================================================================
   integrations/relatoriosMensais.js

   Relatórios mensais de todos os contratos (29/09/2026): junta o que está
   na subpasta "Relatórios mensais de atividades" de cada processo da
   pasta de rede, descobre o MÊS de cada arquivo (competência) e mostra,
   contrato a contrato, quais meses da vigência estão sem relatório.
   Só lista (nome, pasta, data) — não abre nem altera arquivo; o download
   passa pelo servidor, que só entrega arquivo de dentro dessas pastas.

   Medido na raiz "9. Gestão de Contratos": 57 processos com a pasta (20
   vazias), 2.283 arquivos, quase todos PDF, no padrão
   "AAAA_MM - Relatório Mensal ... - Mês.pdf" em subpastas por ano.

   O mês, nesta ordem:
     1. prefixo "AAAA_MM" (ou "AAAA-MM", "AAAA MM") no nome do arquivo;
     2. "MM.AAAA" / "MM_AAAA" no nome ("ITD - 02.2025.docx");
     3. nome do mês no arquivo ou na subpasta ("Dezembro"), com o ano do
        nome, da subpasta ou do prefixo;
     4. sem mês: o arquivo entra na lista, sem contar para a cobertura.
   Quando o prefixo e o nome do mês discordam ("2024_07 ... - Junho"), vale
   o nome do mês (é o mês do relatório; o prefixo costuma ser o da
   entrega) — e a tela avisa.
=================================================================== */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const percurso = require('./percursoPastas');

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const RE_PASTA_RELATORIOS = /relatorios? mensa|relatorios? de atividade/;
const IGNORAR = /^(thumbs\.db|desktop\.ini)$|^~\$/i;
const mm = n => String(n).padStart(2, '0');

/* Mês (AAAA-MM) de um arquivo, pelo nome e pelas subpastas. */
function competenciaDoArquivo(nome, subpastas = []) {
  const n = norm(nome);
  const pastas = subpastas.map(norm);
  const anoDasPastas = [...pastas].reverse().map(p => (/(?:^|\D)(20\d{2})(?!\d)/.exec(p) || [])[1]).find(Boolean) || null;
  const mesEm = s => { const i = MESES.findIndex(m => new RegExp(`(?:^|[^a-z])${m}(?![a-z])`).test(s)); return i >= 0 ? i + 1 : null; };
  const prefixo = /(?:^|[^\d])(20\d{2})\s*[_\-. ]\s*(0[1-9]|1[0-2])(?!\d)/.exec(n);
  const mesAno = /(?:^|[^\d.])(0[1-9]|1[0-2])\s*[._-]\s*(20\d{2})(?!\d)/.exec(n);
  const mesNome = mesEm(n.replace(/\.[a-z0-9]+$/, ''));
  if (prefixo) {
    const [a, m] = [Number(prefixo[1]), Number(prefixo[2])];
    if (mesNome && mesNome !== m) {
      // "2025_01 - ... - Dezembro": dezembro do ano anterior; "2023_09 ... - Outubro
      // (15/09 a 15/10)": outubro do mesmo ano. Só a volta do ano muda o ano.
      const delta = mesNome - m;
      const ano = delta > 6 ? a - 1 : delta < -6 ? a + 1 : a;
      return { competencia: `${ano}-${mm(mesNome)}`, fonte: 'nome do mês', aviso: `O prefixo diz ${mm(m)}/${a}, o nome diz ${MESES[mesNome - 1]} — vale o nome do mês.` };
    }
    return { competencia: `${a}-${mm(m)}`, fonte: 'prefixo AAAA_MM do nome' };
  }
  if (mesAno) return { competencia: `${mesAno[2]}-${mesAno[1]}`, fonte: 'MM.AAAA no nome' };
  const anoNoNome = (/(?:^|\D)(20\d{2})(?!\d)/.exec(n) || [])[1] || null;
  const mesDaPasta = [...pastas].reverse().map(mesEm).find(Boolean) || null;
  const mes = mesNome || mesDaPasta;
  const ano = anoNoNome || anoDasPastas;
  if (mes && ano) return { competencia: `${ano}-${mm(mes)}`, fonte: mesNome ? 'nome do mês no arquivo' : 'subpasta do mês' };
  return { competencia: null, fonte: null };
}

/* O que é o arquivo: relatório mensal, relatório de gestão, planilha, cronograma... */
function tipoDoArquivo(nome) {
  const n = norm(nome);
  if (/\.crdownload$|\.part$|\.apgar$/.test(n)) return 'incompleto';
  if (/cronograma/.test(n)) return 'cronograma';
  if (/relatorio (gfe|gest)|relatorio do gestor|gestor/.test(n)) return 'gestao';
  if (/pendent|acompanhamento/.test(n)) return 'acompanhamento';
  if (/\.(xlsx?|xlsm|csv)$/.test(n)) return 'planilha';
  if (/relat/.test(n)) return 'relatorio';
  if (/\.(pdf|docx?)$/.test(n)) return 'relatorio';
  return 'outro';
}
const ROTULO_TIPO = { relatorio: 'Relatório', gestao: 'Relatório do gestor', acompanhamento: 'Acompanhamento', planilha: 'Planilha', cronograma: 'Cronograma', incompleto: 'Download incompleto', outro: 'Outro' };

/* Padrão de nome (01/10/2026): "AAAA_MM - Relatório Mensal - Empresa - Mês.ext".
   60% dos relatórios já seguem; os outros entram na lista "fora do padrão",
   com o nome sugerido — a Central NÃO renomeia nada (só lê a pasta). */
const MESES_NOME = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const RE_PADRAO = /^20\d{2}_(0[1-9]|1[0-2])\s*-\s*/;
function empresaDoProcesso(nomeProcesso) {
  const partes = String(nomeProcesso || '').split(/\s+-\s+/).map(s => s.trim()).filter(Boolean);
  return partes.length >= 3 ? partes[partes.length - 1] : null;
}
function nomeSugerido(arquivo, nomeProcesso) {
  if (!arquivo.competencia || !['relatorio', 'gestao'].includes(arquivo.tipo)) return null;
  const ext = (arquivo.nome.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
  const [a, m] = arquivo.competencia.split('-');
  const empresa = empresaDoProcesso(nomeProcesso);
  return `${a}_${m} - ${arquivo.tipo === 'gestao' ? 'Relatório do Gestor' : 'Relatório Mensal'}${empresa ? ` - ${empresa}` : ''} - ${MESES_NOME[Number(m) - 1]}${ext}`;
}
const foraDoPadrao = a => ['relatorio', 'gestao'].includes(a.tipo) && !RE_PADRAO.test(a.nome);

const idDoArquivo = caminho => crypto.createHash('sha1').update(caminho).digest('hex').slice(0, 16);

/* ------------------------------------------------------------------
   Leitura das pastas (assíncrona: o servidor segue respondendo)
   ------------------------------------------------------------------ */
/* Desde 06/10/2026 as pastas são lidas ao mesmo tempo (até 8 pedidos à
   rede — ver percursoPastas.js), com o resultado na mesma ordem de antes. */
async function lerPastasDeRelatorios(raizes) {
  const { paDaPasta } = require('./requisicoes');
  const processos = [];
  const avisos = [];
  const lerDir = async d => { try { return await percurso.lerPasta(d); } catch (e) { return null; } };
  // Devolve { processos, avisos } na ordem das pastas.
  const procurarProcessos = async (pasta, prof) => {
    const ents = await lerDir(pasta);
    if (!ents) return { processos: [], avisos: [`Pasta sem acesso agora: "${pasta}".`] };
    const partes = await Promise.all(ents.map(e => {
      if (!e.isDirectory()) return null;
      const c = path.join(pasta, e.name);
      if (/^P\.?\s*A\.?\s*\d/i.test(e.name)) return { processos: [{ caminho: c, nome: e.name.normalize('NFC'), pa: paDaPasta(e.name), categoria: /encerrad/i.test(c) ? 'encerrado' : /outras\s+secretarias/i.test(c) ? 'outra_secretaria' : 'vigencia' }], avisos: [] };
      return prof < 2 ? procurarProcessos(c, prof + 1) : null;
    }));
    const res = { processos: [], avisos: [] };
    for (const p of partes) if (p) { res.processos.push(...p.processos); res.avisos.push(...p.avisos); }
    return res;
  };
  for (const r of raizes || []) {
    if (!fs.existsSync(r)) { avisos.push(`Pasta configurada não encontrada (ou sem acesso agora): "${r}".`); continue; }
    const achado = await procurarProcessos(r, 0);
    processos.push(...achado.processos); avisos.push(...achado.avisos);
  }
  await Promise.all(processos.map(async p => {
    const ents = (await lerDir(p.caminho)) || [];
    const pastasRel = ents.filter(e => e.isDirectory() && RE_PASTA_RELATORIOS.test(norm(e.name)));
    p.pastas = pastasRel.map(e => ({ nome: e.name.normalize('NFC'), caminho: path.join(p.caminho, e.name) }));
    p.arquivos = await percurso.emOrdem(p.pastas, pr => {
      const visitar = async (d, trilha, prof) => percurso.emOrdem((await lerDir(d)) || [], async e => {
        const c = path.join(d, e.name);
        if (e.isDirectory()) return prof < 4 ? visitar(c, [...trilha, e.name.normalize('NFC')], prof + 1) : null;
        if (IGNORAR.test(e.name)) return null;
        let st = null;
        try { st = await percurso.statArquivo(c); } catch (err) { return null; }
        const nome = e.name.normalize('NFC');
        const comp = competenciaDoArquivo(nome, trilha);
        return [{
          id: idDoArquivo(c), caminho: c, nome, rel: [pr.nome, ...trilha, nome].join('/'),
          competencia: comp.competencia, fonteCompetencia: comp.fonte, aviso: comp.aviso || null,
          tipo: tipoDoArquivo(nome), tamanho: st.size, modificadoEm: st.mtime.toISOString()
        }];
      });
      return visitar(pr.caminho, [], 0);
    });
    p.arquivos.sort((a, b) => String(b.competencia || '').localeCompare(String(a.competencia || '')) || a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true }));
  }));
  return { processos, avisos };
}

let lendo = false;
async function ler(db, save, raizes) {
  if (lendo) throw new Error('A leitura dos relatórios já está em andamento.');
  lendo = true;
  try {
    const t = Date.now();
    const r = await lerPastasDeRelatorios(raizes || require('./servidorArquivos').statusPublico().pastas);
    if (!r.processos.length && r.avisos.length) throw new Error(r.avisos.join(' '));
    db.relatoriosMensais = { lidoEm: new Date().toISOString(), duracaoMs: Date.now() - t, avisos: r.avisos, processos: r.processos };
    save();
    return resumoDaLeitura(db.relatoriosMensais);
  } finally {
    lendo = false;
  }
}
function resumoDaLeitura(rm) {
  const ps = rm.processos || [];
  return {
    processos: ps.length, comPasta: ps.filter(p => p.pastas.length).length,
    arquivos: ps.reduce((s, p) => s + p.arquivos.length, 0),
    semMes: ps.reduce((s, p) => s + p.arquivos.filter(a => !a.competencia).length, 0),
    duracaoMs: rm.duracaoMs
  };
}

/* ------------------------------------------------------------------
   Cobertura: quais meses da vigência têm relatório
   ------------------------------------------------------------------ */
const mesDe = iso => (iso ? String(iso).slice(0, 7) : null);
function somarMes(c, n) { const [a, m] = c.split('-').map(Number); const d = new Date(a, m - 1 + n, 1); return `${d.getFullYear()}-${mm(d.getMonth() + 1)}`; }
function mesesEntre(ini, fim) { const out = []; for (let c = ini; c <= fim && out.length < 240; c = somarMes(c, 1)) out.push(c); return out; }

/* Meses esperados: da vigência do contrato cadastrado (início → término),
   até o mês passado. O relatório de um mês é entregue no seguinte: até o
   dia `diasDeEntrega` do mês corrente, o mês passado fica "aguardando". */
function cobertura(proc, contrato, hoje = new Date(), diasDeEntrega = 10) {
  const relatorios = proc.arquivos.filter(a => a.competencia && ['relatorio', 'gestao'].includes(a.tipo));
  const comRelatorio = new Set(relatorios.map(a => a.competencia));
  const atual = `${hoje.getFullYear()}-${mm(hoje.getMonth() + 1)}`;
  const mesPassado = somarMes(atual, -1);
  let inicio = contrato && mesDe(contrato.inicio);
  let fim = contrato && mesDe(contrato.termino);
  let base = 'vigência do contrato';
  if (!inicio) {
    const meses = [...comRelatorio].sort();
    if (!meses.length) return { base: null, esperados: 0, entregues: 0, faltando: [], aguardando: null, ultimo: null, percentual: null, ultimos12: [] };
    inicio = meses[0]; fim = fim || meses[meses.length - 1]; base = 'do primeiro ao último relatório na pasta (contrato não cadastrado)';
  }
  const ate = [fim || mesPassado, mesPassado].sort()[0];
  const esperados = inicio <= ate ? mesesEntre(inicio, ate) : [];
  let aguardando = null;
  if (hoje.getDate() <= diasDeEntrega && esperados[esperados.length - 1] === mesPassado && !comRelatorio.has(mesPassado)) {
    aguardando = mesPassado;
    esperados.pop();
  }
  const faltando = esperados.filter(m => !comRelatorio.has(m));
  const ultimo = [...comRelatorio].sort().pop() || null;
  // Os últimos 12 meses, para a faixa da tela.
  const ultimos12 = mesesEntre(somarMes(mesPassado, -11), mesPassado).map(m => ({
    mes: m,
    estado: comRelatorio.has(m) ? 'ok' : m === aguardando ? 'aguardando' : (m < inicio || m > ate) ? 'fora' : 'falta'
  }));
  return {
    base, inicio, fim: ate, esperados: esperados.length, entregues: esperados.length - faltando.length,
    faltando, aguardando, ultimo, ultimos12,
    percentual: esperados.length ? Math.round((esperados.length - faltando.length) / esperados.length * 100) : null
  };
}

/* A lista vai sem os arquivos (eram 1,5 MB com os 2.279): só a cobertura
   e as contagens. Os arquivos de um processo vêm no detalhe (processo()). */
function listar(db, hoje = new Date(), opcoes = {}) {
  const l = listarCompleto(db, hoje);
  if (opcoes.comArquivos) return l;
  return { ...l, processos: l.processos.map(({ arquivos, ...p }) => ({ ...p, totalArquivos: arquivos.length, semMes: arquivos.filter(a => !a.competencia).length, foraDoPadrao: arquivos.filter(a => a.foraDoPadrao).length })) };
}
function processo(db, caminho, hoje = new Date()) {
  return listarCompleto(db, hoje).processos.find(p => p.caminho === caminho) || null;
}

function listarCompleto(db, hoje = new Date()) {
  const { chavePa } = require('./requisicoes');
  const rm = db.relatoriosMensais;
  if (!rm) return { lidoEm: null, processos: [], resumo: null };
  const contratos = db.contratos || [];
  const config = db.relatoriosMensaisConfig || {};
  const processos = rm.processos.map(p => {
    const c = p.pa && contratos.find(x => chavePa(x.pa) === chavePa(p.pa) && x.status !== 'Encerrado')
      || (p.pa && contratos.find(x => chavePa(x.pa) === chavePa(p.pa))) || null;
    const porTipo = {};
    p.arquivos.forEach(a => { porTipo[a.tipo] = (porTipo[a.tipo] || 0) + 1; });
    // Contrato de fornecimento ou licença, sem relatório mensal: o gestor marca, e a falta não conta.
    const naoExige = config[chavePa(p.pa) || p.caminho] || null;
    return {
      caminho: p.caminho, nome: p.nome, pa: p.pa, categoria: p.categoria, pastas: p.pastas,
      contrato: c ? { id: c.id, numero: c.numero, empresa: c.empresa, inicio: c.inicio, termino: c.termino, status: c.status } : null,
      arquivos: p.arquivos.map(a => foraDoPadrao(a) ? { ...a, foraDoPadrao: true, nomeSugerido: nomeSugerido(a, p.nome) } : a),
      porTipo, naoExige,
      cobertura: p.pastas.length && !naoExige ? cobertura(p, c, hoje) : null
    };
  });
  return { lidoEm: rm.lidoEm, avisos: rm.avisos, processos, resumo: resumoDaLeitura(rm) };
}

/* Cobertura de UM contrato (o Registro de riscos e a visão do contrato
   usam): o processo da pasta com o mesmo PA. null se as pastas ainda não
   foram lidas, se o processo não tem pasta de relatórios ou se foi
   marcado "não exige relatório mensal". */
function coberturaDoContrato(db, contrato, hoje = new Date()) {
  const { chavePa } = require('./requisicoes');
  const rm = db.relatoriosMensais;
  const k = contrato && chavePa(contrato.pa);
  if (!rm || !k) return null;
  const p = rm.processos.find(x => chavePa(x.pa) === k && x.pastas.length);
  if (!p) return null;
  const naoExige = (db.relatoriosMensaisConfig || {})[k];
  if (naoExige) return { naoExige, processo: p.nome };
  return { ...cobertura(p, contrato, hoje), processo: p.nome, pasta: p.pastas[0] ? p.pastas[0].nome : null, lidoEm: rm.lidoEm };
}

/* O arquivo para download: só um que a última leitura achou, e ainda
   dentro das pastas configuradas. */
function arquivoPorId(db, id) {
  const rm = db.relatoriosMensais;
  if (!rm) return null;
  for (const p of rm.processos) {
    const a = p.arquivos.find(x => x.id === id);
    if (!a) continue;
    if (!require('./servidorArquivos').caminhoPermitido(a.caminho)) return null;
    return { ...a, processo: p.nome };
  }
  return null;
}
function caminhoDaPasta(db, caminhoProcesso) {
  const rm = db.relatoriosMensais;
  const p = rm && rm.processos.find(x => x.caminho === caminhoProcesso);
  return p || null;
}

/* "Não exige relatório mensal" (ou volta a exigir), por processo. */
function marcarNaoExige(db, caminhoProcesso, naoExige, motivo, usuario) {
  const { chavePa } = require('./requisicoes');
  const p = caminhoDaPasta(db, caminhoProcesso);
  if (!p) throw new Error('Processo não encontrado — leia as pastas de novo.');
  const chave = chavePa(p.pa) || p.caminho;
  db.relatoriosMensaisConfig = db.relatoriosMensaisConfig || {};
  if (naoExige) db.relatoriosMensaisConfig[chave] = { motivo: String(motivo || '').trim().slice(0, 200) || null, por: usuario || 'Usuário', em: new Date().toISOString() };
  else delete db.relatoriosMensaisConfig[chave];
  return { processo: p.nome, naoExige: !!naoExige };
}

function gerarCsv(db, tipo) {
  const planilhaCsv = require('./planilhaCsv');
  const l = listar(db, new Date(), { comArquivos: true });
  if (tipo === 'fora_do_padrao') {
    const linhas = [];
    for (const p of l.processos) for (const a of p.arquivos.filter(x => x.foraDoPadrao)) linhas.push([p.contrato ? p.contrato.numero : '', p.nome, a.rel, a.nome, a.nomeSugerido || '(mês não identificado: renomear à mão)']);
    return planilhaCsv.montar(['Contrato', 'Processo', 'Pasta', 'Nome atual', 'Nome sugerido'], linhas);
  }
  if (tipo === 'faltas') {
    const linhas = [];
    for (const p of l.processos) {
      if (!p.cobertura) continue;
      for (const m of p.cobertura.faltando) linhas.push([p.contrato ? p.contrato.numero : '', p.contrato ? p.contrato.empresa : '', p.nome, p.pa, `${m.slice(5)}/${m.slice(0, 4)}`]);
    }
    return planilhaCsv.montar(['Contrato', 'Empresa', 'Processo', 'PA', 'Mês sem relatório'], linhas);
  }
  const linhas = [];
  for (const p of l.processos) for (const a of p.arquivos) {
    linhas.push([p.contrato ? p.contrato.numero : '', p.nome, p.pa, a.competencia ? `${a.competencia.slice(5)}/${a.competencia.slice(0, 4)}` : '', ROTULO_TIPO[a.tipo] || a.tipo, a.nome, a.rel,
      planilhaCsv.formatarValor({ tipo: 'data' }, a.modificadoEm.slice(0, 10))]);
  }
  return planilhaCsv.montar(['Contrato', 'Processo', 'PA', 'Mês', 'Tipo', 'Arquivo', 'Pasta', 'Modificado em'], linhas);
}

module.exports = { nomeSugerido, competenciaDoArquivo, tipoDoArquivo, ROTULO_TIPO, cobertura, coberturaDoContrato, lerPastasDeRelatorios, ler, listar, processo, arquivoPorId, caminhoDaPasta, marcarNaoExige, gerarCsv };
