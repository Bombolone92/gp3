# Native structural operations on the original, independently authored fixture.
# No SaveAs or PDF export: behavior is recorded before native file output.
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/persistent-cell-controls'))
$taskSource = Join-Path $taskRoot 'control.docx'
$taskWord = New-Object -ComObject Word.Application
$taskWord.Visible = $false
$taskWord.DisplayAlerts = 0
$taskResults = @()
function Read-ControlShape($document) {
    [xml]$taskXml = $document.Content.WordOpenXML
    $taskNs = New-Object System.Xml.XmlNamespaceManager($taskXml.NameTable)
    $taskNs.AddNamespace('w', 'http://schemas.openxmlformats.org/wordprocessingml/2006/main')
    $taskNode = $taskXml.SelectSingleNode('//w:sdt[w:sdtPr/w:alias[@w:val="insert"]]', $taskNs)
    if ($null -eq $taskNode) { return $null }
    return @{ parent=$taskNode.ParentNode.LocalName; contents=@($taskNode.SelectSingleNode('w:sdtContent', $taskNs).ChildNodes | ForEach-Object { $_.LocalName }); xml=$taskNode.OuterXml }
}
try {
    foreach ($taskName in @('merge-controlled-first', 'merge-reversed-arguments', 'merge-vertical', 'split-controlled', 'delete-controlled-row')) {
        $taskPath = Join-Path ([IO.Path]::GetTempPath()) ('persistent-cell-structure-' + [guid]::NewGuid().ToString('N') + '.docx')
        Copy-Item -LiteralPath $taskSource -Destination $taskPath
        $taskDoc = $null
        try {
            Write-Output "Opening case: $taskName"
            $taskDoc = $taskWord.Documents.Open($taskPath, $false, $false)
            if ($taskDoc.FullName -ne $taskPath -or $taskDoc.ReadOnly) { throw 'Wrong or read-only document' }
            $taskTable = $taskDoc.Tables.Item(1)
            if ($taskName -eq 'merge-vertical') {
                $null = $taskTable.Rows.Add()
                $taskTable.Cell(2,1).Range.Text = 'Lower neighbor'
            }
            $taskBefore = $taskTable.Range.Text
            $taskBeforeShape = Read-ControlShape $taskDoc
            $taskError = $null
            try {
                switch ($taskName) {
                    'merge-controlled-first' { $taskTable.Cell(1,1).Merge($taskTable.Cell(1,2)) }
                    'merge-reversed-arguments' { $taskTable.Cell(1,2).Merge($taskTable.Cell(1,1)) }
                    'merge-vertical' { $taskTable.Cell(1,1).Merge($taskTable.Cell(2,1)) }
                    'split-controlled' { $taskTable.Cell(1,1).Split(1,2) }
                    'delete-controlled-row' { $taskTable.Rows.Item(1).Delete() }
                }
            } catch { $taskError = $_.Exception.Message }
            $taskControls = $taskDoc.SelectContentControlsByTitle('insert')
            $taskAfter = if ($taskName -eq 'delete-controlled-row' -and !$taskError) { $null } else { $taskTable.Range.Text }
            $taskControlText = if ($taskControls.Count) { $taskControls.Item(1).Range.Text } else { $null }
            $taskResults += @{ name=$taskName; before=$taskBefore; after=$taskAfter; error=$taskError;
                beforeShape=$taskBeforeShape; afterShape=(Read-ControlShape $taskDoc);
                count=$taskControls.Count; controlText=$taskControlText; tableCount=$taskDoc.Tables.Count;
                cellCount=$(if ($null -ne $taskAfter) { $taskTable.Range.Cells.Count } else { 0 }) }
            @{ referenceBuild=$taskWord.Build; sourceSha256=(Get-FileHash $taskSource -Algorithm SHA256).Hash;
                cases=$taskResults } | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $taskRoot 'native-structure-results.json')
            Write-Output "Recorded case: $taskName"
        } finally {
            if ($null -ne $taskDoc) { $taskDoc.Close([ref]0) }
            Remove-Item -LiteralPath $taskPath
        }
    }
} finally { $taskWord.Quit([ref]0) }
