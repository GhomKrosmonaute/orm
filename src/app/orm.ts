import url from "url"
import { Handler } from "@ghom/handler"
import { Knex, default as knex } from "knex"
import { isCJS, TextStyle } from "./util.js"
import { MigrationData, Table } from "./table.js"
import { ResponseCache } from "./caching.js"
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
  loggerStyles?: {
    highlight: TextStyle
    rawValue: TextStyle
    description: TextStyle
  }

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

export class ORM {
  private _ready = false

  public database: Knex
  public handler: Handler<Table<any>>

  public _rawCache: ResponseCache<[sql: string], Knex.Raw>

  constructor(public config: ORMConfig) {
    this.database = knex(
      config.database ?? {
        client: "sqlite3",
        useNullAsDefault: true,
        connection: {
          filename: ":memory:",
        },
      },
    )

    this.handler = new Handler(config.tableLocation, {
      loader: (filepath) =>
        import(isCJS ? filepath : url.pathToFileURL(filepath).href).then(
          (file) => file.default,
        ),
      pattern: /\.js$/,
    })

    this._rawCache = new ResponseCache(
      (raw: string) => this.raw(raw),
      config.caching ?? Infinity,
    )
  }

  get cachedTables() {
    return [...this.handler.elements.values()]
  }

  get cachedTableNames() {
    return this.cachedTables.map((table) => table.options.name)
  }

  hasCachedTable(name: string) {
    return this.cachedTables.some((table) => table.options.name === name)
  }

  async hasTable(name: string): Promise<boolean> {
    return this.database.schema.hasTable(name)
  }

  /**
   * Handle the table files and create the tables in the database.
   */
  async init() {
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

    for (const table of this.cachedTables.sort(
      (a, b) => (b.options.priority ?? 0) - (a.options.priority ?? 0),
    )) {
      table.orm = this
      await table.make()
    }

    this._ready = true
  }

  raw(sql: Knex.Value): Knex.Raw {
    if (this._ready) this.cache.invalidate()
    return this.database.raw(sql)
  }

  cache = {
    raw: (sql: string, anyDataUpdated?: boolean): Knex.Raw => {
      if (anyDataUpdated) this.cache.invalidate()
      return this._rawCache!.get(sql, sql)
    },
    invalidate: () => {
      this._rawCache.invalidate()
      this.cachedTables.forEach((table) => table.cache.invalidate())
    },
  }

  /**
   * Create a backup of the database. <br>
   * The backup will be saved in the location specified in the config.
   */
  async createBackup(dirname?: string) {
    try {
      for (let table of this.cachedTables) {
        await backupTable(table, dirname)
      }

      console.log("Database backup created.")
    } catch (error) {
      console.error("Error while creating backup of the database.", error)
    }
  }

  /**
   * Restore the database from the backup. <br>
   * @warning This will delete all the data in the tables.
   */
  async restoreBackup(dirname?: string) {
    try {
      await disableForeignKeys(this)

      for (let table of this.cachedTables) {
        await restoreBackup(table, dirname)
      }

      await enableForeignKeys(this)

      console.log("Database restored from backup.")
    } catch (error) {
      console.error("Error while restoring backup of the database.", error)
    }
  }
}
