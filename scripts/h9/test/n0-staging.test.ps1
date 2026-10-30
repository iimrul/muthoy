# Focused content-pin test. No staging, credentials, network, or sealed-H1 writes.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$fixture=Join-Path $repo ('audit-artifacts/h9-n0/source-guard-'+[Guid]::NewGuid().ToString('N'))
$scripts=Join-Path $fixture 'scripts/h9'
[IO.Directory]::CreateDirectory($scripts)|Out-Null
$names=@('h9-a5-dev-readonly.mjs','n0-account-inventory.mjs','n0-runtime.mjs','n0-with-token.ps1','run-n0.cmd','verify-n0.cmd','stage-n0-runtime.ps1')
foreach($name in $names){[IO.File]::Copy((Join-Path $repo ('scripts/h9/'+$name)),(Join-Path $scripts $name),$false)}
$destination='C:\Users\Imrul\.muthoy-h9-ws\n0-20261019'
$destinationExisted=[IO.Directory]::Exists($destination)
function Run-Check {
 $start=[Diagnostics.ProcessStartInfo]::new('C:\Program Files\PowerShell\7\pwsh.exe')
 $start.UseShellExecute=$false;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
 $start.ArgumentList.Add('-NoProfile');$start.ArgumentList.Add('-File');$start.ArgumentList.Add((Join-Path $scripts 'stage-n0-runtime.ps1'));$start.ArgumentList.Add('-CheckOnly')
 $child=[Diagnostics.Process]::Start($start)
 $null=$child.StandardOutput.ReadToEnd();$null=$child.StandardError.ReadToEnd();$child.WaitForExit();$code=$child.ExitCode;$child.Dispose()
 return $code
}
if((Run-Check)-ne 0){throw 'FAIL unchanged reviewed sources'}
$checks=1
foreach($name in $names | Where-Object {$_ -ne 'stage-n0-runtime.ps1'}){
 $path=Join-Path $scripts $name
 [IO.File]::AppendAllText($path,' ')
 if((Run-Check)-eq 0){throw ('FAIL changed bytes admitted: '+$name)}
 [IO.File]::Copy((Join-Path $repo ('scripts/h9/'+$name)),$path,$true)
 $checks++
}
if([IO.Directory]::Exists($destination)-ne $destinationExisted){throw 'FAIL CheckOnly staged a runtime'}
[Console]::WriteLine("N0 STAGING TESTS: $checks PASS; staging=0; credentials=0; network=0")
