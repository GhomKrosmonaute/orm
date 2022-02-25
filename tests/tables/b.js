const { Table } = require("../../dist/index")

module.exports = new Table({
  name: "b",
  migrations: {
    0: (table) =>
      table.integer("c_id").references("id").inTable("c").notNullable(),
  },
  priority: 1,
  setup: (table) => {
    table.increments("id").primary()
  },
})
