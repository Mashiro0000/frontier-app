param(
  [Parameter(Mandatory = $true)][ValidateSet('find', 'setname', 'ok', 'tdclick', 'shot', 'gone')][string]$Op,
  [string]$Value = '',
  [string]$Out = '',
  [int]$WaitSec = 15,
  [int]$Port = 9222
)
# Reads and answers the REAL Windows dialogs (save, open, message box) of a test app started with --remote-debugging-port=<Port>, instead of
# replacing them from the main inspector as the suites do. Used once on the owner's own profile after Stage 8b (D-035). It touches ONLY that
# app's dialog: UI Automation reads it, and window messages go to the dialog's own controls (no mouse, no keyboard, nothing else on the desktop).
#   find               the dialog's title, texts, buttons and the File name box
#   setname -Value P   put P (a full path) in the File name box (Edit 1001 in a save dialog, 1148 in an open dialog)
#   ok                 press Save / Open (WM_COMMAND IDOK from that button)
#   tdclick -Value N   press a message box button: Electron gives noLink buttons the ids 100, 101, ... in order; 2 (IDCANCEL) is the Escape answer
#   shot -Out F.png    capture just the dialog's window (PrintWindow), whatever is in front of it
#   gone               say whether a dialog is still open
# Found on Windows 11 (2026-10-06): the dialog is a CHILD of the app's window in the UI Automation tree (not of the desktop), and its Win32
# controls show as "Pane" with no patterns, so the managed client cannot type or click in them: hence the window messages.
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class W {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct R { public int L, T, Rt, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out R r);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, string l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, StringBuilder l);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
'@
$ErrorActionPreference = 'Stop'
$A = [System.Windows.Automation.AutomationElement]
$T = [System.Windows.Automation.TreeScope]

$main = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'electron.exe' -and $_.CommandLine -match "--remote-debugging-port=$Port" -and $_.CommandLine -notmatch '--type=' }
if (@($main).Count -ne 1) { throw "expected exactly one test app main process on debug port $Port, found $(@($main).Count)" }
$procId = [int]$main.ProcessId
$cond = New-Object System.Windows.Automation.PropertyCondition($A::ProcessIdProperty, $procId)

function Get-Dialog([int]$wait) {
  $deadline = (Get-Date).AddSeconds($wait)
  do {
    foreach ($w in $A::RootElement.FindAll($T::Children, $cond)) {
      if ($w.Current.ClassName -eq '#32770') { return $w }
      foreach ($k in $w.FindAll($T::Children, $cond)) { if ($k.Current.ClassName -eq '#32770') { return $k } }
    }
    Start-Sleep -Milliseconds 300
  } while ((Get-Date) -lt $deadline)
  return $null
}
function Own([IntPtr]$h) {
  $p = [uint32]0; [void][W]::GetWindowThreadProcessId($h, [ref]$p)
  if ($p -ne $procId) { throw "window $h belongs to process $p, not to the test app ($procId)" }
}
function Native($d, [string]$id, [string]$class) {
  foreach ($e in $d.FindAll($T::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
    if ($e.Current.AutomationId -eq $id -and $e.Current.ClassName -eq $class -and $e.Current.NativeWindowHandle -ne 0) { return [IntPtr]$e.Current.NativeWindowHandle }
  }
  return [IntPtr]::Zero
}
function TextOf([IntPtr]$h) { $sb = New-Object System.Text.StringBuilder 1024; [void][W]::SendMessage($h, 0x000D, [IntPtr]1024, $sb); return $sb.ToString() }

if ($Op -eq 'gone') {
  $d = Get-Dialog 0
  if ($null -eq $d) { 'NO DIALOG open' } else { "STILL OPEN [$($d.Current.Name)]" }
  exit 0
}
$d = Get-Dialog $WaitSec
if ($null -eq $d) { "NO DIALOG from process $procId"; exit 2 }
$dh = [IntPtr]$d.Current.NativeWindowHandle
Own $dh

switch ($Op) {
  'find' {
    "DIALOG title=[$($d.Current.Name)] pid=$procId"
    foreach ($e in $d.FindAll($T::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
      $c = $e.Current
      $type = $c.ControlType.ProgrammaticName -replace 'ControlType\.', ''
      $isNative = $c.ClassName -in @('Edit', 'Button', 'ComboBox', 'Static', 'DirectUIHWND')
      if ($c.IsOffscreen -or -not ($isNative -or $type -in @('Text', 'Button', 'Edit'))) { continue }
      if ($c.Name -eq '' -and $c.AutomationId -eq '') { continue }
      $val = if ($c.NativeWindowHandle -ne 0 -and $c.ClassName -eq 'Edit') { TextOf ([IntPtr]$c.NativeWindowHandle) } else { '' }
      "  $type class=[$($c.ClassName)] id=[$($c.AutomationId)] name=[$($c.Name)]" + $(if ($val) { " text=[$val]" } else { '' }) + " focus=$($c.HasKeyboardFocus)"
    }
  }
  'setname' {
    $edit = Native $d '1001' 'Edit'
    if ($edit -eq [IntPtr]::Zero) { $edit = Native $d '1148' 'Edit' }
    if ($edit -eq [IntPtr]::Zero) { throw 'no File name box' }
    Own $edit
    [void][W]::SendMessage($edit, 0x000C, [IntPtr]::Zero, $Value)   # WM_SETTEXT
    "SET file name = [$(TextOf $edit)]"
  }
  'ok' {
    $btn = Native $d '1' 'Button'
    if ($btn -eq [IntPtr]::Zero) { throw 'no Save/Open button' }
    Own $btn
    "PRESS [$(TextOf $btn)] in [$($d.Current.Name)]"
    [void][W]::PostMessage($dh, 0x0111, [IntPtr]1, $btn)          # WM_COMMAND, IDOK, BN_CLICKED from that button
  }
  'tdclick' {
    "TASK DIALOG [$($d.Current.Name)]: click button id $Value"
    [void][W]::PostMessage($dh, 0x0466, [IntPtr][int]$Value, [IntPtr]::Zero)   # TDM_CLICK_BUTTON
  }
  'shot' {
    $r = New-Object W+R
    [void][W]::GetWindowRect($dh, [ref]$r)
    $bmp = New-Object System.Drawing.Bitmap ($r.Rt - $r.L), ($r.B - $r.T)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $hdc = $g.GetHdc()
    $ok = [W]::PrintWindow($dh, $hdc, 2)
    $g.ReleaseHdc($hdc); $g.Dispose()
    $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
    "SHOT $Out printwindow=$ok size=$($r.Rt - $r.L)x$($r.B - $r.T)"
  }
}
