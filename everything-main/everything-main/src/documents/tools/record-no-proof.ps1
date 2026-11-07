param([Parameter(Mandatory=$true)][string]$Path, [Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference = 'Stop'
$resolved = (Resolve-Path -LiteralPath $Path).Path
$document = [Runtime.InteropServices.Marshal]::BindToMoniker($resolved)
if ([IO.Path]::GetFullPath($document.FullName) -ne [IO.Path]::GetFullPath($resolved)) { throw 'Reference document path mismatch.' }
function SourceHash {
    $stream = [IO.File]::Open($resolved, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    $digest = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($digest.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $digest.Dispose(); $stream.Dispose() }
}
$before = SourceHash
$names = @('ordinary','direct','paragraph','character','override','mixed','split','derived','characterOff')
$rows = @()
for ($i=1; $i -le $names.Length; $i++) {
    $range = $document.Paragraphs.Item($i).Range.Duplicate
    $range.End = $range.End - 1
    $errors = @()
    for ($j=1; $j -le $range.SpellingErrors.Count; $j++) {
        $errorRange = $range.SpellingErrors.Item($j)
        $errors += @{ text=$errorRange.Text; start=[int]$errorRange.Start; end=[int]$errorRange.End }
    }
    $rows += @{ case=$names[$i-1]; text=$range.Text; noProofing=[int]$range.NoProofing; errors=$errors }
}
if ((SourceHash) -ne $before) { throw 'Native source changed during observation.' }
$report = @{ sourceSha256=$before; referenceVersion=$document.Application.Version; referenceBuild=$document.Application.Build; scope='Read-only reference proofing metadata; source and application settings unchanged; no font programs inspected.'; rows=$rows } | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText([IO.Path]::GetFullPath($Output), $report, [Text.UTF8Encoding]::new($false))
Write-Output ($rows | ForEach-Object { "$($_.case): $($_.errors.Count) errors; NoProofing=$($_.noProofing)" })
