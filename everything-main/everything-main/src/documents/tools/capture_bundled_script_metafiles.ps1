$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$folder = Join-Path $repo 'tests/fixtures/bundled-script'
$source = Join-Path $folder 'control.docx'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class BundledScriptMetafiles {
 [DllImport("gdi32.dll",CharSet=CharSet.Unicode)] public static extern int AddFontResourceEx(string path,uint flags,IntPtr reserved);
 [DllImport("gdi32.dll",CharSet=CharSet.Unicode)] public static extern bool RemoveFontResourceEx(string path,uint flags,IntPtr reserved);
}
'@
$registered = @(); $word = $null; $doc = $null
try {
    foreach ($name in @('NotoSans.ttf','NotoSans-Italic.ttf')) {
        $path = Join-Path $repo ('public/fonts/' + $name)
        if ([BundledScriptMetafiles]::AddFontResourceEx($path,0,[IntPtr]::Zero) -lt 1) { throw "Could not register $path" }
        $registered += $path
    }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File '<work>\outputs\Open-OfficeDocument.ps1' $source
    if ($LASTEXITCODE -ne 0) { throw 'The reference application did not confirm the control.' }
    $before = @(Get-Process WINWORD -ErrorAction SilentlyContinue | ForEach-Object Id)
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false; $word.DisplayAlerts = 0
    $created = @(Get-Process WINWORD | Where-Object { $_.Id -notin $before })
    if ($created.Count -eq 1) { Write-Output ('Owned reference PID: ' + $created[0].Id) }
    $doc = $word.Documents.Open($source,$false,$true)
    if ($doc.FullName -ne $source -or $doc.Paragraphs.Count -ne 39) { throw 'Unexpected control document.' }
    Write-Output ('Confirmed read-only control; reference build ' + $word.Build)
    for ($index = 0; $index -lt 3; $index++) {
        $first = $doc.Paragraphs.Item($index*13+1).Range.Start
        $last = $doc.Paragraphs.Item($index*13+13).Range.End-1
        Write-Output ('Capturing face ' + $index)
        [IO.File]::WriteAllBytes((Join-Path $folder ('native-face-'+$index+'.emf')), [byte[]]$doc.Range($first,$last).EnhMetaFileBits)
        Write-Output ('Captured face ' + $index)
    }
} finally {
    try {
        try { if ($doc) { $doc.Close([ref]0) } }
        finally { if ($word) { $word.Quit([ref]0) } }
    } finally {
        foreach ($path in $registered) {
            if (-not [BundledScriptMetafiles]::RemoveFontResourceEx($path,0,[IntPtr]::Zero)) { Write-Warning "Could not remove $path" }
        }
    }
}
