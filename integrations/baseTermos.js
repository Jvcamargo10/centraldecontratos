/* ===================================================================
   integrations/baseTermos.js

   Base de termos: aditivos e apostilamentos numa tabela só, do mesmo
   jeito que baseContratos.js faz com os contratos — pronta para
   consulta, filtro e exportação.

   Fonte: os DOCUMENTOS da pasta de rede (ver termosDosDocumentos.js),
   desde que a integração com o SGC foi desligada (23/09/2026). Até ali
   esta tabela cruzava o cadastro do SGC com a leitura; agora a regra é a
   mesma da Base de Contratos — leitura conferida não se mistura com
   leitura pendente:

     - "Aprovado": o termo está no cadastro (db.aditivos /
       db.apostilamentos), gravado quando alguém aprovou a proposta do
       contrato na Fila de importação;
     - "Pendente de revisão": o termo foi lido da pasta de um contrato
       cuja proposta ainda não foi aprovada.

   Registros que ainda tenham `origemExterna` (vindos do SGC, antes da
   remoção) aparecem como aprovados, com a fonte "SGC" — para a tabela
   não esconder nada enquanto a remoção não roda.

   Só leitura: não escreve nada e não chama rede.
=================================================================== */

const planilhaCsv = require('./planilhaCsv');

const COLUNAS = [
  { chave: 'contrato', rotulo: 'Contrato' },
  { chave: 'especie', rotulo: 'Espécie' },
  { chave: 'numero', rotulo: 'Número do termo' },
  { chave: 'data', rotulo: 'Data de assinatura', rotuloCurto: 'Data', tipo: 'data' },
  { chave: 'empresa', rotulo: 'Empresa' },
  { chave: 'tipo', rotulo: 'Tipo' },
  { chave: 'valor', rotulo: 'Efeito no valor (R$)', rotuloCurto: 'Valor', tipo: 'valor' },
  { chave: 'meses', rotulo: 'Efeito no prazo (meses)', rotuloCurto: 'Meses', tipo: 'numero' },
  /* Apostilamento de gestão não mexe em valor nem em prazo: o que ele
     muda é QUEM responde pelo contrato. Lendo a coluna de cima para
     baixo, vê-se o histórico de gestores do contrato. */
  { chave: 'gestor', rotulo: 'Passou a constar como gestor', rotuloCurto: 'Gestor' },
  { chave: 'suplente', rotulo: 'Passou a constar como suplente', rotuloCurto: 'Suplente' },
  { chave: 'objeto', rotulo: 'O que o termo diz' }
];

const SITUACOES = {
  aprovado: 'Aprovado — no cadastro',
  pendente: 'Pendente de revisão na Fila de importação'
};

const vazio = v => v === undefined || v === null || v === '';

function linhaDoCadastro(t, especie) {
  return {
    situacao: 'aprovado',
    fonte: t.origemExterna ? 'SGC' : (t.origem === 'documento' ? 'Documento' : 'Cadastro'),
    termoId: t.id,
    propostaId: t.propostaId || null,
    valores: {
      contrato: t.contrato || null,
      especie,
      numero: t.numero || null,
      data: t.data || null,
      empresa: t.empresa || null,
      tipo: t.tipo ? String(t.tipo).trim() : null,
      valor: vazio(t.valor) ? null : t.valor,
      meses: vazio(t.meses) ? null : t.meses,
      gestor: t.gestor || null,
      suplente: t.suplente || null,
      objeto: t.objeto || null
    },
    documento: t.documento || null
  };
}

function linhaDaLeitura(t, p) {
  return {
    situacao: 'pendente',
    fonte: 'Documento',
    termoId: null,
    propostaId: p.id,
    valores: {
      contrato: (p.campos && p.campos.numero) || null,
      especie: t.especie,
      numero: t.numero || null,
      data: t.data || null,
      empresa: (p.campos && p.campos.empresa) || null,
      tipo: t.tipo || null,
      valor: vazio(t.valor) ? null : t.valor,
      meses: vazio(t.meses) ? null : t.meses,
      gestor: t.gestor || null,
      suplente: t.suplente || null,
      objeto: t.objeto || null
    },
    documento: t.documento || null
  };
}

function montarBase(db) {
  const linhas = [
    ...(db.aditivos || []).map(t => linhaDoCadastro(t, 'Aditivo')),
    ...(db.apostilamentos || []).map(t => linhaDoCadastro(t, 'Apostilamento'))
  ];

  /* Leitura pendente: contratos cuja proposta ainda não foi aprovada.
     Uma proposta por contrato (a mais recente vale), e só se o contrato
     ainda não tem termos no cadastro — senão o mesmo termo apareceria
     duas vezes, aprovado e pendente. */
  const contratosNoCadastro = new Set(linhas.map(l => String(l.valores.contrato || '').trim()).filter(Boolean));
  const vistos = new Set();
  const pendentes = (db.importacoesPendentes || [])
    .filter(p => p.status === 'pendente')
    .slice()
    .sort((a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')) || (Number(b.id) - Number(a.id)));
  let semLeituraDeTermos = 0;
  for (const p of pendentes) {
    const numero = String((p.campos && p.campos.numero) || '').trim();
    if (!numero || vistos.has(numero) || contratosNoCadastro.has(numero)) continue;
    vistos.add(numero);
    if (!Array.isArray(p.termosLidos)) { semLeituraDeTermos++; continue; }
    p.termosLidos.forEach(t => linhas.push(linhaDaLeitura(t, p)));
  }

  // Mais recentes primeiro; sem data, pelo contrato.
  linhas.sort((a, b) => String(b.valores.data || '').localeCompare(String(a.valores.data || ''))
    || String(b.valores.contrato || '').localeCompare(String(a.valores.contrato || '')));

  const conta = f => linhas.filter(f).length;
  return {
    colunas: COLUNAS,
    situacoes: SITUACOES,
    linhas,
    totais: {
      termos: linhas.length,
      aditivos: conta(l => l.valores.especie === 'Aditivo'),
      apostilamentos: conta(l => l.valores.especie === 'Apostilamento'),
      aprovados: conta(l => l.situacao === 'aprovado'),
      pendentes: conta(l => l.situacao === 'pendente'),
      comGestao: conta(l => l.valores.gestor || l.valores.suplente),
      doSgc: conta(l => l.fonte === 'SGC'),
      contratos: new Set(linhas.map(l => l.valores.contrato).filter(Boolean)).size,
      // Propostas lidas antes de 23/09/2026 ainda não têm os termos:
      // "Recalcular pelas regras" na Fila resolve.
      propostasSemLeituraDeTermos: semLeituraDeTermos
    }
  };
}

/* ------------------------------------------------------------------
   Exportação CSV — formato e neutralização de fórmula em planilhaCsv.js
------------------------------------------------------------------ */
/* `escopo`: 'todas' (padrão), 'aditivos', 'apostilamentos' ou
   'aprovados' (só o que está no cadastro). */
function gerarCsv(base, escopo) {
  const filtro = {
    aditivos: l => l.valores.especie === 'Aditivo',
    apostilamentos: l => l.valores.especie === 'Apostilamento',
    aprovados: l => l.situacao === 'aprovado'
  }[escopo] || (() => true);
  const linhas = base.linhas.filter(filtro);
  const cabecalho = [...COLUNAS.map(c => c.rotulo), 'Situação', 'Fonte', 'Documento lido'];
  const corpo = linhas.map(l => [
    ...COLUNAS.map(c => planilhaCsv.formatarValor(c, l.valores[c.chave])),
    SITUACOES[l.situacao] || l.situacao,
    l.fonte,
    l.documento || ''
  ]);
  return planilhaCsv.montar(cabecalho, corpo);
}

module.exports = { COLUNAS, SITUACOES, montarBase, gerarCsv };
