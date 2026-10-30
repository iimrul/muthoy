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

    # 5c. OPERATIONAL RISK, and the one that would make this fix a regression:
    #     the staged runtime creates an evidence directory and two files INSIDE
    #     the destination. If pinning a directory denied write sharing on it,
    #     those creates would fail and the fix would break the runtime it
    #     protects. Measured rather than assumed.
    $madeFile = $false
    try { [IO.File]::WriteAllText((Join-Path $inner 'evidence.json'),'{}'); $madeFile = $true } catch { $madeFile = $false }
    $results['create FILE inside pinned dir ALLOWED'] = $madeFile
    $madeDir = $false
    try { [IO.Directory]::CreateDirectory((Join-Path $inner 'evidence')) | Out-Null; $madeDir = $true } catch { $madeDir = $false }
    $results['create SUBDIR inside pinned dir ALLOWED'] = $madeDir
    $madeNested = $false
    try { [IO.File]::WriteAllText((Join-Path (Join-Path $inner 'evidence') 'SHA256SUMS'),'x'); $madeNested = $true } catch { $madeNested = $false }
    $results['create file in that SUBDIR ALLOWED'] = $madeNested

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
            # ROUND 13 FINDING 1. This branch lacked the validity check the
            # ordinary file case has. A return of 0 left the resolved name
            # empty, and an empty string is of course unequal to the invoked
            # path -- so a FAILED resolution reported successful junction
            # detection. The most important check in this probe could pass
            # without measuring anything, which is the same defect round 12
            # found in the summary accounting, one branch to the side.
            if ($ln -le 0 -or $ln -ge $buffer) {
                $results['junction DETECTED: resolved != invoked'] = $false
            } else {
                $linkFinal = $lb.ToString(0,[int]$ln)
                $results['junction DETECTED: resolved != invoked'] = ($linkFinal -ine ('\\?\' + $viaLink))
            }
            Write-Output ("    via junction, invoked : " + $viaLink)
            Write-Output ("    via junction, resolved: " + $(if ($ln -gt 0 -and $ln -lt $buffer) { $lb.ToString(0,[int]$ln) } else { '<RESOLUTION FAILED>' }))
        } finally { $linkStream.Dispose() }
    } else {
        $results['junction DETECTED: resolved != invoked'] = 'SKIPPED (could not create a junction)'
    }
} finally {
    if ($stream) { $stream.Dispose() }
    if ($dirHandle -ne $INVALID) { [void][H9PathLockProbe]::CloseHandle($dirHandle) }
    try { [IO.Directory]::Delete($root,$true) } catch {}
}

# ROUND 12 FINDING 1. This summary used to count anything that was not boolean
# false as a pass, so a SKIPPED check -- recorded as a string when the
# environment cannot create a junction -- was reported inside "10/10 checks,
# failures=0". The most important check could be the one that did not run and
# the probe would still claim success. A skip is now counted and reported as a
# skip, and it makes the exit code non-zero: a probe that could not exercise the
# mechanism has not verified it.
Write-Output ''
$passed = 0
$failed = 0
$skipped = 0
foreach ($key in $results.Keys) {
    $value = $results[$key]
    if ($value -is [bool]) {
        if ($value) { $passed++ } else { $failed++ }
        Write-Output (("{0,-45} {1}") -f $key, $(if ($value) { 'PASS' } else { 'FAIL' }))
    } else {
        $skipped++
        Write-Output (("{0,-45} {1}") -f $key, ('SKIP  ' + $value))
    }
}
Write-Output ''
Write-Output ("PATHLOCK PROBE: " + $passed + " passed, " + $skipped + " skipped, " + $failed + " failed, of " + $results.Count)
if ($skipped -gt 0) { Write-Output 'INCOMPLETE: a skipped check means the mechanism was NOT fully verified here.' }
exit ($failed + $skipped)
