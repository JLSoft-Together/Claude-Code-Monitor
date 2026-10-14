// A persistent TypeScript compiler follows the actual main/preload import graph.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const ENTRIES = ["main.ts", "preload.ts", "browser-preload.ts"];
const COMPILE_DELAY_MS = 60;

function commonJsExtension(context) {
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require" &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text.startsWith(".")
    ) {
      const target = node.arguments[0].text;
      if (!/\.(cjs|json|node)$/.test(target)) {
        return context.factory.updateCallExpression(node, node.expression, node.typeArguments, [
          context.factory.createStringLiteral(target.replace(/\.js$/, "") + ".cjs"),
        ]);
      }
    }
    return ts.visitEachChild(node, visit, context);
  };
  return (source) => ts.visitNode(source, visit);
}

export function watchMain({
  root,
  onBuild,
  onInvalidated = () => {},
  onDiagnostic = console.error,
  onError = (error) => {
    throw error;
  },
}) {
  const configFile = path.join(root, "tsconfig.electron.json");
  const output = path.join(root, "dist-electron", "dev");
  const formatHost = {
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: () => root,
    getNewLine: () => "\n",
  };
  let program;
  let closed = false;
  let started = performance.now();
  let initial = true;
  let invalidated = false;
  let lastResult;
  const invalidate = () => {
    invalidated = true;
    onInvalidated();
  };
  const publish = (result) => {
    invalidated = false;
    lastResult = result;
    onBuild(result);
  };
  const report = (diagnostic) => onDiagnostic(ts.formatDiagnostic(diagnostic, formatHost));

  function compile(builder) {
    const diagnostics = [
      ...builder.getOptionsDiagnostics(),
      ...builder.getGlobalDiagnostics(),
      ...builder.getSyntacticDiagnostics(),
      ...builder.getSemanticDiagnostics(),
    ];
    diagnostics.forEach(report);
    if (diagnostics.some((item) => item.category === ts.DiagnosticCategory.Error)) {
      publish({ ok: false, changed: false, durationMs: performance.now() - started });
      return;
    }
    // Diagnostics were checked above. Avoid TypeScript checking the whole
    // program again during emit; failed builds never reach this point.
    const files = new Map();
    const result = builder.emit(
      undefined,
      (name, text) => files.set(name, text),
      undefined,
      false,
      {
        after: [commonJsExtension],
      },
    );
    result.diagnostics.forEach(report);
    if (
      result.emitSkipped ||
      result.diagnostics.some((item) => item.category === ts.DiagnosticCategory.Error)
    ) {
      publish({ ok: false, changed: false, durationMs: performance.now() - started });
      return;
    }
    let changed = initial;
    for (const [name, text] of files) {
      const destination = name.replace(/\.js(?=($|\.map$))/, ".cjs");
      const content = name.endsWith(".js.map")
        ? JSON.stringify({ ...JSON.parse(text), file: path.basename(destination, ".map") })
        : text.replace(/(\/\/# sourceMappingURL=.*)\.js\.map$/m, "$1.cjs.map");
      if (existsSync(destination) && readFileSync(destination, "utf8") === content) continue;
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, content);
      if (!destination.endsWith(".map")) changed = true;
    }
    if (initial) {
      const vendor = path.join(root, "electron", "vendor");
      if (existsSync(vendor))
        cpSync(vendor, path.join(output, "electron", "vendor"), { recursive: true });
    }
    initial = false;
    publish({ ok: true, changed, durationMs: performance.now() - started });
  }

  function start() {
    program?.close();
    started = performance.now();
    invalidate();
    const config = ts.readConfigFile(configFile, ts.sys.readFile);
    if (config.error) {
      report(config.error);
      publish({ ok: false, changed: false, durationMs: performance.now() - started });
      return;
    }
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
    if (parsed.errors.length) {
      parsed.errors.forEach(report);
      publish({ ok: false, changed: false, durationMs: performance.now() - started });
      return;
    }
    const host = ts.createWatchCompilerHost(
      ENTRIES.map((entry) => path.join(root, "electron", entry)),
      { ...parsed.options, outDir: output, noEmit: false, noEmitOnError: false },
      ts.sys,
      ts.createEmitAndSemanticDiagnosticsBuilderProgram,
      report,
      () => {},
      undefined,
      {
        watchFile: ts.WatchFileKind.UseFsEvents,
        watchDirectory: ts.WatchDirectoryKind.UseFsEvents,
      },
    );
    const watchFile = host.watchFile;
    host.watchFile = (file, callback, ...args) =>
      watchFile(
        file,
        (...event) => {
          started = performance.now();
          invalidate();
          callback(...event);
        },
        ...args,
      );
    host.setTimeout = (callback, _delay, ...args) =>
      setTimeout(() => {
        if (closed) return;
        try {
          callback(...args);
          // Same-content saves can skip afterProgramCreate. Finish synchronization
          // before restoring readiness, including pending module-resolution changes.
          if (invalidated) {
            program?.getProgram();
            if (invalidated && lastResult)
              publish({ ...lastResult, changed: false, durationMs: performance.now() - started });
          }
        } catch (error) {
          onError(error);
        }
      }, COMPILE_DELAY_MS);
    host.afterProgramCreate = compile;
    program = ts.createWatchProgram(host);
  }

  const configWatch = ts.sys.watchFile(configFile, () => {
    if (!closed) {
      try {
        start();
      } catch (error) {
        onError(error);
      }
    }
  });
  try {
    start();
  } catch (error) {
    configWatch.close();
    program?.close();
    throw error;
  }
  return {
    close() {
      closed = true;
      configWatch.close();
      program?.close();
    },
  };
}
