@echo off
chcp 65001 >nul
cd /d "%~dp0"
start "" /min static-web-server.exe --config-file sws.toml
timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:8788/
exit
