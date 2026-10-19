@echo off
setlocal
rem Invoke through C:\Windows\System32\cmd.exe /d /c. No forwarded arguments.
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
"C:\Program Files\PowerShell\7\pwsh.exe" -NoProfile -File "C:\Users\Imrul\.muthoy-h9-ws\b8ca5d8\ws1-a5\a5-with-token.ps1" -VerifyOnly
if errorlevel 1 exit /b 2
exit /b 0
:refused
echo A5 BOOTSTRAP REFUSED: startup-environment; credentials=not-read 1>&2
exit /b 2
