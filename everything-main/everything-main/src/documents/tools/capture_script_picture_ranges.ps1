param([string]$Folder=(Join-Path $PSScriptRoot '../tests/fixtures/script-picture-leading'))
$ErrorActionPreference='Stop'
$proofSource=[IO.Path]::GetFullPath((Join-Path $Folder 'controls.docx'))
# Open this exact source in the reference application first. Never select or close another document.
$proofDoc=[Runtime.InteropServices.Marshal]::BindToMoniker($proofSource)
if($proofDoc.FullName -ne $proofSource){throw 'Wrong reference document'}
function Get-ProofHash {
 $stream=[IO.File]::Open($proofSource,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
 try { $hash=[Security.Cryptography.SHA256]::Create(); try{return ([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()} }finally{$stream.Dispose()}
}
$before=Get-ProofHash
if($proofDoc.Paragraphs.Count -ne 108 -or $proofDoc.InlineShapes.Count -ne 36){throw 'Wrong source structure'}
$rows=@(for($i=0;$i -lt 36;$i++){
 $caption=$proofDoc.Paragraphs.Item(3*$i+1)
 $picture=$proofDoc.Paragraphs.Item(3*$i+2)
 $after=$proofDoc.Paragraphs.Item(3*$i+3)
 [ordered]@{name=$caption.Range.Text.Trim();page=$after.Range.Information(3);captionTop=$caption.Range.Information(6);pictureTop=$picture.Range.Information(6);afterTop=$after.Range.Information(6);afterX=$after.Range.Information(5);afterHeight=$after.Format.LineSpacing;afterRule=$after.Format.LineSpacingRule;imageWidth=$picture.Range.InlineShapes.Item(1).Width;imageHeight=$picture.Range.InlineShapes.Item(1).Height}
})
if((Get-ProofHash) -ne $before){throw 'Source bytes changed during capture'}
$capture=[ordered]@{sourceSha256=$before;referenceBuild=$proofDoc.Application.Build;sourceSaved=$proofDoc.Saved;captureMethod='Exact document moniker; Range.Information page/x/y and inline dimensions; positions quantized to 0.75 pt';rows=$rows}
$capture | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 -LiteralPath (Join-Path $Folder 'native-range-capture.json')
Write-Output ('Captured '+$rows.Count+' native pages; '+$before)
