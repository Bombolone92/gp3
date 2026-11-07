param([switch]$SkipPdf)
$ErrorActionPreference='Stop'
$folder=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/docpart-object'))
$source=Join-Path $folder 'control.docx'
$word=New-Object -ComObject Word.Application
$word.Visible=$false;$word.DisplayAlerts=0;$document=$null
try {
 $document=$word.Documents.Open($source,$false,$true)
 if($document.FullName -ne $source) {throw 'Wrong document opened'}
 Write-Output ('Confirmed open: '+$document.FullName)
 Write-Output ('Reference build: '+$word.Build)
 $document.Repaginate()
 Write-Output 'Repaginated'
 if(-not $SkipPdf) {$document.ExportAsFixedFormat((Join-Path $folder 'native.pdf'),17)}
 foreach($needle in @('Alpha','Beta','Gamma','Delta')) {
  $range=$document.Content.Duplicate
  if(-not $range.Find.Execute($needle)) {throw ('Missing '+$needle)}
  $range.Text=$needle+' edited'
  Write-Output ('Edited '+$needle)
 }
 [IO.File]::WriteAllText((Join-Path $folder 'native-edited.xml'),$document.Content.WordOpenXML)
 $record=@{build=$word.Build;sourceSha256=(Get-FileHash $source -Algorithm SHA256).Hash.ToLower();controls=$document.ContentControls.Count;text=$document.Content.Text;xmlSha256=(Get-FileHash (Join-Path $folder 'native-edited.xml') -Algorithm SHA256).Hash.ToLower()}
 $record | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 (Join-Path $folder 'native-edit-reference.json')
 Write-Output ('Controls after native edits: '+$document.ContentControls.Count)
} finally {
 try {if($document){$document.Close([ref]0)}} finally {$word.Quit([ref]0)}
}
