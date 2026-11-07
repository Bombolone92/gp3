param([Parameter(Mandatory=$true)][string]$OpenHelper)
$ErrorActionPreference='Stop'
$folder=Join-Path (Split-Path $PSScriptRoot -Parent) 'tests/fixtures/column-count'
$references=@{}
$helper=[IO.Path]::GetFullPath($OpenHelper)
foreach($f in Get-ChildItem -LiteralPath $folder -Filter '*.docx' | Where-Object { $_.Name -notlike '~$*' }) {
 $stream=[IO.File]::Open($f.FullName,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
 $hash=[Security.Cryptography.SHA256]::Create()
 try { $sourceHash=([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-','').ToLowerInvariant() } finally { $stream.Dispose(); $hash.Dispose() }
 & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $helper $f.FullName
 if($LASTEXITCODE -ne 0){throw 'Document-opening helper failed'}
 $d=[Runtime.InteropServices.Marshal]::BindToMoniker($f.FullName)
 if($d.FullName -ne $f.FullName){throw 'Unexpected document'}
 $d.Repaginate()
 $rows=@()
 foreach($p in $d.Paragraphs){
  $r=$p.Range.Duplicate
  $text=([string]$r.Text).Trim([char[]]@(13,7,14))
  while($r.Start -lt $r.End -and ([string]$r.Characters.First.Text) -eq [string][char]14){$r.Start=$r.Start+1}
  $r.Collapse(1)
  $rows+=@{text=$text;page=[int]$r.Information(3);x=[double]$r.Information(5);y=[double]$r.Information(6)}
 }
 $cols=@();foreach($c in $d.Sections.Item(1).PageSetup.TextColumns){$cols+=@{width=[double]$c.Width;space=[double]$c.SpaceAfter}}
 $data=@{source=$f.Name;sha256=$sourceHash;referenceVersion=$d.Application.Version;referenceBuild=$d.Application.Build;compatibilityMode=$d.CompatibilityMode;pages=$d.ComputeStatistics(2);rows=$rows;columns=$cols}
 $references[$f.BaseName]=$data
 Write-Output ($f.BaseName+': '+$data.pages+' pages '+$cols.Count+' columns')
 [void][Runtime.InteropServices.Marshal]::ReleaseComObject($d)
}

[IO.File]::WriteAllText((Join-Path $folder "reference.json"),($references|ConvertTo-Json -Depth 10),(New-Object Text.UTF8Encoding $false))
