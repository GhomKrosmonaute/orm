const { Table } = require("../../dist/index")

module.exports = new Table({
  name: "c",
  priority: 2,
  setup: (table) => {
    table.increments("id").primary()
  },
})
