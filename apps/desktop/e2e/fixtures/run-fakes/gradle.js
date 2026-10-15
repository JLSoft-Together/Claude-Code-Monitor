// Fake gradlew for e2e/run-pane.cjs: `:app:assembleDebug` writes an APK + output-metadata.json like AGP does.
const fs = require('node:fs')
const path = require('node:path')

const STATE = path.join(__dirname, '..', 'state')
const args = process.argv.slice(2)
fs.appendFileSync(path.join(STATE, 'calls.log'), JSON.stringify({ tool: 'gradlew', argv: args, cwd: process.cwd(), javaHome: process.env.JAVA_HOME, androidHome: process.env.ANDROID_HOME }) + '\n')

const task = args.find((a) => /:assemble\w+$/.test(a))
if (!task) {
  process.stderr.write(`fake gradlew: unsupported ${args.join(' ')}\n`)
  process.exit(1)
}
const lines = ['> Task :app:preBuild UP-TO-DATE', '> Task :app:compileDebugKotlin', `> Task ${task}`]
let i = 0
const timer = setInterval(() => {
  if (i < lines.length) return void process.stdout.write(lines[i++] + '\n')
  clearInterval(timer)
  const dir = path.join(process.cwd(), 'app', 'build', 'outputs', 'apk', 'debug')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'app-debug.apk'), 'not really an apk')
  fs.writeFileSync(
    path.join(dir, 'output-metadata.json'),
    JSON.stringify({ version: 3, artifactType: { type: 'APK', kind: 'Directory' }, applicationId: 'com.example.demo', variantName: 'debug', elements: [{ type: 'SINGLE', outputFile: 'app-debug.apk' }] }),
  )
  process.stdout.write('\nBUILD SUCCESSFUL in 2s\n')
}, 300)
