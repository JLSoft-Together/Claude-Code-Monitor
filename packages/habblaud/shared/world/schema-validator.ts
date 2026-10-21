// Validador mínimo de JSON Schema, para os testes conferirem pacotes contra shared/world/schema.json (o Habblaud não tem
// dependências de runtime nem o Ajv; o servidor do mundo valida o mesmo arquivo com o Ajv). Só as palavras-chave que o
// schema.json usa: qualquer outra derruba quem chamou, para nenhuma regra ser ignorada em silêncio. Usado só por testes.

export type Schema = boolean | { [k: string]: unknown };
export interface SchemaError { keyword: string; path: string }

const ANNOTATIONS = new Set(['$schema', '$id', 'title', 'description', '$defs']);
const KEYWORDS = new Set([
  '$ref', 'type', 'const', 'enum', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'maxItems',
  'pattern', 'minLength', 'maxLength', 'minimum', 'maximum', 'if', 'then', 'else',
]);

function typeOk(type: string, v: unknown): boolean {
  switch (type) {
    case 'object':
      return !!v && typeof v === 'object' && !Array.isArray(v);
    case 'array':
      return Array.isArray(v);
    case 'string':
      return typeof v === 'string';
    case 'integer':
      return Number.isInteger(v);
    case 'number':
      return typeof v === 'number' && Number.isFinite(v);
    case 'boolean':
      return typeof v === 'boolean';
    case 'null':
      return v === null;
    default:
      throw new Error(`tipo não suportado: ${type}`);
  }
}

export function compileValidator(root: { [k: string]: unknown }): (data: unknown) => SchemaError[] {
  const resolve = (ref: string): Schema => {
    const m = /^#\/\$defs\/([\w-]+)$/.exec(ref);
    const defs = root.$defs as Record<string, Schema> | undefined;
    if (!m || !defs || !(m[1] in defs)) throw new Error(`$ref não suportado: ${ref}`);
    return defs[m[1]];
  };
  const check = (schema: Schema, v: unknown, path: string, out: SchemaError[]): void => {
    if (schema === true) return;
    if (schema === false) return void out.push({ keyword: 'false schema', path });
    for (const k of Object.keys(schema)) {
      if (!KEYWORDS.has(k) && !ANNOTATIONS.has(k)) throw new Error(`palavra-chave não suportada: ${k} (${path || '/'})`);
    }
    const s = schema as Record<string, unknown>;
    const fail = (keyword: string, at = path): void => void out.push({ keyword, path: at });
    if (s.$ref !== undefined) check(resolve(s.$ref as string), v, path, out);
    if (s.type !== undefined && !typeOk(s.type as string, v)) return fail('type');
    if ('const' in s && v !== s.const) fail('const');
    if (s.enum !== undefined && !(s.enum as unknown[]).includes(v)) fail('enum');
    if (typeof v === 'string') {
      const len = [...v].length;
      if (s.minLength !== undefined && len < (s.minLength as number)) fail('minLength');
      if (s.maxLength !== undefined && len > (s.maxLength as number)) fail('maxLength');
      if (s.pattern !== undefined && !new RegExp(s.pattern as string, 'u').test(v)) fail('pattern');
    }
    if (typeof v === 'number') {
      if (s.minimum !== undefined && v < (s.minimum as number)) fail('minimum');
      if (s.maximum !== undefined && v > (s.maximum as number)) fail('maximum');
    }
    if (Array.isArray(v)) {
      if (s.minItems !== undefined && v.length < (s.minItems as number)) fail('minItems');
      if (s.maxItems !== undefined && v.length > (s.maxItems as number)) fail('maxItems');
      if (s.items !== undefined) v.forEach((item, i) => check(s.items as Schema, item, `${path}/${i}`, out));
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const obj = v as Record<string, unknown>;
      const props = (s.properties ?? {}) as Record<string, Schema>;
      for (const r of (s.required ?? []) as string[]) if (!(r in obj)) fail('required');
      for (const [k, val] of Object.entries(obj)) {
        if (k in props) check(props[k], val, `${path}/${k}`, out);
        else if (s.additionalProperties === false) fail('additionalProperties');
        else if (s.additionalProperties !== undefined) check(s.additionalProperties as Schema, val, `${path}/${k}`, out);
      }
    }
    if (s.if !== undefined) {
      const branch = validates(s.if as Schema, v) ? s.then : s.else;
      if (branch !== undefined) {
        const before = out.length;
        check(branch as Schema, v, path, out);
        if (out.length > before) fail('if');
      }
    }
  };
  const validates = (schema: Schema, v: unknown): boolean => {
    const out: SchemaError[] = [];
    check(schema, v, '', out);
    return out.length === 0;
  };
  return (data) => {
    const out: SchemaError[] = [];
    check(root, data, '', out);
    return out;
  };
}

/**
 * Caminho de cada chave que o esquema permite, seguindo `$ref`, `items` e os ramos `then`/`else`: "v", "floors",
 * "floors[].agents[].parts.skin"... É a lista fechada do pacote, tirada do próprio schema.json.
 */
export function schemaKeyPaths(root: { [k: string]: unknown }): Set<string> {
  const out = new Set<string>();
  const defs = (root.$defs ?? {}) as Record<string, Schema>;
  const walk = (schema: Schema, path: string): void => {
    if (typeof schema !== 'object') return;
    const ref = schema.$ref;
    if (typeof ref === 'string') walk(defs[ref.replace('#/$defs/', '')] ?? false, path);
    const props = schema.properties as Record<string, Schema> | undefined;
    for (const [k, child] of Object.entries(props ?? {})) {
      const p = path ? `${path}.${k}` : k;
      out.add(p);
      walk(child, p);
    }
    if (schema.items !== undefined) walk(schema.items as Schema, `${path}[]`);
    for (const branch of ['then', 'else'] as const) if (schema[branch] !== undefined) walk(schema[branch] as Schema, path);
  };
  walk(root, '');
  return out;
}

/** Caminho de cada chave de um JSON, no mesmo formato de schemaKeyPaths. */
export function jsonKeyPaths(value: unknown, path = '', out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) jsonKeyPaths(item, `${path}[]`, out);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const p = path ? `${path}.${k}` : k;
      out.add(p);
      jsonKeyPaths(v, p, out);
    }
  }
  return out;
}
