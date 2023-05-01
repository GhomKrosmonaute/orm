import chalk from "chalk"
import { Knex } from "knex"
import { ORM } from "./orm.js"

export interface MigrationData {
  table: string
  version: number
}

export interface TableOptions<Type extends {}> {
  name: string
  priority?: number
  migrations?: { [version: number]: (table: Knex.CreateTableBuilder) => void }
  then?: (this: Table<Type>, table: Table<Type>) => unknown
  setup: (table: Knex.CreateTableBuilder) => void
}

export class Table<Type extends {}> {
  orm?: ORM

  constructor(public readonly options: TableOptions<Type>) {}

  get db() {
    if (!this.orm) throw new Error("missing ORM")
    return this.orm.database
  }

  get query() {
    return this.db<Type>(this.options.name)
  }

  async hasColumn(name: keyof Type): Promise<boolean> {
    return this.db.schema.hasColumn(this.options.name, name as string)
  }

  async isEmpty(): Promise<boolean> {
    return this.query
      .select()
      .limit(1)
      .then((rows) => rows.length === 0)
  }

  async make(): Promise<this> {
    if (!this.orm) throw new Error("missing ORM")

    try {
      await this.db.schema.createTable(this.options.name, this.options.setup)

      this.orm.config.logger?.log(
        `created table ${chalk[
          this.orm.config.loggerColors?.highlight ?? "blueBright"
        ](this.options.name)}`
      )
    } catch (error: any) {
      if (error.toString().includes("syntax error")) {
        this.orm.config.logger?.error(
          `you need to implement the "setup" method in options of your ${chalk[
            this.orm.config.loggerColors?.highlight ?? "blueBright"
          ](this.options.name)} table!`
        )

        throw error
      } else {
        this.orm.config.logger?.log(
          `loaded table ${chalk[
            this.orm.config.loggerColors?.highlight ?? "blueBright"
          ](this.options.name)}`
        )
      }
    }

    try {
      const migrated = await this.migrate()

      if (migrated !== false) {
        this.orm.config.logger?.log(
          `migrated table ${chalk[
            this.orm.config.loggerColors?.highlight ?? "blueBright"
          ](this.options.name)} to version ${chalk[
            this.orm.config.loggerColors?.rawValue ?? "magentaBright"
          ](migrated)}`
        )
      }
    } catch (error: any) {
      this.orm.config.logger?.error(error)
    }

    await this.options.then?.bind(this)(this)

    return this
  }

  private async migrate(): Promise<false | number> {
    if (!this.options.migrations) return false

    const migrations = new Map<
      number,
      (table: Knex.CreateTableBuilder) => void
    >(
      Object.entries(this.options.migrations)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map((entry) => [Number(entry[0]), entry[1]])
    )

    const fromDatabase = await this.db<MigrationData>("migration")
      .where("table", this.options.name)
      .first()

    const data = fromDatabase || {
      table: this.options.name,
      version: -Infinity,
    }

    const baseVersion = data.version

    await this.db.schema.alterTable(this.options.name, (builder) => {
      migrations.forEach((migration, version) => {
        if (version <= data.version) return
        migration(builder)
        data.version = version
      })
    })

    await this.db<MigrationData>("migration")
      .insert(data)
      .onConflict("table")
      .merge()

    return baseVersion === data.version ? false : data.version
  }
}
