# Supporting black-box GDI+ evidence. This is not a native reference SVG capture.
# Run in Windows PowerShell; explicit 0.25 avoids ambiguous leading-dot syntax.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$taskRandom=[Random]::new(92817)
$taskRows=foreach($taskIndex in 0..63) {
 $taskPoints=@(0..7|ForEach-Object{[single]($taskRandom.NextDouble()*100-50)})
 $taskPath=[Drawing.Drawing2D.GraphicsPath]::new()
 try {
  $taskPath.AddBezier($taskPoints[0],$taskPoints[1],$taskPoints[2],$taskPoints[3],$taskPoints[4],$taskPoints[5],$taskPoints[6],$taskPoints[7])
  $taskOriginal=@($taskPath.PathPoints|ForEach-Object{@($_.X,$_.Y)})
  $taskPath.Flatten($null,[single]0.25)
  [pscustomobject]@{flatness=0.25;original=$taskOriginal;points=@($taskPath.PathPoints|ForEach-Object{@($_.X,$_.Y)})}
 }finally{$taskPath.Dispose()}
}
$taskRows|ConvertTo-Json -Depth 5
