param([Parameter(Mandatory=$true)][string]$FontDirectory)
$ErrorActionPreference='Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class WeightProbeFonts {
 [DllImport("gdi32.dll",CharSet=CharSet.Unicode)] public static extern int AddFontResourceEx(string file,uint flags,IntPtr reserved);
 [DllImport("gdi32.dll",CharSet=CharSet.Unicode)] public static extern bool RemoveFontResourceEx(string file,uint flags,IntPtr reserved);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr hwnd,uint msg,IntPtr w,IntPtr l,uint flags,uint timeout,out IntPtr result);
}
'@
$loaded=@()
try {
 foreach($f in Get-ChildItem -LiteralPath $FontDirectory -Filter 'WeightProbe*.ttf') {
  if([WeightProbeFonts]::AddFontResourceEx($f.FullName,0,[IntPtr]::Zero) -eq 0){throw "Failed font registration: $($f.Name)"}
  $loaded+=$f.FullName
 }
 $result=[IntPtr]::Zero
 $null=[WeightProbeFonts]::SendMessageTimeout([IntPtr]65535,0x001D,[IntPtr]::Zero,[IntPtr]::Zero,2,1000,[ref]$result)
 & "$PSScriptRoot/export-reference.ps1" -SourceFullPath "$FontDirectory/control.docx" -OutputPdf "$FontDirectory/native.pdf"
} finally {
 foreach($fontPath in $loaded){if(-not [WeightProbeFonts]::RemoveFontResourceEx($fontPath,0,[IntPtr]::Zero)){Write-Warning "Could not remove $fontPath"}}
 $result=[IntPtr]::Zero
 $null=[WeightProbeFonts]::SendMessageTimeout([IntPtr]65535,0x001D,[IntPtr]::Zero,[IntPtr]::Zero,2,1000,[ref]$result)
 Write-Output "Removed $($loaded.Count) temporary font registrations."
}
