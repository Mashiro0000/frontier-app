# Stage 13.1 probe launcher: PROTOTYPE, a test tool only (not shipped; the app's own launcher is slice 13.2).
# Makes one process inside an AppContainer (mode "container") or, for the probe's negative control only, as a plain child
# process (mode "plain"), puts it in a job object with limits, collects its output and writes a JSON result file.
# Input: a JSON spec file (-SpecPath). Nothing but the spec file is read; nothing reaches the command as text.
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

public class SbxResult {
  public bool Started;
  public string Error;
  public int ProcessId;
  public long ExitCode;
  public bool TimedOut;
  public long ElapsedMs;
  public byte[] Stdout;
  public byte[] Stderr;
  public long StdoutTotal;
  public long StderrTotal;
  public long PeakJobMemory;
  public uint ActiveBeforeKill;
  public uint ActiveAfterKill;
}

public static class Sbx {
  const uint CREATE_SUSPENDED = 0x4;
  const uint CREATE_UNICODE_ENVIRONMENT = 0x400;
  const uint EXTENDED_STARTUPINFO_PRESENT = 0x80000;
  const uint CREATE_NO_WINDOW = 0x08000000;
  const int STARTF_USESTDHANDLES = 0x100;
  const uint HANDLE_FLAG_INHERIT = 1;
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
  static extern int DeleteAppContainerProfile(string name);
  [DllImport("userenv.dll", CharSet = CharSet.Unicode)]
  static extern int DeriveAppContainerSidFromAppContainerName(string name, out IntPtr sid);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool ConvertSidToStringSid(IntPtr sid, out IntPtr str);
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
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr h, out uint code);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr h, uint code);

  static Exception Err(int code, string what) { return new Exception(what + ": error " + code + " (" + new Win32Exception(code).Message + ")"); }

  public static int DeleteProfile(string name) { return DeleteAppContainerProfile(name); }

  public static string ContainerSid(string name) {
    IntPtr sid;
        int hr = CreateAppContainerProfile(name, name, name, IntPtr.Zero, 0, out sid);
    if (hr == unchecked((int)0x800700B7)) hr = DeriveAppContainerSidFromAppContainerName(name, out sid);
    if (hr != 0) throw Err(hr, "AppContainer profile failed");
    IntPtr str;
    if (!ConvertSidToStringSid(sid, out str)) throw Err(Marshal.GetLastWin32Error(), "win32");
    string s = Marshal.PtrToStringUni(str);
    LocalFree(str);
    return s;
  }

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
    if (keys.Count == 0) sb.Append('\0');
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

  public static SbxResult Run(bool container, string containerSid, string program, string[] args, string cwd,
                              Dictionary<string, string> env, int timeoutMs, long memoryBytes, int maxProcesses, int capBytes) {
    SbxResult r = new SbxResult();
    bool noKill = env.ContainsKey("__nokill__");
    env.Remove("__nokill__");
    IntPtr job = IntPtr.Zero;
    IntPtr inR = IntPtr.Zero, inW = IntPtr.Zero, outR = IntPtr.Zero, outW = IntPtr.Zero, errR = IntPtr.Zero, errW = IntPtr.Zero;
    IntPtr attr = IntPtr.Zero, hlMem = IntPtr.Zero, scMem = IntPtr.Zero, envMem = IntPtr.Zero, sidPtr = IntPtr.Zero;
    PROCESS_INFORMATION pi = new PROCESS_INFORMATION();
    bool created = false;
    try {
      job = CreateJobObjectW(IntPtr.Zero, null);
      if (job == IntPtr.Zero) throw Err(Marshal.GetLastWin32Error(), "CreateJobObject");
      JOBOBJECT_EXTENDED_LIMIT_INFORMATION ext = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
      ext.BasicLimitInformation.LimitFlags = (noKill ? 0 : 0x2000) | 0x8 | 0x400 | 0x200; // kill on close, active processes, die on unhandled exception, job memory
      ext.BasicLimitInformation.ActiveProcessLimit = maxProcesses;
      ext.JobMemoryLimit = new UIntPtr((ulong)memoryBytes);
      SetJob(job, 9, ext);
      string uiv = env.ContainsKey("__ui__") ? env["__ui__"] : "255";
      env.Remove("__ui__");
      if (uiv != "0") {
        JOBOBJECT_BASIC_UI_RESTRICTIONS ui = new JOBOBJECT_BASIC_UI_RESTRICTIONS();
        ui.UIRestrictionsClass = int.Parse(uiv);
        SetJob(job, 4, ui);
      }

      SECURITY_ATTRIBUTES sa = new SECURITY_ATTRIBUTES();
      sa.nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)); sa.bInheritHandle = 1;
      if (!CreatePipe(out inR, out inW, ref sa, 0)) throw Err(Marshal.GetLastWin32Error(), "CreatePipe");
      if (!CreatePipe(out outR, out outW, ref sa, 0)) throw Err(Marshal.GetLastWin32Error(), "CreatePipe");
      if (!CreatePipe(out errR, out errW, ref sa, 0)) throw Err(Marshal.GetLastWin32Error(), "CreatePipe");
      SetHandleInformation(inW, HANDLE_FLAG_INHERIT, 0);
      SetHandleInformation(outR, HANDLE_FLAG_INHERIT, 0);
      SetHandleInformation(errR, HANDLE_FLAG_INHERIT, 0);

      bool noHl = env.ContainsKey("__nohl__"), noNw = env.ContainsKey("__nonw__"), nullApp = env.ContainsKey("__nullapp__"), noUni = env.ContainsKey("__nouni__");
      env.Remove("__nohl__"); env.Remove("__nonw__"); env.Remove("__nullapp__"); env.Remove("__nouni__");
      int attrCount = (container ? 1 : 0) + (noHl ? 0 : 1);
      IntPtr size = IntPtr.Zero;
      InitializeProcThreadAttributeList(IntPtr.Zero, attrCount, 0, ref size);
      attr = Marshal.AllocHGlobal(size);
      if (!InitializeProcThreadAttributeList(attr, attrCount, 0, ref size)) throw Err(Marshal.GetLastWin32Error(), "InitializeProcThreadAttributeList");
      IntPtr[] hs = new IntPtr[] { inR, outW, errW };
      hlMem = Marshal.AllocHGlobal(IntPtr.Size * 3);
      Marshal.Copy(hs, 0, hlMem, 3);
      if (!noHl && !UpdateProcThreadAttribute(attr, 0, ATTR_HANDLE_LIST, hlMem, (IntPtr)(IntPtr.Size * 3), IntPtr.Zero, IntPtr.Zero))
        throw Err(Marshal.GetLastWin32Error(), "UpdateProcThreadAttribute handle list");
      if (container) {
        string s = containerSid;
        IntPtr sidP;
        if (!ConvertStringSidToSid(s, out sidP)) throw Err(Marshal.GetLastWin32Error(), "ConvertStringSidToSid");
        sidPtr = sidP;
        SECURITY_CAPABILITIES sc = new SECURITY_CAPABILITIES();
        sc.AppContainerSid = sidPtr; sc.Capabilities = IntPtr.Zero; sc.CapabilityCount = 0;
        int scLen = Marshal.SizeOf(typeof(SECURITY_CAPABILITIES));
        scMem = Marshal.AllocHGlobal(scLen);
        Marshal.StructureToPtr(sc, scMem, false);
        if (!UpdateProcThreadAttribute(attr, 0, ATTR_SECURITY_CAPABILITIES, scMem, (IntPtr)scLen, IntPtr.Zero, IntPtr.Zero))
          throw Err(Marshal.GetLastWin32Error(), "UpdateProcThreadAttribute capabilities");
      }

      STARTUPINFOEX si = new STARTUPINFOEX();
      si.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
      si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
      si.StartupInfo.hStdInput = inR; si.StartupInfo.hStdOutput = outW; si.StartupInfo.hStdError = errW;
      si.lpAttributeList = attr;

      StringBuilder cmd = new StringBuilder(Quote(program));
      foreach (string a in args) { cmd.Append(' '); cmd.Append(Quote(a)); }
      envMem = env.ContainsKey("__inherit__") ? IntPtr.Zero : MakeEnv(env);
      uint flags = EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED;
      bool detached = env.ContainsKey("__detached__");
      env.Remove("__detached__");
      if (detached) flags |= 0x8; else if (!noNw) flags |= CREATE_NO_WINDOW;
      if (!noUni) flags |= CREATE_UNICODE_ENVIRONMENT;
      System.Diagnostics.Stopwatch sw = new System.Diagnostics.Stopwatch();
      if (!CreateProcessW(nullApp ? null : program, cmd, IntPtr.Zero, IntPtr.Zero, true, flags, envMem, cwd, ref si, out pi))
        throw Err(Marshal.GetLastWin32Error(), "CreateProcess");
      created = true;
      r.ProcessId = pi.dwProcessId;
      if (!AssignProcessToJobObject(job, pi.hProcess)) {
        int e = Marshal.GetLastWin32Error();
        TerminateProcess(pi.hProcess, 1);
        throw Err(e, "AssignProcessToJobObject");
      }
      // the child's ends are now the child's; close ours so the pipes end when the child side closes
      CloseHandle(inR); inR = IntPtr.Zero; CloseHandle(outW); outW = IntPtr.Zero; CloseHandle(errW); errW = IntPtr.Zero;
      CloseHandle(inW); inW = IntPtr.Zero;
      Collector co = new Collector(capBytes), ce = new Collector(capBytes);
      IntPtr outRh = outR, errRh = errR; outR = IntPtr.Zero; errR = IntPtr.Zero;
      Thread to = new Thread(delegate() { Pump(outRh, co); }); to.IsBackground = true; to.Start();
      Thread te = new Thread(delegate() { Pump(errRh, ce); }); te.IsBackground = true; te.Start();
      sw.Start();
      if (ResumeThread(pi.hThread) == 0xFFFFFFFF) throw Err(Marshal.GetLastWin32Error(), "ResumeThread");
      r.Started = true;
      uint w = WaitForSingleObject(pi.hProcess, (uint)timeoutMs);
      r.TimedOut = (w == 0x102);
      r.ActiveBeforeKill = ActiveCount(job);
      r.PeakJobMemory = PeakMemory(job);
      if (!noKill) TerminateJobObject(job, 1);
      WaitForSingleObject(pi.hProcess, 5000);
      sw.Stop();
      r.ElapsedMs = sw.ElapsedMilliseconds;
      uint code; GetExitCodeProcess(pi.hProcess, out code);
      r.ExitCode = (long)code;
      to.Join(5000); te.Join(5000);
      r.ActiveAfterKill = ActiveCount(job);
      r.Stdout = new byte[co.Len]; Buffer.BlockCopy(co.Buf, 0, r.Stdout, 0, co.Len); r.StdoutTotal = co.Total;
      r.Stderr = new byte[ce.Len]; Buffer.BlockCopy(ce.Buf, 0, r.Stderr, 0, ce.Len); r.StderrTotal = ce.Total;
    } catch (Exception ex) {
      r.Error = ex.Message;
    } finally {
      if (created) { CloseHandle(pi.hThread); CloseHandle(pi.hProcess); }
      if (job != IntPtr.Zero) CloseHandle(job);
      foreach (IntPtr h in new IntPtr[] { inR, inW, outR, outW, errR, errW }) if (h != IntPtr.Zero) CloseHandle(h);
      if (attr != IntPtr.Zero) { DeleteProcThreadAttributeList(attr); Marshal.FreeHGlobal(attr); }
      if (hlMem != IntPtr.Zero) Marshal.FreeHGlobal(hlMem);
      if (scMem != IntPtr.Zero) Marshal.FreeHGlobal(scMem);
      if (envMem != IntPtr.Zero) Marshal.FreeHGlobal(envMem);
      if (sidPtr != IntPtr.Zero) LocalFree(sidPtr);
    }
    return r;
  }

  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool ConvertStringSidToSid(string s, out IntPtr sid);
}
'@

Add-Type -TypeDefinition $src -Language CSharp

$spec = Get-Content -LiteralPath $SpecPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($spec.mode -eq 'delete-profile') {
  $hr = [Sbx]::DeleteProfile([string]$spec.container)
  [System.IO.File]::WriteAllText([string]$spec.result, (@{ deleteProfileHresult = $hr } | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
  exit 0
}
$container = ($spec.mode -eq 'container')
$sid = $null
if ($container) {
  $sid = [Sbx]::ContainerSid([string]$spec.container)
  foreach ($dir in @($spec.readDirs)) {
    $acl = [System.IO.Directory]::GetAccessControl($dir, [System.Security.AccessControl.AccessControlSections]::Access)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule((New-Object System.Security.Principal.SecurityIdentifier($sid)), [System.Security.AccessControl.FileSystemRights]::ReadAndExecute, 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
    [System.IO.Directory]::SetAccessControl($dir, $acl)
  }
  foreach ($dir in @($spec.grantDirs)) {
    $acl = [System.IO.Directory]::GetAccessControl($dir, [System.Security.AccessControl.AccessControlSections]::Access)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule((New-Object System.Security.Principal.SecurityIdentifier($sid)), [System.Security.AccessControl.FileSystemRights]::Modify, 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
    [System.IO.Directory]::SetAccessControl($dir, $acl)
  }
}
$envd = New-Object 'System.Collections.Generic.Dictionary[string,string]'
foreach ($p in $spec.env.PSObject.Properties) { $envd[$p.Name] = [string]$p.Value }
$argv = [string[]]@($spec.args | ForEach-Object { [string]$_ })
$r = [Sbx]::Run($container, $sid, [string]$spec.program, $argv, [string]$spec.cwd, $envd, [int]$spec.timeoutMs, [long]$spec.memoryBytes, [int]$spec.maxProcesses, [int]$spec.capBytes)
$utf8 = New-Object System.Text.UTF8Encoding($false)
if ($null -eq $r.Stdout) { $r.Stdout = [byte[]]@() }
if ($null -eq $r.Stderr) { $r.Stderr = [byte[]]@() }
$out = [ordered]@{
  started = $r.Started; error = $r.Error; pid = $r.ProcessId; exitCode = $r.ExitCode; timedOut = $r.TimedOut
  elapsedMs = $r.ElapsedMs; peakJobMemory = $r.PeakJobMemory; activeBeforeKill = $r.ActiveBeforeKill; activeAfterKill = $r.ActiveAfterKill
  stdout = $utf8.GetString($r.Stdout); stderr = $utf8.GetString($r.Stderr); stdoutTotal = $r.StdoutTotal; stderrTotal = $r.StderrTotal
  containerSid = $sid
}
[System.IO.File]::WriteAllText([string]$spec.result, ($out | ConvertTo-Json -Depth 4), $utf8)
