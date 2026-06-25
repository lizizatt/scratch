param(
    [ValidateSet("compile", "upload", "monitor", "flash")]
    [string]$Action = "flash",
    [string]$Port = "COM16"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Acli = "C:\Program Files\Arduino CLI\arduino-cli.exe"
$Fqbn = "esp32:esp32:waveshare_esp32s3_touch_lcd_128:PSRAM=enabled"
$Sketch = Join-Path $Root "ins_display"

if (-not (Test-Path $Acli)) {
    throw "arduino-cli not found at $Acli"
}

function Invoke-Compile {
    # Serial -> CH343 UART on GPIO43/44 (not USB-CDC).
    & $Acli compile --fqbn $Fqbn --build-property "build.cdc_on_boot=0" $Sketch
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
