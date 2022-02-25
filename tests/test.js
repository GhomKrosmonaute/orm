const path = require("path")
const { ORM } = require("../dist/index")

const orm = new ORM({
  tablePath: path.join(__dirname, "tables"),
  verbose: false,
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

afterAll(async () => {
  await orm.db.destroy()
})
