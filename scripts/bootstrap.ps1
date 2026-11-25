param(
    [switch]$Check,
    [switch]$WithTools,
    [switch]$NoLink
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
foreach ($Tool in @('node', 'npm', 'git')) {
    if (-not (Get-Command $Tool -ErrorAction SilentlyContinue)) {
        throw "Missing prerequisite: $Tool. Install Node.js >=22 and Git, then rerun."
    }
}
& node -e 'if (Number(process.versions.node.split(".")[0]) < 22) { console.error("Node.js >=22 is required."); process.exit(1); }'
if ($LASTEXITCODE -ne 0) { throw 'Unsupported Node.js version.' }
if ($Check) {
    & node (Join-Path $PSScriptRoot 'install-upstream.mjs') --check all
    if ($LASTEXITCODE -ne 0) { throw 'Upstream check failed.' }
    return
}
Push-Location $Root
try {
    if (-not (Test-Path 'package-lock.json')) { throw 'package-lock.json is missing; refuse an unpinned install.' }
    & npm ci --ignore-scripts
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
    if ($WithTools) {
        & node (Join-Path $PSScriptRoot 'install-upstream.mjs') --install all
        if ($LASTEXITCODE -ne 0) { throw 'Upstream installation failed. Use native installers or WSL2 as reported.' }
    }
    if (-not $NoLink) {
        & node (Join-Path $PSScriptRoot 'link-cli.mjs') install
        if ($LASTEXITCODE -ne 0) { throw 'Launcher installation failed.' }
    }
    Write-Host 'Installation complete. Run agentctl doctor. Upstream agents may require native installers or WSL2.'
} finally {
    Pop-Location
}
