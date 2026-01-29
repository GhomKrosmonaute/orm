import { Table } from "../../src"

export default new Table({
  name: "a",
  priority: 0,
  columns: (col) => ({
    id: col.increments(),
    b_id: col.integer().unsigned().references("id").inTable("b").onDelete("CASCADE"),
  }),
  async then({ query }) {
    await query.insert({
      id: 1,
      b_id: 1,
    })
  },
})
