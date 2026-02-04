import type { Handler } from "@ghom/handler"
import { CachedQuery } from "@ghom/query"
import type { Knex } from "knex"
import { buildColumnsSchema, type ColumnDef, col, type InferColumns } from "./column.js"
import type { FinalTableType, TypedMigration, TypedMigrationSequence } from "./migration.js"
import type { ORM, ORMConfig } from "./orm.js"
import { styled } from "./util.js"

/**
 * A migration value is a TypedMigration or TypedMigrationSequence.
 * Use migrate.sequence() to combine multiple migrations.
 */
export type MigrationValue = TypedMigration<any, any> | TypedMigrationSequence<any>

type ConnectedORM = ORM & {
  config: ORMConfig
  client: Knex
  handler: Handler<Table<any>>
  _rawCache: CachedQuery<[raw: string], Knex.Raw>
}

export interface MigrationData {
  table: string
  version: string
}

/**
 * Table options with typed columns and optional typed migrations.
 * Type is automatically inferred from the column definitions and migrations.
 *
 * @template Columns - Record of column definitions
 * @template Migrations - Record of migration definitions (optional)
 */
export interface TableOptions<
  Columns extends Record<string, ColumnDef<any, any>>,
  Migrations extends Record<string, MigrationValue> = {},
> {
  name: string
  description?: string
  priority?: number
  /**
   * The cache time in milliseconds. <br>
   * Default is `Infinity`.
   */
  caching?: number
  /**
   * Database migrations to apply using typed migrations.
   *
   * Supports three key patterns:
   * - **Numeric keys** (`"1"`, `"2"`): Sorted numerically
   * - **Numeric-prefixed keys** (`"001_init"`, `"002_add"`): Sorted by prefix
   * - **Pure string keys** (`"init"`, `"add"`): Uses insertion order
   *
   * @example
   * // Single migration
   * migrations: {
   *   "001_add_email": migrate.addColumn("email", col.string()),
   * }
   *
   * @example
   * // Multiple migrations in sequence
   * migrations: {
   *   "002_add_fields": migrate.sequence(
   *     migrate.addColumn("phone", col.string()),
   *     migrate.addColumn("address", col.string().nullable()),
   *   ),
   * }
   *
   * @example
   * // Raw migration for advanced use cases
   * migrations: {
   *   "003_custom": migrate.raw((builder) => builder.dropColumn("oldField")),
   * }
   */
  migrations?: Migrations
  then?: (this: Table<Columns, Migrations>, table: Table<Columns, Migrations>) => unknown
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
 * Represents a database table with typed columns and migrations.
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
 *
 * @example
 * // With typed migrations
 * const userTable = new Table({
 *   name: "user",
 *   columns: (col) => ({
 *     id: col.increments(),
 *     name: col.string(),
 *   }),
 *   migrations: {
 *     "001_rename": migrate.renameColumn("name", "username"),
 *     "002_add_email": migrate.addColumn("email", col.string()),
 *   },
 * })
 * // Type includes migration transforms: { id: number; username: string; email: string }
 */
export class Table<
  Columns extends Record<string, ColumnDef<any, any>> = Record<string, ColumnDef<any, any>>,
  Migrations extends Record<string, MigrationValue> = {},
> {
  public orm?: ORM

  public _whereCache?: CachedQuery<
    [cb: (query: Table<Columns, Migrations>["query"]) => unknown],
    unknown
  >

  public _countCache?: CachedQuery<[where: string | null], number>

  constructor(public readonly options: TableOptions<Columns, Migrations>) {}

  /**
   * The inferred TypeScript type for rows of this table.
   * Includes base columns and all migration type transforms.
   * Supports both single migrations and arrays of migrations.
   */
  declare readonly $type: FinalTableType<Columns, Migrations>

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
      ): Return => {
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
        | ((this: Table<Columns, Migrations>, table: Table<Columns, Migrations>) => unknown)
        | undefined
      await thenFn?.bind(this)(this)
    }

    return this
  }

  /**
   * Get sorted migration keys based on their pattern.
   * - Pure numeric keys ("1", "2", "10") are sorted numerically
   * - Numeric-prefixed keys ("001_add", "010_rename") are sorted by prefix
   * - Pure string keys ("add_email", "rename") use insertion order or alphabetical
   */
  private getMigrationKeys(): string[] {
    const keys = Object.keys(this.options.migrations ?? {})

    if (keys.length === 0) return []

    // Detect key type patterns
    const allPureNumeric = keys.every((k) => /^\d+$/.test(k))
    const allNumericPrefix = keys.every((k) => /^\d+/.test(k))
    const allPureString = keys.every((k) => !/^\d/.test(k))

    // Validate: no mixing allowed
    if (!allPureNumeric && !allNumericPrefix && !allPureString) {
      // Categorize keys for helpful error message
      const numericKeys = keys.filter((k) => /^\d+$/.test(k))
      const prefixedKeys = keys.filter((k) => /^\d+[_\-a-zA-Z]/.test(k))
      const stringKeys = keys.filter((k) => !/^\d/.test(k))

      const parts: string[] = []
      if (numericKeys.length > 0) {
        parts.push(`numeric keys: ${numericKeys.map((k) => `"${k}"`).join(", ")}`)
      }
      if (prefixedKeys.length > 0) {
        parts.push(`prefixed keys: ${prefixedKeys.map((k) => `"${k}"`).join(", ")}`)
      }
      if (stringKeys.length > 0) {
        parts.push(`string keys: ${stringKeys.map((k) => `"${k}"`).join(", ")}`)
      }

      throw new Error(
        `Table "${this.options.name}": Migration keys use mixed patterns which prevents reliable ordering.\n\n` +
          `Found: ${parts.join(" AND ")}\n\n` +
          `Choose ONE pattern for all keys:\n` +
          `  - Pure numbers: "1", "2", "10" (sorted numerically)\n` +
          `  - Prefixed strings: "001_init", "002_add" (sorted by prefix)\n` +
          `  - Pure strings: "init", "add_email" (insertion order)`,
      )
    }

    if (allPureNumeric) {
      // Sort purely numeric keys numerically: 1, 2, 10, 20
      return keys.sort((a, b) => Number(a) - Number(b))
    }

    if (allNumericPrefix) {
      // Sort by numeric prefix: "001_x" < "002_y" < "010_z"
      const getNumericPrefix = (key: string) => parseInt(key.match(/^(\d+)/)?.[1] ?? "0", 10)
      return keys.sort((a, b) => getNumericPrefix(a) - getNumericPrefix(b))
    }

    // Pure strings: alphabetical order OR insertion order
    // Get ORM config if available (and not false for unconnected ORM)
    const ormConfig = this.orm?.config === false ? undefined : this.orm?.config
    if (ormConfig?.migrations?.alphabeticalOrder) {
      return keys.sort((a, b) => a.localeCompare(b))
    }

    // Warning for insertion order (Git merge risks)
    if (keys.length > 1 && ormConfig) {
      ormConfig.logger?.warn?.(
        `Table "${this.options.name}": Using insertion order for string migration keys. ` +
          `This may cause issues with Git merges. Consider using numeric prefixes (e.g., "001_init").`,
      )
    }

    return keys // Insertion order (ES2015+)
  }

  /**
   * Compare migration keys for determining if one is greater than another.
   * Handles both numeric and string comparisons appropriately.
   */
  private compareMigrationKeys(a: string, b: string): number {
    const aIsNumeric = /^\d+$/.test(a)
    const bIsNumeric = /^\d+$/.test(b)

    if (aIsNumeric && bIsNumeric) {
      return Number(a) - Number(b)
    }

    const aHasPrefix = /^\d+/.test(a)
    const bHasPrefix = /^\d+/.test(b)

    if (aHasPrefix && bHasPrefix) {
      const aPrefix = parseInt(a.match(/^(\d+)/)?.[1] ?? "0", 10)
      const bPrefix = parseInt(b.match(/^(\d+)/)?.[1] ?? "0", 10)
      return aPrefix - bPrefix
    }

    return a.localeCompare(b)
  }

  private async migrate(): Promise<false | string> {
    if (!this.options.migrations) return false

    const sortedKeys = this.getMigrationKeys()
    if (sortedKeys.length === 0) return false

    const migrations = this.options.migrations as Record<string, MigrationValue>

    const fromDatabase = await this.client<MigrationData>("migration")
      .where("table", this.options.name)
      .first()

    const data: MigrationData = fromDatabase || {
      table: this.options.name,
      version: "",
    }

    const baseVersion = data.version

    for (const key of sortedKeys) {
      // Skip migrations that have already been applied
      if (data.version !== "" && this.compareMigrationKeys(key, data.version) <= 0) {
        continue
      }

      const migration = migrations[key]

      await this.client.schema.alterTable(this.options.name, (builder) => {
        migration.apply(builder)
      })

      data.version = key
    }

    await this.client<MigrationData>("migration").insert(data).onConflict("table").merge()

    return baseVersion === data.version ? false : data.version
  }
}
