# Isolated probe for the ROUND 11 HIGH 1 mechanism. Touches only a fresh temp
# directory. Nothing in the repository, and nothing in the real H-9 staging
# directory, is read or written.
# Importers/callers: none. Affected API: none. Data schemas: none.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class H9PathLockProbe {
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
 public static extern IntPtr CreateFileW(string path,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template);
 [DllImport("kernel32.dll",SetLastError=true)]
 public static extern bool CloseHandle(IntPtr handle);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
 public static extern uint GetFinalPathNameByHandleW(IntPtr handle,StringBuilder path,uint size,uint flags);
}
'@

$GENERIC_READ = [uint32]2147483648
$SHARE_READ = [uint32]1
$OPEN_EXISTING = [uint32]3
$BACKUP_SEMANTICS = [uint32]33554432
$INVALID = [IntPtr](-1)

$root = Join-Path ([IO.Path]::GetTempPath()) ('pathlock-' + [Guid]::NewGuid().ToString('N'))
$inner = Join-Path $root 'ws1-a5'
[IO.Directory]::CreateDirectory($inner) | Out-Null
$file = Join-Path $inner 'a5-with-token.ps1'
[IO.File]::WriteAllText($file, "# probe`n")

$results = [ordered]@{}
$dirHandle = $INVALID
$stream = $null
try {
    # 1. Can a directory be pinned at all?
    $dirHandle = [H9PathLockProbe]::CreateFileW($inner,$GENERIC_READ,$SHARE_READ,[IntPtr]::Zero,$OPEN_EXISTING,$BACKUP_SEMANTICS,[IntPtr]::Zero)
    $results['directory handle opened'] = ($dirHandle -ne $INVALID)

    # 2. The FILE handle comes first, and the order matters. My first version of
    #    this probe ran a recursive directory delete before opening the file:
    #    the delete removed the FILE and only then failed on the pinned
    #    directory. That is worth recording rather than smoothing over -- a
    #    directory pin protects that directory OBJECT, not its children. The
    #    installer holds handles on both, which is why both are covered there.
    $stream = [IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    $written = $false
    try { [IO.File]::WriteAllText($file,'tampered'); $written = $true } catch { $written = $false }
    $results['file write REFUSED while held'] = (-not $written)
    $unlinked = $false
    try { [IO.File]::Delete($file); $unlinked = $true } catch { $unlinked = $false }
    $results['file delete REFUSED while held'] = (-not $unlinked)

    # 5. Does GetFinalPathNameByHandle resolve to the expected path?
    $buffer = 32768
    $resolved = [Text.StringBuilder]::new($buffer)
    $n = [H9PathLockProbe]::GetFinalPathNameByHandleW($stream.SafeFileHandle.DangerousGetHandle(),$resolved,[uint32]$buffer,[uint32]0)
    $results['final path resolved'] = ($n -gt 0 -and $n -lt $buffer)
    $final = if ($n -gt 0 -and $n -lt $buffer) { $resolved.ToString(0,[int]$n) } else { '' }
    $expected = '\\?\' + $file
    $results['final path EQUALS the invoked path'] = ($final -ne '' -and $final -ieq $expected)
    Write-Output ("    resolved : " + $final)
    Write-Output ("    expected : " + $expected)

    # 5b. NOW the directory pin, with the file handle already held: the pinned
    #     directory must not be renameable or removable, which is what stops the
    #     path being re-pointed after it is checked.
    $renamed = $false
    try { [IO.Directory]::Move($inner,(Join-Path $root 'moved')); $renamed = $true } catch { $renamed = $false }
    $results['pinned dir rename REFUSED'] = (-not $renamed)

    $spare = Join-Path $root 'spare'
    [IO.Directory]::CreateDirectory($spare) | Out-Null
    $spareHandle = [H9PathLockProbe]::CreateFileW($spare,$GENERIC_READ,$SHARE_READ,[IntPtr]::Zero,$OPEN_EXISTING,$BACKUP_SEMANTICS,[IntPtr]::Zero)
    $results['second dir handle opened'] = ($spareHandle -ne $INVALID)
    $removed = $false
    try { [IO.Directory]::Delete($spare); $removed = $true } catch { $removed = $false }
    $results['pinned dir delete REFUSED'] = (-not $removed)
    $results['pinned dir still present'] = [IO.Directory]::Exists($spare)
    if ($spareHandle -ne $INVALID) { [void][H9PathLockProbe]::CloseHandle($spareHandle) }

    # 6. And a junction's handle must resolve somewhere ELSE, which is the
    #    redirection this check is meant to catch.
    $elsewhere = Join-Path $root 'elsewhere'
    [IO.Directory]::CreateDirectory($elsewhere) | Out-Null
    [IO.File]::WriteAllText((Join-Path $elsewhere 'a5-with-token.ps1'), "# impostor`n")
    $link = Join-Path $root 'link'
    $made = $false
    try { $null = New-Item -ItemType Junction -Path $link -Target $elsewhere -ErrorAction Stop; $made = $true } catch { $made = $false }
    if ($made) {
        $viaLink = Join-Path $link 'a5-with-token.ps1'
        $linkStream = [IO.File]::Open($viaLink,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
        try {
            $lb = [Text.StringBuilder]::new($buffer)
            $ln = [H9PathLockProbe]::GetFinalPathNameByHandleW($linkStream.SafeFileHandle.DangerousGetHandle(),$lb,[uint32]$buffer,[uint32]0)
            $linkFinal = $lb.ToString(0,[int]$ln)
            $results['junction DETECTED: resolved != invoked'] = ($linkFinal -ine ('\\?\' + $viaLink))
            Write-Output ("    via junction, invoked : " + $viaLink)
            Write-Output ("    via junction, resolved: " + $linkFinal)
        } finally { $linkStream.Dispose() }
    } else {
        $results['junction DETECTED: resolved != invoked'] = 'SKIPPED (could not create a junction)'
    }
} finally {
    if ($stream) { $stream.Dispose() }
    if ($dirHandle -ne $INVALID) { [void][H9PathLockProbe]::CloseHandle($dirHandle) }
    try { [IO.Directory]::Delete($root,$true) } catch {}
}

Write-Output ''
$failed = 0
foreach ($key in $results.Keys) {
    $value = $results[$key]
    if ($value -is [bool]) {
        if (-not $value) { $failed++ }
        Write-Output (("{0,-45} {1}") -f $key, $(if ($value) { 'PASS' } else { 'FAIL' }))
    } else {
        Write-Output (("{0,-45} {1}") -f $key, $value)
    }
}
Write-Output ''
Write-Output ("PATHLOCK PROBE: " + ($results.Count - $failed) + "/" + $results.Count + " checks, failures=" + $failed)
exit $failed
