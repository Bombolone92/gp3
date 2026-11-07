# Measure minimum whole-twip widths in an owned, unsaved reference document.
$ErrorActionPreference='Stop'
$taskRoot=Join-Path $PSScriptRoot '../tests/fixtures/font-size-wrap-boundary'
$taskPath=[IO.Path]::GetFullPath((Join-Path $taskRoot 'control.docx'))
$taskCases=Get-Content (Join-Path $taskRoot 'cases.json') -Raw | ConvertFrom-Json
$taskWord=New-Object -ComObject Word.Application
$taskWord.Visible=$false
$taskWord.DisplayAlerts=0
try {
 $taskDoc=$taskWord.Documents.Open($taskPath,$false,$true)
 if($taskDoc.FullName -ne $taskPath){throw 'Wrong file'}
 $taskResults=@()
 for($taskIndex=0;$taskIndex -lt 16;$taskIndex+=2){
  $taskCase=$taskCases[$taskIndex]
  $taskPara=$taskDoc.Paragraphs.Item($taskIndex+1)
  $taskLow=[int]$taskCase.widthTwips-100
  $taskHigh=[int]$taskCase.widthTwips+100
  while($taskHigh-$taskLow -gt 1){
   $taskMid=[int][Math]::Floor(($taskLow+$taskHigh)/2)
   $taskPara.Format.RightIndent=648-$taskMid/20.0
   $taskDoc.Repaginate()
   $taskLines=$taskPara.Range.ComputeStatistics(1)
   if($taskLines -eq 1){$taskHigh=$taskMid}else{$taskLow=$taskMid}
  }
  $taskResults+=@{size=$taskCase.size;minWidth=$taskHigh/20.0;originalWidth=$taskCase.widthTwips/20.0}
 }
 @{sourceSha256=(Get-FileHash -LiteralPath $taskPath -Algorithm SHA256).Hash.ToLower();referenceBuild=$taskWord.Build;cases=$taskResults} | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $taskRoot 'native-width-thresholds.json')
 $taskDoc.Close([ref]0)
}finally{$taskWord.Quit([ref]0)}
