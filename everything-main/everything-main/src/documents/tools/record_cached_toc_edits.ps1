$ErrorActionPreference = 'Stop'
$taskSource = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../public/fixtures/toc-pageref.docx'))
$taskOutput = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/toc-pageref/native-edits.json'))
$taskWord = New-Object -ComObject Word.Application
$taskWord.Visible = $false
$taskWord.DisplayAlerts = 0
$taskWord.AutomationSecurity = 3
$taskRecords = @()
try {
    foreach ($taskName in @('entry', 'page', 'empty-page', 'heading', 'split-entry')) {
        $taskCopy = Join-Path ([IO.Path]::GetTempPath()) ('cached-toc-edit-' + [guid]::NewGuid().ToString('N') + '.docx')
        Copy-Item -LiteralPath $taskSource -Destination $taskCopy
        $taskDoc = $null
        try {
            Write-Output "Opening $taskName"
            $taskDoc = $taskWord.Documents.Open($taskCopy, $false, $false)
            if ($taskDoc.FullName -ne $taskCopy -or $taskDoc.ReadOnly) { throw 'Wrong or read-only document' }
            $taskToc = $taskDoc.TablesOfContents.Item(1).Range.Fields.Item(1)
            # The reference application's Fields collection also exposes each surrounding hyperlink
            # as a field, although the source XML uses w:hyperlink wrappers.
            $taskPage = $null
            foreach ($taskInner in $taskToc.Result.Fields) {
                if ($taskInner.Code.Text -match '^\s*PAGEREF\s') { $taskPage=$taskInner; break }
            }
            if ($null -eq $taskPage) { throw 'Missing nested PAGEREF' }
            $taskBefore = $taskToc.Result.Text
            Write-Output "Editing $taskName"
            switch ($taskName) {
                'entry' {
                    $taskRange = $taskToc.Result.Duplicate
                    if (-not $taskRange.Find.Execute('First topic')) { throw 'Missing cached label' }
                    $taskRange.Text = 'Manual entry'
                }
                'page' { $taskPage.Result.Text = '7' }
                'empty-page' { $taskPage.Result.Text = '' }
                'heading' {
                    $taskRange = $taskDoc.Paragraphs.Item(7).Range.Duplicate
                    if ($taskRange.Text.TrimEnd([char]13) -ne 'First topic') { throw 'Wrong heading' }
                    $taskRange.End = $taskRange.End-1
                    $taskRange.Text = 'Renamed heading'
                }
                'split-entry' {
                    $taskRange = $taskToc.Result.Duplicate
                    if (-not $taskRange.Find.Execute('First topic')) { throw 'Missing cached label' }
                    $taskRange.SetRange($taskRange.Start+5,$taskRange.Start+5)
                    $taskRange.Text = "`r"
                }
            }
            [xml]$taskXml = $taskDoc.Content.WordOpenXML
            $taskNs = New-Object System.Xml.XmlNamespaceManager($taskXml.NameTable)
            $taskNs.AddNamespace('w', 'http://schemas.openxmlformats.org/wordprocessingml/2006/main')
            $taskRecords += @{ name=$taskName; before=$taskBefore; result=$taskToc.Result.Text;
                instruction=$taskToc.Code.Text; nestedCount=$taskToc.Result.Fields.Count;
                documentXml=$taskXml.SelectSingleNode('//w:body',$taskNs).OuterXml }
            @{ referenceVersion=$taskWord.Version; referenceBuild=$taskWord.Build;
               sourceSha256=(Get-FileHash -LiteralPath $taskSource -Algorithm SHA256).Hash.ToLowerInvariant();
               cases=$taskRecords } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $taskOutput -Encoding UTF8
            Write-Output "Recorded $taskName"
        } finally {
            if ($null -ne $taskDoc) { $taskDoc.Close([ref]0) }
            Remove-Item -LiteralPath $taskCopy
        }
    }
} finally { $taskWord.Quit([ref]0) }
