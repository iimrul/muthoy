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
# Source substitution is covered behaviourally, per file, and the refusal must
# be SPECIFIC to the file that was substituted -- see the loop below.
#
# Destination substitution. I first wrote that this was reachable only through a
# genuine race, and ROUND 10 corrected me: it is not. A caller-scoped
# `Get-FileHash` wrapper can return the real digest and then mutate the fixture
# source immediately after the last source hash, so the unchanged installer
# copies the changed bytes and reaches its destination-mismatch branch with no
# race and no production-code bypass. That correction is accepted.
#
# It is still not executed HERE, for a different and narrower reason: the
# technique needs the installer dot-sourced into the test's own session, and the
# installer's destination is pinned to the real protected H-9 staging directory,
# so running it would write to sealed custody. Exercising it safely needs a
# fixture copy whose destination constant is changed, which is a transformation
# of the file under test. That is recorded as the honest limitation instead of
# the false claim it replaces.
#
# So the destination branch is pinned here by assertions on the code shape that
# makes it reachable at all: the digest check exists for every staged name, the
# recorded manifest uses the destination hash and not the source hash, and the
# bytes are held open against write and delete through execution.
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

# ---- the executed bytes are PINNED, not re-measured ------------------------
# ROUND 10 FINDING 1. A rehash loop before the invocation cannot close a
# same-owner window: each rehash releases the file again, so the launcher can be
# replaced after its own digest is taken. The guarantee therefore rests on held
# handles, and these assertions pin that rather than the old loop shape.

# 1. Every staged file is opened denying write AND delete before it is hashed.
if($text -notmatch '\[IO\.File\]::Open\(\$path,\[IO\.FileMode\]::Open,\[IO\.FileAccess\]::Read,\[IO\.FileShare\]::Read\)'){Fail 'staged files are not opened with FileShare.Read before hashing'}
if($text -match '\[IO\.FileShare\]::(ReadWrite|Write|Delete)'){Fail 'a staged handle permits write or delete'}
$checks++

# 2. The pre-execution digest is computed FROM the held stream, so the bytes
#    measured are provably the bytes the handle protects.
if($text -notmatch 'ComputeHash\(\$stream\)'){Fail 'the pre-execution digest is not computed from the held handle'}
$checks++

# 3. The invocation sits inside the try that holds the handles, and the dispose
#    is in that try's finally -- so the handles outlive the child.
$tryAst=$ast.Find({param($node) $node -is [System.Management.Automation.Language.TryStatementAst] -and $node.Body.Extent.Text -match 'pwsh\.exe'},$true)
if(-not $tryAst){Fail 'the invocation is not inside a try that holds the staged handles'}
if($tryAst.Body.Extent.Text -notmatch '\$handles\.Add\('){Fail 'the handle-holding try does not open the handles'}
if(-not $tryAst.Finally -or $tryAst.Finally.Extent.Text -notmatch '\$handle\.Dispose\(\)'){Fail 'the handles are not disposed in the finally'}
$checks++

# 4. The held set covers every staged file, the separately copied test included.
if($text -notmatch '\$names\s*=\s*@\(\$verified\.Keys'){Fail 'the pinned set does not iterate the full staged set'}
if($text -notmatch '\$verified\[''h9-a5\.test\.mjs''\]\s*='){Fail 'the pinned set omits the test file'}
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
    # Non-vacuity, part two: the refusal must name the file that was mutated...
    if($result.Text -notmatch [regex]::Escape($relative)){Fail ('refusal does not name the substituted file: '+$relative)}
    # ...AND NAME NO OTHER. ROUND 10 FINDING 3: naming the mutated file alone
    # was not enough. The reviewer defeated it with one unconditional throw that
    # names every candidate -- `throw ('Refused unreviewed bytes: ' +
    # ($REVIEWED.Keys -join ', '))` satisfied all eight cases at once. A gate
    # that refuses everything is not a gate, so the refusal must be SPECIFIC.
    foreach($other in $reviewed.Keys){
      if($other -ceq $relative){continue}
      if($result.Text -match [regex]::Escape($other)){Fail ('refusal names a file that was NOT substituted: '+$other+' while testing '+$relative)}
    }
    $checks++
  }

  if([IO.Directory]::Exists($destination) -ne $before){Fail 'a refusal still created the staging destination'}
  $checks++
}finally{
  if([IO.Directory]::Exists($fixture)){[IO.Directory]::Delete($fixture,$true)}
}
[Console]::WriteLine("INSTALLER STAGING GATE TESTS: $checks PASS; staging=0; execution=0; credentials=0; network=0")
