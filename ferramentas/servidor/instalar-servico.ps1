# =====================================================================
# ferramentas/servidor/instalar-servico.ps1 — MODELO (30/09/2026)
#
# Instala a Central de Contratos como serviço do Windows, com o NSSM
# (https://nssm.cc — um executável só, sem instalador). NÃO é executado
# por nenhuma parte do sistema: é o roteiro, para rodar NO SERVIDOR, como
# administrador, depois de seguir o SERVIDOR.md. Ajuste as variáveis.
#
# Por que serviço: sobe junto com o Windows, reinicia se cair e não
# depende de alguém logado com o terminal aberto.
# =====================================================================

$Nssm      = "C:\Ferramentas\nssm\win64\nssm.exe"          # onde o nssm.exe foi colocado
$Servico   = "CentralSETEC"
$PastaApp  = "D:\CentralSETEC\app"                          # o código (esta pasta, copiada)
$PastaLogs = "D:\CentralSETEC\logs"
$Node      = (Get-Command node).Source                     # ou o caminho completo do node.exe

# Conta do serviço: precisa de LEITURA na pasta de rede dos contratos e de
# ESCRITA na pasta de dados (CENTRAL_DADOS_PASTA). "Serviço de Rede" /
# "Sistema Local" não enxergam o compartilhamento — use uma conta de
# domínio de serviço, criada pela TI.
$Conta     = "PM\svc-centralsetec"

if (-not (Test-Path $Nssm)) { throw "nssm.exe não encontrado em $Nssm" }
New-Item -ItemType Directory -Force -Path $PastaLogs | Out-Null

& $Nssm install $Servico $Node "server.js"
& $Nssm set $Servico AppDirectory $PastaApp
& $Nssm set $Servico DisplayName "Central de Contratos — Gestão de Contratos"
& $Nssm set $Servico Description "Central de Contratos (Node.js). Configuração no .env da pasta do sistema."
& $Nssm set $Servico Start SERVICE_AUTO_START
& $Nssm set $Servico AppStdout "$PastaLogs\central-contratos.log"
& $Nssm set $Servico AppStderr "$PastaLogs\central-contratos-erros.log"
& $Nssm set $Servico AppRotateFiles 1
& $Nssm set $Servico AppRotateBytes 10485760
# Parada ordenada (Ctrl+C): o servidor fecha o OCR e grava antes de sair.
& $Nssm set $Servico AppStopMethodConsole 15000
& $Nssm set $Servico ObjectName $Conta (Read-Host -AsSecureString "Senha da conta $Conta" | ForEach-Object { [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($_)) })

Write-Host "Serviço instalado. Antes de iniciar: npm run verificar-servidor (na pasta do sistema, com a conta do serviço)."
Write-Host "Iniciar:  Start-Service $Servico    Parar: Stop-Service $Servico    Situação: Get-Service $Servico"
