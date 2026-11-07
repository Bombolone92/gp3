$ErrorActionPreference='Stop'
$folder=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/nested-persistent-blocks'))
$source=Join-Path $folder 'control.docx'
$word=New-Object -ComObject Word.Application
$word.Visible=$false;$word.DisplayAlerts=0;$document=$null
try {
 $document=$word.Documents.Open($source,$false,$true)
 if($document.FullName -ne $source){throw 'Wrong document opened'}
 Write-Output ('Confirmed open: '+$document.FullName)
 $document.Repaginate()
 $cases=@()
 foreach($name in @('insert','delete-inner','split','replace-outer','delete-outer','temporary-inner','temporary-outer')) {
  $title=$name+$(if($name -in @('replace-outer','delete-outer')){' outer'}else{' inner'})
  $range=$document.SelectContentControlsByTitle($title).Item(1).Range.Duplicate
  switch($name) {
   'insert' {$range.SetRange($range.Start+2,$range.Start+2);$range.Text='NEW '}
   'split' {$range.SetRange($range.Start+5,$range.Start+5);$range.Text="`r"}
   'delete-inner' {$range.Text=''}
   'delete-outer' {$range.Text=''}
   default {$range.Text='Edited value'}
  }
  $items=@()
  foreach($part in @('outer','inner')) {
   $controls=$document.SelectContentControlsByTitle($name+' '+$part)
   $items+=@{part=$part;count=$controls.Count;text=$(if($controls.Count){$controls.Item(1).Range.Text}else{''});placeholder=$(if($controls.Count){$controls.Item(1).ShowingPlaceholderText}else{$false})}
  }
  $cases+=@{name=$name;controls=$items}
  Write-Output ('Recorded '+$name)
 }
 [IO.File]::WriteAllText((Join-Path $folder 'native-edited.xml'),$document.Content.WordOpenXML)
 @{build=$word.Build;sourceSha256=(Get-FileHash $source -Algorithm SHA256).Hash.ToLower();xmlSha256=(Get-FileHash (Join-Path $folder 'native-edited.xml') -Algorithm SHA256).Hash.ToLower();cases=$cases} | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 (Join-Path $folder 'reference.json')
} finally {try{if($document){$document.Close([ref]0)}}finally{$word.Quit([ref]0)}}
