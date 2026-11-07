$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/body-page-fields'))
$taskSource = Join-Path $taskRoot 'control.docx'
$taskWord = New-Object -ComObject Word.Application
$taskWord.Visible = $false
$taskWord.DisplayAlerts = 0
$taskResults = @()
try {
    foreach ($taskName in @('insert', 'replace', 'delete-all', 'split', 'format')) {
        $taskCopy = Join-Path ([IO.Path]::GetTempPath()) ('body-field-edit-' + [guid]::NewGuid().ToString('N') + '.docx')
        Copy-Item -LiteralPath $taskSource -Destination $taskCopy
        $taskDoc = $null
        try {
            $taskDoc = $taskWord.Documents.Open($taskCopy, $false, $false)
            if ($taskDoc.FullName -ne $taskCopy -or $taskDoc.ReadOnly) { throw 'Wrong or read-only document' }
            $taskField = $taskDoc.Fields.Item(1)
            $taskRange = $taskField.Result.Duplicate
            $taskError = $null
            try {
                switch ($taskName) {
                    'insert' { $taskRange.SetRange($taskRange.Start+1,$taskRange.Start+1); $taskRange.Text='X' }
                    'replace' { $taskRange.Text='Edited' }
                    'delete-all' { $taskRange.Text='' }
                    'split' { $taskRange.SetRange($taskRange.Start+1,$taskRange.Start+1); $taskRange.Text="`r" }
                    'format' { $taskRange.Font.Italic=-1 }
                }
            } catch { $taskError=$_.Exception.Message }
            [xml]$taskXml = $taskDoc.Content.WordOpenXML
            $taskNs = New-Object System.Xml.XmlNamespaceManager($taskXml.NameTable)
            $taskNs.AddNamespace('w','http://schemas.openxmlformats.org/wordprocessingml/2006/main')
            $taskResults += @{ name=$taskName; error=$taskError; fieldCount=$taskDoc.Fields.Count;
                firstCode=$taskDoc.Fields.Item(1).Code.Text; firstResult=$taskDoc.Fields.Item(1).Result.Text;
                documentXml=$taskXml.SelectSingleNode('//w:body',$taskNs).OuterXml }
            @{ referenceBuild=$taskWord.Build; sourceSha256=(Get-FileHash $taskSource -Algorithm SHA256).Hash;
               cases=$taskResults } | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $taskRoot 'native-edits.json')
            Write-Output "Recorded $taskName"
        } finally {
            if ($null -ne $taskDoc) { $taskDoc.Close([ref]0) }
            Remove-Item -LiteralPath $taskCopy
        }
    }
} finally { $taskWord.Quit([ref]0) }
