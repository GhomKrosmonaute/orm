# TypeScript KnexJS ORM & handler

## Install

```bash
npm install @ghom/orm
```

## Usage

```typescript
import { ORM } from "@ghom/orm"

const orm = new ORM({
  // tables directory
  lcoation: "./tables",
  
  // knex config (sqlite3 by default)
  database: { ... },
  
  // custom logger (console by default)
  logger: console,
  loggerColors: { ... }
})

// start handling of tables
await orm.init()
```

## Add tables

The tables are automatically loaded from the `location` directory.

```typescript
// tables/user.ts

import { Table } from "@ghom/orm"

interface User {
  username: string
  password: string
}

export default new Table<User>({
  name: "user",
  
  // the higher the priority, the earlier the table is compiled
  priority: 0,
  
  // the migration are executed in order of version number
  migrations: {
    1: (table) => {
      table.renameColumn("name", "username")
    }
  },
  
  // the setup is executed only once for table creation
  setup: (table) => {
    table.string("name").notNullable()
    table.string("password").notNullable()
  },
  
  // the then is executed after the table is created and the migrations are runned
  then: ({ query }) => {
    query.insert({ username: "admin", password: "admin" })
  }
})
```

## Launch a query

For more information about the query builder, see [knexjs.org](https://knexjs.org/).  
You can launch a SQL query on a table like that

```typescript
import user from "./tables/user"

export async function compareHash(username, hash): Promise<boolean> {
  const user = await user.query
    .select()
    .where("username", username)
    .first()

  return user && user.password === hash
}
```

## Future features

- [ ] Take full control of the table creation
- [ ] Add backup option
- [ ] Add admin panel
- [ ] Add shortcuts for advanced relative queries
- [ ] Add timed caching system
- [ ] Make possible to switch the data between all possible clients (pg, mysql, sqlite3)
- [ ] Add a way to set up timezone directly in the ORM constructor