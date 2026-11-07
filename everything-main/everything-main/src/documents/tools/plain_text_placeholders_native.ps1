$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/plain-text-controls'))
$word=New-Object -ComObject Word.Application;$word.Visible=$false;$word.DisplayAlerts=0
try {
 foreach($name in @('temp-prompt','persistent-prompt')) {
  $doc=$word.Documents.Open("$root/placeholders.docx",$false,$true)
  try {
   if($doc.FullName -ne [IO.Path]::GetFullPath("$root/placeholders.docx")){throw 'Wrong document'}
   $control=$doc.SelectContentControlsByTitle($name).Item(1);$start=$control.Range.Start
   $doc.Activate();$range=$doc.Range($start+2,$start+4);$range.Select();$word.Selection.Font.Bold=-1
   $doc.SaveAs2("$root/$name-selection2-formatted-native.docx",16)
   $word.Selection.TypeText('Entered')
   $doc.SaveAs2("$root/$name-selection2-entered-native.docx",16)
  } finally {$doc.Close([ref]0)}
 }
} finally {$word.Quit([ref]0)}



