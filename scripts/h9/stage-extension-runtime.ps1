# EXTENSIONS local file staging only. No software install, credentials or hosted calls.
[CmdletBinding()]
param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$Destination = 'C:\Users\Imrul\.muthoy-h9-ws\dev-extensions-20261019'
# Exact reviewed bytes; all checked before the first destination mutation.
$REVIEWED = @{
    'h9-a5-dev-readonly.mjs' = '00f00bd999b9a5b71516c3d57f29ec2dd0f83353e1b9bdc81838e006a2459370'
    'dev-extension-inventory.mjs' = '21ad5ba5463f82694f844620228f08b44c4f734c63e8af5c5b19f8cdb090b668'
    'extension-runtime.mjs' = '96b75d053421925524ab6adc7912f1c598c0ce1bddd8c98c9105345ba00d890f'
    'extensions-with-token.ps1' = 'fbc7dca254611539e37b9a94975c5be854dd5ab150cf2a566bb2e39e861a6979'
    'run-extensions.cmd' = '2c99d4468f564dae786609dda2827a878c689107191845ff3e99592aadd4f4e2'
    'verify-extensions.cmd' = '54414d95c4b0ad776b4e48794a64cdd75bc8fe5fc1b1a0ed20c4812c5dacb735'
}
foreach ($name in $REVIEWED.Keys) {
    $path = Join-Path $repo ('scripts/h9/' + $name)
    for ($p = $path; $p; $p = [IO.Path]::GetDirectoryName($p)) {
        if (([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'EXTENSIONS source reparse refused.' }
        if ($p -eq [IO.Path]::GetPathRoot($p)) { break }
    }
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $REVIEWED[$name]) { throw ('EXTENSIONS unreviewed source: ' + $name) }
}
if ($CheckOnly) { [Console]::WriteLine('EXTENSIONS SOURCE PINS VERIFIED; credentials=not-read'); exit 0 }
if ([IO.Directory]::Exists($Destination) -or [IO.File]::Exists($Destination)) { throw 'EXTENSIONS destination must be new; never restage a used boundary.' }
for ($p = [IO.Path]::GetDirectoryName($Destination); $p; $p = [IO.Path]::GetDirectoryName($p)) {
    if (-not [IO.Directory]::Exists($p) -or ([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Invalid EXTENSIONS staging ancestor.' }
    if ($p -eq [IO.Path]::GetPathRoot($p)) { break }
}
$baseCommit = (& git -C $repo rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $baseCommit -cnotmatch '^[a-f0-9]{40}$') { throw 'Cannot establish working tree base commit.' }
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$trusted = @($sid.Value,'S-1-5-18','S-1-5-32-544')
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class EXTENSIONSStageDacl {
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
        $result = [EXTENSIONSStageDacl]::SetNamedSecurityInfo($Path,1,[uint32]2147483652,[IntPtr]::Zero,[IntPtr]::Zero,$pointer,[IntPtr]::Zero)
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
    version=1; boundary='DEV_EXTENSION_READ_ONLY_20261019'; approvalId='founder-DEV-extensions-20261019'
    ownerSid=$sid.Value
    workingTreeBaseCommit=$baseCommit; runtimeFilesGitCommit=$null; runtimeFilesUncommitted=$true
    historicalSourceRevisionLabel='b8ca5d8c9538fd41605b09d5a9475e16ff496c3d'
    provenance='Reviewed uncommitted working-tree bytes identified by SHA-256. Historical label is not their containing Git commit.'
    verification='Focused local controls and fresh self-review; no independent-review claim'
    node=[ordered]@{path='C:\Program Files\nodejs\node.exe';version='v22.22.2';sha256='ae1a50511be58e987483fdbc12125407443926d2d394669ade2352776e920dd3'}
    files=$files
}
$manifestPath = Join-Path $Destination 'runtime-manifest.json'
[IO.File]::WriteAllText($manifestPath,($manifest | ConvertTo-Json -Depth 8) + "`n",[Text.UTF8Encoding]::new($false))
Protect $manifestPath $false
& 'C:\Windows\System32\cmd.exe' /d /c (Join-Path $Destination 'verify-extensions.cmd')
if ($LASTEXITCODE -ne 0) { throw 'EXTENSIONS staged verification refused; credentials not read.' }
[Console]::WriteLine('EXTENSIONS STAGED SEPARATELY; sealed-H1=unchanged')