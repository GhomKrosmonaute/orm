import dotenv from "dotenv"
import path from "path"

dotenv.config({ path: "./.env" })

import { ORM } from "../"

import a from "./tables/a"
import b from "./tables/b"
import c from "./tables/c"

const orm = new ORM({
  location: path.join("tests","tables")
})

beforeAll(async () => {
  await orm.init()
})

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

afterAll(async () => {
  await orm.database.destroy()
})
