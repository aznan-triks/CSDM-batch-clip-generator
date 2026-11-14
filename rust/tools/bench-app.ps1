# Launches the release app off every display, never focused, on a scripted engine (no real
# settings read or written), then takes a screenshot and/or samples CPU, RAM and GPU, and kills it.
# Refuses to measure (and kills the app) if the window touches a display or takes the focus.
#   pwsh tools/bench-app.ps1 -Exe target/release/csdm-app.exe -Ground white -Tab capture -Shot out.png
#   pwsh tools/bench-app.ps1 -Exe target/release/csdm-app.exe -Motion full -Seconds 10
param([Parameter(Mandatory)][string]$Exe, [string]$Ground = 'white', [string]$Tab = 'capture',
      [string]$Shot, [ValidateSet('auto', 'full', 'none')][string]$Motion = 'auto',
      [int]$Seconds = 0, [int]$SettleMs = 4000, [int]$Width = 1600, [int]$Height = 900)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class BenchW32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
'@ -ErrorAction SilentlyContinue

$vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
$x = $vs.Left - 2000 - $Width; $y = $vs.Top - 2000 - $Height
$tmp = Join-Path $env:TEMP "csdm-bench-$([guid]::NewGuid())"
New-Item -ItemType Directory $tmp | Out-Null
$ready = Join-Path $tmp 'ready.txt'
$scenario = Join-Path $tmp 'scenario.json'
$boot = Get-Content -Raw (Join-Path $PSScriptRoot '..\csdm-app\scenarios\boot.json') | ConvertFrom-Json
$boot.steps[1].reply.ok.data.theme_bg = $Ground
$boot | ConvertTo-Json -Depth 20 | Set-Content -Encoding utf8 $scenario

$envs = @{ CSDM_OFFSCREEN = "$x,$y"; CSDM_READY_FILE = $ready; CSDM_SCENARIO = $scenario; CSDM_SHOT_TAB = $Tab; CSDM_MOTION = $Motion }
if ($Shot) { $envs.CSDM_SHOT = [IO.Path]::GetFullPath($Shot); Remove-Item $envs.CSDM_SHOT -ErrorAction SilentlyContinue }
foreach ($k in $envs.Keys) { Set-Item "env:$k" $envs[$k] }
$sw = [Diagnostics.Stopwatch]::StartNew()
$p = Start-Process -FilePath (Resolve-Path $Exe) -PassThru
foreach ($k in $envs.Keys) { Remove-Item "env:$k" }
try {
    while (-not (Test-Path $ready)) {
        if ($sw.ElapsedMilliseconds -gt 30000 -or $p.HasExited) { throw "the app never drew a frame" }
        Start-Sleep -Milliseconds 10
    }
    $startup = $sw.ElapsedMilliseconds
    Start-Sleep -Milliseconds $SettleMs

    $fgPid = 0; [void][BenchW32]::GetWindowThreadProcessId([BenchW32]::GetForegroundWindow(), [ref]$fgPid)
    $onDisplay = [System.Windows.Forms.Screen]::AllScreens | Where-Object { $_.Bounds.IntersectsWith([Drawing.Rectangle]::new($x, $y, $Width, $Height)) }
    if ($fgPid -eq $p.Id -or $onDisplay) { throw "safety check failed (focused=$($fgPid -eq $p.Id), onDisplay=$([bool]$onDisplay))" }

    $out = [ordered]@{ ground = $Ground; tab = $Tab; motion = $Motion; startup_ms = $startup; exe_mb = [math]::Round((Get-Item $Exe).Length / 1MB, 2) }
    if ($Seconds -gt 0) {
        $p.Refresh()
        $cpu0 = $p.TotalProcessorTime.TotalMilliseconds
        $t = [Diagnostics.Stopwatch]::StartNew()
        # GPU % = Windows "GPU Engine" counter for this PID (off-display: DWM composition not included).
        $samples = Get-Counter '\GPU Engine(*)\Utilization Percentage' -SampleInterval 1 -MaxSamples $Seconds -ErrorAction SilentlyContinue
        $wall = $t.Elapsed.TotalMilliseconds
        $p.Refresh()
        $gpu = @(foreach ($set in $samples) { $s = 0.0
            foreach ($c in $set.CounterSamples) { if ($c.InstanceName -match "pid_$($p.Id)_") { $s += $c.CookedValue } }
            $s })
        $g = $gpu | Measure-Object -Average -Maximum
        $out.cpu_pct_1core = [math]::Round(100 * ($p.TotalProcessorTime.TotalMilliseconds - $cpu0) / $wall, 2)
        $out.working_set_mb = [math]::Round($p.WorkingSet64 / 1MB, 1)
        $out.private_mb = [math]::Round($p.PrivateMemorySize64 / 1MB, 1)
        $out.gpu_avg_pct = [math]::Round($g.Average, 2)
        $out.gpu_max_pct = [math]::Round($g.Maximum, 2)
    }
    if ($Shot) {
        $t = [Diagnostics.Stopwatch]::StartNew()
        while (-not (Test-Path $envs.CSDM_SHOT) -and $t.ElapsedMilliseconds -lt 10000) { Start-Sleep -Milliseconds 100 }
        if (-not (Test-Path $envs.CSDM_SHOT)) { throw "no screenshot written" }
        Start-Sleep -Milliseconds 300
        $out.shot = $envs.CSDM_SHOT
    }
    $out | ConvertTo-Json -Compress
}
finally {
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
