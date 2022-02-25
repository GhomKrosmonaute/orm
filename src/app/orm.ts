import knex, { Knex } from "knex"
import path from "path"
import { Handler } from "@ghom/handler"
import { MigrationData, Table } from "./table"

/**
 * @property tablePath - path to directory that contains js files of tables
 * @property verbose - show console logs or not
 */
export interface ORMConfig {
  verbose?: boolean
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
        filename: path.join(process.cwd(), "sqlite3.db"),
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
      const tables = await Promise.all(
        pathList.map(async (filepath) => {
          return import("file://" + filepath).then((file) => file.default)
        })
      )

      tables.unshift(
        new Table<MigrationData>({
          name: "migration",
          priority: Infinity,
          setup: (table) => {
            table.string("table").unique().notNullable()
            table.integer("version").notNullable()
          },
        })
      )

      tables.forEach((table) => (table.orm = this))

      return Promise.all(
        tables
          .sort((a, b) => {
            return (b.options.priority ?? 0) - (a.options.priority ?? 0)
          })
          .map((table) => table.make())
      )
    })

    await this.load()
  }

  //todo: forEach table: table.orm = this THEN do make & etc...
}
