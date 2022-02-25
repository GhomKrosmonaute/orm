const path = require("path")
const { ORM } = require("../dist/index")

test("init", (done) => {
  new ORM({
    tablePath: path.join(__dirname, "files"),
    verbose: true,
  })
    .init()
    .then(done)
    .catch(done)
})
