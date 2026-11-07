$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/hyperlink-fields'))
$taskSource=Join-Path $taskRoot 'control.docx'
$taskWord=New-Object -ComObject Word.Application
$taskWord.Visible=$false
$taskWord.DisplayAlerts=0
$taskWord.AutomationSecurity=3
$taskDoc=$null
try {
    $taskDoc=$taskWord.Documents.Open($taskSource,$false,$true)
    if($taskDoc.FullName -ne $taskSource){throw 'Wrong document'}
    $taskLinks=@()
    foreach($taskLink in $taskDoc.Hyperlinks){
        $taskLinks+=@{text=$taskLink.Range.Text;address=$taskLink.Address;anchor=$taskLink.SubAddress;tooltip=$taskLink.ScreenTip;frame=$taskLink.Target}
    }
    @{referenceBuild=$taskWord.Build;sourceSha256=(Get-FileHash -LiteralPath $taskSource -Algorithm SHA256).Hash.ToLowerInvariant();links=$taskLinks} |
        ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $taskRoot 'native-links.json')
    $taskLinks | ConvertTo-Json -Depth 4
}finally{if($taskDoc){$taskDoc.Close([ref]0)};$taskWord.Quit([ref]0)}
