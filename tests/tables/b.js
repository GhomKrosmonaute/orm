import { Table } from "../.."

export default new Table({
  name: "b",
  migrations: {
    0: (table) =>
      table
        .integer("c_id")
        .references("id")
        .inTable("c")
        .onDelete("cascade")
        .notNullable()
  },
  priority: 1,
  setup(table) {
    table.increments("id").primary().notNullable()
  },
  async then({ query }) {
    await query.insert({
      id: 0,
      c_id: 0,
    })
  },
})
