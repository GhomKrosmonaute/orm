import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"
import { rimraf } from "rimraf"

import { col, extractDatabaseConfig, migrate, ORM, type ORMConfig, Table } from "../src"

import a from "./tables/a"
import b from "./tables/b"
import c from "./tables/c"
import d from "./tables/d"

describe("typed columns", () => {
  test("new Table() infers types correctly", () => {
    const userTable = new Table({
      name: "test_user",
      columns: (col) => ({
        id: col.increments(),
        username: col.string().unique(),
        age: col.integer().nullable(),
        role: col.enum(["admin", "user"] as const),
        isActive: col.boolean().defaultTo(true),
      }),
    })

    expect(userTable).toBeInstanceOf(Table)
    expect(userTable.options.name).toBe("test_user")
    expect("columns" in userTable.options).toBe(true)

    // Type inference check - this line would fail at compile time if types weren't inferred
    type ExpectedType = typeof userTable.$type
    const _typeCheck: ExpectedType = {
      id: 1,
      username: "test",
      age: null,
      role: "admin",
      isActive: true,
    }
  })

  test("col factory creates column definitions", () => {
    const idCol = col.increments()
    const stringCol = col.string()
    const nullableInt = col.integer().nullable()
    const enumCol = col.enum(["a", "b", "c"] as const)

    expect(idCol).toBeDefined()
    expect(stringCol).toBeDefined()
    expect(nullableInt._isNullable).toBe(true)
    expect(enumCol).toBeDefined()
  })

  test("typed table d has correct options", () => {
    expect(d).toBeInstanceOf(Table)
    expect(d.options.name).toBe("d")
    expect("columns" in d.options).toBe(true)
  })
})

describe("typed migrations", () => {
  test("migrate.addColumn creates TypedMigration", () => {
    const migration = migrate.addColumn("email", col.string())

    expect(migration).toBeDefined()
    expect(migration.apply).toBeInstanceOf(Function)
    expect("_from" in migration).toBe(true)
    expect("_to" in migration).toBe(true)
  })

  test("migrate.dropColumn creates TypedMigration", () => {
    const migration = migrate.dropColumn("oldField")

    expect(migration).toBeDefined()
    expect(migration.apply).toBeInstanceOf(Function)
  })

  test("migrate.renameColumn creates TypedMigration", () => {
    const migration = migrate.renameColumn("name", "username")

    expect(migration).toBeDefined()
    expect(migration.apply).toBeInstanceOf(Function)
  })

  test("migrate.alterColumn creates TypedMigration", () => {
    const migration = migrate.alterColumn("age", col.integer().nullable())

    expect(migration).toBeDefined()
    expect(migration.apply).toBeInstanceOf(Function)
  })

  test("migrate.addIndex creates TypedMigration", () => {
    const migration = migrate.addIndex(["email"], "idx_email")

    expect(migration).toBeDefined()
    expect(migration.apply).toBeInstanceOf(Function)
  })

  test("migrate.addUnique creates TypedMigration", () => {
    const migration = migrate.addUnique(["email"], "uniq_email")

    expect(migration).toBeDefined()
    expect(migration.apply).toBeInstanceOf(Function)
  })

  test("migrate.raw creates TypedMigration", () => {
    const migration = migrate.raw((builder) => {
      builder.dropColumn("temp")
    })

    expect(migration).toBeDefined()
    expect(migration.apply).toBeInstanceOf(Function)
  })

  test("Table with typed migrations has correct options", () => {
    const userTable = new Table({
      name: "test_typed_migrations",
      columns: (col) => ({
        id: col.increments(),
        name: col.string(),
      }),
      migrations: {
        "001_add_email": migrate.addColumn("email", col.string()),
        "002_add_age": migrate.addColumn("age", col.integer().nullable()),
        "003_rename_name": migrate.renameColumn("name", "username"),
      },
    })

    expect(userTable).toBeInstanceOf(Table)
    expect(userTable.options.migrations).toBeDefined()
    expect(Object.keys(userTable.options.migrations!).length).toBe(3)

    // Type inference check - final type includes base columns + migrations
    // "name" is removed by renameColumn, "username" is added
    type ExpectedType = typeof userTable.$type
    const _typeCheck: ExpectedType = {
      id: 1,
      username: "test", // renamed from "name"
      // @ts-expect-error - name is removed by renameColumn
      name: "test",
      email: "test@example.com",
      age: null,
    }
  })

  test("Table accepts migrate.sequence for multiple typed migrations", () => {
    const userTable = new Table({
      name: "test_sequence_migrations",
      columns: (col) => ({
        id: col.increments(),
        name: col.string(),
      }),
      migrations: {
        "001_multiple_changes": migrate.sequence(
          migrate.addColumn("phone", col.string()),
          migrate.addColumn("address", col.string().nullable()),
          migrate.addIndex(["phone"], "idx_phone"),
          migrate.renameColumn("name", "username"),
          migrate.renameColumn("username", "fullname"),
        ),
      },
    })

    expect(userTable).toBeInstanceOf(Table)
    expect(userTable.options.migrations).toBeDefined()
    expect(Object.keys(userTable.options.migrations!).length).toBe(1)

    // Type inference check - sequence migrations should infer types correctly
    type ExpectedType = typeof userTable.$type
    const _typeCheck: ExpectedType = {
      id: 1,
      // @ts-expect-error - name is removed by renameColumn
      name: "test",
      // @ts-expect-error - username is removed by renameColumn
      username: "test",
      fullname: "test",
      phone: "123456789",
      address: null,
    }
  })

  test("Table accepts mixed single and sequence migrations", () => {
    const userTable = new Table({
      name: "test_mixed_migrations",
      columns: (col) => ({
        id: col.increments(),
        name: col.string(),
      }),
      migrations: {
        "001_add_email": migrate.addColumn("email", col.string()),
        "002_multiple_changes": migrate.sequence(
          migrate.addColumn("phone", col.string()),
          migrate.addColumn("age", col.integer().nullable()),
        ),
        "003_add_active": migrate.addColumn("isActive", col.boolean().defaultTo(true)),
      },
    })

    expect(userTable).toBeInstanceOf(Table)
    expect(userTable.options.migrations).toBeDefined()
    expect(Object.keys(userTable.options.migrations!).length).toBe(3)

    // Type inference check - mixed migrations should infer all types
    type ExpectedType = typeof userTable.$type
    const _typeCheck: ExpectedType = {
      id: 1,
      name: "test",
      email: "test@example.com",
      phone: "123456789",
      age: null,
      isActive: true,
    }
  })

  test("Table accepts migrate.sequence with raw migrations", () => {
    const table = new Table({
      name: "test_sequence_raw_migrations",
      columns: (col) => ({
        id: col.increments(),
      }),
      migrations: {
        "001_multiple_raw": migrate.sequence(
          migrate.raw((builder) => builder.string("field1")),
          migrate.raw((builder) => builder.integer("field2")),
        ),
      },
    })

    expect(table).toBeInstanceOf(Table)
    expect(table.options.migrations).toBeDefined()
    expect(table.options.migrations!["001_multiple_raw"]).toBeDefined()
  })
})

describe("migration key patterns", () => {
  test("Table accepts pure numeric keys", () => {
    const table = new Table({
      name: "test_numeric_keys",
      columns: (col) => ({
        id: col.increments(),
      }),
      migrations: {
        1: migrate.raw(() => {}),
        2: migrate.raw(() => {}),
        10: migrate.raw(() => {}),
      },
    })

    expect(table.options.migrations).toBeDefined()
    expect(Object.keys(table.options.migrations!)).toEqual(["1", "2", "10"])
  })

  test("Table accepts numeric-prefixed keys", () => {
    const table = new Table({
      name: "test_prefixed_keys",
      columns: (col) => ({
        id: col.increments(),
      }),
      migrations: {
        "001_init": migrate.raw(() => {}),
        "002_add_column": migrate.raw(() => {}),
        "010_fix": migrate.raw(() => {}),
      },
    })

    expect(table.options.migrations).toBeDefined()
    expect(Object.keys(table.options.migrations!)).toEqual([
      "001_init",
      "002_add_column",
      "010_fix",
    ])
  })

  test("Table accepts pure string keys", () => {
    const table = new Table({
      name: "test_string_keys",
      columns: (col) => ({
        id: col.increments(),
      }),
      migrations: {
        init: migrate.raw(() => {}),
        add_column: migrate.raw(() => {}),
        fix: migrate.raw(() => {}),
      },
    })

    expect(table.options.migrations).toBeDefined()
    expect(Object.keys(table.options.migrations!)).toEqual(["init", "add_column", "fix"])
  })

  test("Table rejects mixed key patterns at migration time", () => {
    const table = new Table({
      name: "test_mixed_keys",
      columns: (col) => ({
        id: col.increments(),
      }),
      migrations: {
        1: migrate.raw(() => {}),
        "001_init": migrate.raw(() => {}),
        init: migrate.raw(() => {}),
      },
    })

    // The error is thrown when getMigrationKeys() is called during migration
    // This happens during make(), not during construction
    expect(() => {
      // Access private method to test key validation
      ;(table as any).getMigrationKeys()
    }).toThrow(/Migration keys use mixed patterns/)
  })
})

describe("unconnected ORM", () => {
  test("can be initialized with false", () => {
    const unconnectedOrm = new ORM(false)

    expect(unconnectedOrm).toBeInstanceOf(ORM)
    expect(unconnectedOrm.isConnected).toBe(false)
    expect(unconnectedOrm.config).toBe(false)
    expect(unconnectedOrm.handler).toBeUndefined()
    expect(unconnectedOrm.cachedTables).toEqual([])
    expect(unconnectedOrm.cachedTableNames).toEqual([])
  })

  test("throws when calling methods requiring client", async () => {
    const unconnectedOrm = new ORM(false)

    expect(() => unconnectedOrm.client).toThrow()
    expect(unconnectedOrm.init()).rejects.toThrow()
    expect(unconnectedOrm.hasTable("test")).rejects.toThrow()
    expect(() => unconnectedOrm.raw("SELECT 1")).toThrow()
    expect(unconnectedOrm.createBackup()).rejects.toThrow()
    expect(unconnectedOrm.restoreBackup()).rejects.toThrow()
  })
})

describe("extractDatabaseConfig", () => {
  test("extracts config from connection string URL", async () => {
    const result = await extractDatabaseConfig("postgres://myuser:mypass@db.example.com:5432/mydb")

    expect(result.host).toBe("db.example.com")
    expect(result.port).toBe(5432)
    expect(result.user).toBe("myuser")
    expect(result.password).toBe("mypass")
    expect(result.database).toBe("mydb")
  })

  test("extracts config from object with fields", async () => {
    const result = await extractDatabaseConfig({
      host: "10.0.0.1",
      port: 3306,
      user: "root",
      password: "secret",
      database: "app",
    })

    expect(result.host).toBe("10.0.0.1")
    expect(result.port).toBe(3306)
    expect(result.user).toBe("root")
    expect(result.password).toBe("secret")
    expect(result.database).toBe("app")
  })

  test("supports async password function", async () => {
    const result = await extractDatabaseConfig({
      host: "localhost",
      port: 5432,
      user: "admin",
      password: async () => "async-secret",
    })

    expect(result.password).toBe("async-secret")
  })

  test("throws on missing config", async () => {
    expect(extractDatabaseConfig(undefined)).rejects.toThrow("Missing database configuration")
  })

  test("throws on invalid config shape", async () => {
    expect(extractDatabaseConfig({ filename: ":memory:" })).rejects.toThrow(
      "Invalid database configuration",
    )
  })

  test("throws on missing required fields", async () => {
    expect(
      extractDatabaseConfig({
        host: "localhost",
        port: 5432,
        user: "admin",
        password: "",
      }),
    ).rejects.toThrow("Missing password")
  })
})

describe("SSH tunneling", () => {
  const sshEnvPath = path.join(process.cwd(), "tests", ".ssh.env")

  let sshConfig: { host: string; port: number; username: string; password: string } | undefined

  beforeAll(() => {
    if (!fs.existsSync(sshEnvPath)) return

    const env = Object.fromEntries(
      fs
        .readFileSync(sshEnvPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => line.split("=")),
    )

    sshConfig = {
      host: env.SSH_HOST,
      port: Number(env.SSH_PORT),
      username: env.SSH_USERNAME,
      password: env.SSH_PASSWORD,
    }
  })

  test("ORM with SSH config defers client initialization", () => {
    const sshOrm = new ORM({
      tableLocation: path.join(process.cwd(), "tests", "tables"),
      database: {
        client: "pg",
        connection: "postgres://user:pass@db-host:5432/mydb",
      },
      ssh: {
        host: "ssh-host",
        port: 22,
        username: "user",
        password: "pass",
      },
    })

    expect(sshOrm).toBeInstanceOf(ORM)
    expect(sshOrm._client).toBeUndefined()
    expect(sshOrm.isConnected).toBe(false)
    expect(sshOrm.handler).toBeDefined()
  })

  test("ORM without SSH config initializes client immediately", () => {
    const noSshOrm = new ORM({
      tableLocation: path.join(process.cwd(), "tests", "tables"),
    })

    expect(noSshOrm._client).toBeDefined()
    expect(noSshOrm.isConnected).toBe(true)
  })

  test("ORM.init() with SSH rejects when SSH server is unreachable", async () => {
    const sshOrm = new ORM({
      tableLocation: path.join(process.cwd(), "tests", "tables"),
      database: {
        client: "pg",
        connection: "postgres://user:pass@db-host:5432/mydb",
      },
      ssh: {
        host: "127.0.0.1",
        port: 1, // port 1 should get ECONNREFUSED immediately
        username: "user",
        password: "pass",
      },
    })

    expect(sshOrm.init()).rejects.toThrow()
  })

  test("tunnel property is undefined before init()", () => {
    const sshOrm = new ORM({
      tableLocation: path.join(process.cwd(), "tests", "tables"),
      database: {
        client: "pg",
        connection: "postgres://user:pass@db-host:5432/mydb",
      },
      ssh: {
        host: "ssh-host",
        port: 22,
        username: "user",
        password: "pass",
      },
    })

    expect(sshOrm.tunnel).toBeUndefined()
  })

  test("SSH config is correctly stored in ORM config", () => {
    const ssh = {
      host: "bastion.example.com",
      port: 2222,
      username: "deploy",
      password: "s3cur3",
    }

    const sshOrm = new ORM({
      tableLocation: path.join(process.cwd(), "tests", "tables"),
      ssh,
    })

    expect((sshOrm.config as ORMConfig).ssh).toEqual(ssh)
  })

  test("extractDatabaseConfig parses connection for SSH forwarding", async () => {
    if (!sshConfig) return

    const dbConfig = await extractDatabaseConfig("postgres://user:pass@remote-db:5432/appdb")

    expect(dbConfig.host).toBe("remote-db")
    expect(dbConfig.port).toBe(5432)
    expect(dbConfig.user).toBe("user")
    expect(dbConfig.password).toBe("pass")
    expect(dbConfig.database).toBe("appdb")
  })
})

const orm = new ORM({
  tableLocation: path.join(process.cwd(), "tests", "tables"),
  backups: {
    location: path.join(process.cwd(), "backups"),
  },
})

beforeAll(async () => {
  await orm.init()
})

describe("table management", () => {
  test("tables created", async () => {
    expect(await orm.hasTable("migration")).toBeTruthy()
    expect(await orm.hasTable("a")).toBeTruthy()
    expect(await orm.hasTable("b")).toBeTruthy()
    expect(await orm.hasTable("c")).toBeTruthy()
    expect(await orm.hasTable("d")).toBeTruthy()
  })

  test("table cached", () => {
    expect(orm.hasCachedTable("migration")).toBeTruthy()
    expect(orm.hasCachedTable("a")).toBeTruthy()
    expect(orm.hasCachedTable("b")).toBeTruthy()
    expect(orm.hasCachedTable("c")).toBeTruthy()
    expect(orm.hasCachedTable("d")).toBeTruthy()
  })

  test("table migrations ran", async () => {
    expect(await b.hasColumn("c_id")).toBeTruthy()
  })

  test("table then ran", async () => {
    const rows = await a.query.select()
    expect(rows.length).toBe(1)
  })

  test("typed table d was created with correct columns", async () => {
    expect(await d.hasColumn("id")).toBeTruthy()
    expect(await d.hasColumn("name")).toBeTruthy()
    expect(await d.hasColumn("email")).toBeTruthy()
    expect(await d.hasColumn("age")).toBeTruthy()
    expect(await d.hasColumn("role")).toBeTruthy()
    expect(await d.hasColumn("isActive")).toBeTruthy()
    expect(await d.hasColumn("metadata")).toBeTruthy()
    expect(await d.hasColumn("createdAt")).toBeTruthy()
  })

  test("typed table d then ran", async () => {
    const rows = await d.query.select()
    expect(rows.length).toBe(1)
    expect(rows[0].name).toBe("Test User")
    expect(rows[0].role).toBe("admin")
  })
})

describe("table column types", () => {
  test("increments", async () => {
    const info = await orm.client!("a").columnInfo("id")
    expect(info.type).toMatch(/^int/)
  })

  test("integer", async () => {
    const info = await orm.client!("a").columnInfo("b_id")
    expect(info.type).toMatch(/^int/)
  })

  test("typed table d column types", async () => {
    const nameInfo = await orm.client!("d").columnInfo("name")
    expect(nameInfo.type).toMatch(/varchar|text|character/i)

    const ageInfo = await orm.client!("d").columnInfo("age")
    expect(ageInfo.type).toMatch(/^int/)
    expect(ageInfo.nullable).toBe(true)
  })
})

describe("database extraction", () => {
  test("create backup", async () => {
    await orm.createBackup()

    const config = orm.config as ORMConfig
    expect(fs.existsSync(path.join(config.backups!.location!, "a_chunk_0.csv"))).toBeTruthy()
    expect(fs.existsSync(path.join(config.backups!.location!, "b_chunk_0.csv"))).toBeTruthy()
    expect(fs.existsSync(path.join(config.backups!.location!, "c_chunk_0.csv"))).toBeTruthy()
    expect(fs.existsSync(path.join(config.backups!.location!, "d_chunk_0.csv"))).toBeTruthy()
  })

  test("cascade delete", async () => {
    expect(await a.isEmpty()).toBeFalsy()
    await c.query.del()
    expect(await a.isEmpty()).toBeTruthy()
  })

  test("restore backup", async () => {
    await orm.restoreBackup()

    expect(await a.isEmpty()).toBeFalsy()
    expect(await b.isEmpty()).toBeFalsy()
    expect(await c.isEmpty()).toBeFalsy()
    expect(await d.isEmpty()).toBeFalsy()
  })

  afterAll(async () => {
    const config = orm.config as ORMConfig
    await rimraf(config.backups!.location!)
  })
})

describe("table getters", () => {
  test("table info", async () => {
    expect(await a.getColumnNames()).toContain("id")
    expect(await a.getColumnNames()).toContain("b_id")

    expect(await b.getColumnNames()).toContain("id")
    expect(await b.getColumnNames()).toContain("c_id")

    expect(await c.getColumnNames()).toContain("id")

    expect(await d.getColumnNames()).toContain("id")
    expect(await d.getColumnNames()).toContain("name")
    expect(await d.getColumnNames()).toContain("role")
  })

  test("table names", () => {
    expect(orm.cachedTableNames).toContain("a")
    expect(orm.cachedTableNames).toContain("b")
    expect(orm.cachedTableNames).toContain("c")
    expect(orm.cachedTableNames).toContain("d")
  })
})

describe("data caching", () => {
  beforeAll(async () => {
    await c.query.del()
    await c.query.insert([{ id: 1 }, { id: 2 }, { id: 3 }])
    await b.query.insert([
      { id: 1, c_id: 1 },
      { id: 2, c_id: 2 },
      { id: 3, c_id: 3 },
    ])
    await a.query.insert([
      { id: 1, b_id: 1 },
      { id: 2, b_id: 2 },
      { id: 3, b_id: 3 },
    ])
  })

  test("select with caching", async () => {
    const rows = await a.cache.get("all a", (query) => {
      return query.select("*")
    })

    expect(rows.length).toBe(3)
  })

  test("insert with caching", async () => {
    await a.cache.set((query) => {
      return query.insert({ id: 4, b_id: 1 })
    })

    expect(await a.cache.count()).toBe(4)
  })

  test("update with caching", async () => {
    await a.cache.set((query) => {
      return query.update({ b_id: 3 }).where({ id: 1 })
    })

    const row = await a.cache.get("a 1", (query) => {
      return query.select("b_id").where({ id: 1 }).first()
    })

    expect(row!.b_id).toBe(3)
  })

  test("delete with caching", async () => {
    await a.cache.set((query) => {
      return query.delete().where({ id: 1 })
    })

    expect(await a.cache.count()).toBe(3)
  })

  test("cache invalidation", async () => {
    expect(await a.cache.count()).toBe(3)

    await a.query.insert({ id: 5, b_id: 1 })

    expect(await a.cache.count()).toBe(3)

    orm.cache.invalidate()

    expect(await a.cache.count()).toBe(4)
  })
})

afterAll(async () => {
  await orm.client!.schema.dropTable("migration")
  await orm.client!.schema.dropTable("a")
  await orm.client!.schema.dropTable("b")
  await orm.client!.schema.dropTable("c")
  await orm.client!.schema.dropTable("d")
  await orm.client!.destroy()
})
