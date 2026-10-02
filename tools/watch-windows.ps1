# Read-only watcher for a regression run. It logs, with a time, every change of: what is in front (the title of the foreground window), where the test
# app's window ("Frontier App") is in the stacking order, whether it is minimized, hidden by the system ("cloaked"), and WHICH windows are above it and
# cover it (all of it, or part); and the moments the person touches the keyboard or the mouse. It moves, focuses and closes nothing, and it does not
# connect to the app. Use it to find out what is going on when a launch reports "!! slow mouse acknowledgement ... window state: hidden"
# (tools/README.md, "Lost windows"): start it before `node tools/regress.mjs <tag>` and read the log around the time of the stall.
#
# usage:  powershell -NoProfile -File tools\watch-windows.ps1 [-Tag <tag>] [-MaxMinutes 150]
# It stops when tools\.out\regress-<tag>.txt ends with "runs clean" (the end of `node tools/regress.mjs <tag>`) or after MaxMinutes.
# The log is tools\.out\watch-<tag>.log; a line is written only when something changed.
param([string]$Tag = 'run', [int]$MaxMinutes = 150)
$outDir = Join-Path $PSScriptRoot '.out'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$log = Join-Path $outDir "watch-$Tag.log"
$summary = Join-Path $outDir "regress-$Tag.txt"
Add-Type @"
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Text;
public static class FrontierWindowWatch {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int sz);
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO p);
  public static uint IdleMs() { LASTINPUTINFO i = new LASTINPUTINFO(); i.cbSize = (uint)Marshal.SizeOf(i); GetLastInputInfo(ref i); return (uint)Environment.TickCount - i.dwTime; }
  static string Title(IntPtr h) { var t = new StringBuilder(200); GetWindowText(h, t, 200); return t.ToString(); }
  class Win { public IntPtr H; public string Title; public RECT R; public bool Min, Cloaked; }
  public static string Snapshot() {
    IntPtr fg = GetForegroundWindow(); var all = new List<Win>();
    EnumWindows((h, l) => {          // top-level windows, topmost first
      if (!IsWindowVisible(h)) return true;
      var c = new StringBuilder(100); GetClassName(h, c, 100);
      int cl = 0; DwmGetWindowAttribute(h, 14, out cl, 4);
      RECT r; GetWindowRect(h, out r);
      all.Add(new Win { H = h, Title = Title(h), R = r, Min = IsIconic(h), Cloaked = cl != 0 });
      return true; }, IntPtr.Zero);
    int app = all.FindIndex(w => w.Title == "Frontier App" && !w.Cloaked);
    string front = "front=[" + Title(fg) + "]";
    if (app < 0) return front + " no app window";
    Win a = all[app]; var over = new List<string>();
    for (int i = 0; i < app; i++) {
      Win w = all[i];
      if (w.Title.Length == 0 || w.Min || w.Cloaked) continue;
      bool overlaps = w.R.L < a.R.R && w.R.R > a.R.L && w.R.T < a.R.B && w.R.B > a.R.T;
      if (!overlaps) continue;
      bool whole = w.R.L <= a.R.L && w.R.T <= a.R.T && w.R.R >= a.R.R && w.R.B >= a.R.B;
      over.Add("[" + w.Title + "]" + (whole ? " COVERS ALL" : " covers part"));
    }
    return front + " app: " + (a.H == fg ? "in front" : "z" + (app + 1)) + (a.Min ? " MINIMIZED" : "") + (over.Count > 0 ? " | above it: " + String.Join(", ", over) : "");
  }
}
"@
$start = Get-Date; $last = ''; $lastInput = [DateTime]::MinValue
"watch started $($start.ToString('HH:mm:ss'))" | Out-File -FilePath $log -Encoding utf8
while (((Get-Date) - $start).TotalMinutes -lt $MaxMinutes) {
  $now = Get-Date
  $s = [FrontierWindowWatch]::Snapshot()
  if ($s -ne $last) { '{0} {1}' -f $now.ToString('HH:mm:ss.fff'), $s | Out-File -FilePath $log -Append -Encoding utf8; $last = $s }
  if ([FrontierWindowWatch]::IdleMs() -lt 600 -and ($now - $lastInput).TotalSeconds -ge 2) { '{0} INPUT (the person touched the keyboard or the mouse)' -f $now.ToString('HH:mm:ss.fff') | Out-File -FilePath $log -Append -Encoding utf8; $lastInput = $now }
  if ((Test-Path $summary) -and ((Get-Content $summary -Tail 2 -ErrorAction SilentlyContinue) -match 'runs clean')) { '{0} the regression ended: the watcher stops' -f $now.ToString('HH:mm:ss.fff') | Out-File -FilePath $log -Append -Encoding utf8; break }
  Start-Sleep -Milliseconds 300
}
