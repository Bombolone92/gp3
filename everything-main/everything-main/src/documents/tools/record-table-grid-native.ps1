param([Parameter(Mandatory=$true)][string]$Path,[Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference='Stop'
$resolved=(Resolve-Path -LiteralPath $Path).Path
$document=[Runtime.InteropServices.Marshal]::BindToMoniker($resolved)
if ([IO.Path]::GetFullPath($document.FullName) -ne [IO.Path]::GetFullPath($resolved)) { throw 'Reference source mismatch.' }
function SourceHash {
 $stream=[IO.File]::Open($resolved,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
 $digest=[Security.Cryptography.SHA256]::Create()
 try { return ([BitConverter]::ToString($digest.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
 finally { $stream.Dispose();$digest.Dispose() }
}
$before=SourceHash
$savedBefore=[bool]$document.Saved
if (-not $savedBefore) { throw 'Native control has unsaved changes.' }
$tables=@()
for($i=1;$i -le $document.Tables.Count;$i++) {
 $table=$document.Tables.Item($i);$heights=@()
 for($j=1;$j -le $table.Rows.Count;$j++) { $heights+= [double]$table.Rows.Item($j).Height }
 $tables+=@{ id=$i;rowHeightsPt=$heights;columns=[int]$table.Columns.Count }
}
if ((SourceHash) -ne $before -or -not $document.Saved) { throw 'Native source changed during observation.' }
$report=@{sourceSha256=$before;referenceVersion=$document.Application.Version;referenceBuild=$document.Application.Build;savedBefore=$savedBefore;savedAfter=[bool]$document.Saved;zoom=[int]$document.Windows.Item(1).View.Zoom.Percentage;tables=$tables;scope='Read-only native control metadata. No source/view/settings/font programs changed.'} | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText([IO.Path]::GetFullPath($Output),$report,[Text.UTF8Encoding]::new($false))
Write-Output $report
