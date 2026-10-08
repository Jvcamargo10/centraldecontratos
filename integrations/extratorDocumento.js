/* ===================================================================
   integrations/extratorDocumento.js

   Extrai texto puro de um arquivo de contrato (PDF ou DOCX), pra depois
   ser lido por integrations/leituraPorRegra.js. Não sabe nada sobre
   contrato nem pasta de rede — só recebe um caminho de arquivo e devolve texto,
   com a página de origem de cada trecho preservada (importante pra
   Ferramenta 2 citar "página X" no mapa de risco).

   PDF escaneado (imagem, sem camada de texto): por padrão este módulo
   tenta OCR automaticamente antes de desistir (ver "OCR" abaixo). Isso
   pode ser desligado com CONTRATOS_OCR_ATIVADO=false, e mesmo ligado tem
   limites de segurança (tamanho e nº de páginas) pra nunca travar a
   varredura com um arquivo gigante.

   ------------------------------------------------------------------
   OCR (CONTRATOS_OCR_ATIVADO, ligado por padrão)
   ------------------------------------------------------------------
   Quando a extração normal de um PDF não acha texto (ou acha pouco
   demais pra ser real — ver MIN_CARACTERES_TEXTO_VALIDO), este módulo:
     1. Rasteriza cada página do PDF em uma imagem (pdfjs-dist, a mesma
        biblioteca que o pdf-parse já usa por baixo dos panos, + @napi-rs/canvas
        pra desenhar — sem precisar instalar nenhum programa externo tipo
        Poppler ou Ghostscript, e sem puxar uma SEGUNDA cópia divergente
        do pdfjs-dist: usar exatamente a mesma versão que o pdf-parse já
        usa é o que evita, na prática, um conflito real testado neste
        projeto entre duas cópias diferentes do pdfjs-dist rodando no
        mesmo processo — ver integrations/ocrTrabalhador.js).
     2. Roda OCR (Tesseract, via tesseract.js) em cada imagem, em
        português, pra tentar recuperar o texto.
   Os dados de idioma do Tesseract (".traineddata") vêm de um pacote npm
   (@tesseract.js-data/por) instalado junto com o resto do projeto — ou
   seja, depois do `npm install` isso funciona 100% offline, sem baixar
   nada de nenhum CDN em tempo de execução. Isso é importante: nenhum
   dado (nem sequer uma imagem do documento) sai desta máquina para fazer
   OCR.

   OCR leva segundos por página, mas custa CPU. Os limites abaixo
   (CONTRATOS_OCR_MAX_PAGINAS, CONTRATOS_OCR_MAX_TAMANHO_MB) existem pra
   nunca repetir o problema já visto neste projeto com um PDF de 207MB
   travando a máquina — arquivo grande demais ou com página demais tem
   OCR pulado (fica "sem texto" como antes), nunca trava a varredura.
=================================================================== */

const fs = require('fs');
const path = require('path');

const EXTENSOES_SUPORTADAS = ['pdf', 'docx'];

const CONFIG_OCR = {
  ativado: (process.env.CONTRATOS_OCR_ATIVADO ?? 'true').toLowerCase() !== 'false',
  idioma: process.env.CONTRATOS_OCR_IDIOMA || 'por',
  // Padrões conservadores de propósito: testado ao vivo que o hardware
  // comum da Prefeitura (RAM em canal único, pouca memória livre — ver
  // nota grande no topo do arquivo e no README) trava ou fica
  // extremamente lento com paginação/escala mais altas. Preferível um
  // OCR mais modesto (ou parcial, com aviso) do que travar a máquina.
  maxPaginas: Number(process.env.CONTRATOS_OCR_MAX_PAGINAS) || 5,
  // Este limite protege só a leitura do arquivo pra memória (um PDF de
  // poucas dezenas de MB não é problema pra praticamente nenhuma
  // máquina) — o risco real de travar (processar página demais, demorar
  // demais) já é coberto por `maxPaginas` e `timeoutMs` abaixo, não por
  // este número. Testado ao vivo neste projeto: um contrato real
  // escaneado de ~27MB é um caso normal, não excepcional — um limite
  // baixo demais aqui (ex: 15MB) acaba pulando o OCR justamente do
  // arquivo mais importante do grupo (o contrato principal), o que é
  // pior do que deixar o teto de páginas/tempo fazerem esse trabalho.
  /* 25/09/2026: o teto de 40MB pulava o OCR de 4 contratos PRINCIPAIS
     (015/2024 com 42,9MB, 048/2025 com 65,6MB, 064/2025 e 075/2025 com
     ~50MB) — todos com ~2,5MB por página, digitalização comum. O que
     pesa no OCR é a imagem de CADA página (decodificada uma por vez, no
     processo filho), não o arquivo inteiro. Agora: teto absoluto maior
     (o PDF de 207MB continua barrado) e o limite que protege de verdade
     é o de MB por página. */
  maxTamanhoMb: Number(process.env.CONTRATOS_OCR_MAX_TAMANHO_MB) || 120,
  maxMbPorPagina: Number(process.env.CONTRATOS_OCR_MAX_MB_POR_PAGINA) || 8,
  // Escala de renderização da página antes do OCR — quanto maior, mais
  // nítido (melhor OCR) mas MUITO mais lento e mais memória (custo cresce
  // com o quadrado da escala). 1.3 já é legível pra texto de contrato
  // normal; só suba isso em máquina com RAM/CPU de sobra.
  escalaRenderizacao: Number(process.env.CONTRATOS_OCR_ESCALA) || 1.3,
  // Orçamento de tempo total por arquivo (todas as páginas somadas). Se
  // estourar, para no meio (mantém o que já foi lido até ali) em vez de
  // continuar indefinidamente — proteção direta contra o caso real já
  // visto neste projeto de um arquivo deixar a máquina travada.
  timeoutMs: Number(process.env.CONTRATOS_OCR_TIMEOUT_MS) || 45000,
  // Além das primeiras páginas, o OCR lê sempre as ÚLTIMAS N de um PDF
  // longo: é onde ficam o fecho "Itaverde, 05 de dezembro de 2025" e as
  // assinaturas — a data de que a vigência precisa (ver
  // vigenciaContratual.js). Antes de 22/09/2026, contrato de 17 páginas
  // tinha OCR só nas 10 primeiras e nunca mostrava a data de assinatura.
  paginasFinais: Math.max(0, Number(process.env.CONTRATOS_OCR_PAGINAS_FINAIS ?? 2) || 0)
};

/* Leitura COMPLETA do documento — a que o Mapa de risco precisa para
   poder afirmar que uma cláusula não existe. Usada também quando alguém
   escolhe UM contrato (importação manual, ficha de cadastro) e pela
   leitura noturna. A varredura da pasta inteira continua com os limites
   menores de CONFIG_OCR (maxPaginas + paginasFinais). */
const LEITURA_COMPLETA = {
  maxPaginasOcr: Number(process.env.CONTRATOS_OCR_MAX_PAGINAS_RISCO) || 60,
  timeoutOcrMs: Number(process.env.CONTRATOS_OCR_TIMEOUT_MS_RISCO) || 600000
};

/* ------------------------------------------------------------------
   Cache do texto extraído (desde 21/09/2026)
   ------------------------------------------------------------------
   O OCR é a parte mais cara da ingestão: minutos por PDF digitalizado.
   Sem cache, o mesmo arquivo era lido de novo a cada varredura em que
   QUALQUER arquivo da pasta mudasse (o grupo inteiro é reprocessado), a
   cada ficha de cadastro e a cada mapa de risco. Agora o resultado fica
   em .texto-cache/ (uma entrada por arquivo), válido enquanto o arquivo
   não mudar (tamanho + data de modificação — a mesma assinatura que a
   varredura usa).

   Uma leitura PARCIAL (OCR limitado a N páginas ou interrompido por
   tempo) só serve para quem pede o mesmo tanto ou menos: o mapa de risco
   pede o documento inteiro e refaz o OCR se o cache tiver só 10 páginas.

   O texto guardado já vem com CPF mascarado — e, para não haver duas
   versões do mesmo texto circulando, extrairTexto SEMPRE devolve o texto
   mascarado, com ou sem cache. Nenhum campo extraído é CPF.
   CONTRATOS_CACHE_TEXTO=false desliga. */
const CONFIG_CACHE = {
  ativado: (process.env.CONTRATOS_CACHE_TEXTO ?? 'true').toLowerCase() !== 'false',
  pasta: require('./configServidor').obterConfig().pastaCacheTexto // CONTRATOS_CACHE_TEXTO_PASTA ou <pasta de dados>/.texto-cache
};
const VERSAO_CACHE = 1;

// Uma máscara só, com as variações do OCR e da assinatura digital — ver mascaraDados.js.
const { mascararCpf } = require('./mascaraDados');

function assinaturaDoArquivo(caminho) {
  const st = fs.statSync(caminho);
  return `${st.size}:${Math.round(st.mtimeMs)}`;
}

function arquivoDeCache(caminho) {
  const chave = require('crypto').createHash('sha1').update(path.resolve(caminho).toLowerCase()).digest('hex');
  return path.join(CONFIG_CACHE.pasta, chave + '.json');
}

function lerDoCache(caminho, maxPaginasOcr, timeoutOcrMs) {
  if (!CONFIG_CACHE.ativado) return null;
  try {
    const arq = arquivoDeCache(caminho);
    if (!fs.existsSync(arq)) return null;
    const c = JSON.parse(fs.readFileSync(arq, 'utf8'));
    if (c.versao !== VERSAO_CACHE || c.assinatura !== assinaturaDoArquivo(caminho)) return null;
    const r = c.resultado;
    if (ocrPendenteNoCache(r, caminho)) return null; // falta o OCR que hoje seria feito
    // Leitura parcial só vale para quem pede no máximo o que foi lido.
    const serve = r.leituraCompleta || !r.ocr || (c.maxPaginasOcr >= maxPaginasOcr && c.timeoutOcrMs >= timeoutOcrMs);
    return serve ? { ...r, caminho, doCache: true } : null;
  } catch (e) {
    return null; // cache corrompido ou ilegível: extrai de novo
  }
}

function gravarNoCache(caminho, resultado, maxPaginasOcr, timeoutOcrMs) {
  if (!CONFIG_CACHE.ativado) return;
  try {
    fs.mkdirSync(CONFIG_CACHE.pasta, { recursive: true });
    const { texto, ...resto } = resultado; // o texto é remontado das páginas
    /* Grava num temporário e renomeia: a leitura noturna
       (ferramentas/leituraNoturna.js) grava enquanto o servidor pode estar
       lendo, e um JSON pela metade seria lido como "sem cache". */
    const destino = arquivoDeCache(caminho);
    const temporario = `${destino}.${process.pid}.tmp`;
    fs.writeFileSync(temporario, JSON.stringify({
      versao: VERSAO_CACHE, caminho, assinatura: assinaturaDoArquivo(caminho),
      maxPaginasOcr, timeoutOcrMs, gravadoEm: new Date().toISOString(), resultado: resto
    }));
    fs.renameSync(temporario, destino);
  } catch (e) {
    // Falha ao gravar o cache nunca derruba a extração.
  }
}

function textoDasPaginas(paginas) {
  // Marcador de página explícito (nosso, não o "-- N of M --" que o
  // pdf-parse insere) — é o que permite depois citar "página 3" com certeza
  // de que bate com o texto real daquela página.
  return paginas.map(p => `[página ${p.numero}]\n${p.texto}`).join('\n\n');
}

function extensaoDe(caminho) {
  return path.extname(caminho).toLowerCase().replace(/^\./, '');
}

function suportado(caminho) {
  return EXTENSOES_SUPORTADAS.includes(extensaoDe(caminho));
}

/* Um trecho de texto mínimo pra considerar que "tem texto de verdade" — PDF
   escaneado às vezes ainda devolve alguma coisa (marca d'água, carimbo
   digital, número de página soltos), então um limiar baixo de caracteres é
   mais confiável do que checar string vazia. */
const MIN_CARACTERES_TEXTO_VALIDO = 40;

/* Camada de texto RALA: o PDF tem algum texto (carimbo de assinatura
   digital, número de página), mas as páginas são imagem. O contrato
   125/2023 tinha 485 caracteres em 12 páginas — passava do mínimo acima
   e nunca ia para o OCR (medido em 25/09/2026). Um contrato de verdade
   tem ~2.000 caracteres por página. */
const MIN_MEDIA_CARACTERES_POR_PAGINA = 120;
/* Página única: recorte da Imprensa Oficial (IOM) em que só o cabeçalho
   do jornal é texto ("IMPRENSA OFICIAL DO MUNICÍPIO DE ITAVERDE ... Itaverde,
   7 de agosto de 2023") e a portaria que designa gestor e fiscal é
   imagem — ~150 caracteres (20.032 e 07.657, 25/09/2026). Documento de
   uma página de verdade tem bem mais que 300. */
const MIN_CARACTERES_PAGINA_UNICA = 300;
function camadaDeTextoRala(paginas) {
  if (!Array.isArray(paginas) || !paginas.length) return false;
  const total = paginas.reduce((soma, p) => soma + String(p.texto || '').length, 0);
  if (paginas.length === 1) return total < MIN_CARACTERES_PAGINA_UNICA;
  return total / paginas.length < MIN_MEDIA_CARACTERES_POR_PAGINA;
}

/* Motivo para NÃO fazer OCR por tamanho — ou null, se pode. */
function ocrBloqueadoPorTamanho(tamanhoMb, totalPaginas) {
  if (tamanhoMb > CONFIG_OCR.maxTamanhoMb) return `Arquivo tem ${tamanhoMb.toFixed(1)}MB (limite pra OCR é ${CONFIG_OCR.maxTamanhoMb}MB) — OCR não foi tentado.`;
  const porPagina = tamanhoMb / Math.max(1, totalPaginas);
  if (porPagina > CONFIG_OCR.maxMbPorPagina) return `Arquivo tem ${porPagina.toFixed(1)}MB por página (limite pra OCR é ${CONFIG_OCR.maxMbPorPagina}MB por página) — OCR não foi tentado.`;
  return null;
}

/* Resultado guardado que ficou SEM o OCR que hoje seria feito: pulado por
   um limite de tamanho que mudou, ou camada de texto rala lida antes
   desta regra. Não serve como leitura — o arquivo é lido de novo no
   próximo pedido (análise do contrato, importação). */
function ocrPendenteNoCache(r, caminho) {
  if (!r || !CONFIG_OCR.ativado || extensaoDe(caminho) !== 'pdf') return false;
  if (r.ocr && r.ocr.tentado) return false;
  // Só dois casos: pulado por tamanho, ou nunca avaliado para OCR (sem
  // `ocr`). OCR que FALHOU fica como está — relê-lo a cada pedido
  // repetiria a falha sem fim.
  const puladoPorTamanho = !!r.ocr && /OCR não foi tentado/.test(r.ocr.aviso || '');
  const nuncaAvaliado = !r.ocr && (r.semTexto || camadaDeTextoRala(r.paginas));
  if (!puladoPorTamanho && !nuncaAvaliado) return false;
  try {
    return !ocrBloqueadoPorTamanho(fs.statSync(caminho).size / (1024 * 1024), (r.paginas || []).length);
  } catch (e) {
    return false;
  }
}

/* A leitura do texto próprio do PDF também roda na thread do OCR (ver
   ocrTrabalhador.js): um PDF de 348 páginas parava o servidor por 3 s. */
async function extrairPdf(caminho) {
  const r = await naFila({ tipo: 'texto', caminho }, 180000);
  return r.paginas;
}

async function extrairDocx(caminho) {
  const mammoth = require('mammoth');
  const resultado = await mammoth.extractRawText({ path: caminho });
  // DOCX não tem conceito de "página" no arquivo em si (isso é cálculo de
  // layout, que só existe ao abrir no Word) — então tudo vira "página 1"
  // pra manter o mesmo formato { numero, texto } que o PDF devolve. Quem
  // cita um trecho de um DOCX cita o arquivo, não uma página.
  return [{ numero: 1, texto: (resultado.value || '').trim() }];
}

/* ------------------------------------------------------------------
   Leitura de PDF e OCR num processo separado (desde 24/09/2026)
   ------------------------------------------------------------------
   A leitura do PDF, o desenho das páginas e o OCR rodam em
   integrations/ocrTrabalhador.js, num processo filho com prioridade
   MÍNIMA no Windows: o servidor continua respondendo (telas, login)
   enquanto um documento é lido, e o OCR só usa o processador que sobra.
   Antes, isso parava o servidor (medido: 3 s num PDF de 348 páginas,
   ~0,2 s por página escaneada, 1,7 s na varredura da pasta).
     - UM documento por vez (fila): duas leituras ao mesmo tempo dobrariam
       memória e processador numa máquina que não tem sobra;
     - a thread é encerrada depois de CONTRATOS_OCR_OCIOSO_MS sem uso
       (padrão 60 s), devolvendo toda a memória do OCR ao Windows;
     - trava de segurança: se o processo não responder no tempo do
       documento + 2 min (uma página que emperra), ele é encerrado e a
       leitura conta como falha — nunca fica pendurada;
     - páginas em branco não passam pelo OCR (ver ehBranca no trabalhador). */
/* Pasta local (dentro do projeto) onde vive o pacote com os dados de
   idioma do Tesseract — resolvida via require.resolve pra funcionar
   independente de onde o processo Node foi iniciado. */
function pastaDadosIdiomaOcr(idioma) {
  const pacote = `@tesseract.js-data/${idioma}`;
  const indexJs = require.resolve(pacote);
  // O pacote exporta um index.js na raiz da pasta do idioma, com os
  // ".traineddata.gz" em subpastas de versão (ex: "4.0.0/por.traineddata.gz").
  const raiz = path.dirname(indexJs);
  const versoes = fs.readdirSync(raiz).filter(nome => fs.statSync(path.join(raiz, nome)).isDirectory());
  // Prefere a variante "_best_int" quando existir (mais precisa); senão,
  // primeira pasta de versão encontrada.
  const escolhida = versoes.find(v => v.includes('best')) || versoes[0];
  if (!escolhida) throw new Error(`Pacote @tesseract.js-data/${idioma} instalado, mas nenhuma pasta de dados encontrada dentro dele.`);
  return path.join(raiz, escolhida);
}

const OCIOSO_MS = Number(process.env.CONTRATOS_OCR_OCIOSO_MS) || 60000;
const LIMIAR_PAGINA_BRANCA = 0.0005; // fração de pixels escuros
let trabalhador = null;
let timerOcioso = null;
let filaOcr = Promise.resolve();
let proximoId = 1;

/* Encerramento ORDENADO: o processo fecha o motor de OCR e sai sozinho.
   Só se não sair em 5 s é que é encerrado à força. */
function encerrarTrabalhador() {
  if (timerOcioso) { clearTimeout(timerOcioso); timerOcioso = null; }
  if (!trabalhador) return Promise.resolve();
  const t = trabalhador;
  trabalhador = null;
  if (t.exitCode !== null || t.signalCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    const forcar = setTimeout(() => { t.kill(); resolve(); }, 5000);
    t.once('exit', () => { clearTimeout(forcar); resolve(); });
    try { t.send({ tipo: 'encerrar' }); } catch (e) { t.kill(); }
  });
}

/* Liga e desliga o "segurar o processo aberto": ocupado, o servidor (ou a
   leitura noturna) não termina no meio de uma leitura; ocioso, não fica
   preso esperando o filho. */
function segurarAberto(t, sim) {
  if (sim) { t.ref(); if (t.channel) t.channel.ref(); } else { t.unref(); if (t.channel) t.channel.unref(); }
}

function iniciarTrabalhador() {
  const { fork } = require('child_process');
  const t = fork(path.join(__dirname, 'ocrTrabalhador.js'), [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  try { require('os').setPriority(t.pid, require('os').constants.priority.PRIORITY_LOW); } catch (e) { /* sem permissão: segue com a do servidor */ }
  return t;
}

function executarNoTrabalhador(job, limiteMs) {
  if (timerOcioso) { clearTimeout(timerOcioso); timerOcioso = null; }
  if (!trabalhador) trabalhador = iniciarTrabalhador();
  const t = trabalhador;
  segurarAberto(t, true); // ocupado: o processo não termina no meio da leitura
  return new Promise((resolve, reject) => {
    const id = proximoId++;
    let terminou = false;
    const fim = (erro, resultado) => {
      if (terminou) return;
      terminou = true;
      clearTimeout(trava);
      t.off('message', aoResponder); t.off('error', aoFalhar); t.off('exit', aoSair);
      if (trabalhador === t) {
        segurarAberto(t, false); // ocioso: não segura o processo aberto
        timerOcioso = setTimeout(encerrarTrabalhador, OCIOSO_MS);
        if (timerOcioso.unref) timerOcioso.unref();
      }
      if (erro) reject(erro); else resolve(resultado);
    };
    const aoResponder = m => { if (m && m.id === id) fim(m.ok ? null : new Error(m.erro), m); };
    const aoFalhar = err => { if (trabalhador === t) trabalhador = null; fim(err); };
    const aoSair = code => { if (trabalhador === t) trabalhador = null; fim(new Error(`OCR encerrado (código ${code}).`)); };
    const trava = setTimeout(() => {
      if (trabalhador === t) trabalhador = null;
      t.kill();
      fim(new Error(`OCR não respondeu em ${Math.round(limiteMs / 1000)} s — leitura interrompida para não travar a máquina.`));
    }, limiteMs);
    t.on('message', aoResponder); t.once('error', aoFalhar); t.once('exit', aoSair);
    t.send({ ...job, id });
  });
}

async function ocrDePaginasPdf(caminho, numerosPaginas, timeoutMs, escala) {
  const limiteMs = timeoutMs || CONFIG_OCR.timeoutMs;
  const job = {
    caminho,
    paginas: numerosPaginas,
    timeoutMs: limiteMs,
    escala: escala || CONFIG_OCR.escalaRenderizacao,
    idioma: CONFIG_OCR.idioma,
    langPath: pastaDadosIdiomaOcr(CONFIG_OCR.idioma),
    cachePath: require('./configServidor').obterConfig().pastaCacheOcr,
    limiarBranco: LIMIAR_PAGINA_BRANCA
  };
  const r = await naFila(job, limiteMs + 120000);
  return { paginas: r.paginas, interrompidoPorTempo: r.interrompidoPorTempo };
}

// Fila: um documento por vez, na ordem em que foram pedidos.
function naFila(job, limiteMs) {
  const execucao = filaOcr.then(() => executarNoTrabalhador(job, limiteMs));
  filaOcr = execucao.catch(() => {});
  return execucao;
}

let ocrDaVez = (...args) => ocrDePaginasPdf(...args);

/* Mescla o texto obtido por OCR de volta nas páginas originais — só
   substitui quando o OCR achou mais texto do que já havia (nunca piora
   uma página que por acaso já tinha algum texto real). */
function mesclarTextoOcr(paginasOriginais, paginasOcr) {
  const porNumero = new Map(paginasOcr.map(p => [p.numero, p.texto]));
  return paginasOriginais.map(p => {
    const textoOcr = porNumero.get(p.numero);
    if (textoOcr && textoOcr.length > p.texto.length) return { numero: p.numero, texto: textoOcr };
    return p;
  });
}

/* Extrai o texto de um arquivo de contrato. Devolve:
     {
       caminho, extensao,
       semTexto: boolean,       // true = não achou texto (mesmo depois de tentar OCR)
       totalCaracteres: number,
       paginas: [{ numero, texto }],
       texto: string,           // todas as páginas concatenadas, com marcador de página
       ocr: {                   // presente só quando OCR foi de fato tentado
         tentado: boolean,
         paginasProcessadas: number,
         aviso: string|null     // ex: "só as 15 primeiras páginas" ou motivo de ter pulado/falhado
       } | null,
       leituraCompleta: boolean // false = alguma página ficou sem ler (OCR parcial, interrompido ou pulado)
     }
   Lança erro só quando o arquivo não pôde nem ser aberto/lido (arquivo
   corrompido, PDF com senha, extensão não suportada) — "sem texto" não é
   erro, é um resultado válido que a fila de revisão sabe tratar. OCR
   nunca lança erro pra fora: uma falha de OCR só faz o arquivo continuar
   "sem texto", igual a antes de existir OCR neste módulo.

   `opcoes` (opcional) sobrescreve os limites de OCR só nesta chamada:
     { maxPaginasOcr, timeoutOcrMs }
   e `apenasCache: true` devolve null em vez de ler um arquivo que ainda
   não está no cache de texto.
   A varredura em lote usa os limites do .env (conservadores, porque roda
   muitas pastas); o mapa de risco roda sob demanda para UM contrato e
   precisa ler o documento inteiro — ver mapaRiscoContratos.js. */
/* Alguma das páginas que este pedido leria ainda não passou pelo OCR?
   Cobre a leitura parcial antiga (sem as últimas páginas), a leitura
   interrompida pelo tempo — que antes ficava no cache como se servisse,
   e as páginas restantes nunca eram lidas — e o pedido maior (o Mapa de
   risco pedindo o documento inteiro). */
function faltamPaginasPedidas(r, maxPaginasOcr) {
  if (!r || r.leituraCompleta || !r.ocr || !r.ocr.tentado || !Array.isArray(r.paginas) || !r.paginas.length) return false;
  const lidas = paginasJaLidas(r);
  return paginasAlvoDoOcr(r.paginas.length, maxPaginasOcr).some(n => !lidas.has(n));
}

/* Páginas escolhidas para OCR num documento de `total` páginas: todas,
   ou as primeiras `maxPaginasOcr` mais as últimas (fecho e assinaturas). */
function paginasAlvoDoOcr(total, maxPaginasOcr) {
  const todas = Array.from({ length: total }, (_, i) => i + 1);
  if (total <= maxPaginasOcr) return todas;
  const finais = todas.slice(Math.max(maxPaginasOcr, total - CONFIG_OCR.paginasFinais));
  return [...todas.slice(0, maxPaginasOcr), ...finais];
}

/* Quais páginas já passaram pelo OCR. Desde 24/09/2026 o cache guarda a
   lista (ocr.paginasLidas); para o que foi lido antes, ela é deduzida:
   as primeiras N e as últimas lidas (quando o OCR não foi interrompido)
   e toda página que já tem texto. */
function paginasJaLidas(r) {
  const ocr = r.ocr || {};
  if (Array.isArray(ocr.paginasLidas)) return new Set(ocr.paginasLidas);
  const lidas = new Set(r.paginas.filter(p => String(p.texto || '').trim().length > 5).map(p => p.numero));
  if (!/interrompido/i.test(ocr.aviso || '')) {
    const finais = ocr.paginasFinaisLidas || 0;
    const primeiras = Math.max(0, (ocr.paginasProcessadas || 0) - finais);
    r.paginas.slice(0, primeiras).forEach(p => lidas.add(p.numero));
    if (finais) r.paginas.slice(-finais).forEach(p => lidas.add(p.numero));
  }
  return lidas;
}

/* LEITURA INCREMENTAL (24/09/2026). Quando o cache tem uma leitura
   parcial (a varredura lê 10 + 2 páginas) e alguém pede mais (o Mapa de
   risco pede o documento inteiro), só as páginas que FALTAM passam pelo
   OCR. Antes, o documento era relido do zero: nos 16 documentos parciais
   daquele dia, seriam 163 páginas relidas à toa para obter 78. */
async function completarLeitura(caminho, r, maxPaginasOcr, timeoutOcrMs, escalaOcr) {
  const total = r.paginas.length;
  const lidas = paginasJaLidas(r);
  const alvo = paginasAlvoDoOcr(total, maxPaginasOcr).filter(n => !lidas.has(n));
  const ocr = { ...r.ocr, tentado: true };
  let paginas = r.paginas;
  let interrompido = false;
  if (alvo.length) {
    try {
      const novas = await ocrDaVez(caminho, alvo, timeoutOcrMs, escalaOcr);
      interrompido = novas.interrompidoPorTempo;
      paginas = mesclarTextoOcr(paginas, novas.paginas.map(p => ({ ...p, texto: mascararCpf(p.texto) })));
      novas.paginas.forEach(p => lidas.add(p.numero));
      const emBranco = novas.paginas.filter(p => p.branca).length;
      if (emBranco) ocr.paginasEmBranco = (ocr.paginasEmBranco || 0) + emBranco;
    } catch (e) {
      return { ...r, texto: textoDasPaginas(r.paginas) }; // fica como estava; tenta de novo numa próxima leitura
    }
  }
  ocr.paginasLidas = [...lidas].sort((a, b) => a - b);
  ocr.paginasProcessadas = lidas.size;
  const finais = paginasAlvoDoOcr(total, maxPaginasOcr).filter(n => n > maxPaginasOcr).length;
  if (finais) ocr.paginasFinaisLidas = finais;
  const leituraCompleta = lidas.size >= total;
  ocr.aviso = leituraCompleta ? null
    : interrompido ? `OCR foi interrompido pelo limite de tempo — ${lidas.size} de ${total} páginas lidas até agora; a próxima leitura continua de onde parou.`
    : `Documento tem ${total} páginas — OCR em ${lidas.size} delas (as primeiras e as últimas; ajustável via CONTRATOS_OCR_MAX_PAGINAS).`;
  const totalCaracteres = paginas.reduce((soma, p) => soma + p.texto.length, 0);
  const resultado = { ...r, paginas, ocr, leituraCompleta, totalCaracteres, semTexto: totalCaracteres < MIN_CARACTERES_TEXTO_VALIDO, texto: textoDasPaginas(paginas) };
  delete resultado.doCache;
  gravarNoCache(caminho, resultado, maxPaginasOcr, timeoutOcrMs);
  return resultado;
}

/* Entrada do cache deste arquivo, mesmo que não sirva para o pedido
   (leitura parcial) — é a base da leitura incremental. */
function lerEntradaDoCache(caminho) {
  if (!CONFIG_CACHE.ativado) return null;
  try {
    const arq = arquivoDeCache(caminho);
    if (!fs.existsSync(arq)) return null;
    const c = JSON.parse(fs.readFileSync(arq, 'utf8'));
    if (c.versao !== VERSAO_CACHE || c.assinatura !== assinaturaDoArquivo(caminho)) return null;
    return { ...c.resultado, caminho };
  } catch (e) {
    return null;
  }
}

/* Por que um documento ainda merece ser lido (ou relido) na leitura
   noturna — ou null, se o que está no cache já basta. Ordem de
   prioridade: nunca lido > leitura incompleta > lido com nitidez menor. */
function motivoParaLer(caminho, { maxPaginasOcr, timeoutOcrMs, escalaOcr } = {}) {
  if (!CONFIG_CACHE.ativado) return 'sem cache';
  let c = null;
  try {
    const arq = arquivoDeCache(caminho);
    if (fs.existsSync(arq)) c = JSON.parse(fs.readFileSync(arq, 'utf8'));
  } catch (e) { c = null; }
  if (!c || c.versao !== VERSAO_CACHE || c.assinatura !== assinaturaDoArquivo(caminho)) return 'nunca lido';
  const r = c.resultado;
  if (ocrPendenteNoCache(r, caminho)) return 'OCR pendente';
  if (!r.ocr || !r.ocr.tentado) return null; // tinha texto no PDF: não precisa de OCR
  if (faltamPaginasPedidas(r, maxPaginasOcr || CONFIG_OCR.maxPaginas)) return 'leitura incompleta';
  if (escalaOcr && (r.ocr.escala || CONFIG_OCR.escalaRenderizacao) < escalaOcr) return 'nitidez menor';
  return null;
}

async function extrairTexto(caminho, opcoes) {
  const maxPaginasOcr = (opcoes && opcoes.maxPaginasOcr) || CONFIG_OCR.maxPaginas;
  const timeoutOcrMs = (opcoes && opcoes.timeoutOcrMs) || CONFIG_OCR.timeoutMs;
  // Nitidez da imagem enviada ao OCR (a leitura noturna usa uma maior).
  const escalaOcr = (opcoes && opcoes.escalaOcr) || CONFIG_OCR.escalaRenderizacao;
  const extensao = extensaoDe(caminho);
  if (!suportado(caminho)) {
    throw new Error(`Extensão ".${extensao}" não suportada por extratorDocumento.js (suportadas: ${EXTENSOES_SUPORTADAS.join(', ')}).`);
  }

  // `ignorarCache`: a leitura noturna relê com nitidez maior o que já estava lido.
  const ignorar = opcoes && (opcoes.ignorarCache || opcoes.semCache);
  const soCache = opcoes && opcoes.apenasCache;
  const doCache = ignorar ? null : lerDoCache(caminho, maxPaginasOcr, timeoutOcrMs);
  if (doCache && !soCache && faltamPaginasPedidas(doCache, maxPaginasOcr)) {
    return completarLeitura(caminho, doCache, maxPaginasOcr, timeoutOcrMs, escalaOcr);
  }
  if (doCache) return { ...doCache, texto: textoDasPaginas(doCache.paginas) };
  // Quem só quer o que já foi lido (a conferência com o SGC, que abre na
  // hora e não pode disparar horas de OCR) recebe null.
  if (soCache) return null;
  // Leitura parcial no cache e pedido maior: lê só as páginas que faltam.
  const parcial = ignorar ? null : lerEntradaDoCache(caminho);
  if (parcial && parcial.ocr && parcial.ocr.tentado && Array.isArray(parcial.paginas) && parcial.paginas.length) {
    return completarLeitura(caminho, parcial, maxPaginasOcr, timeoutOcrMs, escalaOcr);
  }

  let paginas;
  if (extensao === 'pdf') {
    paginas = await extrairPdf(caminho);
  } else {
    paginas = await extrairDocx(caminho);
  }

  let totalCaracteres = paginas.reduce((soma, p) => soma + p.texto.length, 0);
  let semTexto = totalCaracteres < MIN_CARACTERES_TEXTO_VALIDO;
  let ocr = null;

  // `semOcr`: quem lê muitos documentos sob pedido (indicadores dos relatórios
  // mensais) fica só com a camada de texto — o digitalizado sai "sem texto".
  if ((semTexto || camadaDeTextoRala(paginas)) && extensao === 'pdf' && CONFIG_OCR.ativado && !(opcoes && opcoes.semOcr)) {
    ocr = { tentado: false, paginasProcessadas: 0, aviso: null };
    try {
      const tamanhoBytes = fs.statSync(caminho).size;
      const bloqueio = ocrBloqueadoPorTamanho(tamanhoBytes / (1024 * 1024), paginas.length);
      if (bloqueio) {
        ocr.aviso = bloqueio;
      } else {
        const truncado = paginas.length > maxPaginasOcr;
        const finais = truncado ? paginas.slice(Math.max(maxPaginasOcr, paginas.length - CONFIG_OCR.paginasFinais)) : [];
        const paginasAlvo = paginasAlvoDoOcr(paginas.length, maxPaginasOcr);
        const { paginas: paginasOcr, interrompidoPorTempo } = await ocrDaVez(caminho, paginasAlvo, timeoutOcrMs, escalaOcr);
        paginas = mesclarTextoOcr(paginas, paginasOcr);
        totalCaracteres = paginas.reduce((soma, p) => soma + p.texto.length, 0);
        semTexto = totalCaracteres < MIN_CARACTERES_TEXTO_VALIDO;
        ocr.tentado = true;
        ocr.paginasProcessadas = paginasOcr.length;
        ocr.paginasLidas = paginasOcr.map(p => p.numero); // base da leitura incremental
        const emBranco = paginasOcr.filter(p => p.branca).length;
        if (emBranco) ocr.paginasEmBranco = emBranco; // puladas: não passaram pelo OCR
        ocr.escala = escalaOcr;
        if (interrompidoPorTempo) {
          ocr.aviso = `OCR foi interrompido após ${(timeoutOcrMs / 1000).toFixed(0)}s (limite de tempo) — só ${paginasOcr.length} de ${paginasAlvo.length} página(s) alvo foram processadas (ajustável via CONTRATOS_OCR_TIMEOUT_MS). Nesta máquina, OCR pode ser lento — considere reduzir CONTRATOS_OCR_MAX_PAGINAS ou CONTRATOS_OCR_ESCALA.`;
        } else if (truncado) {
          ocr.paginasFinaisLidas = finais.length;
          ocr.aviso = `Documento tem ${paginas.length} páginas — OCR rodou só n${maxPaginasOcr === 1 ? 'a primeira página' : `as primeiras ${maxPaginasOcr} páginas`}${finais.length ? ` e nas ${finais.length} últimas` : ''} (ajustável via CONTRATOS_OCR_MAX_PAGINAS).`;
        }
      }
    } catch (err) {
      ocr.aviso = `OCR foi tentado mas falhou: ${err.message}`;
    }
  }

  paginas = paginas.map(p => ({ ...p, texto: mascararCpf(p.texto) }));
  const texto = textoDasPaginas(paginas);

  /* A leitura só é completa se nenhuma página ficou de fora. Sem OCR
     (PDF com camada de texto, ou DOCX), todas as páginas foram lidas; com
     OCR, só se ele processou todas. Quem precisa afirmar AUSÊNCIA de algo
     no documento (o mapa de risco: "não há cláusula de garantia") depende
     disso — com leitura parcial, "não achei" não quer dizer "não existe". */
  const leituraCompleta = !ocr || (ocr.tentado && ocr.paginasProcessadas >= paginas.length);

  const resultado = { caminho, extensao, semTexto, totalCaracteres, paginas, texto, ocr, leituraCompleta };
  // Falha de OCR (exceção, não limite) não vai para o cache: pode ter sido
  // passageira, e a próxima leitura merece tentar de novo.
  // `semCache`: documento enviado pela tela (arquivo temporário) — não fica guardado.
  if (!(ocr && ocr.aviso && /falhou/.test(ocr.aviso)) && !(opcoes && opcoes.semCache)) gravarNoCache(caminho, resultado, maxPaginasOcr, timeoutOcrMs);
  return resultado;
}

module.exports = { suportado, extrairTexto, motivoParaLer, encerrarOcr: encerrarTrabalhador, LEITURA_COMPLETA, EXTENSOES_SUPORTADAS,
  _paraTeste: { trocarOcr: fn => { ocrDaVez = fn || ((...args) => ocrDePaginasPdf(...args)); }, paginasJaLidas, paginasAlvoDoOcr }, _cache: { CONFIG_CACHE, arquivoDeCache, gravarNoCache, lerDoCache, textoDasPaginas } };
