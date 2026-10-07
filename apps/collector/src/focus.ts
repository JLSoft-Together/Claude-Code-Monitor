import { execFile } from 'node:child_process'
import type { FocusWindowResult } from '@ccm/shared'

// First asks the session's own console: ConPTY's hidden pseudo-console window is owned by the hosting terminal window
// (Windows Terminal sets it per tab), and a classic console window is the console itself, so this names the exact
// window even with several WT windows. Hosts without that link (VS Code, old WT) fall back to walking claude.exe →
// shell → host until a process owns a visible top-level window. Foreground-lock rules block SetForegroundWindow from a background process, so the script
// first joins the foreground thread's input queue and falls back to a bare Alt tap (it reaches the current
// foreground app, never the terminal). The pid comes in through the environment, never through the script text.
const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -Namespace Ccm -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int n);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
public delegate bool EnumProc(IntPtr h, IntPtr l);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
[DllImport("kernel32.dll")] public static extern bool FreeConsole();
[DllImport("kernel32.dll")] public static extern bool AttachConsole(uint pid);
[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
[DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
public static IntPtr ConsoleHost(uint pid) {
  FreeConsole();
  if (!AttachConsole(pid)) return IntPtr.Zero;
  IntPtr con = GetConsoleWindow();
  FreeConsole();
  if (con == IntPtr.Zero) return IntPtr.Zero;
  IntPtr root = GetAncestor(con, 3);
  if (root != IntPtr.Zero && root != con && IsWindowVisible(root)) return root;
  return IsWindowVisible(con) ? con : IntPtr.Zero;
}
public static int CountTop(uint pid) {
  int n = 0;
  EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid && IsWindowVisible(h) && GetWindow(h, 4) == IntPtr.Zero) n++; return true; }, IntPtr.Zero);
  return n;
}
'@
$id = [int]$env:CCM_FOCUS_PID
$h = [Ccm.Win]::ConsoleHost([uint32]$id)
for ($i = 0; $h -eq [IntPtr]::Zero -and $i -lt 8 -and $id -gt 4; $i++) {
  $p = Get-Process -Id $id -ErrorAction SilentlyContinue
  if (-not $p) { break }
  if ($p.MainWindowHandle -ne [IntPtr]::Zero) {
    # One WindowsTerminal process owns every WT window; with several, its main window is a guess.
    if ($p.ProcessName -eq 'WindowsTerminal' -and [Ccm.Win]::CountTop([uint32]$p.Id) -gt 1) { 'ambiguous'; exit }
    $h = $p.MainWindowHandle; break
  }
  $c = Get-CimInstance Win32_Process -Filter "ProcessId=$id"
  if (-not $c) { break }
  $id = [int]$c.ParentProcessId
}
if ($h -eq [IntPtr]::Zero) {
  # Default-terminal handoff starts the shell outside Windows Terminal's tree; one WT window is still unambiguous.
  $wt = @(Get-Process WindowsTerminal -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero })
  if ($wt.Count -eq 1 -and [Ccm.Win]::CountTop([uint32]$wt[0].Id) -eq 1) { $h = $wt[0].MainWindowHandle }
  elseif ($wt.Count -ge 1) { 'ambiguous'; exit }
}
if ($h -eq [IntPtr]::Zero) { 'notFound'; exit }
if ([Ccm.Win]::IsIconic($h)) { [void][Ccm.Win]::ShowWindowAsync($h, 9) }
$fg = [Ccm.Win]::GetForegroundWindow()
$fgThread = [Ccm.Win]::GetWindowThreadProcessId($fg, [IntPtr]::Zero)
$me = [Ccm.Win]::GetCurrentThreadId()
$attached = $fgThread -ne 0 -and $fgThread -ne $me -and [Ccm.Win]::AttachThreadInput($me, $fgThread, $true)
[void][Ccm.Win]::BringWindowToTop($h)
[void][Ccm.Win]::SetForegroundWindow($h)
if ($attached) { [void][Ccm.Win]::AttachThreadInput($me, $fgThread, $false) }
if ([Ccm.Win]::GetForegroundWindow() -ne $h) {
  [Ccm.Win]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
  [Ccm.Win]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
  [void][Ccm.Win]::SetForegroundWindow($h)
}
if ([Ccm.Win]::GetForegroundWindow() -eq $h) { 'ok' } else { 'failed' }
`

export function parseFocusOutput(stdout: string): FocusWindowResult {
  const last = stdout.trim().split(/\r?\n/).at(-1)?.trim()
  return last === 'ok' || last === 'notFound' || last === 'ambiguous' ? last : 'failed'
}

export function focusProcessWindow(pid: number): Promise<FocusWindowResult> {
  if (process.platform !== 'win32') return Promise.resolve('unsupported')
  if (!Number.isInteger(pid) || pid <= 4) return Promise.resolve('notFound')
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT],
      { timeout: 15_000, windowsHide: true, maxBuffer: 64_000, env: { ...process.env, CCM_FOCUS_PID: String(pid) } },
      (err, stdout) => resolve(err ? 'failed' : parseFocusOutput(stdout)),
    )
  })
}
