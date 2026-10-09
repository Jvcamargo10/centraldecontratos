/* ===================================================================
   ferramentas/demo/documentosFicticios.js

   Pasta de rede FICTÍCIA para a demonstração (GitHub Pages): 12 processos
   de uma secretaria municipal de tecnologia, com contrato, ordem de início,
   aditivos, apostilamentos, relatórios mensais, apólice, requisição do
   Tribunal de Contas e termo de encerramento — em PDF com texto, na mesma
   organização de pastas que a Central espera.

   Nada aqui é real: empresas, pessoas, CNPJs, valores e datas foram
   inventados. As datas são escolhidas em torno da data da geração, para a
   demonstração mostrar contratos em todas as situações (vencido, crítico,
   próximo do vencimento, confortável, encerrado).

   Uso: require('./documentosFicticios').gerar(pastaRaiz, hojeIso)
=================================================================== */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

/* ---------- datas relativas a "hoje" ---------- */
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const somarDias = (iso, dias) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + dias); return d.toISOString().slice(0, 10); };
const somarMeses = (iso, meses) => { const [y, m, d] = iso.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + meses, d, 12)); return t.toISOString().slice(0, 10); };
const porExtenso = iso => { const [y, m, d] = iso.split('-').map(Number); return `${String(d).padStart(2, '0')} de ${MESES[m - 1]} de ${y}`; };
const reais = v => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NUM_EXTENSO = { 12: 'doze', 24: 'vinte e quatro', 30: 'trinta', 36: 'trinta e seis', 48: 'quarenta e oito', 60: 'sessenta' };
const meses = n => `${n} (${NUM_EXTENSO[n] || n}) meses`;

/* ---------- CNPJ fictício com dígito verificador válido ---------- */
function cnpj(base8) {
  const base = `${base8}0001`;
  const calc = b => { let s = 0, p = b.length - 7; for (const d of b) { s += Number(d) * p--; if (p < 2) p = 9; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
  const d1 = calc(base), d2 = calc(base + d1);
  return `${base}${d1}${d2}`.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}
const CNPJ_MUNICIPIO = cnpj('11256774');

/* ---------- PDF com texto (pdfkit) ---------- */
function escreverPdf(arquivo, texto) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  return new Promise((ok, erro) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: path.basename(arquivo, '.pdf'), Author: 'Demonstração — dados fictícios' } });
    const saida = fs.createWriteStream(arquivo);
    saida.on('finish', ok); saida.on('error', erro);
    doc.pipe(saida);
    doc.font('Helvetica').fontSize(10.5);
    for (const par of texto.split(/\n{2,}/)) doc.text(par.replace(/\n/g, ' '), { align: 'justify', paragraphGap: 8 });
    doc.end();
  });
}

/* ---------- textos ---------- */
function textoContrato(c) {
  const vig = c.marco === 'ordem'
    ? `O prazo de vigência deste Contrato é de ${meses(c.meses)}, contados da data de recebimento da Ordem de Início dos Serviços pela CONTRATADA.`
    : c.marco === 'assinatura'
      ? `O prazo de vigência deste Contrato é de ${meses(c.meses)}, contados da data de sua assinatura.`
      : 'A vigência deste Contrato será a estabelecida no Edital e em seus anexos.';
  const gestao = c.gestor
    ? `CLÁUSULA DÉCIMA - DA GESTÃO E DA FISCALIZAÇÃO 10.1. O contrato ficará sob o acompanhamento e fiscalização pelo gestor titular, Senhor ${c.gestor.toUpperCase()}, inscrito no CPF/MF sob o nº [CPF removido], e pelo Suplente, Senhor ${c.suplente.toUpperCase()}, inscrito no CPF/MF sob o nº [CPF removido], ambos servidores da Secretaria Municipal de Tecnologia.`
    : '';
  return [
    `PREFEITURA MUNICIPAL DE ITAVERDE\nSECRETARIA MUNICIPAL DE TECNOLOGIA`,
    `CONTRATO Nº ${c.numero}`,
    `Processo Administrativo nº ${c.pa}. Modalidade: ${c.modalidade}.`,
    `Pelo presente instrumento, de um lado o MUNICÍPIO DE ITAVERDE, Pessoa Jurídica de Direito Público Interno, inscrito no CNPJ sob o nº ${CNPJ_MUNICIPIO}, com sede na Avenida das Palmeiras, nº 1.000, Centro, por intermédio da Secretaria Municipal de Tecnologia, doravante denominado CONTRATANTE, e de outro lado a empresa ${c.empresa.toUpperCase()}, inscrita no CNPJ nº ${c.cnpj}, com sede na Rua das Acácias, nº 200, neste ato representada por seu representante legal, doravante denominada CONTRATADA, têm entre si justo e contratado o que segue.`,
    `CLÁUSULA PRIMEIRA - DO OBJETO 1.1. Constitui objeto do presente contrato ${c.objeto}, conforme especificações do Termo de Referência.`,
    `CLÁUSULA TERCEIRA - DA VIGÊNCIA 3.1. ${vig}`,
    `CLÁUSULA QUINTA - DO VALOR 5.1. O valor total deste contrato é de R$ ${reais(c.valorTotal)}, sendo o valor mensal de R$ ${reais(c.valorTotal / (c.meses || 12))}.`,
    `CLÁUSULA SEXTA - DA GARANTIA 6.1. A CONTRATADA prestará garantia de execução no valor de R$ ${reais(c.valorTotal * 0.05)}, correspondente a 5% (cinco por cento) do valor total do contrato, em uma das modalidades previstas em lei.`,
    `CLÁUSULA SÉTIMA - DO REAJUSTE 7.1. Os preços poderão ser reajustados após 12 (doze) meses, pelo índice IPCA/IBGE.`,
    gestao,
    `CLÁUSULA DÉCIMA PRIMEIRA - DAS SANÇÕES 11.1. Pela inexecução total ou parcial do contrato, a CONTRATADA ficará sujeita a multa de 10% (dez por cento) sobre o valor do contrato, sem prejuízo das demais sanções legais.`,
    `CLÁUSULA DÉCIMA SEGUNDA - DA RESCISÃO 12.1. A rescisão do contrato poderá ocorrer nas hipóteses previstas em lei.`,
    `Itaverde, ${porExtenso(c.assinatura)}.`
  ].filter(Boolean).join('\n\n');
}

const textoOrdem = c => `PREFEITURA MUNICIPAL DE ITAVERDE\n\nOrdem de Início de Serviços\n\nItaverde, ${porExtenso(c.ordemInicio)}.\n\nFica a empresa ${c.empresa.toUpperCase()} autorizada a dar início aos serviços constantes no contrato nº ${c.numero}, a partir desta data.`;

function textoTermo(c, t) {
  if (t.tipo === 'prorrogacao') return `TERMO DE ADITAMENTO Nº ${t.numero} AO CONTRATO Nº ${c.numero}\n\nProcesso Administrativo nº ${c.pa}.\n\nCLÁUSULA PRIMEIRA - DO OBJETO 1.1. Fica prorrogada a vigência do Contrato nº ${c.numero}, por mais ${meses(t.meses)}, a contar de ${porExtenso(t.aPartir)}, conforme manifestação da CONTRATADA e parecer jurídico.\n\nCLÁUSULA SEGUNDA - DO VALOR 2.1. O valor deste Aditamento é de R$ ${reais(t.valor)}, para ${meses(t.meses)}.\n\nCLÁUSULA TERCEIRA - DA RATIFICAÇÃO 3.1. Permanecem inalteradas as demais cláusulas do contrato.\n\nItaverde, ${porExtenso(t.data)}.`;
  if (t.tipo === 'acrescimo') return `TERMO DE ADITAMENTO Nº ${t.numero} AO CONTRATO Nº ${c.numero}\n\nCLÁUSULA PRIMEIRA - DO OBJETO 1.1. Fica aditado o Contrato nº ${c.numero}, para acréscimo do valor contratual em ${t.percentual}% (quantitativo de serviços).\n\nCLÁUSULA SEGUNDA - DO VALOR 2.1. O valor deste Aditamento é de R$ ${reais(t.valor)}.\n\nItaverde, ${porExtenso(t.data)}.`;
  if (t.tipo === 'gestao') return `APOSTILAMENTO Nº ${t.numero}\n\nASSUNTO: Alteração de gestor e suplente.\n\nFica apostilado o Contrato nº ${c.numero}, para que altere o Gestor e Suplente, passando a constar o novo Gestor, Senhor ${t.gestor.toUpperCase()}, inscrito no CPF/MF sob o nº [CPF removido], ocupante do cargo de Diretor, e novo Suplente, Senhor ${t.suplente.toUpperCase()}, inscrito no CPF/MF sob o nº [CPF removido].\n\nItaverde, ${porExtenso(t.data)}.`;
  if (t.tipo === 'dotacao') return `APOSTILAMENTO Nº ${t.numero}\n\nFica apostilado o Contrato nº ${c.numero}, para que conste a nova dotação orçamentária para o exercício de ${t.data.slice(0, 4)}: 02.16.04.126.0018.2001 - 3.3.90.40.00.\n\nItaverde, ${porExtenso(t.data)}.`;
  throw new Error('tipo de termo desconhecido: ' + t.tipo);
}

const textoRelatorio = (c, mesIso) => `RELATÓRIO MENSAL DE ATIVIDADES\n\nContrato nº ${c.numero} - ${c.empresa}\n\nCompetência: ${MESES[Number(mesIso.slice(5, 7)) - 1]} de ${mesIso.slice(0, 4)}.\n\nChamados abertos: 42. Chamados encerrados: 40. Disponibilidade do serviço no mês: 99,7%.`;

const textoApolice = (c, fim) => `APÓLICE DE SEGURO GARANTIA\n\nTomador: ${c.empresa.toUpperCase()}, CNPJ ${c.cnpj}. Segurado: MUNICÍPIO DE ITAVERDE.\n\nObjeto da garantia: garantir o fiel cumprimento do Contrato nº ${c.numero}.\n\nImportância segurada: R$ ${reais(c.valorTotal * 0.05)}.\n\nVigência da apólice: das 24h do dia ${porExtenso(c.assinatura)} às 24h do dia ${porExtenso(fim)}.`;

function textoRequisicaoTce(c, r) {
  return `REQUISIÇÃO DE DOCUMENTOS DF-5.2 nº ${r.numero}\n\nTRIBUNAL DE CONTAS DO ESTADO\n5ª DIRETORIA DE FISCALIZAÇÃO\n\nÀ\nPREFEITURA MUNICIPAL DE ITAVERDE\n\nREF:\nContrato nº ${c.numero} de ${c.assinatura.split('-').reverse().join('/')}\nContratada: ${c.empresa.toUpperCase()}\n\nCom a finalidade de instruir o processo nº TC-${r.tc} (Acompanhamento de Execução Contratual), REQUISITAMOS as seguintes informações e documentos, no prazo de ${r.prazoDias} (${r.prazoDias === 15 ? 'quinze' : 'dez'}) dias:\n\n1. Cópia do contrato e dos termos aditivos;\n2. Relatórios mensais de atividades dos últimos seis meses;\n3. Comprovante da garantia contratual vigente;\n4. Ato de designação do gestor e do suplente.\n\nSão Paulo, ${porExtenso(r.data)}.`;
}

const textoEncerramento = (c, data) => `TERMO DE ENCERRAMENTO DO CONTRATO Nº ${c.numero}\n\nO MUNICÍPIO DE ITAVERDE, por intermédio da Secretaria Municipal de Tecnologia, declara encerrado o Contrato nº ${c.numero}, firmado com a empresa ${c.empresa.toUpperCase()}, pelo término de sua vigência, em ${porExtenso(data)}, não restando obrigações pendentes entre as partes.\n\nItaverde, ${porExtenso(somarDias(data, 3))}.`;

/* ---------- os processos ---------- */
function processos(hoje) {
  // Datas em torno de "hoje": cada contrato cai numa situação diferente.
  const ref = (dias) => somarDias(hoje, dias);
  return [
    { // confortável, com acréscimo, ordem de início, apólice e relatórios com um mês faltando
      numero: '012/2024', pa: '12.345/2023', pasta: 'P.A. 12.345_2023 - Sistema de Gestão ERP - ATLAS', empresa: 'Atlas Tecnologia Ltda', cnpj: cnpj('11300101'),
      modalidade: 'Pregão Eletrônico nº 90.012/2023', objeto: 'a prestação de serviços de licenciamento de software de gestão integrada (ERP), com implantação, suporte técnico e manutenção',
      marco: 'ordem', meses: 36, assinatura: somarMeses(ref(-5), -27), ordemDias: 3, valorTotal: 3600000,
      gestor: 'Bruno Teixeira Lima', suplente: 'Carla Mendes Rocha',
      termos: [{ tipo: 'acrescimo', numero: '058/2025', percentual: 10, valor: 360000, mesesDepois: 14 }, { tipo: 'dotacao', numero: '004/2026', mesesDepois: 22 }],
      relatorios: { ultimos: 8, faltando: [3] }, apoliceMeses: 40
    },
    { // próximo do vencimento: duas prorrogações, troca de gestor e requisição do Tribunal com prazo
      numero: '027/2023', pa: '23.410/2023', pasta: 'P.A. 23.410_2023 - Link de Internet - CONECTA', empresa: 'Conecta Telecom Ltda', cnpj: cnpj('11300202'),
      modalidade: 'Pregão Eletrônico nº 90.031/2023', objeto: 'a prestação de serviços de link dedicado de internet e rede de dados para as unidades da Prefeitura',
      marco: 'assinatura', meses: 12, assinatura: somarMeses(ref(38), -36), valorTotal: 1200000,
      gestor: 'Daniel Nunes Prado', suplente: 'Eduarda Freitas Moura',
      termos: [{ tipo: 'prorrogacao', numero: '140/2024', meses: 12, valor: 1320000, encadeada: 1 }, { tipo: 'prorrogacao', numero: '151/2025', meses: 12, valor: 1380000, encadeada: 2 },
        { tipo: 'gestao', numero: '033/2025', gestor: 'Fábio Moreira Cruz', suplente: 'Eduarda Freitas Moura', mesesDepois: 18 }],
      relatorios: { ultimos: 6, faltando: [] }, requisicaoTce: { numero: '214/2026', tc: '018734.989.26-1', diasAtras: 5, prazoDias: 10 }
    },
    { // crítico: vence em dois dias, sem nova prorrogação na pasta
      numero: '044/2022', pa: '30.118/2022', pasta: 'P.A. 30.118_2022 - Locação de Impressoras - PRISMA', empresa: 'Prisma Impressão Ltda', cnpj: cnpj('11300303'),
      modalidade: 'Pregão Eletrônico nº 90.044/2022', objeto: 'a locação de impressoras multifuncionais com manutenção e fornecimento de suprimentos',
      marco: 'ordem', meses: 24, assinatura: somarMeses(ref(2), -48), ordemDias: 0, valorTotal: 960000,
      gestor: 'Gabriela Torres Pinto', suplente: 'Hugo Barbosa Reis',
      termos: [{ tipo: 'prorrogacao', numero: '101/2024', meses: 12, valor: 480000, encadeada: 1 }, { tipo: 'prorrogacao', numero: '097/2025', meses: 12, valor: 492000, encadeada: 2 }],
      relatorios: { ultimos: 4, faltando: [1, 2] }
    },
    { // atenção: contado da assinatura, sem termos
      numero: '061/2024', pa: '08.221/2024', pasta: 'P.A. 08.221_2024 - Firewall e Monitoramento - VERTEX', empresa: 'Vertex Segurança Digital Ltda', cnpj: cnpj('11300404'),
      modalidade: 'Pregão Eletrônico nº 90.061/2024', objeto: 'a prestação de serviços de segurança da informação, com firewall de próxima geração e monitoramento de incidentes',
      marco: 'assinatura', meses: 30, assinatura: somarMeses(ref(26), -30), valorTotal: 2250000,
      gestor: 'Isabela Duarte Campos', suplente: 'Bruno Teixeira Lima', termos: [], relatorios: { ultimos: 5, faltando: [] }
    },
    { // confortável, contrato longo com apólice
      numero: '008/2025', pa: '41.002/2024', pasta: 'P.A. 41.002_2024 - Datacenter - MERIDIANO', empresa: 'Meridiano Datacenter Ltda', cnpj: cnpj('11300505'),
      modalidade: 'Concorrência nº 3/2024', objeto: 'a prestação de serviços de hospedagem em datacenter (colocation), com energia, climatização e conectividade',
      marco: 'assinatura', meses: 48, assinatura: somarMeses(ref(0), -20), valorTotal: 4800000,
      gestor: 'João Victor Ramos', suplente: 'Larissa Freitas Moura', termos: [], apoliceMeses: 51
    },
    { // vencido: quatro prorrogações (limite de 60 meses) e termo de encerramento na pasta
      numero: '019/2021', pa: '15.870/2021', pasta: 'P.A. 15.870_2021 - Sistema de Protocolo - LAGO AZUL', empresa: 'Lago Azul Sistemas Ltda', cnpj: cnpj('11300606'),
      modalidade: 'Pregão Presencial nº 19/2021', objeto: 'a licença de uso de sistema de protocolo eletrônico, com suporte e manutenção',
      marco: 'assinatura', meses: 12, assinatura: somarMeses(ref(-100), -60), valorTotal: 288000,
      gestor: 'Marcelo Antunes Viana', suplente: 'Natália Correia Lopes',
      termos: [1, 2, 3, 4].map(i => ({ tipo: 'prorrogacao', numero: `${String(70 + i * 3).padStart(3, '0')}/${2021 + i}`, meses: 12, valor: 288000 + i * 12000, encadeada: i })),
      encerramento: true
    },
    { // confortável: prorrogado neste ano
      numero: '033/2025', pa: '05.554/2025', pasta: 'P.A. 05.554_2025 - E-mail em Nuvem - CUMULUS', empresa: 'Cumulus Nuvem Ltda', cnpj: cnpj('11300707'),
      modalidade: 'Dispensa de Licitação nº 12/2025', objeto: 'a prestação de serviços de software como serviço (SaaS) de correio eletrônico e colaboração em nuvem',
      marco: 'ordem', meses: 12, assinatura: somarMeses(ref(170), -24), ordemDias: 5, valorTotal: 720000,
      gestor: 'Otávio Rezende Brito', suplente: 'Patrícia Gomes Farias',
      termos: [{ tipo: 'prorrogacao', numero: '041/2026', meses: 12, valor: 780000, encadeada: 1 }], relatorios: { ultimos: 7, faltando: [5] }
    },
    { // encerrado (pasta de encerrados)
      numero: '052/2023', pa: '11.020/2023', pasta: 'P.A. 11.020_2023 - Locação de Computadores - TECLOC', empresa: 'TecLoc Locação de Equipamentos Ltda', cnpj: cnpj('11300808'),
      modalidade: 'Pregão Eletrônico nº 90.052/2023', objeto: 'a locação de microcomputadores e notebooks com assistência técnica',
      marco: 'assinatura', meses: 24, assinatura: somarMeses(ref(-180), -24), valorTotal: 1440000,
      gestor: 'Rafael Cardoso Melo', suplente: 'Sabrina Pires Monteiro', termos: [], encerrado: true
    },
    { // outra secretaria, próximo do vencimento
      numero: '041/2022', pa: '27.300/2022', pasta: 'P.A. 27.300_2022 - Licenças de Escritório - LICENCIA', empresa: 'Licencia Software Ltda', cnpj: cnpj('11300909'),
      modalidade: 'Pregão Eletrônico nº 90.041/2022', objeto: 'o fornecimento de licenças de software de escritório e colaboração, com atualização de versões',
      marco: 'assinatura', meses: 36, assinatura: somarMeses(ref(65), -48), valorTotal: 1080000,
      gestor: 'Tiago Fonseca Araújo', suplente: 'Vanessa Ribeiro Dias',
      termos: [{ tipo: 'prorrogacao', numero: '118/2025', meses: 12, valor: 396000, encadeada: 1 }], outraSecretaria: true
    },
    { // fica PENDENTE na Fila: proposta completa, esperando revisão
      numero: '015/2026', pa: '02.118/2026', pasta: 'P.A. 02.118_2026 - Cofre de Senhas - SIGMA', empresa: 'Sigma Segurança Ltda', cnpj: cnpj('11301010'),
      modalidade: 'Pregão Eletrônico nº 90.015/2026', objeto: 'a licença de solução de cofre de senhas e gestão de acessos privilegiados, com suporte técnico',
      marco: 'assinatura', meses: 24, assinatura: ref(-12), valorTotal: 864000,
      gestor: 'Wagner Duarte Campos', suplente: 'Ana Paula Ferreira Costa', termos: [], pendente: true
    },
    { // fica PENDENTE e cai em Pendências de leitura: o contrato não diz a vigência
      numero: '090/2025', pa: '19.640/2025', pasta: 'P.A. 19.640_2025 - Telefonia Fixa - VOX', empresa: 'Vox Telecom Ltda', cnpj: cnpj('11301111'),
      modalidade: 'Pregão Eletrônico nº 90.090/2025', objeto: 'a prestação de serviços de telefonia fixa comutada e ramais VoIP',
      marco: null, meses: 12, assinatura: somarMeses(ref(0), -9), valorTotal: 420000,
      gestor: 'Bruno Teixeira Lima', suplente: 'Daniel Nunes Prado', termos: [], pendente: true
    }
  ];
}

/* Monta a pasta de rede. Devolve a lista de processos (com as datas já
   calculadas) e o termo que entra depois, para a pendência de mudança. */
async function gerar(raiz, hoje) {
  const base = path.join(raiz, '9. Gestão de Contratos');
  const lista = processos(hoje);
  for (const c of lista) {
    const categoria = c.encerrado ? '4. Processos Administrativos - Contratos Encerrados' : c.outraSecretaria ? '5. Processos de Outras Secretarias' : '3. Processos Administrativos - Contratos em Vigência';
    const proc = path.join(base, categoria, c.pasta);
    c.caminho = proc;
    const sub = path.join(proc, '3. Contratos, Aditivos e Termos');
    const sufixo = c.numero.replace('/', '_');
    await escreverPdf(path.join(sub, `Contrato Nº ${sufixo}.pdf`), textoContrato(c));
    if (c.marco === 'ordem') {
      c.ordemInicio = somarDias(c.assinatura, c.ordemDias || 0);
      await escreverPdf(path.join(proc, '7. Ordem de Início', `Ordem de Inicio de Serviço - Contrato ${sufixo}.pdf`), textoOrdem(c));
    }
    // Termos: prorrogações encadeadas ao fim do período anterior.
    let fim = c.marco === 'ordem' ? somarMeses(c.ordemInicio, c.meses) : somarMeses(c.assinatura, c.meses);
    for (const t of c.termos) {
      if (t.tipo === 'prorrogacao') { t.aPartir = fim; t.data = somarDias(fim, -20); fim = somarMeses(fim, t.meses); }
      else t.data = somarMeses(c.assinatura, t.mesesDepois);
      const nome = t.tipo === 'gestao' || t.tipo === 'dotacao' ? `Apostilamento Nº ${t.numero.replace('/', '_')}.pdf` : `Termo de Aditamento Nº ${t.numero.replace('/', '_')}.pdf`;
      await escreverPdf(path.join(sub, nome), textoTermo(c, t));
    }
    c.termino = fim;
    if (c.relatorios) {
      for (let i = 1; i <= c.relatorios.ultimos; i++) {
        if (c.relatorios.faltando.includes(i)) continue;
        const mes = somarMeses(`${hoje.slice(0, 7)}-15`, -i).slice(0, 7);
        const [ano, m] = mes.split('-');
        await escreverPdf(path.join(proc, '11. Relatórios Mensais de atividades', ano, `${ano}_${m} - Relatório Mensal - ${c.empresa.split(' ')[0]} - ${MESES[Number(m) - 1][0].toUpperCase()}${MESES[Number(m) - 1].slice(1)}.pdf`), textoRelatorio(c, mes));
      }
    }
    if (c.apoliceMeses) await escreverPdf(path.join(proc, '16. Outros documentos', `Apolice Seguro Garantia - Contrato ${sufixo}.pdf`), textoApolice(c, somarMeses(c.assinatura, c.apoliceMeses)));
    if (c.requisicaoTce) {
      const r = { ...c.requisicaoTce, data: somarDias(hoje, -c.requisicaoTce.diasAtras) };
      await escreverPdf(path.join(proc, '18. Requisições TCE', `Requisição TCE ${r.numero.replace('/', '.')}.pdf`), textoRequisicaoTce(c, r));
    }
    if (c.encerramento) await escreverPdf(path.join(proc, '20. Termo de Encerramento', `Termo de Encerramento - Contrato ${sufixo}.pdf`), textoEncerramento(c, fim));
  }
  return { base, lista };
}

/* Termo arquivado DEPOIS da aprovação (para a pendência "mudança vinda de
   termo novo"): troca de gestor no 027/2023. */
async function termoNovo(lista, hoje) {
  const c = lista.find(x => x.numero === '027/2023');
  const t = { tipo: 'gestao', numero: '061/2026', gestor: 'Larissa Freitas Moura', suplente: 'Fábio Moreira Cruz', data: somarDias(hoje, -2) };
  await escreverPdf(path.join(c.caminho, '3. Contratos, Aditivos e Termos', `Apostilamento Nº 061_2026.pdf`), textoTermo(c, t));
  return c;
}

module.exports = { gerar, termoNovo, _paraTeste: { cnpj, porExtenso, somarMeses } };
