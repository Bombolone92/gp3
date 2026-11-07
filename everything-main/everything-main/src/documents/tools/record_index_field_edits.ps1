$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/content-control-index-fields'))
$taskSource = Join-Path $taskRoot 'control.docx'
$taskWord = New-Object -ComObject Word.Application
$taskWord.Visible = $false
$taskWord.DisplayAlerts = 0
$taskResults = @()
try {
    foreach ($taskCase in @('plain-insert', 'temporary-insert', 'persistent-insert', 'temporary-format', 'temporary-replace', 'adjacent-insert')) {
        $taskDoc = $null
        try {
            $taskDoc = $taskWord.Documents.Open($taskSource, $false, $true)
            if ($taskDoc.FullName -ne $taskSource) { throw 'Wrong document opened' }
            $taskIndex = switch ($taskCase) { 'plain-insert' {1}; 'persistent-insert' {3}; 'adjacent-insert' {7}; default {2} }
            $taskRange = $taskDoc.Paragraphs.Item($taskIndex).Range.Duplicate
            if (-not $taskRange.Find.Execute('R')) { throw 'R not found' }
            switch ($taskCase) {
                'temporary-format' { $taskRange.Font.Bold = -1 }
                'temporary-replace' {
                    $taskRange = $taskDoc.ContentControls.Item(1).Range.Duplicate
                    $taskRange.Text = 'Replaced'
                }
                default { $taskRange.Collapse(1); $taskRange.Text = 'X' }
            }
            [xml]$taskXml = $taskDoc.Content.WordOpenXML
            $taskNs = New-Object System.Xml.XmlNamespaceManager($taskXml.NameTable)
            $taskNs.AddNamespace('w', 'http://schemas.openxmlformats.org/wordprocessingml/2006/main')
            $taskResults += @{name=$taskCase; paragraph=$taskIndex; documentXml=$taskXml.SelectSingleNode('//w:body', $taskNs).OuterXml}
            Write-Output "Recorded $taskCase"
        } finally { if ($null -ne $taskDoc) { $taskDoc.Close([ref]0) } }
    }
    @{referenceVersion=$taskWord.Version; referenceBuild=$taskWord.Build; sourceSha256=(Get-FileHash $taskSource -Algorithm SHA256).Hash; cases=$taskResults} |
        ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $taskRoot 'native-edits.json')
} finally { $taskWord.Quit([ref]0) }
