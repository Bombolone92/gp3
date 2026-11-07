param(
 [string]$ControlRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/script-position-metrics'))
)
$ErrorActionPreference='Stop'
$controlRoot=[IO.Path]::GetFullPath($ControlRoot)
$cases=Get-Content (Join-Path $controlRoot 'cases.json') -Raw | ConvertFrom-Json
$expectedParagraphs=0
foreach ($case in $cases) { $expectedParagraphs+=1+@($case.rows).Count }
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ScriptPositionCapture {
 [DllImport("gdi32.dll",CharSet=CharSet.Unicode)] public static extern int AddFontResourceEx(string path,uint flags,IntPtr reserved);
 [DllImport("gdi32.dll",CharSet=CharSet.Unicode)] public static extern bool RemoveFontResourceEx(string path,uint flags,IntPtr reserved);
}
'@
$registered=@();$captureWord=$null;$captureDocument=$null
function Get-SharedCaptureHash([string]$Path) {
 $stream=[IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
 $algorithm=[Security.Cryptography.SHA256]::Create()
 try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
 finally { $algorithm.Dispose();$stream.Dispose() }
}
try {
 foreach ($name in (Get-Content (Join-Path $controlRoot 'fonts.json') -Raw | ConvertFrom-Json)) {
  if ([IO.Path]::GetFileName($name) -ne $name) { throw 'Expected a local font filename' }
  $fontPath=Join-Path $controlRoot $name
  if ([ScriptPositionCapture]::AddFontResourceEx($fontPath,0,[IntPtr]::Zero) -lt 1) { throw "Could not register $fontPath" }
  $registered+=$fontPath
 }
 $capturePidsBefore=@(Get-Process WINWORD -ErrorAction SilentlyContinue | ForEach-Object Id)
 $captureWord=New-Object -ComObject Word.Application
 $captureWord.Visible=$false;$captureWord.DisplayAlerts=0
 $created=@(Get-Process WINWORD | Where-Object { $_.Id -notin $capturePidsBefore })
 if ($created.Count -eq 1) { Write-Output ('Owned reference PID: '+$created[0].Id) }
 $source=Join-Path $controlRoot 'controls.docx'
 $sourceHash=Get-SharedCaptureHash $source
 $captureDocument=$captureWord.Documents.Open($source,$false,$true)
 if ($captureDocument.FullName -ne $source) { throw 'Wrong document opened' }
 if (-not $captureDocument.ReadOnly -or -not $captureDocument.Saved) { throw 'Expected an unchanged read-only capture source' }
 if ($captureDocument.Paragraphs.Count -ne $expectedParagraphs) { throw ('Paragraph count differs from cases.json: actual '+$captureDocument.Paragraphs.Count+', expected '+$expectedParagraphs) }
 Write-Output ('Confirmed read-only source: '+$captureDocument.FullName+'; reference build '+$captureWord.Build)
 $paragraphIndex=1
 $captureHashes=@{}
 for ($index=0;$index -lt $cases.Count;$index++) {
  $count=1+@($cases[$index].rows).Count
  $first=$captureDocument.Paragraphs.Item($paragraphIndex).Range.Start
  $last=$captureDocument.Paragraphs.Item($paragraphIndex+$count-1).Range.End-1
  $path=Join-Path $controlRoot ('native-font-'+($index+1)+'.emf')
  [IO.File]::WriteAllBytes($path,[byte[]]$captureDocument.Range($first,$last).EnhMetaFileBits)
  $captureHashes[[IO.Path]::GetFileName($path)]=Get-SharedCaptureHash $path
  Write-Output ('Captured font group '+($index+1))
  $paragraphIndex+=$count
 }
 $unchanged=(Get-SharedCaptureHash $source) -eq $sourceHash
 if (-not $unchanged -or -not $captureDocument.Saved) { throw 'Capture source changed' }
 [ordered]@{sourceSha256=$sourceHash;sourceUnchanged=$unchanged;referenceBuild=$captureWord.Build;readOnly=$captureDocument.ReadOnly;captures=$captureHashes} |
  ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $controlRoot 'native-capture.json') -Encoding UTF8
} finally {
 try {
  try { if ($captureDocument) { $captureDocument.Close([ref]0) } }
  finally { if ($captureWord) { $captureWord.Quit([ref]0) } }
 } finally {
  foreach ($fontPath in $registered) {
   if (-not [ScriptPositionCapture]::RemoveFontResourceEx($fontPath,0,[IntPtr]::Zero)) { Write-Warning "Could not remove temporary font registration: $fontPath" }
  }
 }
}
