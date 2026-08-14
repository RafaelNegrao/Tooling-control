Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'

$outPath = Join-Path $PSScriptRoot 'tooling-control-portfolio-concept.png'
$width = 1800
$height = 1100

$bmp = New-Object System.Drawing.Bitmap($width, $height)
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$gfx.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$gfx.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
$gfx.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

function New-Color {
  param([string]$Hex, [int]$Alpha = 255)
  $clean = $Hex.TrimStart('#')
  $r = [Convert]::ToInt32($clean.Substring(0, 2), 16)
  $g = [Convert]::ToInt32($clean.Substring(2, 2), 16)
  $b = [Convert]::ToInt32($clean.Substring(4, 2), 16)
  return [System.Drawing.Color]::FromArgb($Alpha, $r, $g, $b)
}

function New-RoundPath {
  param([float]$X, [float]$Y, [float]$W, [float]$H, [float]$Radius)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  if ($Radius -le 0) {
    $path.AddRectangle([System.Drawing.RectangleF]::new($X, $Y, $W, $H))
    return $path
  }

  $d = $Radius * 2
  $path.AddArc($X, $Y, $d, $d, 180, 90)
  $path.AddArc($X + $W - $d, $Y, $d, $d, 270, 90)
  $path.AddArc($X + $W - $d, $Y + $H - $d, $d, $d, 0, 90)
  $path.AddArc($X, $Y + $H - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function Fill-Round {
  param([float]$X, [float]$Y, [float]$W, [float]$H, [float]$Radius, [string]$Hex, [int]$Alpha = 255)
  $path = New-RoundPath $X $Y $W $H $Radius
  $brush = New-Object System.Drawing.SolidBrush (New-Color $Hex $Alpha)
  $gfx.FillPath($brush, $path)
  $brush.Dispose()
  $path.Dispose()
}

function Fill-RoundGradient {
  param(
    [float]$X,
    [float]$Y,
    [float]$W,
    [float]$H,
    [float]$Radius,
    [string]$From,
    [string]$To,
    [float]$Angle = 90,
    [int]$AlphaFrom = 255,
    [int]$AlphaTo = 255
  )
  $path = New-RoundPath $X $Y $W $H $Radius
  $rect = [System.Drawing.RectangleF]::new($X, $Y, $W, $H)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, (New-Color $From $AlphaFrom), (New-Color $To $AlphaTo), $Angle)
  $gfx.FillPath($brush, $path)
  $brush.Dispose()
  $path.Dispose()
}

function Stroke-Round {
  param([float]$X, [float]$Y, [float]$W, [float]$H, [float]$Radius, [string]$Hex, [float]$Stroke = 1, [int]$Alpha = 255)
  $path = New-RoundPath $X $Y $W $H $Radius
  $pen = New-Object System.Drawing.Pen((New-Color $Hex $Alpha), $Stroke)
  $gfx.DrawPath($pen, $path)
  $pen.Dispose()
  $path.Dispose()
}

function Fill-Radial {
  param([float]$X, [float]$Y, [float]$W, [float]$H, [string]$Center, [string]$Edge, [int]$CenterAlpha = 255, [int]$EdgeAlpha = 0)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddEllipse($X, $Y, $W, $H)
  $brush = New-Object System.Drawing.Drawing2D.PathGradientBrush($path)
  $brush.CenterColor = New-Color $Center $CenterAlpha
  $brush.SurroundColors = @((New-Color $Edge $EdgeAlpha))
  $gfx.FillPath($brush, $path)
  $brush.Dispose()
  $path.Dispose()
}

function Draw-Line {
  param([float]$X1, [float]$Y1, [float]$X2, [float]$Y2, [string]$Hex, [float]$Stroke = 1, [int]$Alpha = 255)
  $pen = New-Object System.Drawing.Pen((New-Color $Hex $Alpha), $Stroke)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $gfx.DrawLine($pen, $X1, $Y1, $X2, $Y2)
  $pen.Dispose()
}

function Draw-Connector {
  param([float]$X1, [float]$Y1, [float]$X2, [float]$Y2, [string]$Hex, [int]$Alpha = 110)
  Draw-Line $X1 $Y1 $X2 $Y2 $Hex 9 ($Alpha / 4)
  Draw-Line $X1 $Y1 $X2 $Y2 $Hex 2 $Alpha
}

function Draw-PlaceholderRows {
  param([float]$X, [float]$Y, [int]$Rows, [float]$W, [string[]]$DotColors)
  for ($i = 0; $i -lt $Rows; $i++) {
    $rowY = $Y + ($i * 64)
    Fill-Round $X $rowY $W 46 13 '#26303a' 150
    Stroke-Round $X $rowY $W 46 13 '#7ce0cc' 0.8 38

    $dotBrush = New-Object System.Drawing.SolidBrush (New-Color $DotColors[$i % $DotColors.Length] 235)
    $gfx.FillEllipse($dotBrush, $X + 16, $rowY + 14, 18, 18)
    $dotBrush.Dispose()

    Fill-Round ($X + 48) ($rowY + 13) ($W * (0.34 + (($i % 3) * 0.11))) 7 3 '#d6e2e7' 60
    Fill-Round ($X + 48) ($rowY + 27) ($W * (0.24 + (($i % 4) * 0.08))) 6 3 '#7f929e' 54
    Fill-Round ($X + $W - 66) ($rowY + 15) 42 16 8 $DotColors[$i % $DotColors.Length] 120
  }
}

function Draw-Sheet {
  param([float]$X, [float]$Y, [float]$Angle, [float]$Scale, [int]$Alpha)
  $state = $gfx.Save()
  $gfx.TranslateTransform($X, $Y)
  $gfx.RotateTransform($Angle)
  $gfx.ScaleTransform($Scale, $Scale)

  Fill-Round 0 0 250 178 14 '#f1f5f6' $Alpha
  Stroke-Round 0 0 250 178 14 '#b8c6cb' 1.5 ($Alpha - 20)
  $fold = New-Object System.Drawing.Drawing2D.GraphicsPath
  $fold.AddPolygon([System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new(205, 0),
    [System.Drawing.PointF]::new(250, 0),
    [System.Drawing.PointF]::new(250, 45)
  ))
  $foldBrush = New-Object System.Drawing.SolidBrush (New-Color '#c8d5d8' ([Math]::Max(40, $Alpha - 45)))
  $gfx.FillPath($foldBrush, $fold)
  $foldBrush.Dispose()
  $fold.Dispose()

  for ($c = 1; $c -lt 5; $c++) {
    Draw-Line (18 + $c * 43) 34 (18 + $c * 43) 152 '#6f858d' 1 ([Math]::Max(25, $Alpha - 96))
  }
  for ($r = 1; $r -lt 5; $r++) {
    Draw-Line 18 (24 + $r * 26) 228 (24 + $r * 26) '#6f858d' 1 ([Math]::Max(25, $Alpha - 96))
  }
  for ($i = 0; $i -lt 8; $i++) {
    $dot = New-Object System.Drawing.SolidBrush (New-Color (@('#f2635f', '#f4b44b', '#44c37d')[$i % 3]) ([Math]::Min(210, $Alpha + 20)))
    $gfx.FillEllipse($dot, (36 + ($i % 4) * 44), (54 + [Math]::Floor($i / 4) * 52), 10, 10)
    $dot.Dispose()
  }

  $gfx.Restore($state)
}

function Draw-Database {
  param([float]$X, [float]$Y, [float]$W, [float]$H)
  $bodyRect = [System.Drawing.RectangleF]::new($X, $Y + 28, $W, $H - 56)
  $bodyBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($bodyRect, (New-Color '#1e6872' 235), (New-Color '#24343a' 238), 0)
  $gfx.FillRectangle($bodyBrush, $bodyRect)
  $bodyBrush.Dispose()

  $topBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(([System.Drawing.RectangleF]::new($X, $Y, $W, 58)), (New-Color '#71e1d1' 225), (New-Color '#1d5661' 235), 90)
  $gfx.FillEllipse($topBrush, $X, $Y, $W, 58)
  $topBrush.Dispose()

  $bottomBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(([System.Drawing.RectangleF]::new($X, $Y + $H - 58, $W, 58)), (New-Color '#18262a' 240), (New-Color '#57b9aa' 180), 90)
  $gfx.FillEllipse($bottomBrush, $X, $Y + $H - 58, $W, 58)
  $bottomBrush.Dispose()

  $pen = New-Object System.Drawing.Pen((New-Color '#9cf5e7' 150), 2)
  $gfx.DrawEllipse($pen, $X, $Y, $W, 58)
  $gfx.DrawEllipse($pen, $X, $Y + $H - 58, $W, 58)
  for ($i = 1; $i -lt 4; $i++) {
    $yy = $Y + 34 + ($i * 34)
    $gfx.DrawArc($pen, $X, $yy, $W, 58, 0, 180)
  }
  $pen.Dispose()

  Fill-Radial ($X - 70) ($Y + 20) ($W + 140) ($H + 40) '#4fe6cf' '#4fe6cf' 95 0
}

function Draw-Gear {
  param([float]$Cx, [float]$Cy, [float]$Outer, [float]$Root, [int]$Teeth)
  $points = New-Object 'System.Collections.Generic.List[System.Drawing.PointF]'
  for ($i = 0; $i -lt ($Teeth * 2); $i++) {
    $angle = (-90 + ($i * 180 / $Teeth)) * [Math]::PI / 180
    $radius = $(if (($i % 2) -eq 0) { $Outer } else { $Root })
    $points.Add([System.Drawing.PointF]::new(
      $Cx + [Math]::Cos($angle) * $radius,
      $Cy + [Math]::Sin($angle) * $radius
    ))
  }

  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddPolygon($points.ToArray())
  $rect = [System.Drawing.RectangleF]::new($Cx - $Outer, $Cy - $Outer, $Outer * 2, $Outer * 2)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, (New-Color '#f3c56a' 245), (New-Color '#9a6234' 248), 45)
  $gfx.FillPath($brush, $path)
  $brush.Dispose()

  $pen = New-Object System.Drawing.Pen((New-Color '#ffe5a0' 170), 4)
  $gfx.DrawPath($pen, $path)
  $pen.Dispose()

  $innerBrush = New-Object System.Drawing.SolidBrush (New-Color '#1b2428' 245)
  $gfx.FillEllipse($innerBrush, $Cx - 74, $Cy - 74, 148, 148)
  $innerBrush.Dispose()
  $ringPen = New-Object System.Drawing.Pen((New-Color '#ffd991' 195), 8)
  $gfx.DrawEllipse($ringPen, $Cx - 74, $Cy - 74, 148, 148)
  $ringPen.Dispose()

  for ($i = 0; $i -lt 8; $i++) {
    $angle = (-90 + $i * 45) * [Math]::PI / 180
    $bx = $Cx + [Math]::Cos($angle) * 112
    $by = $Cy + [Math]::Sin($angle) * 112
    $boltBrush = New-Object System.Drawing.SolidBrush (New-Color '#2a3032' 220)
    $gfx.FillEllipse($boltBrush, $bx - 12, $by - 12, 24, 24)
    $boltBrush.Dispose()
    $boltPen = New-Object System.Drawing.Pen((New-Color '#ffe5a0' 95), 2)
    $gfx.DrawEllipse($boltPen, $bx - 12, $by - 12, 24, 24)
    $boltPen.Dispose()
  }

  $path.Dispose()
}

function Draw-EndMill {
  param([float]$Cx, [float]$Cy, [float]$Angle)
  $state = $gfx.Save()
  $gfx.TranslateTransform($Cx, $Cy)
  $gfx.RotateTransform($Angle)

  $shaftRect = [System.Drawing.RectangleF]::new(-36, -245, 72, 292)
  $shaftBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($shaftRect, (New-Color '#e9f0ef' 245), (New-Color '#667980' 248), 0)
  $gfx.FillRectangle($shaftBrush, $shaftRect)
  $shaftBrush.Dispose()
  Stroke-Round -36 -245 72 292 13 '#eef8f7' 2 120

  for ($i = -1; $i -le 1; $i++) {
    $pen = New-Object System.Drawing.Pen((New-Color '#b9d4d1' 140), 5)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $gfx.DrawBezier($pen, -26 + ($i * 25), -222, 18 + ($i * 16), -150, -28 + ($i * 19), -68, 22 + ($i * 7), 42)
    $pen.Dispose()
  }

  $tip = New-Object System.Drawing.Drawing2D.GraphicsPath
  $tip.AddPolygon([System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new(-36, 47),
    [System.Drawing.PointF]::new(36, 47),
    [System.Drawing.PointF]::new(24, 122),
    [System.Drawing.PointF]::new(0, 148),
    [System.Drawing.PointF]::new(-24, 122)
  ))
  $tipBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(([System.Drawing.RectangleF]::new(-36, 47, 72, 101)), (New-Color '#dbe9e8' 245), (New-Color '#56666c' 248), 0)
  $gfx.FillPath($tipBrush, $tip)
  $tipBrush.Dispose()
  $tipPen = New-Object System.Drawing.Pen((New-Color '#ffffff' 105), 2)
  $gfx.DrawPath($tipPen, $tip)
  $tipPen.Dispose()
  $tip.Dispose()

  $gfx.Restore($state)
}

function Draw-Node {
  param([float]$X, [float]$Y, [float]$R, [string]$Hex)
  Fill-Radial ($X - $R * 3) ($Y - $R * 3) ($R * 6) ($R * 6) $Hex $Hex 100 0
  $brush = New-Object System.Drawing.SolidBrush (New-Color '#142226' 220)
  $gfx.FillEllipse($brush, $X - $R, $Y - $R, $R * 2, $R * 2)
  $brush.Dispose()
  $pen = New-Object System.Drawing.Pen((New-Color $Hex 230), 4)
  $gfx.DrawEllipse($pen, $X - $R, $Y - $R, $R * 2, $R * 2)
  $pen.Dispose()
  $center = New-Object System.Drawing.SolidBrush (New-Color $Hex 220)
  $gfx.FillEllipse($center, $X - ($R * 0.33), $Y - ($R * 0.33), $R * 0.66, $R * 0.66)
  $center.Dispose()
}

function Draw-DocumentStack {
  param([float]$X, [float]$Y)
  for ($i = 2; $i -ge 0; $i--) {
    $offset = $i * 20
    Fill-Round ($X + $offset) ($Y - $offset) 178 132 13 '#edf4f5' (170 + $i * 18)
    Stroke-Round ($X + $offset) ($Y - $offset) 178 132 13 '#9cb7be' 1.2 95
    for ($r = 0; $r -lt 4; $r++) {
      Fill-Round ($X + $offset + 28) ($Y - $offset + 30 + $r * 20) (96 - $r * 8) 6 3 '#5e747c' 80
    }
    $clipPen = New-Object System.Drawing.Pen((New-Color '#4bd7c6' 160), 4)
    $clipPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $clipPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $gfx.DrawArc($clipPen, $X + $offset + 120, $Y - $offset + 26, 34, 54, 90, 270)
    $clipPen.Dispose()
  }
}

# Background.
$bgRect = [System.Drawing.RectangleF]::new(0, 0, $width, $height)
$bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($bgRect, (New-Color '#111416'), (New-Color '#29322c'), 70)
$gfx.FillRectangle($bgBrush, $bgRect)
$bgBrush.Dispose()

Fill-Radial 210 70 620 520 '#4fd7c7' '#4fd7c7' 82 0
Fill-Radial 1030 -80 650 560 '#f3ba58' '#f3ba58' 46 0
Fill-Radial 870 360 760 540 '#365a72' '#365a72' 52 0

# Factory silhouettes and perspective floor.
$machineBrush = New-Object System.Drawing.SolidBrush (New-Color '#0b0f12' 105)
$gfx.FillRectangle($machineBrush, 0, 655, $width, 445)
$gfx.FillRectangle($machineBrush, 80, 545, 190, 130)
$gfx.FillRectangle($machineBrush, 330, 500, 240, 175)
$gfx.FillRectangle($machineBrush, 1270, 515, 260, 160)
$gfx.FillRectangle($machineBrush, 1540, 455, 90, 220)
$machineBrush.Dispose()

$floorRect = [System.Drawing.RectangleF]::new(0, 645, $width, 455)
$floorBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($floorRect, (New-Color '#26312e' 230), (New-Color '#101313' 255), 90)
$gfx.FillRectangle($floorBrush, $floorRect)
$floorBrush.Dispose()

for ($x = -500; $x -lt ($width + 500); $x += 120) {
  Draw-Line 900 650 $x 1100 '#8fa6a3' 1 28
}
for ($y = 710; $y -lt 1090; $y += 64) {
  Draw-Line 0 $y $width $y '#8fa6a3' 1 22
}

# Loose spreadsheets becoming structured data.
Draw-Sheet 118 318 -13 0.92 145
Draw-Sheet 190 458 7 0.86 128
Draw-Sheet 88 585 -24 0.78 105

# Main glass dashboard.
for ($i = 0; $i -lt 8; $i++) {
  Fill-Round (398 - $i * 3) (138 + $i * 8) (1004 + $i * 6) 682 34 '#000000' (18 - $i)
}
Fill-RoundGradient 395 145 1010 680 34 '#172128' '#24353a' 90 238 226
Stroke-Round 395 145 1010 680 34 '#9feee2' 2.5 95
Stroke-Round 410 160 980 650 27 '#ffffff' 1 24

Fill-Round 430 182 930 54 18 '#111a20' 170
for ($i = 0; $i -lt 3; $i++) {
  $dot = New-Object System.Drawing.SolidBrush (New-Color (@('#f2635f', '#f4b44b', '#46c77f')[$i]) 205)
  $gfx.FillEllipse($dot, 458 + $i * 28, 201, 13, 13)
  $dot.Dispose()
}
Fill-Round 560 201 180 10 5 '#d6e4e7' 43
Fill-Round 770 201 78 10 5 '#7ce0cc' 52
Fill-Round 1145 195 176 22 11 '#36565a' 120

Draw-PlaceholderRows 440 270 7 245 @('#46c77f', '#f4b44b', '#f2635f')

# Center lifecycle ring.
$ringRect = [System.Drawing.RectangleF]::new(728, 258, 344, 344)
$ringBase = New-Object System.Drawing.Pen((New-Color '#0f171b' 180), 28)
$gfx.DrawArc($ringBase, $ringRect, -210, 300)
$ringBase.Dispose()
foreach ($seg in @(
    @{ S = -210; A = 122; C = '#45d783' },
    @{ S = -76; A = 86; C = '#f3bd54' },
    @{ S = 22; A = 58; C = '#ef625d' }
  )) {
  $pen = New-Object System.Drawing.Pen((New-Color $seg.C 230), 28)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $gfx.DrawArc($pen, $ringRect, $seg.S, $seg.A)
  $pen.Dispose()
}
Fill-Radial 700 230 400 400 '#ffffff' '#ffffff' 30 0

# Right analytics surface.
Fill-Round 1110 270 230 212 24 '#1c2830' 152
Stroke-Round 1110 270 230 212 24 '#9feee2' 1.3 58
for ($i = 0; $i -lt 7; $i++) {
  $barH = @(58, 86, 38, 116, 72, 138, 94)[$i]
  $barColor = @('#46c77f', '#4dd8c7', '#f4b44b', '#ef625d')[$i % 4]
  Fill-Round (1134 + $i * 26) (438 - $barH) 13 $barH 6 $barColor 170
}
for ($i = 0; $i -lt 4; $i++) {
  Fill-Round 1128 (520 + $i * 46) 172 10 5 '#d6e4e7' (55 - $i * 4)
  Fill-Round 1128 (520 + $i * 46) (72 + $i * 34) 10 5 @('#46c77f', '#f4b44b', '#4dd8c7', '#ef625d')[$i] 170
  $dot = New-Object System.Drawing.SolidBrush (New-Color @('#46c77f', '#f4b44b', '#4dd8c7', '#ef625d')[$i] 210)
  $gfx.FillEllipse($dot, 1312, 514 + $i * 46, 22, 22)
  $dot.Dispose()
}

# Connections and supplier/status nodes.
Draw-Connector 313 425 395 386 '#4fd7c7' 118
Draw-Connector 314 545 395 520 '#f3ba58' 102
Draw-Connector 1395 360 1514 308 '#4fd7c7' 118
Draw-Connector 1395 585 1536 646 '#f2635f' 105
Draw-Connector 900 746 900 805 '#4fd7c7' 140
Draw-Node 285 415 31 '#4fd7c7'
Draw-Node 298 550 27 '#f3ba58'
Draw-Node 1530 300 33 '#46c77f'
Draw-Node 1552 652 29 '#f2635f'

# Database and attachments.
Draw-Database 745 790 310 170
Draw-DocumentStack 1224 794

# Foreground tooling object.
Fill-Radial 590 405 650 620 '#f3ba58' '#f3ba58' 72 0
Draw-Gear 900 508 178 145 18
Draw-EndMill 900 500 -18

# Replacement/lifecycle chain.
$chainPoints = @(
  [System.Drawing.PointF]::new(690, 664),
  [System.Drawing.PointF]::new(780, 703),
  [System.Drawing.PointF]::new(885, 692),
  [System.Drawing.PointF]::new(984, 716),
  [System.Drawing.PointF]::new(1096, 668)
)
for ($i = 0; $i -lt ($chainPoints.Length - 1); $i++) {
  Draw-Connector $chainPoints[$i].X $chainPoints[$i].Y $chainPoints[$i + 1].X $chainPoints[$i + 1].Y '#9feee2' 95
}
for ($i = 0; $i -lt $chainPoints.Length; $i++) {
  Draw-Node $chainPoints[$i].X $chainPoints[$i].Y 18 @('#46c77f', '#4dd8c7', '#f4b44b', '#ef625d', '#46c77f')[$i]
}

# Fine scan lines and highlights.
for ($y = 180; $y -lt 820; $y += 24) {
  Draw-Line 418 $y 1378 $y '#ffffff' 0.8 9
}
Draw-Line 454 766 1348 766 '#9feee2' 2 80
Draw-Line 430 239 1364 239 '#9feee2' 1.5 70

# Foreground vignette.
Fill-Radial -350 -240 600 600 '#000000' '#000000' 0 128
Fill-Radial 1530 800 540 420 '#000000' '#000000' 0 105

$bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$gfx.Dispose()
$bmp.Dispose()

Write-Output $outPath
