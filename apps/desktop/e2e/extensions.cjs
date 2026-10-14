// v28: Extensions tab. Read-only against the real Claude Code config: status loads, sheets open and validate.
// Nothing is installed — no install / remove / sign-in button is pressed, so no native confirm ever shows.
const fs = require('node:fs')
const path = require('node:path')
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

async function main() {
  const app = await launch({ exe: process.argv[2] })
  const { evaluate, waitFor, shot, sleep } = app
  const click = (sel) => evaluate(`document.querySelector(${JSON.stringify(sel)}).click()`)
  try {
    await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
    await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.theme','light'); localStorage.removeItem('ccm.ext')`)
    await app.cmd('Page.reload')
    await sleep(1500)
    await waitFor(`!!${S}.get('ui')`, 20000, 'reloaded')

    check('Extensions tab in the header', await evaluate(`[...document.querySelectorAll('[role="tab"]')].some(t => /Extensions|Mở rộng/.test(t.textContent))`))
    await evaluate(`${S}.get('ui').setView('extensions')`)
    await waitFor(`!!document.querySelector('[data-extensions]')`, 15000, 'view')
    await waitFor(`!${S}.get('extensions').loading`, 60000, 'status')
    const cards = await evaluate(`[...document.querySelectorAll('[data-ext-card]')].map(c => c.dataset.extCard).join(',')`)
    check('catalog cards render', ['figma', 'meshy', 'unity', 'blender', 'godot', 'godot-editor', 'godot-funplay', 'github', 'gitlab', 'discord', 'pm-skills', 'ui-ux-pro-max', 'frontend-design'].every((id) => cards.includes(id)), cards)
    check('CLI found', await evaluate(`${S}.get('extensions').status?.cli === true`))
    await shot('ext-01-loading')
    await waitFor(`!${S}.get('extensions').mcpLoading`, 120000, 'mcp list')
    const states = await evaluate(`[...document.querySelectorAll('[data-ext-card]')].map(c => c.dataset.extCard + ':' + c.querySelector('[data-ext-state]')?.dataset.extState).join(' ')`)
    check('MCP status settles', !/checking/.test(states), states)
    check('no horizontal scroll', await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`))
    await shot('ext-02-status')
    await evaluate(`document.querySelector('#ext-plugins').scrollIntoView()`)
    await sleep(300)
    await shot('ext-02b-plugins-other')
    await evaluate(`window.scrollTo(0, 0)`)

    // Install sheet: secret field validates, scope defaults to user in the global view.
    await click('[data-ext-card="github"] [data-ext-action="open"]')
    await waitFor(`!!document.querySelector('[data-ext-sheet]')`, 5000, 'sheet')
    check('global view offers only the user scope', await evaluate(`[...document.querySelectorAll('[data-ext-scope]')].map(i => i.value).join() === 'user'`))
    check('focus starts in the token field', await evaluate(`document.activeElement?.id === 'ext-f-GITHUB_PAT'`))
    check('token input is a password field', await evaluate(`document.querySelector('#ext-f-GITHUB_PAT').type === 'password'`))
    await click('[data-ext-submit]')
    await sleep(200)
    check('empty token blocks install', await evaluate(`document.querySelector('#ext-f-GITHUB_PAT').getAttribute('aria-invalid') === 'true' && !!document.querySelector('[data-ext-sheet]')`))
    await shot('ext-03-install-sheet')
    await evaluate(`document.querySelector('[data-ext-sheet]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await sleep(400)
    check('Esc closes the sheet', await evaluate(`!document.querySelector('[data-ext-sheet]')`))

    // Plugin group: checklist of the nine pm-skills plugins.
    await click('[data-ext-card="pm-skills"] [data-ext-action="open"]')
    await waitFor(`!!document.querySelector('[data-ext-sheet]')`, 5000, 'pm sheet')
    check('pm-skills lists its plugins', (await evaluate(`document.querySelectorAll('[data-ext-plugin]').length`)) === 9)
    await shot('ext-04-pm-skills')
    await evaluate(`document.querySelector('[data-ext-sheet]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await sleep(300)

    // Project view: the three scopes, local by default for a secret.
    await evaluate(`(() => { const s = ${S}.get('extensions'); s.project = ${JSON.stringify(path.resolve(__dirname, '../../..'))}; s.mode = 'project' })()`)
    await waitFor(`!${S}.get('extensions').loading`, 60000, 'project status')
    await click('[data-ext-card="meshy"] [data-ext-action="open"]')
    await waitFor(`!!document.querySelector('[data-ext-sheet]')`, 5000, 'meshy sheet')
    check('project view offers user/project/local', await evaluate(`[...document.querySelectorAll('[data-ext-scope]')].map(i => i.value).join() === 'user,project,local'`))
    check('secret defaults to local', await evaluate(`document.querySelector('[data-ext-scope="local"]').checked`))
    await shot('ext-05-project-sheet')
    await evaluate(`document.querySelector('[data-ext-sheet]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await sleep(300)

    // Add source sheet: repo validation, nothing added.
    await click('[data-ext-add-source]')
    await waitFor(`!!document.querySelector('[data-ext-source]')`, 5000, 'source sheet')
    await evaluate(`(() => { const i = document.querySelector('#ext-src-repo'); i.value = 'not a repo'; i.dispatchEvent(new Event('input')) })()`)
    await click('[data-ext-add-market]')
    await sleep(200)
    check('bad repo is flagged', await evaluate(`document.querySelector('#ext-src-repo').getAttribute('aria-invalid') === 'true'`))
    await shot('ext-06-add-source')
    await evaluate(`document.querySelector('[data-ext-source]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)

    await evaluate(`localStorage.setItem('ccm.theme','dark'); ${S}.get('settings').theme = 'dark'`)
    await sleep(400)
    await shot('ext-07-dark')
  } catch (e) {
    check('script error', false, String(e?.stack ?? e))
  } finally {
    app.stop()
    fs.writeFileSync(path.join(OUT, 'extensions-results.txt'), results.join('\n'))
    process.exitCode = results.some((r) => r.startsWith('FAIL')) ? 1 : 0
  }
}
main()
