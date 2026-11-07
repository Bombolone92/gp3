$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/section-fields'))
$taskWord = New-Object -ComObject Word.Application
$taskWord.Visible = $false
$taskWord.DisplayAlerts = 0
$taskResults = @()
try {
    foreach ($taskName in @('continuous', 'next-page')) {
        $taskSource = Join-Path $taskRoot ($taskName + '.docx')
        foreach ($taskAction in @('insert', 'split', 'format')) {
            $taskDoc = $null
            try {
                $taskDoc = $taskWord.Documents.Open($taskSource, $false, $true)
                if ($taskDoc.FullName -ne $taskSource) { throw 'Wrong document opened' }
                $taskRange = $taskDoc.Content.Duplicate
                $taskLabel = switch ($taskAction) { 'insert' {'C19 Result'}; 'split' {'C02 Result'}; 'format' {'C03 Cached'} }
                if (-not $taskRange.Find.Execute($taskLabel)) { throw 'Target not found' }
                if ($taskAction -eq 'format') { $taskRange.Font.Bold = -1 }
                else {
                    $taskRange.SetRange($taskRange.Start + 5, $taskRange.Start + 5)
                    $taskRange.Text = $(if ($taskAction -eq 'insert') {'X'} else {"`r"})
                }
                [xml]$taskXml = $taskDoc.Content.WordOpenXML
                $taskNs = New-Object System.Xml.XmlNamespaceManager($taskXml.NameTable)
                $taskNs.AddNamespace('w', 'http://schemas.openxmlformats.org/wordprocessingml/2006/main')
                $taskResults += @{source=$taskName; action=$taskAction; sourceSha256=(Get-FileHash $taskSource -Algorithm SHA256).Hash; sections=$taskDoc.Sections.Count; documentXml=$taskXml.SelectSingleNode('//w:body', $taskNs).OuterXml}
                Write-Output "Recorded $taskName $taskAction"
            } finally { if ($null -ne $taskDoc) { $taskDoc.Close([ref]0) } }
        }
    }
    @{referenceVersion=$taskWord.Version; referenceBuild=$taskWord.Build; cases=$taskResults} |
        ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $taskRoot 'native-edits.json')
} finally { $taskWord.Quit([ref]0) }
