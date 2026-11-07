param(
    [Parameter(Mandatory = $true)][string]$InputPptx,
    [Parameter(Mandatory = $true)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
$sourcePath = (Resolve-Path -LiteralPath $InputPptx).Path
if ([IO.Path]::GetExtension($sourcePath) -ne '.pptx') { throw 'Input must be a PPTX file' }
$targetPath = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $targetPath) {
    if (@(Get-ChildItem -LiteralPath $targetPath -Force).Count -gt 0) { throw 'Preview output must be empty; use a new directory' }
} else { New-Item -ItemType Directory -Path $targetPath | Out-Null }
$reviewApp = New-Object -ComObject PowerPoint.Application
$reviewDeck = $reviewApp.Presentations.Open($sourcePath, -1, 0, 0)
try {
    $expectedCount = $reviewDeck.Slides.Count
    $slideWidth = [double]$reviewDeck.PageSetup.SlideWidth
    $slideHeight = [double]$reviewDeck.PageSetup.SlideHeight
    if ($slideWidth -le 0 -or $slideHeight -le 0) { throw 'Invalid slide dimensions' }
    $scale = 1600 / [Math]::Max($slideWidth, $slideHeight)
    $width = [int][Math]::Max(1, [Math]::Round($slideWidth * $scale))
    $height = [int][Math]::Max(1, [Math]::Round($slideHeight * $scale))
    $reviewDeck.Export($targetPath, 'PNG', $width, $height)
    $actualCount = @(Get-ChildItem -LiteralPath $targetPath -Filter '*.PNG').Count
    if ($actualCount -ne $expectedCount) { throw "Expected $expectedCount pages, found $actualCount" }
    [PSCustomObject]@{ source = $sourcePath; output = $targetPath; slides = $actualCount; widthPx = $width; heightPx = $height; renderer = 'Microsoft PowerPoint'; editingChecks = 'not-run' } | ConvertTo-Json
} finally {
    $reviewDeck.Close()
    # Do not quit PowerPoint: it may share the user's existing application instance.
    [Runtime.InteropServices.Marshal]::ReleaseComObject($reviewDeck) | Out-Null
    [Runtime.InteropServices.Marshal]::ReleaseComObject($reviewApp) | Out-Null
}
