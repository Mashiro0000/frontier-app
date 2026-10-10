// Writes the negative-control specs for slice 13.2 (the launcher inside the app, D-043): one sabotage each of src/main/commandRunner.ts or
// src/main/launcher/commandLauncher.ps1, which verify-13-2.mjs (or, for the container itself, the probe run against the product launcher) must notice.
// usage: node tools/make-specs132.mjs
//   then: node tools/check-specs.mjs                   (dry check: every sabotage text occurs exactly once)
//         node tools/nc-all.mjs specs132 <names...>    (each runs only the sections of verify-13-2.mjs that can notice it, ONLY=...)
//   NOTE: the control 'lResultPath' makes the launcher write result.json into the CURRENT folder (the repo): delete the file afterwards.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const R = '{{REPO}}/'
const RUNNER = R + 'src/main/commandRunner.ts'
const PS = R + 'src/main/launcher/commandLauncher.ps1'

// the two places of the launcher where the process is put INSIDE the job (13.7) and checked to be there
const JOB_LIST_CALL =
  '      if (!UpdateProcThreadAttribute(attr, 0, ATTR_JOB_LIST, jlMem, (IntPtr)IntPtr.Size, IntPtr.Zero, IntPtr.Zero))\n' + '        throw Err(Marshal.GetLastWin32Error(), "UpdateProcThreadAttribute job list");\n'
// (the sabotages put 'if (inJob) {' in its place: inJob is false there, so nothing is checked, and the C# still compiles: Add-Type makes a warning an error)
const IN_JOB_IF = '      if (!IsProcessInJob(pi.hProcess, job, out inJob) || !inJob) {'

// name: [file, from, to, sections of verify-13-2.mjs that run (or 'probe'), more edits of the same file as [from, to] pairs (optional)]
const controls = {
  // ----- the runner: the request -----
  rContain: [RUNNER, "  if (!isInside(root, scratch)) return refuse('the folder is not inside the run root')", '', 'A'],
  rExe: [RUNNER, '  if (!/\\.exe$/i.test(program))', '  if (false)', 'A'],
  rNul: [RUNNER, "    if (a.includes('\\0')) return refuse('an argument holds a NUL character')", '', 'A'],
  rWellFormed: [RUNNER, '    if (!wellFormed(a))', '    if (false)', 'A'],
  rArgCount: [RUNNER, '  if (args.length > RUN_ARGS.count) return refuse(', '  if (args.length > 1e9) return refuse(', 'A'],
  rRange: [RUNNER, '  if (value < range.min || value > range.max)', '  if (false)', 'A'],
  // ----- the runner: which program -----
  rProgramAny: [RUNNER, '    if (isInside(systemRoot, program)) return program', '    return program', 'C'],
  rNodeAny: [RUNNER, '      programFilesDirs.some((d) => isInside(d, program))', '      true', 'C'],
  rNoCopy: [RUNNER, '      program = copy\n', '', 'C'],
  // ----- the runner: the launcher and what it says -----
  rLauncherHash: [RUNNER, "createHash('sha256').update(current, 'utf8').digest('hex') !== LAUNCHER_SHA256", 'false', 'F'],
  rTimeoutWhy: [RUNNER, "        why = 'timeout'", "        why = 'abort'", 'F'],
  rResultTypes: [RUNNER, "    if (typeof r[n] !== 'number' || !Number.isFinite(r[n]) || (r[n] as number) < -1)", '    if (false)', 'F'],
  rIsolation: [RUNNER, "  'container',\n", '', 'F'],
  rParentPid: [RUNNER, '          parentPid,\n', '          parentPid: 0,\n', 'F'],
  rTimeoutField: [RUNNER, '          timeoutMs: request.timeoutMs,', '          timeoutMs: 120000,', 'F'],
  rMemoryField: [RUNNER, '          memoryBytes: request.memoryBytes,', '          memoryBytes: RUN_LIMITS.memoryBytes.max,', 'F'],
  rCapField: [RUNNER, '          capBytes: request.outputBytes,', '          capBytes: 65536,', 'F'],
  rDiskField: [RUNNER, '          diskBytes: request.diskBytes,', '          diskBytes: 536870912,', 'F'],
  // ----- the runner: ending a run -----
  rUnmount: [RUNNER, '      if (why !== null || !(await exists(resultPath))) unmountFolder(request.scratchDir)', '', 'G'],
  rStopAll: [RUNNER, "      if (stopped && why === null) why = 'abort' // stopAll ended it", '', 'G'],
  // ----- the launcher: the box -----
  lNoCaps: [PS, 'if (!UpdateProcThreadAttribute(attr, 0, ATTR_SECURITY_CAPABILITIES, scMem, (IntPtr)scLen, IntPtr.Zero, IntPtr.Zero))', 'if (false)', 'probe'],
  lNoJobKill: [PS, '0x2000 | 0x8 | 0x400 | 0x200;', '0x8 | 0x400 | 0x200;', 'G'],
  lNoTerminate: [PS, '      TerminateJobObject(job, 1);\n      WaitForSingleObject(pi.hProcess, 5000);', '      WaitForSingleObject(pi.hProcess, 5000);', 'C'],
  lProcLimit: [PS, 'ext.BasicLimitInformation.ActiveProcessLimit = maxProcesses;', 'ext.BasicLimitInformation.ActiveProcessLimit = 1000;', 'C'],
  lMemLimit: [PS, 'ext.JobMemoryLimit = new UIntPtr((ulong)memoryBytes);', 'ext.JobMemoryLimit = new UIntPtr(8UL * 1024 * 1024 * 1024);', 'C'],
  lOutputCap: [PS, 'Collector co = new Collector(capBytes), ce = new Collector(capBytes);', 'Collector co = new Collector(65536), ce = new Collector(65536);', 'C'],
  lClock: [PS, 'long left = (long)timeoutMs - sw.ElapsedMilliseconds;', 'long left = (long)timeoutMs * 10 - sw.ElapsedMilliseconds;', 'C'],
  lNoUnmount: [PS, '[void][Box]::Unmount($mounted, $scratch); $mounted = $null', '$mounted = $null', 'C'],
  lNoParentWatch: [PS, 'IntPtr[] waitFor = parent != IntPtr.Zero ?', 'IntPtr[] waitFor = parent != IntPtr.Zero && timeoutMs < 0 ?', 'G'],
  lDisk: [PS, 'if (TreeBytes(scratch, diskBytes) > diskBytes) { r.DiskExceeded = true; break; }', 'if (TreeBytes(scratch, diskBytes) < 0) { r.DiskExceeded = true; break; }', 'C'],
  lDiskMax: [PS, '$MAX_DISK = 536870912;', '$MAX_DISK = 536870912000;', 'E'],
  lSuspended: [PS, 'uint flags = EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED | CREATE_NO_WINDOW', 'uint flags = EXTENDED_STARTUPINFO_PRESENT | CREATE_NO_WINDOW', 'B'],
  lUi: [PS, 'ui.UIRestrictionsClass = 0xFF;', 'ui.UIRestrictionsClass = 0;', 'B'],
  // (13.7: the process is made INSIDE the job by the job list attribute, and is checked to be in it before it is resumed)
  lNoJobList: [PS, JOB_LIST_CALL, '', 'I'],
  lNoInJobCheck: [PS, IN_JOB_IF, '      if (inJob) {', 'B'],
  lOutsideJob: [PS, JOB_LIST_CALL, '', 'I', [[IN_JOB_IF, '      if (inJob) {']]],
  // (13.7: one launcher at a time makes the container and takes a drive letter; without the gate runs that start together share a letter or fail)
  lNoGate: [PS, '  [Box]::Enter()\n', '', 'J'],
  lGateEarly: [PS, '    $mounted = [Box]::Mount($scratch)\n  } finally { [Box]::Leave() }', '  } finally { [Box]::Leave() }\n  $mounted = [Box]::Mount($scratch)', 'B'],
  // ----- the launcher: the environment -----
  lEnvLeak: [PS, "$envd['PATHEXT'] = '.COM;.EXE;.BAT;.CMD'", "$envd['PATHEXT'] = '.COM;.EXE;.BAT;.CMD'; $envd['FRONTIER_CANARY_KEY'] = $env:FRONTIER_CANARY_KEY", 'C'],
  lEnvAppdata: [PS, "$envd['PATHEXT'] = '.COM;.EXE;.BAT;.CMD'", "$envd['PATHEXT'] = '.COM;.EXE;.BAT;.CMD'; $envd['APPDATA'] = $root", 'C'],
  lPathOrder: [PS, "$envd['PATH'] = $tools + ';' + (Join-Path $env:SystemRoot 'System32') + ';' + $env:SystemRoot", "$envd['PATH'] = (Join-Path $env:SystemRoot 'System32') + ';' + $env:SystemRoot + ';' + $tools", 'C'],
  lBoxTemp: [PS, '  [void][System.IO.Directory]::CreateDirectory($boxTemp)', '', 'C'],
  // ----- the launcher: its own defence -----
  lVersion: [PS, "if ($spec.version -ne 1)", 'if ($false)', 'E'],
  lContainerName: [PS, "if ([string]$spec.container -notmatch '^FrontierApp\\.[A-Za-z0-9]{1,40}$') { throw 'the container name is not ours' }", '', 'E'],
  lOutside: [PS, "if (-not $p.StartsWith($runRoot + '\\', [System.StringComparison]::OrdinalIgnoreCase)) { throw 'a folder lies outside the run root' }", '', 'E'],
  lLink: [PS, "if (([System.IO.File]::GetAttributes($p) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'a folder is a link' }", '', 'E'],
  lOverlap: [PS, "if ($scratch.StartsWith($tools + '\\', [System.StringComparison]::OrdinalIgnoreCase) -or $tools.StartsWith($scratch + '\\', [System.StringComparison]::OrdinalIgnoreCase) -or $scratch -eq $tools) { throw 'the scratch and tools folders overlap' }", '', 'E'],
  lMaxProcesses: [PS, '$MAX_PROCESSES = 64;', '$MAX_PROCESSES = 1000;', 'E'],
  lResultPath: [PS, "if ($candidate -notmatch '^[A-Za-z]:\\\\[^\\\\]') { exit 2 }", '', 'E'],
  lQuote: [PS, "sb.Append('\\\\', bs * 2 + 1); sb.Append('\"'); bs = 0;", "sb.Append('\\\\', bs * 2); sb.Append('\"'); bs = 0;", 'D']
}

mkdirSync(join(TOOLS, 'specs132'), { recursive: true })
for (const [name, [file, from, to, only, more]] of Object.entries(controls)) {
  const probe = only === 'probe'
  const spec = {
    label: `n132-${name}`,
    edits: [{ file, from, to }, ...(more ?? []).map(([f, x]) => ({ file, from: f, to: x }))],
    argv: probe ? ['{{TOOLS}}/probe-13-1.mjs', '1'] : ['{{TOOLS}}/verify-13-2.mjs'],
    env: probe ? { PROBE_LAUNCHER: 'product' } : { ONLY: only },
    timeoutMs: probe ? 900000 : 600000
  }
  writeFileSync(join(TOOLS, 'specs132', `n132-${name}.json`), JSON.stringify(spec, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(controls).length} specs in specs132`)
