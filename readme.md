# @ghom/orm

### TypeScript Knex ORM & table handler including a backup system and a cache.

![test workflow badge](https://github.com/GhomKrosmonaute/orm/actions/workflows/test.yml/badge.svg)

> Compatible with [PostgreSQL](https://www.npmjs.com/package/pg), [MySQL](https://www.npmjs.com/package/mysql2), and [SQLite](https://www.npmjs.com/package/sqlite3).

## Install

```bash
npm install @ghom/orm
```

## Usage

```typescript
import { ORM } from "@ghom/orm"

const orm = new ORM({
  // tables directory
  tableLocation: "./tables",
  
  // knex config (sqlite3 by default)
  database: { ... },
  
  // custom logger (console by default)
  logger: console,
  loggerColors: { ... },
  
  // caching options for all tables and rawCache queries (default to Infinity)
  caching: 10 * 60 * 1000,

  // configuration for the database backups
  backups: {
    location: "./backups",
  }
})

// start handling of tables
await orm.init()
```

### Unconnected ORM

You can also create an ORM instance without connecting to a database. This is useful when you only need to export types or prepare the ORM structure for a future database connection.

```typescript
import { ORM } from "@ghom/orm"

const orm = new ORM(false)

orm.isConnected // false
orm.cachedTables // []
orm.cachedTableNames // []

// Methods requiring a database connection will throw an error
orm.init() // throws Error
orm.hasTable("user") // throws Error
orm.raw("SELECT 1") // throws Error
```

## Add tables

The tables are automatically loaded from the `tableLocation` directory. Types are automatically inferred from the column definitions.

```typescript
// tables/user.ts

import { Table, col } from "@ghom/orm"

export default new Table({
  name: "user",
  
  // the higher the priority, the earlier the table is compiled
  priority: 0,
  
  // typed columns definition with automatic type inference
  columns: (col) => ({
    id: col.increments(),
    username: col.string().unique(),
    password: col.string(),
    age: col.integer().nullable(),
    role: col.enum(["admin", "user"]).defaultTo("user"),
  }),
  
  // migrations are executed in order based on key pattern (see Migration Keys section)
  migrations: {
    "1": (table) => {
      table.renameColumn("name", "username")
    }
  },
  
  // then is executed after the table is created and the migrations are run (only if table is empty)
  then: ({ query }) => {
    query.insert({ username: "admin", password: "admin", role: "admin" })
  },
  
  caching: 10 * 60 * 1000 // The table cache. Default to the ORM cache or Infinity
})

// Type is automatically inferred:
// { id: number; username: string; password: string; age: number | null; role: "admin" | "user" }
type User = typeof userTable.$type
```

### Typed Migrations

You can also use typed migrations that automatically update the TypeScript type:

```typescript
import { Table, col, migrate } from "@ghom/orm"

export default new Table({
  name: "user",
  columns: (col) => ({
    id: col.increments(),
    name: col.string(),  // will be renamed to username
  }),
  migrations: {
    "001_rename_name": migrate.renameColumn("name", "username"),
    "002_add_email": migrate.addColumn("email", col.string()),
    "003_add_age": migrate.addColumn("age", col.integer().nullable()),
  },
})

// Final type: { id: number; username: string; email: string; age: number | null }
```

Available migration helpers:
- `migrate.addColumn(name, columnDef)` - Add a new column
- `migrate.dropColumn(name)` - Remove a column
- `migrate.renameColumn(oldName, newName)` - Rename a column
- `migrate.alterColumn(name, newColumnDef)` - Change column type/constraints
- `migrate.addIndex(columns, name?)` - Add an index
- `migrate.dropIndex(name)` - Remove an index
- `migrate.addUnique(columns, name?)` - Add a unique constraint
- `migrate.dropUnique(name)` - Remove a unique constraint
- `migrate.raw(callback)` - Custom migration callback

## Migration Keys

The ORM supports three patterns for migration keys:

1. **Numeric keys** (`"1"`, `"2"`, `"10"`): Sorted numerically
2. **Numeric-prefixed keys** (`"001_init"`, `"002_add_users"`, `"010_fix"`): Sorted by numeric prefix
3. **Pure string keys** (`"init"`, `"add_users"`): Uses insertion order (ES2015+)

> **Warning**: Mixing key patterns is not allowed and will throw an error at runtime.

### Migration Configuration

```typescript
const orm = new ORM({
  tableLocation: "./tables",
  migrations: {
    /**
     * NOT RECOMMENDED
     * Force alphabetical sorting for string migration keys.
     * 
     * If your keys start with numbers (e.g., "001_init"), 
     * they are automatically sorted by those numbers, 
     * not alphabetically.
     */
    alphabeticalOrder: false // default
  }
})
```

### ES2015+ Requirement

This ORM requires ES2015+ for guaranteed object key insertion order. Node.js 6+ and all modern browsers are supported.

The ORM performs a runtime check on initialization and will throw an error if the environment doesn't support ES2015+ key ordering.

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

## Backup

You can backup the database by calling the `createBackup` and `restoreBackup` methods on the ORM instance. The backup is stored in the `config.backups.location` directory.

```typescript
await orm.createBackup() // on the root backup directory (not recommended)
await orm.createBackup("2021-01-01T00:00:00.000Z") // with dirname as backup ID

await orm.restoreBackup()
await orm.restoreBackup("2021-01-01T00:00:00.000Z")
```

## Caching

The cache is automatically managed by the ORM. When a table is requested from the `<Table>.cache` property, the ORM will automatically use caching for all your queries. The cache is useful when you have a lot of requests on the same table, and you don't want to query the database every time.

```typescript
// get the number of rows in the table with caching
await table.cache.count() // => 10

// add a row with caching
await table.cache.set((query) => {
  return query.insert({ name: "test" })
})

await table.cache.count() // => 11

// Get the row with caching.
// After the first call, the row is cached until
// the cache is invalidate by a "cache.set" or "cache.invalidate" call
await table.cache.get("named test", (query) => {
  return query.where("name", "test").first()
}) // => { name: "test" }

// delete the row without caching
await table.query.delete().where("name", "test")

await table.cache.count() // => 11 (unchanged)

// indicate that the cache is invalidate
// and force the cache to be updated
table.cache.invalidate()

await table.cache.count() // => 10
await table.cache.count() // => 10 (no more query to the database)

// remove all rows from a table with caching
await table.cache.set((query) => {
  return query.truncate()
})

await table.cache.count() // => 0
```

> ⚠️ For a cache-style usage, you should use the `cache` property for all your queries. If you use the `query` property, the cache will not be updated, and it will cause a cache inconsistency.

### Raw cache

You can also cache raw queries with the `<ORM>.cache.raw` property. The raw cache is useful when you have a complex query that you want to cache.

```typescript
const fooUser = await orm.cache.raw("select * from user where name = 'foo'") // query the database
const barUser = await orm.cache.raw("select * from user where name = 'bar'") // query the database
const fooUserCached = await orm.cache.raw("select * from user where name = 'foo'") // no query to the database
```

The cache of the `<ORM>.cache.raw` method is automatically invalidated when the database is updated.

## Future features

- [x] Add timed caching system
- [x] Add backup option
- [x] Auto typings for tables from the column definitions
- [x] Typed migrations with automatic type inference
- [ ] Dependency management between tables
- [ ] Add specific methods for relations and joins
- [ ] Add admin panel
- [ ] Make possible to switch the data between all possible clients (pg, mysql, sqlite3)
- [ ] Add a way to set up timezone directly in the ORM constructor

## Used by

[<img src="https://github.com/GhomKrosmonaute.png?size=50" width=50>](https://github.com/GhomKrosmonaute)
[<img src="https://github.com/Les-Laboratoires.png?size=50" width=50>](https://github.com/Les-Laboratoires)
[<img src="https://github.com/bot-ts.png?size=50" width=50>](https://github.com/bot-ts)
