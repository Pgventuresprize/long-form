# Motor de long form en local (Windows). Lee long-form/motor/.env.local y levanta /despertar en el 8787.
#
#   powershell -File long-form/motor/servir.ps1 [-Python ruta\python.exe] [-Comando servir|vaciar|trabajar]
param(
  [string]$Python = "$env:USERPROFILE\lf-local\venv\Scripts\python.exe",
  [string]$Comando = 'servir'
)
$aqui = $PSScriptRoot
foreach ($linea in Get-Content (Join-Path $aqui '.env.local')) {
  $l = $linea.Trim().TrimStart([char]0xFEFF)
  if (-not $l -or $l.StartsWith('#') -or -not $l.Contains('=')) { continue }
  $k, $v = $l.Split('=', 2)
  [Environment]::SetEnvironmentVariable($k.Trim(), $v.Trim(), 'Process')
}
$env:PYTHONIOENCODING = 'utf-8'
Set-Location $aqui
& $Python -u -m editor $Comando
