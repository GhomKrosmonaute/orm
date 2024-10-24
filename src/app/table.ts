import util from "util"
import { Knex } from "knex"
import { ORM } from "./orm.js"
import { ResponseCache } from "./caching.js"
import {
  DEFAULT_LOGGER_DESCRIPTION,
  DEFAULT_LOGGER_HIGHLIGHT,
  DEFAULT_LOGGER_RAW_VALUE,
} from "./util.js"

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

  public _whereCache?: ResponseCache<
    [cb: (query: Table<Type>["query"]) => unknown],
    unknown
  >

  public _countCache?: ResponseCache<[where: string | null], Promise<number>>

  constructor(public readonly options: TableOptions<Type>) {}

  get db() {
    if (!this.orm) throw new Error("missing ORM")
    return this.orm.database
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

  async make(): Promise<this> {
    if (!this.orm) throw new Error("missing ORM")

    this._whereCache = new ResponseCache(
      (cb: (query: Knex.QueryBuilder<Type>) => unknown) => cb(this.query),
      this.options.caching ?? this.orm?.config.caching ?? Infinity,
    )

    this._countCache = new ResponseCache(
      (where: string | null) => this.count(where ?? undefined),
      this.options.caching ?? this.orm?.config.caching ?? Infinity,
    )

    try {
      await this.db.schema.createTable(this.options.name, this.options.setup)

      this.orm.config.logger?.log(
        `created table ${util.styleText(
          this.orm.config.loggerStyles?.highlight ?? DEFAULT_LOGGER_HIGHLIGHT,
          this.options.name,
        )}${
          this.options.description
            ? ` ${util.styleText(
                this.orm.config.loggerStyles?.description ??
                  DEFAULT_LOGGER_DESCRIPTION,
                this.options.description,
              )}`
            : ""
        }`,
      )
    } catch (error: any) {
      if (error.toString().includes("syntax error")) {
        this.orm.config.logger?.error(
          `you need to implement the "setup" method in options of your ${util.styleText(
            this.orm.config.loggerStyles?.highlight ?? DEFAULT_LOGGER_HIGHLIGHT,
            this.options.name,
          )} table!`,
        )

        throw error
      } else {
        this.orm.config.logger?.log(
          `loaded table ${util.styleText(
            this.orm.config.loggerStyles?.highlight ?? DEFAULT_LOGGER_HIGHLIGHT,
            this.options.name,
          )}${
            this.options.description
              ? ` ${util.styleText(
                  this.orm.config.loggerStyles?.description ??
                    DEFAULT_LOGGER_DESCRIPTION,
                  this.options.description,
                )}`
              : ""
          }`,
        )
      }
    }

    try {
      const migrated = await this.migrate()

      if (migrated !== false) {
        this.orm.config.logger?.log(
          `migrated table ${util.styleText(
            this.orm.config.loggerStyles?.highlight ?? DEFAULT_LOGGER_HIGHLIGHT,
            this.options.name,
          )} to version ${util.styleText(
            this.orm.config.loggerStyles?.rawValue ?? DEFAULT_LOGGER_RAW_VALUE,
            String(migrated),
          )}`,
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
