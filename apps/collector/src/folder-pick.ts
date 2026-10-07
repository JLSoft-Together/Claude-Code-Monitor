import { execFile } from 'node:child_process'
import type { FolderPickResult } from '@ccm/shared'

// Vista-style IFileOpenDialog in folder mode, owned by an invisible topmost form so it opens above the browser
// (a background process cannot take the foreground otherwise). The path goes out base64 UTF-8 so non-ASCII folder
// names survive the console code page.
const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace Ccm {
  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IShellItem {
    void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
    void GetParent(out IShellItem si);
    void GetDisplayName(uint sigdn, [MarshalAs(UnmanagedType.LPWStr)] out string name);
  }
  [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IFileDialog {
    [PreserveSig] int Show(IntPtr parent);
    void SetFileTypes(uint c, IntPtr f);
    void SetFileTypeIndex(uint i);
    void GetFileTypeIndex(out uint i);
    void Advise(IntPtr p, out uint c);
    void Unadvise(uint c);
    void SetOptions(uint fos);
    void GetOptions(out uint fos);
    void SetDefaultFolder(IShellItem si);
    void SetFolder(IShellItem si);
    void GetFolder(out IShellItem si);
    void GetCurrentSelection(out IShellItem si);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string n);
    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string n);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string t);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string t);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string t);
    void GetResult(out IShellItem si);
  }
  public static class Picker {
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

    public static void Raise(IntPtr h) {
      uint fg = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);
      uint me = GetCurrentThreadId();
      bool attached = fg != 0 && fg != me && AttachThreadInput(me, fg, true);
      SetForegroundWindow(h);
      if (attached) AttachThreadInput(me, fg, false);
      if (GetForegroundWindow() != h) {
        keybd_event(0x12, 0, 0, UIntPtr.Zero);
        keybd_event(0x12, 0, 2, UIntPtr.Zero);
        SetForegroundWindow(h);
      }
    }

    // null = cancelled
    public static string Pick(IntPtr owner) {
      var dlg = (IFileDialog)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")));
      dlg.SetOptions(0x20 | 0x40 | 0x8);
      int hr = dlg.Show(owner);
      if (hr == unchecked((int)0x800704C7)) return null;
      if (hr != 0) Marshal.ThrowExceptionForHR(hr);
      IShellItem item;
      dlg.GetResult(out item);
      string path;
      item.GetDisplayName(0x80058000, out path);
      return path;
    }
  }
}
'@
$form = New-Object System.Windows.Forms.Form
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.FormBorderStyle = 'None'
$form.StartPosition = 'CenterScreen'
$form.Size = New-Object System.Drawing.Size(1, 1)
$form.Opacity = 0
$form.Show()
[Ccm.Picker]::Raise($form.Handle)
try { $path = [Ccm.Picker]::Pick($form.Handle) } finally { $form.Close() }
if ($null -eq $path) { 'cancelled' } else { 'ok:' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($path)) }
`

export function parsePickOutput(stdout: string): { result: FolderPickResult; dir?: string } {
  const last = stdout.trim().split(/\r?\n/).at(-1)?.trim() ?? ''
  if (last === 'cancelled') return { result: 'cancelled' }
  if (!last.startsWith('ok:')) return { result: 'failed' }
  const dir = Buffer.from(last.slice(3), 'base64').toString('utf8')
  return dir ? { result: 'ok', dir } : { result: 'failed' }
}

export function pickFolder(): Promise<{ result: FolderPickResult; dir?: string }> {
  if (process.platform !== 'win32') return Promise.resolve({ result: 'unsupported' })
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT],
      // The dialog waits on the user; the cap only reaps a dialog left open and forgotten.
      { timeout: 10 * 60_000, windowsHide: true, maxBuffer: 64_000 },
      (err, stdout) => resolve(err ? { result: 'failed' } : parsePickOutput(stdout)),
    )
  })
}
