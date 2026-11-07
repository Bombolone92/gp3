param(
 [Parameter(Mandatory)][string]$Source,
 [Parameter(Mandatory)][string]$Output,
 [Parameter(Mandatory)][string]$ExpectedSha256,
 [string]$SelectionCases
)
# Confirm this exact authored control with Open-OfficeDocument.ps1 first.
# Detached Range.Move reads the reference application's word-unit positions; no selection/UI edits,
# document edits, save, application settings, closing or quitting.
$ErrorActionPreference='Stop'
$taskSource=[IO.Path]::GetFullPath($Source)
$taskOutput=[IO.Path]::GetFullPath($Output)
if($ExpectedSha256 -notmatch '^[a-fA-F0-9]{64}$'){throw 'Invalid expected source hash'}
if(Test-Path -LiteralPath $taskOutput){throw 'Use a fresh output path'}
function SourceHash {
 $taskStream=[IO.File]::Open($taskSource,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
 $taskAlgorithm=[Security.Cryptography.SHA256]::Create()
 try {([BitConverter]::ToString($taskAlgorithm.ComputeHash($taskStream))).Replace('-','').ToLowerInvariant()}
 finally {$taskAlgorithm.Dispose();$taskStream.Dispose()}
}
$taskHash=SourceHash
if($taskHash -ne $ExpectedSha256.ToLowerInvariant()){throw 'Source differs'}
$taskDoc=[Runtime.InteropServices.Marshal]::BindToMoniker($taskSource)
try {
 if($taskDoc.FullName -ne $taskSource -or -not $taskDoc.Saved){throw 'Wrong source/state'}
 $taskContent=$taskDoc.Content
 $taskText=$taskContent.Text
 $taskStart=$taskContent.Start
 $taskEnd=$taskContent.End-1
 $taskResults=@()
 for($taskPosition=$taskStart;$taskPosition -le $taskEnd;$taskPosition++){
  # Never place a UTF-16 caret between a surrogate pair.
  if($taskPosition -gt $taskStart -and $taskPosition -lt $taskEnd -and [char]::IsLowSurrogate($taskText[$taskPosition-$taskStart])){continue}
  $taskMoves=@()
  foreach($taskDirection in @(-1,1)){
   $taskRange=$taskDoc.Range($taskPosition,$taskPosition)
   try {
    $taskCount=$taskRange.Move(2,$taskDirection)
    $taskExtend=$taskDoc.Range($taskPosition,$taskPosition)
    try {
     $taskExtended=if($taskDirection -lt 0){$taskExtend.MoveStart(2,-1);$taskExtend.Start}else{$taskExtend.MoveEnd(2,1);$taskExtend.End}
     $taskMoves+=@{direction=$taskDirection;position=$taskRange.Start;moved=$taskCount;extendedPosition=$taskExtended[-1]}
    } finally {[void][Runtime.InteropServices.Marshal]::ReleaseComObject($taskExtend)}
   } finally {[void][Runtime.InteropServices.Marshal]::ReleaseComObject($taskRange)}
  }
  $taskResults+=@{position=$taskPosition;moves=$taskMoves}
 }
 $taskSelections=@()
 if($SelectionCases){
  foreach($taskCase in (Get-Content -LiteralPath $SelectionCases -Raw | ConvertFrom-Json)){
   if($taskCase.start -lt $taskStart -or $taskCase.end -gt $taskEnd -or $taskCase.start -ge $taskCase.end){throw 'Invalid selection bounds'}
   foreach($taskDirection in @(-1,1)){
    $taskRange=$taskDoc.Range($taskCase.start,$taskCase.end)
    try {
     $taskCount=$taskRange.Move(2,$taskDirection)
     $taskSelections+=@{start=$taskCase.start;end=$taskCase.end;direction=$taskDirection;position=$taskRange.Start;moved=$taskCount}
    }finally{[void][Runtime.InteropServices.Marshal]::ReleaseComObject($taskRange)}
   }
  }
 }
 if(-not $taskDoc.Saved -or (SourceHash) -ne $taskHash){throw 'Observation mutated source'}
 @{sourceSha256=$taskHash;referenceBuild=$taskDoc.Application.Build;savedBefore=$true;savedAfter=$taskDoc.Saved;sourceUnchanged=$true;readOnly=$taskDoc.ReadOnly;text=$taskText;start=$taskStart;end=$taskEnd;positions=$taskResults;selections=$taskSelections;scope='Detached word-unit range movement and extension; not a keyboard or control-ownership capture'} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $taskOutput -Encoding utf8
 Write-Output ('Recorded '+$taskResults.Count+' positions; source unchanged and Saved true')
} finally {
 if($taskContent){[void][Runtime.InteropServices.Marshal]::ReleaseComObject($taskContent)}
 [void][Runtime.InteropServices.Marshal]::ReleaseComObject($taskDoc)
}
