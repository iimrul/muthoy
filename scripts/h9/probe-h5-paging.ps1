# Local read-only metadata only. Never prompts, reads credentials, changes Windows,
# connects to Supabase, or authorizes real-data execution. No administrator RunAs.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules')
Microsoft.PowerShell.Core\Import-Module ([IO.Path]::Combine($PSHOME,'Modules\CimCmdlets\CimCmdlets.psd1')) -ErrorAction Stop
Microsoft.PowerShell.Core\Import-Module ([IO.Path]::Combine($PSHOME,'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop
$pagefiles=[ordered]@{querySucceeded=$false;rows=@()}
$volumes=[ordered]@{querySucceeded=$false;rows=@()}
$flag=[ordered]@{querySucceeded=$false;enabled=$null;effectiveThisBoot='UNVERIFIED'}
try {
 $rows=@(CimCmdlets\Get-CimInstance -ClassName Win32_PageFileUsage -ErrorAction Stop)
 $projected=@(foreach($row in $rows){
  if($row.Name -cnotmatch '^([A-Za-z]:)\\'){throw 'Unexpected pagefile path'}
  [ordered]@{drive=$Matches[1].ToUpperInvariant();allocatedMiB=[long]$row.AllocatedBaseSize;usedMiB=[long]$row.CurrentUsage}
 })
 $pagefiles=[ordered]@{querySucceeded=$true;rows=$projected}
} catch { $pagefiles=[ordered]@{querySucceeded=$false;rows=@();error='query-unavailable'} }
try {
 $namespace='root\CIMV2\Security\MicrosoftVolumeEncryption'
 $instances=@(CimCmdlets\Get-CimInstance -Namespace $namespace -ClassName Win32_EncryptableVolume -ErrorAction Stop)
 $projected=@(foreach($row in $instances){
  if($row.DriveLetter -notmatch '^[A-Za-z]:$'){continue}
  $protection=CimCmdlets\Invoke-CimMethod -InputObject $row -MethodName GetProtectionStatus -ErrorAction Stop
  $conversion=CimCmdlets\Invoke-CimMethod -InputObject $row -MethodName GetConversionStatus -ErrorAction Stop
  if($protection.ReturnValue -ne 0 -or $conversion.ReturnValue -ne 0){throw 'Volume query unavailable'}
  [ordered]@{drive=$row.DriveLetter.ToUpperInvariant();protectionStatus=[int]$protection.ProtectionStatus;conversionStatus=[int]$conversion.ConversionStatus;encryptionPercentage=[int]$conversion.EncryptionPercentage}
 })
 $volumes=[ordered]@{querySucceeded=$true;rows=$projected}
} catch { $volumes=[ordered]@{querySucceeded=$false;rows=@();error='query-unavailable'} }
try {
 $start=[Diagnostics.ProcessStartInfo]::new('C:\Windows\System32\fsutil.exe')
 $start.UseShellExecute=$false;$start.CreateNoWindow=$true
 $start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
 $start.Environment.Clear();$start.Environment['SystemRoot']='C:\Windows'
 foreach($arg in @('behavior','query','EncryptPagingFile')){$start.ArgumentList.Add($arg)}
 $process=[Diagnostics.Process]::Start($start)
 try {
  $out=$process.StandardOutput.ReadToEndAsync();$err=$process.StandardError.ReadToEndAsync()
  if(-not $process.WaitForExit(10000)){$process.Kill();$process.WaitForExit();throw 'Read-only query timeout'}
  $text=$out.GetAwaiter().GetResult();$null=$err.GetAwaiter().GetResult()
  if($process.ExitCode -eq 0 -and $text.Length -le 4096 -and $text -match '(?m)^EncryptPagingFile\s*=\s*([01])\b'){
   $flag=[ordered]@{querySucceeded=$true;enabled=($Matches[1] -ceq '1');effectiveThisBoot='UNVERIFIED'}
  }
 } finally {$process.Dispose()}
} catch { $flag=[ordered]@{querySucceeded=$false;enabled=$null;effectiveThisBoot='UNVERIFIED'} }
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=[Security.Principal.WindowsPrincipal]::new($identity)
$result=[ordered]@{version=1;collector='h5-readonly-paging-probe-v1';observedAtUtc=[DateTime]::UtcNow.ToString('o');administrator=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);pagefiles=$pagefiles;volumes=$volumes;pagefileEncryption=$flag;credentialsRead=$false;settingsChanged=$false;credentialEntryAllowed=$false}
Microsoft.PowerShell.Utility\ConvertTo-Json -InputObject $result -Depth 7
