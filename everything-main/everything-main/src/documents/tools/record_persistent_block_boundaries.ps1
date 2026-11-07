$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/persistent-block-controls'))
$taskSource=Join-Path $taskRoot 'control.docx'
$taskWord=New-Object -ComObject Word.Application
$taskWord.Visible=$false;$taskWord.DisplayAlerts=0
$taskResults=@()
try {
 foreach($taskCase in @('cross-start','cross-end','cover','start','end')) {
  $taskDoc=$taskWord.Documents.Open($taskSource,$false,$true)
  if($taskDoc.FullName -ne $taskSource){throw 'Wrong source'}
  $taskControl=$taskDoc.SelectContentControlsByTitle('replace').Item(1)
  $taskStart=$taskControl.Range.Start;$taskEnd=$taskControl.Range.End
  $taskRange=$taskDoc.Range($taskStart,$taskEnd)
  switch($taskCase){
   'cross-start' {$taskRange.SetRange($taskStart-2,$taskStart+2)}
   'cross-end' {$taskRange.SetRange($taskEnd-2,$taskEnd+2)}
   'cover' {$taskRange.SetRange($taskStart-1,$taskEnd+1)}
   'start' {$taskRange.SetRange($taskStart,$taskStart)}
   'end' {$taskRange.SetRange($taskEnd,$taskEnd)}
  }
  $taskError=''
  try{$taskRange.Text='X'}catch{$taskError=$_.Exception.Message}
  $taskRemaining=$taskDoc.SelectContentControlsByTitle('replace')
  $taskResults+=@{name=$taskCase;count=$taskRemaining.Count;error=$taskError;text=$(if($taskRemaining.Count){$taskRemaining.Item(1).Range.Text}else{''})}
  $taskDoc.SaveAs2((Join-Path $taskRoot "boundaries\$taskCase-word.docx"),12)
  $taskDoc.Close([ref]0)
 }
 $taskResults | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $taskRoot 'boundaries/native-results.json')
}finally{$taskWord.Quit([ref]0)}
