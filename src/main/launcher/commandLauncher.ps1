# Frontier App: the launcher of Stage 13 (D-043). Kept inside the app, written to disk by the app, hashed before every use (commandRunner.ts).
# NEVER written by a model, never given text to run: it reads ONE json spec file (-SpecPath) and nothing else, and writes ONE json result.
#
# What it does, in this order, and nothing else:
#   1. checks the spec (every field, with limits of its own that no caller can raise);
#   2. derives the AppContainer for the name in the spec (made on first use), gives it modify rights on the scratch folder only and
#      read-and-execute rights on the tools folder only (both must lie inside the run root, and neither may be a link);
#   3. shows the scratch folder to the box as the ROOT of a drive letter (Node's real-path code asks for C:\ itself, which a container may
#      not touch, and a drive whose root is the folder has no ancestors);
#   4. makes ONE process in the container with NO capabilities (so: no network of any kind), in a job object (kill on close, a count of
#      processes, a job-wide memory limit, no desktop / clipboard / handle tricks), with its own pipes and an environment built here from
#      nothing (nothing of the app goes in), suspended, then resumes it;
#   5. waits for it, for the clock, or for the app to die (then it ends the job at once); ends the job in every case, so that nothing
#      outlives the run; takes the drive letter away again; writes the result.
# There is NO unsandboxed mode here and no flag that makes one: if the container cannot be made, the result says so and nothing runs.
param([Parameter(Mandatory = $true)][string]$SpecPath)
$ErrorActionPreference = 'Stop'

$src = @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;

public class BoxResult {
  public string Stage;
  public string Error;
  public bool Started;
  public int ProcessId;
  public long ExitCode;
  public bool TimedOut;
  public bool ParentGone;
  public long ElapsedMs;
  public byte[] Stdout;
  public byte[] Stderr;
  public long StdoutTotal;
  public long StderrTotal;
  public long PeakJobMemory;
  public uint ActiveBeforeKill;
  public uint ActiveAfterKill;
  public string Letter;
}

public static class Box {
  const uint CREATE_SUSPENDED = 0x4;
  const uint CREATE_UNICODE_ENVIRONMENT = 0x400;
  const uint EXTENDED_STARTUPINFO_PRESENT = 0x80000;
  const uint CREATE_NO_WINDOW = 0x08000000;
  const int STARTF_USESTDHANDLES = 0x100;
  const uint HANDLE_FLAG_INHERIT = 1;
  const uint SYNCHRONIZE = 0x00100000;
  static readonly IntPtr ATTR_SECURITY_CAPABILITIES = (IntPtr)0x20009;
  static readonly IntPtr ATTR_HANDLE_LIST = (IntPtr)0x20002;

  [StructLayout(LayoutKind.Sequential)]
  struct SECURITY_ATTRIBUTES { public int nLength; public IntPtr lpSecurityDescriptor; public int bInheritHandle; }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct STARTUPINFO {
    public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
    public int dwX; public int dwY; public int dwXSize; public int dwYSize; public int dwXCountChars; public int dwYCountChars;
    public int dwFillAttribute; public int dwFlags; public short wShowWindow; public short cbReserved2;
    public IntPtr lpReserved2; public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }

  [StructLayout(LayoutKind.Sequential)]
  struct PROCESS_INFORMATION { public IntPtr hProcess; public IntPtr hThread; public int dwProcessId; public int dwThreadId; }

  [StructLayout(LayoutKind.Sequential)]
  struct SECURITY_CAPABILITIES { public IntPtr AppContainerSid; public IntPtr Capabilities; public int CapabilityCount; public int Reserved; }

  [StructLayout(LayoutKind.Sequential)]
  struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
    public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit; public int LimitFlags;
    public UIntPtr MinimumWorkingSetSize; public UIntPtr MaximumWorkingSetSize; public int ActiveProcessLimit;
    public UIntPtr Affinity; public int PriorityClass; public int SchedulingClass;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct IO_COUNTERS { public ulong a; public ulong b; public ulong c; public ulong d; public ulong e; public ulong f; }

  [StructLayout(LayoutKind.Sequential)]
  struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
    public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation; public IO_COUNTERS IoInfo;
    public UIntPtr ProcessMemoryLimit; public UIntPtr JobMemoryLimit; public UIntPtr PeakProcessMemoryUsed; public UIntPtr PeakJobMemoryUsed;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct JOBOBJECT_BASIC_UI_RESTRICTIONS { public int UIRestrictionsClass; }

  [StructLayout(LayoutKind.Sequential)]
  struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION {
    public long TotalUserTime; public long TotalKernelTime; public long ThisPeriodTotalUserTime; public long ThisPeriodTotalKernelTime;
    public uint TotalPageFaultCount; public uint TotalProcesses; public uint ActiveProcesses; public uint TotalTerminatedProcesses;
  }

  [DllImport("userenv.dll", CharSet = CharSet.Unicode)]
  static extern int CreateAppContainerProfile(string name, string display, string desc, IntPtr caps, uint count, out IntPtr sid);
  [DllImport("userenv.dll", CharSet = CharSet.Unicode)]
  static extern int DeriveAppContainerSidFromAppContainerName(string name, out IntPtr sid);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool ConvertSidToStringSid(IntPtr sid, out IntPtr str);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool ConvertStringSidToSid(string s, out IntPtr sid);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr p);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool CreatePipe(out IntPtr read, out IntPtr write, ref SECURITY_ATTRIBUTES sa, int size);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetHandleInformation(IntPtr h, uint mask, uint flags);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attr, IntPtr value, IntPtr size, IntPtr prev, IntPtr ret);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CreateProcessW(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFOEX si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr CreateJobObjectW(IntPtr attrs, string name);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetInformationJobObject(IntPtr job, int cls, IntPtr info, int len);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool QueryInformationJobObject(IntPtr job, int cls, IntPtr info, int len, IntPtr ret);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr t);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForMultipleObjects(uint count, IntPtr[] handles, bool all, uint ms);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr h, out uint code);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr h, uint code);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool DefineDosDeviceW(uint flags, string device, string target);
  [DllImport("kernel32.dll")] static extern uint GetLogicalDrives();

  static Exception Err(int code, string what) {
    return new Exception(what + ": error " + code + " (" + new Win32Exception(code).Message + ")");
  }

  // ---- the container ------------------------------------------------------------------------------------------------------------
  public static string ContainerSid(string name) {
    IntPtr sid;
    int hr = CreateAppContainerProfile(name, name, name, IntPtr.Zero, 0, out sid);
    if (hr == unchecked((int)0x800700B7)) hr = DeriveAppContainerSidFromAppContainerName(name, out sid);
    if (hr != 0) throw Err(hr, "AppContainer profile");
    IntPtr str;
    if (!ConvertSidToStringSid(sid, out str)) throw Err(Marshal.GetLastWin32Error(), "ConvertSidToStringSid");
    string s = Marshal.PtrToStringUni(str);
    LocalFree(str);
    return s;
  }

  // ---- a drive letter whose root is the scratch folder (what subst.exe does) -------------------------------------------------------
  public static string Mount(string folder) {
    uint used = GetLogicalDrives();
    for (int i = 25; i >= 3; i--) {
      if ((used & (1u << i)) != 0) continue;
      string dev = ((char)('A' + i)).ToString() + ":";
      if (!DefineDosDeviceW(1, dev, "\\??\\" + folder)) continue;
      if ((GetLogicalDrives() & (1u << i)) == 0) { DefineDosDeviceW(1 | 2 | 4, dev, "\\??\\" + folder); continue; }
      return dev;
    }
    throw new Exception("no free drive letter");
  }

  public static bool Unmount(string dev, string folder) {
    return DefineDosDeviceW(1 | 2 | 4, dev, "\\??\\" + folder);
  }

  // ---- the command line (the rules CommandLineToArgvW reads back) --------------------------------------------------------------------
  static string Quote(string a) {
    if (a.Length > 0 && a.IndexOfAny(new char[] { ' ', '\t', '\n', '\v', '"' }) < 0) return a;
    StringBuilder sb = new StringBuilder("\"");
    int bs = 0;
    foreach (char c in a) {
      if (c == '\\') { bs++; }
      else if (c == '"') { sb.Append('\\', bs * 2 + 1); sb.Append('"'); bs = 0; }
      else { sb.Append('\\', bs); bs = 0; sb.Append(c); }
    }
    sb.Append('\\', bs * 2);
    sb.Append('"');
    return sb.ToString();
  }

  class Collector {
    public byte[] Buf; public int Len; public long Total; public int Cap;
    public Collector(int cap) { Cap = cap; Buf = new byte[cap]; }
  }

  static void Pump(IntPtr readHandle, Collector c) {
    FileStream fs = new FileStream(new SafeFileHandle(readHandle, true), FileAccess.Read, 4096, false);
    byte[] chunk = new byte[8192];
    try {
      int n;
      while ((n = fs.Read(chunk, 0, chunk.Length)) > 0) {
        c.Total += n;
        int room = c.Cap - c.Len;
        if (room > 0) { int take = n < room ? n : room; Buffer.BlockCopy(chunk, 0, c.Buf, c.Len, take); c.Len += take; }
      }
    } catch (Exception) { }
    try { fs.Dispose(); } catch (Exception) { }
  }

  static IntPtr MakeEnv(Dictionary<string, string> env) {
    List<string> keys = new List<string>(env.Keys);
    keys.Sort(StringComparer.OrdinalIgnoreCase);
    StringBuilder sb = new StringBuilder();
    foreach (string k in keys) { sb.Append(k); sb.Append('='); sb.Append(env[k]); sb.Append('\0'); }
    sb.Append('\0');
    return Marshal.StringToHGlobalUni(sb.ToString());
  }

  static void SetJob(IntPtr job, int cls, object info) {
    int len = Marshal.SizeOf(info.GetType());
    IntPtr p = Marshal.AllocHGlobal(len);
    try {
      Marshal.StructureToPtr(info, p, false);
      if (!SetInformationJobObject(job, cls, p, len)) throw Err(Marshal.GetLastWin32Error(), "SetInformationJobObject " + cls);
    } finally { Marshal.FreeHGlobal(p); }
  }

  static uint ActiveCount(IntPtr job) {
    int len = Marshal.SizeOf(typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION));
    IntPtr p = Marshal.AllocHGlobal(len);
    try {
      if (!QueryInformationJobObject(job, 1, p, len, IntPtr.Zero)) return 9999;
      JOBOBJECT_BASIC_ACCOUNTING_INFORMATION a = (JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)Marshal.PtrToStructure(p, typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION));
      return a.ActiveProcesses;
    } finally { Marshal.FreeHGlobal(p); }
  }

  static long PeakMemory(IntPtr job) {
    int len = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
    IntPtr p = Marshal.AllocHGlobal(len);
    try {
      if (!QueryInformationJobObject(job, 9, p, len, IntPtr.Zero)) return -1;
      JOBOBJECT_EXTENDED_LIMIT_INFORMATION e = (JOBOBJECT_EXTENDED_LIMIT_INFORMATION)Marshal.PtrToStructure(p, typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
      return (long)e.PeakJobMemoryUsed.ToUInt64();
    } finally { Marshal.FreeHGlobal(p); }
  }

  // ---- the run -----------------------------------------------------------------------------------------------------------------------
  public static BoxResult Run(string containerSid, string program, string[] args, string cwd, Dictionary<string, string> env,
                              int timeoutMs, long memoryBytes, int maxProcesses, int capBytes, int parentPid) {
    BoxResult r = new BoxResult();
    r.Stage = "start";
    IntPtr job = IntPtr.Zero, parent = IntPtr.Zero;
    IntPtr inR = IntPtr.Zero, inW = IntPtr.Zero, outR = IntPtr.Zero, outW = IntPtr.Zero, errR = IntPtr.Zero, errW = IntPtr.Zero;
    IntPtr attr = IntPtr.Zero, hlMem = IntPtr.Zero, scMem = IntPtr.Zero, envMem = IntPtr.Zero, sidPtr = IntPtr.Zero;
    PROCESS_INFORMATION pi = new PROCESS_INFORMATION();
    bool created = false;
    try {
      if (parentPid > 0) {
        parent = OpenProcess(SYNCHRONIZE, false, parentPid);
        if (parent == IntPtr.Zero) throw Err(Marshal.GetLastWin32Error(), "OpenProcess (the app)");
      }
      r.Stage = "job";
      job = CreateJobObjectW(IntPtr.Zero, null);
      if (job == IntPtr.Zero) throw Err(Marshal.GetLastWin32Error(), "CreateJobObject");
      JOBOBJECT_EXTENDED_LIMIT_INFORMATION ext = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
      ext.BasicLimitInformation.LimitFlags = 0x2000 | 0x8 | 0x400 | 0x200; // kill on close, active processes, die on unhandled exception, job memory
      ext.BasicLimitInformation.ActiveProcessLimit = maxProcesses;
      ext.JobMemoryLimit = new UIntPtr((ulong)memoryBytes);
      SetJob(job, 9, ext);
      JOBOBJECT_BASIC_UI_RESTRICTIONS ui = new JOBOBJECT_BASIC_UI_RESTRICTIONS();
      ui.UIRestrictionsClass = 0xFF;
      SetJob(job, 4, ui);

      r.Stage = "pipes";
      SECURITY_ATTRIBUTES sa = new SECURITY_ATTRIBUTES();
      sa.nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)); sa.bInheritHandle = 1;
      if (!CreatePipe(out inR, out inW, ref sa, 0)) throw Err(Marshal.GetLastWin32Error(), "CreatePipe");
      if (!CreatePipe(out outR, out outW, ref sa, 0)) throw Err(Marshal.GetLastWin32Error(), "CreatePipe");
      if (!CreatePipe(out errR, out errW, ref sa, 0)) throw Err(Marshal.GetLastWin32Error(), "CreatePipe");
      SetHandleInformation(inW, HANDLE_FLAG_INHERIT, 0);
      SetHandleInformation(outR, HANDLE_FLAG_INHERIT, 0);
      SetHandleInformation(errR, HANDLE_FLAG_INHERIT, 0);

      r.Stage = "attributes";
      IntPtr size = IntPtr.Zero;
      InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref size);
      attr = Marshal.AllocHGlobal(size);
      if (!InitializeProcThreadAttributeList(attr, 2, 0, ref size)) throw Err(Marshal.GetLastWin32Error(), "InitializeProcThreadAttributeList");
      IntPtr[] hs = new IntPtr[] { inR, outW, errW };
      hlMem = Marshal.AllocHGlobal(IntPtr.Size * 3);
      Marshal.Copy(hs, 0, hlMem, 3);
      if (!UpdateProcThreadAttribute(attr, 0, ATTR_HANDLE_LIST, hlMem, (IntPtr)(IntPtr.Size * 3), IntPtr.Zero, IntPtr.Zero))
        throw Err(Marshal.GetLastWin32Error(), "UpdateProcThreadAttribute handle list");
      if (!ConvertStringSidToSid(containerSid, out sidPtr)) throw Err(Marshal.GetLastWin32Error(), "ConvertStringSidToSid");
      SECURITY_CAPABILITIES sc = new SECURITY_CAPABILITIES();
      sc.AppContainerSid = sidPtr; sc.Capabilities = IntPtr.Zero; sc.CapabilityCount = 0; // NO capabilities: no network, not even to this computer
      int scLen = Marshal.SizeOf(typeof(SECURITY_CAPABILITIES));
      scMem = Marshal.AllocHGlobal(scLen);
      Marshal.StructureToPtr(sc, scMem, false);
      if (!UpdateProcThreadAttribute(attr, 0, ATTR_SECURITY_CAPABILITIES, scMem, (IntPtr)scLen, IntPtr.Zero, IntPtr.Zero))
        throw Err(Marshal.GetLastWin32Error(), "UpdateProcThreadAttribute capabilities");

      STARTUPINFOEX si = new STARTUPINFOEX();
      si.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
      si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
      si.StartupInfo.hStdInput = inR; si.StartupInfo.hStdOutput = outW; si.StartupInfo.hStdError = errW;
      si.lpAttributeList = attr;

      StringBuilder cmd = new StringBuilder(Quote(program));
      foreach (string a in args) { cmd.Append(' '); cmd.Append(Quote(a)); }
      if (cmd.Length > 32000) throw new Exception("the command line is longer than Windows allows");
      envMem = MakeEnv(env);
      r.Stage = "create-process";
      uint flags = EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED | CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT;
      if (!CreateProcessW(program, cmd, IntPtr.Zero, IntPtr.Zero, true, flags, envMem, cwd, ref si, out pi))
        throw Err(Marshal.GetLastWin32Error(), "CreateProcess");
      created = true;
      r.ProcessId = pi.dwProcessId;
      r.Stage = "assign";
      if (!AssignProcessToJobObject(job, pi.hProcess)) {
        int e = Marshal.GetLastWin32Error();
        TerminateProcess(pi.hProcess, 1);
        throw Err(e, "AssignProcessToJobObject");
      }
      // the child's ends are now the child's; close ours so that the pipes end when the child side closes
      CloseHandle(inR); inR = IntPtr.Zero; CloseHandle(outW); outW = IntPtr.Zero; CloseHandle(errW); errW = IntPtr.Zero;
      CloseHandle(inW); inW = IntPtr.Zero; // standard input: end of file at once
      Collector co = new Collector(capBytes), ce = new Collector(capBytes);
      IntPtr outRh = outR, errRh = errR; outR = IntPtr.Zero; errR = IntPtr.Zero;
      Thread to = new Thread(delegate() { Pump(outRh, co); }); to.IsBackground = true; to.Start();
      Thread te = new Thread(delegate() { Pump(errRh, ce); }); te.IsBackground = true; te.Start();
      r.Stage = "run";
      System.Diagnostics.Stopwatch sw = new System.Diagnostics.Stopwatch();
      sw.Start(); // the program's clock starts here, not when the container was made (that takes about a second)
      if (ResumeThread(pi.hThread) == 0xFFFFFFFF) throw Err(Marshal.GetLastWin32Error(), "ResumeThread");
      r.Started = true;
      uint w;
      if (parent != IntPtr.Zero) w = WaitForMultipleObjects(2, new IntPtr[] { pi.hProcess, parent }, false, (uint)timeoutMs);
      else w = WaitForSingleObject(pi.hProcess, (uint)timeoutMs);
      r.TimedOut = (w == 0x102);
      r.ParentGone = (w == 1);
      r.ActiveBeforeKill = ActiveCount(job);
      r.PeakJobMemory = PeakMemory(job);
      TerminateJobObject(job, 1);
      WaitForSingleObject(pi.hProcess, 5000);
      sw.Stop();
      r.ElapsedMs = sw.ElapsedMilliseconds;
      uint code; GetExitCodeProcess(pi.hProcess, out code);
      r.ExitCode = (long)code;
      to.Join(5000); te.Join(5000);
      r.ActiveAfterKill = ActiveCount(job);
      r.Stdout = new byte[co.Len]; Buffer.BlockCopy(co.Buf, 0, r.Stdout, 0, co.Len); r.StdoutTotal = co.Total;
      r.Stderr = new byte[ce.Len]; Buffer.BlockCopy(ce.Buf, 0, r.Stderr, 0, ce.Len); r.StderrTotal = ce.Total;
      r.Stage = "done";
    } catch (Exception ex) {
      r.Error = ex.Message;
    } finally {
      if (created) {
        if (job != IntPtr.Zero) TerminateJobObject(job, 1);
        CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
      }
      if (job != IntPtr.Zero) CloseHandle(job);
      if (parent != IntPtr.Zero) CloseHandle(parent);
      foreach (IntPtr h in new IntPtr[] { inR, inW, outR, outW, errR, errW }) if (h != IntPtr.Zero) CloseHandle(h);
      if (attr != IntPtr.Zero) { DeleteProcThreadAttributeList(attr); Marshal.FreeHGlobal(attr); }
      if (hlMem != IntPtr.Zero) Marshal.FreeHGlobal(hlMem);
      if (scMem != IntPtr.Zero) Marshal.FreeHGlobal(scMem);
      if (envMem != IntPtr.Zero) Marshal.FreeHGlobal(envMem);
      if (sidPtr != IntPtr.Zero) LocalFree(sidPtr);
    }
    return r;
  }
}
'@

# ---- the result is written in every case, even when this script fails before it can run anything --------------------------------------
$utf8 = New-Object System.Text.UTF8Encoding($false)
$resultPath = $null
function Write-Result($obj) {
  if ($null -ne $resultPath) { [System.IO.File]::WriteAllText($resultPath, ($obj | ConvertTo-Json -Depth 4), $utf8) }
}
function Fail($stage, $message) { Write-Result ([ordered]@{ ok = $false; stage = $stage; error = $message }); exit 0 }

# hard limits of the launcher itself: no caller can raise them
$MAX_TIMEOUT_MS = 120000; $MAX_MEMORY = 1073741824; $MAX_PROCESSES = 64; $MAX_CAP = 65536; $MAX_ARGS = 100; $MAX_ARG_CHARS = 8192

$stage = 'read-spec'
try {
  $spec = Get-Content -LiteralPath $SpecPath -Raw -Encoding UTF8 | ConvertFrom-Json
  # without a result path that is an ordinary absolute drive path there is nowhere it may write: it stops, writing nothing (exit code 2)
  $candidate = [string]$spec.result
  if ($candidate -notmatch '^[A-Za-z]:\\[^\\]') { exit 2 }
  $resultPath = $candidate
} catch { exit 2 }

$mounted = $null; $scratch = $null
try {
  $stage = 'check-spec'
  if ($spec.version -ne 1) { throw 'unknown spec version' }
  $names = @($spec.PSObject.Properties | ForEach-Object { $_.Name })
  foreach ($n in @('version', 'container', 'runRoot', 'scratchDir', 'toolsDir', 'program', 'args', 'timeoutMs', 'memoryBytes', 'maxProcesses', 'capBytes', 'parentPid', 'result')) {
    if ($names -notcontains $n) { throw "the spec has no field $n" }
  }
  if ($names.Count -ne 13) { throw 'the spec has a field too many' }
  if ([string]$spec.container -notmatch '^FrontierApp\.[A-Za-z0-9]{1,40}$') { throw 'the container name is not ours' }
  $timeoutMs = [int]$spec.timeoutMs; $memoryBytes = [long]$spec.memoryBytes; $maxProcesses = [int]$spec.maxProcesses; $capBytes = [int]$spec.capBytes; $parentPid = [int]$spec.parentPid
  if ($timeoutMs -lt 100 -or $timeoutMs -gt $MAX_TIMEOUT_MS) { throw 'timeoutMs is out of range' }
  if ($memoryBytes -lt 16777216 -or $memoryBytes -gt $MAX_MEMORY) { throw 'memoryBytes is out of range' }
  if ($maxProcesses -lt 1 -or $maxProcesses -gt $MAX_PROCESSES) { throw 'maxProcesses is out of range' }
  if ($capBytes -lt 1 -or $capBytes -gt $MAX_CAP) { throw 'capBytes is out of range' }
  if ($parentPid -lt 0) { throw 'parentPid is out of range' }
  $argv = @($spec.args | ForEach-Object { [string]$_ })
  if ($argv.Count -gt $MAX_ARGS) { throw 'too many arguments' }
  foreach ($a in $argv) { if ($a.Length -gt $MAX_ARG_CHARS -or $a.IndexOf([char]0) -ge 0) { throw 'an argument is too long or holds a NUL' } }
  foreach ($p in @($spec.runRoot, $spec.scratchDir, $spec.toolsDir, $spec.program)) {
    if (-not [System.IO.Path]::IsPathRooted([string]$p) -or ([string]$p).StartsWith('\\') -or ([string]$p).IndexOf([char]0) -ge 0) { throw 'a path is not an ordinary absolute drive path' }
  }
  $runRoot = [System.IO.Path]::GetFullPath([string]$spec.runRoot).TrimEnd('\')
  $scratch = [System.IO.Path]::GetFullPath([string]$spec.scratchDir).TrimEnd('\')
  $tools = [System.IO.Path]::GetFullPath([string]$spec.toolsDir).TrimEnd('\')
  $program = [System.IO.Path]::GetFullPath([string]$spec.program)
  if ($runRoot.Length -lt 6) { throw 'the run root is a drive root' }
  foreach ($p in @($scratch, $tools)) {
    if (-not $p.StartsWith($runRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) { throw 'a folder lies outside the run root' }
    if (-not [System.IO.Directory]::Exists($p)) { throw 'a folder is not there' }
    if (([System.IO.File]::GetAttributes($p) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'a folder is a link' }
  }
  if ($scratch.StartsWith($tools + '\', [System.StringComparison]::OrdinalIgnoreCase) -or $tools.StartsWith($scratch + '\', [System.StringComparison]::OrdinalIgnoreCase) -or $scratch -eq $tools) { throw 'the scratch and tools folders overlap' }
  if (-not [System.IO.File]::Exists($program) -or -not $program.EndsWith('.exe', [System.StringComparison]::OrdinalIgnoreCase)) { throw 'the program is not an .exe file that exists' }

  $stage = 'container'
  Add-Type -TypeDefinition $src -Language CSharp
  $sid = [Box]::ContainerSid([string]$spec.container)
  $stage = 'grants'
  $sidObj = New-Object System.Security.Principal.SecurityIdentifier($sid)
  foreach ($pair in @(@($scratch, [System.Security.AccessControl.FileSystemRights]::Modify), @($tools, [System.Security.AccessControl.FileSystemRights]::ReadAndExecute))) {
    $acl = [System.IO.Directory]::GetAccessControl($pair[0], [System.Security.AccessControl.AccessControlSections]::Access)
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($sidObj, $pair[1], 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
    [System.IO.Directory]::SetAccessControl($pair[0], $acl)
  }
  $stage = 'mount'
  $mounted = [Box]::Mount($scratch)
  $root = $mounted + '\'
  # the environment is built here, from nothing: nothing of the app goes in. LOCALAPPDATA must be there and APPDATA must not (measured, D-043)
  $envd = New-Object 'System.Collections.Generic.Dictionary[string,string]'
  $envd['SystemRoot'] = $env:SystemRoot
  $envd['windir'] = $env:SystemRoot
  $envd['ComSpec'] = Join-Path $env:SystemRoot 'System32\cmd.exe'
  $envd['PATHEXT'] = '.COM;.EXE;.BAT;.CMD'
  $envd['PATH'] = $tools + ';' + (Join-Path $env:SystemRoot 'System32') + ';' + $env:SystemRoot
  # Windows rewrites TEMP, TMP and LOCALAPPDATA of a container process to <LOCALAPPDATA we give>\Packages\<container name in lower case>\AC[\Temp]
  # (measured, D-043), folders that do not exist. So the box is given a folder of its own inside the scratch folder, with that tree made
  # beforehand, and its temp folder works. The comparison afterwards (13.3) leaves this one folder out.
  $boxData = $mounted + '\.frontier-box'
  $boxTemp = [System.IO.Path]::Combine($scratch, '.frontier-box', 'Packages', ([string]$spec.container).ToLowerInvariant(), 'AC', 'Temp')
  [void][System.IO.Directory]::CreateDirectory($boxTemp)
  $envd['LOCALAPPDATA'] = $boxData
  $envd['TEMP'] = $boxData + '\Packages\' + ([string]$spec.container).ToLowerInvariant() + '\AC\Temp'
  $envd['TMP'] = $envd['TEMP']
  foreach ($k in @('HOME', 'USERPROFILE')) { $envd[$k] = $root }
  $stage = 'run'
  $r = [Box]::Run($sid, $program, $argv, $root, $envd, $timeoutMs, $memoryBytes, $maxProcesses, $capBytes, $parentPid)
  if ($null -eq $r.Stdout) { $r.Stdout = [byte[]]@() }
  if ($null -eq $r.Stderr) { $r.Stderr = [byte[]]@() }
  $out = [ordered]@{
    ok = ($null -eq $r.Error); stage = $r.Stage; error = $r.Error; started = $r.Started; pid = $r.ProcessId; exitCode = $r.ExitCode
    timedOut = $r.TimedOut; parentGone = $r.ParentGone; elapsedMs = $r.ElapsedMs; peakJobMemory = $r.PeakJobMemory
    activeBeforeKill = $r.ActiveBeforeKill; activeAfterKill = $r.ActiveAfterKill
    stdout = $utf8.GetString($r.Stdout); stderr = $utf8.GetString($r.Stderr); stdoutBytes = $r.StdoutTotal; stderrBytes = $r.StderrTotal
    letter = $mounted
  }
  # the letter is taken away BEFORE the result is written, so that a reader of the result can rely on it
  [void][Box]::Unmount($mounted, $scratch); $mounted = $null
  Write-Result $out
} catch {
  $message = $_.Exception.Message
  if ($null -ne $mounted) { try { [void][Box]::Unmount($mounted, $scratch) } catch { } ; $mounted = $null }
  Fail $stage $message
}
