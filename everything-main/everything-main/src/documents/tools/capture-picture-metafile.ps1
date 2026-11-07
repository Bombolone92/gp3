param(
 [Parameter(Mandatory=$true)][string]$SourceFullPath,
 [Parameter(Mandatory=$true)][string]$OutputEmf,
 [int]$InlineIndex=1
)
$ErrorActionPreference='Stop'
$source=(Resolve-Path -LiteralPath $SourceFullPath).Path
$destination=[IO.Path]::GetFullPath($OutputEmf)
$word=New-Object -ComObject Word.Application
$word.Visible=$false;$word.DisplayAlerts=0;$document=$null
try {
 $document=$word.Documents.Open($source,$false,$true)
 if($document.FullName -ne $source){throw 'The reference application opened a different document.'}
 $document.Repaginate()
 [IO.File]::WriteAllBytes($destination,[byte[]]$document.InlineShapes.Item($InlineIndex).Range.EnhMetaFileBits)
 Write-Output ('Captured inline picture '+$InlineIndex+' in reference build '+$word.Build)
}finally{try{if($document){$document.Close([ref]0)}}finally{$word.Quit([ref]0)}}
