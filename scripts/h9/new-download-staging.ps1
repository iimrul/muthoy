# LOCAL staging state machine for the A5 deployed-source capture. It never downloads,
# never reads credentials and never invokes the CLI; it only provisions and gates.
#
# The pinned CLI's `--workdir` is a Supabase PROJECT directory, so `functions download`
# writes to <StagingRoot>\supabase\functions\<slug>\ and the CLI also writes
# supabase\config.toml and supabase\.temp\ beside functions\. Both D:\Muthoy and
# D:\Muthoy\backend are live CLI project directories linked to DEV, so a wrong or absent
# --workdir would overwrite backend/supabase/functions/<slug>/index.ts.
#
# Stages, strictly ordered, one fresh private root per capture:
#   provision                          -> create + protect the root, write the receipt
#   pre-download  -Slug sync           -> gate before the FIRST download
#   post-download -Slug sync           -> verify and record sync's files
#   pre-download  -Slug auth-send-sms  -> gate; sync must be present and unchanged
#   post-download -Slug auth-send-sms  -> verify and record
#   complete                           -> both recorded and unchanged; emit the manifest
#
# Every gate re-checks the receipt, owner, protected DACL, the pinned CLI hash, reparse
# points across the WHOLE tree, the exact expected scaffolding, and that nothing recorded
# has changed. config.toml is not exempted: the CLI appends a [functions.<slug>] block per
# run, so it is validated as insert-only, allowlisted keys, allowed slugs and relative
# in-root paths only -- never frozen by hash and never ignored.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$StagingRoot,
    [ValidateSet('provision', 'pre-download', 'post-download', 'complete')][string]$Stage = 'provision',
    [string]$Slug = '',
    [Parameter(Mandatory)][string]$CliPath,
    [string[]]$Order = @('sync', 'auth-send-sms')
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$CLI_VERSION = '2.117.0'
$CLI_SHA256 = '442c83f7d455edc0462e94e22d60c9f7f05783fc83d39a0f49dadc78a914a1dd'
$DEV_REF = 'btfprhticjgeihcngpif'
# Named $RECEIPT_FILE, not $RECEIPT: PowerShell variable names are case-insensitive, so
# a $RECEIPT constant is shadowed by the helpers' own [hashtable]$Receipt parameter.
$RECEIPT_FILE = 'staging-receipt.json'
$TEMP_NAMES = @('cli-latest', 'gotrue-version', 'pooler-url', 'postgres-version', 'project-ref', 'rest-version', 'storage-version', 'storage-migration', 'linked-project.json')
$CONFIG_KEYS = @('enabled', 'verify_jwt', 'import_map', 'entrypoint', 'static_files', 'project_id')

function Deny([string]$Code) { throw "h9-staging-$Code" }

$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$trusted = @($sid.Value, 'S-1-5-18', 'S-1-5-32-544')
$forbidden = @(
    $repo,
    'C:\Users\Imrul\.muthoy-h9-ws',
    'C:\Users\Imrul\.muthoy-h9-f12-exec',
    'C:\Users\Imrul\.muthoy-secrets'
) | ForEach-Object { [IO.Path]::GetFullPath($_) }
$sourceMarkers = @('.git', 'supabase\config.toml')

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class H9StagingDacl {
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode)]
 public static extern uint SetNamedSecurityInfo(string path,uint type,uint info,IntPtr owner,IntPtr group,IntPtr dacl,IntPtr sacl);
}
'@

function Test-Inside([string]$Child, [string]$Parent) {
    return $Child -ieq $Parent -or $Child.StartsWith($Parent.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)
}
function Digest([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    try { return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream)).ToLowerInvariant() }
    finally { $stream.Dispose() }
}
function Protect([string]$Path, [bool]$Directory) {
    if (([IO.File]::GetAttributes($Path) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Deny 'reparse' }
    $acl = Get-Acl -LiteralPath $Path
    # Create-only: never take ownership of anything this script did not just make.
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $sid.Value) { Deny 'owner' }
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))) { $null = $acl.RemoveAccessRuleSpecific($rule) }
    # Inheritance flags are only valid on a container ACE.
    $inherit = if ($Directory) { [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
    foreach ($id in $trusted) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
                [Security.Principal.SecurityIdentifier]::new($id), [Security.AccessControl.FileSystemRights]::FullControl,
                $inherit, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
    }
    # DACL only: Set-Acl attempts audit metadata here and requires SeSecurityPrivilege.
    $raw = [Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(), 0)
    $dacl = [byte[]]::new($raw.DiscretionaryAcl.BinaryLength)
    $raw.DiscretionaryAcl.GetBinaryForm($dacl, 0)
    $pointer = [Runtime.InteropServices.Marshal]::AllocHGlobal($dacl.Length)
    try {
        [Runtime.InteropServices.Marshal]::Copy($dacl, 0, $pointer, $dacl.Length)
        if ([H9StagingDacl]::SetNamedSecurityInfo($Path, 1, [uint32]2147483652, [IntPtr]::Zero, [IntPtr]::Zero, $pointer, [IntPtr]::Zero) -ne 0) { Deny 'dacl' }
    } finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($pointer) }
}
function Assert-TrustedAcl([string]$Path) {
    $acl = Get-Acl -LiteralPath $Path
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $sid.Value) { Deny 'acl-owner' }
    if (-not $acl.AreAccessRulesProtected) { Deny 'acl-inherited' }
    foreach ($rule in $acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier])) {
        if ($rule.IdentityReference.Value -notin $trusted) { Deny 'acl-untrusted' }
    }
}
function Assert-NoReparseTree([string]$Root) {
    # Descendants too: a junction planted under the staging root could redirect a write.
    # Walk explicitly and test each entry BEFORE descending; a recursive enumeration
    # would follow a junction and could loop back into this very tree.
    $stack = [Collections.Generic.Stack[string]]::new()
    $stack.Push($Root)
    while ($stack.Count -gt 0) {
        foreach ($entry in [IO.Directory]::EnumerateFileSystemEntries($stack.Pop())) {
            if (([IO.File]::GetAttributes($entry) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Deny 'reparse-descendant' }
            if ([IO.Directory]::Exists($entry)) { $stack.Push($entry) }
        }
    }
}

# --- Path guards (identical for every stage) --------------------------------
# Resolved inside the try below, never at module scope: a malformed path must produce the
# standard one-line refusal, not an uncaught exception that bypasses the exit-2 contract.
$absolute = $null
$functionsDir = $null
$receiptPath = $null

function Assert-PathChain {
    if ($absolute -eq [IO.Path]::GetPathRoot($absolute)) { Deny 'drive-root' }
    foreach ($root in $forbidden) {
        if ((Test-Inside $absolute $root) -or (Test-Inside $root $absolute)) { Deny 'forbidden-root' }
    }
    for ($current = $absolute; $current; $current = [IO.Path]::GetDirectoryName($current)) {
        if ([IO.Directory]::Exists($current)) {
            if (([IO.File]::GetAttributes($current) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Deny 'reparse-ancestor' }
            # The staging root itself legitimately grows supabase\config.toml once the CLI
            # runs, so that marker is only disqualifying on an ancestor.
            foreach ($marker in $sourceMarkers) {
                if ($current -ieq $absolute -and $marker -eq 'supabase\config.toml') { continue }
                if ([IO.File]::Exists((Join-Path $current $marker)) -or [IO.Directory]::Exists((Join-Path $current $marker))) { Deny 'source-tree' }
            }
        } elseif ([IO.File]::Exists($current)) {
            if ($current -ieq $absolute) { Deny 'target-is-file' } else { Deny 'ancestor-is-file' }
        }
        if ($current -eq [IO.Path]::GetPathRoot($current)) { break }
    }
}

function Assert-Cli {
    # Mandatory on EVERY stage, including the read-only gates.
    if ($CliPath -notmatch '^[A-Za-z]:\\' -or -not [IO.File]::Exists($CliPath)) { Deny 'cli-missing' }
    if (([IO.File]::GetAttributes($CliPath) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Deny 'cli-reparse' }
    if ((Digest $CliPath) -cne $CLI_SHA256) { Deny 'cli-hash' }
}

function Read-Receipt {
    if (-not [IO.File]::Exists($receiptPath)) { Deny 'receipt-missing' }
    if (([IO.File]::GetAttributes($receiptPath) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Deny 'receipt-reparse' }
    Assert-TrustedAcl $receiptPath
    try { $r = Microsoft.PowerShell.Utility\ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($receiptPath)) -AsHashtable } catch { Deny 'receipt-unreadable' }
    if ($null -eq $r -or $r.version -ne 2) { Deny 'receipt-identity' }
    if ($r.stagingRoot -cne $absolute -or $r.functionsDir -cne $functionsDir) { Deny 'receipt-identity' }
    if ($r.ownerSid -cne $sid.Value -or $r.cliSha256 -cne $CLI_SHA256 -or $r.cliVersion -cne $CLI_VERSION) { Deny 'receipt-identity' }
    if ($r.cliPath -cne [IO.Path]::GetFullPath($CliPath)) { Deny 'receipt-cli-path' }
    if ((@($r.order) -join ',') -cne ($Order -join ',')) { Deny 'receipt-order' }
    return $r
}

# Current files, relative to the staging root, with hashes.
function Get-Inventory {
    $map = [ordered]@{}
    if ([IO.Directory]::Exists($absolute)) {
        foreach ($file in [IO.Directory]::EnumerateFiles($absolute, '*', 'AllDirectories')) {
            $map[$file.Substring($absolute.Length + 1)] = Digest $file
        }
    }
    return $map
}

function Assert-Scaffolding([hashtable]$Receipt) {
    foreach ($entry in [IO.Directory]::EnumerateFileSystemEntries($absolute)) {
        if ([IO.Path]::GetFileName($entry) -inotin @($RECEIPT_FILE, 'supabase')) { Deny 'unexpected-entry' }
    }
    $supabase = [IO.Path]::Combine($absolute, 'supabase')
    if ([IO.Directory]::Exists($supabase)) {
        foreach ($entry in [IO.Directory]::EnumerateFileSystemEntries($supabase)) {
            if ([IO.Path]::GetFileName($entry) -inotin @('config.toml', '.temp', 'functions')) { Deny 'unexpected-entry' }
        }
        $temp = [IO.Path]::Combine($supabase, '.temp')
        if ([IO.Directory]::Exists($temp)) {
            foreach ($entry in [IO.Directory]::EnumerateFileSystemEntries($temp)) {
                $name = [IO.Path]::GetFileName($entry)
                if (-not [IO.File]::Exists($entry) -or $name -inotin $TEMP_NAMES) { Deny 'unexpected-temp' }
                if ((Get-Item -LiteralPath $entry).Length -gt 8192) { Deny 'temp-too-large' }
                # A staging project linked to anything but DEV is a wrong-target capture.
                if ($name -in @('project-ref', 'linked-project.json')) {
                    if (-not ([IO.File]::ReadAllText($entry).Contains($DEV_REF))) { Deny 'temp-foreign-ref' }
                }
            }
        }
    }
    if ([IO.Directory]::Exists($functionsDir)) {
        foreach ($entry in [IO.Directory]::EnumerateFileSystemEntries($functionsDir)) {
            if (-not [IO.Directory]::Exists($entry) -or [IO.Path]::GetFileName($entry) -inotin $Order) { Deny 'unexpected-slug' }
        }
    }
}

# TOML \uXXXX / \UXXXXXXXX must name a valid Unicode scalar value.
function Convert-TomlCodePoint([string]$Hex) {
    if ($Hex -cnotmatch '^[0-9A-Fa-f]+$') { Deny 'config-escape' }
    $value = [Convert]::ToUInt32($Hex, 16)
    # Above the Unicode maximum, or a lone surrogate, is not a scalar value.
    if ($value -gt 0x10FFFF -or ($value -ge 0xD800 -and $value -le 0xDFFF)) { Deny 'config-escape' }
    return [char]::ConvertFromUtf32([int]$value)
}

# Decodes one TOML single-line string value, strictly.
#
# Both quote styles matter. A literal 'single-quoted' value interprets NO escapes, so
# trimming only double quotes would leave the quotes attached and defeat the path checks.
# A basic "double-quoted" value must be decoded for real: an unsupported escape is a TOML
# error and is refused, never silently preserved, and \uXXXX is decoded rather than left
# as text -- otherwise "functions/../x" would pass a textual `..` check here
# while the CLI and Deno read it as a traversal.
function Read-TomlString([string]$Raw) {
    $text = $Raw.Trim()
    if ($text.Length -lt 2) { Deny 'config-syntax' }
    $quote = $text[0]
    if ($quote -ne '"' -and $quote -ne "'") { Deny 'config-syntax' }
    # The CLI emits single-line strings only; multi-line forms are not accepted.
    if ($text.StartsWith('"""') -or $text.StartsWith("'''")) { Deny 'config-syntax' }
    $builder = [Text.StringBuilder]::new()
    $index = 1
    $closed = $false
    while ($index -lt $text.Length) {
        $character = $text[$index]
        if ($character -eq $quote) { $closed = $true; $index++; break }
        # TOML forbids raw control characters in either string type; tab is allowed.
        $code = [int][char]$character
        if (($code -lt 0x09) -or ($code -ge 0x0A -and $code -le 0x1F) -or $code -eq 0x7F) { Deny 'config-syntax' }
        # Literal strings take no escapes at all.
        if ($quote -eq "'" -or $character -ne '\') { [void]$builder.Append($character); $index++; continue }
        if ($index + 1 -ge $text.Length) { Deny 'config-escape' }
        $next = $text[$index + 1]
        $index += 2
        switch -CaseSensitive ($next) {
            '"' { [void]$builder.Append('"') }
            '\' { [void]$builder.Append('\') }
            'b' { [void]$builder.Append([char]0x08) }
            't' { [void]$builder.Append([char]0x09) }
            'n' { [void]$builder.Append([char]0x0A) }
            'f' { [void]$builder.Append([char]0x0C) }
            'r' { [void]$builder.Append([char]0x0D) }
            'u' {
                if ($index + 4 -gt $text.Length) { Deny 'config-escape' }
                [void]$builder.Append((Convert-TomlCodePoint $text.Substring($index, 4)))
                $index += 4
            }
            'U' {
                if ($index + 8 -gt $text.Length) { Deny 'config-escape' }
                [void]$builder.Append((Convert-TomlCodePoint $text.Substring($index, 8)))
                $index += 8
            }
            # \q, \/, \x41, \0, \e and every other sequence are TOML errors.
            default { Deny 'config-escape' }
        }
    }
    if (-not $closed) { Deny 'config-syntax' }
    # Only an inline comment may follow the closing quote.
    $rest = $text.Substring($index).Trim()
    if ($rest -ne '' -and -not $rest.StartsWith('#')) { Deny 'config-syntax' }
    return $builder.ToString()
}

# A path key may only be a relative path that resolves INSIDE the approved staging
# functions directory. Rejecting a few prefixes is not enough on its own, so the decoded
# value is resolved and its location proven.
function Assert-RelativeInsideFunctions([string]$PathValue) {
    if ($PathValue -eq '') { Deny 'config-path-escape' }
    # Drive prefix with OR without a separator (C:x is drive-relative), UNC, rooted
    # paths in either slash style, and any traversal segment.
    if ($PathValue -match '^[A-Za-z]:') { Deny 'config-path-escape' }
    if ($PathValue -match '^[\\/]') { Deny 'config-path-escape' }
    if ($PathValue -match '(^|[\\/])\.\.([\\/]|$)') { Deny 'config-path-escape' }
    if ($PathValue.IndexOfAny([IO.Path]::GetInvalidPathChars()) -ge 0) { Deny 'config-path-escape' }
    # config.toml's relative paths resolve against the supabase directory holding it.
    $base = [IO.Path]::Combine($absolute, 'supabase')
    try { $resolved = [IO.Path]::GetFullPath([IO.Path]::Combine($base, ($PathValue -replace '/', '\'))) }
    catch { Deny 'config-path-escape' }
    if (-not (Test-Inside $resolved $functionsDir)) { Deny 'config-path-escape' }
}

# config.toml is validated, never exempted: insert-only, allowlisted keys, allowed slugs,
# and relative in-root paths only. An absolute or escaping entrypoint would let a later
# deploy read repository source.
function Assert-ConfigToml([hashtable]$Receipt) {
    $config = [IO.Path]::Combine($absolute, 'supabase', 'config.toml')
    $accepted = @($Receipt.configLines)
    if (-not [IO.File]::Exists($config)) {
        if ($accepted.Count -ne 0) { Deny 'config-removed' }
        return @()
    }
    if ((Get-Item -LiteralPath $config).Length -gt 65536) { Deny 'config-too-large' }
    $lines = @([IO.File]::ReadAllLines($config))
    foreach ($line in $lines) {
        $text = $line.Trim()
        if ($text -eq '' -or $text.StartsWith('#')) { continue }
        if ($text -match '^\[(.+)\]$') {
            $section = $Matches[1]
            if ($section -match '^functions\.(.+)$' -and $Matches[1] -inotin $Order) { Deny 'config-foreign-slug' }
            continue
        }
        if ($text -notmatch '^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$') { Deny 'config-syntax' }
        $key = $Matches[1]
        $rawValue = $Matches[2]
        if ($key -inotin $CONFIG_KEYS) { Deny 'config-key' }
        if ($key -eq 'project_id') {
            if ((Read-TomlString $rawValue) -cne $DEV_REF) { Deny 'config-foreign-ref' }
        } elseif ($key -in @('import_map', 'entrypoint', 'static_files')) {
            Assert-RelativeInsideFunctions (Read-TomlString $rawValue)
        }
    }
    # Insert-only: nothing previously accepted may be removed or altered.
    $index = 0
    foreach ($line in $lines) { if ($index -lt $accepted.Count -and $line -ceq $accepted[$index]) { $index++ } }
    if ($index -ne $accepted.Count) { Deny 'config-mutated' }
    return $lines
}

function Assert-RecordedUnchanged([hashtable]$Receipt, $Inventory) {
    foreach ($file in @($Receipt.files)) {
        if (-not $Inventory.Contains($file.path)) { Deny 'recorded-file-missing' }
        if ($Inventory[$file.path] -cne $file.sha256) { Deny 'recorded-file-changed' }
    }
    # No extra file may appear under an already recorded slug.
    $recorded = @{}
    foreach ($file in @($Receipt.files)) { $recorded[$file.path] = $true }
    foreach ($slug in @($Receipt.completed)) {
        $prefix = "supabase\functions\$slug\"
        foreach ($path in @($Inventory.Keys)) {
            if ($path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -and -not $recorded.ContainsKey($path)) { Deny 'recorded-slug-extra-file' }
        }
    }
}

function Get-SlugFiles($Inventory, [string]$Name) {
    $prefix = "supabase\functions\$Name\"
    $out = @()
    foreach ($path in @($Inventory.Keys)) {
        if ($path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { $out += [pscustomobject]@{ path = $path; sha256 = $Inventory[$path] } }
    }
    return @($out | Sort-Object path)
}

function Write-Receipt($Receipt) {
    [IO.File]::WriteAllText($receiptPath, (($Receipt | Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 8) + "`n"), [Text.UTF8Encoding]::new($false))
    Protect $receiptPath $false
}

try {
    if ($StagingRoot -notmatch '^[A-Za-z]:\\' -or $StagingRoot -match '(?:^|\\)\.\.(?:\\|$)') { Deny 'path' }
    $absolute = [IO.Path]::GetFullPath($StagingRoot)
    $functionsDir = [IO.Path]::Combine($absolute, 'supabase', 'functions')
    $receiptPath = [IO.Path]::Combine($absolute, $RECEIPT_FILE)
    Assert-PathChain
    Assert-Cli
    if ($Order.Count -lt 1) { Deny 'order' }
    foreach ($name in $Order) { if ($name -notmatch '^[a-z][a-z0-9-]{0,62}$') { Deny 'slug-shape' } }
    if ($Order.Count -ne @($Order | Sort-Object -Unique).Count) { Deny 'order-duplicate' }

    if ($Stage -eq 'provision') {
        if ($Slug) { Deny 'slug-unexpected' }
        if ([IO.Directory]::Exists($absolute) -and @([IO.Directory]::EnumerateFileSystemEntries($absolute)).Count -ne 0) { Deny 'exists-nonempty' }
        [IO.Directory]::CreateDirectory($absolute) | Out-Null
        Protect $absolute $true
        $receipt = [ordered]@{
            version      = 2
            stagingRoot  = $absolute
            functionsDir = $functionsDir
            order        = @($Order)
            ownerSid     = $sid.Value
            aclProtected = $true
            cliPath      = [IO.Path]::GetFullPath($CliPath)
            cliVersion   = $CLI_VERSION
            cliSha256    = $CLI_SHA256
            createdAtUtc = [DateTime]::UtcNow.ToString('o')
            completed    = @()
            files        = @()
            configLines  = @()
            stages       = @([ordered]@{ stage = 'provision'; slug = ''; atUtc = [DateTime]::UtcNow.ToString('o') })
        }
        Write-Receipt $receipt
        [Console]::WriteLine(($receipt | Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 8 -Compress))
        [Console]::WriteLine('STAGING PROVISIONED; credentials=not-read; downloads=0')
        exit 0
    }

    # Every non-provision stage re-runs the full security gate.
    $receipt = Read-Receipt
    Assert-TrustedAcl $absolute
    Assert-NoReparseTree $absolute
    $inventory = Get-Inventory
    $configLines = Assert-ConfigToml $receipt
    Assert-Scaffolding $receipt
    Assert-RecordedUnchanged $receipt $inventory
    $completed = @($receipt.completed)

    if ($Stage -eq 'complete') {
        if ($Slug) { Deny 'slug-unexpected' }
        if (($completed -join ',') -cne ($Order -join ',')) { Deny 'stage-incomplete' }
        $manifest = [ordered]@{
            stagingRoot  = $absolute
            functionsDir = $functionsDir
            order        = @($Order)
            cliPath      = $receipt.cliPath
            cliVersion   = $CLI_VERSION
            cliSha256    = $CLI_SHA256
            files        = @(@($receipt.files) | ForEach-Object { [ordered]@{ slug = $_.slug; path = [IO.Path]::Combine($absolute, $_.path); sha256 = $_.sha256 } })
        }
        [Console]::WriteLine(($manifest | Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 8 -Compress))
        [Console]::WriteLine("STAGING COMPLETE; slugs=$($completed -join ','); credentials=not-read; downloads=0")
        exit 0
    }

    # pre-download / post-download both act on exactly the next expected slug.
    if (-not $Slug) { Deny 'slug-required' }
    if ($Slug -inotin $Order) { Deny 'slug-unexpected' }
    if ($completed -icontains $Slug) { Deny 'stage-repeat' }
    if ($completed.Count -ge $Order.Count) { Deny 'stage-order' }
    if ($Order[$completed.Count] -cne $Slug) { Deny 'stage-order' }
    # No later slug may have been downloaded early.
    # @(...) at every call site: a function returning an empty array collapses to $null,
    # and .Count on $null throws under Set-StrictMode.
    foreach ($name in $Order[$completed.Count..($Order.Count - 1)]) {
        if ($name -cne $Slug -and @(Get-SlugFiles $inventory $name).Count -ne 0) { Deny 'stage-order' }
    }
    $slugFiles = @(Get-SlugFiles $inventory $Slug)

    if ($Stage -eq 'pre-download') {
        if ($slugFiles.Count -ne 0) { Deny 'destination-exists' }
        [Console]::WriteLine("STAGE READY: $Slug; position=$($completed.Count + 1)/$($Order.Count); credentials=not-read; downloads=0")
        exit 0
    }

    # post-download: the slug must now be present, complete and recorded.
    if ($slugFiles.Count -eq 0) { Deny 'download-missing' }
    if (-not ($slugFiles | Where-Object { $_.path -ieq "supabase\functions\$Slug\index.ts" })) { Deny 'entrypoint-missing' }
    $recordedNow = @($slugFiles | ForEach-Object { [ordered]@{ slug = $Slug; path = $_.path; sha256 = $_.sha256 } })
    $receipt.completed = @($completed + $Slug)
    $receipt.files = @(@($receipt.files) + $recordedNow)
    $receipt.configLines = @($configLines)
    $receipt.stages = @(@($receipt.stages) + @([ordered]@{ stage = 'post-download'; slug = $Slug; atUtc = [DateTime]::UtcNow.ToString('o') }))
    Write-Receipt $receipt
    [Console]::WriteLine(($recordedNow | Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 8 -Compress))
    [Console]::WriteLine("STAGE RECORDED: $Slug; files=$($slugFiles.Count); credentials=not-read; downloads=0")
    exit 0
} catch {
    $reason = if ($_.Exception.Message -cmatch '^h9-staging-[a-z-]+$') { $_.Exception.Message } else { 'h9-staging-precondition' }
    [Console]::Error.WriteLine("STAGING REFUSED: $reason; credentials=not-read; downloads=0")
    exit 2
}
