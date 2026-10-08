/* ===================================================================
   integrations/trocaDeRaiz.js

   Troca da raiz dos documentos (30/09/2026): quando a Central sair desta
   máquina, "F:\Contratos da Secretaria\9. Gestão de Contratos" (letra mapeada
   na sessão de quem usa — não existe para um serviço do Windows) vira o
   caminho de rede "\\servidor\compartilhamento\...\9. Gestão de Contratos".

   O caminho completo está gravado em muitos lugares — contratos
   (arquivoOrigem), propostas, arquivos já vistos (como CHAVE), requisições,
   relatórios mensais, garantias, termos de encerramento — e é a chave do
   cache de texto (sha1 do caminho). Sem conversão, a Central acharia que
   todos os documentos são novos e leria tudo de novo, com horas de OCR.

   Aqui: a substituição (em textos e em chaves de objeto, sem diferenciar
   maiúsculas, aceitando "\" ou "/") e o novo nome do arquivo de cache. A
   ferramenta que aplica é ferramentas/trocarRaiz.js (simula por padrão).
=================================================================== */
const path = require('path');
const crypto = require('crypto');

const semBarraFinal = s => String(s || '').trim().replace(/[\\/]+$/, '');
const escaparRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function montarTroca(de, para) {
  const a = semBarraFinal(de), b = semBarraFinal(para);
  if (!a || !b) throw new Error('Informe a raiz antiga (--de) e a nova (--para).');
  if (a.toLowerCase() === b.toLowerCase()) throw new Error('A raiz antiga e a nova são iguais.');
  // Cada separador casa com "\" ou "/"; o fim precisa ser separador ou fim do texto
  // (para "F:\9. Gestão" não casar com "F:\9. Gestão de Contratos 2").
  const fonte = a.split(/[\\/]+/).map(escaparRe).join('[\\\\/]+');
  const re = new RegExp(`${fonte}(?=[\\\\/]|$|")`, 'gi');
  return { de: a, para: b, re };
}

function trocarNoTexto(texto, troca) {
  let n = 0;
  const novo = String(texto).replace(troca.re, () => { n++; return troca.para; });
  return { texto: novo, trocas: n };
}

/* Percorre o JSON inteiro: valores de texto e chaves de objeto. */
function trocarNoObjeto(obj, troca) {
  let total = 0;
  const visitar = v => {
    if (typeof v === 'string') { const r = trocarNoTexto(v, troca); total += r.trocas; return r.texto; }
    if (Array.isArray(v)) return v.map(visitar);
    if (v && typeof v === 'object') {
      const saida = {};
      for (const [k, val] of Object.entries(v)) {
        const rk = trocarNoTexto(k, troca);
        total += rk.trocas;
        saida[rk.texto] = visitar(val);
      }
      return saida;
    }
    return v;
  };
  return { objeto: visitar(obj), trocas: total };
}

// O mesmo cálculo de extratorDocumento.arquivoDeCache (a chave é o caminho em minúsculas).
function nomeDoArquivoDeCache(caminho) {
  return crypto.createHash('sha1').update(path.resolve(caminho).toLowerCase()).digest('hex') + '.json';
}

module.exports = { montarTroca, trocarNoTexto, trocarNoObjeto, nomeDoArquivoDeCache };
