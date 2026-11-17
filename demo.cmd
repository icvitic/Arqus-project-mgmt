@echo off
rem ArQus Projekti - demo okruzenje na Windowsu (WP1.13). Treba Docker Desktop. Upute: docs\DEMO.md
rem   demo.cmd          izgradi i pokreni, napuni demo podatke, otvori preglednik i ispisi racune
rem   demo.cmd reset    vrati demo instituciju na pocetno stanje (svjezi datumi)
rem   demo.cmd stop     zaustavi (podaci ostaju)
rem   demo.cmd obrisi   zaustavi i obrisi sve demo podatke
rem   demo.cmd log      zapis aplikacije
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "COMPOSE=docker compose -f infra\demo\docker-compose.yml"
set "URL=http://localhost:8080"
where docker >nul 2>&1 || (echo Docker Desktop nije instaliran. Preuzmi: https://www.docker.com/products/docker-desktop/ & pause & exit /b 1)
docker info >nul 2>&1 || (echo Docker Desktop nije pokrenut. Pokreni ga, pricekaj da se upali pa pokusaj ponovno. & pause & exit /b 1)
set "CMD=%~1"
if "%CMD%"=="" set "CMD=start"
if /i "%CMD%"=="start" goto start
if /i "%CMD%"=="reset" goto reset
if /i "%CMD%"=="stop" goto stop
if /i "%CMD%"=="obrisi" goto obrisi
if /i "%CMD%"=="log" goto log
echo Uporaba: demo.cmd [start^|reset^|stop^|obrisi^|log]
exit /b 2

:start
echo === ArQus Projekti - demo (prvo pokretanje traje nekoliko minuta) ===
%COMPOSE% up -d --build || goto fail
echo Cekam aplikaciju...
set /a N=0
:wait
curl -sf %URL%/api/health >nul 2>&1 && goto ready
set /a N+=1
if %N% geq 120 (echo Aplikacija se nije pokrenula u 4 minute. Zapis: demo.cmd log & pause & exit /b 1)
ping -n 3 127.0.0.1 >nul
goto wait
:ready
echo.
%COMPOSE% exec -T app node dist/db/cli.js demo
echo.
echo Adresa: %URL%   Scenarij demonstracije: docs\DEMO-SCENARIJ.md
echo Nakon demonstracije: demo.cmd reset (pocetno stanje) ili demo.cmd stop.
start "" %URL%
pause
exit /b 0

:reset
%COMPOSE% exec -T app node dist/db/cli.js demo --reset || goto fail
echo Demo vracen na pocetno stanje - %URL% (prijavi se ponovno).
pause
exit /b 0

:stop
%COMPOSE% stop || goto fail
echo Zaustavljeno; podaci ostaju. Ponovno pokretanje: demo.cmd
exit /b 0

:obrisi
%COMPOSE% down -v || goto fail
echo Demo okruzenje i svi njegovi podaci obrisani.
exit /b 0

:log
%COMPOSE% logs --tail 200 app
pause
exit /b 0

:fail
echo Naredba nije uspjela - provjeri da Docker Desktop radi; zapis: demo.cmd log
pause
exit /b 1
