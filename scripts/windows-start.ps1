# Starts the companion on Windows with as little setup as possible (windows-start.bat runs this).
# It checks for Node.js, the app's packages, the character creator and the opencode brain, offers to install whatever is
# missing (never without asking), and then starts the app and opens it in the browser. Keep this file plain ASCII: Windows
# PowerShell 5.1 reads a file without a byte-order mark in the local code page.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Has($name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }

# A program just installed is on the PATH for new windows only; read the PATH again so this one sees it.
function Update-Path {
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
    $npmBin = Join-Path $env:APPDATA "npm"
    if (Test-Path $npmBin) { $env:Path += ";" + $npmBin }
}

function Ask($question) {
    $answer = Read-Host "$question [Y/n]"
    return ($answer -eq "" -or $answer -match "^[yYjJ]")
}

function Test-Run($label) {
    if ($LASTEXITCODE -ne 0) { throw "$label failed (exit code $LASTEXITCODE). Scroll up to see why." }
}

function Node-Ok {
    if (-not (Has "node")) { return $false }
    $v = (& node -p "process.versions.node").Trim()
    return ([version]$v -ge [version]"22.18.0")
}

try {
    Write-Host ""
    Write-Host "Anime AI companion - starting up"
    Write-Host ""

    # 1. Node.js 22.18 or newer
    Update-Path
    if (-not (Node-Ok)) {
        Write-Host "Node.js 22.18 or newer is needed and was not found."
        if (Has "winget") {
            if (-not (Ask "Install Node.js (LTS) now with winget?")) { throw "Node.js is needed. Install it from https://nodejs.org and run this again." }
            & winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
            Update-Path
            if (-not (Node-Ok)) { throw "Node.js was installed but this window cannot see it yet. Close this window and double-click windows-start.bat again." }
        } else {
            Start-Process "https://nodejs.org"
            throw "Install Node.js (the LTS version) from https://nodejs.org, then run this again."
        }
    }
    Write-Host ("Node.js " + (& node -v) + " - ok")

    # 2. The app's packages
    if (-not (Test-Path (Join-Path $root "node_modules\ws"))) {
        Write-Host "Installing the app's packages (once, about a minute) ..."
        & npm install --omit=dev
        Test-Run "npm install"
    }

    # 3. The character creator: next to this folder, or in ~\.anaico\creator\<release>, or download the pinned release (no git needed)
    $ref = (Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json).creator.ref
    $anaicoHome = if ($env:ANAICO_HOME) { $env:ANAICO_HOME } else { Join-Path $env:USERPROFILE ".anaico" }
    $sibling = Join-Path (Split-Path -Parent $root) "anime-character-creator\ts\src"
    $cloned = Join-Path $anaicoHome "creator\$ref"
    if ($env:CREATOR_SRC -or (Test-Path $sibling) -or (Test-Path (Join-Path $cloned "ts\src"))) {
        Write-Host "Character creator - ok"
    } else {
        Write-Host "Downloading the character creator ($ref) ..."
        $temp = Join-Path ([IO.Path]::GetTempPath()) ("anaico-creator-" + [Guid]::NewGuid().ToString("N"))
        New-Item -ItemType Directory -Path $temp | Out-Null
        $zip = Join-Path $temp "creator.zip"
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/rhedak/anime-character-creator/archive/refs/tags/$ref.zip" -OutFile $zip
        Expand-Archive -Path $zip -DestinationPath $temp
        $inner = Get-ChildItem -Path $temp -Directory | Select-Object -First 1
        New-Item -ItemType Directory -Path (Split-Path -Parent $cloned) -Force | Out-Null
        Move-Item -Path $inner.FullName -Destination $cloned
        Remove-Item -Recurse -Force $temp
        if (-not (Test-Path (Join-Path $cloned "ts\src"))) { throw "The downloaded creator has no ts\src folder. Tell the person who gave you this app." }
        Write-Host "Character creator - downloaded"
    }

    # 4. A brain. The first time, opencode (it has free models and needs no account); after that the choice is made in the page.
    $settings = Join-Path $root "data\settings.json"
    if (-not (Test-Path $settings)) {
        if (-not (Has "opencode")) {
            Write-Host "opencode (the free brain) was not found."
            if (Ask "Install it now with npm (npm install -g opencode-ai)?") {
                & npm install -g opencode-ai
                Test-Run "installing opencode"
                Update-Path
            }
            if (-not (Has "opencode")) {
                Write-Host "Without a brain she cannot answer. Install opencode (https://opencode.ai), or Ollama or Claude Code, and choose it in the page."
            }
        }
        New-Item -ItemType Directory -Path (Split-Path -Parent $settings) -Force | Out-Null
        [IO.File]::WriteAllText($settings, '{ "provider": "opencode" }')
    }
    if (Has "opencode") { Write-Host "opencode - ok" }

    # 5. Go
    Write-Host ""
    Write-Host "Starting. The page opens in your browser at http://127.0.0.1:3737 - leave this window open while you use it."
    Write-Host "Close this window (or press Ctrl+C) to stop her."
    Write-Host ""
    & node src/server.ts --open
}
catch {
    Write-Host ""
    Write-Host ("Could not start: " + $_.Exception.Message) -ForegroundColor Red
    Write-Host "If you ask for help, include this window's text and the output of:  node bin/anaico.js --doctor"
}
