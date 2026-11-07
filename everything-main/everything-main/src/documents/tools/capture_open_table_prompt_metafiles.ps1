param([Parameter(Mandatory)][string]$Source,[Parameter(Mandatory)][string]$OutputRoot,[Parameter(Mandatory)][string]$ExpectedSha256,[ValidateRange(0,100)][int]$ExpectedControls=4)
# Use Open-OfficeDocument.ps1 first. Read an already-running, saved authored
# control; never bind/open another instance or change application/document state.
$ErrorActionPreference='Stop'
$promptPath=[IO.Path]::GetFullPath($Source)
$promptRoot=[IO.Path]::GetFullPath($OutputRoot)
if(!(Test-Path -LiteralPath $promptRoot -PathType Container)){throw 'Use an existing output directory.'}
foreach($name in @('capture.json')+@(1..6 | ForEach-Object {'table-'+$_+'.emf'})){
 if(Test-Path -LiteralPath (Join-Path $promptRoot $name)){throw 'Output already exists.'}
}
function PromptSourceHash {
 $stream=[IO.File]::Open($promptPath,'Open','Read','ReadWrite');$sha=[Security.Cryptography.SHA256]::Create()
 try {([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
 finally {$sha.Dispose();$stream.Dispose()}
}
$before=PromptSourceHash
if($before -ne $ExpectedSha256.ToLowerInvariant()){throw 'Source hash differs.'}
Add-Type -TypeDefinition @"
using System;using System.Collections.Generic;using System.Runtime.InteropServices;using System.Runtime.InteropServices.ComTypes;
public static class PromptRunningDocument {
 [DllImport("ole32.dll")] static extern int GetRunningObjectTable(int reserved,out IRunningObjectTable table);
 [DllImport("ole32.dll")] static extern int CreateBindCtx(int reserved,out IBindCtx ctx);
 public static object[] Find(string path) {
  IRunningObjectTable table;IBindCtx ctx;Marshal.ThrowExceptionForHR(GetRunningObjectTable(0,out table));
  try {
   Marshal.ThrowExceptionForHR(CreateBindCtx(0,out ctx));
   try {
    IEnumMoniker iterator;table.EnumRunning(out iterator);var found=new List<object>();var items=new IMoniker[1];
    try {
     while(iterator.Next(1,items,IntPtr.Zero)==0){var moniker=items[0];
      try {string name;moniker.GetDisplayName(ctx,null,out name);
       if(string.Equals(name.TrimStart('!'),path,StringComparison.OrdinalIgnoreCase)){object item;table.GetObject(moniker,out item);found.Add(item);}
      } finally {Marshal.ReleaseComObject(moniker);}
     }
     return found.ToArray();
    } finally {Marshal.ReleaseComObject(iterator);}
   } finally {Marshal.ReleaseComObject(ctx);}
  } finally {Marshal.ReleaseComObject(table);}
 }
}
"@
$promptObjects=@([PromptRunningDocument]::Find($promptPath))
if($promptObjects.Length -ne 1){
 foreach($item in $promptObjects){[void][Runtime.InteropServices.Marshal]::ReleaseComObject($item)}
 throw 'Exact running document is absent or not unique; no document binding attempted.'
}
$promptDoc=$promptObjects[0]
try {
 if($promptDoc.FullName -ne $promptPath -or !$promptDoc.Saved -or $promptDoc.Tables.Count -ne 6 -or $promptDoc.ContentControls.Count -ne $ExpectedControls -or $promptDoc.Shapes.Count -ne 0 -or $promptDoc.InlineShapes.Count -ne 0){throw 'Wrong saved control source.'}
 for($i=1;$i -le 6;$i++){
  Write-Output ('Capturing native table '+$i)
  $table=$promptDoc.Tables.Item($i)
  try {
   $range=$table.Range
   try {[IO.File]::WriteAllBytes((Join-Path $promptRoot ('table-'+$i+'.emf')),[byte[]]$range.EnhMetaFileBits)}
   finally {[void][Runtime.InteropServices.Marshal]::ReleaseComObject($range)}
  } finally {[void][Runtime.InteropServices.Marshal]::ReleaseComObject($table)}
 }
 $data=@{sourceSha256=$before;sourceUnchanged=(PromptSourceHash) -eq $before;saved=[bool]$promptDoc.Saved;version=$promptDoc.Application.Version;build=$promptDoc.Application.Build;tables=6;controls=$ExpectedControls;method='Exact running-object table lookup; detached table-range EnhMetaFileBits, no duplicate document binding or PDF export.'}
 if(!$data.sourceUnchanged -or !$data.saved){throw 'Source changed during capture; outputs are not a reference.'}
 $data | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $promptRoot 'capture.json') -Encoding utf8
 Write-Output 'Captured six native ranges; source unchanged.'
} finally {[void][Runtime.InteropServices.Marshal]::ReleaseComObject($promptDoc)}
