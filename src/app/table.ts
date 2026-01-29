import type { Handler } from "@ghom/handler"
import { CachedQuery } from "@ghom/query"
import type { Knex } from "knex"
import { buildColumnsSchema, type ColumnDef, col, type InferColumns } from "./column.js"
import type { ORM, ORMConfig } from "./orm.js"
import { styled } from "./util.js"

type ConnectedORM = ORM & {
  config: ORMConfig
  client: Knex
  handler: Handler<Table<any>>
  _rawCache: CachedQuery<[raw: string], Knex.Raw>
}

export interface MigrationData {
  table: string
  version: number
}

/**
 * Table options with typed columns.
 * Type is automatically inferred from the column definitions.
 */
export interface TableOptions<Columns extends Record<string, ColumnDef<any, any>>> {
  name: string
  description?: string
  priority?: number
  /**
   * The cache time in milliseconds. <br>
   * Default is `Infinity`.
   */
  caching?: number
  migrations?: { [version: number]: (builder: Knex.CreateTableBuilder) => void }
  then?: (this: Table<Columns>, table: Table<Columns>) => unknown
  /**
   * Typed columns definition with automatic type inference.
   *
   * @example
   * columns: (col) => ({
   *   id: col.increments(),
   *   username: col.string().unique(),
   *   age: col.integer().nullable(),
   *   role: col.enum(["admin", "user"]),
   * })
   */
  columns: (col: typeof import("./column.js").col) => Columns
}

/**
 * Represents a database table with typed columns.
 *
 * @example
 * const userTable = new Table({
 *   name: "user",
 *   columns: (col) => ({
 *     id: col.increments(),
 *     username: col.string().unique(),
 *     age: col.integer().nullable(),
 *   }),
 * })
 * // Type is automatically inferred as { id: number; username: string; age: number | null }
 */
export class Table<
  Columns extends Record<string, ColumnDef<any, any>> = Record<string, ColumnDef<any, any>>,
> {
  public orm?: ORM

  public _whereCache?: CachedQuery<[cb: (query: Table<Columns>["query"]) => unknown], unknown>

  public _countCache?: CachedQuery<[where: string | null], number>

  constructor(public readonly options: TableOptions<Columns>) {}

  /** The inferred TypeScript type for rows of this table */
  declare readonly $type: InferColumns<Columns>

  private requireOrm(): asserts this is Table<Columns> & { orm: ConnectedORM } {
    if (!this.orm) throw new Error("missing ORM")
    if (!this.orm._client) throw new Error("ORM client is not initialized")
  }

  get client(): Knex {
    this.requireOrm()
    return this.orm.client
  }

  get query() {
    return this.client<InferColumns<Columns>>(this.options.name)
  }

  get cache() {
    if (!this._whereCache || !this._countCache) throw new Error("missing cache")
    this.requireOrm()

    return {
      get: <Return>(
        id: string,
        cb: (
          table: Pick<
            Table<Columns>["query"],
            "select" | "count" | "avg" | "sum" | "countDistinct" | "avgDistinct" | "sumDistinct"
          >,
        ) => Return,
      ): Return => {
        return this._whereCache!.get(id, cb) as Return
      },
      set: <Return>(
        cb: (
          table: Pick<
            Table<Columns>["query"],
            "update" | "delete" | "insert" | "upsert" | "truncate" | "jsonInsert"
          >,
        ) => Return,
      ) => {
        // todo: invalidate only the related tables
        this.orm.cache.invalidate()
        return cb(this.query)
      },
      count: (where?: string) => {
        return this._countCache!.get(where ?? "*", where ?? null)
      },
      invalidate: () => {
        this._whereCache!.invalidate()
        this._countCache!.invalidate()
        this.orm._rawCache.invalidate()
      },
    }
  }

  async count(where?: string): Promise<number> {
    return this.query
      .select(this.client.raw("count(*) as total"))
      .whereRaw(where ?? "1=1")
      .then((rows) => +((rows?.[0] ?? { total: 0 }) as unknown as { total: number }).total)
  }

  async hasColumn(name: keyof InferColumns<Columns> & string): Promise<boolean> {
    return this.client.schema.hasColumn(this.options.name, name as string)
  }

  async getColumn(name: keyof InferColumns<Columns> & string): Promise<Knex.ColumnInfo> {
    return this.client(this.options.name).columnInfo(name)
  }

  async getColumns(): Promise<Record<keyof InferColumns<Columns> & string, Knex.ColumnInfo>> {
    return this.client(this.options.name).columnInfo()
  }

  async getColumnNames(): Promise<Array<keyof InferColumns<Columns> & string>> {
    return this.getColumns().then(Object.keys) as Promise<
      Array<keyof InferColumns<Columns> & string>
    >
  }

  async isEmpty(): Promise<boolean> {
    return this.count().then((count) => count === 0)
  }

  async make(orm: ORM): Promise<this> {
    this.orm = orm
    this.requireOrm()

    this._whereCache = new CachedQuery(
      (cb: (query: Knex.QueryBuilder<InferColumns<Columns>>) => unknown) => cb(this.query),
      this.options.caching ?? this.orm.config.caching ?? Infinity,
    )

    this._countCache = new CachedQuery(
      (where: string | null) => this.count(where ?? undefined),
      this.options.caching ?? this.orm.config.caching ?? Infinity,
    )

    const tableNameLog = `table ${styled(this.orm, this.options.name, "highlight")}${
      this.options.description
        ? ` ${styled(this.orm, this.options.description, "description")}`
        : ""
    }`

    try {
      await this.client.schema.createTable(this.options.name, (builder) => {
        const columns = this.options.columns(col)
        buildColumnsSchema(builder, columns)
      })

      this.orm.config.logger?.log(`created table ${tableNameLog}`)
    } catch (error: any) {
      if (error.toString().includes("syntax error")) {
        this.orm.config.logger?.error(
          `you need to implement the "columns" callback in options of your ${styled(this.orm, this.options.name, "highlight")} table!`,
        )

        throw error
      } else {
        this.orm.config.logger?.log(`loaded table ${tableNameLog}`)
      }
    }

    try {
      const migrated = await this.migrate()

      if (migrated !== false) {
        this.orm.config.logger?.log(
          `migrated table ${styled(this.orm, this.options.name, "highlight")} to version ${styled(this.orm, migrated, "rawValue")}`,
        )
      }
    } catch (error: any) {
      this.orm.config.logger?.error(error)

      throw error
    }

    if ((await this.count()) === 0) {
      const thenFn = this.options.then as
        | ((this: Table<Columns>, table: Table<Columns>) => unknown)
        | undefined
      await thenFn?.bind(this)(this)
    }

    return this
  }

  private async migrate(): Promise<false | number> {
    if (!this.options.migrations) return false

    const migrations = new Map<number, (table: Knex.CreateTableBuilder) => void>(
      Object.entries(this.options.migrations)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map((entry) => [Number(entry[0]), entry[1]]),
    )

    const fromDatabase = await this.client<MigrationData>("migration")
      .where("table", this.options.name)
      .first()

    const data = fromDatabase || {
      table: this.options.name,
      version: -Infinity,
    }

    const baseVersion = data.version

    for (const [version, migration] of migrations) {
      await this.client.schema.alterTable(this.options.name, (builder) => {
        if (version <= data.version) return
        migration(builder)
        data.version = version
      })
    }

    await this.client<MigrationData>("migration").insert(data).onConflict("table").merge()

    return baseVersion === data.version ? false : data.version
  }
}
