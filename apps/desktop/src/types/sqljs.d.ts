// The part of sql.js 1.14 (no bundled types) that devices/appData.ts uses.
declare module 'sql.js' {
  export type SqlValue = number | string | Uint8Array | null
  export interface QueryExecResult {
    columns: string[]
    values: SqlValue[][]
  }
  export interface Statement {
    step(): boolean
    get(): SqlValue[]
    getColumnNames(): string[]
    free(): boolean
  }
  export interface Database {
    exec(sql: string): QueryExecResult[]
    prepare(sql: string): Statement
    close(): void
  }
  export interface SqlJsStatic {
    Database: new (data?: Uint8Array | null) => Database
  }
  export default function initSqlJs(config?: { wasmBinary?: ArrayBuffer | Uint8Array }): Promise<SqlJsStatic>
}
