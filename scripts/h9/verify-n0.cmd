@echo off
setlocal
rem Credential-free N0 verifier. No arguments forwarded.
set DOTNET_ >nul 2>&1
if not errorlevel 1 goto refused
set COMPLUS_ >nul 2>&1
if not errorlevel 1 goto refused
set CORECLR_ >nul 2>&1
if not errorlevel 1 goto refused
set COR_ >nul 2>&1
if not errorlevel 1 goto refused
set NODE_ >nul 2>&1
if not errorlevel 1 goto refused
set "PSModulePath=C:\Program Files\PowerShell\7\Modules"
"C:\Program Files\PowerShell\7\pwsh.exe" -NoProfile -File "%~dp0n0-with-token.ps1" -VerifyOnly
if errorlevel 1 exit /b 2
exit /b 0
:refused
echo N0 BOOTSTRAP REFUSED: startup-environment; credentials=not-read 1>&2
exit /b 2
