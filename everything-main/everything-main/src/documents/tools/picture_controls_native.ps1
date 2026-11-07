param([string]$OutputDirectory, [switch]$Placeholders)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/picture-controls'))
if($Placeholders){$root=Join-Path $root 'placeholders'}
if(!$OutputDirectory){throw 'Provide a scratch output directory'}
$out=[IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $out -Force | Out-Null
$word=New-Object -ComObject Word.Application;$word.Visible=$false;$word.DisplayAlerts=0
$results=@()
try {
 foreach($case in (Get-Content "$root/cases.json" -Raw | ConvertFrom-Json)) {
  $doc=$word.Documents.Open("$root/control.docx",$false,$true)
  try {
   if($doc.FullName -ne [IO.Path]::GetFullPath("$root/control.docx")){throw 'Wrong document'}
   if($results.Count -eq 0){$doc.ExportAsFixedFormat("$out/native.pdf",17)}
   $control=$doc.SelectContentControlsByTitle($case.name).Item(1);$errorText=$null
   try {
    $doc.Activate();$control.Range.Select()
    switch($case.action){
     'resize' {$control.Range.InlineShapes.Item(1).Width=90}
     'type' {$word.Selection.TypeText('Typed')}
     'delete' {$word.Selection.Delete() | Out-Null}
     'replace' {$doc.InlineShapes.AddPicture("$root/replacement.png",$false,$true,$control.Range) | Out-Null}
    }
   } catch {$errorText=$_.Exception.Message}
   $doc.SaveAs2("$out/$($case.name)-native.docx",16)
   $results+=@{name=$case.name;error=$errorText;controls=$doc.ContentControls.Count;pictures=$doc.InlineShapes.Count;text=$doc.Content.Text}
  } finally {$doc.Close([ref]0)}
 }
} finally {$word.Quit([ref]0)}
$results | ConvertTo-Json -Depth 5 | Set-Content "$out/results.json"
