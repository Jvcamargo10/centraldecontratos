/* ===================================================================
   js/api.js — Conversa com o servidor (/api/...). Toda chamada passa por aqui.
   Módulo ES (import/export) da Central de Contratos; ver js/app.js.
=================================================================== */

export let onSessionExpired = null;

/* O app registra aqui o que fazer quando a sessão expira (voltar ao login). */
export function aoExpirarSessao(fn){ onSessionExpired = fn; }

export async function parseError(res, fallback){
  try{ const body = await res.json(); return body.error || fallback; }catch(e){ return fallback; }
}

export async function guardedFetch(url, opts){
  const res = await fetch(url, opts);
  if(res.status===401 && url!=='/api/login' && url!=='/api/session'){
    if(onSessionExpired) onSessionExpired();
    throw new Error('Sua sessão expirou. Faça login novamente.');
  }
  return res;
}

export const api = {
  async login(usuario, senha){
    const res = await fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({usuario,senha}) });
    if(!res.ok) throw new Error(await parseError(res, 'Usuário ou senha inválidos.'));
    return res.json();
  },
  async logout(){ await fetch('/api/logout', { method:'POST' }); },
  async session(){
    const res = await fetch('/api/session');
    if(!res.ok) return null;
    return res.json();
  },
  async bootstrap(){
    const res = await guardedFetch('/api/bootstrap');
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao carregar dados do servidor.'));
    return res.json();
  },
  async historico(contratoId){
    const res = await guardedFetch(`/api/contratos/${contratoId}/historico`);
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao carregar o histórico do contrato.'));
    return res.json();
  },
  async registrarHistorico(contratoId, data){
    const res = await guardedFetch(`/api/contratos/${contratoId}/historico`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao registrar no histórico.'));
    return res.json();
  },
  async corrigirHistorico(id, data){
    const res = await guardedFetch(`/api/historico/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao salvar a correção.'));
    return res.json();
  },
  async salvarPerfilPrazo(id, data){
    const res = await guardedFetch(id ? `/api/perfis-prazo/${encodeURIComponent(id)}` : '/api/perfis-prazo', { method: id ? 'PUT' : 'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao salvar o perfil.'));
    return res.json();
  },
  async excluirPerfilPrazo(id){
    const res = await guardedFetch(`/api/perfis-prazo/${encodeURIComponent(id)}`, { method:'DELETE' });
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao excluir o perfil.'));
    return res.json();
  },
  async definirPrazosContrato(contratoId, data){
    const res = await guardedFetch(`/api/contratos/${contratoId}/prazos`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao salvar os prazos do contrato.'));
    return res.json();
  },
  async updateConfig(data){
    const res = await guardedFetch('/api/config', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao salvar configuração.'));
    return res.json();
  },
  async integracaoStatus(){
    const res = await guardedFetch('/api/integracoes/contratos/status');
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao consultar status da integração.'));
    return res.json();
  },
  async integracaoSincronizar(){
    const res = await guardedFetch('/api/integracoes/contratos/sincronizar', { method:'POST' });
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao sincronizar contratos.'));
    return res.json();
  },
  async alertaEmailStatus(){
    const res = await guardedFetch('/api/integracoes/alertas-email/status');
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao consultar status do resumo por e-mail.'));
    return res.json();
  },
  async alertaEmailEnviarAgora(){
    const res = await guardedFetch('/api/integracoes/alertas-email/enviar-agora', { method:'POST' });
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao enviar o resumo por e-mail.'));
    return res.json();
  },
  async arquivosStatus(){
    const res = await guardedFetch('/api/integracoes/arquivos/status');
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao consultar status da ingestão de arquivos.'));
    return res.json();
  },
  async varrerArquivos(){
    const res = await guardedFetch('/api/integracoes/arquivos/varrer', { method:'POST' });
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao varrer as pastas de arquivos.'));
    return res.json();
  },
  async progressoVarredura(){
    const res = await guardedFetch('/api/integracoes/arquivos/progresso');
    if(!res.ok) return null; // consulta de progresso é best-effort — nunca deve interromper a varredura em si
    return res.json();
  },
  async listarPastasManual(caminho){
    const qs = caminho ? `?caminho=${encodeURIComponent(caminho)}` : '';
    const res = await guardedFetch(`/api/integracoes/arquivos/pastas${qs}`);
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao listar a pasta.'));
    return res.json();
  },
  async resolverCaminho(caminho){
    const res = await guardedFetch('/api/integracoes/arquivos/resolver-caminho', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ caminho }) });
    if(!res.ok) throw new Error(await parseError(res, 'Não foi possível abrir esse caminho.'));
    return res.json();
  },
  async localizarArquivos(arquivos){
    const res = await guardedFetch('/api/integracoes/arquivos/localizar', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ arquivos }) });
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao procurar os arquivos na pasta de rede.'));
    return res.json();
  },
  async extrairSelecionados(caminhos){
    const res = await guardedFetch('/api/integracoes/arquivos/extrair-selecionados', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ caminhos }) });
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao extrair os arquivos selecionados.'));
    return res.json();
  },
  async listarImportacoes(){
    const res = await guardedFetch('/api/importacoes');
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao carregar a fila de importação.'));
    return res.json();
  },
  async aprovarImportacao(id, campos){
    const res = await guardedFetch(`/api/importacoes/${id}/aprovar`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(campos||{}) });
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao aprovar a importação.'));
    return res.json();
  },
  async recalcularImportacoes(){
    const res = await guardedFetch('/api/importacoes/recalcular', { method:'POST' });
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao recalcular as propostas.'));
    return res.json();
  },
  async rejeitarImportacao(id, motivo){
    const res = await guardedFetch(`/api/importacoes/${id}/rejeitar`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({motivo}) });
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao rejeitar a importação.'));
    return res.json();
  },
  async conferenciaSgc(){
    const res = await guardedFetch('/api/conferencia-sgc');
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao carregar a conferência com o SGC.'));
    return res.json();
  },
  async detalheBaseContratos(propostaId){
    const res = await guardedFetch(`/api/base-contratos/detalhe/${encodeURIComponent(propostaId)}`);
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao carregar o detalhe do contrato.'));
    return res.json();
  },
  async registroRiscosResumo(){
    const res = await guardedFetch('/api/registro-riscos');
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao carregar o registro de riscos.'));
    return res.json();
  },
  async registroDoContrato(contratoId){
    const res = await guardedFetch(`/api/registro-riscos/${encodeURIComponent(contratoId)}`);
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao carregar o registro de riscos do contrato.'));
    return res.json();
  },
  async registrarRisco(contratoId, dados){
    const res = await guardedFetch(`/api/registro-riscos/${encodeURIComponent(contratoId)}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(dados||{}) });
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao gravar o registro.'));
    return res.json();
  },
  async atualizarRegistroRisco(contratoId, id, dados){
    const res = await guardedFetch(`/api/registro-riscos/${encodeURIComponent(contratoId)}/${encodeURIComponent(id)}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(dados||{}) });
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao atualizar o registro.'));
    return res.json();
  },
  async baseTermos(){
    const res = await guardedFetch('/api/base-termos');
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao carregar a base de aditivos e apostilamentos.'));
    return res.json();
  },
  async pendenciasLeitura(){
    const res = await guardedFetch('/api/pendencias-leitura');
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao carregar as pendências de leitura.'));
    return res.json();
  },
  // Mudança relida dos documentos (término, valor, gestor, suplente): 'confirmar' ou 'descartar'.
  async decidirMudanca(contratoId, campo, acao){
    const res = await guardedFetch(`/api/pendencias-leitura/mudanca/${encodeURIComponent(contratoId)}`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ campo, acao }) });
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao registrar a decisão sobre a mudança.'));
    return res.json();
  },
  // Termo de encerramento: 'confirmar' (contrato vira Encerrado) ou 'descartar'.
  async decidirEncerramento(contratoId, acao){
    const res = await guardedFetch(`/api/pendencias-leitura/encerramento/${encodeURIComponent(contratoId)}`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ acao }) });
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao registrar a decisão sobre o encerramento.'));
    return res.json();
  },
  async requisicoes(){
    const res = await guardedFetch('/api/requisicoes');
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao carregar as requisições.'));
    return res.json();
  },
  async lerRequisicoes(){
    const res = await guardedFetch('/api/requisicoes/ler', { method:'POST' });
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao iniciar a leitura das requisições.'));
    return res.json();
  },
  async progressoRequisicoes(){
    const res = await guardedFetch('/api/requisicoes/progresso');
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao consultar o andamento.'));
    return res.json();
  },
  async reportarLeitura(corpo){
    const res = await guardedFetch('/api/leituras-reportadas', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(corpo) });
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao registrar.'));
    return res.json();
  },
  async leiturasReportadas(){
    const res = await guardedFetch('/api/leituras-reportadas');
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao carregar.'));
    return res.json();
  },
  async resolverLeitura(id){
    const res = await guardedFetch(`/api/leituras-reportadas/${encodeURIComponent(id)}/resolver`, { method:'PUT', headers:{ 'Content-Type':'application/json' }, body: '{}' });
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao atualizar.'));
    return res.json();
  },
  async buscarDocumentos(q, categoria){
    const res = await guardedFetch(`/api/busca-documentos?q=${encodeURIComponent(q)}&categoria=${encodeURIComponent(categoria||'todos')}`);
    if(!res.ok) throw new Error(await parseError(res, 'Falha na busca.'));
    return res.json();
  },
  async indicadoresRelatorios(caminho){
    const res = await guardedFetch(`/api/relatorios-mensais/indicadores?caminho=${encodeURIComponent(caminho)}`);
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao ler os indicadores.'));
    return res.json();
  },
  async ufm(){
    const res = await guardedFetch('/api/ufm');
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao carregar a UFM e as gratificações.'));
    return res.json();
  },
  async registrarVersaoUfm(data){
    const res = await guardedFetch('/api/ufm/versoes', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao registrar a alteração.'));
    return res.json();
  },
  async relatoriosMensais(){
    const res = await guardedFetch('/api/relatorios-mensais');
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao carregar os relatórios mensais.'));
    return res.json();
  },
  async relatorioMensalProcesso(caminho){
    const res = await guardedFetch(`/api/relatorios-mensais/processo?caminho=${encodeURIComponent(caminho)}`);
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao carregar os relatórios do processo.'));
    return res.json();
  },
  async lerRelatoriosMensais(){
    const res = await guardedFetch('/api/relatorios-mensais/ler', { method:'POST' });
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao ler as pastas de relatórios.'));
    return res.json();
  },
  async marcarNaoExigeRelatorio(caminho, naoExige, motivo){
    const res = await guardedFetch('/api/relatorios-mensais/nao-exige', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ caminho, naoExige, motivo }) });
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao gravar.'));
    return res.json();
  },
  async analisarRequisicao(arquivo){
    const res = await guardedFetch('/api/requisicoes/analisar', { method:'POST', headers:{ 'Content-Type': arquivo.type || 'application/octet-stream', 'X-Nome-Arquivo': encodeURIComponent(arquivo.name) }, body: arquivo });
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao ler o documento.'));
    return res.json();
  },
  async direcionamentoRequisicao(chave){
    const res = await guardedFetch(`/api/requisicoes/direcionamento?chave=${encodeURIComponent(chave)}`);
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao montar o direcionamento.'));
    return res.json();
  },
  async registrarRespostaTce(corpo){
    const res = await guardedFetch('/api/requisicoes/resposta', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(corpo) });
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao registrar a resposta.'));
    return res.json();
  },
  /* qual: 'aditivos' ou 'apostilamentos' (telas de mesmo nome). */
  async termos(qual){
    const res = await guardedFetch(`/api/termos/${qual}`);
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao carregar os termos.'));
    return res.json();
  },
  async fichaSgc(caminho){
    const res = await guardedFetch(`/api/fichas-sgc/${caminho}`);
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao montar a ficha.'));
    return res.json();
  },
  async visaoContrato(id){
    const res = await guardedFetch(`/api/contratos/${encodeURIComponent(id)}/visao`);
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao montar a visão do contrato.'));
    return res.json();
  },
  async processosRequisicao(){
    const res = await guardedFetch('/api/requisicoes/processos');
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao listar os processos.'));
    return res.json();
  },
  async refazerAnaliseRequisicao(id, caminho){
    const res = await guardedFetch(`/api/requisicoes/analisadas/${encodeURIComponent(id)}/processo`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ caminho }) });
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao refazer o direcionamento.'));
    return res.json();
  },
  async removerAnaliseRequisicao(id){
    const res = await guardedFetch(`/api/requisicoes/analisadas/${encodeURIComponent(id)}`, { method:'DELETE' });
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao remover a análise.'));
  },
  async conferirRequisicao(chave, acao, campos){
    const res = await guardedFetch('/api/requisicoes/conferir', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ chave, acao, campos }) });
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao registrar a conferência.'));
    return res.json();
  },
  async trechosPendencia(propostaId, grupo){
    const res = await guardedFetch(`/api/pendencias-leitura/${encodeURIComponent(propostaId)}/trechos?grupo=${encodeURIComponent(grupo||'')}`);
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao ler os trechos dos documentos.'));
    return res.json();
  },
  async aplicarPendencia(propostaId, dados){
    const res = await guardedFetch(`/api/pendencias-leitura/${encodeURIComponent(propostaId)}/aplicar`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(dados||{}) });
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao gravar o dado informado.'));
    return res.json();
  },
  async baseContratos(){

    const res = await guardedFetch('/api/base-contratos');
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao carregar a base de contratos.'));
    return res.json();
  },
  async mapasRiscoStatus(){
    const res = await guardedFetch('/api/mapas-risco');
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao carregar os mapas de risco.'));
    return res.json();
  },
  async mapaRiscoContrato(contratoId){
    const res = await guardedFetch(`/api/mapas-risco/${contratoId}`);
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao carregar o mapa de risco deste contrato.'));
    return res.json();
  },
  async fichasCadastroStatus(){
    const res = await guardedFetch('/api/fichas-cadastro');
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao carregar as fichas de cadastro.'));
    return res.json();
  },
  async gerarFichaCadastro(contratoId){
    const res = await guardedFetch(`/api/contratos/${contratoId}/ficha-cadastro/gerar`, { method:'POST' });
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao gerar a ficha de cadastro.'));
    return res.json();
  },
  // Só DISPARA a geração (o servidor responde 202 na hora) — ela roda em
  // segundo plano e é acompanhada por progressoMapaRisco().
  async gerarMapaRisco(contratoId){
    const res = await guardedFetch(`/api/contratos/${contratoId}/mapa-risco/gerar`, { method:'POST' });
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao iniciar a geração do mapa de risco.'));
    return res.json();
  },
  // Risco atual de cada contrato (o mesmo do Mapa) — Painel e tabela de Contratos.
  async riscosAtuais(){
    const res = await guardedFetch('/api/mapas-risco/riscos');
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao carregar o risco dos contratos.'));
    return res.json();
  },
  // Todas as análises de uma vez, só por regra e com o texto já lido.
  async atualizarTodosMapasRisco(){
    const res = await guardedFetch('/api/mapas-risco/atualizar-todos', { method:'POST' });
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao iniciar a atualização das análises.'));
    return res.json();
  },
  async progressoMapaRisco(){
    const res = await guardedFetch('/api/mapas-risco/progresso');
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao consultar o andamento do mapa de risco.'));
    return res.json();
  },
  async listarContas(){
    const res = await guardedFetch('/api/contas');
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao carregar contas.'));
    return res.json();
  },
  async criarConta(data){
    const res = await guardedFetch('/api/contas', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao criar conta.'));
    return res.json();
  },
  async atualizarConta(id, data){
    const res = await guardedFetch(`/api/contas/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao salvar alterações.'));
    return res.json();
  },
  async excluirConta(id){
    const res = await guardedFetch(`/api/contas/${id}`, { method:'DELETE' });
    if(!res.ok && res.status!==204) throw new Error(await parseError(res, 'Falha ao excluir conta.'));
  },
  async listarPedidosAcesso(){
    const res = await guardedFetch('/api/contas/pedidos');
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao carregar os pedidos de acesso.'));
    return res.json();
  },
  async dispensarPedidoAcesso(oid){
    const res = await guardedFetch(`/api/contas/pedidos/${encodeURIComponent(oid)}`, { method:'DELETE' });
    if(!res.ok && res.status!==204) throw new Error(await parseError(res, 'Falha ao dispensar o pedido.'));
  },
  async listarAuditoria(){
    const res = await guardedFetch('/api/auditoria');
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao carregar a trilha de auditoria.'));
    return res.json();
  },
  async listarComentarios(entidade, entidadeId){
    const res = await guardedFetch(`/api/comentarios?entidade=${encodeURIComponent(entidade)}&entidadeId=${encodeURIComponent(entidadeId)}`);
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao carregar comentários.'));
    return res.json();
  },
  async criarComentario(data){
    const res = await guardedFetch('/api/comentarios', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
    if(!res.ok) throw new Error(await parseError(res, 'Falha ao registrar comentário.'));
    return res.json();
  },
  async excluirComentario(id){
    const res = await guardedFetch(`/api/comentarios/${id}`, { method:'DELETE' });
    if(!res.ok && res.status!==204) throw new Error(await parseError(res, 'Falha ao excluir comentário.'));
  }
};
