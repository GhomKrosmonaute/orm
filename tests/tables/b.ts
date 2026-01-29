import { Table } from "../../src"

export default new Table({
  name: "b",
  priority: 1,
  columns: (col) => ({
    id: col.increments(),
    c_id: col.integer().unsigned().references("id").inTable("c").onDelete("CASCADE"),
  }),
  async then({ query }) {
    await query.insert({
      id: 1,
      c_id: 1,
    })
  },
})
