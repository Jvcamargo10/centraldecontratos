/* ===================================================================
   ferramentas/trocarRaiz.js — troca a raiz dos documentos nos dados.

   Uso (com o servidor PARADO):
     npm run trocar-raiz -- --de "F:\Contratos da Secretaria\9. Gestão de Contratos" --para "\\servidor\SETEC\Contratos da Secretaria\9. Gestão de Contratos"
       → só SIMULA: mostra quantos caminhos mudariam, no data.json e no cache.
     ... --aplicar
       → faz: backup do data.json em backups/antes-de-trocar-raiz-<data>.json,
         reescreve o data.json e converte o cache de texto (conteúdo e nome
         de cada arquivo), sem apagar nenhum arquivo de cache antigo.

   Depois, no .env: CONTRATOS_ARQUIVOS_PASTAS=<a raiz nova>. Ver SERVIDOR.md.
   O que NÃO muda: nenhum documento da rede (só lê, para conferir).
=================================================================== */
require('../integrations/carregarEnv').carregarEnv();
const fs = require('fs');
const net = require('net');
const path = require('path');
const { obterConfig } = require('../integrations/configServidor');
const { montarTroca, trocarNoObjeto, nomeDoArquivoDeCache } = require('../integrations/trocaDeRaiz');

const args = process.argv.slice(2);
const valor = nome => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : null; };
const aplicar = args.includes('--aplicar');
const forcar = args.includes('--forcar');
const cfg = obterConfig();

function servidorRodando(porta) {
  return new Promise(resolve => {
    const s = net.connect({ host: '127.0.0.1', port: porta }, () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.setTimeout(1500, () => { s.destroy(); resolve(false); });
  });
}

(async () => {
  let troca;
  try { troca = montarTroca(valor('--de'), valor('--para')); } catch (e) { console.error(e.message); console.error('Uso: npm run trocar-raiz -- --de "<raiz antiga>" --para "<raiz nova>" [--aplicar]'); process.exit(1); }
  console.log(`Raiz antiga: ${troca.de}\nRaiz nova:   ${troca.para}\nDados:       ${cfg.arquivoDados}\nCache:       ${cfg.pastaCacheTexto}\n`);
  const novaAcessivel = fs.existsSync(troca.para);
  console.log(novaAcessivel ? '✓ A raiz nova está acessível daqui.' : '! A raiz nova NÃO está acessível daqui (rede, permissão ou digitação). A conversão ainda pode ser feita, mas confira o caminho.');

  if (aplicar && await servidorRodando(cfg.porta) && !forcar) {
    console.error(`\nO servidor está rodando na porta ${cfg.porta}. Pare o servidor antes (ele grava o data.json por cima). Use --forcar só se tiver certeza de que não é a Central.`);
    process.exit(1);
  }

  // 1. data.json
  if (!fs.existsSync(cfg.arquivoDados)) { console.error(`\nNão achei ${cfg.arquivoDados}.`); process.exit(1); }
  const dados = JSON.parse(fs.readFileSync(cfg.arquivoDados, 'utf8'));
  const r = trocarNoObjeto(dados, troca);
  console.log(`\ndata.json: ${r.trocas} caminho(s) a trocar.`);

  // 2. cache de texto
  let entradas = 0, aConverter = 0, assinaturasAtualizadas = 0, jaExistentes = 0;
  const conversoes = [];
  if (fs.existsSync(cfg.pastaCacheTexto)) {
    for (const nome of fs.readdirSync(cfg.pastaCacheTexto).filter(n => n.endsWith('.json'))) {
      entradas++;
      let j;
      try { j = JSON.parse(fs.readFileSync(path.join(cfg.pastaCacheTexto, nome), 'utf8')); } catch (e) { continue; }
      const t = trocarNoObjeto(j, troca);
      if (!t.trocas || !t.objeto.caminho) continue;
      aConverter++;
      const novoNome = nomeDoArquivoDeCache(t.objeto.caminho);
      if (fs.existsSync(path.join(cfg.pastaCacheTexto, novoNome))) jaExistentes++;
      /* A validade do cache é "tamanho:data de modificação". Pela rede o
         arquivo é o mesmo, mas a data pode vir com precisão diferente: se o
         tamanho bate e a diferença é menor que 2 s, a assinatura é refeita
         com a leitura pelo caminho novo — senão o documento seria relido. */
      if (novaAcessivel) {
        try {
          const st = fs.statSync(t.objeto.caminho);
          const [tam, mtime] = String(t.objeto.assinatura || '').split(':').map(Number);
          const nova = `${st.size}:${Math.round(st.mtimeMs)}`;
          if (st.size === tam && Math.abs(Math.round(st.mtimeMs) - mtime) < 2000 && nova !== t.objeto.assinatura) { t.objeto.assinatura = nova; assinaturasAtualizadas++; }
        } catch (e) { /* arquivo não achado pelo caminho novo: fica como está (será relido se mudou) */ }
      }
      conversoes.push({ novoNome, conteudo: t.objeto });
    }
  }
  console.log(`Cache de texto: ${entradas} entrada(s); ${aConverter} a converter${jaExistentes ? ` (${jaExistentes} já existiam com o caminho novo — serão substituídas)` : ''}${novaAcessivel ? `; ${assinaturasAtualizadas} assinatura(s) ajustada(s) à rede` : ''}.`);

  if (!aplicar) {
    console.log('\nNada foi alterado (simulação). Para aplicar, pare o servidor e rode de novo com --aplicar.');
    return;
  }
  const carimbo = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  fs.mkdirSync(cfg.pastaBackups, { recursive: true });
  const backup = path.join(cfg.pastaBackups, `antes-de-trocar-raiz-${carimbo}.json`);
  fs.copyFileSync(cfg.arquivoDados, backup);
  const tmp = cfg.arquivoDados + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(r.objeto, null, 2), 'utf8');
  fs.renameSync(tmp, cfg.arquivoDados);
  for (const c of conversoes) {
    const destino = path.join(cfg.pastaCacheTexto, c.novoNome);
    fs.writeFileSync(destino + '.tmp', JSON.stringify(c.conteudo));
    fs.renameSync(destino + '.tmp', destino);
  }
  console.log(`\n✓ Aplicado. Backup do data.json: ${backup}`);
  console.log(`✓ ${conversoes.length} entrada(s) de cache gravada(s) com o caminho novo (as antigas ficaram; podem ser apagadas depois).`);
  console.log(`\nAgora, no .env: CONTRATOS_ARQUIVOS_PASTAS=${troca.para}`);
})().catch(e => { console.error('Falha:', e.message); process.exit(1); });
