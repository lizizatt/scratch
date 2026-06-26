param(
    [string]$Project = "ins_display",
    [ValidateSet("compile", "upload", "monitor", "flash", "list")]
    [string]$Action = "flash",
    [string]$Port = "COM16",
    [switch]$NoWifi
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Acli = "C:\Program Files\Arduino CLI\arduino-cli.exe"
$Fqbn = "esp32:esp32:waveshare_esp32s3_touch_lcd_128:PSRAM=enabled"
$Libraries = Join-Path $Root "libraries"
$Sketch = Join-Path (Join-Path $Root "projects") $Project

if (-not (Test-Path $Acli)) {
    throw "arduino-cli not found at $Acli"
}

if ($Action -eq "list") {
    Get-ChildItem (Join-Path $Root "projects") -Directory | ForEach-Object { $_.Name }
    exit 0
}

if (-not (Test-Path $Sketch)) {
    throw "Unknown project '$Project'. Run: .\build.ps1 -Action list"
}

function Invoke-Compile {
    $args = @(
        "compile", "--fqbn", $Fqbn,
        "--libraries", $Libraries,
        "--build-property", "build.cdc_on_boot=0"
    )
    if ($NoWifi) {
        $args += @("--build-property", "build.extra_flags=-DPG_LINK_NO_WIFI")
    }
    $args += $Sketch
    & $Acli @args
}

switch ($Action) {
    "compile" {
        Invoke-Compile
    }
    "upload" {
        Invoke-Compile
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        & $Acli upload -p $Port --fqbn $Fqbn $Sketch
    }
    "monitor" {
        & $Acli monitor -p $Port -c baudrate=115200
    }
    "flash" {
        Invoke-Compile
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        & $Acli upload -p $Port --fqbn $Fqbn $Sketch
    }
}

exit $LASTEXITCODE
