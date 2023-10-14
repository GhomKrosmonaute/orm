import dotenv from "dotenv"
import path from "path"
import fs from "fs"

dotenv.config({ path: "./.env" })

import { ORM } from "../"

import a from "./tables/a"
import b from "./tables/b"
import c from "./tables/c"

const orm = new ORM({
  location: path.join("tests", "tables"),
})

beforeAll(async () => {
  await orm.init()
})

describe("table management", () => {
  test("tables created", async () => {
    expect(await orm.database.schema.hasTable("migration")).toBeTruthy()
    expect(await orm.database.schema.hasTable("a")).toBeTruthy()
    expect(await orm.database.schema.hasTable("b")).toBeTruthy()
    expect(await orm.database.schema.hasTable("c")).toBeTruthy()
  })

  test("migrations ran", async () => {
    expect(await orm.database.schema.hasColumn("b", "c_id")).toBeTruthy()
  })

  test("then ran", async () => {
    const rows = await orm.database("a").select()

    expect(rows.length).toBe(1)
  })

  test("cascade delete", async () => {
    await c.query.del()

    expect(await a.isEmpty()).toBeTruthy()
  })
})

describe("table column types", () => {
  test("increments", async () => {
    expect(
      await orm
        .database("a")
        .columnInfo("id")
        .then((info) => info.type)
    ).toBe("integer")
  })

  test("integer", async () => {
    expect(
      await orm
        .database("a")
        .columnInfo("b_id")
        .then((info) => info.type)
    ).toBe("integer")
  })
})

describe("database migration", () => {
  beforeAll(async () => {
    await c.query.insert({ id: 0 })
    await b.query.insert({
      id: 0,
      c_id: 0,
    })
    await a.query.insert({
      id: 0,
      b_id: 0,
    })
  })

  test("extract CSV", async () => {
    await orm.extract()

    expect(fs.existsSync("a.csv")).toBeTruthy()
    expect(fs.existsSync("b.csv")).toBeTruthy()
    expect(fs.existsSync("c.csv")).toBeTruthy()
  })

  test("empty tables", async () => {
    await a.query.del()
    await b.query.del()
    await c.query.del()

    expect(await a.isEmpty()).toBeTruthy()
    expect(await b.isEmpty()).toBeTruthy()
    expect(await c.isEmpty()).toBeTruthy()
  })

  test("import CSV", async () => {
    await orm.import()

    expect(await a.isEmpty()).toBeFalsy()
    expect(await b.isEmpty()).toBeFalsy()
    expect(await c.isEmpty()).toBeFalsy()
  })
})

afterAll(async () => {
  await orm.database.destroy()
  fs.unlinkSync("a.csv")
  fs.unlinkSync("b.csv")
  fs.unlinkSync("c.csv")
})
