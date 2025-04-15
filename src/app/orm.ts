import url from "node:url"
import { Handler } from "@ghom/handler"
import { Client as SSH } from "ssh2"
import { Knex, default as knex } from "knex"
import { extractDatabaseConfig, isCJS, TextStyle } from "./util.js"
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

  ssh?: {
    host: string
    port: number
    username: string
    password: string
  }
}

export class ORM {
  private _ready = false

  public client: Knex | null = null
  public tunnel: SSH | null = null
  public handler

  public _rawCache

  constructor(public config: ORMConfig) {
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
    if (!this.client) throw new Error("missing client")
    return this.client.schema.hasTable(name)
  }

  /**
   * Handle the table files and create the tables in the database.
   */
  async init() {
    if (this.config.ssh) {
      this.client = await new Promise(async (resolve, reject) => {
        const tunnel = (this.tunnel = new SSH())

        const databaseConfig = await extractDatabaseConfig(
          this.config.database?.connection,
        )

        tunnel
          .on("error", reject)
          .on("ready", () => {
            tunnel.forwardOut(
              "127.0.0.1",
              0,
              databaseConfig.host,
              databaseConfig.port,
              (err, stream) => {
                if (err) {
                  tunnel.end()
                  reject(err)
                  return
                }

                const client = knex({
                  ...this.config.database,
                  connection: {
                    ...databaseConfig,
                    stream,
                  },
                })

                resolve(client)
              },
            )
          })
          .connect({
            host: this.config.ssh!.host,
            port: this.config.ssh!.port,
            username: this.config.ssh!.username,
            password: this.config.ssh!.password,
          })
      })
    } else {
      this.client = knex(
        this.config.database ?? {
          client: "sqlite3",
          useNullAsDefault: true,
          connection: {
            filename: ":memory:",
          },
        },
      )
    }

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
    if (this._ready) this.cache.invalidate()
    if (!this.client) throw new Error("missing client")
    return this.client.raw(sql)
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

  clientBasedOperation<Return>(
    operation: Partial<Record<"pg" | "mysql2" | "sqlite3", () => Return>>,
  ): Return | undefined {
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
    await disableForeignKeys(this, async (trx) => {
      for (let table of this.cachedTables) {
        await restoreBackup(table, trx, dirname)
      }
    })

    console.log("Database restored from backup.")
  }
}
