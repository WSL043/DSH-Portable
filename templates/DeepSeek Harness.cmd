@echo off
setlocal
"%~dp0runtime\node\node.exe" "%~dp0launcher\portable-cli.mjs" start %*
if errorlevel 1 pause
