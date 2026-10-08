/* ===================================================================
   integrations/dataLocal.js

   A data de HOJE no fuso desta máquina (AAAA-MM-DD). Até 29/09/2026 o
   sistema usava `new Date().toISOString().slice(0, 10)`, que é a data em
   UTC: em Itaverde (UTC−3), das 21h à meia-noite já era "amanhã" — o
   Registro de riscos contava um dia a menos até o vencimento, a tratativa
   saía com a data do dia seguinte e o Mapa (que usa a data local)
   discordava do Registro.
=================================================================== */
/* Também converte um carimbo de data e hora ("2026-09-28T23:10:00Z") para
   o dia local; uma data pura ("2026-09-28") volta como está. */
function hojeLocal(d = new Date()) {
  if (typeof d === 'string') {
    if (!/T\d{2}:/.test(d)) return d.slice(0, 10);
    d = new Date(d);
  }
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

module.exports = { hojeLocal };
