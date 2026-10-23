param(
  [Parameter(Mandatory)][int]$BrowserProcessId,
  [Parameter(Mandatory)][string]$IconFile,
  [Parameter(Mandatory)][string]$StopFile
)
$ErrorActionPreference = 'Stop'
try {
  Add-Type -Path "$PSScriptRoot/WindowIcon.cs"
  [SurfWindowIcon]::Run($BrowserProcessId, $IconFile, $StopFile)
} catch {
  [Console]::Error.WriteLine($_)
  exit 1
}
