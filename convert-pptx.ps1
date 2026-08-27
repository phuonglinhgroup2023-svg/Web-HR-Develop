param(
  [Parameter(Mandatory = $true)]
  [string]$InputFile,

  [Parameter(Mandatory = $true)]
  [string]$OutputDir
)

$ErrorActionPreference = 'Stop'

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$powerPoint = New-Object -ComObject PowerPoint.Application
$presentation = $null

try {
  $presentation = $powerPoint.Presentations.Open($InputFile, $true, $true, $false)
  $presentation.Export($OutputDir, 'PNG', 1920, 1080)
}
finally {
  if ($presentation) {
    $presentation.Close()
  }

  if ($powerPoint) {
    $powerPoint.Quit()
  }
}

$slides = Get-ChildItem -Path $OutputDir -File |
  Where-Object { $_.Extension -match '^\.(png|jpg|jpeg)$' } |
  Sort-Object Name |
  Select-Object -ExpandProperty Name

[pscustomobject]@{
  ok = $true
  slideCount = $slides.Count
  slides = $slides
} | ConvertTo-Json -Compress
