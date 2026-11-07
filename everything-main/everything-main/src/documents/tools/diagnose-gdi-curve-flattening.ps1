$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$taskRows=foreach($taskBounds in @(@(1,1,16,60),@(0,0,16,60),@(-9,-31,16,60),@(1.03,1.07,16,60),@(1,1,32,120),@(1,1,60,16),@(1,1,2,2),@(1,1,150,150))) {
 foreach($taskFlatness in @(0.1,0.25,0.5,1.0)) {
  $taskPath=[Drawing.Drawing2D.GraphicsPath]::new()
  try {
   $taskPath.AddEllipse([single]$taskBounds[0],[single]$taskBounds[1],[single]$taskBounds[2],[single]$taskBounds[3])
   $taskOriginal=@($taskPath.PathPoints|ForEach-Object{@($_.X,$_.Y)})
   $taskPath.Flatten($null,[single]$taskFlatness)
   [pscustomobject]@{bounds=$taskBounds;flatness=$taskFlatness;original=$taskOriginal;points=@($taskPath.PathPoints|ForEach-Object{@($_.X,$_.Y)})}
  } finally {$taskPath.Dispose()}
 }
}
$taskRows|ConvertTo-Json -Depth 5
