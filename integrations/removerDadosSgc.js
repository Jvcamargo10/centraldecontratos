/* ===================================================================
   integrations/removerDadosSgc.js

   Remove do banco local TUDO o que veio da API do SGC — decisão de
   23/09/2026, junto com o desligamento da integração
   (CONTRATOS_API_DESLIGADA=1 no .env).

   Por que existe como função separada (e pura): é uma operação
   destrutiva sobre o banco inteiro. Separada do disco, ela pode ser
   testada contra um banco de mentira — e o script que grava
   (ferramentas/removerDadosSgc.js) só cuida de backup, de conferir que
   o servidor está parado e de gravar.

   O que sai:
     - contratos, aditivos, apostilamentos, requisições e gratificações
       marcados com `origemExterna` (é a marca que a sincronização põe
       em tudo o que traz — ver contratosApi.js);
     - o que depende desses contratos e ficaria órfão: mapas de risco,
       fichas de cadastro, tratativas e comentários ligados a eles;
     - o estado da sincronização (`integracoes.contratosApi`).

   O que fica, de propósito:
     - a trilha de auditoria (registro do que aconteceu não se apaga);
     - as propostas da Fila de importação — são leitura dos documentos da
       pasta de rede, não dado do SGC. Pendentes que apontavam para um
       contrato removido perdem o vínculo (aprovar passa a criar um
       contrato novo); aprovadas ficam como histórico, marcadas.
=================================================================== */

const COLECOES_DO_SGC = ['contratos', 'aditivos', 'apostilamentos', 'requisicoes', 'gratificacoes'];

function removerDadosDoSgc(db) {
  const resumo = { removidos: {}, dependentesRemovidos: {}, propostasDesvinculadas: 0, propostasAprovadasMarcadas: 0 };

  const idsContratos = new Set((db.contratos || []).filter(c => c && c.origemExterna).map(c => String(c.id)));

  for (const colecao of COLECOES_DO_SGC) {
    const antes = (db[colecao] || []).length;
    db[colecao] = (db[colecao] || []).filter(x => !(x && x.origemExterna));
    resumo.removidos[colecao] = antes - db[colecao].length;
  }

  // Dependentes que ficariam apontando para contrato inexistente.
  for (const colecao of ['mapasRisco', 'fichasCadastro', 'tratativas', 'comentarios']) {
    const antes = (db[colecao] || []).length;
    db[colecao] = (db[colecao] || []).filter(x => !(x && idsContratos.has(String(x.contratoId))));
    resumo.dependentesRemovidos[colecao] = antes - db[colecao].length;
  }

  for (const p of (db.importacoesPendentes || [])) {
    if (p.status === 'pendente' && p.contratoExistenteId != null && idsContratos.has(String(p.contratoExistenteId))) {
      p.contratoExistenteId = null;
      resumo.propostasDesvinculadas++;
    }
    if (p.status === 'aprovado' && p.contratoId != null && idsContratos.has(String(p.contratoId))) {
      p.contratoRemovido = { em: new Date().toISOString(), motivo: 'Contrato vindo da API do SGC, removido com o desligamento da integração.' };
      resumo.propostasAprovadasMarcadas++;
    }
  }

  if (db.integracoes && db.integracoes.contratosApi) {
    delete db.integracoes.contratosApi;
    resumo.estadoDaSincronizacaoRemovido = true;
  }

  resumo.totalRemovido = Object.values(resumo.removidos).reduce((s, n) => s + n, 0)
    + Object.values(resumo.dependentesRemovidos).reduce((s, n) => s + n, 0);
  return resumo;
}

module.exports = { removerDadosDoSgc, COLECOES_DO_SGC };
