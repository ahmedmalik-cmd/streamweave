$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw 'Install Node.js 24 or newer first.' }
if (-not (Test-Path 'dist/index.html')) { & $nodeCommand.Source scripts/build.mjs }
& $nodeCommand.Source server.mjs
