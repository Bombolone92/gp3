param(
    [Parameter(Mandatory=$true)][string]$InputPath,
    [Parameter(Mandatory=$true)][string]$OutputPath,
    [switch]$QuantizeInput
)
# Native API reference only. No third-party engine code or corpus artwork is included.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$taskCases=Get-Content -Raw -LiteralPath $InputPath | ConvertFrom-Json
$taskRows=@()
foreach ($taskCase in $taskCases) {
    if ($taskCase.points.Count -ne 4) { throw 'Expected four control points' }
    $taskCoordinates=@()
    foreach ($taskPoint in $taskCase.points) {
        if ($taskPoint.Count -ne 2) { throw 'Expected coordinate pairs' }
        foreach ($taskNumber in $taskPoint) {
            $taskValue=[single]$taskNumber
            if ([single]::IsNaN($taskValue) -or [single]::IsInfinity($taskValue)) { throw 'Nonfinite coordinate' }
            if ($QuantizeInput) { $taskValue=[single]([Math]::Ceiling([double]$taskValue*16)/16) }
            $taskCoordinates += $taskValue
        }
    }
    $taskPath=[Drawing.Drawing2D.GraphicsPath]::new()
    try {
        $v=$taskCoordinates
        $taskPath.AddBezier($v[0],$v[1],$v[2],$v[3],$v[4],$v[5],$v[6],$v[7])
        $taskPath.Flatten($null,[single]0.25)
        $taskRows += @{ name=$taskCase.name; points=@($taskPath.PathPoints | ForEach-Object { @([double]$_.X,[double]$_.Y) }) }
    } finally { $taskPath.Dispose() }
}
$taskResult=@{ inputSha256=(Get-FileHash -LiteralPath $InputPath -Algorithm SHA256).Hash.ToLowerInvariant(); quantizeInput=[bool]$QuantizeInput; tolerance=0.25; cases=$taskRows }
$taskResult | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $OutputPath
Write-Output "Captured $($taskRows.Count) cubic flattening references"
