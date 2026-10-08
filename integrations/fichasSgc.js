/* ===================================================================
   integrations/fichasSgc.js

   Fichas de cadastro dos outros tipos do SGC (01/10/2026), no mesmo
   modelo da ficha de requisição: os campos do formulário "Cadastrar" do
   SGC preenchidos com o que a Central já leu dos documentos, para conferir
   e digitar lá. Os campos vêm do código-fonte de referência do SGC
   (integrations/referencia-sgc/models):
     - Aditivo / Apostilamento: contrato, tipo, objeto, número, data do
       extrato, arquivo — mais o valor (valor_aditivos) e a nova data de
       término (data_terminos), que o SGC guarda junto;
     - Empresa: nome e CNPJ.
   Portaria e Iom ficam de fora: a Central não lê esses números dos
   documentos (seria ficha em branco).
=================================================================== */
const brData = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : null; };
const brValor = v => (v === null || v === undefined || v === '') ? null : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const cnpjFormatado = v => { const d = String(v || '').replace(/\D/g, ''); return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : (v || null); };

/* Resumo do objeto do termo (o texto lido é o preâmbulo inteiro — o SGC pede o assunto). */
function resumoDoObjeto(t) {
  const partes = [];
  if (t.tipo) partes.push(String(t.tipo).trim());
  if (t.meses) partes.push(`${t.meses} meses`);
  if (t.valor) partes.push(`valor ${brValor(t.valor)}`);
  if (t.gestor || t.suplente) partes.push(`gestor: ${t.gestor || '—'}; suplente: ${t.suplente || '—'}`);
  return partes.join(' — ') || null;
}

// Nova data de término: o período da vigência que veio deste termo ("termo 156").
function novoTerminoDoTermo(db, t) {
  const numero = String(t.numero || '').split('/')[0].replace(/^0+/, '');
  if (!numero) return null;
  const propostas = (db.importacoesPendentes || []).filter(p => p.status === 'aprovado' && String(p.contratoId) === String(t.contratoId));
  for (const p of propostas) {
    const per = ((p.calculoVigencia && p.calculoVigencia.periodos) || []).find(x => new RegExp(`^termo\\s+0*${numero}\\b`, 'i').test(String(x.origem || '')));
    if (per && per.fim) return per.fim;
  }
  return null;
}

function fichaDoTermo(db, especie, id) {
  const lista = especie === 'apostilamento' ? (db.apostilamentos || []) : (db.aditivos || []);
  const t = lista.find(x => String(x.id) === String(id));
  if (!t) return null;
  const termino = t.meses ? novoTerminoDoTermo(db, t) : null;
  return {
    titulo: `Ficha de Cadastro — ${especie === 'apostilamento' ? 'Apostilamento' : 'Aditivo'} (SGC)`,
    referencia: `${especie === 'apostilamento' ? 'Apostilamento' : 'Aditivo'} ${t.numero || ''} — contrato ${t.contrato || ''}`.trim(),
    campos: [
      { rotulo: 'Contrato', valor: t.contrato || null, obrigatorio: true },
      { rotulo: 'Tipo', valor: t.tipo ? String(t.tipo).trim() : null },
      { rotulo: 'Objeto', valor: resumoDoObjeto(t) },
      { rotulo: 'Número', valor: t.numero || null },
      { rotulo: 'Data do extrato', valor: brData(t.data), aviso: t.data ? null : 'não lida no documento — confira o extrato publicado' },
      { rotulo: 'Valor', valor: brValor(t.valor) },
      { rotulo: 'Nova data de término', valor: brData(termino), aviso: t.meses && !termino ? `prorroga ${t.meses} meses — calcule pela vigência` : null },
      { rotulo: 'Arquivo', valor: t.documento || null }
    ],
    observacao: t.origem === 'documento' ? 'Lido do documento e aprovado na Fila de importação.' : null
  };
}

function fichaDaEmpresa(db, contratoId) {
  const c = (db.contratos || []).find(x => String(x.id) === String(contratoId));
  if (!c) return null;
  return {
    titulo: 'Ficha de Cadastro — Empresa (SGC)',
    referencia: `Empresa do contrato ${c.numero}`,
    campos: [
      { rotulo: 'Nome', valor: c.empresa || null, obrigatorio: true },
      { rotulo: 'CNPJ', valor: cnpjFormatado(c.cnpjEmpresa), obrigatorio: true, aviso: c.cnpjEmpresa ? null : 'CNPJ não lido — confira no contrato' }
    ],
    observacao: `Contrato ${c.numero}. No SGC, o CNPJ vai só com os números (14 dígitos).`
  };
}

/* PDF de qualquer ficha (mesmo desenho da ficha de requisição). */
function gerarPdf(ficha, destino) {
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  doc.pipe(destino);
  doc.fontSize(16).font('Helvetica-Bold').text(ficha.titulo, { align: 'center' });
  doc.moveDown(0.3).fontSize(9).font('Helvetica').fillColor('#555').text('Campos do formulário "Cadastrar" do SGC, preenchidos com o que a Central de Contratos leu dos documentos. Confira antes de cadastrar.', { align: 'center' });
  doc.moveDown(0.4).fontSize(10).fillColor('#000').text(ficha.referencia, { align: 'center' });
  doc.moveDown(1);
  for (const c of ficha.campos) {
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#444').text(`${c.rotulo.toUpperCase()}${c.obrigatorio ? ' *' : ''}`);
    doc.fontSize(11).font('Helvetica').fillColor('#000').text(c.valor ? String(c.valor).normalize('NFC') : '—', { paragraphGap: c.aviso ? 1 : 8 });
    if (c.aviso) doc.fontSize(8.5).fillColor('#8a5a00').text(c.aviso, { paragraphGap: 8 });
  }
  doc.moveDown(0.8).fontSize(9).fillColor('#555');
  if (ficha.observacao) doc.text(ficha.observacao);
  doc.text(`Gerada em ${new Date().toLocaleString('pt-BR')}.`);
  doc.end();
}

module.exports = { fichaDoTermo, fichaDaEmpresa, gerarPdf, _paraTeste: { resumoDoObjeto, novoTerminoDoTermo, cnpjFormatado } };
