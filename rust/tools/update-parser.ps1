<#
.SYNOPSIS
  Replaces the vendored demo parser (rust/vendor) with a tag of LaihoE/demoparser, then runs the golden bench.

.DESCRIPTION
  Development tool only: the app itself never touches the network. This is the procedure for
  "CS2 update broke demo reading" (ticket 10): copy a newer tag, rerun the bench, publish a PATCH.

  Steps:
    1. Shallow clone of the tag into a temporary folder (the only network access).
    2. Prints both build.rs files so the operator reads what is being dropped, then removes them
       (they clone the CS2 protobufs from an unpinned branch and need protoc).
    3. Drops the upstream 60 MB test demo and the test module that reads it (cfg(test) only).
    4. Checks the licence is MIT, copies it, writes PARSER_TAG (read by csdm-demo at compile time)
       and VENDOR.md (tag, commit, what was removed).
    5. Builds csdm-demo offline-capable code and, when -Demos and -References are given,
       runs the golden bench (examples/golden.rs) and fails if anything differs.

.EXAMPLE
  pwsh rust/tools/update-parser.ps1 -Tag v0.42.2 -Demos D:\bench\demos.txt -References D:\bench\ref
#>
param(
    [Parameter(Mandatory)] [string] $Tag,
    [string] $Demos,
    [string] $References,
    [string] $Repo = 'https://github.com/LaihoE/demoparser'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$rust = Split-Path -Parent $PSScriptRoot
$vendor = Join-Path $rust 'vendor'
$cargo = Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe'
if (-not (Test-Path $cargo)) { $cargo = 'cargo' }

function Invoke-Native([string] $exe, [string[]] $argv) {
    & $exe @argv
    if ($LASTEXITCODE -ne 0) { throw "$exe $($argv -join ' ') failed with exit code $LASTEXITCODE" }
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("demoparser-" + [Guid]::NewGuid().ToString('N'))
try {
    Write-Host "== cloning $Repo at $Tag"
    Invoke-Native git @('-c', 'advice.detachedHead=false', 'clone', '-q', '--depth', '1', '--branch', $Tag, $Repo, $tmp)
    $commit = (& git -C $tmp rev-parse HEAD).Trim()
    $src = Join-Path $tmp 'src'
    foreach ($crate in 'parser', 'csgoproto') {
        if (-not (Test-Path (Join-Path $src $crate 'Cargo.toml'))) { throw "tag $Tag has no src/$crate crate: the upstream layout changed, read it before going on" }
    }
    if (-not (Test-Path (Join-Path $src 'csgoproto\src\protobuf.rs'))) { throw "tag $Tag ships no generated csgoproto/src/protobuf.rs: building would need protoc" }

    $license = Join-Path $tmp 'LICENSE'
    if (-not (Test-Path $license) -or -not (Select-String -Path $license -Pattern '^MIT License' -Quiet)) { throw "tag $Tag is not under the MIT licence any more: stop and read its LICENSE" }

    $removed = @()
    foreach ($crate in 'parser', 'csgoproto') {
        $build = Join-Path $src "$crate\build.rs"
        if (Test-Path $build) {
            Write-Host "== $crate/build.rs (read it: it is removed from the copy)"
            Get-Content $build | ForEach-Object { Write-Host "   $_" }
            Remove-Item $build
            $removed += "src/$crate/build.rs"
        }
    }
    foreach ($rel in 'parser\test_demo.dem', 'parser\src\e2e_test.rs') {
        $p = Join-Path $src $rel
        if (Test-Path $p) { Remove-Item $p; $removed += "src/$($rel -replace '\\','/')" }
    }
    $manifest = Get-Content (Join-Path $src 'csgoproto\Cargo.toml') -Raw
    if ($manifest -match '(?m)^\s*build\s*=') { throw "csgoproto/Cargo.toml names a build script explicitly: read it before going on" }

    Write-Host "== replacing $vendor"
    New-Item -ItemType Directory -Force $vendor | Out-Null
    foreach ($crate in 'parser', 'csgoproto') {
        $dst = Join-Path $vendor $crate
        if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
        Copy-Item -Recurse (Join-Path $src $crate) $dst
    }
    Copy-Item $license (Join-Path $vendor 'LICENSE-demoparser')
    Set-Content -NoNewline -Encoding utf8NoBOM (Join-Path $vendor 'PARSER_TAG') $Tag
    $vendorDoc = @"
# Vendored demo parser

Copy of ``src/parser`` and ``src/csgoproto`` from $Repo, tag ``$Tag``, commit ``$commit``.
MIT licence: ``LICENSE-demoparser`` (upstream file, unchanged).

Written by ``rust/tools/update-parser.ps1``; never edit these folders by hand, rerun the tool with another tag.

Removed from the copy:
$(($removed | ForEach-Object { "- ``$_``" }) -join "`n")

Why: the build scripts clone the CS2 protobufs from an unpinned branch and need ``protoc`` and the network;
the generated ``csgoproto/src/protobuf.rs`` shipped in the tag is used as is. The test demo (about 60 MB) and the
test module that reads it are only compiled for the parser's own tests, which this project never runs.

These crates are not workspace members (``exclude`` in ``rust/Cargo.toml``), so ``cargo clippy --workspace`` does not lint them.
"@
    Set-Content -Encoding utf8NoBOM (Join-Path $vendor 'VENDOR.md') $vendorDoc
    Write-Host "== vendored $Tag ($commit); removed: $($removed -join ', ')"
}
finally {
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
}

Write-Host "== building csdm-demo"
Push-Location $rust
try {
    Invoke-Native $cargo @('build', '-p', 'csdm-demo', '--release', '--example', 'golden')
    if ($Demos -and $References) {
        Write-Host "== golden bench"
        Invoke-Native $cargo @('run', '-q', '-p', 'csdm-demo', '--release', '--example', 'golden', '--', $Demos, $References)
    }
    else {
        Write-Host "== golden bench NOT run (pass -Demos and -References): the update is not proven"
        exit 2
    }
}
finally { Pop-Location }
