import dotenv from "dotenv/config.js"
import c from "./tables/c.js"
import b from "./tables/b.js"
import a from "./tables/a.js"
import { ORM } from "../../dist/esm/index.js"
import path from "path"

const orm = new ORM({
  tablePath: path.join(__dirname, "tables"),
  logger: console,
})

beforeAll(async () => {
  await orm.init()
})

test("tables created", async () => {
  expect(await orm.db.schema.hasTable("migration")).toBeTruthy()
  expect(await orm.db.schema.hasTable("a")).toBeTruthy()
  expect(await orm.db.schema.hasTable("b")).toBeTruthy()
  expect(await orm.db.schema.hasTable("c")).toBeTruthy()
})

test("migrations ran", async () => {
  expect(await orm.db.schema.hasColumn("b", "c_id")).toBeTruthy()
})

test("then ran", async () => {
  const rows = await orm.db("a").select()
  expect(rows.length).toBe(1)
})

test("cascade delete", async () => {
  await c.query.del()
  expect(await a.isEmpty()).toBeTruthy()
})

afterAll(async () => {
  await orm.db.destroy()
})
