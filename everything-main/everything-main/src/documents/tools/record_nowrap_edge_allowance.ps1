param([string]$Fixture = 'nowrap-edge-allowance', [int]$Row = 1, [int]$Columns = 2)
# Read-only native reference observation; no editor layout or corpus input.
$ErrorActionPreference = 'Stop'
$fixtureRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../tests/fixtures/$Fixture"))
$source = Join-Path $fixtureRoot 'control.docx'
$pdf = Join-Path $fixtureRoot 'native.pdf'
function Read-CellWidths($document) {
    $tables = @()
    for ($i = 1; $i -le $document.Tables.Count; $i++) {
        $table = $document.Tables.Item($i)
        $widths = @()
        for ($j = 1; $j -le $Columns; $j++) { $widths += [double]$table.Cell($Row, $j).Width }
        $tables += ,$widths
        Write-Host "Recorded native table $i"
    }
    return ,$tables
}
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$document = $null
try {
    $document = $word.Documents.Open($source, $false, $true)
    if ($document.FullName -ne $source) { throw 'Incorrect source document' }
    Write-Host 'Confirmed source; repaginating'
    $document.Repaginate()
    Write-Host 'Reading logical cell widths'
    $before = Read-CellWidths $document
    $cases = Get-Content -LiteralPath (Join-Path $fixtureRoot 'cases.json') -Raw | ConvertFrom-Json
    if ($before.Count -ne $cases.Count) { throw 'Unexpected native matrix size' }
    $result = @{
        referenceVersion = $word.Version
        referenceBuild = $word.Build
        method = "Read-only open, Repaginate, Cell($Row,column).Width in points"
        widthsBeforePdf = $before
        hashes = @{}
    }
    foreach ($name in @('control.docx', 'cases.json')) {
        $result.hashes[$name] = (Get-FileHash -LiteralPath (Join-Path $fixtureRoot $name) -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    # Persist logical observations; this recorder does not export a PDF.
    $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $fixtureRoot 'native-widths.json') -Encoding UTF8
} finally {
    if ($null -ne $document) { $document.Close([ref]0) }
    $word.Quit([ref]0)
}
