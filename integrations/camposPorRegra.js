/* ===================================================================
   integrations/camposPorRegra.js

   Três campos que, até 23/09/2026, só a IA preenchia: OBJETO, TIPO DE
   SERVIÇO e GESTOR/SUPLENTE. Aqui eles saem de regra determinística.

   Por que trocar (medido nas 44 propostas de 22/09/2026): dos 303
   campos preenchidos, 222 já vinham de regra e 81 da IA — e a IA custava
   ~66 s por contrato. Dos 81, estes três grupos são 66. Regra é
   reproduzível (o mesmo PDF dá sempre o mesmo resultado), testável e
   instantânea; o modelo pequeno, não — chegou a gravar "gestor" como
   nome do responsável do contrato 072/2020.

   ------------------------------------------------------------------
   Como desfazer (rápido)
   ------------------------------------------------------------------
   Tudo aqui é ligado por variável de ambiente. No .env:

     REGRAS_CAMPOS_EXTRAS=0    -> desliga os três de uma vez
     REGRAS_CAMPO_OBJETO=0     -> desliga só o objeto
     REGRAS_CAMPO_TIPO=0       -> desliga só o tipo de serviço (ligado desde 24/09/2026)
     REGRAS_CAMPO_GESTAO=0     -> desliga só gestor/suplente

   Desligado, este módulo devolve vazio e esses campos ficam em branco
   (vão para "Pendências de leitura"). Nenhum dado já gravado é
   alterado por ligar ou desligar: a regra só vale para a próxima
   leitura (varredura ou "Recalcular").

   ------------------------------------------------------------------
   Gestor e suplente: de onde vêm
   ------------------------------------------------------------------
   GESTOR/SUPLENTE: o SGC devolve o nome MASCARADO ("*****"), então a
   única fonte é o documento. O nome vale pelo ato mais recente —
   apostilamento ou portaria de alteração de gestor —, não pelo contrato
   original, que traz o gestor de anos atrás. A redação é regular:
   "...para que conste como Gestor, o Senhor FULANO DE TAL, inscrito no
   CPF/MF...". O nome fica entre o cargo e o "inscrito no CPF".

   O que a regra NÃO achar fica em branco, com aviso — e cai na tela de
   Pendências de leitura, para alguém confirmar. Em branco com aviso é
   melhor do que um nome errado gravado em silêncio.
=================================================================== */

const { pecas } = require('./valorContratual');
const { dividirEmDocumentos, classificarDocumento, numeroDoTermo, anoDoTermo, regexDoNumero } = pecas;

const ligado = (nome, padrao = true) => {
  if (String(process.env.REGRAS_CAMPOS_EXTRAS || '').trim() === '0') return false;
  const v = String(process.env[nome] || '').trim();
  return v === '' ? padrao : v !== '0';
};

const CONFIG = {
  get objeto() { return ligado('REGRAS_CAMPO_OBJETO'); },
  /* LIGADA desde 24/09/2026, a pedido do usuário. Em 23/09/2026 ficou
     desligada porque concordava com o SGC em só 8 de 20 contratos — mas o
     SGC classificava "locação de microcomputadores" como Serviços e
     cibersegurança como Software. O dicionário foi revisto com os objetos
     reais; o campo continua editável na Fila. REGRAS_CAMPO_TIPO=0 desliga. */
  get tipo() { return ligado('REGRAS_CAMPO_TIPO', true); },
  get gestao() { return ligado('REGRAS_CAMPO_GESTAO'); }
};

const limpar = t => String(t || '').replace(/\s+/g, ' ').trim();

/* ------------------------------------------------------------------
   1. OBJETO — a cláusula primeira do contrato, como está escrita
------------------------------------------------------------------ */
const ABERTURA_OBJETO = [
  /* "do presente CONTRATO" é a redação dos contratos de 2025/2026 — sem
     ela, o 061/2025 e o 086/2026 ficavam sem objeto (medido em
     24/09/2026). O artigo só é consumido se vier seguido de espaço: senão
     o "A" de "AQUISIÇÃO" sumia. */
  /* "deste instrumento" (141/2022) e "instrurnento" — o OCR lê "m" como
     "rn" — também valem (24/09/2026). */
  /constitui\s+objeto\s+(?:do\s+presente|deste|desta)\s+(?:instru(?:m|rn)ento|contrato|termo|ajuste)\s*(?:(?:a|o|as|os)\s+)?/i,
  /tem\s+por\s+objeto\s*(?:(?:a|o|as|os)\s+)?/i,
  /objeto\s+do\s+presente\s+contrato\s*[:é]\s*/i,
  /\bOBJETO\s*:\s*/
];
/* Onde a descrição termina: o que vem depois é remissão a edital,
   proposta e folhas do processo — não faz parte do objeto. */
const FIM_DO_OBJETO = /\s*(?:,\s*)?(?:conforme|de\s+acordo\s+com|nos\s+termos|segundo)\s+(?:as\s+|o\s+)?(?:exig[êe]ncias|especifica|condi[çc][õo]es|edital|termo\s+de\s+refer|proposta|anexo|proje|proced|caracter[íi]stic)|CL[ÁA]USULA\s+SEGUNDA|\s1\.2\.|\bPelo\s+presente\b/i;

/* O campo objeto obedece à chave REGRAS_CAMPO_OBJETO; a leitura do
   objeto em si (lerObjeto) também serve ao tipo de serviço, que tem a
   sua própria chave. */
function acharObjeto(texto, numeroContrato) {
  return CONFIG.objeto ? lerObjeto(texto, numeroContrato) : null;
}

function lerObjeto(texto, numeroContrato) {
  const documentos = dividirEmDocumentos(texto).map(d => ({ ...d, ...classificarDocumento(d.nome) }));
  const semNomes = documentos.length === 1 && !documentos[0].nome;
  /* O objeto vale do CONTRATO. Na falta dele, só o EXTRATO DO CONTRATO —
     não o de aditivo ou apostilamento: a página do Diário Oficial traz
     vários atos, e o 141/2022 e o 045/2022 ganhavam o objeto de outro
     contrato ("aquisição de veículo", "recapeamento asfáltico"). E, no
     extrato, o número deste contrato tem de aparecer logo antes. */
  const reNumero = numeroContrato ? regexDoNumero(numeroContrato) : null;
  const candidatos = semNomes ? documentos : [
    ...documentos.filter(d => d.tipo === 'contrato' && !d.extrato),
    ...documentos.filter(d => d.tipo === 'contrato' && d.extrato)
  ];

  for (const d of candidatos) {
    const t = limpar(d.texto);
    for (const abertura of ABERTURA_OBJETO) {
      const m = abertura.exec(t);
      if (!m) continue;
      if (d.extrato && (!reNumero || !reNumero.test(t.slice(Math.max(0, m.index - 800), m.index)))) continue;
      let trecho = t.slice(m.index + m[0].length, m.index + m[0].length + 600);
      const fim = FIM_DO_OBJETO.exec(trecho);
      if (fim) trecho = trecho.slice(0, fim.index);
      trecho = trecho.replace(/\s*[.;,]\s*$/, '').trim();
      // Curto demais é sobra de OCR; longo demais virou a cláusula inteira.
      if (trecho.length < 15) continue;
      if (trecho.length > 420) trecho = trecho.slice(0, 417).replace(/\s+\S*$/, '') + '...';
      return { valor: trecho, fonte: d.nome || 'contrato' };
    }
  }
  return null;
}

/* ------------------------------------------------------------------
   2. TIPO DE SERVIÇO — dicionário editável, não "achismo" do modelo
   A lista de tipos é a do próprio sistema (db.TIPOS_SERVICO); aqui só
   ficam as palavras que apontam para cada um. Palavra nova? Acrescente
   na lista abaixo — é texto, não modelo.
------------------------------------------------------------------ */
/* Ordem = do termo mais ESPECÍFICO para o mais genérico: vale o primeiro
   tipo que casar. "Licenças do fabricante Cofre de Senhas" é Segurança antes
   de ser Software; "locação de microcomputadores" é Hardware antes de ser
   Serviço. Revisto em 24/09/2026 com os objetos dos contratos reais, a
   pedido do usuário (categorias no espírito de Software, Hardware,
   Infraestrutura). "Outros" fica para o que não é de TI (veículo,
   purificador de água, obra). */
const PALAVRAS_POR_TIPO = [
  ['Segurança', [/ciberseguran/i, /seguran[çc]?a\s+(?:d[ae]s?\s+informa|cibern|digital)/i, /cibern[ée]tic/i, /antiv[íi]rus/i, /firewall/i, /\bWAF\b/, /\bVPN\b/i, /identidades?\s+privilegiad/i, /senha\s+segura/i, /cofre\s+de\s+senha/i, /prote[çc][ãa]o\s+(?:para|de)\s+(?:terminais|endpoint|dados)/i, /detec[çc][ãa]o\s+e\s+(?:resposta|conten[çc][ãa]o)/i, /comportamentos?\s+anormal/i, /(?:gest[ãa]o|gerenciamento|varredura|an[áa]lise)\s+de\s+vulnerabilidades/i, /monitoramento\s+de\s+amea/i, /\bSOC\b/]],
  ['Telefonia', [/telefonia/i, /\bvoip\b/i, /\bpabx\b/i, /telef[ôo]nic/i, /\bramais\b/i, /link\s+de\s+voz/i]],
  ['Rede', [/comunica[çc][ãa]o\s+multim[íi]dia/i, /\bSCM\b/, /\binternet\b/i, /conectividade/i, /\blinks?\s+de\s+dados/i, /fibra\s+[óo]ptica/i, /\bwi-?fi\b/i, /\bswitch/i, /\broteador/i, /cabeamento/i, /interconex[ãa]o/i, /telecomunica/i, /rede\s+(?:l[óo]gica|corporativa|de\s+dados|sem\s+fio)/i]],
  ['Infraestrutura', [/data\s*center/i, /armazenamento/i, /\bstorage\b/i, /capacidade\s+(?:de\s+processamento|computacional)/i, /expans[ãa]o\s+de\s+processamento/i, /\bservidores\b/i, /\bbackup\b/i, /nobreak|\bUPS\b/i, /climatiza[çc][ãa]o/i, /hospedagem/i, /\bnuvem\b|\bcloud\b/i]],
  ['Hardware', [/microcomputador/i, /\bcomputador(?:es)?\b/i, /\bnotebooks?\b/i, /\bdesktops?\b/i, /\bmonitor(?:es)?\b/i, /\btablets?\b/i, /impress[ãa]o|impressor/i, /esta[çc][õo]es\s+de\s+trabalho/i, /equipamentos?\s+de\s+(?:inform[áa]tica|TI|tecnologia)/i, /\bperif[ée]ricos\b/i, /substitui[çc][ãa]o\s+de\s+pe[çc]as/i]],
  ['Software', [/licen[çc]as?\b/i, /licenciament/i, /\bsoftwares?\b/i, /\bsistemas?\b/i, /plataforma/i, /aplicativ/i, /\bERP\b/, /subscri[çc][ãa]o/i, /solu[çc][ãa]o\s+(?:de\s+gest[ãa]o|tecnol[óo]gica|integrada|eletr[ôo]nica)/i]],
  ['Serviços', [/presta[çc][ãa]o\s+de\s+servi[çc]os/i, /servi[çc]os?\s+(?:t[ée]cnicos|especializados|de\s+tecnologia)/i, /suporte\s+t[ée]cnico/i, /manuten[çc][ãa]o/i, /consultoria/i, /treinamento/i, /digitaliza[çc][ãa]o/i, /desmaterializa/i, /geoprocessamento/i, /outsourcing/i]]
];

/* `tiposValidos` (db.TIPOS_SERVICO) manda: o que não estiver lá não é
   sugerido, para a tela de Contratos não ganhar categoria inventada. */
function acharTipoServico(textoOuObjeto, tiposValidos) {
  if (!CONFIG.tipo) return null;
  const t = limpar(textoOuObjeto).slice(0, 4000);
  if (!t) return null;
  const validos = Array.isArray(tiposValidos) && tiposValidos.length ? tiposValidos : PALAVRAS_POR_TIPO.map(p => p[0]);
  /* Vale o PRIMEIRO tipo da lista que casar, não o que casar mais vezes:
     a lista está em ordem de especificidade. Contar acertos fazia o
     072/2020 ("licenciamento de solução de gerenciamento de identidades
     privilegiadas") cair em Software por 3 a 1, quando o SGC o classifica
     como Segurança — "identidades privilegiadas" é o termo que decide. */
  for (const [tipo, padroes] of PALAVRAS_POR_TIPO) {
    if (!validos.includes(tipo)) continue;
    const casou = padroes.filter(p => p.test(t));
    if (casou.length) return { valor: tipo, fonte: `termo do dicionário no objeto (${casou.length} ocorrência(s))` };
  }
  // Objeto lido, mas sem nenhum termo de TI (veículo, purificador, obra).
  if (validos.includes('Outros')) return { valor: 'Outros', fonte: 'objeto sem termo de tecnologia do dicionário' };
  return null;
}

/* ------------------------------------------------------------------
   3. GESTOR E SUPLENTE — o ato mais recente manda
------------------------------------------------------------------ */
/* O nome vem entre o papel e uma âncora de fechamento — nos atos da
   Prefeitura, quase sempre "inscrito no CPF/MF" ou "ocupante do cargo".
   Capturar ATÉ a âncora (e não "N palavras com inicial maiúscula")
   evita cortar sobrenome: "ISABELA TEIXEIRA LIMA" virava
   "RODRIGO VALENTE DE". */
const FECHA_NOME = String.raw`(?=\s*,?\s*(?:inscrit|ocupante|portador|matr[íi]cula|CPF|e\s+com\s+matr[íi]cula|e\s+ocupante|\.|,\s*bem\s+como\b|,\s*e\s+(?:o|a|como)\b))`;
const NOME = String.raw`([A-ZÀ-Ý][A-Za-zÀ-ÿ'´\- ]{5,68}?)` + FECHA_NOME;
/* "sob a gestão da Servidora, Senhora FULANA" (075/2025) é o gestor
   dito de outro jeito. */
const PAPEL = String.raw`(gestor(?:a)?\s+suplente|suplente\s+de\s+gestor|suplente|gestor(?:a)?|gest[ãa]o\s+d[ao]\s+servidor(?:a)?|fiscal)`;
const TRATAMENTO = String.raw`(?:\s*,\s*|\s+)(?:(?:o|a|os|as)\s+)?(?:(?:nov[oa]\s+)?(?:senhor(?:a)?|sr\.?|sra\.?|servidor(?:a)?)\s*)?(?:\s*,\s*)?`;
const RE_PAPEL_NOME = new RegExp(PAPEL + String.raw`(?:\s+titular|\s+contratual|\s+do\s+contrato|\s+do\s+presente\s+contrato)?` + TRATAMENTO + NOME, 'gi');
/* Redações da parte dispositiva usadas pela Prefeitura. "passando a
   constar" é a mais comum nos apostilamentos de 2024/2025 e não estava
   prevista — sem ela, três contratos ficavam sem gestor. */
/* A cláusula de gestão do PRÓPRIO contrato ("ficará sob o regime de
   acompanhamento e fiscalização pelo gestor titular, Senhor ...") também
   é abertura: sem ela, o contrato só dava gestor quando havia
   apostilamento (medido em 24/09/2026). */
const ABERTURA_ATO = /(acompanhamento\s+e\s+fiscaliza[çc][ãa]o|ficar[áa]\s+sob\s+(?:o\s+regime|a\s+gest[ãa]o|a\s+responsabilidade)|DA\s+GEST[ÃA]O\s+E\s+(?:DA\s+)?FISCALIZA[ÇC][ÃA]O|para\s+que\s+conste|para\s+constar|passand[oa]\s+a\s+constar|para\s+que\s+altere|para\s+que\s+seja\s+alterad|fica\s+designad|fica\s+nomead|passa\s+a\s+ser|nomea[çc][ãa]o\s+d[eo]\s+gestor)/i;
/* Palavras que não aparecem em nome de pessoa. As do segundo grupo são
   as que sobravam da própria frase: a expressão tem flag `i` (precisa,
   porque a portaria escreve "senhor Isabela Teixeira Lima" em
   minúsculas), então a caixa do texto não pode ser usada como validação
   — quem barra a frase é esta lista, mais o limite de palavras. */
const PALAVRA_PROIBIDA = new RegExp([
  'contrat', 'secretari', 'prefeitura', 'munic[íi]pio', 'cl[áa]usula', 'apostilament', 'portaria',
  'processo', 'empresa', 'cargo', 'departament', 'ger[êe]ncia', 'diretoria', 'inova[çc]', 'tecnologia',
  'passand', 'constar', 'conste', 'alterad', 'designad', 'senhor', 'servidor', 'ocupante', 'inscrit', '\\bnov[oa]\\b', '\\bitem\\b'
].join('|'), 'i');

function nomeValido(nome) {
  // "pelo gestor, titular ANA PAULA CARDOSO MELO" (108/2024): "titular" é o papel.
  const n = limpar(nome).replace(/^titular\s+/i, '');
  if (n.length < 8 || n.length > 70) return null;
  if (PALAVRA_PROIBIDA.test(n)) return null;
  const palavras = n.split(/\s+/).filter(p => p.length > 1);
  // Nome de pessoa tem de 2 a 6 partes; mais do que isso é frase.
  if (palavras.length < 2 || palavras.length > 6) return null;
  return n;
}

/* "ISABELA TEIXEIRA LIMA" e "Isabela Teixeira Lima" são a mesma
   pessoa — a base fica legível e comparável com um formato só. */
function normalizarNome(nome) {
  const minusculas = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'del']);
  return limpar(nome).split(/\s+/).map((original, i) => {
    // Inicial solta ("WAGNER DUARTE CAMPOS") continua maiúscula: o "e"
    // ali é parte do nome, não conectivo.
    if (original.length === 1) return original.toUpperCase();
    const p = original.toLowerCase();
    return (i > 0 && minusculas.has(p)) ? p : p.charAt(0).toUpperCase() + p.slice(1);
  }).join(' ');
}

/* "…para constar o Senhor FULANO DE TAL, inscrito no CPF…": a frase não
   repete o cargo. Quem diz o papel, nesses casos, é o ASSUNTO do
   apostilamento ("Alteração de gestor", "Alteração de suplente"). Só
   vale quando o assunto cita UM papel — com os dois, não há como saber
   qual nome é qual. */
const RE_CONSTAR_NOME = new RegExp(String.raw`(?:para\s+(?:que\s+)?const\w+|passand[oa]\s+a\s+constar|fica\s+designad\w+|fica\s+nomead\w+)\s+(?:o|a)\s+(?:nov[oa]\s+)?(?:senhor(?:a)?|sr\.?|sra\.?)\s+` + NOME, 'gi');

function papelPeloAssunto(texto) {
  const cabecalho = limpar(texto).slice(0, 400);
  const assunto = /assunto\s*:?\s*([^.]{3,80})/i.exec(cabecalho);
  const alvo = assunto ? assunto[1] : cabecalho;
  const temGestor = /gestor(?!\s+suplente)/i.test(alvo);
  const temSuplente = /suplente/i.test(alvo);
  if (temGestor && !temSuplente) return 'responsavel';
  if (temSuplente && !temGestor) return 'suplente';
  return null;
}

/* Termo de Ciência e Notificação do TCE-SP, anexado aos contratos:
   "GESTOR(ES) DO CONTRATO: Nome: FULANO DE TAL Cargo: ...". */
const RE_FORMULARIO_TCE = /GESTOR\(?E?S?\)?\s+DO\s+CONTRATO\s*:?\s*Nome\s*:\s*([A-ZÀ-Ý][A-Za-zÀ-ÿ'´\- ]{5,68}?)\s+Cargo\b/;

function lerFormularioTce(texto) {
  const m = RE_FORMULARIO_TCE.exec(limpar(texto));
  const nome = m && nomeValido(m[1]);
  return nome ? { responsavel: normalizarNome(nome) } : null;
}

function lerAtoDeGestao(texto) {
  const t = limpar(texto);
  const achados = {};
  const guardar = (papel, nome) => { if (papel && nome && !achados[papel]) achados[papel] = normalizarNome(nome); };

  /* A parte dispositiva pode não ser a primeira ocorrência: o
     "CONSIDERANDO" às vezes já diz "para constar". Percorre todas. */
  const aberturas = [...t.matchAll(new RegExp(ABERTURA_ATO.source, 'gi'))];
  for (const ato of aberturas) {
    const trecho = t.slice(ato.index, ato.index + 900);
    let m;
    RE_PAPEL_NOME.lastIndex = 0;
    while ((m = RE_PAPEL_NOME.exec(trecho))) {
      const nome = nomeValido(m[2]);
      if (!nome) continue;
      guardar(/suplente/i.test(m[1]) ? 'suplente' : /fiscal/i.test(m[1]) ? 'fiscal' : 'responsavel', nome);
    }
    if (achados.responsavel && achados.suplente) break;
  }

  if (!achados.responsavel) {
    const tce = RE_FORMULARIO_TCE.exec(t);
    if (tce) guardar('responsavel', nomeValido(tce[1]));
  }

  if (!achados.responsavel && !achados.suplente) {
    const papel = papelPeloAssunto(t);
    if (papel) {
      RE_CONSTAR_NOME.lastIndex = 0;
      let m;
      while ((m = RE_CONSTAR_NOME.exec(t))) {
        const nome = nomeValido(m[1]);
        if (nome) { guardar(papel, nome); break; }
      }
    }
  }
  return Object.keys(achados).length ? achados : null;
}

/* Ano do ato quando o nome do arquivo não diz ("Portaria alteração
   gestor e suplente do contrato 66_20.pdf"): o número/ano da portaria no
   texto, senão o fecho "Itaverde, ... de AAAA", senão o maior ano citado. */
function anoDoAtoPeloTexto(texto) {
  const t = String(texto || '');
  const portaria = t.match(/portaria\s*n\S{0,3}\s*\d{1,5}\s*[\/.]\s*(20\d{2})/i);
  if (portaria) return Number(portaria[1]);
  const fecho = t.match(/itaverde[^.]{0,60}?\bde\s+(20\d{2})/i);
  if (fecho) return Number(fecho[1]);
  const anos = [...t.matchAll(/\b(20\d{2})\b/g)].map(m => Number(m[1]));
  return anos.length ? Math.max(...anos) : 0;
}

/* Ordem dos atos: apostilamento/portaria mais recente primeiro (ano e
   número do termo), contrato por último. Ano desconhecido vale ZERO (vai
   para o fim) — anoDoTermo devolve 9999 nesse caso, o que colocava uma
   portaria sem ano na frente de um apostilamento de 2025. */
function ordemDoAto(d) {
  const doNome = anoDoTermo(d.nome, d.texto, numeroDoTermo(d.nome));
  const ano = (doNome && doNome !== 9999) ? doNome : anoDoAtoPeloTexto(d.texto);
  const numero = Number(String(numeroDoTermo(d.nome) || '0').replace(/\D/g, '')) || 0;
  return ano * 1000 + numero;
}

function acharGestaoDoContrato(texto, numeroContrato) {
  if (!CONFIG.gestao) return null;
  const documentos = dividirEmDocumentos(texto).map(d => ({ ...d, ...classificarDocumento(d.nome) }));
  const semNomes = documentos.length === 1 && !documentos[0].nome;
  /* O ato tem de citar ESTE contrato. Sem esta conferência, um
     apostilamento de outro contrato guardado na mesma pasta entrava como
     gestor — aconteceu com o 072/2020, que recebeu o suplente de um ato
     do 045/2022. Mesma cautela que valorContratual.js já toma. */
  const reNumero = numeroContrato ? regexDoNumero(numeroContrato) : null;
  const ehDesteContrato = d => !reNumero || reNumero.test(d.texto || '');
  const ehAtoDeGestao = d => /apostil|portaria/i.test(d.nome || '') && !d.extrato && ehDesteContrato(d);

  /* Aditivo não é ato de gestão, mas traz anexo o Termo de Ciência e
     Notificação do TCE-SP, que declara o gestor NAQUELA data. Dele só se
     lê o formulário — o corpo do aditivo fala de outras coisas. Foi o que
     faltava no 045/2022: o gestor só aparece nos formulários dos
     aditivos 215/2022 e 238/2024 (medido em 24/09/2026). */
  const ehAditivoComFormulario = d => d.tipo === 'aditivo' && !d.extrato && ehDesteContrato(d) && RE_FORMULARIO_TCE.test(limpar(d.texto));
  const atos = documentos.filter(d => ehAtoDeGestao(d) || ehAditivoComFormulario(d)).sort((a, b) => ordemDoAto(b) - ordemDoAto(a));
  const contratos = semNomes ? documentos : documentos.filter(d => d.tipo === 'contrato' && !d.extrato);

  /* Uma fonte POR CAMPO: é comum o ato mais recente trocar só o gestor e
     o suplente continuar vindo de um apostilamento anterior — dizer que
     os dois saíram do mesmo documento seria falso na tela.

     `historico` guarda a CADEIA inteira, do mais recente para o mais
     antigo. Sem ela, o sistema respondia "quem é o gestor hoje?" mas não
     "quem era o gestor quando isto aconteceu?" — e a resposta some
     quando o próximo apostilamento troca o nome. Medido em 23/09/2026:
     7 dos 31 contratos já têm dois ou mais atos de gestão. */
  const resultado = {
    responsavel: null, suplente: null,
    fonteResponsavel: null, fonteSuplente: null,
    historico: [], avisos: []
  };
  for (const d of [...atos, ...contratos]) {
    const achados = ehAtoDeGestao(d) || contratos.includes(d) ? lerAtoDeGestao(d.texto) : lerFormularioTce(d.texto);
    if (!achados) continue;
    const documento = d.nome || 'contrato';
    const termo = numeroDoTermo(d.nome) || null;
    const ano = ordemDoAto(d) >= 1000 ? Math.floor(ordemDoAto(d) / 1000) : null;
    /* O mesmo ato costuma aparecer duas vezes na pasta: o PDF e uma
       cópia, ou a PORTARIA e o APOSTILAMENTO que a publica — mesmos
       nomes, mesmo ano. Repetir isso no histórico faria parecer que
       houve duas nomeações. */
    const jaVisto = resultado.historico.find(h => h.documento === documento
      || (h.responsavel === (achados.responsavel || null)
        && h.suplente === (achados.suplente || null)
        && (h.ano === ano || ano === null || h.ano === null)));
    if (!jaVisto) {
      resultado.historico.push({
        documento,
        termo,
        ano,
        responsavel: achados.responsavel || null,
        suplente: achados.suplente || null,
        atual: false
      });
    }
    if (!resultado.responsavel && achados.responsavel) {
      resultado.responsavel = achados.responsavel;
      resultado.fonteResponsavel = documento;
    }
    if (!resultado.suplente && achados.suplente) {
      resultado.suplente = achados.suplente;
      resultado.fonteSuplente = documento;
    }
  }
  // Marca, na cadeia, de onde vem cada nome que vale hoje.
  resultado.historico.forEach(h => {
    h.atual = (h.documento === resultado.fonteResponsavel) || (h.documento === resultado.fonteSuplente);
  });

  if (!resultado.responsavel && atos.length) {
    resultado.avisos.push(`Há ${atos.length} apostilamento(s)/portaria(s) de gestor na pasta, mas o nome não pôde ser lido — confira no documento.`);
  }
  return (resultado.responsavel || resultado.suplente || resultado.avisos.length) ? resultado : null;
}

/* ------------------------------------------------------------------
   4. PREPOSTO DA CONTRATADA (24/09/2026)
   ------------------------------------------------------------------
   O contrato só traz a OBRIGAÇÃO ("a CONTRATADA deverá manter preposto,
   aceito pelo CONTRATANTE" — Lei 14.133, art. 118; Lei 8.666, art. 68).
   O nome vem num documento da própria empresa — "Ofício ... Apresentação
   de preposto e equipe técnica", "Indicação de Preposto" — guardado em
   qualquer subpasta do processo, ou num campo "Preposto" da Ordem de
   Início/Fornecimento. Medido na pasta: 3 dos 37 processos têm esse
   documento. Sem ele, o campo fica vazio, dizendo se o contrato exige.
------------------------------------------------------------------ */
const NOME_DO_PREPOSTO = String.raw`([A-ZÀ-Ý][A-Za-zÀ-ÿ'´\- ]{5,68}?)(?=\s*[,;]|\s+(?:portador|inscrit|CPF|RG\b|nacionalidade|brasileir|residente|matr[íi]cula|cargo|e-?mail|telefone|tel\.|celular|ocupante|como\s+prepost|para\s+(?:atuar|representar|exercer|responder))|\s*$)`;
const TRATAMENTO_PREPOSTO = String.raw`(?:(?:o|a)\s+)?(?:(?:sr|sra)\.?\s+|senhora?\s+)?`;
const PADROES_PREPOSTO = [
  // "Pela presente autorizamos Wagner Nunes Prado, nacionalidade brasileira"
  new RegExp(String.raw`autoriza(?:mos|-se)\s+` + TRATAMENTO_PREPOSTO + NOME_DO_PREPOSTO, 'i'),
  // "indicamos como preposto o Sr. FULANO" / "indicação do preposto: FULANO"
  new RegExp(String.raw`indica(?:mos|-se|[çc][ãa]o\s+d[eo])\s+(?:como\s+)?(?:(?:o|a)\s+)?(?:nosso\s+|nossa\s+)?prepost[oa](?:\s+(?:da\s+contratada|do\s+contrato))?\s*[,:\-–]?\s*` + TRATAMENTO_PREPOSTO + NOME_DO_PREPOSTO, 'i'),
  // "Preposto: FULANO" / "PREPOSTO DA CONTRATADA – FULANO"
  new RegExp(String.raw`prepost[oa](?:\s+(?:da\s+contratada|do\s+contrato|indicad[oa]))?\s*[:\-–]\s*` + TRATAMENTO_PREPOSTO + NOME_DO_PREPOSTO, 'i'),
  // "o Sr. FULANO, ... como preposto"
  new RegExp(String.raw`(?:sr|sra)\.?\s+` + NOME_DO_PREPOSTO + String.raw`[^.]{0,120}?(?:como|na\s+fun[çc][ãa]o\s+de)\s+prepost[oa]`, 'i')
];
const CONECTIVOS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'del']);

/* A expressão é insensível a maiúsculas (os ofícios escrevem de vários
   jeitos), então a forma do NOME é conferida à parte: 2 a 6 palavras,
   todas com inicial maiúscula — "a execução dos serviços" não passa. */
function nomeDePessoa(bruto) {
  const n = nomeValido(bruto);
  if (!n) return null;
  const palavras = n.split(/\s+/).filter(p => !CONECTIVOS.has(p.toLowerCase()));
  return palavras.every(p => /^[A-ZÀ-Ý]/.test(p)) ? n : null;
}

function lerPrepostoDoTexto(texto) {
  const t = limpar(texto);
  for (const re of PADROES_PREPOSTO) {
    for (const m of t.matchAll(new RegExp(re.source, 'gi'))) {
      const nome = nomeDePessoa(m[1]);
      if (nome) return normalizarNome(nome);
    }
  }
  return null;
}

/* Documento de indicação em TABELA ("Nome | Telefone | E-mail | Função"),
   com várias pessoas designadas (caso real: "Indicação de Preposto - PM",
   contrato 075/2025): cada nome vem seguido do telefone. Só os nomes são
   guardados — telefone, e-mail e documento, não. */
function lerPrepostosDaTabela(texto) {
  const t = limpar(texto);
  const nomes = [];
  for (const m of t.matchAll(/([A-ZÀ-Ý][A-Za-zÀ-ÿ'´-]+(?:\s+[A-Za-zÀ-ÿ'´-]+){1,5})\s*\(\d{2}\)\s*\d{4,5}-?\d{4}/g)) {
    // O trecho pode começar em palavra de cabeçalho ("Função Leandro Paiva..."): corta até achar um nome válido.
    const palavras = m[1].split(/\s+/);
    // Cabeçalho e cargo da linha anterior ("Gerente de Projeto Fulano ...") não fazem parte do nome.
    const CABECALHO_OU_CARGO = /^(?:nome|telefone|e-?mail|fun[çc][ãa]o|cpf|rg|gerente|respons[áa]vel|diretor[a]?|coordenador[a]?|analista|t[ée]cnic[oa]|projeto|contrato|suporte|de|da|do|das|dos|e|pelo|pela)$/i;
    for (let i = 0; i < palavras.length - 1; i++) {
      if (CABECALHO_OU_CARGO.test(palavras[i])) continue;
      const nome = nomeDePessoa(palavras.slice(i).join(' '));
      if (nome) { nomes.push(normalizarNome(nome)); break; }
    }
  }
  return [...new Set(nomes)];
}

function acharPreposto(texto, numeroContrato) {
  const documentos = dividirEmDocumentos(texto).map(d => ({ ...d, ...classificarDocumento(d.nome) }));
  const contratos = documentos.filter(d => d.tipo === 'contrato' && !d.extrato);
  const exigido = contratos.some(d => /prepost[oa]/i.test(d.texto));
  const anoDoNome = d => Math.max(0, ...[...String(d.nome).matchAll(/\b(20\d{2})\b/g)].map(m => Number(m[1])));
  const candidatos = [
    // A indicação mais recente primeiro (Ofício 001-OMTX-2026 antes do de 2025).
    ...documentos.filter(d => /prepost/i.test(d.nome)).sort((a, b) => anoDoNome(b) - anoDoNome(a)),
    ...documentos.filter(d => d.tipo === 'ordem'),
    ...contratos
  ];
  const reNumero = numeroContrato ? regexDoNumero(numeroContrato) : null;
  for (const d of candidatos) {
    // Documento que cita OUTRO contrato não é deste (a pasta pode guardar cópias).
    if (reNumero && /contrato\s*n/i.test(d.texto) && !reNumero.test(d.texto) && !/prepost/i.test(d.nome)) continue;
    const nome = lerPrepostoDoTexto(d.texto);
    if (nome) return { valor: nome, fonte: d.nome || 'contrato', exigido };
    if (/prepost/i.test(d.nome)) {
      const tabela = lerPrepostosDaTabela(d.texto);
      if (tabela.length) {
        return { valor: tabela[0], fonte: `${d.nome}${tabela.length > 1 ? ` — também indicados: ${tabela.slice(1).join(', ')}` : ''}`, exigido, indicados: tabela };
      }
    }
  }
  return { valor: null, fonte: null, exigido };
}

/* Fachada usada pela leitura (leituraPorRegra.lerCampos): devolve só os
   campos que a regra achou, com a origem de cada um. */
function aplicar(texto, opcoes) {
  const tipos = (opcoes && opcoes.tiposValidos) || null;
  const campos = {};
  const origem = {};
  const avisos = [];

  const objeto = acharObjeto(texto, opcoes && opcoes.numeroContrato);
  if (objeto) { campos.objeto = objeto.valor; origem.objeto = objeto.fonte; }

  // Só pelo OBJETO: o texto inteiro (Diário Oficial, certidões) cita
  // "internet", "sistema"... de qualquer coisa. Sem objeto, fica em branco.
  const objetoParaTipo = objeto || (CONFIG.tipo ? lerObjeto(texto, opcoes && opcoes.numeroContrato) : null);
  const tipo = objetoParaTipo ? acharTipoServico(objetoParaTipo.valor, tipos) : null;
  if (tipo) { campos.tipo = tipo.valor; origem.tipo = tipo.fonte; }

  const gestao = acharGestaoDoContrato(texto, opcoes && opcoes.numeroContrato);
  let historico = null;
  if (gestao) {
    if (gestao.historico && gestao.historico.length) historico = gestao.historico;
    if (gestao.responsavel) { campos.responsavel = gestao.responsavel; origem.responsavel = gestao.fonteResponsavel; }
    if (gestao.suplente) { campos.suplente = gestao.suplente; origem.suplente = gestao.fonteSuplente; }
    avisos.push(...gestao.avisos);
  }

  if (CONFIG.gestao) {
    const preposto = acharPreposto(texto, opcoes && opcoes.numeroContrato);
    if (preposto.valor) { campos.preposto = preposto.valor; origem.preposto = preposto.fonte; }
    else if (preposto.exigido) origem.preposto_semValor = 'O contrato exige preposto da contratada, mas a indicação não foi encontrada nos documentos do processo.';
    else origem.preposto_semValor = 'Nenhuma indicação de preposto nos documentos do processo.';
  }
  return { campos, origem, avisos, ...(historico ? { gestaoHistorico: historico } : {}) };
}

module.exports = {
  aplicar,
  // Lê um ato de gestão isolado (apostilamento/portaria) — usado também
  // pela leitura dos termos (termosDosDocumentos.js).
  lerAtoDeGestao,
  // Validação de nome de pessoa (o cargo ou um pedaço de frase não é nome).
  nomeValido,
  acharObjeto,
  acharTipoServico,
  acharGestaoDoContrato,
  acharPreposto,
  CONFIG,
  _paraTeste: { lerAtoDeGestao, nomeValido, normalizarNome, ordemDoAto, PALAVRAS_POR_TIPO, lerPrepostoDoTexto }
};
