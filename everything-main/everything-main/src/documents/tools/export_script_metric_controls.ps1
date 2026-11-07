$ErrorActionPreference='Stop'
$controlRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/script-metric-controls'))
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ScriptMetricFonts {
 [DllImport("gdi32.dll",CharSet=CharSet.Unicode)] public static extern int AddFontResourceEx(string path,uint flags,IntPtr reserved);
 [DllImport("gdi32.dll",CharSet=CharSet.Unicode)] public static extern bool RemoveFontResourceEx(string path,uint flags,IntPtr reserved);
}
'@
$registered=@();$controlWord=$null;$controlDocument=$null
try {
 foreach ($name in (Get-Content (Join-Path $controlRoot 'fonts.json') -Raw | ConvertFrom-Json)) {
  if ([IO.Path]::GetFileName($name) -ne $name) { throw 'Expected a local font filename' }
  $fontPath=Join-Path $controlRoot $name
  if ([ScriptMetricFonts]::AddFontResourceEx($fontPath,0,[IntPtr]::Zero) -lt 1) { throw "Could not register $fontPath" }
  $registered+=$fontPath
 }
 $controlWord=New-Object -ComObject Word.Application
 $controlWord.Visible=$false;$controlWord.DisplayAlerts=0
 $source=Join-Path $controlRoot 'controls.docx'
 $controlDocument=$controlWord.Documents.Open($source,$false,$true)
 if ($controlDocument.FullName -ne $source) { throw 'Wrong document opened' }
 Write-Output ('Confirmed open: '+$controlDocument.FullName)
 Write-Output ('Reference build: '+$controlWord.Build)
 $controlDocument.ExportAsFixedFormat((Join-Path $controlRoot 'controls-native.pdf'),17)
 Write-Output ('Pages: '+$controlDocument.ComputeStatistics(2))
} finally {
 if ($controlDocument) { $controlDocument.Close([ref]0) }
 if ($controlWord) { $controlWord.Quit([ref]0) }
 foreach ($fontPath in $registered) {
  if (-not [ScriptMetricFonts]::RemoveFontResourceEx($fontPath,0,[IntPtr]::Zero)) { Write-Warning "Could not remove temporary font registration: $fontPath" }
 }
}
