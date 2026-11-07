param([string]$Name)
$ErrorActionPreference = 'Stop'
$folder = Join-Path $PSScriptRoot '../tests/fixtures/script-kerning-defaults'
$cases = Get-Content -LiteralPath (Join-Path $folder 'cases.json') -Raw | ConvertFrom-Json
if ($Name) { $cases = @($cases | Where-Object name -eq $Name) }
if (!$cases.Count) { throw 'No matching control.' }
foreach ($case in $cases) {
    $source = [IO.Path]::GetFullPath((Join-Path $folder ($case.name + '.docx')))
    $stream = [IO.File]::Open($source, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $sourceHash = ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose(); $stream.Dispose() }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File '<work>\outputs\Open-OfficeDocument.ps1' $source
    if ($LASTEXITCODE -ne 0) { throw "The document-opening helper did not confirm $source" }
    $doc = $null
    try {
        $word = [Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
        foreach ($open in $word.Documents) { if ($open.FullName -eq $source) { $doc = $open; break } }
    } catch { }
    if (!$doc) { $doc = [Runtime.InteropServices.Marshal]::BindToMoniker($source) }
    if ($doc.FullName -ne $source) { throw 'Wrong reference document.' }
    try {
        if ($doc.Paragraphs.Count -ne $case.rows.Count) { throw 'Unexpected paragraph count.' }
        $rows = @()
        for ($i = 1; $i -le $doc.Paragraphs.Count; $i++) {
            $range = $doc.Paragraphs.Item($i).Range.Duplicate
            $range.End = $range.Start + 6
            if ($range.Text -ne 'START ') { throw 'Unexpected prefix.' }
            $rows += [ordered]@{ family = $case.rows[$i-1].family; face = $case.rows[$i-1].face; kern = $case.rows[$i-1].kern; nativeKerning = $range.Font.Kerning; nativeLigatures = [int]$range.Font.Ligatures; nativeFont = $range.Font.Name }
        }
        $record = [ordered]@{ name = $case.name; version = $doc.Application.Version; build = $doc.Application.Build; sourceSha256 = $sourceHash; rows = $rows }
        $doc.Repaginate()
        Write-Output "Exporting $($case.name)"
        $pdf = [IO.Path]::GetFullPath((Join-Path $folder ($case.name + '-native.pdf')))
        $doc.ExportAsFixedFormat($pdf, 17)
        $record.pdfSha256 = (Get-FileHash -LiteralPath $pdf -Algorithm SHA256).Hash.ToLowerInvariant()
        $record | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $folder ($case.name + '-native.json')) -Encoding UTF8
        Write-Output "Captured $($case.name)"
    } finally { $doc.Close(0) }
}
