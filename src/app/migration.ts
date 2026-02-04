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
 * Extract all "From" keys from a union of TypedMigration.
 * These are the columns that will be removed/renamed.
 */
type ExtractFromKeys<M> = M extends TypedMigration<infer From, any> ? keyof From : never

/**
 * Extract all "To" types from a union of TypedMigration and intersect them.
 * These are the columns that will be added.
 */
type ExtractToTypes<M> = M extends TypedMigration<any, infer To> ? To : never

/**
 * Convert a union to an intersection.
 * Used to combine all "To" types from migrations.
 */
type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void
  ? I
  : never

/**
 * Apply all migrations to compute the final type.
 * 1. Remove all columns specified in migration "From" types
 * 2. Add all columns specified in migration "To" types
 */
export type ApplyMigrations<
  Base,
  Migrations extends Record<string, TypedMigration<any, any>>,
> = Migrations[keyof Migrations] extends infer M
  ? Omit<Base, ExtractFromKeys<M>> & UnionToIntersection<ExtractToTypes<M>>
  : Base

/**
 * Compute the final table type from base columns and migrations.
 */
export type FinalTableType<
  Columns extends Record<string, ColumnDef<any, any>>,
  Migrations extends Record<string, TypedMigration<any, any>> = {},
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
}
