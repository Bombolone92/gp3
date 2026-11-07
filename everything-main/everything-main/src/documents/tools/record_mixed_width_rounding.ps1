param([string]$FixtureDirectory = (Join-Path $PSScriptRoot '../tests/fixtures/mixed-width-rounding'))
$ErrorActionPreference='Stop'
$folder=(Resolve-Path -LiteralPath $FixtureDirectory).Path
$source=Join-Path $folder 'control.docx'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File '<work>\outputs\Open-OfficeDocument.ps1' $source
if ($LASTEXITCODE -ne 0) { throw 'Document-opening helper failed' }
$doc=[Runtime.InteropServices.Marshal]::BindToMoniker($source)
if ($doc.FullName -ne $source) { throw 'Wrong reference document' }
$doc.Repaginate()
Write-Output 'Reading native table widths'
$cases=Get-Content -LiteralPath (Join-Path $folder 'cases.json') -Raw | ConvertFrom-Json
if ($doc.Tables.Count -ne $cases.Count) { throw 'Unexpected table count' }
$rows=@()
for($i=0;$i -lt $cases.Count;$i++){
 $table=$doc.Tables.Item($i+1);$widths=@()
 $bodyRow=if($cases[$i].bodyRow){[int]$cases[$i].bodyRow}else{3}
 $columns=if($cases[$i].columns){[int]$cases[$i].columns}else{4}
 for($j=1;$j -le $columns;$j++) { $cell=$table.Cell($bodyRow,$j); $widthPt=$cell.Width; $widths+=[math]::Round($widthPt*20) }
 $row=@{}; foreach($property in $cases[$i].PSObject.Properties){$row[$property.Name]=$property.Value}; $row.widthTwips=$widths; $rows+=$row; Write-Output "Read case $($i+1)"
}
$hashes=@{}
foreach($name in @('control.docx','cases.json','native.pdf')) {
 if($name -eq 'native.pdf' -and !(Test-Path -LiteralPath (Join-Path $folder $name))){continue}
 $stream=[IO.File]::Open((Join-Path $folder $name),[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
 $sha=[Security.Cryptography.SHA256]::Create()
 try { $hashes[$name]=[BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','').ToLowerInvariant() } finally { $stream.Dispose(); $sha.Dispose() }
}
$result=@{referenceVersion=$doc.Application.Build;method='Read Cell(bodyRow,column).Width after Repaginate, without saving the source. PDF, when present, is an independently captured reference.';hashes=$hashes;sourceSavedAfterRead=$doc.Saved;rows=$rows} | ConvertTo-Json -Depth 8

[System.IO.File]::WriteAllText((Join-Path $folder 'reference.json'), $result, (New-Object System.Text.UTF8Encoding($false)))
