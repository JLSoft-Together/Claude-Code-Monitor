@echo off
rem Old name kept so existing shortcuts still start the monitor; launch.mjs moves them to Agent-Monitor.lnk.
call "%~dp0Agent-Monitor.bat" %*
