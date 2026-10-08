/* ===================================================================
   ferramentas/leituraNoturna.js

   Lê (com OCR, quando o PDF é escaneado) os documentos da pasta de
   contratos FORA DO EXPEDIENTE e deixa o texto pronto no cache
   (.texto-cache). Durante o dia, a Fila de importação e o Mapa de risco
   usam esse texto e não fazem OCR nenhum. Criado em 24/09/2026.

       npm run leitura-noturna                  lê até as 07:00
       npm run leitura-noturna -- --ate 06:30   outro horário de parada
       npm run leitura-noturna -- --simular     só lista o que seria lido
       npm run leitura-noturna -- --sem-nitidez não relê o que já foi lido
       npm run leitura-noturna -- --limite 20   no máximo 20 documentos

   O que é lido, nesta ordem:
     1. documentos nunca lidos (novos na pasta, ou alterados);
     2. leituras incompletas (OCR parou no limite de páginas ou de tempo)
        — lidas por inteiro, como o Mapa de risco precisa;
     3. (opcional) escaneados lidos com nitidez menor que
        LEITURA_NOTURNA_ESCALA. DESLIGADO por padrão: medido em 24/09/2026
        relendo 139 páginas de 6 contratos a 144 dpi (contra 94 dpi), as
        regras deram o mesmo resultado em 4, melhoraram um acento em 1 e
        pioraram 1 (garantia do 108/2024 deixou de ser reconhecida), com
        ~60% a mais de tempo por página. Não compensa. Para testar de
        novo: LEITURA_NOTURNA_ESCALA=2.0 no .env.

   Cuidados com a máquina e com os dados:
     - prioridade MÍNIMA no Windows: só usa o processador ocioso;
     - para no horário (--ate), entre um documento e outro;
     - um documento por vez, um núcleo por vez;
     - só escreve no cache de texto (gravação atômica), nunca no
       data.json — pode rodar com o servidor ligado;
     - não roda duas vezes ao mesmo tempo (trava em logs/).
   Resumo de cada execução em logs/leitura-noturna.log.
=================================================================== */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
// Mesmo .env do servidor, sem sobrescrever o que já veio do ambiente.
try {
  for (const l of fs.readFileSync(path.join(RAIZ, '.env'), 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch (e) { /* sem .env: usa o ambiente */ }

const { ajustarPrioridade } = require('../integrations/prioridadeProcesso');
const extrator = require('../integrations/extratorDocumento');
const servidorArquivos = require('../integrations/servidorArquivos');

const arg = nome => { const i = process.argv.indexOf(nome); return i > 0 ? process.argv[i + 1] : undefined; };
const tem = nome => process.argv.includes(nome);

const OPCOES = {
  // O mesmo tanto que o Mapa de risco lê: o texto já serve para ele.
  ...extrator.LEITURA_COMPLETA,
  // Mesma nitidez do dia, por padrão (ver o item 3 no topo).
  escalaOcr: Number(process.env.LEITURA_NOTURNA_ESCALA) || Number(process.env.CONTRATOS_OCR_ESCALA) || 1.3
};
// "OCR pendente": sem texto útil (pulado pelo limite antigo de tamanho ou camada de texto rala) — tão urgente quanto nunca lido.
const ORDEM = { 'nunca lido': 0, 'OCR pendente': 0, 'leitura incompleta': 1, 'nitidez menor': 2 };

/* Horário de parada: a próxima ocorrência de HH:MM a partir de agora. */
function horarioDeParada(hhmm) {
  const [h, m] = String(hhmm || '07:00').split(':').map(Number);
  const alvo = new Date();
  alvo.setHours(h || 0, m || 0, 0, 0);
  if (alvo <= new Date()) alvo.setDate(alvo.getDate() + 1);
  return alvo;
}

/* Trava simples: um arquivo com o PID. Se o processo dono não existe
   mais (queda de energia, janela fechada), a trava é considerada velha. */
function pegarTrava(arquivo) {
  try {
    const pid = Number(fs.readFileSync(arquivo, 'utf8'));
    if (pid) { try { process.kill(pid, 0); return false; } catch (e) { /* processo morto: trava velha */ } }
  } catch (e) { /* sem trava */ }
  fs.writeFileSync(arquivo, String(process.pid));
  return true;
}

async function main() {
  const pastaLogs = path.join(RAIZ, 'logs');
  fs.mkdirSync(pastaLogs, { recursive: true });
  const trava = path.join(pastaLogs, 'leitura-noturna.lock');
  if (!pegarTrava(trava)) { console.log('Outra leitura noturna já está rodando — nada a fazer.'); return; }
  const soltar = () => { try { fs.unlinkSync(trava); } catch (e) { /* já saiu */ } };
  process.on('exit', soltar);
  process.on('SIGINT', () => process.exit(130));

  const prioridade = ajustarPrioridade('minima');
  const parada = horarioDeParada(arg('--ate'));
  const limite = Number(arg('--limite')) || Infinity;
  const inicio = new Date();
  console.log(`Leitura noturna — prioridade ${prioridade}; para às ${parada.toLocaleString('pt-BR')}.`);

  if (!servidorArquivos.isConfigured()) throw new Error('Nenhuma pasta configurada (CONTRATOS_ARQUIVOS_PASTAS no .env).');
  const { arquivos, avisos } = await servidorArquivos.listarCandidatos();
  avisos.forEach(a => console.log('aviso:', a));

  const fila = [];
  for (const caminho of arquivos) {
    if (!extrator.suportado(caminho)) continue;
    let motivo;
    try { motivo = extrator.motivoParaLer(caminho, OPCOES); } catch (e) { continue; } // arquivo sumiu no meio
    if (!motivo || (motivo === 'nitidez menor' && tem('--sem-nitidez'))) continue;
    fila.push({ caminho, motivo });
  }
  fila.sort((a, b) => ORDEM[a.motivo] - ORDEM[b.motivo]);
  const porMotivo = fila.reduce((acc, x) => (acc[x.motivo] = (acc[x.motivo] || 0) + 1, acc), {});
  console.log(`${arquivos.length} documento(s) na pasta; a ler: ${fila.length} ${JSON.stringify(porMotivo)}.`);

  if (tem('--simular')) {
    fila.slice(0, 50).forEach(x => console.log(`  [${x.motivo}] ${path.relative(servidorArquivos._config.pastas[0] || '', x.caminho)}`));
    return;
  }

  const resumo = { lidos: 0, paginasOcr: 0, falhas: 0, interrompidoNoHorario: false };
  for (const item of fila) {
    if (resumo.lidos >= limite) break;
    const restante = parada - Date.now();
    if (restante < 60000) { resumo.interrompidoNoHorario = true; break; }
    const t0 = Date.now();
    try {
      const r = await extrator.extrairTexto(item.caminho, {
        ...OPCOES,
        timeoutOcrMs: Math.min(OPCOES.timeoutOcrMs, restante),
        ignorarCache: item.motivo === 'nitidez menor'
      });
      resumo.lidos++;
      resumo.paginasOcr += (r.ocr && r.ocr.paginasProcessadas) || 0;
      console.log(`  ok  ${Math.round((Date.now() - t0) / 1000)}s  [${item.motivo}] ${path.basename(item.caminho)}${r.ocr ? ` — ${r.ocr.paginasProcessadas} pág. por OCR${r.leituraCompleta ? '' : ' (incompleta)'}` : ''}`);
    } catch (e) {
      resumo.falhas++;
      console.log(`  ERRO [${item.motivo}] ${path.basename(item.caminho)}: ${e.message}`);
    }
  }

  const linha = `${inicio.toISOString()} → ${new Date().toISOString()} | ${resumo.lidos} lido(s), ${resumo.paginasOcr} pág. por OCR, ${resumo.falhas} falha(s), ${fila.length - resumo.lidos - resumo.falhas} para a próxima noite${resumo.interrompidoNoHorario ? ' (parou no horário)' : ''}`;
  fs.appendFileSync(path.join(pastaLogs, 'leitura-noturna.log'), linha + '\n');
  console.log(linha);
}

// Fecha a thread do OCR antes de sair (ver encerrarOcr em extratorDocumento.js).
main()
  .then(() => extrator.encerrarOcr().then(() => process.exit(0)))
  .catch(e => { console.error('Leitura noturna falhou:', e.message); extrator.encerrarOcr().then(() => process.exit(1)); });
