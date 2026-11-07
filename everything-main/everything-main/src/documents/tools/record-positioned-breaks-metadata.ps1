# Open the exact independently authored control in the reference application first. Read-only COM metadata; no save, export, font access or application shutdown.
param([Parameter(Mandatory)][string]$Source)
$ErrorActionPreference='Stop'
$p=(Resolve-Path $Source).Path
$d=[Runtime.InteropServices.Marshal]::BindToMoniker($p)
if($d.FullName -ne $p){throw 'Exact source mismatch'}
$d.Repaginate()
$stream=[System.IO.File]::Open($p,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::ReadWrite)
$sha=[System.Security.Cryptography.SHA256]::Create();try{$sourceHash=[BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}finally{$stream.Dispose();$sha.Dispose()}
$r=[ordered]@{source=(Split-Path $p -Leaf);sourceSha256=$sourceHash;referenceVersion=$d.Application.Version;referenceBuild=$d.Application.Build;scope='Reference caret/anchor metadata in points. Picture origins derive from column/paragraph-or-line anchor origins plus numeric offsets; not glyph ink or PDF positions.';pages=$d.ComputeStatistics(2);pictures=@();labels=@()}
foreach($s in $d.Shapes){$r.pictures += [ordered]@{name=$s.Name;page=$s.Anchor.Information(3)-1;x=$s.Anchor.Information(5)+$s.Left;y=$s.Anchor.Information(6)+$s.Top;width=$s.Width;height=$s.Height;anchorStart=$s.Anchor.Start;anchorX=$s.Anchor.Information(5);anchorY=$s.Anchor.Information(6);offsetX=$s.Left;offsetY=$s.Top;baseH=$s.RelativeHorizontalPosition;baseV=$s.RelativeVerticalPosition}}
# Capture first-character caret origins for the four known labels without changing selection.
$r.labels=@()
foreach($label in @('Healthy heading','Before break','After break','Healthy ending')){$range=$d.Content.Duplicate;$range.Find.ClearFormatting();if(-not $range.Find.Execute($label)){throw "Label missing: $label"};$range.Collapse(1);$r.labels += [ordered]@{text=$label;page=$range.Information(3)-1;x=$range.Information(5);top=$range.Information(6)}}
$r|ConvertTo-Json -Depth 8|Set-Content -LiteralPath ($Source.Replace('.docx','-native.json')) -Encoding UTF8
[void][Runtime.InteropServices.Marshal]::ReleaseComObject($d)


