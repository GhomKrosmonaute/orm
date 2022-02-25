const { Table } = require("../../dist/index")

module.exports = new Table({
  name: "a",
  priority: 0,
  setup: (table) => {
    table.increments("id").primary()
    table.integer("b_id").references("id").inTable("b").notNullable()
  },
})
