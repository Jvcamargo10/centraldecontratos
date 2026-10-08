/* ===================================================================
   testes/relatoriosMensais.test.js

   Relatórios mensais de todos os contratos (29/09/2026): o mês de cada
   arquivo pelos nomes reais da pasta, a cobertura da vigência e a leitura
   de uma pasta de processo montada no temporário.
=================================================================== */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
// A pasta de teste é a "pasta configurada": o download só entrega arquivo de dentro dela.
const RAIZ_TESTE = path.join(os.tmpdir(), `central-relatorios-${process.pid}`);
process.env.CONTRATOS_ARQUIVOS_PASTAS = RAIZ_TESTE;
const rm = require('../integrations/relatoriosMensais');

test('mês de cada arquivo, pelos nomes reais da pasta', () => {
  const c = (nome, pastas) => rm.competenciaDoArquivo(nome, pastas || []).competencia;
  assert.strictEqual(c('2025_08 - Relatório Mensal (Sigma Cofre de Senhas) - Agosto.pdf'), '2025-08');
  assert.strictEqual(c('2024_06 Relatorio Mensal de atividades - Meridiano - Junho.pdf'), '2024-06');
  assert.strictEqual(c('Relatório GFE - CT - 006.2025 - ITD - 02.2025.docx'), '2025-02');
  assert.strictEqual(c('PM 2024 02.xlsx'), '2024-02');
  assert.strictEqual(c('Relatório Mensal Prisma.pdf', ['2023', 'Dezembro']), '2023-12', 'mês e ano pelas subpastas');
  assert.strictEqual(c('Relatório Mensal - Março.pdf', ['2026']), '2026-03');
  assert.strictEqual(c('Cronograma - CUMULUS.xlsx'), null);
  // Prefixo e nome discordam: vale o nome do mês; só a virada do ano muda o ano.
  const r = rm.competenciaDoArquivo('2024_07 Relatorio Mensal de atividades - Fibra Sul - Junho.pdf');
  assert.strictEqual(r.competencia, '2024-06');
  assert.match(r.aviso, /vale o nome do mês/);
  assert.strictEqual(c('2023_09 Relatório de atividades FIA - Outubro 15_09 a 15_10.pdf'), '2023-10');
  assert.strictEqual(c('2025_01 - Relatório Mensal - Dezembro.pdf'), '2024-12');
});

test('tipo do arquivo', () => {
  assert.strictEqual(rm.tipoDoArquivo('2025_08 - Relatório Mensal.pdf'), 'relatorio');
  assert.strictEqual(rm.tipoDoArquivo('Relatório GFE - CT - 006.2025.docx'), 'gestao');
  assert.strictEqual(rm.tipoDoArquivo('Relatório Pendentes - 17-08-2026.xlsx'), 'acompanhamento');
  assert.strictEqual(rm.tipoDoArquivo('Cronograma - ITD.xlsx'), 'cronograma');
  assert.strictEqual(rm.tipoDoArquivo('2025_06 - Relatório.pdf.crdownload'), 'incompleto');
});

test('cobertura: meses da vigência até o mês passado; o mês passado fica "no prazo" até o dia 10', () => {
  const proc = { arquivos: ['2026-05', '2026-06', '2026-08'].map(m => ({ competencia: m, tipo: 'relatorio' })) };
  const contrato = { inicio: '2026-05-10', termino: '2027-05-09' };
  const dia5 = rm.cobertura(proc, contrato, new Date(2026, 8, 5)); // 05/09/2026
  assert.deepStrictEqual(dia5.faltando, ['2026-07']);
  assert.strictEqual(dia5.aguardando, null, 'agosto já entregue');
  const sem = { arquivos: proc.arquivos.filter(a => a.competencia !== '2026-08') };
  const dia5b = rm.cobertura(sem, contrato, new Date(2026, 8, 5));
  assert.strictEqual(dia5b.aguardando, '2026-08');
  assert.deepStrictEqual(dia5b.faltando, ['2026-07']);
  const dia29 = rm.cobertura(sem, contrato, new Date(2026, 8, 29));
  assert.deepStrictEqual(dia29.faltando, ['2026-07', '2026-08']);
  assert.strictEqual(dia29.esperados, 4);
  assert.strictEqual(dia29.percentual, 50);
  assert.strictEqual(dia29.ultimos12.length, 12);
  assert.strictEqual(dia29.ultimos12[11].mes, '2026-08');
  assert.strictEqual(dia29.ultimos12[0].estado, 'fora', 'set/2025: antes da vigência');
  // Planilha e cronograma não contam como relatório.
  const soPlanilha = rm.cobertura({ arquivos: [{ competencia: '2026-07', tipo: 'planilha' }] }, contrato, new Date(2026, 8, 29));
  assert.ok(soPlanilha.faltando.includes('2026-07'));
});

let raiz, processo;
before(() => {
  raiz = RAIZ_TESTE;
  fs.mkdirSync(raiz, { recursive: true });
  processo = path.join(raiz, '3. Processos Administrativos - Contratos em Vigência', 'P.A. 01.873_2025 - Renovação Cofre de Senhas - SIGMA');
  const arq = (rel, nomes) => { const p = path.join(processo, rel); fs.mkdirSync(p, { recursive: true }); nomes.forEach(n => fs.writeFileSync(path.join(p, n), 'x')); };
  arq('11. Relatórios Mensais de atividades/2026', ['2026_07 - Relatório Mensal (Sigma Cofre de Senhas) - Julho.pdf', '2026_08 - Relatório Mensal (Sigma Cofre de Senhas) - Agosto.pdf', 'Thumbs.db']);
  arq('11. Relatórios Mensais de atividades', ['Cronograma - SIGMA.xlsx']);
  arq('3. Contratos, Aditivos e Termos', ['Contrato 075_2025.pdf']);
  fs.mkdirSync(path.join(raiz, '4. Processos Administrativos - Contratos Encerrados', 'P.A. 00.403_2018 - Microsoft - LICENCIA'), { recursive: true });
});
after(() => { fs.rmSync(raiz, { recursive: true, force: true }); });

test('leitura das pastas, contrato pelo PA, download só de arquivo lido, "não exige" e planilha', async () => {
  const db = { contratos: [{ id: 1, numero: '075/2025', pa: '01.873/2025', empresa: 'SIGMA', inicio: '2026-06-01', termino: '2027-05-31', status: 'Ativo' }] };
  const r = await rm.ler(db, () => {}, [raiz]);
  assert.strictEqual(r.processos, 2);
  assert.strictEqual(r.arquivos, 3, 'Thumbs.db não entra');
  const l = rm.listar(db, new Date(2026, 8, 29));
  const p = l.processos.find(x => /SIGMA/.test(x.nome));
  assert.strictEqual(p.contrato.numero, '075/2025');
  assert.deepStrictEqual(p.cobertura.faltando, ['2026-06']);
  assert.strictEqual(p.porTipo.cronograma, 1);
  const outro = l.processos.find(x => /LICENCIA/.test(x.nome));
  assert.strictEqual(outro.pastas.length, 0);
  assert.strictEqual(outro.cobertura, null);
  assert.strictEqual(p.arquivos, undefined, 'a lista vai sem os arquivos');
  assert.strictEqual(p.totalArquivos, 3);
  const detalhe = rm.processo(db, p.caminho, new Date(2026, 8, 29));
  const a = detalhe.arquivos.find(x => x.competencia === '2026-08');
  assert.strictEqual(rm.arquivoPorId(db, a.id).nome, a.nome.normalize('NFC'));
  assert.strictEqual(rm.arquivoPorId(db, 'nao-existe'), null);
  db.relatoriosMensais.processos[0].arquivos.push({ id: 'fora', caminho: 'C:\\Windows\\win.ini', nome: 'win.ini' });
  assert.strictEqual(rm.arquivoPorId(db, 'fora'), null, 'fora das pastas configuradas: não entrega');
  assert.match(rm.gerarCsv(db, 'faltas'), /075\/2025;SIGMA;.*;06\/2026/);
  rm.marcarNaoExige(db, p.caminho, true, 'licença', 'Ana');
  const depois = rm.listar(db, new Date(2026, 8, 29)).processos.find(x => /SIGMA/.test(x.nome));
  assert.strictEqual(depois.cobertura, null, 'não exige: a falta não conta');
  assert.strictEqual(depois.naoExige.por, 'Ana');
  assert.doesNotMatch(rm.gerarCsv(db, 'faltas'), /075\/2025/);
  rm.marcarNaoExige(db, p.caminho, false, null, 'Ana');
  assert.ok(rm.listar(db, new Date(2026, 8, 29)).processos.find(x => /SIGMA/.test(x.nome)).cobertura);
});
