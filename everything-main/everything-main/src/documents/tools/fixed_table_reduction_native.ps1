param([switch]$RowsOnly, [switch]$MarginsOnly)
$ErrorActionPreference = 'Stop'
$taskFolder = Join-Path $PSScriptRoot '../tests/fixtures/fixed-table-reduction'
$taskStem = if ($RowsOnly) { 'rows' } elseif ($MarginsOnly) { 'margins' } else { 'source' }
$taskOutput = if ($RowsOnly) { 'rows-native' } elseif ($MarginsOnly) { 'margins-native' } else { 'native' }
$taskSource = [IO.Path]::GetFullPath((Join-Path $taskFolder "$taskStem.docx"))
$taskPdf = [IO.Path]::GetFullPath((Join-Path $taskFolder "$taskOutput.pdf"))
$taskCasesFile = if ($RowsOnly) { 'rows-cases.json' } elseif ($MarginsOnly) { 'margins-cases.json' } else { 'cases.json' }
$taskCases = Get-Content (Join-Path $taskFolder $taskCasesFile) -Raw | ConvertFrom-Json
$taskWord = New-Object -ComObject Word.Application
$taskWord.Visible = $false
$taskWord.DisplayAlerts = 0
try {
    $taskDoc = $taskWord.Documents.Open($taskSource, $false, $true)
    if ($taskDoc.FullName -ne $taskSource) { throw 'Wrong document opened' }
    $taskTables = @()
    for ($i=1; $i -le $taskDoc.Tables.Count; $i++) {
        $taskWidths = @()
        foreach ($cell in $taskDoc.Tables.Item($i).Range.Cells) {
            $taskWidths += [ordered]@{ row=$cell.RowIndex; column=$cell.ColumnIndex; widthPt=$cell.Width }
        }
        $taskTables += [ordered]@{ name=$taskCases[$i-1].name; cells=$taskWidths }
    }
    $taskDoc.ExportAsFixedFormat($taskPdf,17)
    $taskReference = [ordered]@{
        referenceVersion=$taskWord.Version; referenceBuild=$taskWord.Build
        sourceSha256=(Get-FileHash $taskSource -Algorithm SHA256).Hash.ToLower()
        pdfSha256=(Get-FileHash $taskPdf -Algorithm SHA256).Hash.ToLower()
        tables=$taskTables
    }
    $taskReference | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $taskFolder "$taskOutput-reference.json")
    $taskDoc.Close([ref]0)
} finally { $taskWord.Quit([ref]0) }
