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
  
  // knex config (sqlite3 in-memory by default)
  database: { client: "sqlite3", connection: { filename: ":memory:" } },
  
  // optional custom logger (must have log, error, warn methods)
  logger: console,
  loggerStyles: { highlight: "cyan", rawValue: "yellow", description: "dim" },
  
  // caching options for all tables and rawCache queries (default to Infinity)
  caching: 10 * 60 * 1000,

  // configuration for the database backups
  backups: {
    location: "./backups",
    chunkSize: 1000, // rows per backup file chunk
  },

  // migration behavior configuration
  migrations: {
    alphabeticalOrder: false // default
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

import { Table, col, migrate } from "@ghom/orm"

export default new Table({
  name: "user",
  
  // optional description for logging
  description: "User accounts",
  
  // the higher the priority, the earlier the table is compiled
  priority: 0,
  
  // typed columns definition with automatic type inference
  columns: (col) => ({
    id: col.increments(),
    username: col.string().unique(),
    password: col.string(),
    age: col.integer().nullable(),
    role: col.enum(["admin", "user"] as const).defaultTo("user"),
  }),
  
  // migrations are executed in order based on key pattern (see Migration Keys section)
  migrations: {
    "001_add_email": migrate.addColumn("email", col.string()),
  },
  
  // then is executed after the table is created and the migrations are run (only if table is empty)
  then: (table) => {
    table.query.insert({ username: "admin", password: "admin", role: "admin", email: "admin@admin.com" })
  },
  
  caching: 10 * 60 * 1000 // The table cache. Default to the ORM cache or Infinity
})
```

The type is automatically inferred from columns + migrations:

```typescript
// { id: number; username: string; password: string; age: number | null; role: "admin" | "user"; email: string }
```

You can export and use the type from another file:

```typescript
// somewhere else in your code
import userTable from "./tables/user"

type User = typeof userTable.$type
```

## Column Types

All available column types with their TypeScript types:

```typescript
import { col } from "@ghom/orm"

// Numeric types
col.increments()       // number - auto-incrementing primary key
col.bigIncrements()    // bigint - big auto-incrementing primary key
col.integer()          // number
col.bigInteger()       // bigint
col.tinyint()          // number (0-255)
col.smallint()         // number
col.mediumint()        // number
col.float(precision?, scale?)    // number
col.double(precision?, scale?)   // number
col.decimal(precision?, scale?)  // number

// String types
col.string(length?)    // string (default: 255)
col.text(textType?)    // string - "text" | "mediumtext" | "longtext"
col.uuid()             // string

// Boolean
col.boolean()          // boolean

// Date/Time types
col.date()             // Date
col.datetime(options?) // Date - { useTz?: boolean; precision?: number }
col.timestamp(options?) // Date - { useTz?: boolean; precision?: number }
col.time()             // string

// Other types
col.binary(length?)    // Buffer
col.enum(values)       // union of values - col.enum(["a", "b"] as const) => "a" | "b"
col.json<T>()          // T (default: unknown)
col.jsonb<T>()         // T (PostgreSQL)
col.specificType<T>(type) // T - database-specific type
```

### Column Modifiers

```typescript
col.string()
  .nullable()           // allows null values
  .defaultTo(value)     // sets default value
  .unique()             // adds unique constraint
  .primary()            // sets as primary key
  .index(indexName?)    // adds an index
  .comment(comment)     // adds a column comment
  .collate(collation)   // sets collation

col.integer()
  .unsigned()           // only positive values (numeric columns only)
```

### Foreign Key References

```typescript
col.integer()
  .references("id")           // column name in referenced table
  .inTable("users")           // referenced table name
  .onDelete("CASCADE")        // CASCADE | SET NULL | RESTRICT | NO ACTION
  .onUpdate("CASCADE")        // CASCADE | SET NULL | RESTRICT | NO ACTION
```

## Typed Migrations

Use typed migrations that automatically update the TypeScript type:

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

### Migration Helpers

- `migrate.addColumn(name, columnDef)` - Add a new column
- `migrate.dropColumn(name)` - Remove a column
- `migrate.renameColumn(oldName, newName)` - Rename a column
- `migrate.alterColumn(name, newColumnDef)` - Change column type/constraints
- `migrate.addIndex(columns, name?)` - Add an index
- `migrate.dropIndex(name)` - Remove an index
- `migrate.addUnique(columns, name?)` - Add a unique constraint
- `migrate.dropUnique(name)` - Remove a unique constraint
- `migrate.raw<From, To>(callback)` - Custom migration callback
- `migrate.sequence(...migrations)` - Combine multiple migrations

### Migration Sequences

Use `migrate.sequence()` to combine multiple migrations in a single migration key:

```typescript
migrations: {
  "001_user_updates": migrate.sequence(
    migrate.addColumn("phone", col.string()),
    migrate.addColumn("address", col.string().nullable()),
    migrate.addIndex(["phone"], "idx_phone"),
    migrate.renameColumn("name", "username"),
  ),
}
```

Intermediate columns (added then removed in the sequence) are excluded from the final type automatically.

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
You can launch a SQL query on a table like this:

```typescript
import userTable from "./tables/user"

export async function compareHash(username: string, hash: string): Promise<boolean> {
  const user = await userTable.query
    .select()
    .where("username", username)
    .first()

  return user !== undefined && user.password === hash
}
```

### Table Utilities

```typescript
// Check if a column exists
await table.hasColumn("email") // boolean

// Get column info
await table.getColumn("email") // Knex.ColumnInfo

// Get all columns info
await table.getColumns() // Record<string, Knex.ColumnInfo>

// Get column names
await table.getColumnNames() // string[]

// Check if table is empty
await table.isEmpty() // boolean

// Count rows
await table.count() // number
await table.count("status = 'active'") // number with where clause
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
await table.cache.count("status = 'active'") // with where clause

// add a row with caching (automatically invalidates cache)
await table.cache.set((query) => {
  return query.insert({ name: "test" })
})

await table.cache.count() // => 11

// Get data with caching.
// After the first call, the result is cached until
// the cache is invalidated by a "cache.set" or "cache.invalidate" call
await table.cache.get("all users", (query) => {
  return query.select("*")
}) // => [{ name: "test" }, ...]

// delete the row without caching
await table.query.delete().where("name", "test")

await table.cache.count() // => 11 (unchanged - cache not invalidated)

// manually invalidate cache
table.cache.invalidate()

await table.cache.count() // => 10
await table.cache.count() // => 10 (no more query to the database)

// update with caching (automatically invalidates cache)
await table.cache.set((query) => {
  return query.update({ status: "inactive" }).where("id", 1)
})

// remove all rows from a table with caching
await table.cache.set((query) => {
  return query.truncate()
})

await table.cache.count() // => 0
```

> ⚠️ For a cache-style usage, you should use the `cache` property for all your queries. If you use the `query` property, the cache will not be updated, and it will cause a cache inconsistency.

### Raw cache

You can also cache raw queries with the `<ORM>.cache.raw` method. The raw cache is useful when you have a complex query that you want to cache.

```typescript
const fooUser = await orm.cache.raw("select * from user where name = 'foo'") // query the database
const barUser = await orm.cache.raw("select * from user where name = 'bar'") // query the database
const fooUserCached = await orm.cache.raw("select * from user where name = 'foo'") // cached - no query

// To invalidate the cache when you know data has changed externally:
const result = await orm.cache.raw("select * from user", true) // anyDataUpdated = true
```

The raw cache is invalidated when:
- You call `orm.cache.invalidate()`
- You use `table.cache.set()` to modify data
- You pass `true` as the second argument to `orm.cache.raw()`

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
