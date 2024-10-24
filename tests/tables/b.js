import { Table } from "../.."

/**
 * @type {Table<{ id: number; c_id: number }>}
 */
export default new Table({
  name: "b",
  migrations: {
    0: (table) =>
      table
        .integer("c_id")
        .unsigned()
        .references("id")
        .inTable("c")
        .onDelete("cascade")
        .notNullable(),
  },
  priority: 1,
  setup(table) {
    table.increments("id").primary().notNullable()
  },
  async then({ query }) {
    await query.insert({
      id: 1,
      c_id: 1,
    })
  },
})
