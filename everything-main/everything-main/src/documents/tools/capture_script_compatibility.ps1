$ErrorActionPreference='Stop'
$probeRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/script-position-compatibility'))
$probeWord=$null;$probeDocument=$null
try {
 $probeBefore=@(Get-Process WINWORD -ErrorAction SilentlyContinue | ForEach-Object Id)
 $probeWord=New-Object -ComObject Word.Application
 $probeWord.Visible=$false;$probeWord.DisplayAlerts=0
 Get-Process WINWORD | Where-Object {$_.Id -notin $probeBefore} | ForEach-Object {Write-Output ('Owned reference PID: '+$_.Id)}
 foreach($mode in @(12,15)) {
  $source=Join-Path $probeRoot ('mode-'+$mode+'.docx')
  $probeDocument=$probeWord.Documents.Open($source,$false,$true)
  if($probeDocument.FullName -ne $source) {throw 'Wrong source'}
  if($probeDocument.Paragraphs.Count -ne 117) {throw ('Unexpected paragraph count '+$probeDocument.Paragraphs.Count)}
  Write-Output ('Opened '+$source+'; reference build '+$probeWord.Build+'; compatibility '+$probeDocument.CompatibilityMode)
  if($probeDocument.CompatibilityMode -ne $mode) {throw 'Wrong compatibility mode'}
  for($index=0;$index -lt 9;$index++) {
   $first=$probeDocument.Paragraphs.Item($index*13+1).Range.Start
   $last=$probeDocument.Paragraphs.Item($index*13+13).Range.End-1
   [IO.File]::WriteAllBytes((Join-Path $probeRoot ('mode-'+$mode+'-font-'+($index+1)+'.emf')),[byte[]]$probeDocument.Range($first,$last).EnhMetaFileBits)
   Write-Output ('Captured mode '+$mode+' font '+($index+1))
  }
  $probeDocument.Close([ref]0);$probeDocument=$null
 }
} finally {
 try {if($probeDocument) {$probeDocument.Close([ref]0)}}
 finally {if($probeWord) {$probeWord.Quit([ref]0)}}
}
