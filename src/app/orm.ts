import fs from "fs"
import url from "url"
import path from "path"
import { Handler } from "@ghom/handler"
import { Knex, default as knex } from "knex"
import { MigrationData, Table } from "./table.js"
import chalk, { Color } from "chalk"

const defaultBackupDir = path.join(process.cwd(), "backup")

const pack = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
)
const isCJS = pack.type === "commonjs" || pack.type == void 0

export interface ILogger {
  log: (message: string) => void
  error: (error: string | Error) => void
  warn: (warning: string) => void
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
    description: typeof Color
  }
}

export class ORM {
  public database: Knex
  public handler: Handler<Table<any>>

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

    this.handler = new Handler(config.location, {
      loader: (filepath) =>
        import(isCJS ? filepath : url.pathToFileURL(filepath).href).then(
          (file) => file.default,
        ),
      pattern: /\.js$/,
    })
  }

  get cachedTables() {
    return [...this.handler.elements.values()]
  }

  get cachedTableNames() {
    return this.cachedTables.map((table) => table.options.name)
  }

  hasCachedTable(name: string) {
    return this.cachedTables.some((table) => table.options.name)
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

    for (const table of this.cachedTables.sort(
      (a, b) => (b.options.priority ?? 0) - (a.options.priority ?? 0),
    )) {
      table.orm = this
      await table.make()
    }
  }

  raw(sql: Knex.Value): Knex.Raw {
    return this.database.raw(sql)
  }

  // /**
  //  * Extract the database to a CSV file for each table.
  //  */
  // async createBackup(dir = defaultBackupDir) {
  //   const tables = [...this.handler.elements.values()]
  //
  //   for (const table of tables) {
  //     await this.database
  //       .select()
  //       .from(table.options.name)
  //       .then(async (rows) => {
  //         const csv = rows.map((row) => Object.values(row).join(",")).join("\n")
  //
  //         return fs.promises.writeFile(
  //           path.join(dir, `${table.options.name}.csv`),
  //           csv,
  //           "utf8",
  //         )
  //       })
  //   }
  // }
  //
  // /**
  //  * Import a CSV file for each table to the database.
  //  */
  // async restoreBackup(dir = defaultBackupDir) {
  //   const tables = [...this.handler.elements.values()].sort(
  //     (a, b) => (b.options.priority ?? 0) - (a.options.priority ?? 0),
  //   )
  //
  //   for (const table of tables) {
  //     const columnInfo = await table.getColumns()
  //
  //     let csv: string
  //
  //     try {
  //       csv = await fs.promises.readFile(
  //         path.join(dir, `${table.options.name}.csv`),
  //         "utf8",
  //       )
  //     } catch (error) {
  //       this.config.logger?.warn(
  //         `missing backup file for table ${chalk[
  //           this.config.loggerColors?.highlight ?? "blueBright"
  //         ](table.options.name)}`,
  //       )
  //
  //       continue
  //     }
  //
  //     if (csv.trim().length === 0) continue
  //
  //     const rows = csv
  //       .split("\n")
  //       .map((row) => row.split(","))
  //       .map((row) => {
  //         const data: any = {}
  //
  //         let index = 0
  //
  //         for (const [name, info] of Object.entries(columnInfo)) {
  //           data[name] =
  //             info.type === "integer" ? Number(row[index]) : row[index]
  //           index++
  //         }
  //
  //         return data
  //       })
  //
  //     await this.database(table.options.name).insert(rows)
  //   }
  // }
}
