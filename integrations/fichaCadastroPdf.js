/* ===================================================================
   integrations/fichaCadastroPdf.js

   Desenha o PDF da Ficha de Cadastro (Ferramenta 3) a partir do
   resultado de fichaCadastroContrato.js — este módulo só cuida de
   LAYOUT, não decide nem valida nenhum campo.

   Usa `pdfkit` (biblioteca pura em JS, sem dependência de binário
   externo tipo wkhtmltopdf/Chromium) — precisa estar instalada via
   `npm install` no servidor (ver package.json e README) antes desta
   ferramenta funcionar.
=================================================================== */

const fs = require('fs');
const PDFDocument = require('pdfkit');

function v(x) {
  return (x === undefined || x === null || x === '') ? '—' : String(x);
}

function formatarValor(x) {
  if (x === undefined || x === null || x === '') return '—';
  const n = Number(x);
  if (!Number.isFinite(n)) return String(x);
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/* Datas já chegam como "AAAA-MM-DD" (ou null) da leitura — mostra como
   DD/MM/AAAA, que é o formato que quem for usar a ficha reconhece mais
   rápido; se não bater com o formato esperado, mostra como veio em vez
   de quebrar a geração do PDF por causa de um formato inesperado. */
function formatarData(iso) {
  if (!iso) return '—';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
}

/* Gera o PDF em `caminhoArquivo` a partir de `dados` = { campos, gestor,
   suplente, fiscais, modeloUsado, contratoNumero, arquivoOrigem }.
   Devolve uma Promise que resolve quando o arquivo terminou de ser
   escrito em disco (ou rejeita em caso de erro de escrita). */
function gerarPdfFichaContrato(dados, caminhoArquivo) {
  return new Promise((resolve, reject) => {
    let doc;
    try {
      doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
    } catch (err) {
      reject(new Error(`Não foi possível iniciar a geração do PDF — verifique se a dependência "pdfkit" está instalada (npm install). Detalhe: ${err.message}`));
      return;
    }
    const stream = fs.createWriteStream(caminhoArquivo);
    let falhouEscrita = false;
    stream.on('finish', () => { if (!falhouEscrita) resolve(); });
    stream.on('error', err => { falhouEscrita = true; reject(err); });
    doc.pipe(stream);

    const c = dados.campos || {};

    doc.fontSize(16).font('Helvetica-Bold').text('Ficha de Cadastro — Contrato', { align: 'center' });
    doc.moveDown(0.2);
    doc.fontSize(9).font('Helvetica').fillColor('#666')
      .text('Gerada automaticamente pela Central de Contratos a partir do arquivo de origem — confira cada campo antes de usar como registro oficial ou de replicar no SGC.', { align: 'center' });
    doc.fillColor('#000');
    doc.moveDown(1);

    /* Bloco de avisos, logo no topo e em destaque. Vem de
       avisosDaFicha() em fichaCadastroContrato.js e lista as datas e os
       valores que não aparecem escritos no documento nem saíram de cálculo
       da regra. Fica antes dos dados de propósito: esta
       ficha existe para ser copiada no SGC, e um campo inventado que
       passe batido aqui vira dado oficial lá. */
    const avisos = Array.isArray(dados.avisos) ? dados.avisos : [];
    if (avisos.length) {
      const alturaBloco = 18 + avisos.length * 26;
      doc.rect(doc.x, doc.y, 495, alturaBloco).fillAndStroke('#fff6e5', '#e0a955');
      doc.fillColor('#000');
      const yInicial = doc.y;
      doc.fontSize(9.5).font('Helvetica-Bold').text('Atenção — campos que não estão escritos no documento:', doc.x + 8, yInicial + 6, { width: 479 });
      doc.font('Helvetica').fontSize(8.5);
      avisos.forEach(a => doc.text('• ' + a, doc.x, doc.y + 2, { width: 479 }));
      doc.y = yInicial + alturaBloco + 6;
      doc.x = 50;
      doc.fontSize(10);
    }

    /* Procedência dos campos que a leitura dos documentos da pasta
       completou ou calculou (vigência, média mensal, gestão). */
    const daBusca = Array.isArray(dados.camposDaBuscaLocal) ? dados.camposDaBuscaLocal : [];
    if (daBusca.length) {
      doc.fontSize(8.5).font('Helvetica-Oblique').fillColor('#666')
        .text('Lidos ou calculados a partir dos documentos da pasta: ' +
          daBusca.map(c => `${c.campo} = "${c.daRegex}"`).join('; ') + '.',
          { width: 495 });
      doc.fillColor('#000').font('Helvetica').fontSize(10);
      doc.moveDown(0.5);
    }

    /* Memória do cálculo da média mensal (regra do SGC, com os aditivos
       da pasta — ver valorContratual.js): quem copia para o SGC precisa
       ver de onde saiu o número. */
    const calc = dados.calculoValor;
    if (calc && calc.memoria) {
      const termos = (calc.aditivos || []).map(a => `termo ${a.termo || '?'} (${a.natureza})`).join(', ');
      doc.fontSize(8.5).font('Helvetica-Oblique').fillColor('#666')
        .text(`Valor médio mensal pela regra do SGC — (valor inicial + aditivos) ÷ (vigência + prorrogações): ${calc.memoria}.` +
          (termos ? ` Termos considerados: ${termos}.` : '') +
          ((calc.avisos || []).length ? ` Atenção: ${calc.avisos.join(' ')}` : ''),
          { width: 495 });
      doc.fillColor('#000').font('Helvetica').fontSize(10);
      doc.moveDown(0.5);
    }

    /* Como as datas de vigência foram calculadas (marco + meses, termo a
       termo) — ver vigenciaContratual.js. */
    const vig = dados.calculoVigencia;
    if (vig && (vig.memoria || (vig.avisos || []).length)) {
      doc.fontSize(8.5).font('Helvetica-Oblique').fillColor('#666')
        .text(`Vigência calculada em meses a partir da assinatura ou da Ordem de Início (Código Civil, art. 132, §3º): ${vig.memoria || '—'}.` +
          ((vig.avisos || []).length ? ` Atenção: ${vig.avisos.join(' ')}` : ''),
          { width: 495 });
      doc.fillColor('#000').font('Helvetica').fontSize(10);
      doc.moveDown(0.5);
    }

    function secao(titulo) {
      if (doc.y > 700) doc.addPage();
      doc.moveDown(0.5);
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#1c4a7a').text(titulo);
      doc.fillColor('#000');
      const y = doc.y + 2;
      doc.moveTo(doc.x, y).lineTo(545, y).strokeColor('#cccccc').lineWidth(1).stroke();
      doc.moveDown(0.5);
      doc.fontSize(10);
    }

    function campo(label, valor) {
      if (doc.y > 760) doc.addPage();
      doc.font('Helvetica-Bold').text(`${label}: `, { continued: true }).font('Helvetica').text(valor);
    }

    secao('Dados do contrato');
    campo('Número', v(c.numero));
    campo('Processo Administrativo', v(c.processoAdministrativo));
    campo('Data de Assinatura', formatarData(c.dataAssinatura));
    campo('Objeto', v(c.objeto));
    campo('Tipo de Contratação', v(c.tipoContratacao));
    campo('Tipo de Serviço', v(c.tipoServico));
    campo('Secretaria', v(c.secretaria));
    campo('Status', v(c.status));

    secao('Empresa');
    campo('Empresa', v(c.empresa));
    campo('CNPJ', v(c.cnpjEmpresa));
    campo('Preposto', v(c.preposto));

    secao('Vigência');
    campo('Início da Vigência', formatarData(c.dataInicioVigencia));
    campo('Término da Vigência', formatarData(c.dataTerminoVigencia));
    campo('Vigência (meses)', v(c.vigenciaEmMeses));
    campo('Data de Início da Ordem de Serviço', formatarData(c.dataInicioOrdemServico));

    secao('Valores');
    campo('Valor do Contrato', formatarValor(c.valorContrato));
    campo('Valor da Garantia', formatarValor(c.valorGarantia));
    campo('Tipo de Garantia', v(c.tipoGarantia));
    campo('Valor da Média Mensal', formatarValor(c.valorMediaMensal));

    secao('Vínculos administrativos');
    campo('Portaria', v(c.portaria));
    campo('Iom', v(c.iom));
    doc.fontSize(8.5).fillColor('#888').text('Portaria e Iom costumam ser atos administrativos separados do contrato — é normal ficarem em branco aqui; preencha manualmente se souber os números.', { width: 495 });
    doc.fillColor('#000').fontSize(10);

    function blocoPessoa(titulo, p) {
      secao(titulo);
      if (!p || (!p.nome && !p.cargo && !p.dataDesignacao && !p.dataTermino && !p.status)) {
        doc.font('Helvetica-Oblique').fillColor('#888').text('Não identificado no texto do contrato — preencher manualmente.');
        doc.fillColor('#000').font('Helvetica');
        return;
      }
      campo('Nome', v(p.nome));
      campo('Cargo', v(p.cargo));
      campo('Data de Designação', formatarData(p.dataDesignacao));
      campo('Data de Término', formatarData(p.dataTermino));
      campo('Status', v(p.status));
    }
    blocoPessoa('Gestor', dados.gestor);
    blocoPessoa('Suplente', dados.suplente);

    secao('Fiscais');
    const fiscais = Array.isArray(dados.fiscais) ? dados.fiscais.filter(f => f && (f.nome || f.cargo || f.dataDesignacao || f.dataTermino || f.status)) : [];
    if (fiscais.length === 0) {
      doc.font('Helvetica-Oblique').fillColor('#888').text('Nenhum fiscal identificado no texto do contrato — preencher manualmente.');
      doc.fillColor('#000').font('Helvetica');
    } else {
      fiscais.forEach((f, i) => {
        if (doc.y > 740) doc.addPage();
        doc.font('Helvetica-Bold').text(`Fiscal ${i + 1}`);
        campo('Nome', v(f.nome));
        campo('Cargo', v(f.cargo));
        campo('Data de Designação', formatarData(f.dataDesignacao));
        campo('Data de Término', formatarData(f.dataTermino));
        campo('Status', v(f.status));
        doc.moveDown(0.3);
      });
    }

    doc.moveDown(1);
    doc.fontSize(8).fillColor('#999').text(
      `Documento gerado em ${new Date().toLocaleString('pt-BR')} · fonte: ${dados.arquivoOrigem || '—'} · leitura: por regras, a partir dos documentos.`,
      { width: 495 }
    );

    doc.end();
  });
}

module.exports = gerarPdfFichaContrato;
