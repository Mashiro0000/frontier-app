# Runs a Node script OUTSIDE the Claude desktop app's package container (18.2, D-050), as a program the owner starts himself would run.
# Processes started from the Claude app have their %APPDATA% / %LOCALAPPDATA% writes redirected by Windows to A:\WpSystem\...
# (see tools/README.md); an installer run that way would put its Start-menu shortcut in the redirected store, not where the
# owner sees it. WMI's Win32_Process.Create starts the process in the user's session without the container.
# Usage: powershell -NoProfile -File tools/outside.ps1 -Script tools\verify-18-2.mjs -Log tools\.out\verify-18-2.out.txt [-Arg "<one argument>"]
# It returns at once with the process id; the caller waits for the log's summary line.
param([Parameter(Mandatory)] [string] $Script, [Parameter(Mandatory)] [string] $Log, [string] $Arg = '')
$repo = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node).Source
$scriptPath = Join-Path $repo $Script
$logPath = Join-Path $repo $Log
$extra = if ($Arg) { " `"$Arg`"" } else { '' }
$cmd = "cmd.exe /c `"`"$node`" `"$scriptPath`"$extra > `"$logPath`" 2>&1`""
$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd; CurrentDirectory = $repo }
if ($r.ReturnValue -ne 0) { Write-Error "Win32_Process.Create failed: $($r.ReturnValue)"; exit 1 }
"started outside the container: pid $($r.ProcessId)"
