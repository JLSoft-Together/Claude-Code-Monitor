import { describe, expect, it } from 'vitest'
import { declarationQuery, outline } from './outline'

const names = (items: ReturnType<typeof outline>) => items?.map((i) => `${'  '.repeat(i.depth)}${i.kind}:${i.name}@${i.line}`)

describe('outline', () => {
  it('reads TypeScript classes, methods, functions and types', () => {
    const src = [
      'export interface Opts { a: number }',
      '/* function hidden() {',
      '*/',
      'export class Store {',
      '  private load(id: string): Promise<void> {',
      '    if (x) {',
      '  }',
      '}',
      'export async function run() {}',
      'const add = (a: number, b: number) => a + b',
    ].join('\n')
    expect(names(outline(src, 'typescript'))).toEqual(['type:Opts@1', 'class:Store@4', '  method:load@5', 'function:run@9', 'function:add@10'])
  })

  it('nests Python methods and reads Kotlin / Dart', () => {
    expect(names(outline('class A:\n    def go(self):\n        pass\ndef top():\n    pass', 'python'))).toEqual(['class:A@1', '  method:go@2', 'function:top@4'])
    expect(names(outline('data class User(val id: Int)\nobject Repo {\n    suspend fun load(id: Int): User = TODO()\n}', 'kotlin'))).toEqual([
      'class:User@1',
      'class:Repo@2',
      '  function:load@3',
    ])
    expect(names(outline('class Home extends StatelessWidget {\n  Widget build(BuildContext context) {\n  }\n}', 'dart'))).toEqual(['class:Home@1', '  method:build@2'])
  })

  it('reads markdown headings, top-level JSON / YAML keys and CSS selectors', () => {
    expect(names(outline('# Title\ntext\n## Part', 'markdown'))).toEqual(['heading:Title@1', '  heading:Part@3'])
    expect(names(outline('{\n  "name": "x",\n  "dev": { "a": 1,\n    "b": 2 }\n}', 'json'))).toEqual(['key:name@2', 'key:dev@3'])
    expect(names(outline('name: x\nscripts:\n  dev: y', 'yaml'))).toEqual(['key:name@1', 'key:scripts@2'])
    expect(names(outline('.a, .b {\n}\n@media (x) {\n  .c {\n}', 'css'))).toEqual(['selector:.a, .b@1', 'selector:@media (x)@3'])
    expect(outline('x', 'toml')).toBeNull()
  })

  it('builds a declaration search for a word', () => {
    const re = new RegExp(declarationQuery('load'))
    expect(re.test('  fun load(id: Int)')).toBe(true)
    expect(re.test('const load = 1')).toBe(true)
    expect(re.test('store.load()')).toBe(false)
  })
})
