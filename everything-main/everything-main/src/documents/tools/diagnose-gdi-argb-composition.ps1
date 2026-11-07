$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$taskRandom=[Random]::new(271828)
$taskAlphas=@(0,1,2,31,63,127,128,191,253,254,255)
$taskRows=for($taskIndex=0;$taskIndex -lt 256;$taskIndex++) {
 $taskFirst=@($taskRandom.Next(256),$taskRandom.Next(256),$taskRandom.Next(256),$taskAlphas[$taskIndex % $taskAlphas.Count])
 $taskSecond=@($taskRandom.Next(256),$taskRandom.Next(256),$taskRandom.Next(256),$taskAlphas[[int][Math]::Floor($taskIndex/$taskAlphas.Count) % $taskAlphas.Count])
 $taskBitmap=[Drawing.Bitmap]::new(2,2,[Drawing.Imaging.PixelFormat]::Format32bppArgb)
 $taskGraphics=[Drawing.Graphics]::FromImage($taskBitmap)
 try {
  foreach($taskPaint in @($taskFirst,$taskSecond)) {
   $taskBrush=[Drawing.SolidBrush]::new([Drawing.Color]::FromArgb($taskPaint[3],$taskPaint[0],$taskPaint[1],$taskPaint[2]))
   try {$taskGraphics.FillRectangle($taskBrush,0,0,2,2)} finally {$taskBrush.Dispose()}
  }
  $taskPixel=$taskBitmap.GetPixel(1,1)
  [pscustomobject]@{first=$taskFirst;second=$taskSecond;native=@($taskPixel.R,$taskPixel.G,$taskPixel.B,$taskPixel.A)}
 } finally {$taskGraphics.Dispose();$taskBitmap.Dispose()}
}
$taskRows|ConvertTo-Json -Depth 5
