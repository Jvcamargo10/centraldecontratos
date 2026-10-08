/* ===================================================================
   integrations/prioridadeProcesso.js

   Prioridade do processo no sistema operacional (24/09/2026).

   O servidor roda na estação de trabalho de quem usa o sistema, e o OCR
   de um PDF escaneado ocupa um núcleo por ~2,5 s a cada página. Com a
   prioridade abaixo do normal, o Windows atende primeiro os programas do
   usuário (navegador, Office, Teams): o OCR espera quando a máquina está
   em uso e anda quando ela está ociosa. Não deixa nada mais lento com a
   máquina parada — só cede a vez.

     SERVIDOR_PRIORIDADE=baixa   (padrão) abaixo do normal
     SERVIDOR_PRIORIDADE=minima  só quando a máquina está ociosa
     SERVIDOR_PRIORIDADE=normal  como antes

   Baixar a prioridade não exige permissão de administrador; subir, sim —
   por isso aqui só se baixa.
=================================================================== */
const os = require('os');

const NIVEIS = {
  baixa: { valor: os.constants.priority.PRIORITY_BELOW_NORMAL, rotulo: 'abaixo do normal' },
  minima: { valor: os.constants.priority.PRIORITY_LOW, rotulo: 'mínima (só com a máquina ociosa)' }
};

/* Aplica ao processo atual. Devolve o que foi feito, para o log. */
function ajustarPrioridade(nivel) {
  const escolhido = String(nivel || 'baixa').trim().toLowerCase();
  if (escolhido === 'normal') return 'normal (sem ajuste)';
  const n = NIVEIS[escolhido] || NIVEIS.baixa;
  try {
    os.setPriority(0, n.valor);
    return n.rotulo;
  } catch (e) {
    return `não foi possível ajustar (${e.message})`;
  }
}

module.exports = { ajustarPrioridade };
