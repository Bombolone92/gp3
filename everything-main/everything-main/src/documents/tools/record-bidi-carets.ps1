param([string]$Root = (Join-Path $PSScriptRoot '../tests/fixtures/bidi-layout'))
$ErrorActionPreference='Stop'
$rootPath=(Resolve-Path -LiteralPath $Root).Path
$source=Join-Path $rootPath 'control.docx'
$word=New-Object -ComObject Word.Application
$word.Visible=$false
$word.DisplayAlerts=0
$document=$null
try {
  $document=$word.Documents.Open($source,$false,$true)
  if($document.FullName -ne $source){throw 'The reference application opened a different source'}
  $document.Repaginate()
  $result=@()
  foreach($index in @(7,9,11,14,15,16,17)){
    $p=$document.Paragraphs.Item(2*$index+2).Range
    $stops=@()
    for($i=$p.Start;$i -lt $p.End;$i++){
      $r=$document.Range($i,$i)
      $x=$r.Information(5);$y=$r.Information(6)
      if($x -lt 0 -or $y -lt 0){throw 'Reference range geometry unavailable; do not record -1 as a caret'}
      $stops+=@{offset=$i-$p.Start;x=$x;y=$y;page=$r.Information(3)}
    }
    $result+=@{index=$index;text=$p.Text;start=$p.Start;stops=$stops}
  }
  $data=@{referenceVersion=[string]$word.Build;zoom=$document.ActiveWindow.View.Zoom.Percentage;
    sourceSha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLower();cases=$result}
  $json=($data|ConvertTo-Json -Depth 8)+"`n"
  [IO.File]::WriteAllText((Join-Path $rootPath 'native-carets.json'),$json,(New-Object Text.UTF8Encoding $false))
  Write-Output 'Recorded collapsed native reference range positions.'
} finally {
  try {if($null -ne $document){$document.Close([ref]0)}} finally {$word.Quit([ref]0)}
}
