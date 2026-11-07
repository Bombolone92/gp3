param(
    [Parameter(Mandatory=$true)][string]$SvgPath,
    [Parameter(Mandatory=$true)][string]$OutputFolder,
    [Parameter(Mandatory=$true)][ValidateRange(1,8192)][int]$Width,
    [Parameter(Mandatory=$true)][ValidateRange(1,8192)][int]$Height,
    [ValidateRange(0,10000)][int]$PathIndex = 0
)
# Native geometry diagnostic, not an SVG renderer. Reads only the selected d
# attribute: explicit absolute M/L/C/Z commands, nonzero fill, no transforms.
# The output may contain private source geometry; do not publish it by default.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$taskSvg = [xml]::new()
$taskSvg.XmlResolver = $null
$taskSvg.Load([IO.Path]::GetFullPath($SvgPath))
$taskNode = $taskSvg.SelectNodes('//*[local-name()="path"]').Item($PathIndex)
if ($null -eq $taskNode) { throw 'Selected path does not exist' }
$taskD = $taskNode.GetAttribute('d')
$taskPattern = '[MLCZ]|[-+]?(?:\d*\.)?\d+(?:[eE][-+]?\d+)?'
if (([regex]::Replace($taskD,$taskPattern,'') -replace '[\s,]','') -ne '') {
    throw 'Only explicit absolute M/L/C/Z commands are supported'
}
$taskTokens = @([regex]::Matches($taskD,$taskPattern) | ForEach-Object { $_.Value })
$taskOutput = [IO.Path]::GetFullPath($OutputFolder)
[IO.Directory]::CreateDirectory($taskOutput) | Out-Null
$taskPath = [Drawing.Drawing2D.GraphicsPath]::new([Drawing.Drawing2D.FillMode]::Winding)
try {
    $taskIndex=0; $taskX=0; $taskY=0; $taskStartX=0; $taskStartY=0; $taskStarted=$false
    while ($taskIndex -lt $taskTokens.Count) {
        $taskCommand=$taskTokens[$taskIndex++]
        $taskCount=switch -CaseSensitive ($taskCommand) { 'M' {2} 'L' {2} 'C' {6} 'Z' {0} default {throw 'Explicit commands are required'} }
        if ($taskIndex+$taskCount -gt $taskTokens.Count) { throw 'Incomplete path command' }
        $taskValues=@()
        for ($taskJ=0; $taskJ -lt $taskCount; $taskJ++) {
            $taskValue=[single]::Parse($taskTokens[$taskIndex++],[cultureinfo]::InvariantCulture)
            if ([single]::IsInfinity($taskValue) -or [single]::IsNaN($taskValue)) { throw 'Nonfinite coordinate' }
            $taskValues += $taskValue
        }
        if (-not $taskStarted -and $taskCommand -ne 'M') { throw 'Path must begin with M' }
        switch -CaseSensitive ($taskCommand) {
            'M' { $taskX=$taskValues[0]; $taskY=$taskValues[1]; $taskStartX=$taskX; $taskStartY=$taskY; $taskPath.StartFigure(); $taskStarted=$true }
            'L' { $taskPath.AddLine($taskX,$taskY,$taskValues[0],$taskValues[1]); $taskX=$taskValues[0]; $taskY=$taskValues[1] }
            'C' { $taskPath.AddBezier([single]$taskX,[single]$taskY,$taskValues[0],$taskValues[1],$taskValues[2],$taskValues[3],$taskValues[4],$taskValues[5]); $taskX=$taskValues[4]; $taskY=$taskValues[5] }
            'Z' { $taskPath.CloseFigure(); $taskX=$taskStartX; $taskY=$taskStartY }
        }
    }
    if ($taskPath.PointCount -eq 0) { throw 'Path has no segments' }
    $taskFlattened=@()
    foreach ($taskFlatness in @(.25,.1,.01,.001)) {
        $taskFlat=$taskPath.Clone()
        try {
            $taskFlat.Flatten($null,[single]$taskFlatness)
            $taskFlattened += @{ flatness=$taskFlatness; coordinates=@($taskFlat.PathPoints | ForEach-Object { @([double]$_.X,[double]$_.Y) }); types=@($taskFlat.PathTypes) }
        } finally { $taskFlat.Dispose() }
    }
    $taskFlattened | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $taskOutput 'flattened-paths.json')
    foreach ($taskOffset in @('Default','Half')) {
        $taskBitmap=[Drawing.Bitmap]::new($Width,$Height)
        $taskGraphics=[Drawing.Graphics]::FromImage($taskBitmap)
        try {
            $taskGraphics.SmoothingMode=[Drawing.Drawing2D.SmoothingMode]::AntiAlias
            $taskGraphics.PixelOffsetMode=[Drawing.Drawing2D.PixelOffsetMode]::$taskOffset
            $taskGraphics.FillPath([Drawing.Brushes]::White,$taskPath)
            $taskBitmap.Save((Join-Path $taskOutput "native-path-$taskOffset.png"),[Drawing.Imaging.ImageFormat]::Png)
        } finally { $taskGraphics.Dispose(); $taskBitmap.Dispose() }
    }
} finally { $taskPath.Dispose() }
Write-Output 'Captured native path coverage and four flattening tolerances'
