import { Table } from "../.."

export default new Table({
  name: "c",
  priority: 2,
  setup(table) {
    table.increments("id").primary().notNullable()
  },
  async then({ query }) {
    await query.insert({ id: 0 })
  },
})
