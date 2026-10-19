# Credential-free process/ACL/reparse negative controls. Every invocation uses -VerifyOnly.
[CmdletBinding()]
param([string]$Runtime, [string]$TestRoot)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if (-not $TestRoot) { $TestRoot=[IO.Path]::Combine([Environment]::GetFolderPath('UserProfile'),'.muthoy-h9-local-tests-'+[Guid]::NewGuid().ToString('N')) }
$testRoot=[IO.Path]::GetFullPath($TestRoot)
if ([IO.Directory]::Exists($testRoot)) { throw 'Fixture root must be new.' }
[IO.Directory]::CreateDirectory($testRoot)|Out-Null
$repo=[IO.Path]::GetFullPath([IO.Path]::Combine($PSScriptRoot,'..','..','..'))
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class H9FixtureDacl {
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode)] public static extern uint SetNamedSecurityInfo(string p,uint t,uint i,IntPtr o,IntPtr g,IntPtr d,IntPtr s);
}
'@
function Set-FixtureAcl([string]$Path,[Security.AccessControl.FileSystemSecurity]$Acl) {
 if ($Path -ne $testRoot -and -not $Path.StartsWith($testRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Fixture ACL target outside test root.' }
 $raw=[Security.AccessControl.RawSecurityDescriptor]::new($Acl.GetSecurityDescriptorBinaryForm(),0)
 $bytes=[byte[]]::new($raw.DiscretionaryAcl.BinaryLength);$raw.DiscretionaryAcl.GetBinaryForm($bytes,0)
 $pointer=[Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
 try{[Runtime.InteropServices.Marshal]::Copy($bytes,0,$pointer,$bytes.Length);if([H9FixtureDacl]::SetNamedSecurityInfo($Path,1,[uint32]2147483652,[IntPtr]::Zero,[IntPtr]::Zero,$pointer,[IntPtr]::Zero)-ne 0){throw 'Fixture ACL update failed'}}finally{[Runtime.InteropServices.Marshal]::FreeHGlobal($pointer)}
}
$ownerSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$privateAcl=Get-Acl -LiteralPath $testRoot
$privateAcl.SetAccessRuleProtection($true,$false)
foreach($rule in @($privateAcl.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier]))){$privateAcl.RemoveAccessRuleSpecific($rule)}
foreach($sid in @($ownerSid,'S-1-5-18','S-1-5-32-544')){
 $privateAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow))
}
Set-FixtureAcl $testRoot $privateAcl
if (-not $Runtime) {
 $Runtime=[IO.Path]::Combine($testRoot,'baseline')
 $fileNames=@('a5-with-token.ps1','run-a5.cmd','verify-a5.cmd','h9-a5-dev-readonly.mjs','scripts/h9-f12-hosted-preflight.mjs','backend/supabase/checks/h9_hosted_preflight.sql','backend/supabase/checks/h9_postmigration_checks.sql')
 $hashes=[ordered]@{}
 foreach($name in $fileNames){
  $target=[IO.Path]::Combine($Runtime,$name)
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))|Out-Null
  $source=if($name.Contains('/')){[IO.Path]::Combine($repo,$name)}else{[IO.Path]::Combine($repo,'scripts','h9',$name)}
  [IO.File]::Copy($source,$target,$false)
  $hashes[$name]=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
 }
 $fixtureManifest=[ordered]@{version=1;sourceRevision='b8ca5d8c9538fd41605b09d5a9475e16ff496c3d';ownerSid=$ownerSid;node=[ordered]@{path='C:\Program Files\nodejs\node.exe';version='v22.22.2';sha256='ae1a50511be58e987483fdbc12125407443926d2d394669ade2352776e920dd3'};files=$hashes}
 [IO.File]::WriteAllText([IO.Path]::Combine($Runtime,'runtime-manifest.json'),($fixtureManifest|ConvertTo-Json -Depth 8))
}
$manifest=Get-Content -LiteralPath (Join-Path $runtime 'runtime-manifest.json') -Raw|ConvertFrom-Json -AsHashtable
$checks=0
function Clone-Package([string]$Name){
 $destination=Join-Path $testRoot $Name
 foreach($file in @($manifest.files.Keys)+@('runtime-manifest.json')){
  $target=Join-Path $destination $file
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))|Out-Null
  [IO.File]::Copy((Join-Path $runtime $file),$target,$false)
 }
 return $destination
}
function Run-Launcher([string]$Root,[hashtable]$Variables=@{},[string[]]$Extra=@()){
 $p=[Diagnostics.ProcessStartInfo]::new('C:\Program Files\PowerShell\7\pwsh.exe')
 $p.UseShellExecute=$false;$p.RedirectStandardOutput=$true;$p.RedirectStandardError=$true
 foreach($key in @($p.Environment.Keys)){if($key -match '^(NODE_|DOTNET_|COMPLUS_|CORECLR_|COR_|PG|OPENSSL_|SSL_CERT_|HTTP_PROXY$|HTTPS_PROXY$|ALL_PROXY$|SUPABASE_ACCESS_TOKEN$)'){$p.Environment.Remove($key)|Out-Null}}
 foreach($key in $Variables.Keys){$p.Environment[$key]=$Variables[$key]}
 foreach($arg in @('-NoProfile','-File',(Join-Path $Root 'a5-with-token.ps1'),'-VerifyOnly')+$Extra){$p.ArgumentList.Add($arg)}
 $child=[Diagnostics.Process]::Start($p);$output=$child.StandardOutput.ReadToEnd()+$child.StandardError.ReadToEnd();$child.WaitForExit();$code=$child.ExitCode;$child.Dispose()
 return @{Code=$code;Output=$output}
}
function Check([bool]$Pass,[string]$Name){if(-not $Pass){throw "FAIL: $Name"};$script:checks++;[Console]::WriteLine("PASS: $Name")}
# Exercise the actual owner predicate without changing ownership or requiring a foreign account.
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $runtime 'a5-with-token.ps1'),[ref]$tokens,[ref]$errors)
$ownerFunction=$ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Test-TrustedOwner'},$true)
if (-not $ownerFunction) { throw 'Missing owner predicate.' }
. ([scriptblock]::Create($ownerFunction.Extent.Text))
$trustedSids=@($ownerSid,'S-1-5-18','S-1-5-32-544');$osOwner='S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
Check (-not (Test-TrustedOwner 'S-1-5-21-foreign' $true $true)) 'foreign private-target owner refused'
Check (-not (Test-TrustedOwner $osOwner $true $true)) 'OS owner cannot own private target'
Check (Test-TrustedOwner $osOwner $false $true) 'OS ancestor owner accepted'
Check (Test-TrustedOwner $osOwner $true $false) 'OS executable owner accepted'
$good=Run-Launcher $runtime
if ($good.Code -ne 0) { [Console]::WriteLine('Baseline verification refusal: '+$good.Output.Trim()) }
Check ($good.Code -eq 0 -and $good.Output.Contains('credentials=not-read')) 'protected baseline without credentials'
$fixtureNodeTest=Join-Path $runtime 'h9-a5.test.mjs'
if (-not $Runtime.StartsWith($testRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Node test package must be a new fixture.' }
[IO.File]::Copy((Join-Path $repo 'scripts\h9\h9-a5.test.mjs'),$fixtureNodeTest,$false)
$nodeStart=[Diagnostics.ProcessStartInfo]::new('C:\Program Files\nodejs\node.exe')
$nodeStart.UseShellExecute=$false;$nodeStart.RedirectStandardOutput=$true;$nodeStart.RedirectStandardError=$true
$nodeStart.Environment.Clear()
foreach($key in @('SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA')){ $value=[Environment]::GetEnvironmentVariable($key);if($null -ne $value){$nodeStart.Environment[$key]=$value} }
$nodeStart.ArgumentList.Add($fixtureNodeTest)
$nodeChild=[Diagnostics.Process]::Start($nodeStart)
$nodeOutput=$nodeChild.StandardOutput.ReadToEnd()+$nodeChild.StandardError.ReadToEnd();$nodeChild.WaitForExit()
if($nodeChild.ExitCode -ne 0){[Console]::WriteLine($nodeOutput)}
Check ($nodeChild.ExitCode -eq 0) 'pinned Node verifies fixture closure and identity controls (3 tests)'
$nodeChild.Dispose()
foreach($key in @('NODE_OPTIONS','NODE_PATH','NODE_EXTRA_CA_CERTS','NODE_TLS_REJECT_UNAUTHORIZED','PGHOST','OPENSSL_CONF','HTTPS_PROXY')){
 $value=if($key -eq 'NODE_OPTIONS'){'--import=data:text/javascript,console.log(%22PRELOAD_RAN%22)'}else{'synthetic'}
 $result=Run-Launcher $runtime @{$key=$value}
 Check ($result.Code -eq 2 -and $result.Output.Contains('unsafe-environment; credentials=not-read') -and -not $result.Output.Contains('PRELOAD_RAN')) "pre-credential refusal: $key"
}
$badArgs=Run-Launcher $runtime @{} @('-Command','node.exe')
Check ($badArgs.Code -ne 0) 'arbitrary command/entrypoint parameter rejected'
$case=Clone-Package 'changed-bytes'
[IO.File]::AppendAllText((Join-Path $case 'scripts/h9-f12-hosted-preflight.mjs'),'// mutation')
$result=Run-Launcher $case
Check ($result.Code -eq 2 -and $result.Output.Contains('h9-hash; credentials=not-read')) 'changed evaluator before import'
$m=Get-Content -LiteralPath (Join-Path $case 'runtime-manifest.json') -Raw|ConvertFrom-Json -AsHashtable
$m.files['scripts/h9-f12-hosted-preflight.mjs']=(Get-FileHash -LiteralPath (Join-Path $case 'scripts/h9-f12-hosted-preflight.mjs')).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $case 'runtime-manifest.json'),($m|ConvertTo-Json -Depth 8))
$result=Run-Launcher $case
Check ($result.Code -eq 2 -and $result.Output.Contains('h9-evaluator-identity; credentials=not-read')) 'manifest cannot authorize another evaluator'
$case=Clone-Package 'extra-dependency'
$m=Get-Content -LiteralPath (Join-Path $case 'runtime-manifest.json') -Raw|ConvertFrom-Json -AsHashtable
$m.files['extra.mjs']='a'*64
[IO.File]::WriteAllText((Join-Path $case 'runtime-manifest.json'),($m|ConvertTo-Json -Depth 8))
$result=Run-Launcher $case
Check ($result.Code -eq 2 -and $result.Output.Contains('h9-manifest; credentials=not-read')) 'executable dependency allowlist is closed'
$case=Clone-Package 'junction'
$source=Join-Path $case 'backend\supabase\checks'
$moved=Join-Path $case 'backend\supabase\checks-original'
if(-not $source.StartsWith($testRoot+'\') -or -not $moved.StartsWith($testRoot+'\')){throw 'Refused fixture move outside test root'}
[IO.Directory]::Move($source,$moved)
New-Item -ItemType Junction -Path $source -Target $moved|Out-Null
$result=Run-Launcher $case
Check ($result.Code -eq 2 -and $result.Output.Contains('h9-reparse; credentials=not-read')) 'junction refused before credential access'
# Native DACL-only fixture change: no ownership, audit, or global ACL mutation.
$case=Clone-Package 'writable-acl';$file=Join-Path $case 'h9-a5-dev-readonly.mjs';$acl=Get-Acl -LiteralPath $file
$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-32-545'),[Security.AccessControl.FileSystemRights]::Write,[Security.AccessControl.AccessControlType]::Allow))
Set-FixtureAcl $file $acl
$result=Run-Launcher $case
Check ($result.Code -eq 2 -and $result.Output.Contains('h9-writable-acl; credentials=not-read')) 'untrusted writable ACL refused'
# Exercise the actual path guard for an OS executable without changing the real Node binary.
# A direct WriteData grant permits in-place replacement even when Delete is absent.
foreach($functionName in @('Deny','Assert-Path')){
 $definition=$ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $functionName},$true)
 if(-not $definition){throw 'Missing path guard.'}
 . ([scriptblock]::Create($definition.Extent.Text))
}
foreach($variableName in @('$writeMask','$replaceMask')){
 $assignment=$ast.Find({param($node) $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -eq $variableName},$true)
 if(-not $assignment){throw 'Missing path rights mask.'}
 . ([scriptblock]::Create($assignment.Extent.Text))
}
$case=Clone-Package 'os-executable-write-acl';$file=Join-Path $case 'h9-a5-dev-readonly.mjs';$acl=Get-Acl -LiteralPath $file
$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-32-545'),[Security.AccessControl.FileSystemRights]::WriteData,[Security.AccessControl.AccessControlType]::Allow))
Set-FixtureAcl $file $acl
$osExecutableRefused=$false
try{Assert-Path $file $false}catch{$osExecutableRefused=$_.Exception.Message -eq 'h9-writable-acl'}
Check $osExecutableRefused 'OS executable direct WriteData refused before credential access'
foreach($key in @('NODE_OPTIONS','DOTNET_STARTUP_HOOKS','CORECLR_PROFILER_PATH','COMPLUS_ApplicationMigrationRuntimeActivationConfigPath')){
 $p=[Diagnostics.ProcessStartInfo]::new('C:\Windows\System32\cmd.exe');$p.UseShellExecute=$false;$p.RedirectStandardOutput=$true;$p.RedirectStandardError=$true
 foreach($item in @($p.Environment.Keys)){if($item -match '^(NODE_|DOTNET_|CORECLR_|COMPLUS_|COR_)'){$p.Environment.Remove($item)|Out-Null}}
 $p.Environment[$key]='SYNTHETIC_PRELOAD_MUST_NOT_RUN';$p.Environment['ERRORLEVEL']='0'
 $p.ArgumentList.Add('/d');$p.ArgumentList.Add('/c');$p.ArgumentList.Add((Join-Path $runtime 'verify-a5.cmd'))
 $child=[Diagnostics.Process]::Start($p);$output=$child.StandardOutput.ReadToEnd()+$child.StandardError.ReadToEnd();$child.WaitForExit()
 Check ($child.ExitCode -eq 2 -and $output.Contains('A5 BOOTSTRAP REFUSED: startup-environment; credentials=not-read')) "native pre-PowerShell refusal: $key"
 $child.Dispose()
}
[Console]::WriteLine("LAUNCHER TESTS: $checks PASS; credentials retrieved=0; network=0")
