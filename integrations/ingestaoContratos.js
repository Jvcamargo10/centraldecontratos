/* ===================================================================
   integrations/ingestaoContratos.js

   Orquestrador da Ferramenta 1 (ingestão automatizada): liga
   servidorArquivos.js (varredura, já agrupada por pasta/contrato) ->
   extratorDocumento.js (texto, com OCR quando precisar) ->
   leituraPorRegra.js (campos, por regra — sem IA desde 01/10/2026) ->
   fila de revisão (db.importacoesPendentes).

   Regra mais importante deste arquivo: NUNCA escreve direto em
   `db.contratos`. Toda proposta pousa em `db.importacoesPendentes` com
   status "pendente" — só vira contrato de verdade quando alguém aprova
   explicitamente (ver aprovarImportacao), o que é exatamente o
   "checkpoint humano" descrito na proposta de arquitetura. Um arquivo
   rejeitado ou com erro fica registrado (não é apagado), pra dar pra
   auditar depois o que a leitura errou e por quê.

   ------------------------------------------------------------------
   Um grupo (pasta) = uma proposta, com vários arquivos-fonte
   ------------------------------------------------------------------
   servidorArquivos.js já devolve os arquivos candidatos AGRUPADOS por
   pasta (um contrato normalmente tem vários arquivos na mesma subpasta
   — contrato, extrato, aditivo, etc. — com a informação espalhada entre
   eles). Este orquestrador extrai o texto de CADA arquivo do grupo e
   combina tudo (com um cabeçalho "=== Arquivo: nome.pdf ===" antes de
   cada um) antes de ler os campos de uma vez só — em vez de uma leitura
   por arquivo, que exigiria depois reconciliar qual arquivo tinha qual
   campo.

   Cada proposta guarda:
     - `arquivo`: o arquivo mais provável de ser o "principal" do grupo
       (ver escolherArquivoPrincipal) — mantido por compatibilidade com
       o que a tela já esperava (um "arquivo" por proposta) e pra
       continuar servindo de link/citação principal.
     - `arquivosFonte`: a lista COMPLETA de arquivos do grupo (inclui o
       principal), cada um com se teve texto extraído (ou precisou de
       OCR, ou nenhum dos dois funcionou) — pra quem revisa saber
       exatamente de onde cada dado potencialmente veio, e notar se
       algum arquivo do grupo ficou de fora por não ter texto legível.
   Quando um grupo só tem 1 arquivo (o caso mais comum hoje), o
   comportamento é equivalente ao de antes: uma proposta, um arquivo,
   `arquivosFonte` com uma única entrada.
=================================================================== */

const servidorArquivos = require('./servidorArquivos');
const termoEncerramento = require('./termoEncerramento');
const garantiaContratual = require('./garantiaContratual');
const extratorDocumento = require('./extratorDocumento');
const textoDeProposta = require('./textoDeProposta');
const termosDosDocumentos = require('./termosDosDocumentos');
const leituraPorRegra = require('./leituraPorRegra');
const mudancasPorTermos = require('./mudancasPorTermos');
const path = require('path');
const { hojeLocal } = require('./dataLocal');

const TAMANHO_PREVIA = 2000;

/* O texto de todos os documentos da pasta, o principal primeiro, cada um
   com o cabeçalho "=== Arquivo: nome ===" (é por ele que a leitura acha o
   documento principal e o nome do arquivo). Sem corte: a regra lê tudo em
   milissegundos. */
function combinarTextoCompleto(comTexto, principal) {
  if (!comTexto || comTexto.length === 0) return '';
  const ordenados = principal ? [principal, ...comTexto.filter(e => e !== principal)] : comTexto;
  return ordenados.map(e => `=== Arquivo: ${e.nome} ===\n${e.texto}`).join('\n\n');
}

function isConfigured() {
  return servidorArquivos.isConfigured();
}

/* Tenta achar, entre os contratos já cadastrados, um que provavelmente é
   o mesmo deste arquivo — casando pelo número extraído. Só um palpite
   pra ajudar quem revisa (mostrado como "isto parece ser uma atualização
   de X" na tela); a decisão final de mesclar ou criar novo é sempre
   tomada na aprovação, não aqui. */
function encontrarContratoProvavel(db, numeroExtraido) {
  if (!numeroExtraido) return null;
  const alvo = String(numeroExtraido).trim();
  const achado = (db.contratos || []).find(c => String(c.numero).trim() === alvo);
  return achado ? achado.id : null;
}

/* Entre os arquivos de um grupo que TÊM texto extraído, escolhe qual é o
   mais provável de ser o "arquivo principal" do contrato — só pra dar um
   nome/link de referência à proposta (a extração de campos em si sempre
   usa o texto combinado de TODOS os arquivos do grupo, então essa escolha
   não faz nenhum dado ser ignorado). Preferência, em ordem:
     1. Nome contém "contrato" mas não "extrato" (ex: "Contrato Comercial
        Nº 096_2025.pdf" em vez de "Extrato do Contrato...pdf");
     2. Maior quantidade de texto extraído (geralmente o documento mais
        completo é o principal, resumos/extratos são mais curtos);
     3. Primeiro em ordem alfabética, só pra ser determinístico. */
/* 25/09/2026: o 002/2024 (termo de cooperação) ficou com um MODELO em
   branco como arquivo principal — "Termo de Encerramento Contrato Nº
   xx_xxxx.docx" tem "contrato" no nome. O Mapa de risco lê a pasta do
   arquivo principal, então leu só os modelos da Ordem de Início e deu 6
   cláusulas "não localizadas". Agora: modelo (xx_xxxx, XXX, "modelo")
   nunca é principal; termo de encerramento e ordem de início também não
   (não são o instrumento); acordo/termo de cooperação, convênio e termo de
   fomento contam como instrumento, igual a "contrato". */
// Mora em servidorArquivos.js (a leitura do termo de encerramento também usa).
const { ehModeloDeDocumento } = servidorArquivos;
function escolherArquivoPrincipal(comTexto) {
  const utilizaveis = comTexto.filter(e => !ehModeloDeDocumento(e.nome));
  const base = utilizaveis.length ? utilizaveis : comTexto;
  const naoEhInstrumento = e => /extrato|encerramento|ordem\s+de\s+in[íi]cio|ordem\s+de\s+fornecimento/i.test(e.nome);
  const pareceInstrumento = e => /contrato|acordo|termo\s+de\s+(?:coopera|fomento|colabora)|conv[êe]nio/i.test(e.nome) && !naoEhInstrumento(e);
  const candidatosPrincipais = base.filter(pareceInstrumento);
  const pool = candidatosPrincipais.length > 0 ? candidatosPrincipais : (base.filter(e => !naoEhInstrumento(e)).length ? base.filter(e => !naoEhInstrumento(e)) : base);
  return pool.slice().sort((a, b) => b.totalCaracteres - a.totalCaracteres || a.nome.localeCompare(b.nome))[0];
}

/* Correções de cadastro aplicadas UMA vez, quando o servidor sobe (o
   data.json só é gravado pelo próprio servidor). Idempotente: o que já
   está certo não muda. Devolve a lista do que foi corrigido, para a
   Auditoria.
     - arquivo principal que é um modelo em branco: volta a ser escolhido
       entre os arquivos da proposta aprovada (ver escolherArquivoPrincipal);
     - CNPJ da empresa igual ao da Prefeitura: apagado (é certamente
       errado; quem revisa preenche o da contratada). */
function cnpjDaContratadaNoCache(caminhos) {
  for (const caminho of caminhos.filter(Boolean)) {
    const r = extratorDocumento._cache.lerDoCache(caminho, 1, 1);
    if (!r || !Array.isArray(r.paginas)) continue;
    const cnpj = leituraPorRegra.lerCampos(extratorDocumento._cache.textoDasPaginas(r.paginas)).campos.cnpjEmpresa;
    if (cnpj) return cnpj;
  }
  return null;
}

/* Razão social com a acentuação estragada (29/09/2026): "Tau Tecnologia Ltda", "Kapa Tecnologia Ltda" — letra minúscula no meio de palavra em maiúsculas,
   onde havia Ç, Ã, Ó (herança de um cadastro com a codificação trocada).
   Os documentos da pasta trazem o nome certo: vale a grafia do documento,
   em maiúsculas, que bate letra a letra com o nome (sem acento). */
const RE_NOME_ESTRAGADO = /[A-ZÀ-Ý][a-zà-ÿ]+[A-ZÀ-Ý]|[A-ZÀ-Ý]{2,}[a-zà-ÿ]{1,2}[A-ZÀ-Ý]|[A-Z]\d[A-Z]/;
const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
function nomeComGrafiaDoDocumento(nome, caminhos) {
  const alvo = semAcento(nome).toUpperCase().replace(/\s+/g, ' ').trim();
  if (!alvo) return null;
  // Cada letra do nome casa com ela mesma ou com uma letra acentuada; espaço
  // casa com quebra de linha (o OCR parte a razão social em linhas).
  const re = new RegExp(alvo.split('').map(ch => /[A-Z]/.test(ch) ? `[${ch}\\u00C0-\\u00DD]`
    : ch === ' ' ? '\\s+' : ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join(''), 'g');
  for (const caminho of caminhos.filter(Boolean)) {
    const r = extratorDocumento._cache.lerDoCache(caminho, 1, 1);
    if (!r || !Array.isArray(r.paginas)) continue;
    for (const m of r.paginas.map(p => p.texto).join('\n').matchAll(re)) {
      const achado = m[0].replace(/\s+/g, ' ');
      if (semAcento(achado) === alvo) return achado; // só maiúsculas: a classe não aceita minúscula
    }
  }
  return null;
}

/* Objeto com erro de OCR ("PRESTAcAO DE SERVIOS DE ATuAuzAcAo DE VERSAO",
   "LICENAS DE USO BE SOFTWARES"): outro documento do processo costuma
   trazer o mesmo trecho digitado. Procura, palavra a palavra, a passagem
   que bate com o objeto (tolerando 1 ou 2 letras de diferença por palavra,
   o erro típico do OCR) e usa a grafia dela — só se ao menos 80% das
   palavras baterem e o trecho achado estiver limpo. */
function distancia(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  let ant = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const at = [i];
    for (let j = 1; j <= b.length; j++) at[j] = Math.min(ant[j] + 1, at[j - 1] + 1, ant[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    ant = at;
  }
  return ant[b.length];
}
const palavraBate = (a, b) => a === b || (a.length >= 4 && distancia(a, b) <= (a.length >= 8 ? 2 : 1));
function objetoComGrafiaDoDocumento(objeto, caminhos) {
  const alvo = semAcento(objeto).toUpperCase().match(/[A-Z0-9]+/g) || [];
  if (alvo.length < 5) return null;
  let melhor = null;
  for (const caminho of caminhos.filter(Boolean)) {
    const r = extratorDocumento._cache.lerDoCache(caminho, 1, 1);
    if (!r || !Array.isArray(r.paginas)) continue;
    const texto = r.paginas.map(p => p.texto).join('\n');
    const pal = [...texto.matchAll(/[A-Za-zÀ-ÿ0-9]+/g)].map(m => ({ i: m.index, fim: m.index + m[0].length, n: semAcento(m[0]).toUpperCase() }));
    for (let s = 0; s < pal.length; s++) {
      if (!palavraBate(alvo[0], pal[s].n) || !pal[s + 1] || !palavraBate(alvo[1], pal[s + 1].n)) continue;
      // Alinha palavra a palavra, aceitando pular uma palavra de cada lado.
      let k = 0, d = s, acertos = 0, ultimo = s;
      while (k < alvo.length && d < pal.length) {
        if (palavraBate(alvo[k], pal[d].n)) { acertos++; ultimo = d; k++; d++; }
        else if (pal[d + 1] && palavraBate(alvo[k], pal[d + 1].n)) { d++; }
        else if (alvo[k + 1] && palavraBate(alvo[k + 1], pal[d].n)) { k++; }
        else { k++; d++; }
      }
      const nota = acertos / alvo.length;
      const trecho = texto.slice(pal[s].i, pal[ultimo].fim).replace(/\s+/g, ' ');
      // Limpo: sem minúscula perdida no meio de palavra em maiúsculas.
      if (nota >= 0.8 && !RE_NOME_ESTRAGADO.test(trecho) && (!melhor || nota > melhor.nota)) melhor = { nota, trecho };
    }
  }
  return melhor && melhor.trecho;
}

function corrigirCadastrosConhecidos(db) {
  const CNPJ_PREFEITURA = '11256774000102';
  const correcoes = [];
  for (const c of db.contratos || []) {
    const aprovada = (db.importacoesPendentes || [])
      .filter(i => String(i.contratoId) === String(c.id) && i.status === 'aprovado')
      .sort((a, b) => String(b.aprovadoEm || '').localeCompare(String(a.aprovadoEm || '')))[0];
    if (c.arquivoOrigem && ehModeloDeDocumento(path.basename(c.arquivoOrigem)) && aprovada) {
      const fontes = (aprovada.arquivosFonte || []).filter(f => f.caminho && !f.semTexto && !f.erroExtracao);
      const novo = fontes.length ? escolherArquivoPrincipal(fontes.map(f => ({ ...f, totalCaracteres: f.totalCaracteres || 0 }))) : null;
      if (novo && !ehModeloDeDocumento(novo.nome) && novo.caminho !== c.arquivoOrigem) {
        correcoes.push({ contrato: c.numero, campo: 'arquivo principal', de: path.basename(c.arquivoOrigem), para: novo.nome });
        c.arquivoOrigem = novo.caminho;
        aprovada.arquivo = { ...(aprovada.arquivo || {}), caminho: novo.caminho, nome: novo.nome, extensao: novo.extensao };
      }
    }
    if (String(c.cnpjEmpresa || '').replace(/\D/g, '') === CNPJ_PREFEITURA) {
      // Relê o CNPJ da contratada no texto já guardado (sem OCR), com a
      // regra que agora descarta o da Prefeitura; sem texto, fica em branco.
      const certo = cnpjDaContratadaNoCache([c.arquivoOrigem, ...((aprovada && aprovada.arquivosFonte) || []).map(f => f.caminho)]);
      correcoes.push({ contrato: c.numero, campo: 'CNPJ da empresa', de: c.cnpjEmpresa, para: certo });
      c.cnpjEmpresa = certo;
      if (aprovada && aprovada.campos && String(aprovada.campos.cnpjEmpresa || '').replace(/\D/g, '') === CNPJ_PREFEITURA) aprovada.campos.cnpjEmpresa = certo;
    }
    if (c.empresa && RE_NOME_ESTRAGADO.test(c.empresa)) {
      const certo = nomeComGrafiaDoDocumento(c.empresa, [c.arquivoOrigem, ...((aprovada && aprovada.arquivosFonte) || []).map(f => f.caminho)]);
      if (certo && certo !== c.empresa) {
        correcoes.push({ contrato: c.numero, campo: 'empresa', de: c.empresa, para: certo });
        if (aprovada && aprovada.campos && aprovada.campos.empresa === c.empresa) aprovada.campos.empresa = certo;
        c.empresa = certo;
      }
    }
    if (c.objeto && RE_NOME_ESTRAGADO.test(c.objeto)) {
      /* Sem o trecho limpo em documento nenhum: só o conserto certo, o "c"
         minúsculo entre maiúsculas que era Ç ("SOLUcAO" → "SOLUÇÃO"). */
      const certo = objetoComGrafiaDoDocumento(c.objeto, [c.arquivoOrigem, ...((aprovada && aprovada.arquivosFonte) || []).map(f => f.caminho)])
        || c.objeto.replace(/([A-Z])[cç](?=[AO])/g, '$1Ç').replace(/ÇAO\b/g, 'ÇÃO').replace(/ÇOES\b/g, 'ÇÕES');
      if (certo && certo !== c.objeto) {
        correcoes.push({ contrato: c.numero, campo: 'objeto', de: c.objeto, para: certo });
        if (aprovada && aprovada.campos && aprovada.campos.objeto === c.objeto) aprovada.campos.objeto = certo;
        c.objeto = certo;
      }
    }
  }
  return correcoes;
}

/* Memória do cálculo da média mensal (valor inicial, vigência, cada
   termo aditivo considerado e os avisos), guardada na proposta para quem
   revisa conferir de onde saiu o valor. null quando não houve cálculo. */
function comCalculoDoValor(textoCompleto, numero, opcoesVigencia) {
  const calculo = calculoDoValor(textoCompleto, numero);
  const vigencia = leituraPorRegra.calcularVigencia(textoCompleto, numero, opcoesVigencia);
  // Aditivos e apostilamentos lidos da pasta — a fonte desde que a
  // integração com o SGC foi desligada (ver termosDosDocumentos.js).
  let termosLidos = [];
  try { termosLidos = termosDosDocumentos.extrairTermos(textoCompleto, numero, { calculo: calculo || { aditivos: [] } }); }
  catch (e) { termosLidos = []; } // leitura de termo nunca derruba a proposta
  // Lei 8.666 ou 14.133: define os limites de prazo e de acréscimo usados
  // no registro de riscos (ver registroRiscos.js).
  const regimeLegal = require('./registroRiscos').regimeLegal(textoCompleto, vigencia.inicio, numero);
  return {
    ...(calculo ? { calculoValor: calculo } : {}),
    termosLidos,
    regimeLegal,
    // Como início e término foram calculados (marco + meses, prorrogação
    // a prorrogação) e o que impediu o cálculo — ver vigenciaContratual.js.
    ...((vigencia.memoria || vigencia.avisos.length) ? { calculoVigencia: {
      memoria: vigencia.memoria, inicio: vigencia.inicio, fonteInicio: vigencia.fonteInicio,
      termino: vigencia.termino, marco: vigencia.marco, marcoPresumido: !!vigencia.marcoPresumido, rotuloInicio: vigencia.rotuloInicio, assinatura: vigencia.assinatura, mesesTotal: vigencia.mesesTotal,
      periodos: vigencia.periodos, avisos: vigencia.avisos
    } } : {})
  };
}

function calculoDoValor(textoCompleto, numero) {
  const r = leituraPorRegra.calcularMediaMensal(textoCompleto, numero);
  if (!r.memoria && !r.avisos.length) return null;
  return {
    memoria: r.memoria,
    valorInicial: r.valorInicial ?? null,
    mesesIniciais: r.mesesIniciais ?? null,
    fonteInicial: r.fonteInicial,
    aditivos: r.aditivos.map(a => ({ tipo: a.tipo, termo: a.termo, ano: a.ano ?? null, natureza: a.natureza, valor: a.valor, meses: a.meses, documento: a.documento, fonte: a.fonte, detalhe: a.detalhe || null })),
    avisos: r.avisos
  };
}

/* Os campos de uma proposta, lidos por regra (ver leituraPorRegra.js).
   Campo não achado fica em branco e vai para "Pendências de leitura" —
   nunca um palpite. `origemRegra` diz de qual documento veio cada campo
   (a Fila mostra abaixo do valor); `gestaoHistorico`, a cadeia de atos de
   gestão. Procedência 'busca_local' = lido do documento por regra. */
function camposDaProposta(textoCompleto) {
  const local = leituraPorRegra.lerCampos(textoCompleto);
  const campos = {}, confiancas = {}, procedencia = {};
  leituraPorRegra.CAMPOS_CONTRATO.forEach(c => {
    const v = local.campos[c];
    if (v === undefined || v === null || v === '') { confiancas[c] = null; return; }
    campos[c] = v;
    confiancas[c] = local.confiancas[c] ?? 0.3;
    procedencia[c] = 'busca_local';
  });
  return { campos, confiancas, procedencia, modeloUsado: local.modeloUsado, origemRegra: local.origemRegra || null, gestaoHistorico: local.gestaoHistorico || null };
}

function resumoArquivoFonte(extraido) {
  return {
    caminho: extraido.caminho,
    nome: extraido.nome,
    extensao: extraido.extensao,
    semTexto: extraido.semTexto,
    totalCaracteres: extraido.totalCaracteres,
    ocr: extraido.ocr || null,
    erroExtracao: extraido.erroExtracao || null
  };
}

/* Extensão de um caminho, em minúsculas e sem o ponto — mesma lógica de
   extratorDocumento.js, reimplementada aqui (não exportada de lá) só
   pra rotular um arquivo que falhou ANTES de conseguir chamar
   extrairTexto (ver captura de erro por arquivo, acima). */
function extensaoDoCaminho(caminho) {
  return path.extname(caminho).toLowerCase().replace(/^\./, '');
}

/* Estado da varredura em andamento — só em memória, nunca gravado em
   data.json (não persiste entre reinícios do servidor, nem precisa).
   Existe só pra a tela poder mostrar o que está de fato acontecendo (ver
   GET /api/integracoes/arquivos/progresso em server.js): com OCR numa
   máquina modesta, uma única pasta pode legitimamente levar alguns
   minutos — sem esse
   feedback, isso é indistinguível de estar travado, o que já causou mais
   de uma vez alguém encerrar o processo achando que travou quando só
   estava demorando. */
let progresso = { emAndamento: false, totalGrupos: 0, grupoAtual: 0, pastaAtual: null, etapa: null, iniciadoEm: null };

function obterProgresso() {
  return progresso;
}

/* Varre as pastas configuradas, processa cada GRUPO (pasta) novo/alterado
   e grava uma proposta por grupo em `db.importacoesPendentes`. Resiliente
   por grupo: um PDF corrompido ou uma falha pontual de leitura não derruba a
   varredura inteira — vira um item de status "erro" na fila, pra alguém
   decidir manualmente. */
async function varrerEProporImportacoes(db, save, nextId) {
  if (!isConfigured()) {
    throw new Error('Nenhuma pasta de rede configurada — defina CONTRATOS_ARQUIVOS_PASTAS antes de varrer (veja o README).');
  }
  // Trava simples contra duas varreduras rodando ao mesmo tempo (duas
  // abas do navegador, ou duas pessoas com papel Gestor/Admin clicando
  // quase junto): sem isso, as duas veriam os MESMOS grupos como "novos"
  // (nenhuma marcou nada como visto ainda) e processariam a mesma pasta
  // em dobro — desperdiçando o tempo de OCR da máquina, e podendo
  // até criar duas propostas para o mesmo grupo. Reaproveita o mesmo
  // estado de progresso já usado pela tela (ver `progresso` abaixo).
  if (progresso.emAndamento) {
    throw new Error('Já existe uma varredura em andamento (iniciada em outra aba ou por outra pessoa) — aguarde ela terminar antes de rodar de novo.');
  }

  // A trava liga ANTES de esperar a listagem da pasta (que agora é
  // assíncrona): senão duas varreduras passariam juntas pela verificação.
  progresso = { emAndamento: true, totalGrupos: 0, grupoAtual: 0, pastaAtual: null, etapa: 'listando os arquivos da pasta de rede', iniciadoEm: new Date().toISOString() };
  let varredura;
  try {
    varredura = await servidorArquivos.listarArquivosNovosOuAlterados(db);
  } catch (err) {
    progresso = { emAndamento: false, totalGrupos: 0, grupoAtual: 0, pastaAtual: null, etapa: null, iniciadoEm: null };
    throw err;
  }
  const resumo = {
    totalCandidatos: varredura.totalCandidatos,
    totalGrupos: varredura.totalGrupos,
    totalArquivosAlterados: varredura.totalArquivosAlterados,
    propostas: 0, semTexto: 0, erros: 0,
    avisos: varredura.avisos
  };

  progresso = {
    emAndamento: true,
    totalGrupos: varredura.totalGrupos,
    grupoAtual: 0,
    pastaAtual: null,
    etapa: varredura.totalGrupos > 0 ? 'iniciando' : null,
    iniciadoEm: new Date().toISOString()
  };

  try {
  for (const grupo of varredura.novosOuAlterados) {
    const { pasta, arquivos, assinatura } = grupo; // arquivos: [{ caminho, assinatura }]
    const caminhosDoGrupo = arquivos.map(a => a.caminho);
    progresso.grupoAtual++;
    progresso.pastaAtual = path.basename(pasta);
    progresso.etapa = `lendo ${caminhosDoGrupo.length} arquivo(s) desta pasta (roda OCR automaticamente se algum for PDF escaneado — pode levar até ~1 minuto por arquivo)`;

    try {
      const extraidos = [];
      for (const caminho of caminhosDoGrupo) {
        try {
          const extraido = await extratorDocumento.extrairTexto(caminho);
          extraidos.push({ caminho, nome: path.basename(caminho), ...extraido });
        } catch (errArquivo) {
          // Um arquivo corrompido, com senha, ou de extensão não
          // suportada NÃO pode jogar fora o trabalho já feito (ou ainda
          // por fazer) nos outros arquivos boa-fé do mesmo grupo — vira
          // uma entrada "sem texto" com o motivo do erro anexado, e o
          // grupo continua sendo processado com o que sobrou. Antes
          // desta correção, um único arquivo problemático fazia a pasta
          // INTEIRA virar um "erro" sem solução, mesmo quando os outros
          // 2 arquivos do grupo estavam perfeitamente legíveis.
          extraidos.push({
            caminho, nome: path.basename(caminho), extensao: extensaoDoCaminho(caminho),
            semTexto: true, totalCaracteres: 0, paginas: [], texto: '', ocr: null,
            erroExtracao: errArquivo.message
          });
        }
      }

      if (extraidos.some(e => !e.semTexto)) await acrescentarOrdemDeInicio(extraidos, pasta);
      const comTexto = extraidos.filter(e => !e.semTexto);
      const arquivosFonte = extraidos.map(resumoArquivoFonte);

      if (comTexto.length === 0) {
        // Nenhum arquivo do grupo tem texto legível (nem depois de OCR,
        // quando aplicável) — proposta "sem_texto" cobrindo o grupo
        // inteiro, com todos os arquivos listados em arquivosFonte pra
        // ficar claro o que foi tentado. Quando um ou mais arquivos
        // falharam por um motivo específico (corrompido, com senha,
        // extensão não suportada — ver captura por arquivo acima), isso
        // é destacado separadamente de "é só uma digitalização", porque
        // pede uma ação diferente de quem revisa (um arquivo corrompido
        // pode precisar ser reenviado/reescaneado; uma digitalização só
        // precisa de preenchimento manual).
        const comErroEspecifico = extraidos.filter(e => e.erroExtracao);
        const detalheErros = comErroEspecifico.length
          ? ` ${comErroEspecifico.length === 1 ? 'Um arquivo' : `${comErroEspecifico.length} arquivos`} não pôde(puderam) nem ser lido(s): ${comErroEspecifico.map(e => `"${e.nome}" (${e.erroExtracao})`).join('; ')}.`
          : '';
        db.importacoesPendentes.unshift({
          id: nextId(db.importacoesPendentes),
          status: 'sem_texto',
          arquivo: { caminho: extraidos[0].caminho, nome: extraidos[0].nome, extensao: extraidos[0].extensao },
          arquivosFonte,
          campos: {}, confiancas: {}, modeloUsado: null,
          contratoExistenteId: null,
          observacao: (extraidos.length > 1
            ? `Nenhum dos ${extraidos.length} arquivos desta pasta teve texto extraível (mesmo com OCR, quando tentado) — precisa de preenchimento manual.`
            : 'Não foi possível extrair texto deste arquivo, mesmo com OCR — precisa de preenchimento manual.') + detalheErros,
          criadoEm: new Date().toISOString()
        });
        servidorArquivos.marcarComoVisto(db, pasta, assinatura, 'sem_texto', caminhosDoGrupo);
        resumo.semTexto++;
        continue;
      }

      const principal = escolherArquivoPrincipal(comTexto);
      const textoCompleto = combinarTextoCompleto(comTexto, principal);
      progresso.etapa = 'lendo os campos dos documentos';
      const lido = camposDaProposta(textoCompleto);
      const { campos } = lido;

      db.importacoesPendentes.unshift({
        id: nextId(db.importacoesPendentes),
        status: 'pendente',
        arquivo: { caminho: principal.caminho, nome: principal.nome, extensao: principal.extensao, totalPaginas: principal.paginas.length },
        arquivosFonte,
        campos, confiancas: lido.confiancas, modeloUsado: lido.modeloUsado,
        ...(lido.origemRegra ? { origemRegra: lido.origemRegra } : {}),
        ...(lido.gestaoHistorico ? { gestaoHistorico: lido.gestaoHistorico } : {}),
        contratoExistenteId: encontrarContratoProvavel(db, campos.numero),
        previaTexto: textoCompleto.slice(0, TAMANHO_PREVIA),
        procedencia: lido.procedencia,
        ...comCalculoDoValor(textoCompleto, campos.numero),
        criadoEm: new Date().toISOString()
      });
      servidorArquivos.marcarComoVisto(db, pasta, assinatura, 'proposto', caminhosDoGrupo);
      resumo.propostas++;
    } catch (err) {
      db.importacoesPendentes.unshift({
        id: nextId(db.importacoesPendentes),
        status: 'erro',
        arquivo: { caminho: pasta, nome: path.basename(pasta) },
        arquivosFonte: caminhosDoGrupo.map(c => ({ caminho: c, nome: path.basename(c) })),
        campos: {}, confiancas: {}, modeloUsado: null,
        contratoExistenteId: null,
        erro: err.message,
        criadoEm: new Date().toISOString()
      });
      // Marca como visto mesmo em erro, senão um grupo com problema
      // permanente (senha, corrompido) reapareceria em toda varredura.
      // Limitação conhecida: se o problema for passageiro (rede
      // instável, pasta sem acesso), o reprocessamento
      // automático só volta a tentar se algum arquivo do grupo mudar de
      // novo — quem revisa pode reeditar/re-salvar um arquivo de origem
      // pra forçar uma nova tentativa, ou (em ambiente de
      // desenvolvimento) remover a entrada correspondente em
      // db.integracoes.arquivosContratos.arquivosVistos.
      servidorArquivos.marcarComoVisto(db, pasta, assinatura, `erro:${err.message.slice(0, 120)}`, caminhosDoGrupo);
      resumo.erros++;
    }
  }
  } finally {
    // Sempre zera o progresso ao sair, mesmo se algo inesperado escapar
    // dos try/catch de cada grupo — nunca deixa a tela achando que uma
    // varredura ainda está em andamento quando na verdade já parou.
    progresso = { emAndamento: false, totalGrupos: 0, grupoAtual: 0, pastaAtual: null, etapa: null, iniciadoEm: null };
  }

  db.integracoes.arquivosContratos.ultimaVarredura = new Date().toISOString();
  db.integracoes.arquivosContratos.ultimoResumo = resumo;
  save();
  return resumo;
}

/* ---------------------------------------------------------------------
   Extração manual (Ferramenta 1) — em vez de esperar a varredura
   automática decidir sozinha o que processar, quem usa navega pelas
   pastas do servidor (ver GET /api/integracoes/arquivos/pastas) e marca
   exatamente quais arquivos entrar, podendo pedir também campos extras
   além dos 14 fixos do cadastro (ex: "multa por atraso", "nome do
   fiscal") — só pra este documento, sem virar configuração permanente.

   Diferenças em relação a varrerEProporImportacoes:
     - não depende de arquivosVistos/assinatura de pasta — sempre
       processa o que foi pedido, mesmo que os mesmos arquivos já
       tenham virado proposta antes (o pedido aqui é explícito);
     - os arquivos selecionados não precisam estar todos na mesma
       pasta — o "grupo" é a escolha manual da pessoa, não
       path.dirname();
     - erro inesperado sobe pro chamador (endpoint HTTP) em vez de virar
       um item "erro" silencioso na fila — faz sentido aqui porque é uma
       ação sob demanda, com alguém esperando na tela, diferente da
       varredura automática/agendada, que roda sem ninguém olhando.
   Reaproveita o mesmo mutex de `progresso` que a varredura automática:
   as duas leem (e às vezes fazem OCR de) muitos documentos — não faz
   sentido deixá-las competirem pela mesma CPU/memória ao mesmo tempo. */
/* Reaplica as REGRAS (busca local: média mensal com os aditivos, vigência
   em meses a partir do marco) às propostas pendentes, com o texto já
   guardado no cache — sem OCR, em segundos. Existe porque uma
   regra nova (como as de 21-22/09/2026) não chega às propostas já lidas:
   a varredura não reprocessa pasta cujos arquivos não mudaram.

   Só mexe nos campos que a regra calcula (valor, início, término) e nos
   de formato canônico (número, CNPJ, P.A.), e só quando a regra tem
   resposta. Data INFERIDA pela IA de antes de 24/09/2026 (não escrita no
   documento) que a regra não confirma é apagada: foi exatamente para não gravar data inventada
   que a regra de vigência existe. Proposta já aprovada não é tocada — o
   que vale para ela é o cadastro revisado. */
const CAMPOS_RECALCULADOS = ['valor', 'inicio', 'termino', 'numero', 'cnpjEmpresa', 'pa'];
/* Também recalculados: os que saem de camposPorRegra.js (objeto, tipo,
   gestor, suplente, preposto) — mas só quando a regra acha alguma coisa;
   onde ela não acha, o que está na proposta continua. */
const CAMPOS_COM_FONTE_MELHOR_NA_REGRA = ['objeto', 'tipo', 'responsavel', 'suplente', 'preposto'];

/* O texto já lido dos documentos da proposta mora em textoDeProposta.js
   (usado também pela tela de Pendências de leitura). Aqui só se passa a
   escolha do arquivo principal, que tem regra própria neste módulo. */
const textoDaPropostaEmCache = p => textoDeProposta.doCache(p, escolherArquivoPrincipal);

/* Acrescenta aos documentos lidos de um contrato os da pasta "Ordem de
   Início de Serviço" do mesmo processo — é de onde vem o marco da
   vigência de muitos contratos (ver documentosDaOrdemDeInicio em
   servidorArquivos.js). O nome ganha "Ordem de Início —" na frente
   quando o arquivo se chama só "OS.pdf": é pelo nome que a leitura da
   vigência reconhece o documento. */
function nomeDaOrdem(caminho) {
  return path.basename(caminho);
}
/* Além da Ordem de Início, a indicação do preposto (documentosDePreposto
   em servidorArquivos.js) — de onde sai o nome do preposto. */
async function acrescentarOrdemDeInicio(extraidos, caminhoDoGrupo) {
  const jaTem = new Set(extraidos.map(e => path.resolve(e.caminho).toLowerCase()));
  const doProcesso = [...servidorArquivos.documentosDaOrdemDeInicio(caminhoDoGrupo), ...servidorArquivos.documentosDePreposto(caminhoDoGrupo)];
  for (const caminho of doProcesso) {
    if (jaTem.has(path.resolve(caminho).toLowerCase())) continue;
    try {
      const extraido = await extratorDocumento.extrairTexto(caminho, extratorDocumento.LEITURA_COMPLETA);
      if (!extraido.semTexto) extraidos.push({ caminho, nome: nomeDaOrdem(caminho), ...extraido, daOrdemDeInicio: true });
    } catch (e) { /* Ordem ilegível não impede a leitura do contrato */ }
  }
  return extraidos;
}

async function recalcularPropostasPendentes(db, save, nextIdOpcional) {
  const resumo = { recalculadas: 0, alteradas: 0, semTexto: 0, camposAlterados: 0, termosDeAprovados: 0, vigenciasDeAprovados: [], encerramentosDetectados: [], garantiasLidas: [], mudancasDetectadas: [] };
  /* Contratos já aprovados: relê os aditivos e apostilamentos da pasta e
     atualiza o cadastro — termo novo arquivado depois da aprovação passa a
     aparecer sem precisar aprovar tudo de novo. Só termos: os campos do
     contrato aprovado não são mexidos aqui. */
  const nextId = nextIdOpcional || (lista => (lista || []).reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1);
  // Só a aprovação MAIS RECENTE de cada contrato é comparada com o cadastro
  // (uma aprovação antiga daria como "mudança" o que a nova já corrigiu).
  const ultimaAprovada = new Map();
  for (const x of (db.importacoesPendentes || []).filter(x => x.status === 'aprovado' && !x.contratoRemovido)) {
    const atual = ultimaAprovada.get(String(x.contratoId));
    if (!atual || String(x.aprovadoEm || '').localeCompare(String(atual.aprovadoEm || '')) > 0 || (x.aprovadoEm === atual.aprovadoEm && Number(x.id) > Number(atual.id))) ultimaAprovada.set(String(x.contratoId), x);
  }
  for (const p of (db.importacoesPendentes || []).filter(x => x.status === 'aprovado' && !x.contratoRemovido)) {
    const contrato = (db.contratos || []).find(c => String(c.id) === String(p.contratoId));
    if (!contrato) continue;
    // Aprovação antiga do mesmo contrato: a mais recente é a que vale —
    // relê-la depois sobrescreveria os termos com a leitura velha.
    if (ultimaAprovada.get(String(contrato.id)) !== p) continue;
    const textoAprovado = await textoDaPropostaEmCache(p);
    if (!textoAprovado) continue;
    const calc = calculoDoValor(textoAprovado, contrato.numero);
    try { p.termosLidos = termosDosDocumentos.extrairTermos(textoAprovado, contrato.numero, { calculo: calc || { aditivos: [] } }); } catch (e) { continue; }
    const r = sincronizarTermosDoContrato(db, nextId, contrato, p);
    resumo.termosDeAprovados += r.aditivos + r.apostilamentos;

    /* Termo de encerramento do contrato (subpasta "20. Termo de
       Encerramento" do processo): vira PENDÊNCIA para confirmar — o
       cadastro não muda aqui (ver termoEncerramento.js). Termo já
       descartado por alguém não volta, a menos que o arquivo mude. */
    if (contrato.status !== 'Encerrado' && contrato.arquivoOrigem) {
      try {
        const achado = await termoEncerramento.detectarEncerramento(contrato, servidorArquivos.pastaDoGrupo(contrato.arquivoOrigem));
        const descartado = contrato.encerramentoDescartado;
        if (achado && !(descartado && descartado.caminho === achado.caminho && descartado.assinatura === achado.assinatura)) {
          const novo = !contrato.encerramentoDetectado || contrato.encerramentoDetectado.caminho !== achado.caminho || contrato.encerramentoDetectado.data !== achado.data;
          contrato.encerramentoDetectado = { ...achado, detectadoEm: new Date().toISOString() };
          if (novo) resumo.encerramentosDetectados.push({ contrato: contrato.numero, data: achado.data, arquivo: achado.arquivo });
        }
      } catch (e) { /* termo ilegível não impede o resto do recálculo */ }
    }

    /* Garantia contratual (apólice, caução, fiança) do processo e sua
       validade — base do risco de garantia vencida (registroRiscos.js). A
       primeira leitura faz OCR das apólices (~30 s cada); depois, cache. */
    /* Pasta fora do alcance (unidade F: desconectada, processo movido):
       mantém a leitura anterior — senão "nenhum documento" apagaria a
       garantia já lida e criaria "não arquivada" em todos (29/09/2026). */
    const pastaDoProcesso = contrato.arquivoOrigem ? servidorArquivos.pastaDoGrupo(contrato.arquivoOrigem) : null;
    if (contrato.status !== 'Encerrado' && pastaDoProcesso && require('fs').existsSync(pastaDoProcesso)) {
      try {
        const g = await garantiaContratual.detectarGarantia(contrato, pastaDoProcesso);
        const antes = contrato.garantiaLida && contrato.garantiaLida.fim;
        contrato.garantiaLida = g.lida;
        contrato.garantiaDocumentos = g.documentos;
        contrato.garantiaVerificadaEm = new Date().toISOString();
        if (g.lida && g.lida.fim !== antes) resumo.garantiasLidas.push({ contrato: contrato.numero, fim: g.lida.fim, arquivo: g.lida.arquivo });
      } catch (e) { /* garantia ilegível não impede o resto do recálculo */ }
    }

    /* Início e término EM BRANCO no cadastro: calcula pelo texto (contrato
       + Ordem de Início do processo + prorrogações), como na proposta.
       Nunca sobrescreve data que já existe. Caso de 25/09/2026: o
       015/2024 só ganhou texto depois do OCR dos PDFs grandes, e ficou
       "sem término" — o eixo Prazo do Mapa de risco contava isso. */
    if (!contrato.termino || !contrato.inicio) {
      const refGrupo = contrato.arquivoOrigem || (p.arquivo && p.arquivo.caminho);
      let texto = textoAprovado;
      if (refGrupo && Array.isArray(p.arquivosFonte)) {
        const novos = await acrescentarOrdemDeInicio(p.arquivosFonte.map(f => ({ caminho: f.caminho })), refGrupo);
        const daOrdem = novos.filter(e => e.daOrdemDeInicio);
        if (daOrdem.length) {
          daOrdem.forEach(e => p.arquivosFonte.push({ caminho: e.caminho, nome: e.nome }));
          texto = (await textoDaPropostaEmCache(p)) || texto;
        }
      }
      const calc = comCalculoDoValor(texto, contrato.numero).calculoVigencia;
      if (calc && (calc.termino || calc.inicio)) {
        const antes = { inicio: contrato.inicio || null, termino: contrato.termino || null };
        if (!contrato.termino && calc.termino) contrato.termino = calc.termino;
        if (!contrato.inicio && calc.inicio) contrato.inicio = calc.inicio;
        if (contrato.termino !== antes.termino || contrato.inicio !== antes.inicio) {
          p.calculoVigencia = calc;
          resumo.vigenciasDeAprovados.push({ contrato: contrato.numero, antes, depois: { inicio: contrato.inicio, termino: contrato.termino }, presumido: !!calc.marcoPresumido });
        }
      }
    }

    /* Término, valor ou gestor/suplente relidos diferentes do cadastro:
       vira pendência para confirmar — o cadastro não muda aqui (ver
       mudancasPorTermos.js). */
    try {
      const lido = leituraPorRegra.lerCampos(textoAprovado);
      const contas = comCalculoDoValor(textoAprovado, contrato.numero);
      const novas = mudancasPorTermos.detectar(contrato, p, {
        campos: lido.campos, origemRegra: lido.origemRegra,
        calculoValor: contas.calculoValor || null, calculoVigencia: contas.calculoVigencia || null
      }, new Date().toISOString());
      novas.forEach(m => resumo.mudancasDetectadas.push({ contrato: contrato.numero, campo: m.rotulo, de: m.de, para: m.para, motivo: m.motivo }));
    } catch (e) { /* releitura que falha não impede o resto do recálculo */ }
  }
  for (const p of (db.importacoesPendentes || []).filter(x => x.status === 'pendente')) {
    // Propostas lidas antes de 24/09/2026 não tinham a Ordem de Início.
    const refGrupo = (p.arquivo && p.arquivo.caminho) || ((p.arquivosFonte || [])[0] || {}).caminho;
    if (refGrupo && Array.isArray(p.arquivosFonte)) {
      const novos = await acrescentarOrdemDeInicio(p.arquivosFonte.map(f => ({ caminho: f.caminho })), refGrupo);
      novos.filter(e => e.daOrdemDeInicio).forEach(e => p.arquivosFonte.push({ caminho: e.caminho, nome: e.nome }));
    }
    const textoCompleto = await textoDaPropostaEmCache(p);
    if (!textoCompleto) { resumo.semTexto++; continue; }
    const local = leituraPorRegra.lerCampos(textoCompleto);

    p.campos = p.campos || {}; p.confiancas = p.confiancas || {};
    p.procedencia = p.procedencia && typeof p.procedencia === 'object' ? p.procedencia : {};
    const mudancas = [];
    CAMPOS_RECALCULADOS.forEach(c => {
      const novo = local.campos[c];
      const atual = p.campos[c];
      // Dado informado à mão (ver pendenciasLeitura.js) não é sobrescrito
      // pelo recálculo: alguém conferiu na fonte e assumiu a informação.
      if (p.procedencia[c] === 'manual') return;
      if (novo !== undefined && novo !== null && novo !== '') {
        if (String(novo) !== String(atual)) mudancas.push({ campo: c, de: atual ?? null, para: novo });
        p.campos[c] = novo;
        p.confiancas[c] = local.confiancas[c] ?? 0.3;
        p.procedencia[c] = 'busca_local';
      } else if ((c === 'inicio' || c === 'termino') && p.procedencia[c] === 'inferido' && atual) {
        mudancas.push({ campo: c, de: atual, para: null });
        p.campos[c] = null;
        p.confiancas[c] = 0;
        delete p.procedencia[c];
      }
    });
    /* Campos que passaram a sair de regra (objeto, gestor, suplente — ver
       camposPorRegra.js): o recálculo traz o que a regra lê dos
       documentos. É o que permite aproveitar a regra
       nas propostas já na fila, sem varrer tudo de novo. Dado informado à
       mão continua intocado. */
    CAMPOS_COM_FONTE_MELHOR_NA_REGRA.forEach(c => {
      const novo = local.campos[c];
      if (p.procedencia[c] === 'manual') return;
      if (novo === undefined || novo === null || novo === '') return;
      if (String(novo) === String(p.campos[c] ?? '')) return;
      mudancas.push({ campo: c, de: p.campos[c] ?? null, para: novo });
      p.campos[c] = novo;
      p.confiancas[c] = local.confiancas[c] ?? 0.3;
      p.procedencia[c] = 'busca_local';
    });
    /* Palpites da IA de antes de 24/09/2026 que a regra não confirma
       saem: eram valores medidos como errados — tipo "PREGÃO", preposto
       "true", o prompt copiado como nome do gestor. Em branco, o campo vai
       para "Pendências de leitura". A troca fica em `recalculo`, como as
       demais. */
    leituraPorRegra.CAMPOS_CONTRATO.forEach(c => {
      if (p.procedencia[c] !== 'ia') return;
      const atual = p.campos[c];
      if (atual === undefined || atual === null || atual === '') return;
      mudancas.push({ campo: c, de: atual, para: null, motivo: 'palpite da IA não confirmado pela leitura dos documentos' });
      p.campos[c] = null;
      p.confiancas[c] = null;
      delete p.procedencia[c];
    });
    if (local.origemRegra) p.origemRegra = local.origemRegra;
    if (local.gestaoHistorico) p.gestaoHistorico = local.gestaoHistorico;

    // Dado informado à mão continua valendo no recálculo (ver pendenciasLeitura.js).
    const dm = p.dadosManuais || null;
    Object.assign(p, comCalculoDoValor(textoCompleto, p.campos.numero, dm ? {
      marcoInformado: dm.dataMarco ? { data: dm.dataMarco, por: dm.por, observacao: dm.observacao } : null,
      mesesInformados: dm.meses || null
    } : undefined));
    p.recalculadoEm = new Date().toISOString();
    if (mudancas.length) {
      p.recalculo = mudancas;
      resumo.alteradas++;
      resumo.camposAlterados += mudancas.length;
    }
    resumo.recalculadas++;
  }
  save();
  return resumo;
}

async function processarArquivosSelecionados(db, save, nextId, caminhos) {
  if (!Array.isArray(caminhos) || caminhos.length === 0) {
    throw new Error('Nenhum arquivo selecionado.');
  }
  for (const caminho of caminhos) {
    if (!servidorArquivos.caminhoPermitido(caminho)) {
      throw new Error(`Caminho fora das pastas configuradas — acesso negado: "${caminho}".`);
    }
  }
  if (progresso.emAndamento) {
    throw new Error('Já existe uma varredura/extração em andamento (nesta ou em outra aba) — aguarde ela terminar antes de rodar de novo.');
  }

  progresso = {
    emAndamento: true,
    totalGrupos: 1,
    grupoAtual: 1,
    pastaAtual: caminhos.length === 1 ? path.basename(caminhos[0]) : `${caminhos.length} arquivos selecionados`,
    etapa: `lendo ${caminhos.length} arquivo(s) selecionado(s) manualmente (roda OCR automaticamente se algum for PDF escaneado — pode levar até ~1 minuto por arquivo)`,
    iniciadoEm: new Date().toISOString()
  };

  try {
    const extraidos = [];
    for (const caminho of caminhos) {
      try {
        /* Importação de arquivos escolhidos a dedo (um contrato): lê o
           documento INTEIRO, como o Mapa de risco precisa. Assim, importar
           e depois gerar o Mapa custa uma leitura de cada página, não duas.
           A varredura da pasta inteira continua com o limite menor. */
        const extraido = await extratorDocumento.extrairTexto(caminho, extratorDocumento.LEITURA_COMPLETA);
        extraidos.push({ caminho, nome: path.basename(caminho), ...extraido });
      } catch (errArquivo) {
        extraidos.push({
          caminho, nome: path.basename(caminho), extensao: extensaoDoCaminho(caminho),
          semTexto: true, totalCaracteres: 0, paginas: [], texto: '', ocr: null,
          erroExtracao: errArquivo.message
        });
      }
    }

    if (extraidos.some(e => !e.semTexto) && caminhos.length) await acrescentarOrdemDeInicio(extraidos, caminhos[0]);
    const comTexto = extraidos.filter(e => !e.semTexto);
    const arquivosFonte = extraidos.map(resumoArquivoFonte);

    if (comTexto.length === 0) {
      const proposta = {
        id: nextId(db.importacoesPendentes),
        status: 'sem_texto',
        origemManual: true,
        arquivo: { caminho: extraidos[0].caminho, nome: extraidos[0].nome, extensao: extraidos[0].extensao },
        arquivosFonte,
        campos: {}, confiancas: {}, modeloUsado: null,
        contratoExistenteId: null,
        observacao: 'Nenhum dos arquivos selecionados manualmente teve texto extraível (mesmo com OCR, quando tentado) — precisa de preenchimento manual.',
        criadoEm: new Date().toISOString()
      };
      db.importacoesPendentes.unshift(proposta);
      save();
      return { propostaId: proposta.id, status: proposta.status };
    }

    const principal = escolherArquivoPrincipal(comTexto);
    const textoCompleto = combinarTextoCompleto(comTexto, principal);
    progresso.etapa = 'lendo os campos dos documentos';
    const lido = camposDaProposta(textoCompleto);
    const { campos } = lido;

    const proposta = {
      id: nextId(db.importacoesPendentes),
      status: 'pendente',
      origemManual: true,
      arquivo: { caminho: principal.caminho, nome: principal.nome, extensao: principal.extensao, totalPaginas: principal.paginas.length },
      arquivosFonte,
      campos, confiancas: lido.confiancas, modeloUsado: lido.modeloUsado,
      ...(lido.origemRegra ? { origemRegra: lido.origemRegra } : {}),
      ...(lido.gestaoHistorico ? { gestaoHistorico: lido.gestaoHistorico } : {}),
      contratoExistenteId: encontrarContratoProvavel(db, campos.numero),
      previaTexto: textoCompleto.slice(0, TAMANHO_PREVIA),
      procedencia: lido.procedencia,
      ...comCalculoDoValor(textoCompleto, campos.numero),
      criadoEm: new Date().toISOString()
    };
    db.importacoesPendentes.unshift(proposta);
    save();
    return { propostaId: proposta.id, status: proposta.status };
  } finally {
    // Mesma garantia da varredura automática: nunca deixa a tela achando
    // que ainda tem algo rodando quando já parou, mesmo se algo
    // inesperado escapar dos try/catch acima.
    progresso = { emAndamento: false, totalGrupos: 0, grupoAtual: 0, pastaAtual: null, etapa: null, iniciadoEm: null };
  }
}

const CAMPOS_GRAVAVEIS = leituraPorRegra.CAMPOS_CONTRATO;

/* Aprova uma proposta: mescla os campos (já revisados/corrigidos por
   quem aprova — `camposFinais`) no contrato existente, ou cria um novo.
   `origemArquivo` marca a proveniência (distinto de `origemExterna`, que
   é reservado para o que veio da API do SGC) — importante pra nunca
   confundir "veio de um arquivo lido, revisado por humano" com
   "veio direto da fonte oficial via API". */
function aprovarImportacao(db, save, nextId, importacaoId, camposFinais, usuarioNome) {
  const idx = (db.importacoesPendentes || []).findIndex(i => String(i.id) === String(importacaoId));
  if (idx === -1) throw new Error('Proposta de importação não encontrada.');
  const proposta = db.importacoesPendentes[idx];
  if (proposta.status !== 'pendente') throw new Error(`Esta proposta já foi ${proposta.status === 'aprovado' ? 'aprovada' : proposta.status} — não pode ser aprovada de novo.`);

  const hoje = hojeLocal();
  const campos = { ...proposta.campos, ...(camposFinais || {}) };
  let contrato;

  if (proposta.contratoExistenteId) {
    contrato = (db.contratos || []).find(c => c.id === proposta.contratoExistenteId);
  }

  if (contrato) {
    /* Registra o que foi TROCADO (valor antigo e novo) antes de escrever.
       Mesclar num contrato existente pode substituir dado vindo da fonte
       oficial (contratos com `origemExterna` vêm do SGC) por uma leitura
       de documento — a tela de aprovação agora mostra isso campo a campo, e este
       registro é o outro lado da mesma preocupação: depois de aprovado,
       ainda dá pra saber o que havia antes, tanto na proposta quanto na
       trilha de auditoria (ver server.js). Sem ele, o valor anterior
       desaparecia sem deixar rastro. */
    const sobrescritos = [];
    CAMPOS_GRAVAVEIS.forEach(campo => {
      const novo = campos[campo];
      if (novo === undefined || novo === null || novo === '') return; // campo em branco mantém o que já está gravado
      const anterior = contrato[campo];
      const tinhaValor = anterior !== undefined && anterior !== null && anterior !== '';
      if (tinhaValor && String(anterior) !== String(novo)) sobrescritos.push({ campo, de: anterior, para: novo });
      contrato[campo] = novo;
    });
    if (sobrescritos.length) proposta.camposSobrescritos = sobrescritos;
    contrato.origemArquivo = true;
    contrato.arquivoOrigem = proposta.arquivo.caminho;
    contrato.importadoEm = hoje;
    // Processo que foi para "Contratos Encerrados": o cadastro acompanha.
    if (servidorArquivos.categoriaDoCaminho(proposta.arquivo.caminho) === 'encerrado') contrato.status = 'Encerrado';
  } else {
    /* Criar contrato NOVO exige pelo menos o número. Sem esta guarda,
       aprovar uma proposta que veio vazia (acontecia quando a IA, retirada
       em 01/10/2026, respondia fora do formato)
       criava um contrato "(sem número — importado AAAA-MM-DD)" com
       empresa "(a preencher)" e vigência de um dia, que depois aparecia
       nos alertas de vencimento e no mapa de risco como se fosse um
       contrato de verdade. Aconteceu em 18/09/2026 (contrato id 46).
       Atualizar um contrato existente continua não exigindo nada: ali o
       número já existe, e a proposta pode trazer só um campo novo. */
    if (!campos.numero || !String(campos.numero).trim()) {
      throw new Error('Para criar um contrato novo é preciso informar pelo menos o número do contrato — preencha o campo "Número" antes de aprovar (ou rejeite/arquive esta proposta).');
    }
    contrato = {
      id: nextId(db.contratos),
      numero: String(campos.numero).trim(),
      empresa: campos.empresa || '(a preencher)',
      cnpjEmpresa: campos.cnpjEmpresa || '',
      secretaria: campos.secretaria || '',
      tipo: campos.tipo || '(a preencher)',
      objeto: campos.objeto || '',
      /* Sem data lida, fica SEM data. Até 23/09/2026 o padrão era "hoje",
         que transformava contrato de vigência desconhecida em "vence hoje"
         nos alertas e no registro de riscos (19 das 31 propostas daquele
         dia não tinham término). A vigência que falta é resolvida em
         "Pendências de leitura". */
      inicio: campos.inicio || null,
      termino: campos.termino || null,
      valor: Number(campos.valor) || 0,
      // Veio da pasta "Contratos Encerrados": já entra como encerrado (fora do Mapa de risco e dos ativos).
      status: servidorArquivos.categoriaDoCaminho(proposta.arquivo && proposta.arquivo.caminho) === 'encerrado' ? 'Encerrado' : 'Ativo',
      responsavel: campos.responsavel || '(a definir)',
      suplente: campos.suplente || '',
      pa: campos.pa || '',
      preposto: campos.preposto || '',
      tipoContratacao: campos.tipoContratacao || '',
      emailResponsavel: '',
      observacoes: '',
      origemArquivo: true,
      arquivoOrigem: proposta.arquivo.caminho,
      importadoEm: hoje
    };
    db.contratos.unshift(contrato);
  }

  proposta.status = 'aprovado';
  proposta.aprovadoPor = usuarioNome || 'Usuário';
  proposta.aprovadoEm = new Date().toISOString();
  proposta.contratoId = contrato.id;
  sincronizarTermosDoContrato(db, nextId, contrato, proposta);
  save();
  return contrato;
}

/* Os aditivos e apostilamentos de um contrato aprovado passam a ser os
   lidos dos documentos da pasta. Substitui só o que veio de documento
   para ESTE contrato (origem: 'documento') — o que alguém cadastrou à mão
   na tela de Contratos fica. Chamada na aprovação e no recálculo. */
function sincronizarTermosDoContrato(db, nextId, contrato, proposta) {
  const termos = Array.isArray(proposta.termosLidos) ? proposta.termosLidos : null;
  if (!termos || !contrato) return { aditivos: 0, apostilamentos: 0 };
  const resumo = { aditivos: 0, apostilamentos: 0 };
  /* O mesmo termo relido mantém o id (e a data da primeira leitura): as
     páginas #/aditivo/ID e #/apostilamento/ID e os links salvos não podem
     mudar a cada recálculo (07/10/2026). Chave: número do termo, ou o
     documento quando o número não foi lido. */
  const chaveDoTermo = t => (t.numero && !/^\(sem n/i.test(t.numero)) ? `n:${t.numero}` : `d:${t.documento || ''}`;
  for (const [colecao, especie] of [['aditivos', 'Aditivo'], ['apostilamentos', 'Apostilamento']]) {
    const anteriores = new Map();
    (db[colecao] || []).filter(t => t.origem === 'documento' && String(t.contratoId) === String(contrato.id)).forEach(t => {
      const k = chaveDoTermo(t);
      if (!anteriores.has(k)) anteriores.set(k, []);
      anteriores.get(k).push(t);
    });
    db[colecao] = (db[colecao] || []).filter(t => !(t.origem === 'documento' && String(t.contratoId) === String(contrato.id)));
    for (const t of termos.filter(x => x.especie === especie)) {
      const antigo = (anteriores.get(chaveDoTermo(t)) || []).shift();
      db[colecao].push({
        id: antigo ? antigo.id : nextId(db[colecao]),
        contrato: contrato.numero,
        contratoId: contrato.id,
        numero: t.numero || '(sem número)',
        empresa: contrato.empresa || '',
        tipo: t.tipo,
        natureza: t.natureza || null,
        data: t.data || null,
        valor: t.valor ?? null,
        meses: t.meses ?? null,
        gestor: t.gestor || null,
        suplente: t.suplente || null,
        objeto: t.objeto || '',
        documento: t.documento || null,
        origem: 'documento',
        propostaId: proposta.id,
        lidoEm: (antigo && antigo.lidoEm) || hojeLocal()
      });
      resumo[colecao]++;
    }
  }
  return resumo;
}

function rejeitarImportacao(db, save, importacaoId, motivo, usuarioNome) {
  const proposta = (db.importacoesPendentes || []).find(i => String(i.id) === String(importacaoId));
  if (!proposta) throw new Error('Proposta de importação não encontrada.');
  if (proposta.status !== 'pendente' && proposta.status !== 'sem_texto' && proposta.status !== 'erro') {
    throw new Error(`Esta proposta já foi ${proposta.status} — não pode ser rejeitada de novo.`);
  }
  proposta.status = 'rejeitado';
  proposta.motivoRejeicao = motivo || '';
  proposta.rejeitadoPor = usuarioNome || 'Usuário';
  proposta.rejeitadoEm = new Date().toISOString();
  save();
  return proposta;
}

module.exports = {
  isConfigured,
  varrerEProporImportacoes,
  processarArquivosSelecionados,
  recalcularPropostasPendentes,
  textoDaPropostaEmCache,
  obterProgresso,
  aprovarImportacao,
  rejeitarImportacao,
  sincronizarTermosDoContrato,
  corrigirCadastrosConhecidos,
  /* Funções puras (sem db, sem rede, sem disco) expostas para os testes
     de testes/ingestaoContratos.test.js. Elas decidem a PROVENIÊNCIA de
     cada campo — o que a leitura por regra achou e de onde — e o que
     ela corrigiu —, que é justamente a regra que já deu problema na
     prática e precisa de cobertura. Não são para uso fora daqui. */
  _paraTeste: { camposDaProposta, escolherArquivoPrincipal, ehModeloDeDocumento }
};
