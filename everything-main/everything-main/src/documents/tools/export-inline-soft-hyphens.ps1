param([ValidateSet(14,15)][int]$Mode=15)
# These original fixtures contain no SmartArt. Direct read-only export avoids
# The reference application's cyclic COM GroupItems enumeration for the simple one-child groups.
$ErrorActionPreference='Stop'
$fixtureRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/inline-soft-hyphens'))
$source=Join-Path $fixtureRoot "control$Mode.docx"
$destination=Join-Path $fixtureRoot "native$Mode-verified.pdf"
$temporaryPdf=Join-Path $fixtureRoot (([Guid]::NewGuid().ToString())+".pdf")
$word=New-Object -ComObject Word.Application
$word.Visible=$false
$word.DisplayAlerts=0
$document=$null
try {
 $document=$word.Documents.Open($source,$false,$true)
 if($document.FullName -ne $source){throw 'Incorrect document'}
 Write-Output ('Confirmed reference source: '+$document.FullName)
 Write-Output ('Reference version: '+$word.Version+' build '+$word.Build)
 $document.Repaginate()
 $document.ExportAsFixedFormat($temporaryPdf,17)
 Write-Output ('Pages: '+$document.ComputeStatistics(2))
} finally {if($null -ne $document){$document.Close([ref]0)};$word.Quit([ref]0)}
Move-Item -LiteralPath $temporaryPdf -Destination $destination -Force
