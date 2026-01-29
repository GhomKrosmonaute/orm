import { Table } from "../../src"

export default new Table({
  name: "c",
  priority: 2,
  columns: (col) => ({
    id: col.increments(),
  }),
  async then({ query }) {
    await query.insert({
      id: 1,
    })
  },
})
