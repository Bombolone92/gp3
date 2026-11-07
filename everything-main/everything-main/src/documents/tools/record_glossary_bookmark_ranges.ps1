# Capture native ranges directly; no corpus files are edited.
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/glossary-bookmarks'))
$taskWord=New-Object -ComObject Word.Application
$taskWord.Visible=$false
$taskWord.DisplayAlerts=0
$taskResults=@()
try {
 $taskDoc=$taskWord.Documents.Open((Join-Path $taskRoot 'control.docx'),$false,$true)
 foreach($taskAction in @('restore','replace','restore-again')) {
  foreach($taskName in @('whole','inner','point','shared','block')) {
   $taskControl=$taskDoc.SelectContentControlsByTitle($taskName).Item(1)
   $taskControl.Range.Text=$(if($taskAction -eq 'replace'){'New value'}else{''})
   $taskBookmarks=@()
   for($taskIndex=1;$taskIndex -le $taskDoc.Bookmarks.Count;$taskIndex++) {
    $taskBookmark=$taskDoc.Bookmarks.Item($taskIndex)
    $taskBookmarks+=@{name=$taskBookmark.Name;text=$taskBookmark.Range.Text;start=$taskBookmark.Range.Start;end=$taskBookmark.Range.End}
   }
   $taskItem=@{action=$taskAction;name=$taskName;text=$taskControl.Range.Text;placeholder=$taskControl.ShowingPlaceholderText;controlStart=$taskControl.Range.Start;controlEnd=$taskControl.Range.End;controlBookmarks=$taskControl.Range.Bookmarks.Count;bookmarks=$taskBookmarks}
   $taskResults+=$taskItem
   Write-Output ($taskAction+' '+$taskName+' captured')
   @{referenceBuild=$taskWord.Build;sourceSha256=(Get-FileHash (Join-Path $taskRoot 'control.docx') -Algorithm SHA256).Hash.ToLowerInvariant();cases=$taskResults} | ConvertTo-Json -Depth 7 | Set-Content -Encoding utf8 (Join-Path $taskRoot 'native-ranges-cycle.json')
  }
 }
 $taskDoc.Close([ref]0)
}finally{$taskWord.Quit([ref]0)}
