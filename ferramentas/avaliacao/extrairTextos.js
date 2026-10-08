/* ===================================================================
   ferramentas/avaliacao/extrairTextos.js

   Etapa 1 da avaliação: extrai o texto (com OCR quando o PDF é
   digitalizado) de todos os documentos das pastas "3. Contratos,
   Aditivos e Termos" dos processos que têm contrato no SGC, e guarda em
   ferramentas/avaliacao/cache/. É a parte demorada — roda uma vez; as
   próximas execuções só processam arquivos novos ou alterados.

       npm run avaliacao:extrair

   Usa o mesmo extrator da aplicação (integrations/extratorDocumento.js),
   com os limites de OCR do .env — o texto avaliado é o mesmo que a
   ferramenta real enxerga. CPF é mascarado antes de gravar no cache.
=================================================================== */

const fs = require('fs');
const path = require('path');
const comum = require('./comum');

const env = comum.lerEnv();
Object.entries(env).forEach(([k, v]) => { if (process.env[k] === undefined) process.env[k] = v; });

const extrator = require('../../integrations/extratorDocumento');
const { mascararCpf } = require('../../integrations/mapaRiscoContratos');

(async () => {
  const db = JSON.parse(fs.readFileSync(path.join(comum.PROJ, 'data.json'), 'utf8'));
  const raiz = comum.raizDosProcessos(env);
  const avaliaveis = comum.listarProcessos(raiz, db).filter(p => p.pasta3 && p.sgc.length);
  const docs = avaliaveis.flatMap(p => comum.listarDocumentos(p.pasta3).map(d => ({ ...d, processo: p.nome })));

  console.log(`${avaliaveis.length} processos com contrato no SGC, ${docs.length} documento(s) nas pastas 3.`);
  const t0 = Date.now();
  let novos = 0, emCache = 0, falhas = 0;

  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    if (comum.lerCache(d.caminho)) { emCache++; continue; }
    const inicio = Date.now();
    try {
      const r = await extrator.extrairTexto(d.caminho);
      comum.gravarCache(d.caminho, {
        processo: d.processo, nome: d.nome,
        texto: mascararCpf(r.texto),
        semTexto: r.semTexto, totalPaginas: r.paginas.length,
        leituraCompleta: r.leituraCompleta, ocr: r.ocr
      });
      novos++;
      const decorrido = ((Date.now() - t0) / 60000).toFixed(1);
      console.log(`[${i + 1}/${docs.length}] ${((Date.now() - inicio) / 1000).toFixed(0).padStart(3)}s ${r.ocr ? 'OCR ' : 'texto'} ${r.semTexto ? 'SEM TEXTO ' : ''}${d.nome.slice(0, 60)}  (total ${decorrido} min)`);
    } catch (err) {
      falhas++;
      comum.gravarCache(d.caminho, { processo: d.processo, nome: d.nome, texto: '', semTexto: true, erro: err.message });
      console.log(`[${i + 1}/${docs.length}] ERRO ${d.nome.slice(0, 60)}: ${err.message.slice(0, 100)}`);
    }
  }
  console.log(`\nFim: ${novos} extraído(s) agora, ${emCache} já estavam em cache, ${falhas} com erro — ${((Date.now() - t0) / 60000).toFixed(1)} min.`);
  process.exit(0); // o worker do Tesseract não deixa o processo encerrar sozinho
})();
