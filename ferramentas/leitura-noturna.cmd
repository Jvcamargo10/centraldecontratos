@echo off
rem Leitura noturna dos documentos (ver ferramentas\leituraNoturna.js).
rem Chamado pelo Agendador de Tarefas do Windows. A saida completa fica em
rem logs\leitura-noturna-saida.txt; o resumo de cada noite, em
rem logs\leitura-noturna.log.
cd /d "%~dp0.."
if not exist logs mkdir logs
node ferramentas\leituraNoturna.js --ate 07:00 >> logs\leitura-noturna-saida.txt 2>&1
