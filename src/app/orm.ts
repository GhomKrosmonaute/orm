import fs from "fs"
import url from "url"
import path from "path"
import { Handler } from "@ghom/handler"
import { Knex, default as knex } from "knex"
import { MigrationData, Table } from "./table.js"
import { Color } from "chalk"

const pack = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")
)
const isCJS = pack.type === "commonjs" || pack.type == void 0

export interface ILogger {
  log: (...message: string[]) => void
  error: (error: Error | string) => void
}

export interface ORMConfig {
  /**
   * path to the directory that contains js files of tables
   */
  location: string

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
   * Based on Chalk color-method names.
   */
  loggerColors?: {
    highlight: typeof Color
    rawValue: typeof Color
  }
}

export class ORM {
  database: Knex
  handler: Handler<Table<any>>

  constructor(public config: ORMConfig) {
    this.database = knex(
      config.database ?? {
        client: "sqlite3",
        useNullAsDefault: true,
        connection: {
          filename: ":memory:",
        },
      }
    )
    this.handler = new Handler(config.location, {
      loader: (filepath) =>
        import(isCJS ? filepath : url.pathToFileURL(filepath).href).then(
          (file) => file.default
        ),
    })
  }

  async init() {
    await this.handler.init()

    const tables = [...this.handler.elements.values()]

    try {
      await this.database.raw("PRAGMA foreign_keys = ON;")
    } catch (error) {}

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
  }
}
