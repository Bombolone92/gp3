# Native edits on independent controls; never edits a corpus source.
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/temporary-control-bookmarks'))
$taskPath=Join-Path $taskRoot 'control.docx'
$taskWord=New-Object -ComObject Word.Application
$taskWord.Visible=$false
$taskWord.DisplayAlerts=0
$taskResults=@()
try {
 foreach($taskAction in @('baseline','format','insert','delete-bookmark')) {
  $taskDoc=$taskWord.Documents.Open($taskPath,$false,$true)
  if($taskDoc.FullName -ne $taskPath){throw 'Wrong source'}
  foreach($taskName in @('interior','boundary','point','hyperlink','crossing','placeholder','placeholder_inner','placeholder_crossing','placeholder_overlap')) {
   $taskControl=$taskDoc.SelectContentControlsByTitle($taskName).Item(1)
   $taskRange=$taskControl.Range.Duplicate
   # Reference character offsets include a hyperlink's field instructions. Locate
   # its visible result before applying the same visible-text edit as other cases.
   if($taskName -eq 'hyperlink' -and $taskAction -in @('format','insert')) {
    if(-not $taskRange.Find.Execute('Alpha beta')){throw 'Visible hyperlink text not found'}
   }
   switch($taskAction) {
    'format' {$taskRange.SetRange($taskRange.Start+1,$taskRange.Start+3);$taskRange.Font.Bold=-1}
    'insert' {if(-not $taskName.StartsWith('placeholder')){$taskRange.SetRange($taskRange.Start+4,$taskRange.Start+4)};$taskRange.Text='X'}
    'delete-bookmark' {$taskDoc.Bookmarks.Item('Mark_'+$taskName).Delete()}
   }
   $taskRemaining=$taskDoc.SelectContentControlsByTitle($taskName)
   $taskMark=$null
   if($taskDoc.Bookmarks.Exists('Mark_'+$taskName)) {
    $taskBookmark=$taskDoc.Bookmarks.Item('Mark_'+$taskName)
    $taskMark=@{start=$taskBookmark.Range.Start;end=$taskBookmark.Range.End;text=$taskBookmark.Range.Text}
   }
   $taskResults+=@{action=$taskAction;name=$taskName;controls=$taskRemaining.Count;bookmark=$taskMark}
  }
  $taskDoc.SaveAs2((Join-Path $taskRoot ($taskAction+'-native.docx')),12)
  if($taskAction -eq 'baseline'){$taskDoc.ExportAsFixedFormat((Join-Path $taskRoot 'native.pdf'),17)}
  $taskDoc.Close([ref]0)
 }
 @{referenceBuild=$taskWord.Build;cases=$taskResults} | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $taskRoot 'native-results.json')
}finally{$taskWord.Quit([ref]0)}
