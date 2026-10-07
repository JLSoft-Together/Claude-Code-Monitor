@echo off
setlocal
cd /d "%~dp0"
title Claude Code Monitor

where node >nul 2>nul
if errorlevel 1 goto nonode

node scripts\launch.mjs %*
if errorlevel 1 pause
exit /b

:nonode
echo.
echo  Node.js chua duoc cai dat. / Node.js is not installed.
echo.
where winget >nul 2>nul
if errorlevel 1 goto manual
choice /c YN /m " Cai Node.js LTS bang winget? / Install Node.js LTS with winget"
if errorlevel 2 goto manual
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
echo.
echo  Cai xong: dong cua so nay va mo lai Claude-Code-Monitor.bat.
echo  Done: close this window and run Claude-Code-Monitor.bat again.
pause
exit /b

:manual
start "" https://nodejs.org/en/download
echo  Cai Node.js tu trang vua mo, roi chay lai Claude-Code-Monitor.bat.
echo  Install Node.js from the page that just opened, then run Claude-Code-Monitor.bat again.
pause
exit /b
