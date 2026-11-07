$ErrorActionPreference = 'Stop'
$folder = Join-Path (Split-Path $PSScriptRoot -Parent) 'tests\fixtures\table-twip-widths'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
    foreach ($stem in @('control','percentages')) {
        $path = Join-Path $folder "$stem.docx"
        $document = $null
        try {
            $document = $word.Documents.Open($path, $false, $true)
            if ($document.FullName -ne $path) { throw 'The reference application opened a different document' }
            $document.Repaginate()
            $rows = @()
            foreach ($table in $document.Tables) {
                $cells = @()
                foreach ($cell in $table.Range.Cells) { $cells += @{widthTwips=$cell.Width*20} }
                $rows += ,@($cells)
            }
            $prefix = if ($stem -eq 'control') { 'native' } else { 'percentages' }
            ConvertTo-Json -InputObject $rows -Depth 5 | Set-Content (Join-Path $folder "$prefix-widths.json")
            $pdf = if ($stem -eq 'control') { 'native.pdf' } else { 'percentages-native.pdf' }
            $document.ExportAsFixedFormat((Join-Path $folder $pdf),17)
            Write-Output "$stem : $($document.ComputeStatistics(2)) pages, reference $($word.Version) $($word.Build)"
        } finally { if ($document) { $document.Close(0) } }
    }
} finally { $word.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word) }
