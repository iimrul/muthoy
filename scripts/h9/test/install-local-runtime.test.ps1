# Focused regression test for the content-addressed staging gate in
# install-local-runtime.ps1. Round 9 found a time-of-check/time-of-use hole
# there and the founder directive of 2026-10-30 requires regression coverage of
# both substitution directions.
#
# NOTHING IS STAGED AND NOTHING IS EXECUTED. Every behavioural case here is a
# refusal case, and the installer raises each one before it creates the
# destination, so the real protected staging directory is never written. The
# fixture lives under the OS temp path, never under audit-artifacts.
#
# Source substitution is covered behaviourally, per file. Destination
# substitution is reachable only through a genuine race between the copy and
# the hash -- a faithful copy cannot make destination differ from source -- so a
# deterministic behavioural case would need either a flaky race or a test-only
# bypass seam in a security script. It is covered instead by assertions on the
# code shape that makes the race non-exploitable: the destination digest check
# exists for every staged name, and nothing runs between the final
# all-or-nothing re-verification and the invocation.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$installer=Join-Path $repo 'scripts/h9/install-local-runtime.ps1'
$checks=0
function Fail([string]$Message){throw ('FAIL '+$Message)}

# ---- parse, and read the reviewed table out of the real installer ----------
$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile($installer,[ref]$null,[ref]$errors)
if($errors -and $errors.Count -gt 0){Fail 'installer does not parse'}
$checks++

$text=[IO.File]::ReadAllText($installer)
$reviewed=@{}
foreach($m in [regex]::Matches($text,"(?m)^\s*'([^']+)'\s*=\s*'([a-f0-9]{64})'\s*$")){$reviewed[$m.Groups[1].Value]=$m.Groups[2].Value}
if($reviewed.Count -ne 8){Fail ('expected 8 reviewed digests, found '+$reviewed.Count)}
$checks++

# ---- the reviewed table must cover exactly what gets staged ----------------
$mapped=@()
foreach($m in [regex]::Matches($text,"(?m)^\s*'[^']+'\s*=\s*'(scripts/[^']+|backend/[^']+)'\s*$")){$mapped+=$m.Groups[1].Value}
$staged=($mapped+'scripts/h9/h9-a5.test.mjs'|Sort-Object -Unique)
$table=($reviewed.Keys|Sort-Object -Unique)
if(Compare-Object $staged $table){Fail 'reviewed digests and staged files are not the same set'}
$checks++

# ---- the manifest must record DESTINATION bytes, not source bytes ----------
# This is the round 9 defect itself: the recorded hash has to come from $target.
if($text -notmatch '\$files\[\$name\]\s*=\s*\(Get-FileHash\s+-LiteralPath\s+\$target'){Fail 'manifest does not record the staged destination hash'}
if($text -match '\$files\[\$name\]\s*=\s*\(Get-FileHash\s+-LiteralPath\s+\$source'){Fail 'manifest records the SOURCE hash -- round 9 regression'}
$checks++

# ---- every staged name is compared against $REVIEWED by its destination ----
if($text -notmatch 'if\s*\(\$files\[\$name\]\s*-cne\s*\$REVIEWED\[\$mapping\[\$name\]\]\)'){Fail 'no per-file destination comparison for mapped files'}
if($text -notmatch 'if\s*\(\$stagedTest\s*-cne\s*\$REVIEWED\['){Fail 'no destination comparison for the separately copied test'}
$checks++

# ---- nothing runs between the final re-verification and the invocation -----
$statements=@($ast.EndBlock.Statements)
$invoke=-1
for($i=0;$i -lt $statements.Count;$i++){if($statements[$i].Extent.Text -match "^&\s*'C:\\Program Files\\PowerShell"){$invoke=$i;break}}
if($invoke -lt 1){Fail 'could not locate the runtime invocation'}
$guard=$statements[$invoke-1]
if($guard -isnot [System.Management.Automation.Language.ForEachStatementAst]){Fail 'the statement before execution is not the all-or-nothing loop'}
if($guard.Extent.Text -notmatch 'Get-FileHash' -or $guard.Extent.Text -notmatch '\$REVIEWED'){Fail 'the pre-execution loop does not compare against the reviewed digests'}
$checks++

# the loop must cover every staged name, test included
if($guard.Extent.Text -notmatch '\$verified\.Keys'){Fail 'the pre-execution loop does not iterate the full staged set'}
if($text -notmatch '\$verified\[''h9-a5\.test\.mjs''\]\s*='){Fail 'the pre-execution set omits the test file'}
$checks++

# ---- behavioural: source substitution, per reviewed file -------------------
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('h9-staging-gate-'+[Guid]::NewGuid().ToString('N'))
try{
  foreach($relative in $reviewed.Keys){
    $target=Join-Path $fixture $relative
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))|Out-Null
    [IO.File]::Copy((Join-Path $repo $relative),$target,$false)
  }
  [IO.Directory]::CreateDirectory((Join-Path $fixture 'scripts/h9'))|Out-Null
  [IO.File]::Copy($installer,(Join-Path $fixture 'scripts/h9/install-local-runtime.ps1'),$true)
  $fixtureInstaller=Join-Path $fixture 'scripts/h9/install-local-runtime.ps1'

  # Non-vacuity, part one: the unmutated fixture bytes really do satisfy the
  # table, so a refusal below is caused by the mutation and not by the fixture.
  foreach($relative in $reviewed.Keys){
    $actual=(Get-FileHash -LiteralPath (Join-Path $fixture $relative) -Algorithm SHA256).Hash.ToLowerInvariant()
    if($actual -cne $reviewed[$relative]){Fail ('fixture bytes do not match the reviewed digest: '+$relative)}
    $checks++
  }

  $destination='C:\Users\Imrul\.muthoy-h9-ws\b8ca5d8\ws1-a5'
  $before=[IO.Directory]::Exists($destination)
  function Run-Installer([string]$Path){
    $start=[Diagnostics.ProcessStartInfo]::new('C:\Program Files\PowerShell\7\pwsh.exe')
    $start.UseShellExecute=$false;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
    $start.ArgumentList.Add('-NoProfile');$start.ArgumentList.Add('-File');$start.ArgumentList.Add($Path)
    $child=[Diagnostics.Process]::Start($start)
    $out=$child.StandardOutput.ReadToEnd();$err=$child.StandardError.ReadToEnd();$child.WaitForExit()
    $code=$child.ExitCode;$child.Dispose()
    return [pscustomobject]@{Code=$code;Text=($out+$err)}
  }

  foreach($relative in $reviewed.Keys|Sort-Object){
    $path=Join-Path $fixture $relative
    $original=[IO.File]::ReadAllBytes($path)
    [IO.File]::AppendAllText($path,' ')
    $result=Run-Installer $fixtureInstaller
    [IO.File]::WriteAllBytes($path,$original)
    if($result.Code -eq 0){Fail ('substituted source admitted: '+$relative)}
    if($result.Text -notmatch 'Refused unreviewed bytes'){Fail ('wrong refusal for '+$relative+': '+$result.Text)}
    # Non-vacuity, part two: the refusal must NAME the file that was mutated.
    # An unconditional throw would always name the first key instead.
    if($result.Text -notmatch [regex]::Escape($relative)){Fail ('refusal does not name the substituted file: '+$relative)}
    $checks++
  }

  if([IO.Directory]::Exists($destination) -ne $before){Fail 'a refusal still created the staging destination'}
  $checks++
}finally{
  if([IO.Directory]::Exists($fixture)){[IO.Directory]::Delete($fixture,$true)}
}
[Console]::WriteLine("INSTALLER STAGING GATE TESTS: $checks PASS; staging=0; execution=0; credentials=0; network=0")
