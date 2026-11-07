param(
    [Parameter(Mandatory=$true)][string]$FixtureFolder,
    [Parameter(Mandatory=$true)][string]$OutputFolder,
    [ValidateSet('points','explicit-transform','rectangle-transform')][string]$Mapping = 'points'
)
# Native diagnostic for the authored placement controls, never renderer code.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskFolder = [IO.Path]::GetFullPath($FixtureFolder)
$taskOutput = [IO.Path]::GetFullPath($OutputFolder)
$taskCases = Get-Content -Raw -LiteralPath (Join-Path $taskFolder 'cases.json') | ConvertFrom-Json
$taskPackage = [IO.Compression.ZipFile]::OpenRead((Join-Path $taskFolder 'control.docx'))
try {
    $taskReader = [IO.StreamReader]::new($taskPackage.GetEntry('word/media/vector.svg').Open())
    try { $taskSvgText = $taskReader.ReadToEnd() } finally { $taskReader.Dispose() }
} finally { $taskPackage.Dispose() }
$taskSvg = [xml]::new()
$taskSvg.XmlResolver = $null
$taskSvg.LoadXml($taskSvgText)
$taskImages = $taskSvg.SelectNodes('//*[local-name()="image"]')
if ($taskImages.Count -ne $taskCases.Count) { throw 'Expected one image per placement case' }
$taskUri = $taskImages.Item(0).GetAttribute('href')
foreach ($taskNode in $taskImages) {
    if ($taskNode.GetAttribute('href') -ne $taskUri) { throw 'Placement controls must share an identical source image' }
}
if (-not $taskUri.StartsWith('data:image/png;base64,')) { throw 'Expected an embedded PNG source' }
$taskStream = [IO.MemoryStream]::new([Convert]::FromBase64String($taskUri.Split(',',2)[1]))
$taskSource = [Drawing.Image]::FromStream($taskStream)
try {
    [IO.Directory]::CreateDirectory($taskOutput) | Out-Null
    $taskRecords = @()
    for ($taskIndex = 0; $taskIndex -lt $taskCases.Count; $taskIndex++) {
        $taskCase = $taskCases[$taskIndex]
        $taskBitmap = [Drawing.Bitmap]::new(16,60)
        $taskGraphics = [Drawing.Graphics]::FromImage($taskBitmap)
        $taskAttributes = [Drawing.Imaging.ImageAttributes]::new()
        $taskMatrix = $null
        try {
            $taskAttributes.SetWrapMode([Drawing.Drawing2D.WrapMode]::TileFlipXY)
            $taskGraphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $taskGraphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::Half
            $taskPoints = [Drawing.PointF[]]@(
                [Drawing.PointF]::new($taskCase.x,$taskCase.y),
                [Drawing.PointF]::new(($taskCase.x+$taskCase.width),$taskCase.y),
                [Drawing.PointF]::new($taskCase.x,($taskCase.y+$taskCase.height))
            )
            $taskSourceRect = [Drawing.RectangleF]::new(0,0,$taskSource.Width,$taskSource.Height)
            if ($Mapping -ne 'points') {
                $taskMatrix = if ($Mapping -eq 'explicit-transform') {
                    [Drawing.Drawing2D.Matrix]::new([single]($taskCase.width/$taskSource.Width),0,0,[single]($taskCase.height/$taskSource.Height),[single]$taskCase.x,[single]$taskCase.y)
                } else {
                    [Drawing.Drawing2D.Matrix]::new($taskSourceRect,$taskPoints)
                }
                $taskGraphics.Transform = $taskMatrix
                $taskPoints = [Drawing.PointF[]]@([Drawing.PointF]::new(0,0),[Drawing.PointF]::new($taskSource.Width,0),[Drawing.PointF]::new(0,$taskSource.Height))
            }
            $taskTransform = $taskGraphics.Transform
            try {
                $taskRecords += @{ case=$taskIndex; mapping=$Mapping; transform=@($taskTransform.Elements | ForEach-Object { [double]$_ }) }
            } finally { $taskTransform.Dispose() }
            $taskGraphics.DrawImage($taskSource,$taskPoints,$taskSourceRect,[Drawing.GraphicsUnit]::Pixel,$taskAttributes)
            $taskBitmap.Save((Join-Path $taskOutput "$taskIndex.png"),[Drawing.Imaging.ImageFormat]::Png)
        } finally { if ($null -ne $taskMatrix) { $taskMatrix.Dispose() }; $taskAttributes.Dispose(); $taskGraphics.Dispose(); $taskBitmap.Dispose() }
    }
    $taskRecords | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $taskOutput 'mapping.json')
} finally { $taskSource.Dispose(); $taskStream.Dispose() }
Write-Output "Captured $($taskCases.Count) native placement rasters ($Mapping)"
