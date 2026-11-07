param([switch]$ExportPdf)
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/body-page-fields'))
$taskSource = Join-Path $taskRoot 'control.docx'
$taskCopy = Join-Path ([IO.Path]::GetTempPath()) ('body-page-fields-' + [guid]::NewGuid().ToString('N') + '.docx')
Copy-Item -LiteralPath $taskSource -Destination $taskCopy
$taskWord = New-Object -ComObject Word.Application
$taskWord.Visible = $false
$taskWord.DisplayAlerts = 0
$taskDoc = $null
$taskStages = @()
function Read-Fields($document, $stage) {
    $items = @()
    foreach ($field in $document.Fields) {
        [xml]$taskXml = $field.Result.WordOpenXML
        $taskNs = New-Object System.Xml.XmlNamespaceManager($taskXml.NameTable)
        $taskNs.AddNamespace('w', 'http://schemas.openxmlformats.org/wordprocessingml/2006/main')
        $items += @{ code=$field.Code.Text; result=$field.Result.Text; locked=$field.Locked;
            resultXml=$taskXml.SelectSingleNode('//w:body', $taskNs).OuterXml }
    }
    return @{ stage=$stage; fields=$items }
}
try {
    $taskDoc = $taskWord.Documents.Open($taskCopy, $false, $false)
    if ($taskDoc.FullName -ne $taskCopy -or $taskDoc.ReadOnly) { throw 'Wrong or read-only document' }
    Write-Output 'Recording fields immediately after open'
    $taskStages += Read-Fields $taskDoc 'open'
    $taskDoc.Repaginate()
    Write-Output 'Recording fields after repagination'
    $taskStages += Read-Fields $taskDoc 'repaginate'
    $taskUpdateResult = $taskDoc.Fields.Update()
    $taskDoc.Repaginate()
    Write-Output 'Recording explicitly updated fields'
    $taskStages += Read-Fields $taskDoc 'update'
    @{ referenceBuild=$taskWord.Build; sourceSha256=(Get-FileHash $taskSource -Algorithm SHA256).Hash;
       pages=$taskDoc.ComputeStatistics(2); updateResult=$taskUpdateResult; stages=$taskStages } |
        ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $taskRoot 'native-results.json')
    Write-Output 'Recorded field behavior'
    if ($ExportPdf) {
        $taskPdf = Join-Path $taskRoot 'native.pdf'
        $taskDoc.ExportAsFixedFormat($taskPdf, 17)
        Write-Output 'Exported native PDF'
    }
} finally {
    try { if ($null -ne $taskDoc) { $taskDoc.Close([ref]0) } }
    finally { $taskWord.Quit([ref]0) }
    Remove-Item -LiteralPath $taskCopy
}
