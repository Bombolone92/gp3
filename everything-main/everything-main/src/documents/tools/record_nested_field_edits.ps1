$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/nested-page-fields'))
$taskSource = Join-Path $taskRoot 'control.docx'
$taskWord = New-Object -ComObject Word.Application
$taskWord.Visible = $false
$taskWord.DisplayAlerts = 0
$taskWord.AutomationSecurity = 3
$taskResults = @()
try {
    foreach ($taskCase in @(
        @{ name='insert'; outer=1; depth=1 },
        @{ name='replace'; outer=1; depth=1 },
        @{ name='delete-all'; outer=1; depth=1 },
        @{ name='split'; outer=1; depth=1 },
        @{ name='empty-start'; outer=5; depth=1 },
        @{ name='empty-end'; outer=6; depth=1 },
        @{ name='all-empty'; outer=7; depth=2 }
    )) {
        $taskCopy = Join-Path ([IO.Path]::GetTempPath()) ('nested-field-edit-' + [guid]::NewGuid().ToString('N') + '.docx')
        Copy-Item -LiteralPath $taskSource -Destination $taskCopy
        $taskDoc = $null
        try {
            $taskDoc = $taskWord.Documents.Open($taskCopy, $false, $false)
            if ($taskDoc.FullName -ne $taskCopy -or $taskDoc.ReadOnly) { throw 'Wrong or read-only document' }
            $taskOuter = $taskDoc.Paragraphs.Item($taskCase.outer+1).Range.Fields.Item(1)
            $taskField = $taskOuter
            for ($taskIndex=0; $taskIndex -lt $taskCase.depth; $taskIndex++) { $taskField = $taskField.Result.Fields.Item(1) }
            $taskRange = $taskField.Result.Duplicate
            switch ($taskCase.name) {
                'insert' { $taskRange.SetRange($taskRange.Start+1,$taskRange.Start+1); $taskRange.Text='X' }
                'replace' { $taskRange.Text='Edited' }
                'delete-all' { $taskRange.Text='' }
                'split' { $taskRange.SetRange($taskRange.Start+1,$taskRange.Start+1); $taskRange.Text="`r" }
                default { $taskRange.Text='Filled' }
            }
            [xml]$taskXml = $taskDoc.Content.WordOpenXML
            $taskNs = New-Object System.Xml.XmlNamespaceManager($taskXml.NameTable)
            $taskNs.AddNamespace('w','http://schemas.openxmlformats.org/wordprocessingml/2006/main')
            $taskResults += @{ name=$taskCase.name; outer=$taskCase.outer; depth=$taskCase.depth;
                outerCode=$taskOuter.Code.Text; outerResult=$taskOuter.Result.Text;
                innerCode=$taskField.Code.Text; innerResult=$taskField.Result.Text;
                documentXml=$taskXml.SelectSingleNode('//w:body',$taskNs).OuterXml }
            @{ referenceBuild=$taskWord.Build; sourceSha256=(Get-FileHash $taskSource -Algorithm SHA256).Hash;
               cases=$taskResults } | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $taskRoot 'native-edits.json')
            Write-Output "Recorded $($taskCase.name)"
        } finally {
            if ($null -ne $taskDoc) { $taskDoc.Close([ref]0) }
            Remove-Item -LiteralPath $taskCopy
        }
    }
} finally { $taskWord.Quit([ref]0) }
