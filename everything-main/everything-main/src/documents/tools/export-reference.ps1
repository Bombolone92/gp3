param(
  [Parameter(Mandatory=$true)][string]$SourceFullPath,
  [Parameter(Mandatory=$true)][string]$OutputPdf,
  [string]$OutputDocx
)
$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath $SourceFullPath).Path
$destination = [IO.Path]::GetFullPath($OutputPdf)
$normalized = if ($OutputDocx) { [IO.Path]::GetFullPath($OutputDocx) } else { $null }
if ($normalized -and $normalized -eq $source) { throw 'Native output must not overwrite the input document.' }
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$document = $null
$script:diagramCount = 0
function Initialize-Drawing($drawing, [bool]$canGroup, [int[]]$ancestorIds = @()) {
  if ($drawing.HasSmartArt -eq -1) {
    # The reference application can otherwise export later diagrams from stale saved drawing parts.
    # Reading AllNodes initializes layout without resetting user formatting.
    $null = $drawing.SmartArt.AllNodes.Count
    $script:diagramCount++
  }
  if ($canGroup -and $drawing.Type -eq 6) {
    # The reference application can expose a group as its own child through the COM collection.
    # Fail explicitly instead of overflowing the stack while initializing it.
    if ($ancestorIds -contains $drawing.ID) { throw 'The reference application exposed a cycle in drawing group IDs.' }
    $pathIds = @($ancestorIds) + @([int]$drawing.ID)
    $children = $drawing.GroupItems
    for ($childIndex = 1; $childIndex -le $children.Count; $childIndex++) {
      Initialize-Drawing ($children.Item($childIndex)) $true $pathIds
    }
  }
}
try {
  $document = $word.Documents.Open($source, $false, $true)
  if ($document.FullName -ne $source) { throw 'The reference application opened a different document.' }
  Write-Output ('Confirmed open in the reference application: ' + $document.FullName)
  Write-Output ('Reference version: ' + $word.Version + ' build ' + $word.Build)
  foreach ($drawing in $document.InlineShapes) { Initialize-Drawing $drawing $false }
  foreach ($drawing in $document.Shapes) { Initialize-Drawing $drawing $true }
  $document.Repaginate()
  $document.ExportAsFixedFormat($destination, 17)
  if ($normalized) { $document.SaveAs2($normalized, 16) }
  Write-Output ('Initialized main-story diagrams: ' + $script:diagramCount)
  Write-Output ('Pages: ' + $document.ComputeStatistics(2))
} finally {
  try { if ($null -ne $document) { $document.Close([ref]0) } }
  finally { $word.Quit([ref]0) }
}
