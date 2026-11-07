param(
    [Parameter(Mandatory=$true)][string]$OwnedSource,
    [Parameter(Mandatory=$true)][string]$ExpectedSourceSha256,
    [Parameter(Mandatory=$true)][string]$Output
)
$ErrorActionPreference='Stop'
$taskSource=[IO.Path]::GetFullPath($OwnedSource)
$taskOutput=[IO.Path]::GetFullPath($Output)
# Invoke the document-opening helper before inspecting a specific document.
& '<work>\outputs\Open-OfficeDocument.ps1' $taskSource -TimeoutSeconds 60
$taskDoc=[Runtime.InteropServices.Marshal]::BindToMoniker($taskSource)
if($taskDoc.FullName -ne $taskSource -or -not $taskDoc.Saved -or ($taskDoc.Content.Text -replace '[\x07\r\n\f]','') -ne '') {
    throw 'Expected the exact saved, empty, owned control; no document closed'
}
$taskSavedBefore=[bool]$taskDoc.Saved
try {
    # WordOpenXML is a read-only in-memory serialization. Retain only position
    # metadata, never its package contents or any embedded font program.
    [xml]$taskXml=$taskDoc.WordOpenXML
    $taskNs=New-Object Xml.XmlNamespaceManager($taskXml.NameTable)
    $taskNs.AddNamespace('w','http://schemas.openxmlformats.org/wordprocessingml/2006/main')
    $taskNodes=$taskXml.SelectNodes('//w:tbl',$taskNs)
    if($taskNodes.Count -ne $taskDoc.Tables.Count){throw 'XML/table count mismatch'}
    $taskTables=@()
    for($taskIndex=1;$taskIndex -le $taskDoc.Tables.Count;$taskIndex++) {
        $taskTable=$taskDoc.Tables.Item($taskIndex)
        $taskPosition=$taskNodes.Item($taskIndex-1).SelectSingleNode('w:tblPr/w:tblpPr',$taskNs)
        if($null -eq $taskPosition){throw 'Expected floating table positions'}
        $taskTables += [ordered]@{
            id=$taskIndex
            xPt=$taskTable.Rows.HorizontalPosition
            yPt=$taskTable.Rows.VerticalPosition
            heightPt=$taskTable.Rows.Height
            heightRule=$taskTable.Rows.HeightRule
            wrapAround=$taskTable.Rows.WrapAroundText
            memoryXTwips=$taskPosition.GetAttribute('tblpX',$taskNs.LookupNamespace('w'))
            memoryYTwips=$taskPosition.GetAttribute('tblpY',$taskNs.LookupNamespace('w'))
        }
    }
    $taskResult=[ordered]@{
        referenceBuild=$taskDoc.Application.Build
        savedBefore=$taskSavedBefore
        savedAfter=[bool]$taskDoc.Saved
        characters=($taskDoc.Content.Text -replace '[\x07\r\n\f]','')
        tables=$taskTables
    }
    if(-not $taskResult.savedAfter -or $taskResult.characters -ne ''){throw 'Owned source state changed'}
} finally {
    # Never close other documents or a changed document.
    if($taskDoc.FullName -eq $taskSource -and $taskDoc.Saved -and ($taskDoc.Content.Text -replace '[\x07\r\n\f]','') -eq ''){
        $taskDoc.Close([ref]0)
    }
}
$taskHash=(Get-FileHash -LiteralPath $taskSource -Algorithm SHA256).Hash.ToLowerInvariant()
if($taskHash -ne $ExpectedSourceSha256.ToLowerInvariant()){throw 'Post-close source hash changed'}
$taskResult.sourceSha256=$taskHash
$taskResult.sourceUnchanged=$true
$taskResult | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $taskOutput -Encoding utf8
Write-Output "Captured $($taskTables.Count) unchanged native table positions"
