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
```

## Tables

The tables are automatically loaded from the `location` directory.

```typescript
// tables/user.ts

import { Table } from "@ghom/orm"

export default new Table({
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

## Query

For more information about the query builder, see [knexjs.org](https://knexjs.org/).

## Import/extract

You can transfer the data from one instance of the ORM to another (between two database clients, for example between "pg" and "mysql2").

```typescript
await orm1.extract()
```

```typescript
await orm2.import()
```

The SQL structure isn't transferred, only the data. You must copy the table files to the other project.