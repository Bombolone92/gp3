param([Parameter(Mandatory=$true)][string]$Source, [Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference='Stop'
. "$PSScriptRoot/find_owned_native_document.ps1"
function SourceHash($path) {
  $stream=[IO.File]::Open($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
  $algorithm=[Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
  finally { $stream.Dispose(); $algorithm.Dispose() }
}
$path=[IO.Path]::GetFullPath($Source).Replace([IO.Path]::AltDirectorySeparatorChar,[IO.Path]::DirectorySeparatorChar); $hash=SourceHash $path
$doc=Find-OwnedWordDocument $path
try {
  $saved=[bool]$doc.Saved; $view=[int]$doc.ActiveWindow.View.Type; $zoom=[int]$doc.ActiveWindow.View.Zoom.Percentage
  $start=[int]$doc.ActiveWindow.Selection.Start; $end=[int]$doc.ActiveWindow.Selection.End
  $range=$doc.Content; $errors=@()
  try {
    for($i=1;$i -le $range.SpellingErrors.Count;$i++) {
      $item=$range.SpellingErrors.Item($i)
      try { $errors+=@{word=[string]$item.Text;start=[int]$item.Start;end=[int]$item.End} }
      finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($item) }
    }
  } finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($range) }
  if($saved -ne [bool]$doc.Saved -or $view -ne [int]$doc.ActiveWindow.View.Type -or $zoom -ne [int]$doc.ActiveWindow.View.Zoom.Percentage -or $start -ne [int]$doc.ActiveWindow.Selection.Start -or $end -ne [int]$doc.ActiveWindow.Selection.End -or $hash -ne (SourceHash $path)) { throw 'Source or native view/selection/save state changed.' }
  [ordered]@{sourceSha256=$hash;referenceBuild=[string]$doc.Application.Build;errors=$errors;savedUnchanged=$true;viewUnchanged=$true;zoomUnchanged=$true;selectionUnchanged=$true;sourceUnchanged=$true} | ConvertTo-Json -Depth 10 | Set-Content -Encoding utf8 -LiteralPath $Output
} finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($doc) }
