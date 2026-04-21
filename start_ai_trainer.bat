@echo off
cd /d "%~dp0"
echo Iniciando servidor AI Trainer...
python ai_trainer\server.py
echo.
echo El servidor se ha detenido. Pulsa una tecla para cerrar.
pause >nul
