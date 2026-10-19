@echo off
setlocal
rem LIVE H1 ONLY AFTER EXPLICIT FOUNDER APPROVAL. No forwarded arguments or PATH lookup.
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
if exist "C:\Users\Imrul\.muthoy-h9-ws\b8ca5d8\ws1-a5\checkpoint.json" goto checkpoint
"C:\Program Files\PowerShell\7\pwsh.exe" -NoProfile -File "C:\Users\Imrul\.muthoy-h9-ws\b8ca5d8\ws1-a5\a5-with-token.ps1" -EvidenceRoot "C:\Users\Imrul\.muthoy-h9-ws\b8ca5d8\ws1-a5\evidence"
goto result
:checkpoint
"C:\Program Files\PowerShell\7\pwsh.exe" -NoProfile -File "C:\Users\Imrul\.muthoy-h9-ws\b8ca5d8\ws1-a5\a5-with-token.ps1" -EvidenceRoot "C:\Users\Imrul\.muthoy-h9-ws\b8ca5d8\ws1-a5\evidence" -Checkpoint "C:\Users\Imrul\.muthoy-h9-ws\b8ca5d8\ws1-a5\checkpoint.json"
goto result
:result
if errorlevel 5 exit /b 9
if errorlevel 4 exit /b 4
if errorlevel 3 exit /b 3
if errorlevel 2 exit /b 2
if errorlevel 1 exit /b 1
exit /b 0
:refused
echo A5 BOOTSTRAP REFUSED: startup-environment; credentials=not-read 1>&2
exit /b 2
