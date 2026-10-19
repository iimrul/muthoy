# Local H1 launcher. Enter through run-a5.cmd or verify-a5.cmd using cmd.exe /d /c.
# The CMD bootstrap checks CLR startup variables before PowerShell itself starts.
[CmdletBinding()]
param([switch]$VerifyOnly, [string]$EvidenceRoot, [string]$Checkpoint)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# MUST precede module loading, Add-Type, Credential Manager, or child creation.
foreach ($key in [Environment]::GetEnvironmentVariables().Keys) {
    $upper = ([string]$key).ToUpperInvariant()
    if ($upper -eq 'NODE_TLS_REJECT_UNAUTHORIZED' -and [Environment]::GetEnvironmentVariable($key) -eq '1') { continue }
    if ($upper -match '^(NODE_|DOTNET_|COMPLUS_|CORECLR_|COR_|PG|OPENSSL_|SSL_CERT_|LD_PRELOAD$|LD_LIBRARY_PATH$|DYLD_|HTTP_PROXY$|HTTPS_PROXY$|ALL_PROXY$)' -or $upper -eq 'SUPABASE_ACCESS_TOKEN') {
        [Console]::Error.WriteLine('A5 LAUNCH REFUSED: unsafe-environment; credentials=not-read')
        exit 2
    }
}
if ([Environment]::ProcessPath -ine 'C:\Program Files\PowerShell\7\pwsh.exe' -or [Environment]::GetCommandLineArgs() -inotcontains '-NoProfile') {
    [Console]::Error.WriteLine('A5 LAUNCH REFUSED: powershell-entrypoint; credentials=not-read')
    exit 2
}
# Resolve built-in cmdlets only from the protected PowerShell installation.
$env:PSModulePath = [IO.Path]::Combine($PSHOME,'Modules')
Microsoft.PowerShell.Core\Import-Module ([IO.Path]::Combine($PSHOME,'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop
Microsoft.PowerShell.Core\Import-Module ([IO.Path]::Combine($PSHOME,'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1')) -ErrorAction Stop

function Deny([string]$Code) { throw "h9-$Code" }
function Digest([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    try { return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream)).ToLowerInvariant() }
    finally { $stream.Dispose() }
}
$ownerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$trustedSids = @($ownerSid, 'S-1-5-18', 'S-1-5-32-544')
$osOwner = 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
function Test-TrustedOwner([string]$Sid, [bool]$First, [bool]$Private) {
    return $Sid -in $trustedSids -or ($Sid -eq $osOwner -and (-not $First -or -not $Private))
}
# Modify includes ReadAndExecute: use only mutation bits so ordinary OS read access
# does not cause a false refusal while WriteData/AppendData still always refuse.
$writeMask = [int64][Security.AccessControl.FileSystemRights]::Write -bor [int64][Security.AccessControl.FileSystemRights]::Delete -bor [int64][Security.AccessControl.FileSystemRights]::ChangePermissions -bor [int64][Security.AccessControl.FileSystemRights]::TakeOwnership -bor [int64][Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles
$replaceMask = [int64][Security.AccessControl.FileSystemRights]::Delete -bor [int64][Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [int64][Security.AccessControl.FileSystemRights]::ChangePermissions -bor [int64][Security.AccessControl.FileSystemRights]::TakeOwnership
function Assert-Path([string]$Path, [bool]$Private) {
    if ($Path -notmatch '^[A-Za-z]:\\' -or $Path -match '(?:^|\\)\.\.(?:\\|$)') { Deny 'path' }
    $absolute = [IO.Path]::GetFullPath($Path)
    $first = $true
    for ($current = $absolute; $current; $current = [IO.Path]::GetDirectoryName($current)) {
        if (([IO.File]::GetAttributes($current) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Deny 'reparse' }
        $acl = Microsoft.PowerShell.Security\Get-Acl -LiteralPath $current
        $actualOwner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
        # TrustedInstaller may own OS ancestors, never the private package/evidence itself.
        if (-not (Test-TrustedOwner $actualOwner $first $Private)) { Deny 'owner' }
        # Files in protected OS directories also need direct-write protection;
        # checking only replacement/deletion rights misses in-place executable edits.
        $mask = if ($first) { $writeMask } else { $replaceMask }
        foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
            if (($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) { continue }
            if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and ([int64]$rule.FileSystemRights -band $mask) -ne 0 -and -not (Test-TrustedOwner $rule.IdentityReference.Value $first $Private)) { Deny 'writable-acl' }
        }
        $first = $false
        if ($current -eq [IO.Path]::GetPathRoot($current)) { break }
    }
}
try {
    $root = [IO.Path]::GetFullPath($PSScriptRoot)
    Assert-Path $root $true
    $manifestPath = Join-Path $root 'runtime-manifest.json'
    Assert-Path $manifestPath $true
    $manifest = Microsoft.PowerShell.Utility\ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($manifestPath)) -AsHashtable
    $expected = @('a5-with-token.ps1','run-a5.cmd','verify-a5.cmd','h9-a5-dev-readonly.mjs','scripts/h9-f12-hosted-preflight.mjs','backend/supabase/checks/h9_hosted_preflight.sql','backend/supabase/checks/h9_postmigration_checks.sql')
    if ($manifest.version -ne 1 -or $manifest.sourceRevision -cne 'b8ca5d8c9538fd41605b09d5a9475e16ff496c3d' -or $manifest.ownerSid -cne $ownerSid -or $manifest.files.Count -ne $expected.Count) { Deny 'manifest' }
    $pins = @{
        'scripts/h9-f12-hosted-preflight.mjs' = 'fa58c4ce286cab50c29a368febf44433a523689ef305cfff749652f87854f32b'
        'backend/supabase/checks/h9_hosted_preflight.sql' = '9bf8998891cd7cc9de8c945ffccad388038fd901a3c4135d58dceec8e43efa2a'
        'backend/supabase/checks/h9_postmigration_checks.sql' = '361a400a29025f2d859b4cd3e4f826afcdcd2c134a332b3412b9a2e0af1e2bd9'
    }
    foreach ($name in $expected) {
        if (-not $manifest.files.ContainsKey($name)) { Deny 'allowlist' }
        $path = Join-Path $root $name
        Assert-Path $path $true
        if ($manifest.files[$name] -cnotmatch '^[a-f0-9]{64}$' -or (Digest $path) -cne $manifest.files[$name]) { Deny 'hash' }
        if ($pins.ContainsKey($name) -and $manifest.files[$name] -cne $pins[$name]) { Deny 'evaluator-identity' }
    }
    $nodePath = 'C:\Program Files\nodejs\node.exe'
    Assert-Path $nodePath $false
    if ($manifest.node.path -cne $nodePath -or $manifest.node.version -cne 'v22.22.2' -or $manifest.node.sha256 -cne 'ae1a50511be58e987483fdbc12125407443926d2d394669ade2352776e920dd3' -or (Digest $nodePath) -cne $manifest.node.sha256) { Deny 'node' }
    if (-not $VerifyOnly) {
        if (-not $EvidenceRoot) { Deny 'evidence-root' }
        Assert-Path $EvidenceRoot $true
        if ($Checkpoint) {
            Assert-Path $Checkpoint $true
            $saved = Microsoft.PowerShell.Utility\ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($Checkpoint)) -AsHashtable
            foreach ($file in $saved.files) { Assert-Path $file.path $true }
        }
    }
    if ($VerifyOnly) { [Console]::WriteLine('A5 LAUNCH VERIFIED; credentials=not-read'); exit 0 }
} catch {
    $reason = if ($_.Exception.Message -cmatch '^h9-[a-z-]+$') { $_.Exception.Message } else { 'h9-precondition' }
    [Console]::Error.WriteLine("A5 LAUNCH REFUSED: $reason; credentials=not-read")
    exit 2
}

# No path below this boundary runs during --VerifyOnly or a refusal above.
$signature = @'
using System;
using System.Runtime.InteropServices;
public static class A5Credential {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CREDENTIAL {
  public uint Flags, Type; public IntPtr TargetName, Comment;
  public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
  public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist, AttributeCount;
  public IntPtr Attributes, TargetAlias, UserName;
 }
 [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredRead(string target,uint type,uint flags,out IntPtr value);
 [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr value);
}
'@
try {
    Microsoft.PowerShell.Utility\Add-Type -TypeDefinition $signature -ErrorAction Stop
    $handle = [IntPtr]::Zero
    if (-not [A5Credential]::CredRead('Supabase CLI:supabase',1,0,[ref]$handle)) { Deny 'credential-unavailable' }
    try {
        $credential = [Runtime.InteropServices.Marshal]::PtrToStructure($handle,[Type][A5Credential+CREDENTIAL])
        $bytes = [byte[]]::new($credential.CredentialBlobSize)
        [Runtime.InteropServices.Marshal]::Copy($credential.CredentialBlob,$bytes,0,$bytes.Length)
        $token = [Text.Encoding]::UTF8.GetString($bytes)
        [Array]::Clear($bytes,0,$bytes.Length)
    } finally { [A5Credential]::CredFree($handle) }
    if ($token.StartsWith('go-keyring-base64:')) { $token = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($token.Substring(18))) }
    $token = $token.Trim()
    if ($token -cnotmatch '^sbp_[A-Za-z0-9_]{20,}$') { Deny 'credential-shape' }
    $start = [Diagnostics.ProcessStartInfo]::new($nodePath)
    $start.UseShellExecute = $false
    $start.Environment.Clear()
    foreach ($key in @('SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA')) {
        $value = [Environment]::GetEnvironmentVariable($key)
        if ($null -ne $value) { $start.Environment[$key] = $value }
    }
    $start.Environment['SUPABASE_ACCESS_TOKEN'] = $token
    $start.ArgumentList.Add((Join-Path $root 'h9-a5-dev-readonly.mjs'))
    $start.ArgumentList.Add('--evidence-root'); $start.ArgumentList.Add($EvidenceRoot)
    if ($Checkpoint) { $start.ArgumentList.Add('--checkpoint'); $start.ArgumentList.Add($Checkpoint) }
    $child = [Diagnostics.Process]::Start($start)
    $token = $null; $start.Environment.Remove('SUPABASE_ACCESS_TOKEN') | Out-Null
    $child.WaitForExit(); $result = $child.ExitCode; $child.Dispose()
    exit $result
} catch {
    [Console]::Error.WriteLine('A5 LAUNCH REFUSED: credential-or-child-error')
    exit 2
} finally { $token = $null; $bytes = $null }
