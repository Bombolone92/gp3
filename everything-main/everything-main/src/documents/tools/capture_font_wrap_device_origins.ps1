param(
 [Parameter(Mandatory)][string]$ControlRoot,
 [switch]$CloseOwnedDocument
)
# Use a fresh scratch directory containing a copy of the original control.
# Open that exact copy with the document-opening helper before running this recorder.
# Only use -CloseOwnedDocument when you opened this copy for this capture.
$ErrorActionPreference='Stop'
$captureRoot=[IO.Path]::GetFullPath($ControlRoot)
$source=Join-Path $captureRoot 'control.docx'
$expected='a179a588f50de975048889cde3e4f37cc610777f4b7b9b85945ddcaf897c8aeb'
function SourceHash {
 $stream=[IO.File]::Open($source,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
 $algorithm=[Security.Cryptography.SHA256]::Create()
 try { ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
 finally { $algorithm.Dispose();$stream.Dispose() }
}
if ((SourceHash) -ne $expected) { throw 'Source differs' }
$document=[Runtime.InteropServices.Marshal]::BindToMoniker($source)
try {
 if ($document.FullName -ne $source) { throw 'Wrong open document' }
 if ($document.Paragraphs.Count -ne 16) { throw 'Paragraph count differs' }
 $savedBefore=$document.Saved
 $records=@()
 for ($index=1;$index -le 16;$index++) {
  $range=$document.Paragraphs.Item($index).Range
  $range.End=$range.End-1
  if ($range.Text -ne 'MMMM MMMM MMMM MMMM MMMM MMMM MMMM MMMM') { throw 'Unexpected paragraph' }
  $name='paragraph-'+$index+'.emf'
  $bits=[byte[]]$range.EnhMetaFileBits
  [IO.File]::WriteAllBytes((Join-Path $captureRoot $name),$bits)
  $records+=@{paragraph=$index;file=$name;length=$bits.Length;sha256=(Get-FileHash -LiteralPath (Join-Path $captureRoot $name)).Hash.ToLowerInvariant()}
  Write-Output ('Captured paragraph '+$index)
 }
 if ((SourceHash) -ne $expected) { throw 'Source changed' }
 @{sourceSha256=$expected;sourceUnchanged=$true;referenceBuild=$document.Application.Build;savedBefore=$savedBefore;savedAfter=$document.Saved;captures=$records} |
  ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $captureRoot 'capture.json') -Encoding UTF8
} finally {
 if ($CloseOwnedDocument -and $document -and $document.FullName -eq $source) { $document.Close([ref]0) }
 [void][Runtime.InteropServices.Marshal]::ReleaseComObject($document)
}
