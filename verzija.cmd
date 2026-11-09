@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo === ArQus Projekti - lokalni pregled verzija ===
where git >nul 2>&1 || (echo Git nije instaliran. Preuzmi: https://git-scm.com/download/win & pause & exit /b 1)
set PY=
where py >nul 2>&1 && set PY=py -3
if not defined PY where python >nul 2>&1 && set PY=python
if not defined PY (echo Python 3 nije instaliran. Preuzmi: https://www.python.org/downloads/windows/ ^(ukljuci "Add to PATH"^) & pause & exit /b 1)
%PY% scripts\verzija.py %*
if errorlevel 1 pause
endlocal
