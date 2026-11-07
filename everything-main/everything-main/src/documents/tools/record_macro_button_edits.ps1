$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/macro-buttons'))
$taskSource=Join-Path $taskRoot 'editing.docx'
$taskWord=New-Object -ComObject Word.Application
$taskWord.Visible=$false
$taskWord.DisplayAlerts=0
$taskWord.AutomationSecurity=3
$taskRecords=@()
try {
    foreach($taskCase in @(
        @{name='select-replace';field=1},
        @{name='select-format';field=1},
        @{name='extend-right-replace';field=1},
        @{name='right-type';field=1},
        @{name='code-label-replace';field=1},
        @{name='select-replace-cached';field=4},
        @{name='select-replace-locked';field=5},
        @{name='select-replace-simple';field=6},
        @{name='select-replace-quoted';field=2},
        @{name='select-replace-split';field=3}
    )) {
        $taskCopy=Join-Path ([IO.Path]::GetTempPath()) ('macro-button-edit-'+[guid]::NewGuid().ToString('N')+'.docx')
        Copy-Item -LiteralPath $taskSource -Destination $taskCopy
        $taskDoc=$null
        try {
            $taskDoc=$taskWord.Documents.Open($taskCopy,$false,$false)
            if($taskDoc.FullName -ne $taskCopy -or $taskDoc.ReadOnly){throw 'Wrong or read-only document'}
            $taskField=$taskDoc.Fields.Item($taskCase.field)
            $taskBefore=@{code=$taskField.Code.Text;result=$taskField.Result.Text;count=$taskDoc.Fields.Count;start=$taskField.Code.Start-1;end=$taskField.Result.End}
            $taskField.Select()
            $taskSelection=$taskWord.Selection
            if($taskSelection.Document.FullName -ne $taskCopy){throw 'Selection belongs to another document'}
            switch($taskCase.name){
                'extend-right-replace' { $taskSelection.SetRange($taskBefore.start,$taskBefore.start);$null=$taskSelection.MoveRight(1,1,1) }
                'right-type' { $taskSelection.SetRange($taskBefore.start,$taskBefore.start);$null=$taskSelection.MoveRight(1,1,0) }
                'code-label-replace' {
                    $taskRange=$taskField.Code.Duplicate
                    $taskLabelAt=$taskRange.Text.IndexOf('[Last, First Name of Author]')
                    if($taskLabelAt -lt 0){throw 'Missing label'}
                    $taskSelection.SetRange($taskRange.Start+$taskLabelAt,$taskRange.End)
                }
            }
            $taskSelected=@{start=$taskSelection.Start;end=$taskSelection.End;text=$taskSelection.Text}
            if($taskCase.name -eq 'select-format'){$taskSelection.Font.Italic=-1}else{$taskSelection.TypeText('Author')}
            [xml]$taskXml=$taskDoc.Content.WordOpenXML
            $taskNs=[System.Xml.XmlNamespaceManager]::new($taskXml.NameTable)
            $taskNs.AddNamespace('w','http://schemas.openxmlformats.org/wordprocessingml/2006/main')
            $taskFields=@()
            foreach($taskRemaining in $taskDoc.Fields){$taskFields+=@{code=$taskRemaining.Code.Text;result=$taskRemaining.Result.Text}}
            $taskRecords+=@{name=$taskCase.name;field=$taskCase.field;before=$taskBefore;selected=$taskSelected;fieldCount=$taskDoc.Fields.Count;fields=$taskFields;documentXml=$taskXml.SelectSingleNode('//w:body',$taskNs).OuterXml}
            @{referenceBuild=$taskWord.Build;sourceSha256=(Get-FileHash -LiteralPath $taskSource -Algorithm SHA256).Hash.ToLowerInvariant();cases=$taskRecords} |
                ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $taskRoot 'native-edits.json')
            Write-Output "Recorded $($taskCase.name)"
        }finally{if($taskDoc){$taskDoc.Close([ref]0)};Remove-Item -LiteralPath $taskCopy}
    }
}finally{$taskWord.Quit([ref]0)}
