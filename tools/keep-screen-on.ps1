# Keeps the display on while a window regression runs, and wakes it once at the start (a display that has gone off makes the test window
# "hidden": every click then stalls ~5 s and the run is marked BAD, see tools/README.md "Lost windows"). It changes no setting: it is the same
# request a video player makes, and it ends with this process. Stop it with Ctrl+C or by ending the process.
# usage: powershell -NoProfile -File tools/keep-screen-on.ps1 <minutes>
param([int]$Minutes = 60)
Add-Type -Namespace Win -Name Power -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);
[DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, uint data, System.UIntPtr extra);
'@
# ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED
[void][Win.Power]::SetThreadExecutionState([uint32]"0x80000003")
# one pixel there and back: wakes a display that is already off, and leaves the pointer where it was
[Win.Power]::mouse_event(1, 1, 0, 0, [UIntPtr]::Zero)
[Win.Power]::mouse_event(1, -1, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Seconds ($Minutes * 60)
