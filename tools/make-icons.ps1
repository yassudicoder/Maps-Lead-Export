# Generates icons/icon-{16,32,48,128}.png from a single vector description.
# Re-run after changing BRAND to regenerate all sizes:  pwsh tools/make-icons.ps1
Add-Type -AssemblyName System.Drawing

$BrandTop    = [System.Drawing.Color]::FromArgb(255, 79, 70, 229)   # indigo-600
$BrandBottom = [System.Drawing.Color]::FromArgb(255, 55, 48, 163)   # indigo-800
$Mark        = [System.Drawing.Color]::White

$outDir = Join-Path $PSScriptRoot '..\icons'
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

function New-RoundedRect([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

foreach ($size in 16, 32, 48, 128) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.Clear([System.Drawing.Color]::Transparent)

  # Rounded-square tile with a vertical brand gradient.
  $radius = [single]($size * 0.22)
  $tile = New-RoundedRect 0 0 $size $size $radius
  $rect = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
  $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $BrandTop, $BrandBottom, 90.0)
  $g.FillPath($grad, $tile)

  # Map pin: head circle + tapered tail, with a knocked-out centre.
  $cx = [single]($size * 0.5)
  $cy = [single]($size * 0.415)
  $r  = [single]($size * 0.20)

  $pin = New-Object System.Drawing.Drawing2D.GraphicsPath
  # Winding, not the default Alternate: the tail overlaps the head circle, and
  # Alternate would XOR that overlap into a notch across the pin.
  $pin.FillMode = [System.Drawing.Drawing2D.FillMode]::Winding
  $pin.AddEllipse($cx - $r, $cy - $r, $r * 2, $r * 2)
  $tail = New-Object 'System.Drawing.PointF[]' 3
  $tail[0] = New-Object System.Drawing.PointF(($cx - $r * 0.76), ($cy + $r * 0.50))
  $tail[1] = New-Object System.Drawing.PointF(($cx + $r * 0.76), ($cy + $r * 0.50))
  $tail[2] = New-Object System.Drawing.PointF($cx, ($cy + $r * 2.30))
  $pin.AddPolygon($tail)

  $white = New-Object System.Drawing.SolidBrush($Mark)
  $g.FillPath($white, $pin)

  # Knock the centre back out to the tile gradient so the pin reads as an outline.
  $hole = [single]($r * 0.42)
  $g.SetClip($tile)
  $holePath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $holePath.AddEllipse($cx - $hole, $cy - $hole, $hole * 2, $hole * 2)
  $g.FillPath($grad, $holePath)
  $g.ResetClip()

  $path = Join-Path $outDir "icon-$size.png"
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)

  $g.Dispose(); $bmp.Dispose(); $grad.Dispose(); $white.Dispose()
  $tile.Dispose(); $pin.Dispose(); $holePath.Dispose()
  Write-Output "wrote $path"
}
