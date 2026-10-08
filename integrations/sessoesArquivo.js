/* ===================================================================
   integrations/sessoesArquivo.js

   Sessões de login guardadas num arquivo (30/09/2026), para o servidor:
   com a sessão só na memória (o padrão do express-session), reiniciar o
   serviço — atualização, queda de energia — desconecta todo mundo. Liga
   com SESSION_STORE=arquivo no .env. Sem pacote novo.

   O arquivo (sessoes.json, na pasta de dados) guarda só o id da conta e
   a validade de cada sessão — nenhuma senha. A gravação é adiada (1 s) e
   agrupada, e sessão vencida é apagada ao carregar e a cada hora.
=================================================================== */
const fs = require('fs');
const path = require('path');

module.exports = function criarStoreDeArquivo(session, arquivo) {
  const Store = session.Store;
  class StoreDeArquivo extends Store {
    constructor() {
      super();
      this.arquivo = arquivo;
      this.sessoes = {};
      this.timer = null;
      try {
        if (fs.existsSync(arquivo)) this.sessoes = JSON.parse(fs.readFileSync(arquivo, 'utf8')) || {};
      } catch (e) {
        console.error(`Aviso: ${arquivo} ilegível — começando sem sessões salvas (${e.message}).`);
        this.sessoes = {};
      }
      this.limpar();
      setInterval(() => this.limpar(), 60 * 60 * 1000).unref();
    }
    vencida(s) {
      const expira = s && s.cookie && s.cookie.expires ? new Date(s.cookie.expires).getTime() : 0;
      return !expira || expira <= Date.now();
    }
    limpar() {
      let mudou = false;
      for (const [id, s] of Object.entries(this.sessoes)) if (this.vencida(s)) { delete this.sessoes[id]; mudou = true; }
      if (mudou) this.gravarDepois();
    }
    gravarAgora() {
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      try {
        fs.mkdirSync(path.dirname(this.arquivo), { recursive: true });
        const tmp = this.arquivo + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(this.sessoes), 'utf8');
        fs.renameSync(tmp, this.arquivo);
      } catch (e) {
        console.error(`Aviso: falha ao gravar as sessões em ${this.arquivo}: ${e.message}`);
      }
    }
    gravarDepois() {
      if (this.timer) return;
      this.timer = setTimeout(() => this.gravarAgora(), 1000);
      if (this.timer.unref) this.timer.unref();
    }
    get(id, cb) {
      const s = this.sessoes[id];
      if (!s) return cb(null, null);
      if (this.vencida(s)) { delete this.sessoes[id]; this.gravarDepois(); return cb(null, null); }
      cb(null, JSON.parse(JSON.stringify(s)));
    }
    set(id, s, cb) {
      this.sessoes[id] = JSON.parse(JSON.stringify(s));
      this.gravarDepois();
      if (cb) cb(null);
    }
    touch(id, s, cb) {
      if (this.sessoes[id]) { this.sessoes[id].cookie = JSON.parse(JSON.stringify(s.cookie)); this.gravarDepois(); }
      if (cb) cb(null);
    }
    destroy(id, cb) {
      delete this.sessoes[id];
      this.gravarDepois();
      if (cb) cb(null);
    }
  }
  return new StoreDeArquivo();
};
