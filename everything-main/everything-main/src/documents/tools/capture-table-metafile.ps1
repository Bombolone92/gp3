param([Parameter(Mandatory=$true)][string]$SourceFullPath,[Parameter(Mandatory=$true)][string]$OutputPath,[ValidateRange(1,2147483647)][int]$TableIndex=1,[string]$TextPattern)
$ErrorActionPreference='Stop'
$source=(Resolve-Path -LiteralPath $SourceFullPath).Path
$word=New-Object -ComObject Word.Application;$word.Visible=$false;$word.DisplayAlerts=0;$doc=$null
try{
 $doc=$word.Documents.Open($source,$false,$true)
 if($doc.FullName -ne $source){throw 'Wrong source'}
 $doc.Repaginate()
 if($TextPattern){$TableIndex=0;for($i=1;$i -le $doc.Tables.Count;$i++){if($doc.Tables.Item($i).Range.Text -match $TextPattern){$TableIndex=$i;break}};if(!$TableIndex){throw 'No matching table'}}
 [IO.File]::WriteAllBytes([IO.Path]::GetFullPath($OutputPath),[byte[]]$doc.Tables.Item($TableIndex).Range.EnhMetaFileBits)
 Write-Output ('Reference build '+$word.Build+' table '+$TableIndex+' metafile captured')
}finally{try{if($doc){$doc.Close([ref]0)}}finally{$word.Quit([ref]0)}}
