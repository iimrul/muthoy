# LOCAL preparation only: copies reviewed files, protects ACLs, writes hashes. Never gets credentials.
[CmdletBinding()]
param([string]$Destination = 'C:\Users\Imrul\.muthoy-h9-ws\b8ca5d8\ws1-a5')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$expected = 'C:\Users\Imrul\.muthoy-h9-ws\b8ca5d8\ws1-a5'
if ([IO.Path]::GetFullPath($Destination) -cne $expected) { throw 'Refused destination.' }
if ((git -C $repo rev-parse HEAD) -cne 'b8ca5d8c9538fd41605b09d5a9475e16ff496c3d') { throw 'Refused revision.' }
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$trusted = @($sid.Value,'S-1-5-18','S-1-5-32-544')
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class H9LocalDacl {
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
        $result = [H9LocalDacl]::SetNamedSecurityInfo($Path,1,[uint32]2147483652,[IntPtr]::Zero,[IntPtr]::Zero,$pointer,[IntPtr]::Zero)
        if ($result -ne 0) { throw "DACL-only update failed ($result)." }
    } finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($pointer) }
}
# Verify every existing ancestor before writing through it.
for ($p = $Destination; $p; $p = [IO.Path]::GetDirectoryName($p)) {
    if ([IO.Directory]::Exists($p) -and ([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Refused reparse ancestor.' }
    if ($p -eq [IO.Path]::GetPathRoot($p)) { break }
}
[IO.Directory]::CreateDirectory($Destination) | Out-Null
Protect $Destination $true
$evidence = Join-Path $Destination 'evidence'
[IO.Directory]::CreateDirectory($evidence) | Out-Null
Protect $evidence $true
$files = [ordered]@{}
$mapping = @{
    'a5-with-token.ps1' = 'scripts/h9/a5-with-token.ps1'
    'run-a5.cmd' = 'scripts/h9/run-a5.cmd'
    'verify-a5.cmd' = 'scripts/h9/verify-a5.cmd'
    'h9-a5-dev-readonly.mjs' = 'scripts/h9/h9-a5-dev-readonly.mjs'
    'scripts/h9-f12-hosted-preflight.mjs' = 'scripts/h9-f12-hosted-preflight.mjs'
    'backend/supabase/checks/h9_hosted_preflight.sql' = 'backend/supabase/checks/h9_hosted_preflight.sql'
    'backend/supabase/checks/h9_postmigration_checks.sql' = 'backend/supabase/checks/h9_postmigration_checks.sql'
}
foreach ($name in $mapping.Keys | Sort-Object) {
    $target = Join-Path $Destination $name
    $directory = [IO.Path]::GetDirectoryName($target)
    for ($p = $directory; $p; $p = [IO.Path]::GetDirectoryName($p)) {
        if ([IO.Directory]::Exists($p) -and ([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Refused nested reparse ancestor.' }
        if ($p -eq [IO.Path]::GetPathRoot($p)) { break }
    }
    [IO.Directory]::CreateDirectory($directory) | Out-Null
    # Validate path components before any file copy; never traverse an existing junction.
    for ($p = $directory; $p.Length -ge $Destination.Length; $p = [IO.Path]::GetDirectoryName($p)) { Protect $p $true; if ($p -eq $Destination) { break } }
    if ([IO.File]::Exists($target) -and ([IO.File]::GetAttributes($target) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Refused reparse input.' }
    [IO.File]::Copy((Join-Path $repo $mapping[$name]),$target,$true)
    Protect $target $false
    $files[$name] = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
}
$manifest = [ordered]@{ version=1; sourceRevision='b8ca5d8c9538fd41605b09d5a9475e16ff496c3d'; ownerSid=$sid.Value; node=[ordered]@{path='C:\Program Files\nodejs\node.exe';version='v22.22.2';sha256='ae1a50511be58e987483fdbc12125407443926d2d394669ade2352776e920dd3'}; files=$files }
$manifestPath = Join-Path $Destination 'runtime-manifest.json'
if ([IO.File]::Exists($manifestPath) -and ([IO.File]::GetAttributes($manifestPath) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Refused manifest reparse.' }
[IO.File]::WriteAllText($manifestPath,($manifest | ConvertTo-Json -Depth 8) + "`n",[Text.UTF8Encoding]::new($false))
Protect $manifestPath $false
$testPath = Join-Path $Destination 'h9-a5.test.mjs'
if ([IO.File]::Exists($testPath) -and ([IO.File]::GetAttributes($testPath) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Refused test reparse.' }
[IO.File]::Copy((Join-Path $repo 'scripts/h9/h9-a5.test.mjs'),$testPath,$true)
Protect $testPath $false
& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoProfile -File (Join-Path $Destination 'a5-with-token.ps1') -VerifyOnly
if ($LASTEXITCODE -ne 0) { throw 'Installed runtime refused verification; no credentials accessed.' }
