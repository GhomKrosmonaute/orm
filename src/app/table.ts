import { Knex } from "knex"
import { ORM } from "./orm.js"

export interface MigrationData {
  table: string
  version: number
}

export interface TableOptions<Type> {
  name: string
  priority?: number
  migrations?: { [version: number]: (table: Knex.CreateTableBuilder) => void }
  setup: (table: Knex.CreateTableBuilder) => void
}

export class Table<Type> {
  orm?: ORM

  constructor(public readonly options: TableOptions<Type>) {}

  private get verbose() {
    if (!this.orm) throw new Error("missing ORM")
    return this.orm.ormConfig.verbose
  }

  get db() {
    if (!this.orm) throw new Error("missing ORM")
    return this.orm.db
  }

  get query() {
    return this.db<Type>(this.options.name)
  }

  async make(): Promise<this> {
    try {
      await this.db.schema.createTable(this.options.name, this.options.setup)
      if (this.verbose) console.log(`created table ${this.options.name}`)
    } catch (error: any) {
      if (error.toString().includes("syntax error")) {
        if (this.verbose)
          console.error(
            `you need to implement the "setup" method in options of your ${this.options.name} table!`
          )

        throw error
      } else {
        if (this.verbose) console.log(`loaded table ${this.options.name}`)
      }
    }

    try {
      const migrated = await this.migrate()

      if (migrated !== false) {
        if (this.verbose)
          console.log(
            `migrated table ${this.options.name} to version ${migrated}`
          )
      }
    } catch (error: any) {
      if (this.verbose) console.error(error)
    }

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
      version: -1,
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
