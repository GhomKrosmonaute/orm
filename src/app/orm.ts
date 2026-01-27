import url from "node:url"
import { Handler } from "@ghom/handler"
import { Knex, default as knex } from "knex"
import { isCJS, TextStyle } from "./util.js"
import { MigrationData, Table } from "./table.js"
import { CachedQuery } from "@ghom/query"
import {
  backupTable,
  restoreBackup,
  disableForeignKeys,
  enableForeignKeys,
} from "./backup.js"

export interface ILogger {
  log: (message: string) => void
  error: (error: string | Error) => void
  warn: (warning: string) => void
}

export interface LoggerStyles {
  highlight: TextStyle
  rawValue: TextStyle
  description: TextStyle
}

export interface ORMConfig {
  /**
   * path to the directory that contains js files of tables
   */
  tableLocation: string

  /**
   * database configuration
   */
  database?: Knex.Config

  /**
   * Logger used to log the table files loaded or created.
   */
  logger?: ILogger

  /**
   * Pattern used on logs when the table files are loaded or created. <br>
   * Based on node:util.styleText style names.
   */
  loggerStyles?: LoggerStyles

  /**
   * Configuration for the database backups.
   */
  backups?: {
    location?: string
    chunkSize?: number
  }

  /**
   * The cache time in milliseconds. <br>
   * Default is `Infinity`.
   */
  caching?: number
}

/**
 * The main ORM class that manages database connections, tables, and caching.
 *
 * @example
 * // With database connection
 * const orm = new ORM({
 *   tableLocation: "./tables",
 *   database: { client: "sqlite3", connection: { filename: ":memory:" } }
 * })
 * await orm.init()
 *
 * @example
 * // Without database connection (for type exports only)
 * const orm = new ORM(false)
 * orm.isConnected // false
 */
export class ORM {
  private _ready = false

  public client?: Knex
  public handler?: Handler<Table<any>>

  public _rawCache?: CachedQuery<[raw: string], Knex.Raw>

  /**
   * Creates a new ORM instance.
   *
   * @param config - The ORM configuration, or `false` to create an unconnected instance.
   *
   * When `false` is passed, the ORM will not connect to any database.
   * This is useful for scenarios where you only need to export types or
   * use the ORM structure without an actual database connection.
   *
   * Methods that require a database connection will throw an error
   * if called on an unconnected ORM instance.
   */
  constructor(public config: ORMConfig | false) {
    if (config === false) return

    this.client = knex(
      config.database ?? {
        client: "sqlite3",
        useNullAsDefault: true,
        connection: {
          filename: ":memory:",
        },
      },
    )

    this.handler = new Handler<Table<any>>(config.tableLocation, {
      pattern: /\.[jt]s$/,
      loader: async (filepath) => {
        const file = await import(
          isCJS ? filepath : url.pathToFileURL(filepath).href
        )
        if (file.default instanceof Table) return file.default
        throw new Error(`${filepath}: default export must be a Table instance`)
      },
    })

    this._rawCache = new CachedQuery(
      async (raw: string) => await this.raw(raw),
      config.caching ?? Infinity,
    )
  }

  private requireClient(): asserts this is ORM & {
    config: ORMConfig
    client: Knex
    handler: Handler<Table<any>>
    _rawCache: CachedQuery<[raw: string], Knex.Raw>
  } {
    if (!this.client)
      throw new Error(
        "ORM client is not initialized. Cannot use this method without a database connection.",
      )
  }

  /**
   * Returns true if the ORM has a database client connected.
   */
  get isConnected(): boolean {
    return this.client !== undefined
  }

  get cachedTables() {
    if (!this.handler) return []
    return [...this.handler.elements.values()]
  }

  get cachedTableNames() {
    return this.cachedTables.map((table) => table.options.name)
  }

  hasCachedTable(name: string) {
    return this.cachedTables.some((table) => table.options.name === name)
  }

  async hasTable(name: string): Promise<boolean> {
    this.requireClient()
    return this.client.schema.hasTable(name)
  }

  /**
   * Handle the table files and create the tables in the database.
   */
  async init() {
    this.requireClient()
    await this.handler.init()

    try {
      await enableForeignKeys(this)
    } catch {}

    this.handler.elements.set(
      "migration",
      new Table<MigrationData>({
        name: "migration",
        priority: Infinity,
        setup: (table) => {
          table.string("table").unique().notNullable()
          table.integer("version").notNullable()
        },
      }),
    )

    const sortedTables = this.cachedTables.toSorted(
      (a, b) => (b.options.priority ?? 0) - (a.options.priority ?? 0),
    )

    for (const table of sortedTables) {
      await table.make(this)
    }

    this._ready = true
  }

  raw(sql: Knex.Value): Knex.Raw {
    this.requireClient()
    if (this._ready) this.cache.invalidate()
    return this.client.raw(sql)
  }

  cache = {
    raw: (sql: string, anyDataUpdated?: boolean): Promise<Knex.Raw> => {
      this.requireClient()
      if (anyDataUpdated) this.cache.invalidate()
      return this._rawCache.get(sql, sql)
    },
    invalidate: () => {
      this._rawCache?.invalidate()
      this.cachedTables.forEach((table) => table.cache.invalidate())
    },
  }

  clientBasedOperation<Return>(
    operation: Partial<Record<"pg" | "mysql2" | "sqlite3", () => Return>>,
  ): Return | undefined {
    if (this.config === false) return undefined
    const client = (this.config.database?.client ?? "sqlite3") as
      | "pg"
      | "mysql2"
      | "sqlite3"
    return operation[client]?.()
  }

  /**
   * Create a backup of the database. <br>
   * The backup will be saved in the location specified in the config.
   */
  async createBackup(dirname?: string) {
    this.requireClient()
    for (let table of this.cachedTables) {
      await backupTable(table, dirname)
    }

    console.log("Database backup created.")
  }

  /**
   * Restore the database from the backup. <br>
   * @warning This will delete all the data in the tables.
   */
  async restoreBackup(dirname?: string) {
    this.requireClient()
    await disableForeignKeys(this, async (trx) => {
      for (let table of this.cachedTables) {
        await restoreBackup(table, trx, dirname)
      }
    })

    console.log("Database restored from backup.")
  }
}
