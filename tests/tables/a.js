const { Table } = require("../../dist/index")

module.exports = new Table({
  name: "a",
  priority: 0,
  setup(table) {
    table.increments("id").primary().notNullable()
    table
      .integer("b_id")
      .references("id")
      .inTable("b")
      .onDelete("cascade")
      .notNullable()
  },
  async then({ query }) {
    await query.insert({
      id: 0,
      b_id: 0,
    })
  },
})
