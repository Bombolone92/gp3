param([string]$Source=(Join-Path $PSScriptRoot '../public/fixtures/theme-color-precision.docx'), [string]$Output=(Join-Path $PSScriptRoot '../tests/fixtures/theme-color-precision/native-api-colors.json'), [int]$ExpectedCount=128)
$ErrorActionPreference='Stop'
$taskSource=(Resolve-Path -LiteralPath $Source).Path
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File '<work>\outputs\Open-OfficeDocument.ps1' $taskSource
if($LASTEXITCODE -ne 0){throw 'Document-opening helper failed'}
function Read-Hash([string]$path){$stream=[IO.File]::Open($path,'Open','Read','ReadWrite');try{return (Get-FileHash -InputStream $stream -Algorithm SHA256).Hash.ToLowerInvariant()}finally{$stream.Dispose()}}
$taskHash=Read-Hash $taskSource
$taskWord=New-Object -ComObject Word.Application
$taskWord.Visible=$false;$taskWord.DisplayAlerts=0
$taskDocument=$null;$taskRows=@()
try{
 $taskDocument=$taskWord.Documents.Open($taskSource,$false,$true)
 if($taskDocument.FullName -ne $taskSource){throw 'The reference application opened a different source'}
 $taskDocument.Repaginate()
 foreach($taskParagraph in $taskDocument.Paragraphs){
  $taskLabel=$taskParagraph.Range.Text.Trim([char]13,[char]7)
  if($taskLabel -notmatch '^C\d+$'){continue}
  $taskRange=$taskParagraph.Range.Duplicate
  $taskRange.End=$taskRange.Start+1
  $taskColor=$taskRange.Font.TextColor
  $taskRow=[ordered]@{label=$taskLabel;rgbProperty=[int]$taskColor.RGB;tintAndShade=[double]$taskColor.TintAndShade;type=[int]$taskColor.Type;theme=[int]$taskColor.ObjectThemeColor}
  try{$taskRow.brightness=[double]$taskColor.Brightness}catch{$taskRow.brightnessError=$_.Exception.Message}
  $taskRows += $taskRow
  [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskRange)
 }
 if($taskRows.Count -ne $ExpectedCount){throw 'Incomplete native API capture'}
 [ordered]@{sourceSha256=$taskHash;referenceBuild=$taskWord.Build;rows=$taskRows;scope='Native ColorFormat getters; rgbProperty retains the returned theme-bearing integer, not a resolved RGB triplet. Read-only capture with unchanged source hash.'}|ConvertTo-Json -Depth 8|Set-Content -Encoding UTF8 -LiteralPath $Output
}finally{
 if($taskDocument){$taskDocument.Close([ref]0);[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskDocument)}
 $taskWord.Quit([ref]0);[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskWord)
}
if((Read-Hash $taskSource)-ne$taskHash){throw 'Source changed'}
Write-Output ('Recorded '+$taskRows.Length+' native API colors without changing the source')
