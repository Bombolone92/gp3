# Native reference range edits on original, independent persistent-block controls.
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/persistent-block-controls'))
$taskPath=Join-Path $taskRoot 'control.docx'
$taskWord=New-Object -ComObject Word.Application
$taskWord.Visible=$false
$taskWord.DisplayAlerts=0
try {
 $taskDoc=$taskWord.Documents.Open($taskPath,$false,$true)
 if($taskDoc.FullName -ne $taskPath){throw 'Wrong document'}
 $taskDoc.ExportAsFixedFormat((Join-Path $taskRoot 'native-before.pdf'),17)
 $taskResults=@()
 foreach($taskName in @('insert','replace','delete-all','split','format','placeholder','temporary-false','two-paragraphs')) {
  $taskControl=$taskDoc.SelectContentControlsByTitle($taskName).Item(1)
  $taskBefore=$taskControl.Range.Text
  $taskRange=$taskControl.Range.Duplicate
  switch($taskName) {
   'insert' {$taskRange.SetRange($taskRange.Start+2,$taskRange.Start+2);$taskRange.Text='NEW '}
   'split' {$taskRange.SetRange($taskRange.Start+5,$taskRange.Start+5);$taskRange.Text="`r"}
   'format' {$taskRange.SetRange($taskRange.Start,$taskRange.Start+5);$taskRange.Font.Bold=-1}
   'delete-all' {$taskRange.Text=''}
   default {$taskRange.Text='Edited value'}
  }
  $taskRemaining=$taskDoc.SelectContentControlsByTitle($taskName)
  $taskResults+=@{name=$taskName;before=$taskBefore;count=$taskRemaining.Count;after=$(if($taskRemaining.Count){$taskRemaining.Item(1).Range.Text}else{''});placeholder=$(if($taskRemaining.Count){$taskRemaining.Item(1).ShowingPlaceholderText}else{$false})}
 }
 $taskDoc.SaveAs2((Join-Path $taskRoot 'native-edited.docx'),12)
 $taskDoc.ExportAsFixedFormat((Join-Path $taskRoot 'native-after.pdf'),17)
 @{referenceBuild=$taskWord.Build;cases=$taskResults} | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $taskRoot 'native-results.json')
 $taskDoc.Close([ref]0)
}finally{$taskWord.Quit([ref]0)}
