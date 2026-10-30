# LOCAL preparation only: copies reviewed files, protects ACLs, writes hashes. Never gets credentials.
[CmdletBinding()]
param([string]$Destination = 'C:\Users\Imrul\.muthoy-h9-ws\b8ca5d8\ws1-a5')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$expected = 'C:\Users\Imrul\.muthoy-h9-ws\b8ca5d8\ws1-a5'
if ([IO.Path]::GetFullPath($Destination) -cne $expected) { throw 'Refused destination.' }
# Content-addressed staging guard. The reviewed runtime files were authored while HEAD was
# b8ca5d8 and committed afterwards, so a `git rev-parse HEAD` equality test refused every
# later revision even when the staged bytes were identical to the reviewed ones. Identity of
# what gets staged is a property of the BYTES, not of the commit that happens to contain
# them, so the gate below pins the exact reviewed SHA-256 of every staged file and is
# verified all-or-nothing before the first copy. The manifest keeps writing sourceRevision
# b8ca5d8: that value labels this reviewed byte set and is what the sealed H1/F12 artifacts
# and SOURCE_REVISION already attest to, so it is deliberately NOT rewritten here.
$REVIEWED = @{
    'scripts/h9/a5-with-token.ps1' = '90e64b7ce6c5bcc2bd31e9b3317085fcf833cdaec3ed7a4baefc4252dff81211'
    'scripts/h9/run-a5.cmd' = 'a728e5a1f37c75cfce1f6275a4a193c7a632a0ba2590fc5d9915764f868ad244'
    'scripts/h9/verify-a5.cmd' = '15de923c9e9ed95c0c63c5f880b67e824830d87383556db95c9da96c69eaf59a'
    'scripts/h9/h9-a5-dev-readonly.mjs' = '00f00bd999b9a5b71516c3d57f29ec2dd0f83353e1b9bdc81838e006a2459370'
    'scripts/h9/h9-a5.test.mjs' = '28c9e5cf788ef93213d5d6b9e33d1c036577fe96013aaab8ff4624dec5473ced'
    'scripts/h9-f12-hosted-preflight.mjs' = 'fa58c4ce286cab50c29a368febf44433a523689ef305cfff749652f87854f32b'
    'backend/supabase/checks/h9_hosted_preflight.sql' = '9bf8998891cd7cc9de8c945ffccad388038fd901a3c4135d58dceec8e43efa2a'
    'backend/supabase/checks/h9_postmigration_checks.sql' = '361a400a29025f2d859b4cd3e4f826afcdcd2c134a332b3412b9a2e0af1e2bd9'
}
foreach ($relative in $REVIEWED.Keys | Sort-Object) {
    $source = Join-Path $repo $relative
    if (-not [IO.File]::Exists($source)) { throw "Refused missing reviewed source: $relative" }
    if (([IO.File]::GetAttributes($source) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Refused reparse source: $relative" }
    $actual = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -cne $REVIEWED[$relative]) { throw "Refused unreviewed bytes: $relative" }
}
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
    # ROUND 9 HIGH — TIME OF CHECK IS NOT TIME OF USE.
    #
    # The gate above hashes the SOURCE. `Copy` then reopens that source, and
    # this line recorded whatever actually arrived -- so a source replaced
    # between the two was staged, recorded faithfully, and executed below,
    # while the manifest still claimed sourceRevision b8ca5d8. The reviewer
    # reproduced exactly that with harmless files: sourceGateAccepted=true,
    # stagedEqualsReviewed=false, manifestEqualsCopied=true. The source ACL
    # grants Authenticated Users: Modify, so the window is not theoretical.
    #
    # What is executed is the DESTINATION, so the destination is what must
    # match the reviewed digest. Checked here, per file, before anything runs.
    $files[$name] = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($files[$name] -cne $REVIEWED[$mapping[$name]]) { throw "Refused staged bytes: $name" }
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
# The test is copied separately, so it needs the same destination check -- the
# reviewer named it specifically. It is not in $files and never reached the
# loop above.
$stagedTest = (Get-FileHash -LiteralPath $testPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($stagedTest -cne $REVIEWED['scripts/h9/h9-a5.test.mjs']) { throw 'Refused staged test bytes.' }
# ALL-OR-NOTHING, restated at the point of execution: every staged file above
# has been compared against $REVIEWED by its destination bytes, and any
# mismatch threw before reaching this line.
& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoProfile -File (Join-Path $Destination 'a5-with-token.ps1') -VerifyOnly
if ($LASTEXITCODE -ne 0) { throw 'Installed runtime refused verification; no credentials accessed.' }
