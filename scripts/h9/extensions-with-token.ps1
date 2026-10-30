# Separate EXTENSIONS launcher. Enter through run-extensions.cmd or verify-extensions.cmd using cmd.exe /d /c.
# The CMD bootstrap checks CLR startup variables before PowerShell itself starts.
[CmdletBinding()]
param([switch]$VerifyOnly)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# MUST precede module loading, Add-Type, Credential Manager, or child creation.
foreach ($key in [Environment]::GetEnvironmentVariables().Keys) {
    $upper = ([string]$key).ToUpperInvariant()
    if ($upper -eq 'NODE_TLS_REJECT_UNAUTHORIZED' -and [Environment]::GetEnvironmentVariable($key) -eq '1') { continue }
    if ($upper -match '^(NODE_|DOTNET_|COMPLUS_|CORECLR_|COR_|PG|OPENSSL_|SSL_CERT_|LD_PRELOAD$|LD_LIBRARY_PATH$|DYLD_|HTTP_PROXY$|HTTPS_PROXY$|ALL_PROXY$)' -or $upper -eq 'SUPABASE_ACCESS_TOKEN') {
        [Console]::Error.WriteLine('EXTENSIONS LAUNCH REFUSED: unsafe-environment; credentials=not-read')
        exit 2
    }
}
if ([Environment]::ProcessPath -ine 'C:\Program Files\PowerShell\7\pwsh.exe' -or [Environment]::GetCommandLineArgs() -inotcontains '-NoProfile') {
    [Console]::Error.WriteLine('EXTENSIONS LAUNCH REFUSED: powershell-entrypoint; credentials=not-read')
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
$locks = [Collections.Generic.List[IO.FileStream]]::new()
try {
    $root = [IO.Path]::GetFullPath($PSScriptRoot)
    Assert-Path $root $true
    $manifestPath = Join-Path $root 'runtime-manifest.json'
    Assert-Path $manifestPath $true
    $locks.Add([IO.File]::Open($manifestPath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read))
    $manifest = Microsoft.PowerShell.Utility\ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($manifestPath)) -AsHashtable
    $expected = @('h9-a5-dev-readonly.mjs','dev-extension-inventory.mjs','extension-runtime.mjs','extensions-with-token.ps1','run-extensions.cmd','verify-extensions.cmd')
    if ($manifest.version -ne 1 -or $manifest.boundary -cne 'DEV_EXTENSION_READ_ONLY_20261019' -or $manifest.approvalId -cne 'founder-DEV-extensions-20261019' -or $manifest.runtimeFilesGitCommit -ne $null -or $manifest.runtimeFilesUncommitted -ne $true -or $manifest.workingTreeBaseCommit -cnotmatch '^[a-f0-9]{40}$' -or $manifest.historicalSourceRevisionLabel -cne 'b8ca5d8c9538fd41605b09d5a9475e16ff496c3d' -or $manifest.ownerSid -cne $ownerSid -or $manifest.files.Count -ne $expected.Count) { Deny 'manifest' }
    foreach ($name in $expected) {
        if (-not $manifest.files.ContainsKey($name)) { Deny 'allowlist' }
        $path = Join-Path $root $name
        Assert-Path $path $true
        $locks.Add([IO.File]::Open($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read))
        if ($manifest.files[$name] -cnotmatch '^[a-f0-9]{64}$' -or (Digest $path) -cne $manifest.files[$name]) { Deny 'hash' }
    }
    if ($manifest.files['h9-a5-dev-readonly.mjs'] -cne '00f00bd999b9a5b71516c3d57f29ec2dd0f83353e1b9bdc81838e006a2459370') { Deny 'shared-helper-identity' }
    $nodePath = 'C:\Program Files\nodejs\node.exe'
    Assert-Path $nodePath $false
    $locks.Add([IO.File]::Open($nodePath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read))
    if ($manifest.node.path -cne $nodePath -or $manifest.node.version -cne 'v22.22.2' -or $manifest.node.sha256 -cne 'ae1a50511be58e987483fdbc12125407443926d2d394669ade2352776e920dd3' -or (Digest $nodePath) -cne $manifest.node.sha256) { Deny 'node' }
    $psPath = 'C:\Program Files\PowerShell\7\pwsh.exe'
    Assert-Path $psPath $false
    $locks.Add([IO.File]::Open($psPath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read))
    if ((Digest $psPath) -cne 'bfb46af89433268872ddb43d1ca7a3f433452ee91ed356a9786940f90118e285') { Deny 'powershell-hash' }
    $EvidenceRoot = Join-Path $root 'evidence'
    Assert-Path $EvidenceRoot $true
    if ($VerifyOnly) { [Console]::WriteLine('EXTENSIONS LAUNCH VERIFIED; credentials=not-read'); exit 0 }
    # Exclusive durable receipt makes this staging single-use, including failed reads.
    $once = [IO.File]::Open((Join-Path $root 'execution-started.json'),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
    try {
        $receipt = [Text.Encoding]::UTF8.GetBytes('{"approvalId":"founder-DEV-extensions-20261019","startedAtUtc":"' + [DateTime]::UtcNow.ToString('o') + '"}')
        $once.Write($receipt,0,$receipt.Length); $once.Flush($true)
    } finally { $once.Dispose() }
} catch {
    foreach ($stream in $locks) { $stream.Dispose() }
    [Console]::Error.WriteLine('EXTENSIONS LAUNCH REFUSED: precondition; credentials=not-read')
    exit 2
}
# No path below this boundary runs during --VerifyOnly or a refusal above.
$signature = @'
using System;
using System.Runtime.InteropServices;
public static class EXTENSIONSCredential {
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
    if (-not [EXTENSIONSCredential]::CredRead('Supabase CLI:supabase',1,0,[ref]$handle)) { Deny 'credential-unavailable' }
    try {
        $credential = [Runtime.InteropServices.Marshal]::PtrToStructure($handle,[Type][EXTENSIONSCredential+CREDENTIAL])
        $bytes = [byte[]]::new($credential.CredentialBlobSize)
        [Runtime.InteropServices.Marshal]::Copy($credential.CredentialBlob,$bytes,0,$bytes.Length)
        $token = [Text.Encoding]::UTF8.GetString($bytes)
        [Array]::Clear($bytes,0,$bytes.Length)
    } finally { [EXTENSIONSCredential]::CredFree($handle) }
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
    $start.ArgumentList.Add((Join-Path $root 'dev-extension-inventory.mjs'))
    $start.ArgumentList.Add('--approval-id'); $start.ArgumentList.Add('founder-DEV-extensions-20261019')
    $start.ArgumentList.Add('--evidence-root'); $start.ArgumentList.Add($EvidenceRoot)
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
    $child = [Diagnostics.Process]::Start($start)
    $token = $null; $start.Environment.Remove('SUPABASE_ACCESS_TOKEN') | Out-Null
    # Capture and discard child text. Only fixed launcher codes reach the terminal.
    $stdoutTask = $child.StandardOutput.ReadToEndAsync(); $stderrTask = $child.StandardError.ReadToEndAsync()
    $child.WaitForExit(); $result = $child.ExitCode
    $null = $stdoutTask.GetAwaiter().GetResult(); $childError = $stderrTask.GetAwaiter().GetResult(); $child.Dispose()
    foreach ($name in $expected) {
        $path = Join-Path $root $name; Assert-Path $path $true
        if ((Digest $path) -cne $manifest.files[$name]) { Deny 'post-child-hash' }
    }
    Assert-Path $EvidenceRoot $true
    if ($result -eq 0) { [Console]::WriteLine('EXTENSIONS INVENTORY COMPLETE; output=projected-and-sanitized') }
    elseif ($childError -cmatch '\AEXTENSION INVENTORY REFUSED: ([a-z-]{1,64})\r?\n?\z') { [Console]::Error.WriteLine('EXTENSIONS INVENTORY REFUSED: ' + $Matches[1]) }
    else { [Console]::Error.WriteLine('EXTENSIONS INVENTORY REFUSED; output=withheld') }
    exit $result
} catch {
    [Console]::Error.WriteLine('EXTENSIONS LAUNCH REFUSED: credential-or-child-error')
    exit 2
} finally { $token = $null; $bytes = $null; foreach ($stream in $locks) { $stream.Dispose() } }
