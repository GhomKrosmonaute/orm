import fs from "fs"
import url from "url"
import path from "path"
import { Handler } from "@ghom/handler"
import { Knex, default as knex } from "knex"
import { MigrationData, Table } from "./table.js"

export interface ORMLogger {
  log: (message: string, section?: string) => void
  error: (text: string | Error, _path: string, full?: boolean) => void
}

/**
 * @property tablePath - path to directory that contains js files of tables
 * @property verbose - show console logs or not
 */
export interface ORMConfig {
  logger?: ORMLogger
  tablePath: string
}

export class ORM extends Handler {
  db: Knex
  ormConfig: ORMConfig

  /**
   * @param ormConfig configuration for table handler or just tablePath (path to directory that contains js files of tables)
   * @param knexConfig configuration for connect to database
   */
  constructor(
    ormConfig: ORMConfig | string,
    knexConfig: Knex.Config = {
      client: "sqlite3",
      useNullAsDefault: true,
      connection: {
        filename: ":memory:",
      },
    }
  ) {
    super(typeof ormConfig === "string" ? ormConfig : ormConfig.tablePath)
    this.ormConfig =
      typeof ormConfig === "string" ? { tablePath: ormConfig } : ormConfig
    this.db = knex(knexConfig)
  }

  async init() {
    this.once("finish", async (pathList) => {
      const tables: Table<any>[] = await Promise.all(
        pathList.map(async (filepath) => {
          return import(
            fs.existsSync(path.join(__dirname, "..", "..", "cjs"))
              ? filepath
              : url.pathToFileURL(filepath).href
          ).then((file) => file.default)
        })
      )

      const migration = new Table<MigrationData>({
        name: "migration",
        priority: Infinity,
        setup: (table) => {
          table.string("table").unique().notNullable()
          table.integer("version").notNullable()
        },
      })

      migration.orm = this
      await migration.make()

      for (const table of tables.sort(
        (a, b) => (b.options.priority ?? 0) - (a.options.priority ?? 0)
      )) {
        table.orm = this
        await table.make()
      }
    })

    try {
      await this.db.raw("PRAGMA foreign_keys = ON;")
    } catch (error) {}

    await this.load()
  }
}
