$ErrorActionPreference='Stop'
$folder=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/empty-inline-controls/glossary'))
$source=[string](Join-Path $folder 'control.docx')
$word=New-Object -ComObject Word.Application;$word.Visible=$false;$word.DisplayAlerts=0;$doc=$null;$results=@()
try {foreach($name in @('filled','showing')) {foreach($text in @('','X')){
 $doc=$word.Documents.Open($source,$false,$true);if($doc.FullName-ne $source){throw 'Wrong source'}
 $cc=$doc.SelectContentControlsByTitle($name).Item(1);$range=$doc.Range($cc.Range.Start-2,$cc.Range.End);$range.Text=$text
 $results+=@{name=$name;replacement=$text;after=$doc.Content.Text;controlText=$cc.Range.Text;placeholder=$cc.ShowingPlaceholderText}
 $destination=[string](Join-Path $folder ($name+'-'+$(if($text){'replace'}else{'delete'})+'-native.docx'));$doc.SaveAs2($destination,12)
 $doc.Close([ref]0);$doc=$null;Write-Output ($name+' '+$text+' saved')
 }}
 $results|ConvertTo-Json -Depth 5|Set-Content -Encoding utf8 (Join-Path $folder 'native-results.json')
}finally{if($null-ne $doc){$doc.Close([ref]0)};$word.Quit([ref]0)}
