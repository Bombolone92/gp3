$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/multiparagraph-placeholder'))
$taskPath=Join-Path $taskRoot 'control.docx'
$taskWord=New-Object -ComObject Word.Application
$taskWord.Visible=$false
$taskWord.DisplayAlerts=0
try {
 $taskDoc=$taskWord.Documents.Open($taskPath,$false,$true)
 if($taskDoc.FullName -ne $taskPath){throw 'Wrong document'}
 $taskDoc.ExportAsFixedFormat((Join-Path $taskRoot 'native-before.pdf'),17)
 $taskResults=@()
 foreach($taskName in @('filled','showing')) {
  $taskControl=$taskDoc.SelectContentControlsByTitle($taskName).Item(1)
  $taskBefore=$taskControl.Range.Text
  if($taskName -eq 'showing'){$taskControl.Range.Text='Typed replacement'}
  $taskTyped=$taskControl.Range.Text
  $taskControl.Range.Text=''
  $taskResults+=@{name=$taskName;before=$taskBefore;typed=$taskTyped;restored=$taskControl.Range.Text;paragraphs=$taskControl.Range.Paragraphs.Count;placeholder=$taskControl.ShowingPlaceholderText}
 }
 $taskDoc.SaveAs2((Join-Path $taskRoot 'native-restored.docx'),12)
 $taskDoc.ExportAsFixedFormat((Join-Path $taskRoot 'native-restored.pdf'),17)
 @{referenceBuild=$taskWord.Build;cases=$taskResults} | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $taskRoot 'native-results.json')
 $taskDoc.Close([ref]0)
 $taskDoc=$taskWord.Documents.Open($taskPath,$false,$true)
 if($taskDoc.FullName -ne $taskPath){throw 'Wrong document'}
 $taskDoc.SelectContentControlsByTitle('showing').Item(1).Range.Text='Typed replacement'
 $taskTypedPath=Join-Path $taskRoot 'native-typed.docx'
 $taskDoc.SaveAs2($taskTypedPath,12)
 $taskDoc.Close([ref]0)
 $taskDoc=$taskWord.Documents.Open($taskTypedPath,$false,$true)
 if($taskDoc.FullName -ne $taskTypedPath){throw 'Wrong reopened document'}
 $taskDoc.SelectContentControlsByTitle('showing').Item(1).Range.Text=''
 $taskDoc.SaveAs2((Join-Path $taskRoot 'native-reopened-restored.docx'),12)
 $taskDoc.Close([ref]0)
}finally{$taskWord.Quit([ref]0)}
