import { Table } from "../.."

/**
 * @type {Table<{ id: number; b_id: number }>}
 */
export default new Table({
  name: "a",
  priority: 0,
  setup(table) {
    table.increments("id").primary().notNullable()
    table
      .integer("b_id")
      .unsigned()
      .references("id")
      .inTable("b")
      .onDelete("cascade")
      .notNullable()
  },
  async then({ query }) {
    await query.insert({
      id: 1,
      b_id: 1,
    })
  },
})
