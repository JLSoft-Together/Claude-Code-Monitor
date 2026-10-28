import { describe, expect, it } from 'vitest'
import { buildRequest, envNames, envVars, isHttpFile, isSecretName, MASK, parseEnvFile, parseHttpFile, prettyJson, requestAt, resolve, statusTone } from './httpFile'

const FILE = `@host = http://localhost:8080
@token = abc123

### List users
GET {{host}}/users?limit=10 HTTP/1.1
Accept: application/json
# a comment header line
Authorization: Bearer {{token}}

###
# @name create
POST {{host}}/users
Content-Type: application/json

{
  "name": "Tess"
}

> {% client.test("ok", () => {}) %}

### Bare URL
https://example.com/health
    ?verbose=1
    &x=2

### Not a request
just some notes
`

describe('parseHttpFile', () => {
  const f = parseHttpFile(FILE)
  it('reads file variables and every request block', () => {
    expect(f.vars).toEqual({ host: 'http://localhost:8080', token: 'abc123' })
    expect(f.requests.map((r) => [r.name, r.method, r.url, r.line])).toEqual([
      ['List users', 'GET', '{{host}}/users?limit=10', 5],
      ['create', 'POST', '{{host}}/users', 12],
      ['Bare URL', 'GET', 'https://example.com/health?verbose=1&x=2', 22],
    ])
  })
  it('reads headers (skipping comments) and the body without the response handler', () => {
    expect(f.requests[0]!.headers).toEqual([
      ['Accept', 'application/json'],
      ['Authorization', 'Bearer {{token}}'],
    ])
    expect(f.requests[0]!.body).toBe('')
    expect(f.requests[1]!.headers).toEqual([['Content-Type', 'application/json']])
    expect(f.requests[1]!.body).toBe('{\n  "name": "Tess"\n}')
  })
  it('finds the request under a line', () => {
    expect(requestAt(f, 6)?.name).toBe('List users')
    expect(requestAt(f, 16)?.name).toBe('create')
    expect(requestAt(f, 1)).toBeNull()
  })
  it('handles CRLF and a file without separators', () => {
    const one = parseHttpFile('DELETE http://a/x\r\nX-A: 1\r\n\r\nbody\r\n')
    expect(one.requests).toHaveLength(1)
    expect(one.requests[0]).toMatchObject({ method: 'DELETE', url: 'http://a/x', headers: [['X-A', '1']], body: 'body', name: null })
  })
})

describe('environments', () => {
  const pub = parseEnvFile('{"$shared":{"v":"1"},"dev":{"host":"http://localhost","apiKey":"pub"},"prod":{"host":"https://api.x.dev","n":5}}')
  const priv = parseEnvFile('{"dev":{"apiKey":"real-key"}}')
  it('merges $shared, the env and the private file', () => {
    expect(envVars(pub, priv, 'dev')).toEqual({ v: '1', host: 'http://localhost', apiKey: 'real-key' })
    expect(envVars(pub, null, 'prod')).toEqual({ v: '1', host: 'https://api.x.dev', n: '5' })
    expect(envVars(pub, priv, null)).toEqual({ v: '1' })
    expect(envNames(pub, priv)).toEqual(['dev', 'prod'])
  })
  it('refuses non-object env files', () => {
    expect(parseEnvFile('[1]')).toBeNull()
    expect(parseEnvFile('{bad')).toBeNull()
  })
})

describe('resolve / buildRequest', () => {
  it('fills nested variables, lists missing ones and masks secrets in the shown text', () => {
    const vars = { base: '{{host}}/v1', host: 'http://h', apiToken: 's3cr3t' }
    expect(resolve('{{base}}/x?t={{apiToken}}&m={{nope}}', vars)).toEqual({ text: 'http://h/v1/x?t=s3cr3t&m={{nope}}', shown: `http://h/v1/x?t=${MASK}&m={{nope}}`, missing: ['nope'] })
    expect(resolve('{{a}}', { a: '{{a}}' }).text).toBe('{{a}}')
  })
  it('builds the request with file variables over env, sending real secret values', () => {
    const f = parseHttpFile(FILE)
    const b = buildRequest(f.requests[0]!, f.vars, { host: 'http://ignored', token: 'env' })
    expect(b.url).toBe('http://localhost:8080/users?limit=10')
    expect(b.headers[1]).toEqual(['Authorization', 'Bearer abc123'])
    expect(b.shown.headers[1]).toEqual(['Authorization', `Bearer ${MASK}`])
    expect(b.missing).toEqual([])
  })
  it('draws a dynamic value once per request', () => {
    const b = buildRequest({ name: null, line: 1, startLine: 1, endLine: 1, method: 'POST', url: 'http://a/{{$uuid}}', headers: [['X-Id', '{{$uuid}}']], body: '' }, {}, {})
    expect(b.url.slice('http://a/'.length)).toBe(b.headers[0]![1])
    expect(b.shown.url).toBe(b.url)
  })
  it('names secret-like variables', () => {
    expect(['token', 'apiKey', 'CLIENT_SECRET', 'password', 'authHeader', 'passwd'].every(isSecretName)).toBe(true)
    expect(['host', 'userId', 'name'].some(isSecretName)).toBe(false)
  })
})

describe('helpers', () => {
  it('detects .http / .rest files', () => {
    expect(isHttpFile('a/api.http')).toBe(true)
    expect(isHttpFile('a/API.REST')).toBe(true)
    expect(isHttpFile('a/http.ts')).toBe(false)
  })
  it('pretty prints JSON bodies only', () => {
    expect(prettyJson('{"a":[1]}', 'application/json')).toBe('{\n  "a": [\n    1\n  ]\n}')
    expect(prettyJson('[1]', undefined)).toBe('[\n  1\n]')
    expect(prettyJson('<html>', 'text/html')).toBeNull()
    expect(prettyJson('{bad', 'application/json')).toBeNull()
  })
  it('maps status to a tone', () => {
    expect([200, 204, 301, 404, 500].map(statusTone)).toEqual(['success', 'success', 'redirect', 'warning', 'error'])
  })
})
