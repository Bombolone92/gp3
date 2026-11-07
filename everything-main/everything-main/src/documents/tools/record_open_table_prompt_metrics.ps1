param([Parameter(Mandatory)][string]$Source,[Parameter(Mandatory)][string]$OutputRoot,[Parameter(Mandatory)][string]$ExpectedSha256)
# Export an exact helper-opened original control, without shared application UI changes.
$ErrorActionPreference='Stop'
$promptSource=[IO.Path]::GetFullPath($Source);$promptRoot=[IO.Path]::GetFullPath($OutputRoot);$promptPdf=Join-Path $promptRoot 'native.pdf';$promptMetadata=Join-Path $promptRoot 'native-export.json'
if(!(Test-Path -LiteralPath $promptRoot -PathType Container) -or (Test-Path -LiteralPath $promptPdf) -or (Test-Path -LiteralPath $promptMetadata)){throw 'Use fresh output files in an existing directory.'}
function PromptSourceHash { $stream=[IO.File]::Open($promptSource,'Open','Read','ReadWrite');$sha=[Security.Cryptography.SHA256]::Create();try {([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant()} finally {$sha.Dispose();$stream.Dispose()} }
$before=PromptSourceHash;if($before -ne $ExpectedSha256.ToLowerInvariant()){throw 'Source hash differs.'}
$promptDoc=[Runtime.InteropServices.Marshal]::BindToMoniker($promptSource)
try {
 if($promptDoc.FullName -ne $promptSource -or !$promptDoc.Saved -or $promptDoc.Tables.Count -ne 6 -or $promptDoc.ContentControls.Count -ne 4 -or $promptDoc.Shapes.Count -ne 0 -or $promptDoc.InlineShapes.Count -ne 0){throw 'Wrong saved control document/state.'}
 $promptDoc.ExportAsFixedFormat($promptPdf,17)
 $data=@{sourceSha256=$before;sourceUnchanged=(PromptSourceHash) -eq $before;saved=[bool]$promptDoc.Saved;version=$promptDoc.Application.Version;build=$promptDoc.Application.Build;pages=$promptDoc.ComputeStatistics(2);tables=$promptDoc.Tables.Count;controls=$promptDoc.ContentControls.Count;pdfSha256=(Get-FileHash -LiteralPath $promptPdf -Algorithm SHA256).Hash.ToLowerInvariant()}
 if(!$data.sourceUnchanged -or !$data.saved -or $data.pages -ne 6){throw 'Source state or page count differs.'}
 $data | ConvertTo-Json | Set-Content -LiteralPath $promptMetadata -Encoding utf8
 Write-Output 'Recorded six original table prompt metric pages; source unchanged.'
} finally {[void][Runtime.InteropServices.Marshal]::ReleaseComObject($promptDoc)}
