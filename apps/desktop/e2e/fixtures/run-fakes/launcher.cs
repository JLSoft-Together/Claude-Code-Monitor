// Windows only: adb / java must be real .exe files (the app spawns them without a shell). Copied as adb.exe / java.exe;
// runs node on TOOLS\<own name>.js with the same arguments. NODE and TOOLS are substituted by e2e/run-pane.cjs.
using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;

class Launcher {
  static string Quote(string s) { return "\"" + s.Replace("\"", "\\\"") + "\""; }

  static int Main(string[] argv) {
    string self = System.Reflection.Assembly.GetEntryAssembly().Location;
    string script = Path.Combine(TOOLS, Path.GetFileNameWithoutExtension(self) + ".js");
    var line = new StringBuilder(Quote(script));
    foreach (var a in argv) line.Append(' ').Append(Quote(a));
    var psi = new ProcessStartInfo(NODE, line.ToString());
    psi.UseShellExecute = false;
    psi.CreateNoWindow = true;
    psi.RedirectStandardOutput = true;
    psi.RedirectStandardError = true;
    var p = Process.Start(psi);
    var o = new Thread(() => Pump(p.StandardOutput.BaseStream, Console.OpenStandardOutput()));
    var e = new Thread(() => Pump(p.StandardError.BaseStream, Console.OpenStandardError()));
    o.Start();
    e.Start();
    p.WaitForExit();
    o.Join();
    e.Join();
    return p.ExitCode;
  }

  static void Pump(Stream from, Stream to) {
    var buf = new byte[8192];
    int n;
    try {
      while ((n = from.Read(buf, 0, buf.Length)) > 0) {
        to.Write(buf, 0, n);
        to.Flush();
      }
    } catch (IOException) {
    }
  }

  const string NODE = @"__NODE__";
  const string TOOLS = @"__TOOLS__";
}
