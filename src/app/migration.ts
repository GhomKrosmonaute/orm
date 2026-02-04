import type { Knex } from "knex"
import {
  buildColumnsSchema,
  type ColumnDef,
  type InferColumns,
  type InferColumnType,
} from "./column.js"

/**
 * Represents a typed migration that transforms the table schema.
 * Carries type information about what columns are removed and added.
 *
 * @template From - The type of columns being removed/modified
 * @template To - The type of columns being added/modified
 */
export interface TypedMigration<From = {}, To = {}> {
  /** @internal Type marker for columns being removed */
  readonly _from: From
  /** @internal Type marker for columns being added */
  readonly _to: To
  /**
   * Apply the migration to the table builder.
   */
  apply: (builder: Knex.AlterTableBuilder) => void
}

/**
 * Represents a sequence of typed migrations.
 * Used internally by migrate.sequence() to preserve individual migration types.
 *
 * @template Migrations - Tuple of migrations in the sequence
 */
export interface TypedMigrationSequence<Migrations extends TypedMigration<any, any>[]> {
  /** @internal The individual migrations in the sequence */
  readonly __migrations__: Migrations
  /** @internal Type marker for columns being removed (computed from sequence) */
  readonly _from: SequenceFromType<Migrations>
  /** @internal Type marker for columns being added (computed from sequence) */
  readonly _to: SequenceToType<Migrations>
  /**
   * Apply all migrations in sequence to the table builder.
   */
  apply: (builder: Knex.AlterTableBuilder) => void
}

/**
 * Unwrap a migration array to get the individual migration types.
 * If M is an array, extracts the element type; otherwise returns M as-is.
 */
type UnwrapMigrationArray<M> = M extends readonly (infer U)[] ? U : M

/**
 * Extract "From" keys from a single TypedMigration or TypedMigrationSequence.
 * For sequences, excludes intermediate columns (those that are also in _to).
 */
type ExtractFromKeysSingle<M> = M extends { __migrations__: infer Migrations }
  ? Migrations extends TypedMigration<any, any>[]
    ? Exclude<
        keyof UnionToIntersection<Migrations[number]["_from"]>,
        keyof UnionToIntersection<Migrations[number]["_to"]>
      >
    : never
  : M extends TypedMigration<infer From, any>
    ? keyof From
    : never

/**
 * Extract all "From" keys from a union of TypedMigration.
 * These are the columns that will be removed/renamed.
 * Handles both single migrations and arrays of migrations.
 * Uses distributive conditional types to handle unions correctly.
 */
type ExtractFromKeys<M> = M extends any
  ? UnwrapMigrationArray<M> extends infer U
    ? U extends any
      ? ExtractFromKeysSingle<U>
      : never
    : never
  : never

/**
 * Extract "To" type from a single TypedMigration or TypedMigrationSequence.
 * For sequences, excludes intermediate columns (those that are also in _from).
 */
type ExtractToTypesSingle<M> = M extends { __migrations__: infer Migrations }
  ? Migrations extends TypedMigration<any, any>[]
    ? Omit<
        UnionToIntersection<Migrations[number]["_to"]>,
        keyof UnionToIntersection<Migrations[number]["_from"]>
      >
    : never
  : M extends TypedMigration<any, infer To>
    ? To
    : never

/**
 * Extract all "To" types from a union of TypedMigration and intersect them.
 * These are the columns that will be added.
 * Handles both single migrations and arrays of migrations.
 * Uses distributive conditional types to handle unions correctly.
 */
type ExtractToTypes<M> = M extends any
  ? UnwrapMigrationArray<M> extends infer U
    ? U extends any
      ? ExtractToTypesSingle<U>
      : never
    : never
  : never

/**
 * Convert a union to an intersection.
 * Used to combine all "To" types from migrations.
 */
type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void
  ? I
  : never

/**
 * Force TypeScript to evaluate a type (expands type aliases).
 */
type Simplify<T> = { [K in keyof T]: T[K] } & {}

/**
 * Combine all "from" types from a tuple of migrations.
 */
type CombineFromTypes<T extends TypedMigration<any, any>[]> = UnionToIntersection<
  T[number]["_from"]
>

/**
 * Combine all "to" types from a tuple of migrations.
 */
type CombineToTypes<T extends TypedMigration<any, any>[]> = UnionToIntersection<T[number]["_to"]>

/**
 * Compute the final "from" type for a sequence of migrations.
 * Excludes columns that are also added (intermediate renames).
 */
type SequenceFromType<T extends TypedMigration<any, any>[]> = Simplify<
  Omit<CombineFromTypes<T>, keyof CombineToTypes<T>>
>

/**
 * Compute the final "to" type for a sequence of migrations.
 * Excludes columns that are also removed (intermediate renames).
 */
type SequenceToType<T extends TypedMigration<any, any>[]> = Simplify<
  Omit<CombineToTypes<T>, keyof CombineFromTypes<T>>
>

/**
 * Apply all migrations to compute the final type.
 * 1. Remove all columns specified in migration "From" types
 * 2. Add all columns specified in migration "To" types
 * Handles both single migrations and arrays of migrations.
 */
export type ApplyMigrations<
  Base,
  Migrations extends Record<string, any>,
> = Migrations[keyof Migrations] extends infer M
  ? Omit<Base, ExtractFromKeys<M>> & UnionToIntersection<ExtractToTypes<M>>
  : Base

/**
 * Compute the final table type from base columns and migrations.
 * Supports both single migrations and arrays of migrations.
 */
export type FinalTableType<
  Columns extends Record<string, ColumnDef<any, any>>,
  Migrations extends Record<string, any> = {},
> = ApplyMigrations<InferColumns<Columns>, Migrations>

/**
 * Migration helpers for creating typed migrations.
 * Each helper returns a TypedMigration with appropriate type transformations.
 *
 * @example
 * ```typescript
 * import { migrate, col } from "@ghom/orm"
 *
 * const userTable = new Table({
 *   name: "user",
 *   columns: (col) => ({
 *     id: col.increments(),
 *     name: col.string(),
 *   }),
 *   migrations: {
 *     "001_rename_name": migrate.renameColumn("name", "username"),
 *     "002_add_email": migrate.addColumn("email", col.string()),
 *   },
 * })
 * ```
 */
export const migrate = {
  /**
   * Add a new column to the table.
   *
   * @param name - The column name
   * @param column - The column definition
   * @returns A typed migration that adds the column
   *
   * @example
   * migrate.addColumn("email", col.string())
   * // Adds: { email: string }
   */
  addColumn<K extends string, C extends ColumnDef<any, any>>(
    name: K,
    column: C,
  ): TypedMigration<{}, { [P in K]: InferColumnType<C> }> {
    return {
      _from: {} as {},
      _to: {} as { [P in K]: InferColumnType<C> },
      apply: (builder) => {
        buildColumnsSchema(builder as unknown as Knex.CreateTableBuilder, { [name]: column })
      },
    }
  },

  /**
   * Drop a column from the table.
   *
   * @param name - The column name to drop
   * @returns A typed migration that removes the column
   *
   * @example
   * migrate.dropColumn("oldField")
   * // Removes: { oldField: any }
   */
  dropColumn<K extends string>(name: K): TypedMigration<{ [P in K]: unknown }, {}> {
    return {
      _from: {} as { [P in K]: unknown },
      _to: {} as {},
      apply: (builder) => {
        builder.dropColumn(name)
      },
    }
  },

  /**
   * Rename a column.
   *
   * @param oldName - The current column name
   * @param newName - The new column name
   * @returns A typed migration that renames the column
   *
   * @example
   * migrate.renameColumn("name", "username")
   * // Removes: { name: any }, Adds: { username: any }
   */
  renameColumn<Old extends string, New extends string>(
    oldName: Old,
    newName: New,
  ): TypedMigration<{ [P in Old]: unknown }, { [P in New]: unknown }> {
    return {
      _from: {} as { [P in Old]: unknown },
      _to: {} as { [P in New]: unknown },
      apply: (builder) => {
        builder.renameColumn(oldName, newName)
      },
    }
  },

  /**
   * Alter a column's type or constraints.
   *
   * @param name - The column name
   * @param column - The new column definition
   * @returns A typed migration that alters the column
   *
   * @example
   * migrate.alterColumn("age", col.integer().nullable())
   * // Changes type: { age: number | null }
   */
  alterColumn<K extends string, C extends ColumnDef<any, any>>(
    name: K,
    column: C,
  ): TypedMigration<{ [P in K]: unknown }, { [P in K]: InferColumnType<C> }> {
    return {
      _from: {} as { [P in K]: unknown },
      _to: {} as { [P in K]: InferColumnType<C> },
      apply: (builder) => {
        builder.dropColumn(name)
        buildColumnsSchema(builder as unknown as Knex.CreateTableBuilder, { [name]: column })
      },
    }
  },

  /**
   * Add an index on one or more columns.
   *
   * @param columns - Array of column names to index
   * @param name - Optional index name
   * @returns A typed migration (no type change)
   *
   * @example
   * migrate.addIndex(["email"], "idx_email")
   */
  addIndex(columns: string[], name?: string): TypedMigration<{}, {}> {
    return {
      _from: {} as {},
      _to: {} as {},
      apply: (builder) => {
        builder.index(columns, name)
      },
    }
  },

  /**
   * Drop an index by name.
   *
   * @param name - The index name to drop
   * @returns A typed migration (no type change)
   *
   * @example
   * migrate.dropIndex("idx_email")
   */
  dropIndex(name: string): TypedMigration<{}, {}> {
    return {
      _from: {} as {},
      _to: {} as {},
      apply: (builder) => {
        builder.dropIndex([], name)
      },
    }
  },

  /**
   * Add a unique constraint on one or more columns.
   *
   * @param columns - Array of column names
   * @param name - Optional constraint name
   * @returns A typed migration (no type change)
   *
   * @example
   * migrate.addUnique(["email"], "uniq_email")
   */
  addUnique(columns: string[], name?: string): TypedMigration<{}, {}> {
    return {
      _from: {} as {},
      _to: {} as {},
      apply: (builder) => {
        builder.unique(columns, { indexName: name })
      },
    }
  },

  /**
   * Drop a unique constraint by name.
   *
   * @param name - The constraint name to drop
   * @returns A typed migration (no type change)
   *
   * @example
   * migrate.dropUnique("uniq_email")
   */
  dropUnique(name: string): TypedMigration<{}, {}> {
    return {
      _from: {} as {},
      _to: {} as {},
      apply: (builder) => {
        builder.dropUnique([], name)
      },
    }
  },

  /**
   * Custom migration with a raw callback.
   * Use this when the built-in helpers don't cover your use case.
   *
   * @param fn - The migration callback
   * @returns A typed migration (no type change by default)
   *
   * @example
   * migrate.raw((builder) => {
   *   builder.dropColumn("temp")
   *   builder.string("new_col")
   * })
   */
  raw<From = {}, To = {}>(fn: (builder: Knex.AlterTableBuilder) => void): TypedMigration<From, To> {
    return {
      _from: {} as From,
      _to: {} as To,
      apply: fn,
    }
  },

  /**
   * Combine multiple migrations into a single migration.
   * All migrations are applied sequentially within the same alter table call.
   * Type information from all migrations is preserved and combined.
   *
   * Intermediate columns (added then removed in the sequence) are excluded from the final type.
   * For example: renameColumn("a", "b") + renameColumn("b", "c") results in only "c" being added.
   *
   * @param migrations - The migrations to combine
   * @returns A typed migration sequence combining all type transformations
   *
   * @example
   * migrate.sequence(
   *   migrate.addColumn("phone", col.string()),
   *   migrate.addColumn("address", col.string().nullable()),
   *   migrate.addIndex(["phone"]),
   * )
   * // Combines: removes nothing, adds { phone: string; address: string | null }
   */
  sequence<T extends TypedMigration<any, any>[]>(...migrations: T): TypedMigrationSequence<T> {
    return {
      __migrations__: migrations,
      _from: {} as SequenceFromType<T>,
      _to: {} as SequenceToType<T>,
      apply: (builder) => {
        for (const migration of migrations) {
          migration.apply(builder)
        }
      },
    }
  },
}
