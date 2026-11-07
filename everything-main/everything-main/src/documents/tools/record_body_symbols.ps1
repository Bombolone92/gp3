$ErrorActionPreference='Stop'
$folder=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/body-symbols'))
$source=Join-Path $folder 'control.docx'
$word=New-Object -ComObject Word.Application
$word.Visible=$false;$word.DisplayAlerts=0;$document=$null
try {
 $document=$word.Documents.Open($source,$false,$true)
 if($document.FullName -ne $source){throw 'Wrong document opened'}
 Write-Output ('Confirmed open: '+$document.FullName)
 # Capture native.pdf separately with export-reference.ps1 before this edit probe.
 $results=@()
 foreach($i in 1..12) {
  $paragraph=$document.Paragraphs.Item($i).Range.Duplicate
  $range=$paragraph.Duplicate
  $range.SetRange($paragraph.Start+5,$paragraph.Start+6)
  Write-Output ('Selected case '+$i)
  $before=@{font=$range.Font.Name;code=[int][char]$range.Text[0]}
  switch($i) {
   6 {$range.Collapse(0);$range.Text='Z'}
   7 {$range.Text='Z'}
   8 {$range.Text=''}
   9 {$range.Font.Bold=-1}
   10 {$range.Font.Name='Courier New'}
   11 {$range.Font.Reset()}
   12 {$range.Collapse(1);$range.Text='Z'}
  }
  $results+=@{index=$i;before=$before;text=$document.Paragraphs.Item($i).Range.Text}
  Write-Output ('Recorded case '+$i)
 }
 [IO.File]::WriteAllText((Join-Path $folder 'native-edited.xml'),$document.Content.WordOpenXML)
 @{build=$word.Build;sourceSha256=(Get-FileHash $source -Algorithm SHA256).Hash.ToLower();pdfSha256=(Get-FileHash (Join-Path $folder 'native.pdf') -Algorithm SHA256).Hash.ToLower();xmlSha256=(Get-FileHash (Join-Path $folder 'native-edited.xml') -Algorithm SHA256).Hash.ToLower();cases=$results} | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 (Join-Path $folder 'reference.json')
 Write-Output 'Recorded 12 body-symbol cases'
} finally {try{if($document){$document.Close([ref]0)}}finally{$word.Quit([ref]0)}}
