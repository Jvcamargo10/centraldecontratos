/* ===================================================================
   integrations/requisicoes.js

   Requisições dos contratos, lidas dos documentos da pasta de rede
   (29/09/2026) — o mesmo caminho dos contratos e do Mapa de risco: ler o
   documento e extrair as informações, por regra, com a frase como prova.
   Duas origens, separadas (decisão do usuário):

   1. TCE-SP — o que o SGC chama de "requisição" (32 cadastradas lá): a
      requisição de documentos do Tribunal de Contas e o que a acompanha
      (ofício de resposta da Prefeitura, relatório de fiscalização). O
      formulário "Cadastrar Requisição" do SGC pede: Contrato, Requisição
      (nº), Data, Observações, TC, Ofício e Arquivo — é a FICHA DE CADASTRO
      que esta ferramenta monta. Na pasta, esses documentos não têm lugar
      fixo: ficam em "16. Outros documentos", "Requisições TCE",
      "Tribunal de Contas", "17. Pagamentos"...; são achados pelo nome da
      pasta ou do arquivo (TCE, TCESP, Tribunal de Contas).

   2. SisFin — a requisição do sistema contábil, na subpasta
      "19. Sisfin / 1. Requisição" de cada processo. Dois layouts:
        - RC (Requisição de Serviços): itens com quantidade, unidade, valor
          unitário e estimado, dotação, elemento da despesa, valor a
          reservar, justificativa;
        - AD (Alteração Contratual — renovação, reajuste): fornecedor,
          licitação, AF/OS, situação, itens com o tipo de alteração,
          valor total e reservado, programação mensal de pagamento.
      Texto digital (não precisa de OCR). O SGC não tem este cadastro.

   O nome de quem cadastrou no SisFin (login e nome completo, no rodapé
   de cada página) NÃO é guardado: não serve ao controle do contrato.
=================================================================== */
const fs = require('fs');
const path = require('path');
const { hojeLocal } = require('./dataLocal');
const percurso = require('./percursoPastas');

const MESES = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };
const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const limparLinha = s => String(s || '').replace(/[\t ]+/g, ' ').trim();
const dataIso = (d, m, a) => {
  const [D, M, A] = [Number(d), Number(m), Number(a)];
  if (!(D >= 1 && D <= 31 && M >= 1 && M <= 12 && A >= 1990 && A <= 2100)) return null;
  return `${A}-${String(M).padStart(2, '0')}-${String(D).padStart(2, '0')}`;
};
const dataBrParaIso = s => { const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s || ''); return m ? dataIso(m[1], m[2], m[3]) : null; };
// "1.409.102,64" -> 1409102.64
const numeroBr = s => {
  if (s === undefined || s === null) return null;
  const n = Number(String(s).replace(/\s/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
// "7622" + "2022" -> "07.622/2022" (o formato do PA no cadastro)
function formatarPa(numero, ano) {
  const n = String(numero || '').replace(/\D/g, '');
  if (!n || !ano) return null;
  const p = n.padStart(5, '0');
  return `${p.slice(0, -3)}.${p.slice(-3)}/${ano}`;
}
// "P.A. 07.622_2022 - SIGMA ..." -> "07.622/2022"
function paDaPasta(nome) {
  const m = /^P\.?\s*A\.?\s*(\d{1,2})\.?(\d{3})\s*[_\/-]\s*(\d{4})/i.exec(String(nome || ''));
  return m ? formatarPa(m[1] + m[2], m[3]) : null;
}
const chavePa = pa => { const m = /(\d{1,2})\.?(\d{3})\s*[\/_-]\s*(\d{4})/.exec(String(pa || '')); return m ? `${Number(m[1] + m[2])}/${m[3]}` : null; };
// Linha do texto onde está a posição `i` — a prova de onde saiu o campo.
function linhaEm(texto, i) {
  if (i < 0) return '';
  const ini = texto.lastIndexOf('\n', i) + 1;
  const fim = texto.indexOf('\n', i);
  return limparLinha(texto.slice(ini, fim < 0 ? undefined : fim)).slice(0, 240);
}

/* ------------------------------------------------------------------
   SisFin
   ------------------------------------------------------------------ */
// Unidade com acento ("MÊS") e quantidade cortada pelo PDF ("75.000.000,") também valem.
const RE_ITEM_RC = /^([\d.]+,\d{0,3})\s+([A-ZÀ-Ý0-9²³]{1,5})\s+([\d.]+,\d{2,4})\s+(\d{1,3})\s+([\d.]+,\d{2,4})\s+(\d\.\d{2}\.\d{2}\.\d{4}-\d)$/;
// AD: o "Valor Total" do item às vezes sai numa coluna à parte (fica quantidade × valor).
const RE_ITEM_AD = /^(\d\.\d{2}\.\d{2}\.\d{4}-\d)\s+(\S+)\s+(.+?)\s+([\d.]+,\d{3})\s+([\d.]+,\d{2,4})(?:\s+([\d.]+,\d{2}))?$/;
// RC em três linhas: "1 7.03.14.0021-0" / descrição / "UN 325,000 18.525,3846 6.020.750,00".
const RE_ITEM_RC_CAB = /^(\d{1,3})\s+(\d\.\d{2}\.\d{2}\.\d{4}-\d)$/;
const RE_ITEM_RC_VAL = /^([A-ZÀ-Ý0-9²³]{1,5})\s+([\d.]+,\d{0,3})\s+([\d.]+,\d{2,4})\s+([\d.]+,\d{2})$/;
const MES_NOMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

function lerRequisicaoSisfin(texto) {
  const t = String(texto || '');
  const linhas = t.split('\n').map(limparLinha);
  const ev = {};
  const achar = (re, campo, grupo = 1) => {
    const m = re.exec(t);
    if (!m) return null;
    if (campo) ev[campo] = linhaEm(t, m.index + m[0].indexOf(m[grupo] || m[0]));
    return m;
  };

  const tipoDocumento = /ALTERA[ÇC][ÃA]O\s+CONTRATUAL/i.test(t.slice(0, 600)) ? 'Alteração contratual'
    : /REQUISI[ÇC][ÃA]O\s+DE\s+COMPRAS?/i.test(t.slice(0, 600)) ? 'Requisição de compras'
    : /REQUISI[ÇC][ÃA]O\s+DE\s+SERVI[ÇC]OS?/i.test(t.slice(0, 600)) ? 'Requisição de serviços' : null;
  const mCodigo = /Requisi[çc][ãa]o\s*(RC|AD|RM|[A-Z]{2})\s*:/.exec(t);
  const codigo = mCodigo ? mCodigo[1] : (tipoDocumento === 'Alteração contratual' ? 'AD' : tipoDocumento ? 'RC' : null);
  if (!codigo) return null; // não é requisição do SisFin

  // Número e data: na AD vêm na mesma linha do rótulo; na RC, na linha de baixo.
  let numero = null, data = null;
  const mAd = achar(/Requisi[çc][ãa]o\s*(?:RC|AD|RM|[A-Z]{2})\s*:\s*(\d{1,5}\/\d{4})[\s\S]{0,40}?Data\s+(?:da\s+)?Requisi[çc][ãa]o\s*:\s*(\d{2}\/\d{2}\/\d{4})/i, 'numero');
  if (mAd) { numero = mAd[1]; data = dataBrParaIso(mAd[2]); }
  if (!numero && mCodigo) {
    const depois = t.slice(mCodigo.index, mCodigo.index + 260);
    const m = /(\d{1,5}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})/.exec(depois);
    if (m) { numero = m[1]; data = dataBrParaIso(m[2]); ev.numero = linhaEm(t, mCodigo.index + m.index); }
  }
  if (ev.numero) ev.data = ev.numero;

  let integracao = null;
  const mInt = achar(/Nro\s+Integra[çc][ãa]o\s*:\s*(\d{6,10})/i, 'integracao') || achar(/(\d{6,10})\s+Nro\s+Integra[çc][ãa]o/i, 'integracao');
  if (mInt) integracao = mInt[1];
  else if (mCodigo) {
    const m = /\d{2}\/\d{2}\/\d{4}\s*\n\s*(\d{6,10})\s*\n/.exec(t.slice(mCodigo.index, mCodigo.index + 300));
    if (m) { integracao = m[1]; ev.integracao = m[1]; }
  }

  const mUni = achar(/(\d{3}\.\d{3}\.\d{3}\.\d{3}\.\d{3})\s*-[\s-]*([^\n\t]+)/, 'unidade');
  const unidade = mUni ? `${mUni[1]} — ${limparLinha(mUni[2]).replace(/^-\s*/, '')}` : null;
  const mProc = achar(/Nro\s+Processo\s*:\s*(\d{1,6})\s*\/\s*(\d{4})/i, 'processo');
  const processo = mProc ? formatarPa(mProc[1], mProc[2]) : null;
  const mForn = achar(/Fornecedor\s*:\s*(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\s+([^\n]+)/i, 'fornecedor');
  const mLic = achar(/Licita[çc][ãa]o\s*:\s*([^\n]+)/i, 'licitacao');
  const licitacao = mLic ? limparLinha(mLic[1]).replace(/\s*(Aprovado.*|Finalizado.*|Empenhad.*|Em Digita.*)$/i, '').replace(/\s*\/\s*/g, '/').trim() : null;
  let afOs = null;
  const mAf = /AF\/OS\s*:\s*(\d{1,5}\/\d{4})/i.exec(t);
  if (mAf) { afOs = mAf[1]; ev.afOs = linhaEm(t, mAf.index); }
  else if (/AF\/OS\s*:\s*\n/i.test(t)) {
    const m = /Requisitante\s*:\s*\n\s*(\d{1,5}\/\d{4})\s*\n/i.exec(t);
    if (m) { afOs = m[1]; ev.afOs = `AF/OS: ${m[1]}`; }
  }
  const mSit = achar(/(Aprovado\/Liberado para Reserva|Finalizado|Empenhad[ao]|Em Digita[çc][ãa]o|Cancelad[ao]|Reprovad[ao]|Aguardando [A-Za-zçã ]{3,30})/, 'situacao');
  const situacao = mSit ? mSit[1] : null;

  const dotacoes = [...new Set([...t.matchAll(/(\d{4})\s*-\s*(\d{3,5})\s+V[íi]nculo\s*:\s*([\d.]+)/gi)].map(m => `${m[1]} - ${m[2]} (vínculo ${m[3]})`))];
  if (dotacoes.length) ev.dotacoes = linhaEm(t, t.search(/V[íi]nculo/i));
  const mElem = achar(/Elemento da Despesa\s*:\s*([\d.]{8,14})/i, 'elementoDespesa') || achar(/\b(3\.3\.90\.\d{2}\.\d{2})\b/, 'elementoDespesa');
  const mIni = achar(/Iniciativa estrat[ée]gica\s*:\s*([^\n\t]+)/i, 'iniciativa');

  let valorTotal = null, valorReservado = null;
  if (codigo === 'AD') {
    // Na MESMA linha do rótulo ([ \t], não \s): "Valor Total:\nR$ X" seria o reservado da linha de baixo.
    const mTot = achar(/Valor Total[ \t]*:[ \t]*R\$[ \t]*([\d.]+,\d{2})/i, 'valorTotal') || achar(/Valor Total do Requisitante[ \t]*:[ \t]*R\$[ \t]*([\d.]+,\d{2})/i, 'valorTotal');
    const mRes = achar(/Valor Total Reservado[ \t]*:[ \t]*R\$[ \t]*([\d.]+,\d{2})/i, 'valorReservado') || achar(/Valor Total Reservado do Requisitante[ \t]*:[ \t]*R\$[ \t]*([\d.]+,\d{2})/i, 'valorReservado');
    valorTotal = mTot ? numeroBr(mTot[1]) : null;
    valorReservado = mRes ? numeroBr(mRes[1]) : null;
    // "Valor Total Reservado:\nValor Total:\nR$ X\nR$ Y" (os valores numa linha de baixo).
    const mBaixo = /Valor Total Reservado\s*:\s*\n\s*Valor Total\s*:\s*\n\s*R\$\s*([\d.]+,\d{2})\s*\n\s*R\$\s*([\d.]+,\d{2})/i.exec(t);
    if (mBaixo) {
      if (valorReservado === null) { valorReservado = numeroBr(mBaixo[1]); ev.valorReservado = `Valor Total Reservado: R$ ${mBaixo[1]}`; }
      if (valorTotal === null) { valorTotal = numeroBr(mBaixo[2]); ev.valorTotal = `Valor Total: R$ ${mBaixo[2]}`; }
    }
  } else {
    const mTot = achar(/Estimativa de Custo Total\s*([\d.]+,\d{2,4})/i, 'valorTotal');
    valorTotal = mTot ? Math.round(numeroBr(mTot[1]) * 100) / 100 : null;
    const reservas = [...t.matchAll(/Valor a ser reservado\s*R\$\s*(-?[\d.]+,\d{2})/gi)].map(m => numeroBr(m[1]));
    if (reservas.length) { valorReservado = Math.round(reservas.reduce((s, v) => s + v, 0) * 100) / 100; ev.valorReservado = `${reservas.length} reserva(s) na requisição`; }
  }

  // Itens: a linha de valores e, embaixo, a descrição (até a próxima linha de valores).
  const itens = [];
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    let item = null;
    let m = RE_ITEM_RC.exec(l);
    if (m) item = { quantidade: numeroBr(m[1]), unidade: m[2], valorEstimado: numeroBr(m[3]), item: Number(m[4]), valorUnitario: numeroBr(m[5]), codigo: m[6] };
    else if ((m = RE_ITEM_AD.exec(l))) {
      const q = numeroBr(m[4]), u = numeroBr(m[5]);
      item = { codigo: m[1], unidade: m[2], tipoAlteracao: m[3], quantidade: q, valorUnitario: u, valorEstimado: m[6] ? numeroBr(m[6]) : Math.round(q * u * 100) / 100 };
    } else if ((m = RE_ITEM_RC_CAB.exec(l))) {
      // A linha de valores vem logo abaixo, depois de 1 ou 2 linhas de descrição.
      for (let j = i + 1; j <= i + 4 && j < linhas.length; j++) {
        const v = RE_ITEM_RC_VAL.exec(linhas[j]);
        if (!v) continue;
        itens.push({ item: Number(m[1]), codigo: m[2], unidade: v[1], quantidade: numeroBr(v[2]), valorUnitario: numeroBr(v[3]), valorEstimado: numeroBr(v[4]),
          descricao: linhas.slice(i + 1, j).join(' ').slice(0, 300) });
        break;
      }
      continue;
    }
    if (!item) continue;
    const desc = [];
    for (let j = i + 1; j < linhas.length && desc.length < 2; j++) {
      const p = linhas[j];
      if (!p || RE_ITEM_RC.test(p) || RE_ITEM_AD.test(p) || /^(Estimativa|Valor|R\$|Local de Entrega|\[p[áa]gina)/i.test(p)) break;
      desc.push(p);
    }
    item.descricao = desc.join(' ').slice(0, 300);
    itens.push(item);
  }
  // Documento com várias páginas de especificação técnica repete a tabela? Não: tira duplicata exata.
  const vistos = new Set();
  const itensUnicos = itens.filter(x => { const k = `${x.codigo}|${x.quantidade}|${x.valorEstimado}`; if (vistos.has(k)) return false; vistos.add(k); return true; });

  // Programação mensal de pagamento (AD): total de cada ano.
  const programacao = [];
  for (const m of t.matchAll(/Per[íi]odo\s+(\d{4})/gi)) {
    const bloco = t.slice(m.index, m.index + 900);
    const meses = MES_NOMES.map(nome => {
      const r = new RegExp(`${nome.replace('ç', '[çc]')}\\s+(?:R\\$\\s*)?([\\d.]+,\\d{2})`, 'i').exec(bloco);
      return r ? numeroBr(r[1]) : null;
    });
    const tot = /\bTotal\s+(?:R\$\s*)?([\d.]+,\d{2})/i.exec(bloco);
    const soma = meses.reduce((s, v) => s + (v || 0), 0);
    if (meses.some(v => v !== null)) programacao.push({ ano: Number(m[1]), meses, total: tot ? numeroBr(tot[1]) : Math.round(soma * 100) / 100 });
  }

  let justificativa = null;
  const mJus = /Justificativa do Servi[çc]o\s*\n([\s\S]{20,1200}?)(?:\n\s*\n|\[p[áa]gina|$)/i.exec(t);
  if (mJus) justificativa = limparLinha(mJus[1].replace(/\n/g, ' ')).slice(0, 600);

  // Quando o SisFin imprimiu esta versão (rodapé): ordena as versões da mesma requisição.
  const mEmi = /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2}:\d{2})/.exec(t);
  const emitidoEm = mEmi ? `${mEmi[3]}-${mEmi[2]}-${mEmi[1]}T${mEmi[4]}` : null;

  const campos = {
    tipoDocumento, codigo, emitidoEm, numero, data, integracao, unidade, processo,
    fornecedorCnpj: mForn ? mForn[1] : null,
    fornecedor: mForn ? limparLinha(mForn[2]) : null,
    licitacao, afOs, situacao, dotacoes,
    elementoDespesa: mElem ? mElem[1] : null,
    iniciativa: mIni ? limparLinha(mIni[1]) : null,
    valorTotal, valorReservado, justificativa
  };
  // A prova não leva o login de quem cadastrou no SisFin (dado pessoal, sem uso aqui).
  for (const k of Object.keys(ev)) ev[k] = ev[k].replace(/\s*Usu[áa]rio Cadastro\s*:\s*\S+/i, '').trim();
  return { campos, itens: itensUnicos, programacao, evidencias: ev };
}

/* ------------------------------------------------------------------
   TCE-SP
   ------------------------------------------------------------------ */
// "TC-025938.989.20-9", "TC 0011549.989.20-0", "e-TCE nº 9175.989.20-1" -> "025938.989.20-9"
// "IC 007818.989.20-4": o OCR lê o T como I.
const RE_TC = /\b(?:e-?)?[TI]\.?\s?C\.?(?:E\.?)?(?:[-\s]*SP)?[\s\-–:nº°.]*?(\d{4,8})\s*\.\s*989\s*\.\s*(\d{2})(?:\s*[-.]\s*(\d))?/gi;
function formatarTc(num, ano, dig) {
  const n = String(Number(num)).padStart(6, '0');
  return `${n}.989.${ano}${dig ? `-${dig}` : ''}`;
}

/* O tipo pelo CABEÇALHO: a requisição do Tribunal começa com
   "REQUISIÇÃO DE DOCUMENTOS"; o ofício da Prefeitura que responde a ela
   também cita a requisição, mais abaixo — por isso a ordem importa. */
function tipoDoDocumentoTce(t, nome) {
  const topo = t.replace(/\[p[áa]gina \d+\]/g, '').trim().slice(0, 220);
  const cab = t.slice(0, 700);
  if (/^\W*REQUISI[ÇC][ÃA]O\s+DE\s+DOCUMENTOS/i.test(topo)) return 'Requisição de documentos';
  if (/Of[íi]cio|\bOF\.?\s*\d/i.test(topo) || /^of\.?\s*\d/i.test(nome)) return 'Ofício de resposta';
  if (/TRIBUNAL DE CONTAS DO ESTADO/i.test(cab) && /EXAME|ACOMPANHAMENTO|FISCALIZA|RELAT[ÓO]RIO/i.test(cab)) return 'Relatório de fiscalização';
  if (/DECLARA[ÇC][ÃA]O/i.test(cab) || /^declara/i.test(nome)) return 'Declaração';
  if (/RESPOSTA/i.test(topo) || /resposta/i.test(nome)) return 'Resposta ao TCE';
  return 'Outro documento';
}

function lerDocumentoTce(texto, nomeArquivo) {
  const t = String(texto || '');
  const nome = String(nomeArquivo || '');
  const tudo = `${nome}\n${t}`;
  // Sem nenhuma menção ao Tribunal: é anexo (relatório de instalação, termo de encerramento...).
  if (!/Tribunal de Contas|\bTCE\b|TCESP|e-?TCE|\bT\.?C\.?[-\s]*\d{4,8}\s*\.\s*989/i.test(tudo)) return null;
  const ev = {};
  const tipo = tipoDoDocumentoTce(t, nome);

  // TC: o do processo de acompanhamento vale mais do que o do contrato.
  const tcs = [];
  for (const m of tudo.matchAll(RE_TC)) {
    const tc = formatarTc(m[1], m[2], m[3]);
    const semDig = tc.replace(/-\d$/, '');
    const igual = tcs.find(x => x.tc.replace(/-\d$/, '') === semDig);
    if (igual) { if (!/-\d$/.test(igual.tc) && m[3]) igual.tc = tc; continue; }
    const i = m.index - nome.length - 1;
    const contexto = i >= 0 ? t.slice(Math.max(0, i - 60), i) : '';
    tcs.push({ tc, i, proprio: i < 0 || i < 80, acompanhamento: /acompanhamento|instruir o processo|Refer[êe]nte|Assunto|Resposta [àa]/i.test(contexto) });
  }
  // O TC do próprio documento (no nome do arquivo ou no topo do texto) >
  // o do assunto/acompanhamento > o primeiro citado. O do contrato ("TC
  // do contrato", "Evento 1.20 do TC-...") fica entre os "outros".
  const principal = tcs.find(x => x.proprio) || tcs.find(x => x.acompanhamento) || tcs.find(x => x.i >= 0) || tcs[0] || null;
  if (principal) ev.tc = principal.i >= 0 ? linhaEm(t, principal.i) : `nome do arquivo: ${nome}`;

  // Número da requisição.
  let requisicao = null;
  let m = /REQUISI[ÇC][ÃA]O\s+DE\s+DOCUMENTOS\s+((?:DF|UR|GDF)[-\s]?\d+(?:\.\d+)?)?\s*n[º°o.]*\s*(\d{1,4}\s*\/\s*\d{4})/i.exec(t);
  if (m) { requisicao = `${m[1] ? m[1].replace(/\s/g, '-') + ' ' : ''}nº ${m[2].replace(/\s/g, '')}`; ev.requisicao = linhaEm(t, m.index); }
  if (!requisicao && (m = /requisi[çc][ãa]o\s+(?:de\s+documentos\s+)?(?:TCE[-\s/]*SP\s+)?n[º°o.]*\s*(\d{1,4}\s*\/\s*\d{4})/i.exec(t))) { requisicao = `nº ${m[1].replace(/\s/g, '')}`; ev.requisicao = linhaEm(t, m.index); }
  if (!requisicao && (m = /\bReq(?:uisi[çc][ãa]o)?\.?\s*(?:TCE[._\s-]*SP\s*)?(\d{1,4})[\s._](\d{4})/i.exec(nome))) { requisicao = `nº ${m[1]}/${m[2]}`; ev.requisicao = `nome do arquivo: ${nome}`; }
  if (!requisicao && (m = /\b([A-Z]{2,4})\s+(\d{1,3})[._/](\d{4})\b/.exec(nome)) && !/^(TC|PA|OF|TA|NF|PM)$/i.test(m[1])) { requisicao = `${m[1]} ${m[2]}/${m[3]}`; ev.requisicao = `nome do arquivo: ${nome}`; }

  // Ofício: número do ofício da Prefeitura e/ou protocolo digital (12 dígitos, o "Ofício" do SGC).
  let oficio = null, protocolo = null;
  if ((m = /Of[íi]cio\s+((?:[A-Z]{2,5}\/?[A-Z]{0,4}\s+)?n[º°o.]*\s*\d{1,4}\s*\/\s*\d{4})/i.exec(t))) {
    oficio = limparLinha(m[1]).replace(/\bno\b\.?/i, 'nº').replace(/nº\s*0+(\d)/, 'nº $1');
    ev.oficio = linhaEm(t, m.index);
    if (/nº\s*0\s*\//.test(oficio)) { oficio = null; delete ev.oficio; } // "Ofício nº 000/2020": modelo, número ainda não dado
  }
  else if ((m = /^\s*Of\.?\s*(\d{1,4})[\s._-]+(\d{2,4})\b/i.exec(nome))) { oficio = `nº ${m[1]}/${m[2].length === 2 ? '20' + m[2] : m[2]}`; ev.oficio = `nome do arquivo: ${nome}`; }
  if ((m = /protocolo(?:\s+digital)?\s*(?:n[º°o.]*)?\s*(\d{12})\b/i.exec(t))) { protocolo = m[1]; ev.protocolo = linhaEm(t, m.index); }

  // Data: "Itaverde, 28 de junho de 2021"; senão a primeira dd/mm/aaaa.
  let data = null;
  // "DF-5.4, 09 de outubro de 2020." — a data da requisição do Tribunal vem assim, no fim.
  if ((m = /(?:Itaverde|S[ãa]o Paulo|\bDF\s*-?\s*\d+(?:\.\d+)?|\bUR\s*-?\s*\d+|\bGDF\s*-?\s*\d+)\s*,?\s*(\d{1,2})\s+de\s+([A-Za-zçÇ]+)\s+de\s+(\d{4})/i.exec(t))) {
    const mes = MESES[semAcento(m[2]).toLowerCase().replace('malo', 'maio')];
    if (mes) { data = dataIso(m[1], mes, m[3]); ev.data = linhaEm(t, m.index); }
  }
  // Relatório do Tribunal: só "Realizada em dd/mm/aaaa" — as outras datas dele são
  // de termos, empenhos e publicações citados.
  if (!data && tipo === 'Relatório de fiscalização' && (m = /Realizad[ao]\s+em\s+(\d{2})\/(\d{2})\/(\d{4})/i.exec(t))) {
    data = dataIso(m[1], m[2], m[3]); ev.data = linhaEm(t, m.index);
  }
  // Senão a primeira dd/mm/aaaa plausível (não a de uma resolução de 2003 citada no texto).
  if (!data && tipo !== 'Relatório de fiscalização') {
    for (const d of t.matchAll(/\b(\d{2})[./](\d{2})[./](\d{4})\b/g)) {
      // Data do contrato, da vigência ou da assinatura citada não é a data do documento
      // (a requisição 107/2020 saía com a data do contrato 058/2020).
      if (/contrato|vig[êe]ncia|assinatura|evento|prazo|empenho|\bNE\b|R\$|\d{2}\/\d{2}\/\d{4}\s*a\s*\d/i.test(linhaEm(t, d.index))) continue;
      const iso = dataIso(d[1], d[2], d[3]);
      if (iso && iso >= '2010-01-01' && iso <= `${new Date().getFullYear() + 1}-12-31`) { data = iso; ev.data = linhaEm(t, d.index); break; }
    }
  }

  // Prazo que o Tribunal deu para responder ("PRAZO DE ENTREGA: 19/10/2020").
  let prazo = null;
  if ((m = /PRAZO(?:\s+DE\s+ENTREGA|\s+PARA\s+(?:RESPOSTA|ATENDIMENTO))?\s*:?\s*(\d{2})\/(\d{2})\/(\d{4})/i.exec(t))) { prazo = dataIso(m[1], m[2], m[3]); ev.prazo = linhaEm(t, m.index); }

  // Contrato citado.
  let contrato = null;
  if ((m = /Contrato\s*(?:de\s+Presta[çc][ãa]o\s+de\s+Servi[çc]os\s*)?(?:\(?origem\)?\s*)?(?:n[º°o.]*|N[úu]mero(?:\s+do\s+Contrato)?\s*:?)\s*[.:]?\s*(\d{1,3})\s*\/\s*(\d{4})/i.exec(t))
    || (m = /N[úu]mero do Contrato\s*:\s*(\d{1,3})\s*\/\s*(\d{4})/i.exec(t))) {
    contrato = `${m[1].padStart(3, '0')}/${m[2]}`; ev.contrato = linhaEm(t, m.index);
  }
  const mContratada = /Contratad[ao]\s*:\s*([^\n]{4,120})/i.exec(t);
  const mAssunto = /\b(?:Assunto|Referente|Ref)\s*:\s*([^\n]{5,220})/i.exec(t);
  const mDiretoria = /(\d)\s*[ªºa°]?\s*DIRETORIA\s+DE\s+FISCALIZA[ÇC][ÃA]O\s*[-–]?\s*(DF\s*-?\s*\d(?:\.\d)?)?/i.exec(t);
  const assunto = mAssunto ? limparLinha(mAssunto[1]).replace(/^[-–\s]+/, '') : null;
  if (mAssunto) ev.assunto = linhaEm(t, mAssunto.index);

  const campos = {
    tipo, requisicao, tc: principal ? principal.tc : null,
    outrosTcs: tcs.filter(x => x !== principal).map(x => x.tc),
    oficio, protocolo, data, prazo, contrato,
    contratada: mContratada ? limparLinha(mContratada[1]).replace(/[|].*$/, '').trim() : null,
    diretoria: mDiretoria ? limparLinha(`${mDiretoria[1]}ª Diretoria de Fiscalização${mDiretoria[2] ? ' — ' + mDiretoria[2].replace(/\s/g, '') : ''}`) : null,
    assunto
  };
  // Os itens que o Tribunal pede — base do "onde está a resposta" (direcionamentoRequisicao.js).
  const itensPedidos = require('./direcionamentoRequisicao').lerItensPedidos(t);
  return { campos, evidencias: ev, itensPedidos };
}

/* A ficha do formulário "Cadastrar Requisição" do SGC, a partir do que
   foi lido (ou conferido). "Ofício" no SGC é o número do protocolo
   digital; sem protocolo, vai o número do ofício. */
function fichaSgc(reg, contratoCadastrado) {
  const c = { ...(reg.campos || {}), ...(reg.camposConferidos || {}) };
  const prazoBr = c.prazo ? `prazo de entrega ${c.prazo.split('-').reverse().join('/')}` : null;
  const obs = c.observacoes !== undefined ? c.observacoes
    : [c.tipo, c.assunto, c.diretoria, prazoBr].filter(Boolean).join(' — ').slice(0, 250);
  return {
    contrato: (reg.camposConferidos && reg.camposConferidos.contrato) || contratoCadastrado || c.contrato || null,
    requisicao: c.requisicao || null,
    data: c.data || null,
    observacoes: obs || null,
    tc: c.tc || null,
    oficio: c.protocolo || c.oficio || null,
    arquivo: reg.nome
  };
}

/* ------------------------------------------------------------------
   Onde estão os documentos
   ------------------------------------------------------------------ */
const RE_PASTA_TCE = /\bTCE\b|TCESP|TCE[-_ ]?SP|tribunal de contas|requisi[çc][ãa]o de documento/i;
const ehModelo = nome => /\b(modelo|minuta)\b|x{2,}[_\s]x{2,}|n[º°]\s*x{2,}/i.test(nome);
const PASTAS_IGNORADAS = ['$recycle.bin', 'system volume information', '.git', 'node_modules'];

/* Percorre as raízes configuradas (CONTRATOS_ARQUIVOS_PASTAS): cada pasta
   "P.A. ..." é um processo. Devolve os documentos de requisição de cada um.
   Assíncrona desde 06/10/2026: antes lia a rede travando o servidor (as
   telas paravam até terminar) e uma pasta por vez; agora lê até 8 ao
   mesmo tempo (percursoPastas.js), com o resultado na mesma ordem. */
async function localizarDocumentos(raizes) {
  const achados = [];
  const avisos = [];
  const lerDir = async d => { try { return await percurso.lerPasta(d); } catch (e) { return null; } };
  const dentroDoProcesso = async (pasta, prof, pa, processo, noSisfin) => percurso.emOrdem((await lerDir(pasta)) || [], async e => {
    const c = path.join(pasta, e.name);
    if (e.isDirectory()) {
      return prof < 6 && !PASTAS_IGNORADAS.includes(e.name.toLowerCase()) ? dentroDoProcesso(c, prof + 1, pa, processo, noSisfin || /sisfin/i.test(e.name)) : null;
    }
    // O nome como é mostrado: a pasta de rede guarda alguns com o acento
    // decomposto ("c" + cedilha), que o PDF da ficha escrevia como "c2v".
    const nome = e.name.normalize('NFC');
    if (!/\.(pdf|docx)$/i.test(nome) || /^~\$/.test(nome) || ehModelo(nome)) return null;
    const rel = path.relative(processo, c);
    if (noSisfin) {
      // Na pasta do SisFin: a subpasta "1. Requisição" ou arquivo com "requisição"/"RQ_" no nome.
      const depoisDoSisfin = rel.split(/sisfin/i).slice(1).join('');
      return /requisi|(^|[\\/])(RQ|QR)_/i.test(depoisDoSisfin) ? [{ origem: 'sisfin', caminho: c, nome, pa, processo }] : null;
    }
    return RE_PASTA_TCE.test(rel) ? [{ origem: 'tce', caminho: c, nome, pa, processo }] : null;
  });
  // Devolve { achados, avisos } na ordem das pastas.
  const procurarProcessos = async (pasta, prof) => {
    const ents = await lerDir(pasta);
    if (!ents) return { achados: [], avisos: [`Pasta sem acesso agora: "${pasta}".`] };
    const partes = await Promise.all(ents.map(async e => {
      if (!e.isDirectory() || PASTAS_IGNORADAS.includes(e.name.toLowerCase())) return null;
      const c = path.join(pasta, e.name);
      if (/^P\.?\s*A\.?\s*\d/i.test(e.name)) return { achados: await dentroDoProcesso(c, 0, paDaPasta(e.name), c, false), avisos: [] };
      return prof < 2 ? procurarProcessos(c, prof + 1) : null;
    }));
    const res = { achados: [], avisos: [] };
    for (const p of partes) if (p) { res.achados.push(...p.achados); res.avisos.push(...p.avisos); }
    return res;
  };
  for (const r of raizes || []) {
    if (!fs.existsSync(r)) { avisos.push(`Pasta configurada não encontrada (ou sem acesso agora): "${r}".`); continue; }
    const achado = await procurarProcessos(r, 0);
    achados.push(...achado.achados); avisos.push(...achado.avisos);
  }
  return { achados, avisos };
}

const categoriaDoCaminho = c => /contratos\s+encerrados/i.test(c) ? 'encerrado' : /outras\s+secretarias/i.test(c) ? 'outra_secretaria' : 'vigencia';
const assinatura = async c => { try { const s = await percurso.statArquivo(c); return `${s.size}:${Math.round(s.mtimeMs)}`; } catch (e) { return null; } };

/* ------------------------------------------------------------------
   Leitura (em segundo plano, com andamento)
   ------------------------------------------------------------------ */
let progresso = { emAndamento: false };
function obterProgresso() { return { ...progresso }; }

async function lerTodas(db, save, opcoes = {}) {
  const extratorDocumento = opcoes.extratorDocumento || require('./extratorDocumento');
  const raizes = opcoes.raizes || require('./servidorArquivos').statusPublico().pastas;
  const { achados, avisos } = await localizarDocumentos(raizes);
  if (!raizes.length) throw new Error('Nenhuma pasta de rede configurada (CONTRATOS_ARQUIVOS_PASTAS).');
  if (!achados.length && avisos.length) throw new Error(avisos.join(' '));
  progresso = { emAndamento: true, total: achados.length, feitos: 0, atual: null, iniciadoEm: new Date().toISOString() };
  const anteriores = new Map((db.requisicoesLidas || []).map(r => [r.caminho, r]));
  const novos = [];
  const resumo = { documentos: achados.length, sisfin: 0, tce: 0, anexos: 0, semTexto: 0, erros: [], avisos };
  for (const a of achados) {
    progresso.atual = a.nome;
    try {
      let r = await extratorDocumento.extrairTexto(a.caminho);
      // Texto lido antes da correção da máscara (29/09/2026): o TC tinha virado "[CPF removido]".
      if (a.origem === 'tce' && r && /\b[TI]\.?C[^\n]{0,12}\[CPF removido\]/.test(String(r.texto || ''))) {
        r = await extratorDocumento.extrairTexto(a.caminho, { ignorarCache: true });
      }
      if (!r || r.semTexto || !String(r.texto || '').trim()) { resumo.semTexto++; continue; }
      const lido = a.origem === 'sisfin' ? lerRequisicaoSisfin(r.texto) : lerDocumentoTce(r.texto, a.nome);
      if (!lido) { resumo.anexos++; continue; }
      resumo[a.origem]++;
      const antes = anteriores.get(a.caminho);
      novos.push({
        id: antes ? antes.id : null,
        origem: a.origem, caminho: a.caminho, nome: a.nome, pa: a.pa, categoria: categoriaDoCaminho(a.caminho),
        assinatura: await assinatura(a.caminho), porOcr: !!(r.ocr && r.ocr.tentado), lidoEm: new Date().toISOString(),
        campos: lido.campos, itens: lido.itens || [], programacao: lido.programacao || [], evidencias: lido.evidencias || {},
        processo: a.processo, itensPedidos: lido.itensPedidos || []
      });
    } catch (e) {
      resumo.erros.push({ arquivo: a.nome, mensagem: e.message });
    } finally {
      progresso.feitos++;
    }
  }
  // Ids estáveis: o mesmo arquivo mantém o id; os novos recebem o próximo.
  let proximo = Math.max(0, ...(db.requisicoesLidas || []).map(r => Number(r.id) || 0)) + 1;
  novos.forEach(n => { if (!n.id) n.id = proximo++; });
  db.requisicoesLidas = novos;
  db.integracoes = db.integracoes || {};
  db.integracoes.requisicoes = { ultimaLeitura: new Date().toISOString(), ultimoResumo: { ...resumo, erros: resumo.erros.length } };
  save();
  return resumo;
}

function iniciarLeitura(db, save, aoTerminar, opcoes) {
  if (progresso.emAndamento) throw new Error('A leitura das requisições já está em andamento.');
  progresso = { emAndamento: true, total: 0, feitos: 0, atual: 'procurando os documentos nas pastas', iniciadoEm: new Date().toISOString() };
  lerTodas(db, save, opcoes)
    .then(resumo => { progresso = { emAndamento: false, ultimoResumo: resumo, concluidoEm: new Date().toISOString() }; if (aoTerminar) aoTerminar(null, resumo); })
    .catch(err => { progresso = { emAndamento: false, ultimoErro: err.message, concluidoEm: new Date().toISOString() }; if (aoTerminar) aoTerminar(err); });
  return obterProgresso();
}

/* ------------------------------------------------------------------
   Agrupamento, vínculo com o contrato e conferência
   ------------------------------------------------------------------ */
const soDigitosDaReq = r => { const m = /(\d{1,4})\s*\/\s*(\d{4})/.exec(r || ''); return m ? `${Number(m[1])}/${m[2]}` : null; };
function chaveDoGrupo(reg) {
  const c = reg.campos || {};
  if (reg.origem === 'sisfin') return `SM:${c.codigo || '?'}:${c.numero || reg.caminho}`;
  const req = soDigitosDaReq(c.requisicao);
  if (req) return `TCE:REQ:${req}`;
  if (c.tc) return `TCE:TC:${c.tc.replace(/-\d$/, '')}`;
  return `TCE:ARQ:${reg.caminho}`;
}
function maisFrequente(valores) {
  const n = new Map();
  valores.filter(Boolean).forEach(v => n.set(v, (n.get(v) || 0) + 1));
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}
function contratoDoGrupo(db, pa, numeroCitado) {
  const cs = db.contratos || [];
  const k = chavePa(pa);
  return (k && cs.find(c => chavePa(c.pa) === k)) || (numeroCitado && cs.find(c => c.numero === numeroCitado)) || null;
}

/* Um grupo = uma requisição: no SisFin, as versões do mesmo número (a
   mais recente vale); no TCE, a requisição e os documentos que respondem
   a ela (mesmo nº de requisição ou, sem nº, mesmo TC). */
function montarGrupos(db) {
  const grupos = new Map();
  for (const r of db.requisicoesLidas || []) {
    const k = chaveDoGrupo(r);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(r);
  }
  const conf = db.requisicoesConferencia || {};
  const saida = [];
  for (const [chave, docs] of grupos) {
    const origem = docs[0].origem;
    let campos;
    if (origem === 'sisfin') {
      docs.sort((a, b) => String(b.campos.emitidoEm || '').localeCompare(String(a.campos.emitidoEm || '')) || String(b.assinatura || '').split(':')[1] - String(a.assinatura || '').split(':')[1]);
      campos = { ...docs[0].campos };
    } else {
      const ordem = { 'Requisição de documentos': 0, 'Relatório de fiscalização': 1, 'Ofício de resposta': 2, 'Resposta ao TCE': 3, 'Declaração': 4, 'Outro documento': 5 };
      docs.sort((a, b) => (ordem[a.campos.tipo] ?? 9) - (ordem[b.campos.tipo] ?? 9) || String(a.campos.data || '').localeCompare(String(b.campos.data || '')));
      const principal = docs[0].campos;
      const deTodos = k => docs.map(d => d.campos[k]);
      campos = {
        tipo: principal.tipo,
        requisicao: principal.requisicao || maisFrequente(deTodos('requisicao')),
        tc: principal.tc || maisFrequente(deTodos('tc')),
        // A data da requisição do Tribunal; sem ela no texto, fica em branco para quem
        // confere (a data da resposta não é a da requisição). Sem a requisição na
        // pasta, vale a data do documento mais antigo do grupo.
        data: principal.data || (principal.tipo === 'Requisição de documentos' ? null : docs.map(d => d.campos.data).filter(Boolean).sort()[0] || null),
        oficio: maisFrequente(docs.filter(d => d.campos.tipo === 'Ofício de resposta').map(d => d.campos.oficio)) || maisFrequente(deTodos('oficio')),
        oficios: [...new Set(deTodos('oficio').filter(Boolean))],
        protocolo: maisFrequente(deTodos('protocolo')),
        prazo: principal.prazo || maisFrequente(deTodos('prazo')),
        contrato: maisFrequente(deTodos('contrato')),
        contratada: maisFrequente(deTodos('contratada')),
        diretoria: maisFrequente(deTodos('diretoria')),
        assunto: principal.assunto || maisFrequente(deTodos('assunto'))
      };
    }
    const pa = docs[0].pa || (origem === 'sisfin' ? campos.processo : null);
    const contrato = contratoDoGrupo(db, pa || campos.processo, campos.contrato);
    const c = conf[chave] || null;
    // Os itens pedidos: da requisição do Tribunal, se estiver na pasta; senão do
    // primeiro documento que os cita (o ofício de resposta repete as perguntas).
    const comItens = docs.find(d => d.campos.tipo === 'Requisição de documentos' && (d.itensPedidos || []).length) || docs.find(d => (d.itensPedidos || []).length);
    const grupo = {
      chave, origem, pa, categoria: docs[0].categoria,
      processo: docs[0].processo || null,
      itensPedidos: origem === 'tce' && comItens ? comItens.itensPedidos : [],
      itensDe: origem === 'tce' && comItens ? comItens.nome : null,
      contrato: contrato ? { id: contrato.id, numero: contrato.numero, empresa: contrato.empresa } : null,
      campos, camposConferidos: c && c.campos ? c.campos : null,
      status: c ? c.status : 'lida',
      conferidoPor: c ? c.por : null, conferidoEm: c ? c.em : null,
      documentos: docs.map(d => ({ id: d.id, nome: d.nome, caminho: d.caminho, tipo: d.campos.tipo || d.campos.tipoDocumento, data: d.campos.data || null, emitidoEm: d.campos.emitidoEm || null, porOcr: d.porOcr, evidencias: d.evidencias })),
      itens: origem === 'sisfin' ? docs[0].itens : undefined,
      programacao: origem === 'sisfin' ? docs[0].programacao : undefined
    };
    // "Arquivo" no SGC é um só: o documento principal (a requisição, quando está na pasta).
    grupo.ficha = origem === 'tce' ? fichaSgc({ campos: grupo.campos, camposConferidos: grupo.camposConferidos, nome: String(docs[0].nome).normalize('NFC') }, contrato ? contrato.numero : null) : null;
    if (grupo.ficha) grupo.ficha.relacionados = docs.slice(1).map(d => String(d.nome).normalize('NFC'));
    saida.push(grupo);
  }
  const data = g => (g.camposConferidos && g.camposConferidos.data) || g.campos.data || '';
  return saida.sort((a, b) => String(data(b)).localeCompare(String(data(a))));
}

function listar(db, hoje = hojeLocal()) {
  const grupos = montarGrupos(db);
  const por = o => grupos.filter(g => g.origem === o);
  return {
    // TCE: com a situação da resposta (prazo, respondida, atrasada).
    tce: por('tce').map(g => ({ ...g, resposta: respostaDoGrupo(db, g, hoje) })), sisfin: por('sisfin'),
    analisadas: (db.requisicoesAnalisadas || []).map(a => ({ ...a, resposta: respostaDaAnalise(db, a, hoje) })),
    ultimaLeitura: (db.integracoes && db.integracoes.requisicoes) || null,
    progresso: obterProgresso()
  };
}

/* Campos que quem confere pode corrigir, por origem (o resto é só leitura). */
const EDITAVEIS = {
  tce: ['requisicao', 'data', 'observacoes', 'tc', 'oficio', 'contrato'],
  sisfin: ['numero', 'data', 'processo', 'valorTotal', 'valorReservado', 'situacao']
};
function conferir(db, chave, dados, usuario) {
  const g = montarGrupos(db).find(x => x.chave === chave);
  if (!g) throw new Error('Requisição não encontrada — leia as pastas de novo.');
  const acao = String((dados || {}).acao || 'conferir');
  if (!['conferir', 'descartar', 'reabrir'].includes(acao)) throw new Error('Ação inválida.');
  db.requisicoesConferencia = db.requisicoesConferencia || {};
  if (acao === 'reabrir') { delete db.requisicoesConferencia[chave]; return { chave, status: 'lida' }; }
  const campos = {};
  for (const k of EDITAVEIS[g.origem]) {
    if (!dados.campos || dados.campos[k] === undefined) continue;
    let v = dados.campos[k] === null ? null : String(dados.campos[k]).trim().slice(0, 500);
    if (v === '') v = null;
    if (k === 'data' && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('Data inválida (use o seletor de data).');
    if ((k === 'valorTotal' || k === 'valorReservado') && v !== null) {
      // "1.409.102,64" (digitado) ou "1409102.64" (campo numérico do navegador).
      const s = String(v).replace(/\s|R\$/g, '');
      const n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s);
      if (!Number.isFinite(n)) throw new Error('Valor inválido.');
      v = n;
    }
    campos[k] = v;
  }
  db.requisicoesConferencia[chave] = { status: acao === 'descartar' ? 'descartada' : 'conferida', campos, por: usuario || 'Usuário', em: new Date().toISOString() };
  return { chave, status: db.requisicoesConferencia[chave].status, campos };
}

/* ------------------------------------------------------------------
   Ficha em PDF e planilhas
   ------------------------------------------------------------------ */
const brData = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || '—'); };
function gerarFichaPdf(grupo, destino) {
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  doc.pipe(destino);
  const f = grupo.ficha;
  doc.fontSize(16).font('Helvetica-Bold').text('Ficha de Cadastro — Requisição (TCE-SP)', { align: 'center' });
  doc.moveDown(0.3).fontSize(9).font('Helvetica').fillColor('#555')
    .text('Campos do formulário "Cadastrar Requisição" do SGC, lidos dos documentos da pasta de rede pela Central de Contratos.', { align: 'center' });
  doc.moveDown(1).fillColor('#000');
  const linha = (rotulo, valor, obrig) => {
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#444').text(`${rotulo.toUpperCase()}${obrig ? ' *' : ''}`);
    doc.fontSize(11).font('Helvetica').fillColor('#000').text(valor ? String(valor).normalize('NFC') : '—', { paragraphGap: 8 });
  };
  linha('Contrato', f.contrato, true);
  linha('Requisição', f.requisicao);
  linha('Data', f.data ? brData(f.data) : null, true);
  linha('Observações', f.observacoes);
  linha('TC', f.tc);
  linha('Ofício', f.oficio);
  linha('Arquivo', f.arquivo);
  if ((f.relacionados || []).length) {
    doc.moveDown(0.3).fontSize(8.5).font('Helvetica-Bold').fillColor('#444').text('DOCUMENTOS RELACIONADOS (respostas e anexos na pasta — fora do formulário)');
    doc.fontSize(9.5).font('Helvetica').fillColor('#000').text(f.relacionados.join('\n'), { paragraphGap: 8 });
  }
  doc.moveDown(0.8).fontSize(9).fillColor('#555');
  doc.text(grupo.status === 'conferida'
    ? `Conferida por ${grupo.conferidoPor} em ${new Date(grupo.conferidoEm).toLocaleString('pt-BR')}.`
    : 'Leitura automática, ainda NÃO conferida — confira cada campo no documento antes de cadastrar no SGC.');
  if (grupo.pa) doc.text(`Processo administrativo: ${grupo.pa}.`);
  doc.text(`Gerada em ${new Date().toLocaleString('pt-BR')}.`);
  doc.end();
}

function gerarCsv(db, origem) {
  const planilhaCsv = require('./planilhaCsv');
  const grupos = montarGrupos(db).filter(g => g.origem === origem && g.status !== 'descartada');
  const val = (g, k) => (g.camposConferidos && g.camposConferidos[k] !== undefined ? g.camposConferidos[k] : g.campos[k]);
  if (origem === 'tce') {
    return planilhaCsv.montar(
      ['Contrato', 'Requisição', 'Data', 'Observações', 'TC', 'Ofício', 'Arquivo', 'Tipo', 'Diretoria', 'Processo (PA)', 'Situação na Central'],
      grupos.map(g => [g.ficha.contrato, g.ficha.requisicao, planilhaCsv.formatarValor({ tipo: 'data' }, g.ficha.data), g.ficha.observacoes, g.ficha.tc, g.ficha.oficio, g.ficha.arquivo,
        g.campos.tipo, g.campos.diretoria, g.pa, g.status === 'conferida' ? 'Conferida' : 'A conferir']));
  }
  return planilhaCsv.montar(
    ['Requisição', 'Tipo', 'Data', 'Processo (PA)', 'Contrato', 'Fornecedor', 'CNPJ', 'Licitação', 'AF/OS', 'Situação no SisFin', 'Valor total', 'Valor reservado', 'Dotações', 'Elemento da despesa', 'Nº integração', 'Unidade requisitante', 'Arquivo', 'Situação na Central'],
    grupos.map(g => [`${g.campos.codigo} ${val(g, 'numero') || ''}`.trim(), g.campos.tipoDocumento, planilhaCsv.formatarValor({ tipo: 'data' }, val(g, 'data')), val(g, 'processo') || g.pa,
      g.contrato ? g.contrato.numero : '', g.campos.fornecedor, g.campos.fornecedorCnpj, g.campos.licitacao, g.campos.afOs, val(g, 'situacao'),
      planilhaCsv.formatarValor({ tipo: 'valor' }, val(g, 'valorTotal')), planilhaCsv.formatarValor({ tipo: 'valor' }, val(g, 'valorReservado')),
      (g.campos.dotacoes || []).join(' | '), g.campos.elementoDespesa, g.campos.integracao, g.campos.unidade, g.documentos[0].nome,
      g.status === 'conferida' ? 'Conferida' : 'A conferir']));
}

/* ------------------------------------------------------------------
   Prazo e situação da resposta ao Tribunal (01/10/2026)
   ------------------------------------------------------------------
   A Central lê o "PRAZO DE ENTREGA" da requisição; aqui ela passa a
   dizer se a resposta está em dia. "Respondida": marcada por quem
   responde (data e ofício/protocolo) ou, na pasta, quando o grupo já tem
   o ofício de resposta. Requisição antiga (prazo há mais de 90 dias) sem
   resposta registrada não vira alerta — é histórico. */
const DIAS_AVISO = 5;
const DIAS_HISTORICO = 90;
const diasAte = (iso, hoje) => { const [a, m, d] = String(iso).split('-').map(Number); const [h1, h2, h3] = hoje.split('-').map(Number); return Math.round((Date.UTC(a, m - 1, d) - Date.UTC(h1, h2 - 1, h3)) / 86400000); };

function situacaoResposta({ prazo, manual, oficioNaPasta }, hoje) {
  if (manual) return { situacao: 'respondida', rotulo: `Respondida em ${String(manual.em || '').split('-').reverse().join('/')}`, fonte: 'registrada', dias: null };
  if (oficioNaPasta) return { situacao: 'respondida', rotulo: 'Respondida (ofício de resposta na pasta)', fonte: 'pasta', dias: null };
  if (!prazo) return { situacao: 'sem_prazo', rotulo: 'Sem prazo no documento', dias: null };
  const dias = diasAte(prazo, hoje);
  if (dias < -DIAS_HISTORICO) return { situacao: 'historico', rotulo: 'Antiga, sem resposta registrada', dias };
  if (dias < 0) return { situacao: 'atrasada', rotulo: `Atrasada há ${-dias} dia(s)`, dias };
  if (dias <= DIAS_AVISO) return { situacao: 'vence_logo', rotulo: dias === 0 ? 'Vence hoje' : `Vence em ${dias} dia(s)`, dias };
  return { situacao: 'no_prazo', rotulo: `No prazo (${dias} dias)`, dias };
}

function respostaDoGrupo(db, g, hoje) {
  const manual = (db.requisicoesResposta || {})[`grupo:${g.chave}`] || null;
  const oficioNaPasta = g.documentos.some(d => /Ofício de resposta|Resposta ao TCE/.test(d.tipo || ''));
  return { ...situacaoResposta({ prazo: g.campos.prazo, manual, oficioNaPasta }, hoje), manual, prazo: g.campos.prazo || null };
}
function respostaDaAnalise(db, a, hoje) {
  const manual = (db.requisicoesResposta || {})[`analise:${a.id}`] || null;
  return { ...situacaoResposta({ prazo: a.campos && a.campos.prazo, manual, oficioNaPasta: false }, hoje), manual, prazo: (a.campos && a.campos.prazo) || null };
}

/* O que precisa de resposta (para o Início e o resumo): pendentes com prazo,
   atrasadas recentes e as que vencem em até 5 dias primeiro. */
function pendenciasDeResposta(db, hoje = hojeLocal()) {
  const out = [];
  for (const g of montarGrupos(db).filter(x => x.origem === 'tce' && x.status !== 'descartada')) {
    const r = respostaDoGrupo(db, g, hoje);
    if (['atrasada', 'vence_logo', 'no_prazo'].includes(r.situacao)) out.push({ origem: 'pasta', chave: g.chave, requisicao: g.ficha.requisicao || g.ficha.tc || 'sem número', contrato: g.ficha.contrato, ...r });
  }
  for (const a of db.requisicoesAnalisadas || []) {
    const r = respostaDaAnalise(db, a, hoje);
    if (['atrasada', 'vence_logo', 'no_prazo'].includes(r.situacao)) out.push({ origem: 'enviada', analiseId: a.id, requisicao: (a.campos && (a.campos.requisicao || a.campos.tc)) || a.nomeArquivo, contrato: a.campos && a.campos.contrato, ...r });
  }
  return out.sort((x, y) => x.dias - y.dias);
}

function registrarResposta(db, { chave, analiseId, acao, em, oficio }, usuario) {
  const k = analiseId != null && analiseId !== '' ? `analise:${analiseId}` : `grupo:${chave}`;
  if (analiseId != null && analiseId !== '' && !(db.requisicoesAnalisadas || []).some(a => String(a.id) === String(analiseId))) throw new Error('Análise não encontrada.');
  if ((analiseId == null || analiseId === '') && !montarGrupos(db).some(g => g.chave === chave)) throw new Error('Requisição não encontrada.');
  db.requisicoesResposta = db.requisicoesResposta || {};
  if (acao === 'reabrir') { delete db.requisicoesResposta[k]; return { chave: k, respondida: false }; }
  if (acao !== 'respondida') throw new Error('Ação inválida.');
  const data = String(em || '').trim() || hojeLocal();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new Error('Data da resposta inválida.');
  db.requisicoesResposta[k] = { em: data, oficio: String(oficio || '').trim().slice(0, 120) || null, por: usuario || 'Usuário', registradoEm: new Date().toISOString() };
  return { chave: k, respondida: true, ...db.requisicoesResposta[k] };
}

/* ------------------------------------------------------------------
   Onde está a resposta (29/09/2026) — ver direcionamentoRequisicao.js
   ------------------------------------------------------------------ */
const raizesConfiguradas = () => require('./servidorArquivos').statusPublico().pastas;

// Requisição já lida da pasta: o processo é a própria pasta onde ela está.
function direcionamentoDoGrupo(db, chave) {
  const dir = require('./direcionamentoRequisicao');
  const g = montarGrupos(db).find(x => x.chave === chave && x.origem === 'tce');
  if (!g) return null;
  const processo = g.processo ? { caminho: g.processo, nome: path.basename(g.processo).normalize('NFC'), pa: g.pa, como: 'é a pasta onde a requisição está' } : null;
  return { processo, itensDe: g.itensDe, ...dir.direcionar(g.itensPedidos || [], processo && processo.caminho) };
}

const MAX_ANALISADAS = 50;
/* Documento de pergunta enviado pela tela (a requisição que chegou do
   Tribunal): lê os campos e os itens, acha o processo (pelo PA, pelo
   contrato cadastrado ou pela empresa) e aponta as pastas. O arquivo não
   é guardado — só o resultado, para rever depois. */
function analisarDocumento(db, { texto, nomeArquivo, usuario, porOcr, raizes, caminhoProcesso }) {
  const dir = require('./direcionamentoRequisicao');
  const lido = lerDocumentoTce(texto, nomeArquivo) || { campos: {}, evidencias: {}, itensPedidos: dir.lerItensPedidos(texto) };
  const c = lido.campos;
  const mPa = /Processo\s+Administrativo\s*(?:n[º°o.]*)?\s*(\d{1,2}\.?\d{3})\s*\/\s*(\d{4})/i.exec(texto);
  const paCitado = mPa ? formatarPa(mPa[1], mPa[2]) : null;
  const processos = dir.listarProcessos(raizes || raizesConfiguradas());
  let processo = null;
  if (caminhoProcesso) {
    const p = processos.find(x => x.caminho === caminhoProcesso);
    if (!p) throw new Error('Processo não encontrado nas pastas configuradas.');
    processo = { ...p, como: 'escolhido por quem analisou' };
  } else {
    processo = dir.localizarProcesso(db, processos, { pa: paCitado, contrato: c.contrato, contratada: c.contratada });
  }
  const d = dir.direcionar(lido.itensPedidos || [], processo && processo.caminho);
  db.requisicoesAnalisadas = db.requisicoesAnalisadas || [];
  const id = Math.max(0, ...db.requisicoesAnalisadas.map(a => Number(a.id) || 0)) + 1;
  const registro = {
    id, nomeArquivo: String(nomeArquivo || 'documento').normalize('NFC').slice(0, 200), analisadoEm: new Date().toISOString(), por: usuario || 'Usuário', porOcr: !!porOcr,
    campos: { ...c, paCitado }, evidencias: lido.evidencias || {}, itensPedidos: lido.itensPedidos || [],
    processo: processo ? { caminho: processo.caminho, nome: processo.nome, pa: processo.pa, como: processo.como, alternativas: processo.alternativas || null } : null,
    direcionamento: d
  };
  db.requisicoesAnalisadas.unshift(registro);
  if (db.requisicoesAnalisadas.length > MAX_ANALISADAS) db.requisicoesAnalisadas.length = MAX_ANALISADAS;
  return registro;
}

// Trocar o processo (ou só atualizar as pastas, com o mesmo) de uma análise guardada.
function refazerAnalise(db, id, caminhoProcesso) {
  const dir = require('./direcionamentoRequisicao');
  const a = (db.requisicoesAnalisadas || []).find(x => String(x.id) === String(id));
  if (!a) throw new Error('Análise não encontrada.');
  const caminho = caminhoProcesso || (a.processo && a.processo.caminho);
  if (!caminho) throw new Error('Escolha o processo.');
  const p = dir.listarProcessos(raizesConfiguradas()).find(x => x.caminho === caminho);
  if (!p) throw new Error('Processo não encontrado nas pastas configuradas.');
  a.processo = { caminho: p.caminho, nome: p.nome, pa: p.pa, como: caminhoProcesso && (!a.processo || a.processo.caminho !== caminhoProcesso) ? 'escolhido por quem analisou' : (a.processo && a.processo.como) || 'escolhido por quem analisou' };
  a.direcionamento = dir.direcionar(a.itensPedidos || [], p.caminho);
  a.atualizadoEm = new Date().toISOString();
  return a;
}

module.exports = {
  direcionamentoDoGrupo, analisarDocumento, refazerAnalise,
  situacaoResposta, pendenciasDeResposta, registrarResposta,
  lerRequisicaoSisfin, lerDocumentoTce, fichaSgc,
  localizarDocumentos, lerTodas, iniciarLeitura, obterProgresso,
  montarGrupos, listar, conferir, gerarFichaPdf, gerarCsv, EDITAVEIS,
  paDaPasta, chavePa, formatarPa,
  _paraTeste: { numeroBr, formatarTc, tipoDoDocumentoTce, chaveDoGrupo }
};
