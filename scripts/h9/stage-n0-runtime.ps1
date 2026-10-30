# N0 local file staging only. No software install, credentials or hosted calls.
[CmdletBinding()]
param([switch]$CheckOnly, [string]$AcceptanceReceipt)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$Destination = 'C:\Users\Imrul\.muthoy-h9-ws\n0-20261019'
# Exact reviewed bytes; all checked before the first destination mutation.
$REVIEWED = @{
    'h9-a5-dev-readonly.mjs' = '00f00bd999b9a5b71516c3d57f29ec2dd0f83353e1b9bdc81838e006a2459370'
    'n0-account-inventory.mjs' = '48529b18bad0e1ddc2c461239f3662516f2ce48574b2383bb227dea1d3fc1a57'
    'n0-runtime.mjs' = '2c22dc35724cd9db5213a6ad127757e901d1d6304635715f875b992da8157cb7'
    'n0-with-token.ps1' = '55a531ae7dc22865ea7683567e694ba6e4081d3fc862efd2f9960f196e2c1c7b'
    'run-n0.cmd' = '02efaac756302ca4f98b26b7db11416f5b5de9358b464178d5abbddb71441f59'
    'verify-n0.cmd' = 'c8dd88484c300b4338a60a8d2c6eb835c3729f1ebee00f849c13608566d60a24'
}
foreach ($name in $REVIEWED.Keys) {
    $path = Join-Path $repo ('scripts/h9/' + $name)
    for ($p = $path; $p; $p = [IO.Path]::GetDirectoryName($p)) {
        if (([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'N0 source reparse refused.' }
        if ($p -eq [IO.Path]::GetPathRoot($p)) { break }
    }
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $REVIEWED[$name]) { throw ('N0 unreviewed source: ' + $name) }
}
if ($CheckOnly) { [Console]::WriteLine('N0 SOURCE PINS VERIFIED; credentials=not-read'); exit 0 }
if (-not $AcceptanceReceipt) { throw 'Independent ACCEPT receipt required.' }
$receipt = Get-Content -LiteralPath $AcceptanceReceipt -Raw | ConvertFrom-Json -AsHashtable
if ($receipt.verdict -cne 'ACCEPT' -or $receipt.boundary -cne 'N0_GET_ONLY_20261019' -or $receipt.files.Count -ne $REVIEWED.Count) { throw 'Invalid independent acceptance.' }
foreach ($name in $REVIEWED.Keys) { if ($receipt.files[$name] -cne $REVIEWED[$name]) { throw 'Acceptance bytes differ.' } }
if ([IO.Directory]::Exists($Destination) -or [IO.File]::Exists($Destination)) { throw 'N0 destination must be new; never restage a used boundary.' }
for ($p = [IO.Path]::GetDirectoryName($Destination); $p; $p = [IO.Path]::GetDirectoryName($p)) {
    if (-not [IO.Directory]::Exists($p) -or ([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Invalid N0 staging ancestor.' }
    if ($p -eq [IO.Path]::GetPathRoot($p)) { break }
}
$baseCommit = (& git -C $repo rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $baseCommit -cnotmatch '^[a-f0-9]{40}$') { throw 'Cannot establish working tree base commit.' }
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$trusted = @($sid.Value,'S-1-5-18','S-1-5-32-544')
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class N0StageDacl {
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode)]
 public static extern uint SetNamedSecurityInfo(string path,uint type,uint info,IntPtr owner,IntPtr group,IntPtr dacl,IntPtr sacl);
}
'@
function Protect([string]$Path, [bool]$Directory) {
    if (([IO.File]::GetAttributes($Path) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Refused reparse point.' }
    $acl = Get-Acl -LiteralPath $Path
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $sid.Value) { throw 'Refused unexpected owner; no ownership takeover.' }
    $acl.SetAccessRuleProtection($true,$false)
    foreach ($rule in @($acl.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier]))) { $acl.RemoveAccessRuleSpecific($rule) }
    foreach ($id in $trusted) {
        $inherit = if ($Directory) { [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($id),[Security.AccessControl.FileSystemRights]::FullControl,$inherit,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow))
    }
    # DACL only: Set-Acl attempts audit metadata under this host and requires SeSecurityPrivilege.
    $raw = [Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(),0)
    $dacl = [byte[]]::new($raw.DiscretionaryAcl.BinaryLength)
    $raw.DiscretionaryAcl.GetBinaryForm($dacl,0)
    $pointer = [Runtime.InteropServices.Marshal]::AllocHGlobal($dacl.Length)
    try {
        [Runtime.InteropServices.Marshal]::Copy($dacl,0,$pointer,$dacl.Length)
        $result = [N0StageDacl]::SetNamedSecurityInfo($Path,1,[uint32]2147483652,[IntPtr]::Zero,[IntPtr]::Zero,$pointer,[IntPtr]::Zero)
        if ($result -ne 0) { throw "DACL-only update failed ($result)." }
    } finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($pointer) }
}

[IO.Directory]::CreateDirectory($Destination) | Out-Null
Protect $Destination $true
$evidence = Join-Path $Destination 'evidence'
[IO.Directory]::CreateDirectory($evidence) | Out-Null
Protect $evidence $true
$files = [ordered]@{}
foreach ($name in $REVIEWED.Keys | Sort-Object) {
    $target = Join-Path $Destination $name
    [IO.File]::Copy((Join-Path $repo ('scripts/h9/' + $name)),$target,$false)
    Protect $target $false
    $files[$name] = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($files[$name] -cne $REVIEWED[$name]) { throw 'Source changed during staging.' }
}
$manifest = [ordered]@{
    version=1; boundary='N0_GET_ONLY_20261019'; approvalId='founder-N0-final-20261019'
    ownerSid=$sid.Value
    workingTreeBaseCommit=$baseCommit; runtimeFilesGitCommit=$null; runtimeFilesUncommitted=$true
    historicalSourceRevisionLabel='b8ca5d8c9538fd41605b09d5a9475e16ff496c3d'
    provenance='Reviewed uncommitted working-tree bytes identified by SHA-256. Historical label is not their containing Git commit.'
    independentAcceptanceSha256=(Get-FileHash -LiteralPath $AcceptanceReceipt -Algorithm SHA256).Hash.ToLowerInvariant()
    node=[ordered]@{path='C:\Program Files\nodejs\node.exe';version='v22.22.2';sha256='ae1a50511be58e987483fdbc12125407443926d2d394669ade2352776e920dd3'}
    files=$files
}
$manifestPath = Join-Path $Destination 'runtime-manifest.json'
[IO.File]::WriteAllText($manifestPath,($manifest | ConvertTo-Json -Depth 8) + "`n",[Text.UTF8Encoding]::new($false))
Protect $manifestPath $false
& 'C:\Windows\System32\cmd.exe' /d /c (Join-Path $Destination 'verify-n0.cmd')
if ($LASTEXITCODE -ne 0) { throw 'N0 staged verification refused; credentials not read.' }
[Console]::WriteLine('N0 STAGED SEPARATELY; sealed-H1=unchanged')