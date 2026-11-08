# Arma la base local de Studio en el Supabase local (supabase start).
#
# schema.sql no corre de corrido desde cero (crea indices antes que sus columnas), asi que se aplica
# sentencia por sentencia en dos pasadas: la segunda recoge lo que en la primera dependia de algo
# definido mas abajo. Despues van las migraciones en orden de fecha y al final scheduler.sql.
#
# Es una base para probar en local. Antes de desplegar, las migraciones nuevas se prueban contra el
# esquema sacado de produccion (docs/long-form/PLAN.md, D1).
#
# Uso: powershell -File long-form/local/armar-base.ps1 [-Limpiar]

param(
  [switch]$Limpiar,
  [string]$Servidor = '127.0.0.1',
  [int]$Puerto = 54322
)

# psql escribe avisos por stderr: con 'Stop', PowerShell 5 los toma como errores.
$ErrorActionPreference = 'Continue'
$raiz = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$psql = $env:PSQL
if (-not $psql) { $psql = (Get-Command psql -ErrorAction SilentlyContinue).Source }
if (-not $psql) { $psql = (Get-ChildItem "$env:USERPROFILE\tools\pgsql" -Recurse -Filter psql.exe -ErrorAction SilentlyContinue | Select-Object -First 1).FullName }
if (-not $psql) { throw 'No encuentro psql. Pon su ruta en la variable PSQL.' }
if (-not $env:PGPASSWORD) { $env:PGPASSWORD = 'postgres' }

function Correr([string]$archivo, [bool]$parar) {
  $stop = if ($parar) { 1 } else { 0 }
  $salida = & $psql -h $Servidor -p $Puerto -U postgres -d postgres -v ON_ERROR_STOP=$stop -q -f $archivo 2>&1
  $errores = @($salida | Where-Object { "$_" -match 'ERROR:' } | ForEach-Object { "$_" })
  [pscustomobject]@{ archivo = Split-Path $archivo -Leaf; errores = $errores }
}

if ($Limpiar) {
  $tmp = New-TemporaryFile
  @'
drop schema if exists public cascade;
create schema public;
grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on schema public to postgres, service_role;
alter default privileges in schema public grant all on tables to postgres, service_role;
alter default privileges in schema public grant all on sequences to postgres, service_role;
alter default privileges in schema public grant all on functions to postgres, service_role;
delete from storage.objects;
delete from storage.buckets;
'@ | Set-Content -Encoding utf8 $tmp
  Correr $tmp $true | Out-Null
  Remove-Item $tmp
}

$schema = Join-Path $raiz 'supabase\schema.sql'
$p1 = Correr $schema $false
$p2 = Correr $schema $false
"schema.sql: $($p1.errores.Count) errores en la primera pasada, $($p2.errores.Count) en la segunda"

# Las migraciones del mismo dia no van en orden alfabetico (importador-kits necesita kits-de-marca) y
# chat-lotes usa una funcion de scheduler.sql. Por eso: migraciones, scheduler, y otra vuelta de las dos.
# Las migraciones son idempotentes; lo que importa son los errores de la segunda vuelta.
$migraciones = Get-ChildItem (Join-Path $raiz 'supabase\migraciones') -Filter *.sql | Sort-Object Name
$scheduler = Join-Path $raiz 'supabase\scheduler.sql'
foreach ($m in $migraciones) { Correr $m.FullName $false | Out-Null }
Correr $scheduler $false | Out-Null

$restantes = @()
foreach ($m in $migraciones) {
  $r = Correr $m.FullName $false
  if ($r.errores.Count) { $restantes += $r }
  "{0,-48} {1} errores" -f $r.archivo, $r.errores.Count
}
$s = Correr $scheduler $false
if ($s.errores.Count) { $restantes += $s }
"scheduler.sql: $($s.errores.Count) errores"

if ($p2.errores.Count -or $restantes.Count) {
  ''
  'Errores que quedan:'
  foreach ($r in @($p2) + $restantes) { $r.errores | Select-Object -Unique | ForEach-Object { "  $($r.archivo): $_" } }
}
