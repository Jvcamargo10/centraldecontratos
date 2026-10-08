/* ===================================================================
   integrations/percursoPastas.js

   Leitura das pastas de rede para as varreduras (06/10/2026): Fila de
   importação, Relatórios mensais e Requisições.

   Medido na raiz "9. Gestão de Contratos" (3.460 pastas, ~14 mil
   arquivos): percorrer uma pasta por vez levava 126 a 139 s; com 8
   pedidos à rede ao mesmo tempo, 25 s (16 não melhorou). O tempo é quase
   todo ESPERA pelo servidor de arquivos — não é processamento —, então o
   ganho vem de não esperar um pedido terminar para fazer o próximo.

     - lerPasta / statArquivo: o mesmo readdir/stat de sempre, mas no
       máximo PASTAS_PEDIDOS_SIMULTANEOS (padrão 8) pedidos à rede ao
       mesmo tempo, somando TODAS as varreduras — duas leituras juntas não
       dobram a carga no servidor de arquivos.
     - Nada é guardado entre leituras: cada leitura pedida vê a pasta como
       está agora (reaproveitar a lista entre Relatórios e Requisições foi
       medido e não compensou: 6,6 s separadas, 6,5 s juntas — elas leem
       pastas quase todas diferentes).

   Quem percorre continua decidindo O QUE ler; aqui só muda COMO os
   pedidos vão à rede. A ordem dos resultados é mantida por quem chama
   (ver percorrerPasta em servidorArquivos.js).
=================================================================== */
const fs = require('fs');

function limitador(maximo) {
  let ativos = 0;
  const fila = [];
  const proximo = () => {
    if (ativos >= maximo || !fila.length) return;
    ativos++;
    const { fn, ok, erro } = fila.shift();
    Promise.resolve().then(fn).then(ok, erro).finally(() => { ativos--; proximo(); });
  };
  const vez = fn => new Promise((ok, erro) => { fila.push({ fn, ok, erro }); proximo(); });
  vez.ativos = () => ativos;
  return vez;
}

const LIMITE = Math.max(1, Math.min(32, Number(process.env.PASTAS_PEDIDOS_SIMULTANEOS) || 8));
const vez = limitador(LIMITE);

function lerPasta(caminho) {
  return vez(() => fs.promises.readdir(caminho, { withFileTypes: true }));
}

function statArquivo(caminho) {
  return vez(() => fs.promises.stat(caminho));
}

/* Resultado de cada item na MESMA ordem da lista, com os pedidos à rede
   correndo juntos (o limite fica em lerPasta/statArquivo). */
async function emOrdem(lista, fn) {
  const partes = await Promise.all(lista.map(fn));
  const saida = [];
  for (const p of partes) if (p) for (const x of p) saida.push(x);
  return saida;
}

module.exports = { lerPasta, statArquivo, emOrdem, limitador, LIMITE };
