# The single verification command of the Rust workspace (README.md « Verify »).
# Stops at the first failing step; prints every line of output.
$ErrorActionPreference = 'Stop'
$cargo = (Get-Command cargo -ErrorAction SilentlyContinue).Source
if (-not $cargo) { $cargo = Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe' }
if (-not (Test-Path $cargo)) { throw "cargo not found on PATH nor in $env:USERPROFILE\.cargo\bin" }

Push-Location $PSScriptRoot
try {
    Write-Host "== clippy (warnings are errors)"
    & $cargo clippy --workspace --all-targets -- -D warnings
    if ($LASTEXITCODE -ne 0) { throw "clippy failed" }
    Write-Host "== tests (layers, hardcode, parity, surface, units)"
    & $cargo test --workspace
    if ($LASTEXITCODE -ne 0) { throw "tests failed" }
    Write-Host "== verify: OK"
}
finally {
    Pop-Location
}
