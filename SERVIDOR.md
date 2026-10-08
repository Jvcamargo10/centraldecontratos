# Central de Contratos num servidor — roteiro da troca

Preparado em 30/09/2026. A estrutura já está no sistema: **a troca é só
configuração** (arquivo `.env`) e cópia de arquivos. Sem essas
configurações, o sistema continua funcionando como hoje, nesta máquina.

- Diagnóstico a qualquer momento: `npm run verificar-servidor`
  (só lê; mostra ✓ ok, ! atenção e ✗ impede).
- Conversão dos caminhos da pasta de rede: `npm run trocar-raiz`
  (simula por padrão).
- Modelo de instalação como serviço do Windows:
  `ferramentas/servidor/instalar-servico.ps1`.

---

## 1. Pontos que exigem mudança

| # | Ponto | Por que muda | O que fazer | Onde |
|---|---|---|---|---|
| 1 | **Pasta de rede dos contratos** | `F:` é uma letra mapeada na sessão de quem usa; um serviço do Windows não a enxerga | Usar o caminho de rede e converter os caminhos já gravados (1.494 no `data.json`, 921 no cache, medidos em 30/09) | `npm run trocar-raiz`, depois `CONTRATOS_ARQUIVOS_PASTAS=\\servidor-arquivos.itaverde.gov.br\arquivos\Depto - DTI\Contratos da Secretaria\9. Gestão de Contratos` |
| 2 | **Conta do serviço** | Quem roda o sistema precisa ler a pasta de rede e gravar os dados | TI cria uma conta de domínio de serviço (ex.: `PM\svc-centralsetec`) com **leitura** na pasta de contratos e **escrita** na pasta de dados | TI / `instalar-servico.ps1` |
| 3 | **Senha padrão do admin** | Está no código-fonte; na rede, o sistema **não sobe** com ela | Trocar em Administração > Contas de acesso; criar um 2º administrador | tela |
| 4 | **Login preenchido para teste** | Só serve nesta máquina | `LOGIN_PREENCHIDO_EM_TESTE=0` | `.env` |
| 5 | **Onde o servidor escuta** | Hoje só `127.0.0.1` (esta máquina) | `HOST=0.0.0.0` e `PORT` | `.env` |
| 6 | **HTTPS** | Sem ele, senha e sessão passam abertas pela rede | Proxy na frente (IIS com ARR ou nginx) com certificado; `CONFIAR_PROXY=1`, `COOKIE_SEGURO=1`, `ORIGENS_PERMITIDAS=https://<endereço>` | TI + `.env` |
| 7 | **Endereço (DNS)** | As pessoas precisam de um nome para acessar | TI cria o nome (ex.: `central.itaverde.gov.br`) apontando para o servidor/proxy | TI |
| 8 | **Firewall** | Liberar só o necessário | Liberar a porta do proxy (443); a porta do Node (3001) só para o proxy | TI |
| 9 | **Pasta de dados** | Separar dados do código facilita atualizar | `CENTRAL_DADOS_PASTA=D:\CentralSETEC\dados` e copiar para lá `data.json`, `backups\`, `.texto-cache\`, `.ocr-cache\`, `fichas-cadastro\` | `.env` |
| 10 | **Sessões** | Na memória, reiniciar o serviço desconecta todo mundo | `SESSION_STORE=arquivo` | `.env` |
| 11 | **Backup fora do servidor** | O backup diário fica no mesmo disco dos dados | `BACKUP_COPIA_PASTA=<pasta de rede com acesso restrito>` | `.env` |
| 12 | **Rodar sempre (serviço)** | Resumo diário por e-mail e varredura agendada só funcionam com o sistema de pé | Instalar como serviço (NSSM) | `instalar-servico.ps1` |

**O que NÃO muda:** as telas, as regras de leitura, o Mapa de risco, as
Requisições, os Relatórios mensais e a auditoria. A leitura é toda por
regra, na própria máquina — não há IA (retirada em 01/10/2026) nem nada a
configurar para ela. O `SESSION_SECRET` que já está no `.env` pode ser mantido (ou
trocado — trocar só desconecta quem estiver logado).

## 2. O que já pode ser feito agora, nesta máquina

Estes passos não dependem do servidor e deixam a troca mais curta:

1. Trocar a senha do `admin` e criar um segundo administrador.
2. Converter a pasta de rede (a rede já é acessível daqui):
   1. parar o servidor (Ctrl+C);
   2. `npm run trocar-raiz -- --de "F:\Contratos da Secretaria\9. Gestão de Contratos" --para "\\servidor-arquivos.itaverde.gov.br\arquivos\Depto - DTI\Contratos da Secretaria\9. Gestão de Contratos"`
      — confere os números (simulação);
   3. o mesmo comando com `--aplicar` no fim (faz backup do `data.json`
      em `backups\antes-de-trocar-raiz-<data>.json`);
   4. no `.env`: `CONTRATOS_ARQUIVOS_PASTAS=\\servidor-arquivos.itaverde.gov.br\arquivos\Depto - DTI\Contratos da Secretaria\9. Gestão de Contratos`;
   5. `npm start` e conferir: Contratos, Mapa de risco, Requisições e
      Relatórios mensais abrem como antes; "Ler as pastas agora" não lê
      nada de novo (o cache continua valendo — a data dos arquivos é a
      mesma pela rede, conferido em 30/09).
   Rodar pelo PowerShell (no Git Bash, a barra dupla `\\` do caminho de
   rede se perde).
3. `npm run verificar-servidor` — tudo que ainda falta aparece como ! ou ✗.

## 3. No servidor

1. **Node.js** 18 ou mais novo (testado com o 24).
2. Copiar a pasta do sistema **sem** `node_modules`, `data.json`,
   `backups`, caches e `fichas-cadastro`; rodar `npm ci` nela.
3. Criar a pasta de dados e copiar para ela: `data.json`, `backups\`,
   `.texto-cache\`, `.ocr-cache\`, `fichas-cadastro\`. Sem o `data.json`,
   o sistema cria um novo com dados de exemplo — **copie o de hoje**.
   Sem o `.texto-cache`, a primeira leitura refaz todo o OCR (horas).
4. Copiar o `.env` e acrescentar (ver `.env.example`, seção SERVIDOR):
   ```
   HOST=0.0.0.0
   PORT=3001
   CENTRAL_DADOS_PASTA=D:\CentralSETEC\dados
   CONTRATOS_ARQUIVOS_PASTAS=\\servidor-arquivos.itaverde.gov.br\arquivos\Depto - DTI\Contratos da Secretaria\9. Gestão de Contratos
   CONFIAR_PROXY=1
   COOKIE_SEGURO=1
   ORIGENS_PERMITIDAS=https://central.itaverde.gov.br
   SESSION_STORE=arquivo
   LOGIN_PREENCHIDO_EM_TESTE=0
   BACKUP_COPIA_PASTA=\\<servidor de arquivos>\<pasta restrita>\Backup Central de Contratos
   ```
5. `npm run verificar-servidor` **logado com a conta do serviço** (é ela
   que precisa enxergar a pasta de rede). Resolver todos os ✗.
6. Proxy HTTPS apontando para `http://127.0.0.1:3001`:
   - **IIS** (ARR + URL Rewrite): regra de proxy reverso para
     `http://localhost:3001/{R:1}`, com "Preservar cabeçalhos do host"
     ou `X-Forwarded-Host`; certificado no site do IIS.
   - **nginx**:
     ```
     location / {
       proxy_pass http://127.0.0.1:3001;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_set_header X-Forwarded-Host $host;
       client_max_body_size 30m;   # envio de requisição (até 25 MB)
     }
     ```
   Com o proxy na mesma máquina, pode-se deixar `HOST=127.0.0.1` — o
   Node fica inacessível pela rede, só o proxy fala com ele (mais seguro).
7. Instalar o serviço: ajustar e rodar
   `ferramentas\servidor\instalar-servico.ps1` como administrador;
   `Start-Service CentralSETEC`.
8. Primeiro acesso pelo endereço novo; conferir a Trilha de auditoria.

## 4. Proteções que a estrutura já traz

- **Não sobe na rede de forma insegura:** com `HOST` diferente de
  `127.0.0.1`, o servidor recusa iniciar se o `SESSION_SECRET` não estiver
  definido ou se a senha padrão do `admin` estiver ativa (mensagem no log;
  `PERMITIR_INICIO_INSEGURO=1` força — não recomendado).
- **A senha padrão saiu do código da página:** o login preenchido para
  teste agora vem do servidor, só para esta máquina e só enquanto a senha
  padrão existir.
- **Atrás de proxy:** limite de senhas erradas por pessoa (IP real) e
  proteção contra requisição de outro site (CSRF) aceitando o endereço
  público — com `CONFIAR_PROXY=1` e `ORIGENS_PERMITIDAS`.
- **Download de arquivo** (relatórios mensais) só de dentro das pastas
  configuradas. Nenhum texto de contrato é enviado para serviço externo.

## 5. Cuidados

- **Uma instância só** por `data.json`: dois servidores apontando para os
  mesmos dados sobrescrevem um ao outro.
- O **OCR** roda no processo do sistema: num servidor compartilhado, ele
  disputa processador com os outros serviços (`SERVIDOR_PRIORIDADE` no
  `.env` ajusta a prioridade).
- O **limite de tentativas de login** fica na memória: reiniciar o
  serviço zera a contagem.
- **Voltar atrás:** parar o serviço, restaurar
  `backups\antes-de-trocar-raiz-<data>.json` como `data.json`, voltar
  `CONTRATOS_ARQUIVOS_PASTAS=F:\...` e rodar localmente como antes (o
  cache antigo não é apagado pela conversão).
