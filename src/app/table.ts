import { Knex } from "knex"
import { ORM } from "./orm.js"
import { styled } from "./util.js"
import { CachedQuery } from "@ghom/query"

export interface MigrationData {
  table: string
  version: number
}

export interface TableOptions<Type extends object = object> {
  name: string
  description?: string
  priority?: number
  /**
   * The cache time in milliseconds. <br>
   * Default is `Infinity`.
   */
  caching?: number
  migrations?: { [version: number]: (table: Knex.CreateTableBuilder) => void }
  then?: (this: Table<Type>, table: Table<Type>) => unknown
  setup: (table: Knex.CreateTableBuilder) => void
}

export class Table<Type extends object = object> {
  public orm?: ORM

  public _whereCache?: CachedQuery<
    [cb: (query: Table<Type>["query"]) => unknown],
    unknown
  >

  public _countCache?: CachedQuery<[where: string | null], number>

  constructor(public readonly options: TableOptions<Type>) {}

  get db() {
    if (!this.orm) throw new Error("missing ORM")
    return this.orm.client
  }

  get query() {
    return this.db<Type>(this.options.name)
  }

  get cache() {
    if (!this._whereCache || !this._countCache) throw new Error("missing cache")

    if (!this.orm) throw new Error("missing ORM")

    return {
      get: <Return>(
        id: string,
        cb: (
          table: Pick<
            Table<Type>["query"],
            | "select"
            | "count"
            | "avg"
            | "sum"
            | "countDistinct"
            | "avgDistinct"
            | "sumDistinct"
          >,
        ) => Return,
      ): Return => {
        return this._whereCache!.get(id, cb) as Return
      },
      set: <Return>(
        cb: (
          table: Pick<
            Table<Type>["query"],
            | "update"
            | "delete"
            | "insert"
            | "upsert"
            | "truncate"
            | "jsonInsert"
          >,
        ) => Return,
      ) => {
        // todo: invalidate only the related tables
        this.orm!.cache.invalidate()
        return cb(this.query)
      },
      count: (where?: string) => {
        return this._countCache!.get(where ?? "*", where ?? null)
      },
      invalidate: () => {
        this._whereCache!.invalidate()
        this._countCache!.invalidate()
        this.orm!._rawCache.invalidate()
      },
    }
  }

  async count(where?: string): Promise<number> {
    return this.query
      .select(this.db.raw("count(*) as total"))
      .whereRaw(where ?? "1=1")
      .then(
        (rows) =>
          +((rows?.[0] ?? { total: 0 }) as unknown as { total: number }).total,
      )
  }

  async hasColumn(name: keyof Type & string): Promise<boolean> {
    return this.db.schema.hasColumn(this.options.name, name as string)
  }

  async getColumn(name: keyof Type & string): Promise<Knex.ColumnInfo> {
    return this.db(this.options.name).columnInfo(name)
  }

  async getColumns(): Promise<Record<keyof Type & string, Knex.ColumnInfo>> {
    return this.db(this.options.name).columnInfo()
  }

  async getColumnNames(): Promise<Array<keyof Type & string>> {
    return this.getColumns().then(Object.keys) as Promise<
      Array<keyof Type & string>
    >
  }

  async isEmpty(): Promise<boolean> {
    return this.count().then((count) => count === 0)
  }

  async make(orm: ORM): Promise<this> {
    this.orm = orm

    this._whereCache = new CachedQuery(
      (cb: (query: Knex.QueryBuilder<Type>) => unknown) => cb(this.query),
      this.options.caching ?? this.orm?.config.caching ?? Infinity,
    )

    this._countCache = new CachedQuery(
      (where: string | null) => this.count(where ?? undefined),
      this.options.caching ?? this.orm?.config.caching ?? Infinity,
    )

    const tableNameLog = `table ${styled(this.orm, this.options.name, "highlight")}${
      this.options.description
        ? ` ${styled(this.orm, this.options.description, "description")}`
        : ""
    }`

    try {
      await this.db.schema.createTable(this.options.name, this.options.setup)

      this.orm.config.logger?.log(`created table ${tableNameLog}`)
    } catch (error: any) {
      if (error.toString().includes("syntax error")) {
        this.orm.config.logger?.error(
          `you need to implement the "setup" method in options of your ${styled(this.orm, this.options.name, "highlight")} table!`,
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

    if ((await this.count()) === 0) await this.options.then?.bind(this)(this)

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
        .map((entry) => [Number(entry[0]), entry[1]]),
    )

    const fromDatabase = await this.db<MigrationData>("migration")
      .where("table", this.options.name)
      .first()

    const data = fromDatabase || {
      table: this.options.name,
      version: -Infinity,
    }

    const baseVersion = data.version

    for (const [version, migration] of migrations) {
      await this.db.schema.alterTable(this.options.name, (builder) => {
        if (version <= data.version) return
        migration(builder)
        data.version = version
      })
    }

    await this.db<MigrationData>("migration")
      .insert(data)
      .onConflict("table")
      .merge()

    return baseVersion === data.version ? false : data.version
  }
}
