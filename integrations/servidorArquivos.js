/* ===================================================================
   integrations/servidorArquivos.js

   Varredura da(s) pasta(s) de rede onde a Prefeitura guarda os arquivos
   de contrato (Ferramenta 1 — ingestão automatizada).
   Enquanto CONTRATOS_ARQUIVOS_PASTAS não estiver configurada, este
   módulo fica inerte, igual ao padrão já usado em contratosApi.js.

   Este módulo só ENXERGA arquivos — não lê o conteúdo (isso é
   extratorDocumento.js) nem decide nada sobre contrato (isso é
   ingestaoContratos.js). A única responsabilidade daqui é: dada uma
   lista de pastas, achar os arquivos candidatos, AGRUPÁ-LOS por
   contrato (ver "Agrupamento" abaixo) e dizer quais grupos são novos ou
   mudaram desde a última varredura.

   ------------------------------------------------------------------
   Agrupamento por contrato
   ------------------------------------------------------------------
   Na estrutura real de pastas da Prefeitura (ver README), um único
   contrato normalmente tem VÁRIOS arquivos numa mesma subpasta — ex:
   "...\Contrato Nº 096_2025\Contrato Comercial Nº 096_2025.pdf" e
   "...\Contrato Nº 096_2025\Extrato do Contrato Comercial Nº 096_2025.pdf"
   no mesmo lugar. As informações de um contrato podem estar espalhadas
   entre esses arquivos (um tem as cláusulas completas, outro só um
   resumo/extrato com um dado que falta no primeiro). Por isso, os
   arquivos candidatos são agrupados pela PASTA IMEDIATA que os contém
   (o "path.dirname" de cada arquivo) — cada grupo vira UMA proposta na
   fila de importação (ver ingestaoContratos.js), com o texto de todos
   os arquivos do grupo combinado antes de ler os campos, em vez de uma proposta por arquivo que quem revisa teria que
   reconciliar manualmente.

   Isso é uma escolha pragmática, não perfeita: se dois contratos
   diferentes, por algum motivo, dividirem a mesma pasta (não deveria
   acontecer na estrutura observada, mas pastas de rede reais têm
   surpresa), eles seriam tratados como um grupo só. Quem revisa a
   proposta sempre vê a lista de arquivos-fonte usados (arquivosFonte),
   então um agrupamento errado fica visível e corrigível na hora da
   revisão — nunca vira contrato sem alguém olhar.

   Importante: como são pastas de REDE (SMB), calcular um hash de
   verdade exigiria ler o arquivo inteiro pela rede a cada varredura —
   caro se forem muitos arquivos grandes. Por isso a "assinatura" de
   mudança usada aqui é tamanho + data de modificação do arquivo
   (fs.stat), o mesmo sinal que o Windows Explorer usa pra saber se
   algo mudou. Não é infalível (um arquivo poderia, em teoria, mudar
   sem alterar nenhum dos dois), mas é o equilíbrio certo pra não deixar
   a varredura lenta demais. A assinatura de um GRUPO é a combinação das
   assinaturas de todos os arquivos que o compõem — se qualquer arquivo
   do grupo mudar, for removido, ou um arquivo novo aparecer na mesma
   pasta, o grupo inteiro é considerado alterado e reprocessado.
=================================================================== */

const fs = require('fs');
const path = require('path');
const percurso = require('./percursoPastas');

const CONFIG = {
  // Uma ou mais pastas, separadas por ";" (não por vírgula — caminho de
  // rede no Windows não usa ; e vírgula poderia aparecer num nome de
  // pasta). Ex.:
  //   CONTRATOS_ARQUIVOS_PASTAS=\\servidor\contratos;\\servidor\aditivos
  pastas: (process.env.CONTRATOS_ARQUIVOS_PASTAS || '')
    .split(';')
    .map(p => p.trim())
    .filter(Boolean),
  // Extensões candidatas a conter contrato. Sem o ponto, separadas por vírgula.
  extensoes: (process.env.CONTRATOS_ARQUIVOS_EXTENSOES || 'pdf,docx')
    .split(',')
    .map(e => e.trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean),
  // Profundidade máxima de subpastas percorridas, pra nunca travar numa
  // estrutura de pasta gigante ou com link circular.
  profundidadeMaxima: Number(process.env.CONTRATOS_ARQUIVOS_PROFUNDIDADE_MAX) || 10,
  // Nomes de (sub)pasta sempre ignorados.
  pastasIgnoradas: ['$recycle.bin', 'system volume information', '.git', 'node_modules'],
  // Padrões (case-insensitive, substring simples — não regex, pra ficar
  // fácil de configurar sem saber regex) que um NOME DE ARQUIVO precisa
  // conter pra ser candidato — além da extensão. Vazio (padrão) = aceita
  // qualquer nome com extensão candidata, igual ao comportamento
  // original. Preencher ajuda a busca em pastas de rede gigantes a achar
  // só o que interessa (ex: só arquivos com "contrato", "aditivo" ou
  // "apostilamento" no nome), em vez de pegar todo PDF/DOCX da árvore.
  /* Nome (ou parte do nome) da subpasta de cada processo onde ficam os
     documentos de contrato. Na estrutura da Prefeitura, cada processo
     ("P.A. 01.275_2025 - ...") tem 21 subpastas numeradas — edital,
     propostas, notas fiscais, empenhos, pagamentos — e os documentos de
     contrato ficam sempre em "3. Contratos, Aditivos e Termos". Medido em
     21/09/2026: a pasta de processos em vigência tem 6.451 arquivos, dos
     quais só 238 são de contrato. Sem este filtro, apontar a varredura
     para a raiz faria OCR em notas fiscais e empenhos por horas,
     gerando "propostas de contrato" a partir deles.
     Com o filtro configurado:
       - só arquivos DENTRO dessa subpasta são candidatos;
       - as outras subpastas numeradas ("1. Edital...", "12. NF...") nem
         são percorridas — faz diferença num drive de rede;
       - o GRUPO de cada proposta passa a ser essa subpasta inteira: o
         contrato e os aditivos/apostilamentos (em subpastas dela) viram
         uma proposta só, que é o que a avaliação contra o SGC mostrou
         funcionar. Vazio (padrão) = comportamento anterior. */
  subpastaContratos: (process.env.CONTRATOS_ARQUIVOS_SUBPASTA || '').trim().toLowerCase(),
  padroesNome: (process.env.CONTRATOS_ARQUIVOS_PADROES_NOME || '')
    .split(',')
    .map(p => p.trim().toLowerCase())
    .filter(Boolean)
};

function isConfigured() {
  return CONFIG.pastas.length > 0;
}

function statusPublico() {
  return {
    configurado: isConfigured(),
    pastas: CONFIG.pastas,
    extensoes: CONFIG.extensoes,
    padroesNome: CONFIG.padroesNome,
    subpastaContratos: CONFIG.subpastaContratos || null
  };
}

/* Arquivo temporário de bloqueio que o Word/Excel/Adobe cria ao abrir um
   documento (ex: "~$Contrato 012.docx") — nunca é o contrato de verdade,
   sempre ignorar. Também ignora arquivos ocultos (começando com "."). */
function nomeIgnoravel(nome) {
  return nome.startsWith('~$') || nome.startsWith('.');
}

function temExtensaoCandidata(nome) {
  const ext = path.extname(nome).toLowerCase().replace(/^\./, '');
  return CONFIG.extensoes.includes(ext);
}

/* Quando CONTRATOS_ARQUIVOS_PADROES_NOME está vazio (padrão), todo nome
   passa. Quando preenchido, o nome do arquivo precisa conter pelo menos
   um dos padrões configurados (substring, sem diferenciar maiúsculas). */
function nomeBateComPadroes(nome) {
  if (CONFIG.padroesNome.length === 0) return true;
  const nomeLower = nome.toLowerCase();
  return CONFIG.padroesNome.some(padrao => nomeLower.includes(padrao));
}

/* Pasta de um PROCESSO ("P.A. 01.275_2025 - ...", "P.A 13.389_2021 ..."). */
function ehPastaDeProcesso(nome) {
  return /^P\.?\s*A\.?\s*\d/i.test(String(nome || ''));
}

/* A pasta é a subpasta de contratos de um processo? (ver CONFIG.subpastaContratos)
   25/09/2026 — a raiz passou a ser "9. Gestão de Contratos" (em vigência,
   encerrados e outras secretarias), e o nome da subpasta varia:
   "3. Contratos, Aditivos e Termos" (55 processos), "3. Contrato,
   Aditivos e Termos", "2. Contrato e Aditivos", "2. Contratos e Termos",
   "Contrato, aditivos e OI" e, num processo com dois contratos, uma pasta
   por contrato ("Contrato nº 53_2022 - Vertex"). "16. Link Gestão de
   Contratos" e "21. Entregas Previstas em Contrato" NÃO são. O valor do
   .env continua valendo (substring), além destes padrões. */
const PADROES_SUBPASTA_CONTRATOS = [
  /^(?:\d{1,2}\s*\.\s*)?contratos?\s*(?:,|\be\b)[^\\/]*?\b(?:aditivos?|termos?|oi)\b/i,
  /^contratos?\s+n[º°o.]?\s*\d/i
];
const NAO_E_SUBPASTA_DE_CONTRATOS = /\blink\b|entregas|gest[ãa]o\s+de\s+contratos/i;
function ehSubpastaDeContratos(nome) {
  if (!CONFIG.subpastaContratos) return false;
  const n = String(nome || '');
  if (NAO_E_SUBPASTA_DE_CONTRATOS.test(n)) return false;
  return n.toLowerCase().includes(CONFIG.subpastaContratos) || PADROES_SUBPASTA_CONTRATOS.some(re => re.test(n));
}

/* Subpasta NUMERADA de um processo ("1. Edital...", "12. NF...") que não é
   a de contratos — com o filtro ligado, não vale a pena nem entrar. Só
   DENTRO de um processo: "3. Processos Administrativos - Contratos em
   Vigência" e "4. ... Encerrados" também são numeradas, e é por elas que
   se chega aos processos. */
function ehOutraSubpastaNumerada(nome, nomeDaPastaMae) {
  return !!CONFIG.subpastaContratos && ehPastaDeProcesso(nomeDaPastaMae) && /^\d{1,2}\s*\.\s/.test(nome) && !ehSubpastaDeContratos(nome);
}

/* A subpasta de contratos que contém o caminho: o ancestral cujo nome casa
   com o filtro E que está direto dentro de uma pasta de processo — assim
   "Arquivos para Excluir\Contrato Nº 061_2024" (fora de processo) não
   conta, e "3. Contratos...\Contrato Nº 015_2024\..." agrupa pela "3.". */
function subpastaDeContratosDe(caminho) {
  if (!CONFIG.subpastaContratos) return null;
  let atual = path.dirname(caminho);
  for (let i = 0; i < 8; i++) {
    const pai = path.dirname(atual);
    if (ehSubpastaDeContratos(path.basename(atual)) && ehPastaDeProcesso(path.basename(pai))) return atual;
    if (pai === atual) break;
    atual = pai;
  }
  return null;
}

/* Modelo em branco: "xx_xxxx", "xxx" (minúsculos) ou "XXX" logo depois de
   Contrato/Nº/_, "Modelo", "Minuta" — "Anexo XX" é número romano, não
   modelo. Ver ingestaoContratos.escolherArquivoPrincipal (25/09/2026). */
function ehModeloDeDocumento(nome) {
  const n = String(nome || '');
  return /(?:^|[\s_ºo°.-])x{2,}(?:[_\/.-]x+)*(?=$|[\s_.-])/.test(n)
    || /(?:contrato|n[º°o]\.?|_)\s*X{2,}(?:[_\/.-]X+)*(?=$|[\s_.-])/i.test(n) && /X{2,}/.test(n)
    || /\bmodelo\b|\bminuta\b/i.test(n);
}

/* Termos de ENCERRAMENTO do processo (25/09/2026): a subpasta "20. Termo
   de Encerramento" do processo (ou da pasta do contrato, quando o processo
   tem uma pasta por contrato, como o 13.389) e arquivo com "termo de
   encerramento" no nome dentro da própria pasta do contrato. Modelo em
   branco fica de fora. Quando há .docx e .pdf com o mesmo nome, vale o
   .docx (lê na hora, sem OCR). Quem decide se o termo é deste contrato é
   termoEncerramento.js, pelo número citado no texto. */
function documentosDeEncerramento(caminhoDoGrupo) {
  if (!caminhoDoGrupo) return [];
  const sub = ehSubpastaDeContratos(path.basename(caminhoDoGrupo)) ? caminhoDoGrupo : subpastaDeContratosDe(caminhoDoGrupo);
  if (!sub) return [];
  const processo = path.dirname(sub);
  if (!caminhoPermitido(processo)) return [];
  const achados = [];
  const aceitar = (c, nome) => temExtensaoCandidata(nome) && !nomeIgnoravel(nome) && !ehModeloDeDocumento(nome) && achados.push(c);
  const visitar = (pasta, profundidade) => {
    let entradas;
    try { entradas = fs.readdirSync(pasta, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entradas) {
      const c = path.join(pasta, e.name);
      if (e.isDirectory() && profundidade < 2) visitar(c, profundidade + 1);
      else if (e.isFile()) aceitar(c, e.name);
    }
  };
  for (const base of [processo, sub]) {
    let pastas = [];
    try { pastas = fs.readdirSync(base, { withFileTypes: true }).filter(e => e.isDirectory() && /encerramento/i.test(e.name)); } catch (e) { continue; }
    pastas.forEach(p => visitar(path.join(base, p.name), 0));
  }
  // Termo de encerramento guardado junto com o contrato.
  (function naSubpasta(pasta, profundidade) {
    let entradas;
    try { entradas = fs.readdirSync(pasta, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entradas) {
      const c = path.join(pasta, e.name);
      if (e.isDirectory() && profundidade < 3 && !/encerramento/i.test(e.name)) naSubpasta(c, profundidade + 1);
      else if (e.isFile() && /termo\s*(?:de\s*)?encerramento/i.test(e.name)) aceitar(c, e.name);
    }
  })(sub, 0);
  // Sem repetição; .docx no lugar do .pdf de mesmo nome.
  const unicos = [...new Set(achados)];
  const semExt = c => c.replace(/\.(pdf|docx?)$/i, '').toLowerCase();
  const comDocx = new Set(unicos.filter(c => /\.docx$/i.test(c)).map(semExt));
  return unicos.filter(c => !(/\.pdf$/i.test(c) && comDocx.has(semExt(c))));
}

/* Documentos de GARANTIA contratual do processo (28/09/2026): apólice de
   seguro-garantia, caução, fiança, endosso. Não há subpasta própria — nas
   pastas medidas, a apólice fica em "16. Outros documentos" (8 de 37
   processos) — então o processo inteiro é percorrido, só pelo NOME do
   arquivo (leve). "Devolução de caução" não é garantia vigente. */
function documentosDeGarantia(caminhoDoGrupo) {
  if (!caminhoDoGrupo) return [];
  const sub = ehSubpastaDeContratos(path.basename(caminhoDoGrupo)) ? caminhoDoGrupo : subpastaDeContratosDe(caminhoDoGrupo);
  if (!sub) return [];
  const processo = path.dirname(sub);
  if (!caminhoPermitido(processo)) return [];
  const achados = [];
  (function visitar(pasta, profundidade) {
    if (profundidade > 4 || achados.length >= 20) return;
    let entradas;
    try { entradas = fs.readdirSync(pasta, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entradas) {
      const c = path.join(pasta, e.name);
      if (e.isDirectory()) { if (!CONFIG.pastasIgnoradas.includes(e.name.toLowerCase())) visitar(c, profundidade + 1); }
      else if (e.isFile() && temExtensaoCandidata(e.name) && !nomeIgnoravel(e.name) && !ehModeloDeDocumento(e.name)
        && /ap[óo]lice|seguro[\s_-]*garantia|garantia[\s_-]*contratual|cau[çc][ãa]o|fian[çc]a|endosso/i.test(e.name)
        && !/devolu/i.test(e.name)) achados.push(c);
    }
  })(processo, 0);
  return achados;
}

/* De onde veio o processo, pela pasta: "encerrado" (4. ... Contratos
   Encerrados), "outra_secretaria" (5. Processos de Outras Secretarias) ou
   "vigencia". A aprovação cadastra o encerrado já como Encerrado. */
function categoriaDoCaminho(caminho) {
  const s = String(caminho || '');
  if (/contratos\s+encerrados/i.test(s)) return 'encerrado';
  if (/outras\s+secretarias/i.test(s)) return 'outra_secretaria';
  return 'vigencia';
}

/* Percorre recursivamente uma pasta (até `profundidadeMaxima`), coletando
   os arquivos candidatos. Uma subpasta sem permissão de leitura (comum em
   pasta de rede grande, com áreas restritas) gera um aviso em `avisos` em
   vez de derrubar a varredura inteira. */
/* Assíncrona desde 24/09/2026: percorrer a pasta de rede (6.451
   arquivos) levava ~1,7 s com o servidor parado; agora ele continua
   respondendo enquanto a pasta é lida. */
/* Desde 06/10/2026 as subpastas são lidas ao mesmo tempo (até 8 pedidos à
   rede — ver percursoPastas.js): cada visita devolve os seus arquivos e
   avisos, e o resultado é montado na MESMA ordem de antes (a da pasta). */
async function percorrerPasta(raiz, avisos) {
  async function visitar(atual, profundidade, dentroDaSubpasta) {
    const res = { arquivos: [], avisos: [] };
    if (profundidade > CONFIG.profundidadeMaxima) {
      res.avisos.push(`Profundidade máxima atingida em "${atual}" — subpastas mais fundas não foram percorridas.`);
      return res;
    }
    let entradas;
    try {
      entradas = await percurso.lerPasta(atual);
    } catch (err) {
      res.avisos.push(`Não foi possível ler "${atual}": ${err.message}`);
      return res;
    }
    const nomeAtual = path.basename(atual);
    // Processo sem nenhuma subpasta de contrato (só TR, parecer, propostas
    // soltos): nada é lido dele — e a varredura diz qual é, em vez de calar.
    if (CONFIG.subpastaContratos && !dentroDaSubpasta && ehPastaDeProcesso(nomeAtual)
        && !entradas.some(e => e.isDirectory() && ehSubpastaDeContratos(e.name))) {
      res.avisos.push(`Processo sem subpasta de contrato — não lido: "${path.relative(raiz, atual) || nomeAtual}".`);
    }
    const partes = await Promise.all(entradas.map(async entrada => {
      if (nomeIgnoravel(entrada.name)) return null;
      const caminhoCompleto = path.join(atual, entrada.name);
      if (entrada.isDirectory()) {
        if (CONFIG.pastasIgnoradas.includes(entrada.name.toLowerCase())) return null;
        if (!dentroDaSubpasta && ehOutraSubpastaNumerada(entrada.name, nomeAtual)) return null;
        const entraNaSubpasta = !dentroDaSubpasta && ehSubpastaDeContratos(entrada.name) && ehPastaDeProcesso(nomeAtual);
        const filho = await visitar(caminhoCompleto, profundidade + 1, dentroDaSubpasta || entraNaSubpasta);
        if (entraNaSubpasta && filho.arquivos.length === 0) {
          filho.avisos.push(`Subpasta de contrato vazia (sem PDF ou Word) — nada lido: "${path.relative(raiz, caminhoCompleto)}".`);
        }
        return filho;
      }
      if (entrada.isFile() && temExtensaoCandidata(entrada.name) && nomeBateComPadroes(entrada.name)) {
        // Com o filtro ligado, só vale arquivo que está dentro da subpasta de contratos.
        if (CONFIG.subpastaContratos && !dentroDaSubpasta) return null;
        return { arquivos: [caminhoCompleto], avisos: [] };
      }
      return null;
    }));
    for (const p of partes) {
      if (!p) continue;
      for (const a of p.arquivos) res.arquivos.push(a);
      for (const a of p.avisos) res.avisos.push(a);
    }
    return res;
  }

  if (!fs.existsSync(raiz)) {
    avisos.push(`Pasta configurada não encontrada (ou sem acesso agora): "${raiz}".`);
    return [];
  }
  // A própria raiz pode já ser uma subpasta de contratos (ou estar dentro de uma).
  const r = await visitar(raiz, 0, ehSubpastaDeContratos(path.basename(raiz)) || !!subpastaDeContratosDe(path.join(raiz, 'x')));
  for (const a of r.avisos) avisos.push(a);
  return r.arquivos;
}

/* Assinatura leve de um arquivo (tamanho + data de modificação), usada só
   pra saber se ele mudou desde a última varredura — ver nota no topo do
   arquivo sobre por que não é um hash de conteúdo de verdade. */
/* Agrupa uma lista de caminhos pela pasta imediata que os contém — ver
   nota "Agrupamento por contrato" no topo do arquivo. Devolve um Map
   ordenado por pasta (não que a ordem importe funcionalmente, só ajuda a
   depurar/logar de forma previsível). */
function agruparPorPasta(caminhos) {
  const grupos = new Map();
  for (const caminho of caminhos) {
    // Com o filtro de subpasta ligado, o grupo é a subpasta de contratos
    // inteira (contrato + aditivos em subpastas dela = uma proposta).
    const pasta = subpastaDeContratosDe(caminho) || path.dirname(caminho);
    if (!grupos.has(pasta)) grupos.set(pasta, []);
    grupos.get(pasta).push(caminho);
  }
  return grupos;
}

/* Assinatura de um GRUPO inteiro: junta a assinatura de cada arquivo
   (ordenado por caminho, pra ser determinístico) — muda se qualquer
   arquivo do grupo mudar, for removido, ou um novo arquivo aparecer na
   mesma pasta. */
function assinaturaDoGrupo(assinaturasPorArquivo) {
  return assinaturasPorArquivo
    .slice()
    .sort((a, b) => a.caminho.localeCompare(b.caminho))
    .map(a => `${a.caminho}::${a.assinatura}`)
    .join('|');
}

/* Varre todas as pastas configuradas e devolve só os GRUPOS (pastas com
   1+ arquivo candidato) NOVOS ou ALTERADOS desde a última vez que
   `ingestaoContratos.js` os marcou como vistos (ver `arquivosVistos`,
   guardado em db.integracoes.arquivosContratos.arquivosVistos — chave é
   o caminho da PASTA do grupo, não mais de um arquivo individual). Não
   marca nada como visto aqui — quem decide quando um grupo foi de fato
   processado (e portanto pode ser marcado) é o orquestrador, depois que
   a etapa seguinte terminar. */
/* Todos os arquivos candidatos das pastas configuradas, sem olhar o que
   já foi visto — usado pela leitura noturna (ferramentas/leituraNoturna.js). */
async function listarCandidatos() {
  const avisos = [];
  const arquivos = [];
  for (const pasta of CONFIG.pastas) arquivos.push(...(await percorrerPasta(pasta, avisos)));
  return { arquivos, avisos };
}

async function listarArquivosNovosOuAlterados(db) {
  if (!isConfigured()) {
    throw new Error('Nenhuma pasta configurada — defina CONTRATOS_ARQUIVOS_PASTAS antes de varrer.');
  }
  const vistos = (db.integracoes && db.integracoes.arquivosContratos && db.integracoes.arquivosContratos.arquivosVistos) || {};
  const avisos = [];
  const candidatos = [];

  for (const pasta of CONFIG.pastas) {
    const arquivosDaPasta = await percorrerPasta(pasta, avisos);
    candidatos.push(...arquivosDaPasta);
  }

  const grupos = agruparPorPasta(candidatos);
  const novosOuAlterados = [];
  let gruposIgnorados = 0;

  // Tamanho e data de todos os arquivos, ao mesmo tempo (até 8 pedidos à rede); a ordem segue a de antes.
  const estados = await Promise.all([...grupos].map(([, caminhos]) => Promise.all(caminhos.map(caminho =>
    percurso.statArquivo(caminho).then(st => ({ caminho, assinatura: `${st.size}:${Math.round(st.mtimeMs)}` }), err => ({ caminho, erro: err.message }))))));
  let g = 0;
  for (const [pastaGrupo] of grupos) {
    const assinaturasPorArquivo = [];
    let falhouStat = false;
    for (const e of estados[g++]) {
      if (e.erro) {
        avisos.push(`Não foi possível verificar "${e.caminho}": ${e.erro}`);
        falhouStat = true;
      } else assinaturasPorArquivo.push(e);
    }
    if (falhouStat || assinaturasPorArquivo.length === 0) continue;

    const assinaturaGrupo = assinaturaDoGrupo(assinaturasPorArquivo);
    const anterior = vistos[pastaGrupo];
    if (!anterior || anterior.assinatura !== assinaturaGrupo) {
      novosOuAlterados.push({ pasta: pastaGrupo, arquivos: assinaturasPorArquivo, assinatura: assinaturaGrupo });
    } else {
      gruposIgnorados++;
    }
  }

  return {
    // Total de arquivos candidatos encontrados nesta varredura (mudados
    // ou não) — útil pra saber o tamanho da árvore de pastas, mas NÃO é
    // "quantos são novos/alterados" (ver totalArquivosAlterados abaixo).
    // Um nome parecido demais com o de baixo já causou confusão real
    // neste projeto (uma varredura que não achou nada nem morno de novo
    // mostrava, mesmo assim, "de N arquivo(s) novo(s)/alterado(s)" na
    // tela, com N sendo simplesmente todo arquivo já visto antes).
    totalCandidatos: candidatos.length,
    totalGrupos: grupos.size,
    // Conta só os arquivos que pertencem a grupos NOVOS/ALTERADOS — o
    // número que de fato corresponde ao texto "novo(s)/alterado(s)" que
    // a tela mostra depois da varredura.
    totalArquivosAlterados: novosOuAlterados.reduce((soma, g) => soma + g.arquivos.length, 0),
    novosOuAlterados,
    ignoradosPorJaVistos: gruposIgnorados,
    avisos
  };
}

/* Chamado pelo orquestrador depois de processar (com sucesso ou não) um
   GRUPO — grava a assinatura atual pra não reprocessar à toa na próxima
   varredura. `status` guarda só um resumo curto (ex: "proposto",
   "sem_texto", "erro:mensagem"), útil pra depuração. `arquivos` é a
   lista de caminhos que compunham o grupo nesta varredura, guardada só
   pra facilitar auditoria/depuração depois (não é usada pra decidir nada
   na próxima varredura — quem decide é a assinatura). */
function marcarComoVisto(db, pastaGrupo, assinatura, status, arquivos) {
  db.integracoes = db.integracoes || {};
  db.integracoes.arquivosContratos = db.integracoes.arquivosContratos || { ultimaVarredura: null, ultimoResumo: null, arquivosVistos: {} };
  db.integracoes.arquivosContratos.arquivosVistos = db.integracoes.arquivosContratos.arquivosVistos || {};
  db.integracoes.arquivosContratos.arquivosVistos[pastaGrupo] = {
    assinatura,
    status,
    arquivos: arquivos || [],
    processadoEm: new Date().toISOString()
  };
}

/* ---------------------------------------------------------------------
   Navegação manual (Ferramenta 1) — em vez de esperar a varredura
   automática decidir sozinha o que é "novo/alterado", quem usa pode
   entrar nas pastas configuradas pela tela e escolher exatamente quais
   arquivos processar agora (ver processarArquivosSelecionados em
   ingestaoContratos.js). As funções abaixo só ENXERGAM a árvore de
   pastas — não leem conteúdo de arquivo.

   Segurança: um caminho só é aceito se estiver DENTRO de uma das pastas
   configuradas em CONTRATOS_ARQUIVOS_PASTAS (raizQueContem/
   caminhoPermitido) — isso vale tanto pra listar uma subpasta quanto
   pra processar um arquivo selecionado. Sem essa checagem, um caminho
   arbitrário mandado pro endpoint (por engano ou de propósito) poderia
   fazer o servidor ler qualquer arquivo da máquina/rede que o processo
   do Node tenha permissão de acessar — não só os de contrato.
--------------------------------------------------------------------- */
function raizQueContem(caminhoAbsoluto) {
  let normalizado;
  try {
    normalizado = path.resolve(caminhoAbsoluto);
  } catch (e) {
    return null;
  }
  // No Windows o sistema de arquivos não diferencia maiúsculas: um caminho
  // colado do Explorer ("f:\contratos da secretaria\...") é o mesmo lugar.
  const comparavel = c => process.platform === 'win32' ? c.toLowerCase() : c;
  const alvo = comparavel(normalizado);
  return CONFIG.pastas.find(raiz => {
    const raizResolvida = comparavel(path.resolve(raiz));
    return alvo === raizResolvida || alvo.startsWith(raizResolvida + path.sep);
  }) || null;
}

function caminhoPermitido(caminhoAbsoluto) {
  return raizQueContem(caminhoAbsoluto) !== null;
}

/* Lista o conteúdo IMEDIATO (não recursivo — uma pasta de cada vez, pra
   ficar rápido mesmo numa árvore de rede gigante) de um caminho. Sem
   argumento, lista as próprias raízes configuradas, pra servir de ponto
   de partida da navegação na tela. */
function listarConteudoDePasta(caminhoPedido) {
  if (!isConfigured()) {
    throw new Error('Nenhuma pasta configurada — defina CONTRATOS_ARQUIVOS_PASTAS.');
  }
  if (!caminhoPedido) {
    return {
      caminho: null,
      pastas: CONFIG.pastas.map(raiz => ({ nome: raiz, caminho: raiz })),
      arquivos: []
    };
  }
  if (!caminhoPermitido(caminhoPedido)) {
    throw new Error('Caminho fora das pastas configuradas — acesso negado.');
  }
  const alvo = path.resolve(caminhoPedido);
  let entradas;
  try {
    entradas = fs.readdirSync(alvo, { withFileTypes: true });
  } catch (err) {
    throw new Error(`Não foi possível ler "${alvo}": ${err.message}`);
  }
  const pastas = [];
  const arquivos = [];
  for (const entrada of entradas) {
    if (nomeIgnoravel(entrada.name)) continue;
    const caminhoCompleto = path.join(alvo, entrada.name);
    if (entrada.isDirectory()) {
      if (CONFIG.pastasIgnoradas.includes(entrada.name.toLowerCase())) continue;
      pastas.push({ nome: entrada.name, caminho: caminhoCompleto });
    } else if (entrada.isFile() && temExtensaoCandidata(entrada.name) && nomeBateComPadroes(entrada.name)) {
      let tamanho = null, modificadoEm = null;
      try {
        const st = fs.statSync(caminhoCompleto);
        tamanho = st.size;
        modificadoEm = st.mtimeMs;
      } catch (e) {
        // Arquivo pode ter sumido entre o readdir e o stat (alguém mexeu
        // na pasta de rede nesse meio-tempo) — mostra sem esses dados em
        // vez de derrubar a listagem inteira.
      }
      arquivos.push({ nome: entrada.name, caminho: caminhoCompleto, tamanho, modificadoEm });
    }
  }
  pastas.sort((a, b) => a.nome.localeCompare(b.nome));
  arquivos.sort((a, b) => a.nome.localeCompare(b.nome));
  return { caminho: alvo, pastas, arquivos };
}

/* ------------------------------------------------------------------
   Seleção manual a partir do Explorer do Windows (desde 21/09/2026)
   ------------------------------------------------------------------
   Por segurança, o navegador nunca entrega à página o CAMINHO de um
   arquivo — nem pelo seletor "Abrir", nem arrastando do Explorer: só
   nome, tamanho, data de modificação e (numa pasta escolhida) o caminho
   relativo dentro dela. E o sistema precisa do caminho real na rede
   (vínculo com o original, mapa de risco, ficha, conferência). Duas
   saídas, as duas limitadas às pastas configuradas:
     1. o usuário cola o caminho copiado do Explorer
        (resolverCaminhoColado);
     2. o usuário escolhe/arrasta os arquivos, e o servidor os acha na
        pasta de rede por nome + tamanho + data (localizarArquivos). */

/* Aceita o que o Windows entrega ao copiar: com aspas ("Copiar como
   caminho"), com barras normais, ou como file:///F:/... */
function normalizarCaminhoColado(texto) {
  let c = String(texto || '').trim().replace(/^["']+|["']+$/g, '').trim();
  if (/^file:\/\//i.test(c)) {
    c = c.replace(/^file:\/\/\/?/i, '');
    try { c = decodeURIComponent(c); } catch (e) { /* mantém como veio */ }
  }
  return process.platform === 'win32' ? c.replace(/\//g, '\\') : c;
}

/* A mesma pasta tem dois nomes: a letra de unidade configurada
   ("F:\Contratos da Secretaria\...") e o caminho de rede por trás dela
   ("\\SERVARQUIVOS01...\Depto - DTI\Contratos da Secretaria\..."), que é o
   que o Explorer mostra quando a pasta foi aberta pela rede. Aceita as
   duas e devolve { raiz configurada, caminho relativo a ela }. */
const formasDasRaizes = new Map();
function formasDaRaiz(raiz) {
  if (!formasDasRaizes.has(raiz)) {
    const formas = [path.resolve(raiz)];
    try { formas.push(fs.realpathSync.native(raiz)); } catch (e) { /* rede fora do ar: fica só a forma configurada */ }
    formasDasRaizes.set(raiz, [...new Set(formas)]);
  }
  return formasDasRaizes.get(raiz);
}

function traduzirParaRaiz(caminho) {
  const alvo = path.resolve(caminho).toLowerCase();
  for (const raiz of CONFIG.pastas) {
    for (const forma of formasDaRaiz(raiz)) {
      const f = forma.toLowerCase().replace(/[\\/]+$/, '');
      if (alvo === f || alvo.startsWith(f + path.sep)) {
        return { raiz, relativo: path.resolve(caminho).slice(f.length).replace(/^[\\/]+/, '') };
      }
    }
  }
  return null;
}

/* Caminho colado -> a pasta para abrir no navegador de pastas da tela
   (a "pilha" do breadcrumb, da raiz configurada até ela) e, se for um
   arquivo, o próprio arquivo para já deixar marcado. */
function resolverCaminhoColado(texto) {
  if (!isConfigured()) throw new Error('Nenhuma pasta configurada — defina CONTRATOS_ARQUIVOS_PASTAS.');
  const bruto = normalizarCaminhoColado(texto);
  if (!bruto) throw new Error('Cole o caminho de uma pasta ou de um arquivo.');
  if (!path.isAbsolute(bruto)) throw new Error(`"${bruto}" não é um caminho completo — copie da barra de endereço do Explorer (ex.: F:\\...).`);
  const traduzido = traduzirParaRaiz(bruto);
  if (!traduzido) {
    throw new Error(`"${bruto}" fica fora das pastas configuradas (${CONFIG.pastas.join('; ')}).`);
  }
  const { raiz } = traduzido;
  // Refaz o caminho pelos nomes REAIS das pastas (maiúsculas/minúsculas
  // como estão na rede), para bater com os caminhos que a varredura grava.
  let real = raiz;
  for (const parte of traduzido.relativo.split(/[\\/]+/).filter(Boolean)) {
    let entradas;
    try { entradas = fs.readdirSync(real); } catch (e) { entradas = []; }
    const nomeReal = entradas.find(n => n.toLowerCase() === parte.toLowerCase());
    if (!nomeReal) throw new Error(`Não encontrei "${bruto}" — confira se o caminho existe e se a pasta de rede está acessível.`);
    real = path.join(real, nomeReal);
  }
  let st;
  try { st = fs.statSync(real); } catch (e) {
    throw new Error(`Não encontrei "${bruto}" — confira se o caminho existe e se a pasta de rede está acessível.`);
  }
  let arquivo = null;
  if (!st.isDirectory()) {
    if (!temExtensaoCandidata(path.basename(real))) {
      throw new Error(`"${path.basename(real)}" não é um tipo de arquivo lido pelo sistema (${CONFIG.extensoes.join(', ')}).`);
    }
    arquivo = { nome: path.basename(real), caminho: real };
  }
  const pasta = st.isDirectory() ? real : path.dirname(real);
  const pilha = [{ nome: raiz, caminho: raiz }];
  const relativo = path.relative(path.resolve(raiz), pasta);
  if (relativo && !relativo.startsWith('..')) {
    let atual = raiz;
    for (const parte of relativo.split(path.sep).filter(Boolean)) {
      atual = path.join(atual, parte);
      pilha.push({ nome: parte, caminho: atual });
    }
  }
  return { tipo: arquivo ? 'arquivo' : 'pasta', pilha, arquivo };
}

/* Índice nome -> caminhos de todos os documentos das pastas
   configuradas. Só readdir (sem stat): o stat só é feito nos arquivos de
   mesmo nome, na hora de conferir. Montar o índice da pasta de processos
   inteira leva uns 15-20 s pela rede (medido em 21/09/2026) — por isso é
   ASSÍNCRONO (o servidor continua atendendo os outros usuários), começa
   quando o painel de seleção manual abre e vale por 5 minutos. Um
   arquivo que não aparece força um índice novo (pode ter acabado de ser
   salvo). */
const VALIDADE_INDICE_MS = 5 * 60 * 1000;
let indiceDeArquivos = null;
let indiceEmConstrucao = null;

/* Poucas leituras de pasta ao mesmo tempo, com uma nova tentativa: abrir
   centenas de pastas de rede de uma vez (como era até 24/09/2026) fazia
   parte delas falhar, e o índice saía incompleto — arquivo que existe na
   rede aparecia como "não está na pasta de rede configurada". */
const LEITURAS_SIMULTANEAS = 8;
function limitador(maximo) {
  let ativos = 0;
  const fila = [];
  const proximo = () => { if (ativos >= maximo || !fila.length) return; ativos++; const { fn, ok, erro } = fila.shift(); fn().then(ok, erro).finally(() => { ativos--; proximo(); }); };
  return fn => new Promise((ok, erro) => { fila.push({ fn, ok, erro }); proximo(); });
}

async function montarIndiceDeArquivos() {
  const porNome = new Map();
  let ilegiveis = 0;
  const limitar = limitador(LEITURAS_SIMULTANEAS);
  const lerPasta = async atual => {
    try { return await limitar(() => fs.promises.readdir(atual, { withFileTypes: true })); } catch (e) {
      return limitar(() => fs.promises.readdir(atual, { withFileTypes: true })); // uma nova tentativa
    }
  };
  async function visitar(atual, profundidade) {
    if (profundidade > CONFIG.profundidadeMaxima) return;
    let entradas;
    try { entradas = await lerPasta(atual); } catch (err) { ilegiveis++; return; }
    const subpastas = [];
    for (const e of entradas) {
      if (nomeIgnoravel(e.name)) continue;
      const c = path.join(atual, e.name);
      if (e.isDirectory()) {
        if (!CONFIG.pastasIgnoradas.includes(e.name.toLowerCase())) subpastas.push(c);
      } else if (e.isFile() && temExtensaoCandidata(e.name)) {
        const chave = e.name.normalize('NFC').toLowerCase();
        if (!porNome.has(chave)) porNome.set(chave, []);
        porNome.get(chave).push(c);
      }
    }
    await Promise.all(subpastas.map(c => visitar(c, profundidade + 1)));
  }
  for (const raiz of CONFIG.pastas) await visitar(raiz, 0);
  indiceDeArquivos = { criadoEm: Date.now(), porNome, pastasIlegiveis: ilegiveis, pastas: CONFIG.pastas.join(';') };
  return indiceDeArquivos;
}

async function obterIndice(forcar) {
  const valido = indiceDeArquivos && indiceDeArquivos.pastas === CONFIG.pastas.join(';') && Date.now() - indiceDeArquivos.criadoEm <= VALIDADE_INDICE_MS;
  if (!forcar && valido) return indiceDeArquivos;
  if (!indiceEmConstrucao) {
    indiceEmConstrucao = montarIndiceDeArquivos().finally(() => { indiceEmConstrucao = null; });
  }
  return indiceEmConstrucao;
}

/* Um arquivo escolhido no computador -> o caminho dele na pasta de rede.
   Casa por nome e tamanho; havendo mais de um (a mesma cópia em duas
   pastas), desempata pela data de modificação (tolerância de 2 s — o
   Windows e a rede arredondam) e, numa pasta escolhida inteira, pelo
   caminho relativo dentro dela. */
function localizarUm(item, indice) {
  // Mesma forma de acento dos dois lados (o navegador e o disco podem
  // escrever "ç" de jeitos diferentes).
  const nome = String(item.nome || '').normalize('NFC');
  if (!temExtensaoCandidata(nome)) return { nome, situacao: 'nao_suportado' };
  const brutos = indice.porNome.get(nome.toLowerCase()) || [];
  /* Numa pasta escolhida inteira, o caminho DENTRO dela identifica o
     arquivo: "P.A. 00.659_2023 - FIBRA SUL/3. Contratos.../Contrato.pdf" só
     pode ser o dessa pasta. Antes o caminho só desempatava, e um arquivo
     de mesmo nome em outra pasta da rede entrava na conta. */
  if (item.caminhoRelativo) {
    const sufixo = path.sep + String(item.caminhoRelativo).normalize('NFC').replace(/[\\/]+/g, path.sep).toLowerCase();
    const peloCaminho = brutos.filter(c => c.normalize('NFC').toLowerCase().endsWith(sufixo));
    if (peloCaminho.length === 1) return { nome, situacao: 'encontrado', caminho: peloCaminho[0] };
  }
  const candidatos = brutos.map(caminho => {
    try {
      const st = fs.statSync(caminho);
      return { caminho, tamanho: st.size, modificadoEm: st.mtimeMs };
    } catch (e) { return null; }
  }).filter(Boolean);
  let achados = candidatos.filter(c => Number(item.tamanho) === c.tamanho);
  if (achados.length > 1 && item.modificadoEm) {
    const naData = achados.filter(c => Math.abs(c.modificadoEm - Number(item.modificadoEm)) <= 2000);
    if (naData.length) achados = naData;
  }
  if (achados.length > 1 && item.caminhoRelativo) {
    const sufixo = String(item.caminhoRelativo).replace(/[\\/]+/g, path.sep).toLowerCase();
    const peloRelativo = achados.filter(c => c.caminho.toLowerCase().endsWith(path.sep + sufixo));
    if (peloRelativo.length) achados = peloRelativo;
  }
  // A mesma cópia em duas subpastas do processo (caso real: o edital em
  // "1. Edital..." e em "21. Cronograma..."): vale a da subpasta de contratos.
  if (achados.length > 1 && CONFIG.subpastaContratos) {
    const naSubpasta = achados.filter(c => subpastaDeContratosDe(c.caminho));
    if (naSubpasta.length === 1) achados = naSubpasta;
  }
  if (achados.length === 1) return { nome, situacao: 'encontrado', caminho: achados[0].caminho };
  if (achados.length > 1) return { nome, situacao: 'ambiguo', candidatos: achados.map(c => c.caminho) };
  return { nome, situacao: 'nao_encontrado' };
}

const MAX_ARQUIVOS_LOCALIZAR = 500;

/* Lista vazia só prepara o índice (a tela chama ao abrir o painel). */
/* Quando a pasta escolhida é a de um PROCESSO inteiro (com edital,
   propostas, notas fiscais, certidões...), só entram os arquivos da
   subpasta de contratos — a mesma regra da varredura automática. Escolher
   diretamente a subpasta de contratos, ou arquivos soltos, não muda nada. */
function soDaSubpastaDeContratos(itens) {
  if (!CONFIG.subpastaContratos) return { itens, foraDaSubpasta: 0 };
  const pastasDoCaminho = it => String(it.caminhoRelativo || '').split(/[\\/]+/).slice(0, -1);
  const naSubpasta = it => pastasDoCaminho(it).some(ehSubpastaDeContratos);
  if (!itens.some(naSubpasta)) return { itens, foraDaSubpasta: 0 };
  const dentro = itens.filter(it => naSubpasta(it) || !it.caminhoRelativo);
  return { itens: dentro, foraDaSubpasta: itens.length - dentro.length };
}

async function localizarArquivos(lista) {
  if (!isConfigured()) throw new Error('Nenhuma pasta configurada — defina CONTRATOS_ARQUIVOS_PASTAS.');
  const filtrados = soDaSubpastaDeContratos(Array.isArray(lista) ? lista : []);
  const itens = filtrados.itens.slice(0, MAX_ARQUIVOS_LOCALIZAR);
  let indice = await obterIndice(false);
  let resultado = itens.map(i => localizarUm(i, indice));
  // Algum não achado num índice antigo: pode ser arquivo novo — refaz uma vez.
  if (resultado.some(r => r.situacao === 'nao_encontrado') && Date.now() - indice.criadoEm > 5000) {
    indice = await obterIndice(true);
    resultado = itens.map(i => localizarUm(i, indice));
  }
  return {
    resultado,
    foraDaSubpasta: filtrados.foraDaSubpasta,
    ignoradosPorLimite: Math.max(0, filtrados.itens.length - MAX_ARQUIVOS_LOCALIZAR),
    pastasIlegiveis: indice.pastasIlegiveis
  };
}

/* Documentos da pasta "Ordem de Início de Serviço" do MESMO processo
   (24/09/2026). Muitos contratos contam a vigência "do recebimento da
   Ordem de Início", e ela fica numa subpasta própria do processo (a 4ª
   das 21 padronizadas), fora de "Contratos, Aditivos e Termos" — sem
   ela, o término não era calculado (caso do 010/2024). Só essa subpasta
   é lida; as demais (edital, notas fiscais...) continuam de fora. */
function documentosDaOrdemDeInicio(caminhoDoGrupo) {
  if (!caminhoDoGrupo) return [];
  const sub = ehSubpastaDeContratos(path.basename(caminhoDoGrupo)) ? caminhoDoGrupo : subpastaDeContratosDe(caminhoDoGrupo);
  if (!sub) return [];
  const processo = path.dirname(sub);
  if (!caminhoPermitido(processo)) return [];
  const achados = [];
  let pastas;
  try { pastas = fs.readdirSync(processo, { withFileTypes: true }).filter(e => e.isDirectory() && /ordem\s*de\s*in[íi]cio/i.test(e.name)); } catch (e) { return []; }
  const visitar = (pasta, profundidade) => {
    let entradas;
    try { entradas = fs.readdirSync(pasta, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entradas) {
      const c = path.join(pasta, e.name);
      if (e.isDirectory() && profundidade < 2) visitar(c, profundidade + 1);
      else if (e.isFile() && temExtensaoCandidata(e.name) && !nomeIgnoravel(e.name)) achados.push(c);
    }
  };
  pastas.forEach(p => visitar(path.join(processo, p.name), 0));
  return achados;
}

/* Documentos de indicação do PREPOSTO no mesmo processo (24/09/2026):
   "Ofício ... Apresentação de preposto", "Indicação de Preposto". Não há
   subpasta fixa para eles (aparecem em "16. Outros documentos", "21.
   Cronograma", "7. Plano de Comunicação"), então o processo inteiro é
   percorrido — mas só entra arquivo com "preposto" no NOME: é leve e não
   lê notas fiscais nem edital. Cópias do mesmo arquivo entram uma vez. */
function documentosDePreposto(caminhoDoGrupo) {
  if (!caminhoDoGrupo) return [];
  const sub = ehSubpastaDeContratos(path.basename(caminhoDoGrupo)) ? caminhoDoGrupo : subpastaDeContratosDe(caminhoDoGrupo);
  if (!sub) return [];
  const processo = path.dirname(sub);
  if (!caminhoPermitido(processo)) return [];
  const achados = [];
  const nomes = new Set();
  const visitar = (pasta, profundidade) => {
    if (profundidade > 4 || achados.length >= 10) return;
    let entradas;
    try { entradas = fs.readdirSync(pasta, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entradas) {
      const c = path.join(pasta, e.name);
      if (e.isDirectory()) { if (!CONFIG.pastasIgnoradas.includes(e.name.toLowerCase())) visitar(c, profundidade + 1); }
      else if (e.isFile() && /prepost/i.test(e.name) && temExtensaoCandidata(e.name) && !nomeIgnoravel(e.name)) {
        const chave = e.name.toLowerCase().replace(/(\.pdf)+$/, '');
        if (!nomes.has(chave)) { nomes.add(chave); achados.push(c); }
      }
    }
  };
  visitar(processo, 0);
  return achados;
}

/* Todos os documentos candidatos de UMA pasta (não recursivo) — os
   "documentos referentes a um contrato" que o mapa de risco lê: contrato,
   aditivos, apostilamentos, extratos. Mesmos filtros da varredura
   (extensão, padrão de nome, arquivo temporário/oculto) e a mesma
   checagem de segurança: a pasta precisa estar DENTRO das pastas
   configuradas, senão o mapa de risco viraria um jeito de ler qualquer
   pasta da rede que o processo do Node alcança. */
function listarDocumentosDaPasta(pasta) {
  if (!caminhoPermitido(pasta)) {
    throw new Error('Pasta do contrato fora das pastas configuradas em CONTRATOS_ARQUIVOS_PASTAS — acesso negado.');
  }
  // Recursivo (até 3 níveis): na subpasta de contratos de um processo, o
  // contrato e cada aditivo costumam estar em subpastas próprias.
  const docs = [];
  (function andar(d, prof) {
    let entradas;
    try {
      entradas = fs.readdirSync(d, { withFileTypes: true });
    } catch (err) {
      if (prof === 0) throw new Error(`Não foi possível ler a pasta do contrato "${pasta}": ${err.message}`);
      return;
    }
    for (const e of entradas) {
      if (nomeIgnoravel(e.name)) continue;
      const c = path.join(d, e.name);
      if (e.isDirectory()) { if (prof < 3 && !CONFIG.pastasIgnoradas.includes(e.name.toLowerCase())) andar(c, prof + 1); }
      else if (e.isFile() && temExtensaoCandidata(e.name) && nomeBateComPadroes(e.name)) docs.push({ nome: e.name, caminho: c });
    }
  })(pasta, 0);
  return docs.sort((a, b) => a.caminho.localeCompare(b.caminho));
}

/* A pasta do GRUPO de um arquivo — a mesma regra do agrupamento da
   varredura: a subpasta de contratos, se o filtro estiver ligado; senão,
   a pasta do próprio arquivo. O mapa de risco usa isto para ler todos os
   documentos do contrato (inclusive aditivos em subpastas vizinhas). */
function pastaDoGrupo(caminhoArquivo) {
  return subpastaDeContratosDe(caminhoArquivo) || path.dirname(caminhoArquivo);
}

module.exports = {
  isConfigured,
  statusPublico,
  listarArquivosNovosOuAlterados,
  listarCandidatos,
  marcarComoVisto,
  caminhoPermitido,
  listarConteudoDePasta,
  listarDocumentosDaPasta,
  documentosDaOrdemDeInicio,
  documentosDePreposto,
  resolverCaminhoColado,
  localizarArquivos,
  pastaDoGrupo,
  categoriaDoCaminho,
  ehModeloDeDocumento,
  documentosDeEncerramento,
  documentosDeGarantia,
  ehPastaDeProcesso,
  ehSubpastaDeContratos,
  // Exportado só para teste direto do módulo, fora do orquestrador.
  _config: CONFIG
};
