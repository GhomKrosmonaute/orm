const { Table } = require("../../../dist/cjs")

module.exports = new Table({
  name: "c",
  priority: 2,
  setup(table) {
    table.increments("id").primary().notNullable()
  },
  async then({ query }) {
    await query.insert({ id: 0 })
  },
})