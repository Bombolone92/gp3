param([Parameter(Mandatory=$true)][string]$Source,[Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference='Stop'
$taskSource=(Resolve-Path -LiteralPath $Source).Path
$taskOutput=[IO.Path]::GetFullPath($Output)
if([IO.Path]::GetExtension($taskSource) -ne '.docx' -or [IO.Path]::GetExtension($taskOutput) -ne '.emf'){throw 'Expected DOCX input and EMF output'}
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File '<work>\outputs\Open-OfficeDocument.ps1' $taskSource
if($LASTEXITCODE -ne 0){throw 'Document-opening helper failed'}
function Read-SourceHash([string]$path){
  $stream=[IO.File]::Open($path,'Open','Read','ReadWrite')
  try{return(Get-FileHash -InputStream $stream -Algorithm SHA256).Hash.ToLowerInvariant()}finally{$stream.Dispose()}
}
$taskBefore=Read-SourceHash $taskSource
$taskDoc=[Runtime.InteropServices.Marshal]::BindToMoniker($taskSource)
if($taskDoc.FullName -ne $taskSource -or !$taskDoc.Saved){throw 'Unexpected source path or unsaved changes'}
[IO.File]::WriteAllBytes($taskOutput,[byte[]]$taskDoc.Content.EnhMetaFileBits)
if((Read-SourceHash $taskSource)-ne$taskBefore){throw 'Source changed during capture'}
$taskMetadata=[ordered]@{
  sourceSha256=$taskBefore
  referenceBuild=$taskDoc.Application.Build
  captureSha256=(Read-SourceHash $taskOutput)
  sourceUnchanged=$true
  scope='Native Content.EnhMetaFileBits of exact helper-opened original, no repagination or PDF export, no source mutation'
}
[IO.File]::WriteAllText($taskOutput+'.json',($taskMetadata|ConvertTo-Json)+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
# This binds to an existing document. Do not close it or quit the user's reference application.
Write-Output "Captured native range metafile: $taskOutput"
