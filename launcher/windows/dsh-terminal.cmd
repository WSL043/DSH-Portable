@echo off
setlocal
set "DSH_PORTABLE_TERMINAL=1"
set "PATH=%~dp0..;%PATH%"
cd /d "%~dp0.."
title DSH Terminal

if exist "%ProgramFiles%\PowerShell\7\pwsh.exe" (
  "%ProgramFiles%\PowerShell\7\pwsh.exe" -NoLogo -NoExit
  exit /b %errorlevel%
)

"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoExit
exit /b %errorlevel%
