[CmdletBinding()]
param(
    [ValidateSet('help', 'setup', 'run', 'test', 'test-ui', 'check')]
    [string]$Target = 'help',
    [string]$HostAddress = $(if ($env:HOST) { $env:HOST } else { '127.0.0.1' }),
    [string]$Port = $env:PORT,
    [string]$Uv = $(if ($env:UV) { $env:UV } else { 'uv' }),
    [string]$Node = $(if ($env:NODE) { $env:NODE } else { 'node' })
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if (-not $env:UV_CACHE_DIR) { $env:UV_CACHE_DIR = Join-Path $root '.cache/uv' }

function Invoke-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "'$Program' failed with exit code $LASTEXITCODE" }
}

function Initialize-TestPython {
    if (-not $env:PYTHON) {
        $pythonPath = & $Uv 'run' '--locked' 'python' '-c' "import base64, sys; print(base64.b64encode(sys.executable.encode('utf-8')).decode('ascii'))"
        if ($LASTEXITCODE -ne 0) { throw "'$Uv' could not prepare the Python environment (exit code $LASTEXITCODE)" }
        $env:PYTHON = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(($pythonPath | Select-Object -Last 1)))
    }
}

# The test and check lists below mirror the Makefile; keep both entry points in sync.
function Invoke-Tests {
    Initialize-TestPython
    Push-Location (Join-Path $root 'ndt')
    try {
        foreach ($file in $javascriptTests) { Invoke-Checked $Node @($file) }
        foreach ($file in $pythonTests) { Invoke-Checked $Uv @('run', '--locked', 'python', '-B', $file) }
    } finally { Pop-Location }
}
function Invoke-Checks {
    Invoke-Tests
    Push-Location (Join-Path $root 'ndt')
    try {
        Get-ChildItem 'dist/drive-test' -File | Where-Object { $_.Extension -in '.mjs', '.js' } | ForEach-Object {
            Invoke-Checked $Node @('--check', $_.FullName)
        }
        foreach ($file in $syntaxFiles) { Invoke-Checked $Node @('--check', $file) }
        Invoke-Checked $Uv @('run', '--locked', 'python', '-c', $pythonSyntaxCheck)
    } finally { Pop-Location }
}

function Invoke-UiTests {
    Initialize-TestPython
    $browser = if ($env:NDT_BROWSER) { $env:NDT_BROWSER } else { 'chromium' }
    if ($browser -notin @('chromium', 'firefox', 'webkit')) {
        throw "Unsupported NDT_BROWSER '$browser'. Choose chromium, firefox, or webkit."
    }
    $packageCheck = "try { require.resolve('@playwright/test'); require.resolve('@axe-core/playwright'); } catch (_) { process.exit(1); }"
    & $Node '-e' $packageCheck
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'Installing the locked npm dependencies...'
        Invoke-Checked 'npm' @('ci')
    }
    # Launch the selected headless browser, which checks the exact executable and
    # runtime used by the suite (Chromium's headless shell differs from Chrome).
    $browserCheck = "(async () => { const p = require('@playwright/test'); const b = await p[process.argv[1]].launch(); await b.close(); })().catch(() => process.exit(1));"
    & $Node '-e' $browserCheck $browser
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Installing Playwright $browser..."
        Invoke-Checked 'npx' @('playwright', 'install', $browser)
    }
    Invoke-Checked 'npm' @('run', 'test:ui')
}

$javascriptTests = @(
    'tests/unit/test.mjs'
    'tests/unit/test-roofs.mjs'
    'tests/unit/test-trees.mjs'
    'tests/unit/test-shadows.mjs'
    'tests/unit/test-lighting.mjs'
    'tests/unit/test-search.mjs'
    'tests/unit/test-search-view-model.mjs'
    'tests/unit/test-network.mjs'
    'tests/unit/test-network-symbols.mjs'
    'tests/unit/test-network-view-model.mjs'
    'tests/unit/test-radio-model.mjs'
    'tests/unit/test-planning.mjs'
    'tests/unit/test-carrier-plan.mjs'
    'tests/unit/test-scenario-view-model.mjs'
    'tests/unit/test-equipment-view-model.mjs'
    'tests/unit/test-inventory-cluster-view-model.mjs'
    'tests/unit/test-fixture-cleanup.cjs'
    'tests/unit/test-project-coverage.mjs'
    'tests/unit/test-tasks.mjs'
    'tests/unit/test-project-view-model.mjs'
    'tests/unit/test-reservations-view-model.mjs'
    'tests/unit/test-region-view-model.mjs'
    'tests/unit/test-map-controls-view-model.mjs'
    'tests/unit/test-map-scene-view-model.mjs'
    'tests/unit/test-navigation-view-model.mjs'
    'tests/unit/test-mvvm-boundaries.mjs'
    'tests/unit/test-street-detail.mjs'
    'tests/unit/test-dm-analytics.mjs'
    'tests/unit/test-dm-view-model.mjs'
    'tests/unit/test-drive-model-parity.mjs'
    'tests/unit/test-scenario-run-view-model.mjs'
)
$pythonTests = @(
    'tests/python/test-tree-sampling.py'
    'tests/python/test-telus-matching.py'
    'tests/python/test-telus-sites.py'
    'tests/python/test-bell-outdoor.py'
    'tests/python/test-convert-osm.py'
    'tests/python/test-regions.py'
    'tests/python/test-road-routing.py'
    'tests/python/test-task-store.py'
    'tests/python/test-radio-scenarios.py'
    'tests/python/test-carrier-plan.py'
    'tests/python/test-equipment-inventory.py'
    'tests/python/test-dm-model.py'
    'tests/python/test-drive-integration.py'
    'tests/python/test-directional-radio.py'
    'tests/python/test-inventory-clusters.py'
    'tests/python/test-drive-http.py'
)
$syntaxFiles = @(
    'dist/task-data.mjs'
    'dist/virtual-ue-view.mjs'
    'dist/task-model.mjs'
    'dist/task-view-model.mjs'
    'dist/task-view.mjs'
    'dist/task-table-view.mjs'
    'dist/task-format.mjs'
    'dist/context-panel.mjs'
    'dist/app.js'
    'dist/osm.mjs'
    'dist/map-data.mjs'
    'dist/roof-layer.mjs'
    'dist/roof-geometry.mjs'
    'dist/tree-layer.mjs'
    'dist/tree-data.mjs'
    'dist/lighting.mjs'
    'dist/shadows.mjs'
    'dist/search.mjs'
    'dist/search-view-model.mjs'
    'dist/search-view.mjs'
    'dist/network-layer.mjs'
    'dist/network-data.mjs'
    'dist/network-symbols.mjs'
    'dist/network-model.mjs'
    'dist/network-view-model.mjs'
    'dist/network-view.mjs'
    'dist/nyc-reservations.mjs'
    'dist/reservations-model.mjs'
    'dist/reservations-view-model.mjs'
    'dist/region-model.mjs'
    'dist/region-view-model.mjs'
    'dist/region-view.mjs'
    'dist/map-controls-view-model.mjs'
    'dist/map-controls-view.mjs'
    'dist/map-scene-view-model.mjs'
    'dist/map-scene-view.mjs'
    'dist/navigation-view-model.mjs'
    'dist/navigation-view.mjs'
    'dist/project-coverage.mjs'
    'dist/project-model.mjs'
    'dist/project-data.mjs'
    'dist/project-view-model.mjs'
    'dist/project-view.mjs'
    'dist/radio-model.mjs'
    'dist/planning-model.mjs'
    'dist/carrier-plan.mjs'
    'dist/planning-view.mjs'
    'dist/planning-label-view.mjs'
    'dist/scenario-model.mjs'
    'dist/equipment-model.mjs'
    'dist/equipment-view-model.mjs'
    'dist/equipment-view.mjs'
    'dist/scenario-view-model.mjs'
    'dist/street-detail.mjs'
)
$pythonSyntaxCheck = "import ast, pathlib; [ast.parse(pathlib.Path(p).read_text(encoding='utf-8')) for p in ('scripts/convert_osm.py', 'scripts/extract_roofs.py', 'scripts/extract_trees.py', 'scripts/extract_street_detail.py', 'scripts/extract_network.py', 'scripts/match_telus.py', 'scripts/extract_telus_sites.py', 'scripts/extract_bell_outdoor.py', 'scripts/tree_sampling.py')]"

$originalPython = $env:PYTHON
Push-Location $root
try {
    switch ($Target) {
        'help' {
            Write-Output '.\make.ps1 setup    Create the local Python environment'
            Write-Output '.\make.ps1 run      Start the viewer (default host 127.0.0.1, ports 5179-5189)'
            Write-Output '.\make.ps1 test     Run the viewer tests'
            Write-Output '.\make.ps1 test-ui  Install missing Playwright dependencies and run UI tests'
            Write-Output '.\make.ps1 check    Run tests and source syntax checks'
            Write-Output 'Options: -HostAddress, -Port, -Uv, -Node (or HOST, PORT, UV, NODE environment variables).'
        }
        'setup' { Invoke-Checked $Uv @('sync', '--locked') }
        'run' {
            $arguments = @('run', '--locked', 'python', 'ndt/server.py', '--host', $HostAddress)
            if ($PSBoundParameters.ContainsKey('Port') -or $null -ne $env:PORT) { $arguments += @('--port', $Port) }
            Invoke-Checked $Uv $arguments
        }
        'test' { Invoke-Tests }
        'test-ui' { Invoke-UiTests }
        'check' { Invoke-Checks }
    }
} finally { $env:PYTHON = $originalPython; Pop-Location }
