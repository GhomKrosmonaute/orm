import dotenv from "dotenv"
import { rimraf } from "rimraf"
import path from "path"
import fs from "fs"

dotenv.config({
  // path: path.join(process.cwd(), "tests", ".pg.env"),
  // path: path.join(process.cwd(), "tests", ".mysql2.env"),
})

process.env.DEBUG = "knex*"

import { ORM } from "../"

import a from "./tables/a"
import b from "./tables/b"
import c from "./tables/c"

const orm = new ORM({
  tableLocation: path.join(process.cwd(), "tests", "tables"),
  backups: {
    location: path.join(process.cwd(), "backups"),
  },
  database: process.env.DB_CLIENT && {
    client: process.env.DB_CLIENT,
    connection: process.env.DB_CONNECTION,
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
  })

  test("table cached", async () => {
    expect(orm.hasCachedTable("migration")).toBeTruthy()
    expect(orm.hasCachedTable("a")).toBeTruthy()
    expect(orm.hasCachedTable("b")).toBeTruthy()
    expect(orm.hasCachedTable("c")).toBeTruthy()
  })

  test("table migrations ran", async () => {
    expect(await b.hasColumn("c_id")).toBeTruthy()
  })

  test("table then ran", async () => {
    const rows = await a.query.select()

    expect(rows.length).toBe(1)
  })
})

describe("table column types", () => {
  test("increments", async () => {
    expect(
      await orm
        .database("a")
        .columnInfo("id")
        .then((info) => info.type),
    ).toMatch(/^int/)
  })

  test("integer", async () => {
    expect(
      await orm
        .database("a")
        .columnInfo("b_id")
        .then((info) => info.type),
    ).toMatch(/^int/)
  })
})

describe("database extraction", () => {
  test("create backup", async () => {
    await orm.createBackup()

    expect(
      fs.existsSync(path.join(orm.config.backups.location, "a_chunk_0.csv")),
    ).toBeTruthy()
    expect(
      fs.existsSync(path.join(orm.config.backups.location, "b_chunk_0.csv")),
    ).toBeTruthy()
    expect(
      fs.existsSync(path.join(orm.config.backups.location, "c_chunk_0.csv")),
    ).toBeTruthy()
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
  }, 10_000)

  afterAll(async () => {
    await rimraf(orm.config.backups.location)
  })
})

describe("table getters", () => {
  test("table info", async () => {
    expect(await a.getColumnNames()).toContain("id")
    expect(await a.getColumnNames()).toContain("b_id")

    expect(await b.getColumnNames()).toContain("id")
    expect(await b.getColumnNames()).toContain("c_id")

    expect(await c.getColumnNames()).toContain("id")
  })

  test("table names", async () => {
    expect(orm.cachedTableNames).toContain("a")
    expect(orm.cachedTableNames).toContain("b")
    expect(orm.cachedTableNames).toContain("c")
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

    expect(row.b_id).toBe(3)
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
  await orm.database.schema.dropTable("migration")
  await orm.database.schema.dropTable("a")
  await orm.database.schema.dropTable("b")
  await orm.database.schema.dropTable("c")
  await orm.database.destroy()
})
