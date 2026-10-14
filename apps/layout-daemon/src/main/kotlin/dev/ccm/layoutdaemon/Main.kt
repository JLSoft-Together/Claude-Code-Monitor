package dev.ccm.layoutdaemon

import java.io.File
import java.io.FileDescriptor
import java.io.FileOutputStream
import java.io.PrintStream
import kotlin.system.exitProcess

fun main(args: Array<String>) {
    // Claim stdout for the protocol before anything (layoutlib, Paparazzi) can print to it.
    val protocolOut = FileOutputStream(FileDescriptor.out)
    System.setOut(PrintStream(LineLogStream("info"), true, Charsets.UTF_8))
    LogCapture.install()

    val dirArg = args.indexOf("--layoutlib").takeIf { it >= 0 }?.let { args.getOrNull(it + 1) }
    if (dirArg == null) {
        System.err.println("usage: java -cp layout-daemon.jar${File.pathSeparator}<dir>/layoutlib-<ver>.jar dev.ccm.layoutdaemon.MainKt --layoutlib <dir>")
        exitProcess(2)
    }

    val lock = Any()
    lateinit var server: RpcServer
    server = RpcServer(
        renderer = LayoutRenderer(File(dirArg).absoluteFile),
        send = { msg ->
            val json = server.encode(msg)
            synchronized(lock) { Framing.write(protocolOut, json) }
        },
        onExit = {
            synchronized(lock) { protocolOut.flush() }
            Runtime.getRuntime().halt(0)
        },
    )
    server.serve(System.`in`)
}
