# Credential-free, download-free controls for new-download-staging.ps1.
# Downloads are SIMULATED by writing synthetic files into the staging tree; the CLI is
# never invoked and nothing hosted is contacted. Proves the sequential sync ->
# auth-send-sms state machine, the staging security gate, and that repository function
# sources are byte-identical before and after every refusal.
[CmdletBinding()]
param([string]$TestRoot)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repo = [IO.Path]::GetFullPath([IO.Path]::Combine($PSScriptRoot, '..', '..', '..'))
$stagingScript = [IO.Path]::Combine($repo, 'scripts', 'h9', 'new-download-staging.ps1')
if (-not [IO.File]::Exists($stagingScript)) { throw 'Missing staging script.' }
if (-not $TestRoot) { $TestRoot = [IO.Path]::Combine([Environment]::GetFolderPath('UserProfile'), '.muthoy-h9-staging-tests-' + [Guid]::NewGuid().ToString('N')) }
$testRoot = [IO.Path]::GetFullPath($TestRoot)
if ([IO.Directory]::Exists($testRoot)) { throw 'Fixture root must be new.' }
[IO.Directory]::CreateDirectory($testRoot) | Out-Null

$ownerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$trusted = @($ownerSid, 'S-1-5-18', 'S-1-5-32-544')
$protectedRuntime = 'C:\Users\Imrul\.muthoy-h9-ws\b8ca5d8\ws1-a5'
$devRef = 'btfprhticjgeihcngpif'
$cliSha = '442c83f7d455edc0462e94e22d60c9f7f05783fc83d39a0f49dadc78a914a1dd'

# The real pinned CLI if present. Without it the CLI-gated stages cannot run at all,
# so the suite reports UNVERIFIED instead of PASS.
# Named $pinnedCli, not $cli: PowerShell variable names are case-insensitive, so a
# script-level $cli would be shadowed by the helpers' own [string]$Cli parameter.
$pinnedCli = $null
foreach ($candidate in @(Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'pnpm\store\v11\links\@supabase\cli-windows-x64\2.117.0') -Recurse -Filter 'supabase.exe' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)) {
    if ((Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant() -ceq $cliSha) { $pinnedCli = $candidate; break }
}

$guardedSources = @(
    [IO.Path]::Combine($repo, 'backend', 'supabase', 'functions', 'sync', 'index.ts'),
    [IO.Path]::Combine($repo, 'backend', 'supabase', 'functions', 'auth-send-sms', 'index.ts'),
    [IO.Path]::Combine($repo, 'backend', 'supabase', 'config.toml')
)
$baseline = [ordered]@{}
foreach ($path in $guardedSources) {
    if (-not [IO.File]::Exists($path)) { throw "Guarded source missing: $path" }
    $baseline[$path] = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
}

$checks = 0
$unverified = @()
function Check([bool]$Condition, [string]$Name) {
    if (-not $Condition) { throw "FAILED: $Name" }
    $script:checks++
    [Console]::WriteLine("  ok  $Name")
}
function Unverified([string]$Name, [string]$Reason) {
    $script:unverified += "$Name ($Reason)"
    [Console]::WriteLine("  UNVERIFIED  $Name -- $Reason")
}

Add-Type @'
using System; using System.Runtime.InteropServices;
public static class H9StageFixture {
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode)] public static extern uint SetNamedSecurityInfo(string p,uint t,uint i,IntPtr o,IntPtr g,IntPtr d,IntPtr s);
}
'@
function Assert-InTestRoot([string]$Path) {
    if ($Path -ne $testRoot -and -not $Path.StartsWith($testRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Fixture target outside test root.' }
}
# 0x80000004 = PROTECTED_DACL | DACL (forces protection on).
# 0x20000004 = UNPROTECTED_DACL | DACL (clears protection so inheritance resumes).
function Set-FixtureAcl([string]$Path, $Acl, [uint32]$Info = 2147483652) {
    Assert-InTestRoot $Path
    $raw = [Security.AccessControl.RawSecurityDescriptor]::new($Acl.GetSecurityDescriptorBinaryForm(), 0)
    $bytes = [byte[]]::new($raw.DiscretionaryAcl.BinaryLength)
    $raw.DiscretionaryAcl.GetBinaryForm($bytes, 0)
    $pointer = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
    try {
        [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $pointer, $bytes.Length)
        if ([H9StageFixture]::SetNamedSecurityInfo($Path, 1, $Info, [IntPtr]::Zero, [IntPtr]::Zero, $pointer, [IntPtr]::Zero) -ne 0) { throw 'Fixture DACL update failed' }
    } finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($pointer) }
}
function Set-FixtureOwner([string]$Path, [string]$Sid) {
    Assert-InTestRoot $Path
    $identifier = [Security.Principal.SecurityIdentifier]::new($Sid)
    $bytes = [byte[]]::new($identifier.BinaryLength)
    $identifier.GetBinaryForm($bytes, 0)
    $pointer = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
    try {
        [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $pointer, $bytes.Length)
        # OWNER_SECURITY_INFORMATION only; never touches the DACL or audit policy.
        return [H9StageFixture]::SetNamedSecurityInfo($Path, 1, [uint32]1, $pointer, [IntPtr]::Zero, [IntPtr]::Zero, [IntPtr]::Zero)
    } finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($pointer) }
}

function Invoke-Staging {
    param([string[]]$Arguments)
    $start = [Diagnostics.ProcessStartInfo]::new('C:\Program Files\PowerShell\7\pwsh.exe')
    $start.UseShellExecute = $false
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    foreach ($argument in @('-NoProfile', '-File', $stagingScript) + $Arguments) { $start.ArgumentList.Add($argument) }
    $child = [Diagnostics.Process]::Start($start)
    $stdout = $child.StandardOutput.ReadToEnd()
    $stderr = $child.StandardError.ReadToEnd()
    $child.WaitForExit()
    $code = $child.ExitCode
    $child.Dispose()
    return [pscustomobject]@{ Code = $code; Out = $stdout; Err = $stderr }
}
function Stage {
    param([string]$Root, [string]$StageName, [string]$SlugName = '', [string]$Cli = '')
    $useCli = if ($Cli) { $Cli } else { $pinnedCli }
    $arguments = @('-StagingRoot', $Root, '-Stage', $StageName, '-CliPath', $useCli)
    if ($SlugName) { $arguments += @('-Slug', $SlugName) }
    return Invoke-Staging $arguments
}
function Assert-Refused {
    param([string]$Reason, [string]$Name, [string]$Root, [string]$StageName = 'pre-download', [string]$SlugName = '', [string]$Cli = '')
    $result = Stage -Root $Root -StageName $StageName -SlugName $SlugName -Cli $Cli
    $refused = $result.Code -eq 2 -and $result.Err.Contains("STAGING REFUSED: h9-staging-$Reason")
    $quiet = $result.Err.Contains('credentials=not-read') -and $result.Err.Contains('downloads=0')
    if (-not $refused) { [Console]::Error.WriteLine('  got: ' + $result.Err.Trim()) }
    Check ($refused -and $quiet) "$Name -> $Reason"
}

# --- synthetic download helpers (no CLI, no network) ------------------------
function New-Root([string]$Name) { return [IO.Path]::Combine($testRoot, $Name) }
function Add-Scaffolding([string]$Root) {
    $temp = [IO.Path]::Combine($Root, 'supabase', '.temp')
    [IO.Directory]::CreateDirectory($temp) | Out-Null
    [IO.File]::WriteAllText([IO.Path]::Combine($temp, 'cli-latest'), 'v2.117.0')
    [IO.File]::WriteAllText([IO.Path]::Combine($temp, 'project-ref'), $devRef)
}
function Add-ConfigSection([string]$Root, [string]$SlugName) {
    $config = [IO.Path]::Combine($Root, 'supabase', 'config.toml')
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($config)) | Out-Null
    [IO.File]::AppendAllLines($config, [string[]]@(
            "[functions.$SlugName]",
            'enabled = true',
            'verify_jwt = false',
            "import_map = `"./functions/$SlugName/deno.json`"",
            "entrypoint = `"./functions/$SlugName/index.ts`""
        ))
}
function Add-Download([string]$Root, [string]$SlugName, [bool]$WithEntrypoint = $true) {
    $dir = [IO.Path]::Combine($Root, 'supabase', 'functions', $SlugName)
    [IO.Directory]::CreateDirectory($dir) | Out-Null
    if ($WithEntrypoint) { [IO.File]::WriteAllText([IO.Path]::Combine($dir, 'index.ts'), "// synthetic deployed source for $SlugName") }
    [IO.File]::WriteAllText([IO.Path]::Combine($dir, 'deno.json'), '{"imports":{}}')
    Add-ConfigSection $Root $SlugName
}
function New-Provisioned([string]$Name) {
    $root = New-Root $Name
    $result = Stage -Root $root -StageName 'provision'
    if ($result.Code -ne 0) { throw "provision failed for ${Name}: $($result.Err)" }
    Add-Scaffolding $root
    return $root
}
function New-SyncRecorded([string]$Name) {
    $root = New-Provisioned $Name
    Add-Download $root 'sync'
    $result = Stage -Root $root -StageName 'post-download' -SlugName 'sync'
    if ($result.Code -ne 0) { throw "sync record failed for ${Name}: $($result.Err)" }
    return $root
}

if (-not $pinnedCli) {
    Unverified 'pinned CLI present' 'supabase.exe 2.117.0 with the pinned hash was not found; every CLI-gated stage is unexercised'
    [Console]::WriteLine("STAGING TESTS: $checks PASS; UNVERIFIED=$($unverified.Count); credentials retrieved=0; downloads=0; network=0")
    exit 3
}

[Console]::WriteLine('-- 0. TOML parser unit table --')
# The validators are extracted from the staging script by AST and exercised directly, the
# same technique launcher.test.ps1 uses, so the table runs without a staging root each.
$stagingAst = [System.Management.Automation.Language.Parser]::ParseFile($stagingScript, [ref]$null, [ref]$null)
function Get-StagingFunction([string]$FunctionName) {
    $found = $stagingAst.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $FunctionName }, $true)
    if (-not $found) { throw "Staging script is missing function $FunctionName" }
    return $found.Extent.Text
}
# The dependencies the extracted validators close over, with the script's own contract.
function Deny([string]$Code) { throw "h9-staging-$Code" }
$absolute = [IO.Path]::Combine($testRoot, 'parser-root')
$functionsDir = [IO.Path]::Combine($absolute, 'supabase', 'functions')
foreach ($extracted in @('Test-Inside', 'Convert-TomlCodePoint', 'Read-TomlString', 'Assert-RelativeInsideFunctions')) {
    . ([scriptblock]::Create((Get-StagingFunction $extracted)))
}
function Test-PathValue([string]$RawValue) { Assert-RelativeInsideFunctions (Read-TomlString $RawValue) }
function Assert-Parser([string]$Raw, [string]$Expect, [string]$Name) {
    $outcome = 'accept'
    try { Test-PathValue $Raw } catch { $outcome = $_.Exception.Message -replace '^h9-staging-', '' }
    if ($outcome -ne $Expect) { [Console]::Error.WriteLine("  got: $outcome") }
    Check ($outcome -eq $Expect) "parser[$Expect] $Name"
}
foreach ($case in @(
        # the two original path witnesses, straight through the parser
        @{ raw = "'D:\Muthoy\backend\supabase\functions\sync\index.ts'"; expect = 'config-path-escape'; name = 'witness 1: literal absolute' }
        @{ raw = '"D:/Muthoy/backend/supabase/functions/sync/index.ts"'; expect = 'config-path-escape'; name = 'witness 2: basic forward-slash absolute' }
        # the two escape witnesses
        @{ raw = '"\q"'; expect = 'config-escape'; name = 'unsupported escape \q' }
        @{ raw = '"\/"'; expect = 'config-escape'; name = 'unsupported escape \/ (JSON-only)' }
        # every supported escape, decoding to a legitimate relative path
        @{ raw = '"./functions/auth-send-sms/index.ts"'; expect = 'accept'; name = 'plain relative' }
        @{ raw = '".\\functions\\auth-send-sms\\index.ts"'; expect = 'accept'; name = 'supported \\' }
        @{ raw = '"./functions/auth-send-sms/\u0069ndex.ts"'; expect = 'accept'; name = 'supported \uXXXX decodes to i' }
        @{ raw = '"./functions/auth-send-sms/\U00000069ndex.ts"'; expect = 'accept'; name = 'supported \UXXXXXXXX decodes to i' }
        @{ raw = '"./functions/au\u0074h-send-sms/index.ts"'; expect = 'accept'; name = 'supported \u0074 decodes to t' }
        # supported escapes whose decoded value must still be refused
        @{ raw = '"\u002e\u002e/sync/index.ts"'; expect = 'config-path-escape'; name = '\u002e\u002e decodes to a traversal' }
        @{ raw = '"./functions/\u002E\u002E/\u002E\u002E/seed.sql"'; expect = 'config-path-escape'; name = 'uppercase-hex traversal' }
        @{ raw = '"\u0044:/Muthoy/x.ts"'; expect = 'config-path-escape'; name = '\u0044 decodes to a drive prefix' }
        @{ raw = '"./functions/auth-send-sms/\tindex.ts"'; expect = 'config-path-escape'; name = 'supported \t is a control character' }
        @{ raw = '"./functions/auth-send-sms/index.ts\n"'; expect = 'config-path-escape'; name = 'supported \n is a control character' }
        @{ raw = '"\b"'; expect = 'config-path-escape'; name = 'supported \b is a control character' }
        @{ raw = '"\f"'; expect = 'config-path-escape'; name = 'supported \f is a control character' }
        @{ raw = '"\r"'; expect = 'config-path-escape'; name = 'supported \r is a control character' }
        @{ raw = '"\U0010FFFF"'; expect = 'config-path-escape'; name = 'maximum scalar decodes, then fails containment' }
        @{ raw = '"\""'; expect = 'config-path-escape'; name = 'supported \" decodes, then fails containment' }
        # malformed unicode escapes and invalid scalar values
        @{ raw = '"\u00"'; expect = 'config-escape'; name = '\u with too few digits' }
        @{ raw = '"\uZZZZ"'; expect = 'config-escape'; name = '\u with non-hex digits' }
        @{ raw = '"\U0000"'; expect = 'config-escape'; name = '\U with too few digits' }
        @{ raw = '"\U00110000"'; expect = 'config-escape'; name = 'scalar just above U+10FFFF' }
        @{ raw = '"\UFFFFFFFF"'; expect = 'config-escape'; name = 'scalar far above U+10FFFF' }
        @{ raw = '"\ud800"'; expect = 'config-escape'; name = 'low lone surrogate' }
        @{ raw = '"\udfff"'; expect = 'config-escape'; name = 'high lone surrogate' }
        # other unsupported sequences
        @{ raw = '"\x41"'; expect = 'config-escape'; name = 'hex escape \x' }
        @{ raw = '"\0"'; expect = 'config-escape'; name = 'null escape \0' }
        @{ raw = '"\e"'; expect = 'config-escape'; name = 'escape escape \e' }
        @{ raw = '"\a"'; expect = 'config-escape'; name = 'bell escape \a' }
        @{ raw = '"\N"'; expect = 'config-escape'; name = 'uppercase \N is not \n' }
        @{ raw = '"\T"'; expect = 'config-escape'; name = 'uppercase \T is not \t' }
        # literal strings interpret no escapes at all
        @{ raw = "'C:\q\path'"; expect = 'config-path-escape'; name = 'literal \q stays text, drive prefix still caught' }
        @{ raw = "'..\sync\index.ts'"; expect = 'config-path-escape'; name = 'literal traversal' }
        @{ raw = "'functions/auth-send-sms/index.ts'"; expect = 'accept'; name = 'literal relative' }
        @{ raw = "'.\functions\auth-send-sms\index.ts'"; expect = 'accept'; name = 'literal backslash relative' }
        @{ raw = "'./functions/auth-send-sms/\u0069ndex.ts'"; expect = 'accept'; name = 'literal \u is text, not decoded' }
        # syntax
        @{ raw = './functions/auth-send-sms/index.ts'; expect = 'config-syntax'; name = 'unquoted value' }
        @{ raw = '"./functions/auth-send-sms/index.ts'; expect = 'config-syntax'; name = 'unterminated basic string' }
        @{ raw = "'./functions/auth-send-sms/index.ts"; expect = 'config-syntax'; name = 'unterminated literal string' }
        @{ raw = '"""./functions/auth-send-sms/index.ts"""'; expect = 'config-syntax'; name = 'multi-line basic string' }
        @{ raw = "'''./functions/auth-send-sms/index.ts'''"; expect = 'config-syntax'; name = 'multi-line literal string' }
        @{ raw = '"./functions/auth-send-sms/index.ts" oops'; expect = 'config-syntax'; name = 'junk after the closing quote' }
        @{ raw = '"./functions/auth-send-sms/index.ts" # fine'; expect = 'accept'; name = 'inline comment after the value' }
        @{ raw = '"\"'; expect = 'config-syntax'; name = 'escaped quote leaves the string unterminated' }
        @{ raw = ('"a' + [char]0x0B + 'b"'); expect = 'config-syntax'; name = 'raw control character' }
        @{ raw = '""'; expect = 'config-path-escape'; name = 'empty string' }
    )) { Assert-Parser $case.raw $case.expect $case.name }

[Console]::WriteLine('-- 1. full sequential capture --')
$main = New-Root 'capture'
$provision = Stage -Root $main -StageName 'provision'
Check ($provision.Code -eq 0 -and $provision.Out.Contains('STAGING PROVISIONED')) 'provision creates the fresh private root'
$receipt = Get-Content -LiteralPath ([IO.Path]::Combine($main, 'staging-receipt.json')) -Raw | ConvertFrom-Json
Check ($receipt.version -eq 2 -and (@($receipt.order) -join ',') -eq 'sync,auth-send-sms') 'receipt records order sync,auth-send-sms'
Check ($receipt.functionsDir -ieq [IO.Path]::Combine($main, 'supabase', 'functions')) 'receipt names <root>\supabase\functions as the destination'
Check ($receipt.cliSha256 -eq $cliSha -and $receipt.cliPath -ieq $pinnedCli) 'receipt pins the CLI path and hash'
Check (@($receipt.completed).Count -eq 0) 'nothing recorded yet'

$acl = Get-Acl -LiteralPath $main
$untrustedRules = @($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]) | Where-Object { $_.IdentityReference.Value -notin $trusted })
Check ($acl.AreAccessRulesProtected -and $untrustedRules.Count -eq 0 -and $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $ownerSid) 'staging root is owner-owned with a protected trusted-only DACL'

Add-Scaffolding $main
$preSync = Stage -Root $main -StageName 'pre-download' -SlugName 'sync'
Check ($preSync.Code -eq 0 -and $preSync.Out.Contains('STAGE READY: sync; position=1/2')) 'gate opens for sync first'
Add-Download $main 'sync'
$postSync = Stage -Root $main -StageName 'post-download' -SlugName 'sync'
Check ($postSync.Code -eq 0 -and $postSync.Out.Contains('STAGE RECORDED: sync; files=2')) 'sync files verified and recorded'
$preAuth = Stage -Root $main -StageName 'pre-download' -SlugName 'auth-send-sms'
Check ($preAuth.Code -eq 0 -and $preAuth.Out.Contains('STAGE READY: auth-send-sms; position=2/2')) 'gate opens for auth-send-sms second'
Add-Download $main 'auth-send-sms'
$postAuth = Stage -Root $main -StageName 'post-download' -SlugName 'auth-send-sms'
Check ($postAuth.Code -eq 0 -and $postAuth.Out.Contains('STAGE RECORDED: auth-send-sms; files=2')) 'auth-send-sms verified and recorded'
$complete = Stage -Root $main -StageName 'complete'
Check ($complete.Code -eq 0 -and $complete.Out.Contains('STAGING COMPLETE; slugs=sync,auth-send-sms')) 'complete emits the final manifest'
$manifest = ($complete.Out -split "`n" | Where-Object { $_.Trim().StartsWith('{') } | Select-Object -First 1) | ConvertFrom-Json
Check (@($manifest.files).Count -eq 4) 'manifest carries every recorded file with its hash'
Check (@($manifest.files | Where-Object { $_.sha256 -notmatch '^[a-f0-9]{64}$' }).Count -eq 0) 'every manifest hash is a sha256'

[Console]::WriteLine('-- 2. repeated and out-of-order downloads --')
Assert-Refused 'stage-repeat' 'sync again after both recorded' $main 'pre-download' 'sync'
Assert-Refused 'stage-repeat' 'auth-send-sms again after both recorded' $main 'post-download' 'auth-send-sms'
$fresh = New-Provisioned 'order-fresh'
Assert-Refused 'stage-order' 'auth-send-sms before sync' $fresh 'pre-download' 'auth-send-sms'
$early = New-Provisioned 'order-early'
Add-Download $early 'auth-send-sms'
Assert-Refused 'stage-order' 'auth-send-sms downloaded during the sync turn' $early 'pre-download' 'sync'
$halfway = New-SyncRecorded 'order-halfway'
Assert-Refused 'stage-repeat' 'repeat sync after it was recorded' $halfway 'pre-download' 'sync'
$overwrite = New-Provisioned 'order-overwrite'
Add-Download $overwrite 'sync'
Assert-Refused 'destination-exists' 'sync downloaded twice before recording' $overwrite 'pre-download' 'sync'
$empty = New-Provisioned 'order-empty'
Assert-Refused 'download-missing' 'post-download with nothing downloaded' $empty 'post-download' 'sync'
$noEntry = New-Provisioned 'order-noentry'
Add-Download $noEntry 'sync' $false
Assert-Refused 'entrypoint-missing' 'download without index.ts' $noEntry 'post-download' 'sync'
Assert-Refused 'stage-incomplete' 'complete before both slugs' $halfway 'complete'
Assert-Refused 'slug-required' 'pre-download without a slug' $fresh 'pre-download'
Assert-Refused 'slug-unexpected' 'complete with a slug' $main 'complete' 'sync'
Assert-Refused 'slug-unexpected' 'unknown slug requested' $fresh 'pre-download' 'payment-webhook'

[Console]::WriteLine('-- 3. modified first-function files --')
$tamper = New-SyncRecorded 'tamper-change'
[IO.File]::WriteAllText([IO.Path]::Combine($tamper, 'supabase', 'functions', 'sync', 'index.ts'), '// tampered after recording')
Assert-Refused 'recorded-file-changed' 'sync source modified after recording' $tamper 'pre-download' 'auth-send-sms'
$removed = New-SyncRecorded 'tamper-remove'
[IO.File]::Delete([IO.Path]::Combine($removed, 'supabase', 'functions', 'sync', 'deno.json'))
Assert-Refused 'recorded-file-missing' 'recorded sync file deleted' $removed 'pre-download' 'auth-send-sms'
$extra = New-SyncRecorded 'tamper-extra'
[IO.File]::WriteAllText([IO.Path]::Combine($extra, 'supabase', 'functions', 'sync', 'injected.ts'), '// injected')
Assert-Refused 'recorded-slug-extra-file' 'file injected into a recorded slug' $extra 'pre-download' 'auth-send-sms'
$completeTamper = New-SyncRecorded 'tamper-complete'
Add-Download $completeTamper 'auth-send-sms'
$null = Stage -Root $completeTamper -StageName 'post-download' -SlugName 'auth-send-sms'
[IO.File]::WriteAllText([IO.Path]::Combine($completeTamper, 'supabase', 'functions', 'sync', 'index.ts'), '// tampered before complete')
Assert-Refused 'recorded-file-changed' 'sync modified before complete' $completeTamper 'complete'

[Console]::WriteLine('-- 4. scaffolding must be exactly as expected --')
$slugDir = New-SyncRecorded 'scaffold-slug'
[IO.Directory]::CreateDirectory([IO.Path]::Combine($slugDir, 'supabase', 'functions', 'payment-webhook')) | Out-Null
Assert-Refused 'unexpected-slug' 'unexpected slug directory' $slugDir 'pre-download' 'auth-send-sms'
$strayTop = New-SyncRecorded 'scaffold-top'
[IO.File]::WriteAllText([IO.Path]::Combine($strayTop, 'notes.txt'), 'stray')
Assert-Refused 'unexpected-entry' 'stray file at the staging root' $strayTop 'pre-download' 'auth-send-sms'
$straySupabase = New-SyncRecorded 'scaffold-supabase'
[IO.File]::WriteAllText([IO.Path]::Combine($straySupabase, 'supabase', 'seed.sql'), 'select 1;')
Assert-Refused 'unexpected-entry' 'stray file under supabase' $straySupabase 'pre-download' 'auth-send-sms'
$strayTemp = New-SyncRecorded 'scaffold-temp'
[IO.File]::WriteAllText([IO.Path]::Combine($strayTemp, 'supabase', '.temp', 'payload.bin'), 'x')
Assert-Refused 'unexpected-temp' 'unexpected file in .temp' $strayTemp 'pre-download' 'auth-send-sms'
$foreignRef = New-SyncRecorded 'scaffold-foreignref'
[IO.File]::WriteAllText([IO.Path]::Combine($foreignRef, 'supabase', '.temp', 'project-ref'), 'jwjrijvprbsndukfhlvf')
Assert-Refused 'temp-foreign-ref' 'staging linked to a foreign project' $foreignRef 'pre-download' 'auth-send-sms'

[Console]::WriteLine('-- 5. config.toml is validated, not exempted --')
$foreignSlug = New-SyncRecorded 'config-foreignslug'
[IO.File]::AppendAllLines([IO.Path]::Combine($foreignSlug, 'supabase', 'config.toml'), [string[]]@('[functions.payment-webhook]', 'enabled = true'))
Assert-Refused 'config-foreign-slug' 'config section for a foreign slug' $foreignSlug 'pre-download' 'auth-send-sms'
$escape = New-SyncRecorded 'config-escape'
# Unescaped backslashes are invalid TOML, so this is refused as a bad escape, not as a
# path. The properly escaped absolute form is covered in the bypass table below.
[IO.File]::AppendAllLines([IO.Path]::Combine($escape, 'supabase', 'config.toml'), [string[]]@('[functions.auth-send-sms]', 'entrypoint = "D:\Muthoy\backend\supabase\functions\sync\index.ts"'))
Assert-Refused 'config-escape' 'config entrypoint with invalid escapes into the repository' $escape 'pre-download' 'auth-send-sms'
$traversal = New-SyncRecorded 'config-traversal'
[IO.File]::AppendAllLines([IO.Path]::Combine($traversal, 'supabase', 'config.toml'), [string[]]@('[functions.auth-send-sms]', 'entrypoint = "../../../backend/supabase/functions/sync/index.ts"'))
Assert-Refused 'config-path-escape' 'config entrypoint traversing out of the root' $traversal 'pre-download' 'auth-send-sms'
$foreignProject = New-SyncRecorded 'config-foreignproject'
[IO.File]::AppendAllLines([IO.Path]::Combine($foreignProject, 'supabase', 'config.toml'), [string[]]@('project_id = "jwjrijvprbsndukfhlvf"'))
Assert-Refused 'config-foreign-ref' 'config naming a foreign project_id' $foreignProject 'pre-download' 'auth-send-sms'
$badKey = New-SyncRecorded 'config-badkey'
[IO.File]::AppendAllLines([IO.Path]::Combine($badKey, 'supabase', 'config.toml'), [string[]]@('[functions.auth-send-sms]', 'command = "powershell"'))
Assert-Refused 'config-key' 'config with an unexpected key' $badKey 'pre-download' 'auth-send-sms'
$mutated = New-SyncRecorded 'config-mutated'
[IO.File]::WriteAllLines([IO.Path]::Combine($mutated, 'supabase', 'config.toml'), [string[]]@('[functions.auth-send-sms]', 'enabled = true'))
Assert-Refused 'config-mutated' 'previously accepted config lines removed' $mutated 'pre-download' 'auth-send-sms'
# Codex witnesses plus equivalent bypasses. A path key is only acceptable as a relative
# path whose resolved location is inside <StagingRoot>\supabase\functions.
$pathBypasses = @(
    @{ name = 'Codex witness 1: single-quoted absolute Windows path'; line = "entrypoint = 'D:\Muthoy\backend\supabase\functions\sync\index.ts'" }
    @{ name = 'Codex witness 2: double-quoted forward-slash absolute path'; line = 'entrypoint = "D:/Muthoy/backend/supabase/functions/sync/index.ts"' }
    @{ name = 'single-quoted forward-slash absolute path'; line = "entrypoint = 'D:/Muthoy/backend/supabase/functions/sync/index.ts'" }
    @{ name = 'escaped-backslash absolute path'; line = 'entrypoint = "D:\\Muthoy\\backend\\supabase\\functions\\sync\\index.ts"' }
    @{ name = 'drive-relative path without a separator'; line = 'entrypoint = "D:index.ts"' }
    @{ name = 'UNC path with backslashes'; line = "entrypoint = '\\server\share\index.ts'" }
    @{ name = 'UNC path with forward slashes'; line = 'entrypoint = "//server/share/index.ts"' }
    @{ name = 'rooted unix path'; line = 'entrypoint = "/etc/passwd"' }
    @{ name = 'rooted windows path, literal-quoted'; line = "entrypoint = '\windows\system32\drivers\etc\hosts'" }
    @{ name = 'traversal back out to the repository'; line = 'entrypoint = "./functions/../../../backend/supabase/functions/sync/index.ts"' }
    @{ name = 'parent traversal'; line = "entrypoint = '../sync/index.ts'" }
    @{ name = 'relative but outside the functions directory'; line = 'entrypoint = "./seed.sql"' }
    @{ name = 'relative into the CLI .temp directory'; line = 'entrypoint = "./.temp/project-ref"' }
    @{ name = 'import_map absolute, single-quoted'; line = "import_map = 'D:\Muthoy\x.json'" }
    @{ name = 'static_files rooted'; line = 'static_files = "/abs/path"' }
)
foreach ($case in $pathBypasses) {
    $bypassRoot = New-SyncRecorded ('config-bypass-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    [IO.File]::AppendAllLines([IO.Path]::Combine($bypassRoot, 'supabase', 'config.toml'), [string[]]@('[functions.auth-send-sms]', $case.line))
    Assert-Refused 'config-path-escape' $case.name $bypassRoot 'pre-download' 'auth-send-sms'
}
foreach ($case in @(
        @{ name = 'unquoted path value'; line = 'entrypoint = ./functions/auth-send-sms/index.ts' }
        @{ name = 'unterminated quote'; line = 'entrypoint = "./functions/auth-send-sms/index.ts' }
        @{ name = 'multi-line basic string'; line = 'entrypoint = """./functions/auth-send-sms/index.ts"""' }
        @{ name = 'junk after the closing quote'; line = 'entrypoint = "./functions/auth-send-sms/index.ts" oops' }
    )) {
    $malformedRoot = New-SyncRecorded ('config-malformed-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    [IO.File]::AppendAllLines([IO.Path]::Combine($malformedRoot, 'supabase', 'config.toml'), [string[]]@('[functions.auth-send-sms]', $case.line))
    Assert-Refused 'config-syntax' $case.name $malformedRoot 'pre-download' 'auth-send-sms'
}
# Correct decoding also means a literal-quoted foreign ref is caught for the right reason.
foreach ($case in @(
        @{ name = 'literal-quoted foreign project_id'; line = "project_id = 'jwjrijvprbsndukfhlvf'" }
        @{ name = 'basic-quoted foreign project_id'; line = 'project_id = "jwjrijvprbsndukfhlvf"' }
    )) {
    $refRoot = New-SyncRecorded ('config-ref-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    [IO.File]::AppendAllLines([IO.Path]::Combine($refRoot, 'supabase', 'config.toml'), [string[]]@($case.line))
    Assert-Refused 'config-foreign-ref' $case.name $refRoot 'pre-download' 'auth-send-sms'
}
# Positive controls: the legitimate relative forms must still be accepted, in both quote
# styles, so the fix is strict without blocking real CLI output.
foreach ($case in @(
        @{ name = 'relative ./ form'; lines = @('[functions.auth-send-sms]', 'entrypoint = "./functions/auth-send-sms/index.ts"') }
        @{ name = 'literal-quoted relative'; lines = @('[functions.auth-send-sms]', "entrypoint = './functions/auth-send-sms/index.ts'") }
        @{ name = 'bare relative'; lines = @('[functions.auth-send-sms]', 'entrypoint = "functions/auth-send-sms/index.ts"') }
        @{ name = 'escaped-backslash relative'; lines = @('[functions.auth-send-sms]', 'entrypoint = ".\\functions\\auth-send-sms\\index.ts"') }
        @{ name = 'literal-quoted backslash relative'; lines = @('[functions.auth-send-sms]', "entrypoint = '.\functions\auth-send-sms\index.ts'") }
        @{ name = 'inline comment after the value'; lines = @('[functions.auth-send-sms]', 'entrypoint = "./functions/auth-send-sms/index.ts" # ok') }
        @{ name = 'literal-quoted DEV project_id'; lines = @("project_id = 'btfprhticjgeihcngpif'") }
        @{ name = 'basic-quoted DEV project_id'; lines = @('project_id = "btfprhticjgeihcngpif"') }
    )) {
    $okRoot = New-SyncRecorded ('config-ok-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    [IO.File]::AppendAllLines([IO.Path]::Combine($okRoot, 'supabase', 'config.toml'), [string[]]$case.lines)
    $okResult = Stage -Root $okRoot -StageName 'pre-download' -SlugName 'auth-send-sms'
    if ($okResult.Code -ne 0) { [Console]::Error.WriteLine('  got: ' + $okResult.Err.Trim()) }
    Check ($okResult.Code -eq 0) ('accepted: ' + $case.name)
}

$appendOk = New-SyncRecorded 'config-append'
Add-ConfigSection $appendOk 'auth-send-sms'
$appendResult = Stage -Root $appendOk -StageName 'pre-download' -SlugName 'auth-send-sms'
Check ($appendResult.Code -eq 0) 'appending an allowed [functions.auth-send-sms] block is accepted'

[Console]::WriteLine('-- 6. receipt, CLI and reparse gate --')
$noReceipt = New-Root 'no-receipt'
[IO.Directory]::CreateDirectory($noReceipt) | Out-Null
Assert-Refused 'receipt-missing' 'gate without a receipt' $noReceipt 'pre-download' 'sync'
$badOwnerReceipt = New-Provisioned 'receipt-owner'
$ownerReceiptPath = [IO.Path]::Combine($badOwnerReceipt, 'staging-receipt.json')
$ownerJson = Get-Content -LiteralPath $ownerReceiptPath -Raw | ConvertFrom-Json
$ownerJson.ownerSid = 'S-1-5-21-1-2-3-1001'
[IO.File]::WriteAllText($ownerReceiptPath, ($ownerJson | ConvertTo-Json -Depth 8))
Assert-Refused 'receipt-identity' 'receipt claiming a foreign owner' $badOwnerReceipt 'pre-download' 'sync'
$badOrder = New-Provisioned 'receipt-order'
$orderReceiptPath = [IO.Path]::Combine($badOrder, 'staging-receipt.json')
$orderJson = Get-Content -LiteralPath $orderReceiptPath -Raw | ConvertFrom-Json
$orderJson.order = @('auth-send-sms', 'sync')
[IO.File]::WriteAllText($orderReceiptPath, ($orderJson | ConvertTo-Json -Depth 8))
Assert-Refused 'receipt-order' 'receipt order disagreeing with the expected order' $badOrder 'pre-download' 'sync'
$badCliPath = New-Provisioned 'receipt-clipath'
$copiedCli = [IO.Path]::Combine($testRoot, 'copied-supabase.exe')
[IO.File]::Copy($pinnedCli, $copiedCli, $true)
Assert-Refused 'receipt-cli-path' 'pinned-hash CLI at a path the receipt does not name' $badCliPath 'pre-download' 'sync' $copiedCli
$fakeCli = [IO.Path]::Combine($testRoot, 'fake-supabase.exe')
[IO.File]::WriteAllText($fakeCli, 'not the pinned CLI')
Assert-Refused 'cli-hash' 'CLI hash mismatch' $main 'pre-download' 'sync' $fakeCli
Assert-Refused 'cli-missing' 'absent CLI path' $main 'pre-download' 'sync' 'C:\Users\Imrul\no-such-supabase.exe'
$junction = New-SyncRecorded 'reparse-descendant'
New-Item -ItemType Junction -Path ([IO.Path]::Combine($junction, 'supabase', 'functions', 'auth-send-sms')) -Target $testRoot | Out-Null
Assert-Refused 'reparse-descendant' 'junction planted inside the staging tree' $junction 'pre-download' 'auth-send-sms'
$junctionParent = New-Root 'junctionparent'
[IO.Directory]::CreateDirectory($junctionParent) | Out-Null
New-Item -ItemType Junction -Path ([IO.Path]::Combine($junctionParent, 'link')) -Target $testRoot | Out-Null
Assert-Refused 'reparse-ancestor' 'junction ancestor' ([IO.Path]::Combine($junctionParent, 'link', 'stage')) 'provision'

[Console]::WriteLine('-- 7. ACL enforcement --')
$aclCase = New-SyncRecorded 'acl-untrusted'
$aclObject = Get-Acl -LiteralPath $aclCase
$aclObject.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-32-545'), [Security.AccessControl.FileSystemRights]::WriteData, [Security.AccessControl.AccessControlType]::Allow))
$aclApplied = $true
try { Set-FixtureAcl $aclCase $aclObject } catch { $aclApplied = $false }
if ($aclApplied -and @((Get-Acl -LiteralPath $aclCase).GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]) | Where-Object { $_.IdentityReference.Value -eq 'S-1-5-32-545' }).Count -eq 1) {
    Assert-Refused 'acl-untrusted' 'untrusted write ACE on the staging root' $aclCase 'pre-download' 'auth-send-sms'
} else {
    Unverified 'untrusted ACE detection' 'the fixture ACE could not be applied or did not persist in this environment'
}

$inheritCase = New-SyncRecorded 'acl-inherited'
$inheritAcl = Get-Acl -LiteralPath $inheritCase
$inheritAcl.SetAccessRuleProtection($false, $true)
$inheritApplied = $true
try { Set-FixtureAcl $inheritCase $inheritAcl 536870916 } catch { $inheritApplied = $false }
if ($inheritApplied -and -not (Get-Acl -LiteralPath $inheritCase).AreAccessRulesProtected) {
    Assert-Refused 'acl-inherited' 'staging root reverted to an inherited DACL' $inheritCase 'pre-download' 'auth-send-sms'
} else {
    Unverified 'inherited DACL detection' 'the DACL protection flag could not be cleared in this environment'
}

$ownerCase = New-SyncRecorded 'acl-owner'
$ownerStatus = Set-FixtureOwner $ownerCase 'S-1-5-32-544'
if ($ownerStatus -eq 0 -and (Get-Acl -LiteralPath $ownerCase).GetOwner([Security.Principal.SecurityIdentifier]).Value -eq 'S-1-5-32-544') {
    Assert-Refused 'acl-owner' 'staging root owned by another principal' $ownerCase 'pre-download' 'auth-send-sms'
} else {
    Unverified 'filesystem owner detection' "SetNamedSecurityInfo OWNER returned $ownerStatus; reassigning the owner needs a privilege this account lacks"
}

[Console]::WriteLine('-- 8. repository and custody roots --')
foreach ($forbiddenRoot in @($repo, [IO.Path]::Combine($repo, 'backend'), [IO.Path]::Combine($repo, 'backend', 'supabase'), [IO.Path]::Combine($repo, 'backend', 'supabase', 'functions'), $protectedRuntime, 'C:\Users\Imrul\.muthoy-h9-f12-exec', 'C:\Users\Imrul\.muthoy-secrets', 'C:\Users\Imrul')) {
    Assert-Refused 'forbidden-root' "forbidden root $forbiddenRoot" $forbiddenRoot 'provision'
}
Assert-Refused 'path' 'relative path' 'backend\supabase' 'provision'
Assert-Refused 'path' 'dot-dot traversal' ([IO.Path]::Combine($testRoot, 'a', '..', '..', 'b')) 'provision'
Assert-Refused 'drive-root' 'drive root' 'C:\' 'provision'
$gitFixture = New-Root 'gitmarker'
[IO.Directory]::CreateDirectory([IO.Path]::Combine($gitFixture, '.git')) | Out-Null
Assert-Refused 'source-tree' 'ancestor holds .git' ([IO.Path]::Combine($gitFixture, 'nested', 'stage')) 'provision'
$tomlFixture = New-Root 'tomlmarker'
[IO.Directory]::CreateDirectory([IO.Path]::Combine($tomlFixture, 'supabase')) | Out-Null
[IO.File]::WriteAllText([IO.Path]::Combine($tomlFixture, 'supabase', 'config.toml'), "project_id = 'synthetic'`n")
Assert-Refused 'source-tree' 'ancestor is a CLI project' ([IO.Path]::Combine($tomlFixture, 'stage')) 'provision'
$nonEmpty = New-Root 'nonempty'
[IO.Directory]::CreateDirectory($nonEmpty) | Out-Null
[IO.File]::WriteAllText([IO.Path]::Combine($nonEmpty, 'stray.txt'), 'pre-existing')
Assert-Refused 'exists-nonempty' 'provision over a non-empty directory' $nonEmpty 'provision'
Assert-Refused 'exists-nonempty' 'provision over an existing capture' $main 'provision'
$targetIsFile = [IO.Path]::Combine($testRoot, 'target.txt')
[IO.File]::WriteAllText($targetIsFile, 'file')
Assert-Refused 'target-is-file' 'target is a file' $targetIsFile 'provision'

[Console]::WriteLine('-- 9. repository overwrite protection --')
$unchanged = $true
foreach ($path in $guardedSources) {
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $baseline[$path]) {
        $unchanged = $false
        [Console]::Error.WriteLine("CHANGED: $path")
    }
}
Check $unchanged 'repository function sources and config.toml are byte-identical'
# Both $repo and $repo\backend are live CLI project dirs linked to DEV, so a download
# with a wrong or absent --workdir would land a functions tree under either one.
Check (-not [IO.Directory]::Exists([IO.Path]::Combine($repo, 'supabase', 'functions'))) 'no shadow functions tree at the repository root project'
$repoFunctions = [IO.Path]::Combine($repo, 'backend', 'supabase', 'functions')
Check (((@([IO.Directory]::EnumerateDirectories($repoFunctions)) | ForEach-Object { [IO.Path]::GetFileName($_) } | Sort-Object) -join ',') -eq 'auth-send-sms,payment-webhook,sync') 'repository functions directory gained no new slug'

[Console]::WriteLine("STAGING TESTS: $checks PASS; UNVERIFIED=$($unverified.Count); credentials retrieved=0; downloads=0; network=0")
foreach ($item in $unverified) { [Console]::WriteLine("  unverified: $item") }
[Console]::WriteLine("fixtures: $testRoot")
if ($unverified.Count -gt 0) { exit 3 }
