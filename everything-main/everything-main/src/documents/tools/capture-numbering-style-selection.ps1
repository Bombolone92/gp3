param([string]$Directory=(Join-Path $PSScriptRoot '../tests/fixtures/numbering-style-bindings'))
$ErrorActionPreference='Stop'
$folder=[IO.Path]::GetFullPath($Directory);$source=Join-Path $folder 'control.docx'
$cases=Get-Content -Raw -LiteralPath (Join-Path $folder 'cases.json') | ConvertFrom-Json
$word=New-Object -ComObject Word.Application;$word.Visible=$false;$word.DisplayAlerts=0;$doc=$null
try{$doc=$word.Documents.Open($source,$false,$true);if($doc.FullName -ne $source){throw 'Wrong source'};$doc.Repaginate();$results=@()
for($i=0;$i -lt $cases.Count;$i++){$p=$doc.Paragraphs.Item($i+1);$results+=@{index=$i;text=$p.Range.Text.Trim();marker=$p.Range.ListFormat.ListString;listType=$p.Range.ListFormat.ListType;level=$p.Range.ListFormat.ListLevelNumber;left=$p.Format.LeftIndent;first=$p.Format.FirstLineIndent};Write-Output ($i.ToString()+' '+$cases[$i].name+' marker='+$p.Range.ListFormat.ListString+' level='+$p.Range.ListFormat.ListLevelNumber)}
$doc.ExportAsFixedFormat((Join-Path $folder 'native.pdf'),17)
@{sourceSha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $source).Hash.ToLower();referenceBuild=$word.Build;cases=$results}|ConvertTo-Json -Depth 6|Set-Content -Encoding utf8 -LiteralPath (Join-Path $folder 'native.json')
}finally{try{if($doc){$doc.Close([ref]0)}}finally{$word.Quit([ref]0)}}
