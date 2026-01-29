import type { Knex } from "knex"

/**
 * Represents the inferred TypeScript type for a column definition.
 */
export type InferColumnType<T extends ColumnDef<any, any>> =
  T extends ColumnDef<infer Type, infer Nullable>
    ? Nullable extends true
      ? Type | null
      : Type
    : never

/**
 * Infers the full record type from a columns definition.
 */
export type InferColumns<T extends Record<string, ColumnDef<any, any>>> = {
  [K in keyof T]: InferColumnType<T[K]>
}

/**
 * Base column definition that tracks the TypeScript type and nullability.
 */
export class ColumnDef<Type, Nullable extends boolean = false> {
  /** @internal */
  readonly _type!: Type
  /** @internal */
  readonly _nullable!: Nullable
  /** @internal */
  _knexBuilder?: Knex.ColumnBuilder

  constructor(
    /** @internal */
    readonly _buildFn: (tableBuilder: Knex.CreateTableBuilder, name: string) => Knex.ColumnBuilder,
    /** @internal */
    readonly _isNullable: Nullable = false as Nullable,
    /** @internal */
    readonly _modifiers: Array<(col: Knex.ColumnBuilder) => Knex.ColumnBuilder> = [],
  ) {}

  /**
   * Makes this column nullable.
   */
  nullable(): ColumnDef<Type, true> {
    return new ColumnDef<Type, true>(this._buildFn, true, [
      ...this._modifiers,
      (col) => col.nullable(),
    ])
  }

  /**
   * Sets a default value for this column.
   */
  defaultTo(value: Type | Knex.Raw): ColumnDef<Type, Nullable> {
    return new ColumnDef<Type, Nullable>(this._buildFn, this._isNullable, [
      ...this._modifiers,
      (col) => col.defaultTo(value as any),
    ])
  }

  /**
   * Makes this column unique.
   */
  unique(): ColumnDef<Type, Nullable> {
    return new ColumnDef<Type, Nullable>(this._buildFn, this._isNullable, [
      ...this._modifiers,
      (col) => col.unique(),
    ])
  }

  /**
   * Makes this column the primary key.
   */
  primary(): ColumnDef<Type, Nullable> {
    return new ColumnDef<Type, Nullable>(this._buildFn, this._isNullable, [
      ...this._modifiers,
      (col) => col.primary(),
    ])
  }

  /**
   * Adds an index to this column.
   */
  index(indexName?: string): ColumnDef<Type, Nullable> {
    return new ColumnDef<Type, Nullable>(this._buildFn, this._isNullable, [
      ...this._modifiers,
      (col) => col.index(indexName),
    ])
  }

  /**
   * Adds a comment to this column.
   */
  comment(comment: string): ColumnDef<Type, Nullable> {
    return new ColumnDef<Type, Nullable>(this._buildFn, this._isNullable, [
      ...this._modifiers,
      (col) => col.comment(comment),
    ])
  }

  /**
   * Sets the collation for this column.
   */
  collate(collation: string): ColumnDef<Type, Nullable> {
    return new ColumnDef<Type, Nullable>(this._buildFn, this._isNullable, [
      ...this._modifiers,
      (col) => col.collate(collation),
    ])
  }

  /**
   * Adds a references constraint to this column.
   */
  references(columnName: string): ForeignColumnDef<Type, Nullable> {
    return new ForeignColumnDef<Type, Nullable>(
      this._buildFn,
      this._isNullable,
      [...this._modifiers],
      columnName,
    )
  }

  /** @internal */
  _build(tableBuilder: Knex.CreateTableBuilder, name: string): Knex.ColumnBuilder {
    let col = this._buildFn(tableBuilder, name)
    if (!this._isNullable) {
      col = col.notNullable()
    }
    for (const modifier of this._modifiers) {
      col = modifier(col)
    }
    return col
  }
}

/**
 * Column definition with foreign key support.
 */
export class ForeignColumnDef<Type, Nullable extends boolean> extends ColumnDef<Type, Nullable> {
  constructor(
    buildFn: (tableBuilder: Knex.CreateTableBuilder, name: string) => Knex.ColumnBuilder,
    isNullable: Nullable,
    modifiers: Array<(col: Knex.ColumnBuilder) => Knex.ColumnBuilder>,
    private _referencesColumn: string,
    private _inTable?: string,
    private _onDelete?: string,
    private _onUpdate?: string,
  ) {
    super(buildFn, isNullable, modifiers)
  }

  /**
   * Sets the table for the foreign key reference.
   */
  inTable(tableName: string): ForeignColumnDef<Type, Nullable> {
    return new ForeignColumnDef<Type, Nullable>(
      this._buildFn,
      this._isNullable,
      this._modifiers,
      this._referencesColumn,
      tableName,
      this._onDelete,
      this._onUpdate,
    )
  }

  /**
   * Sets the ON DELETE action.
   */
  onDelete(
    action: "CASCADE" | "SET NULL" | "RESTRICT" | "NO ACTION",
  ): ForeignColumnDef<Type, Nullable> {
    return new ForeignColumnDef<Type, Nullable>(
      this._buildFn,
      this._isNullable,
      this._modifiers,
      this._referencesColumn,
      this._inTable,
      action,
      this._onUpdate,
    )
  }

  /**
   * Sets the ON UPDATE action.
   */
  onUpdate(
    action: "CASCADE" | "SET NULL" | "RESTRICT" | "NO ACTION",
  ): ForeignColumnDef<Type, Nullable> {
    return new ForeignColumnDef<Type, Nullable>(
      this._buildFn,
      this._isNullable,
      this._modifiers,
      this._referencesColumn,
      this._inTable,
      this._onDelete,
      action,
    )
  }

  /** @internal */
  override _build(tableBuilder: Knex.CreateTableBuilder, name: string): Knex.ColumnBuilder {
    const col = super._build(tableBuilder, name)
    let ref = col.references(this._referencesColumn)
    if (this._inTable) ref = ref.inTable(this._inTable)
    if (this._onDelete) ref = ref.onDelete(this._onDelete)
    if (this._onUpdate) ref = ref.onUpdate(this._onUpdate)
    return col
  }
}

/**
 * Number column definition with additional numeric options.
 */
export class NumberColumnDef<Nullable extends boolean = false> extends ColumnDef<number, Nullable> {
  /**
   * Makes this column unsigned (only positive values).
   */
  unsigned(): NumberColumnDef<Nullable> {
    return new NumberColumnDef<Nullable>(
      (tb, name) => {
        const col = this._buildFn(tb, name)
        return (col as any).unsigned()
      },
      this._isNullable,
      this._modifiers,
    )
  }

  override nullable(): NumberColumnDef<true> {
    return new NumberColumnDef<true>(this._buildFn, true, [
      ...this._modifiers,
      (col) => col.nullable(),
    ])
  }

  override defaultTo(value: number | Knex.Raw): NumberColumnDef<Nullable> {
    return new NumberColumnDef<Nullable>(this._buildFn, this._isNullable, [
      ...this._modifiers,
      (col) => col.defaultTo(value as any),
    ])
  }
}

/**
 * Column factory for creating typed column definitions.
 */
export const col = {
  /**
   * Auto-incrementing primary key (integer).
   */
  increments(): ColumnDef<number> {
    return new ColumnDef<number>((tb, name) => tb.increments(name))
  },

  /**
   * Big auto-incrementing primary key (bigint).
   */
  bigIncrements(): ColumnDef<bigint> {
    return new ColumnDef<bigint>((tb, name) => tb.bigIncrements(name))
  },

  /**
   * Integer column.
   */
  integer(): NumberColumnDef {
    return new NumberColumnDef((tb, name) => tb.integer(name))
  },

  /**
   * Big integer column.
   */
  bigInteger(): ColumnDef<bigint> {
    return new ColumnDef<bigint>((tb, name) => tb.bigInteger(name))
  },

  /**
   * Tiny integer column (0-255).
   */
  tinyint(): NumberColumnDef {
    return new NumberColumnDef((tb, name) => tb.tinyint(name))
  },

  /**
   * Small integer column.
   */
  smallint(): NumberColumnDef {
    return new NumberColumnDef((tb, name) => tb.smallint(name))
  },

  /**
   * Medium integer column.
   */
  mediumint(): NumberColumnDef {
    return new NumberColumnDef((tb, name) => tb.mediumint(name))
  },

  /**
   * Floating-point number column.
   * @param precision - Total number of digits
   * @param scale - Number of decimal places
   */
  float(precision?: number, scale?: number): NumberColumnDef {
    return new NumberColumnDef((tb, name) => tb.float(name, precision, scale))
  },

  /**
   * Double precision floating-point column.
   * @param precision - Total number of digits
   * @param scale - Number of decimal places
   */
  double(precision?: number, scale?: number): NumberColumnDef {
    return new NumberColumnDef((tb, name) => tb.double(name, precision, scale))
  },

  /**
   * Decimal column for exact numeric values.
   * @param precision - Total number of digits
   * @param scale - Number of decimal places
   */
  decimal(precision?: number, scale?: number): NumberColumnDef {
    return new NumberColumnDef((tb, name) => tb.decimal(name, precision, scale))
  },

  /**
   * String column.
   * @param length - Maximum length (default: 255)
   */
  string(length?: number): ColumnDef<string> {
    return new ColumnDef<string>((tb, name) => tb.string(name, length))
  },

  /**
   * Text column for longer strings.
   * @param textType - Type of text column
   */
  text(textType?: "text" | "mediumtext" | "longtext"): ColumnDef<string> {
    return new ColumnDef<string>((tb, name) => tb.text(name, textType))
  },

  /**
   * Boolean column.
   */
  boolean(): ColumnDef<boolean> {
    return new ColumnDef<boolean>((tb, name) => tb.boolean(name))
  },

  /**
   * Date column (without time).
   */
  date(): ColumnDef<Date> {
    return new ColumnDef<Date>((tb, name) => tb.date(name))
  },

  /**
   * DateTime column.
   * @param options - DateTime options
   */
  datetime(options?: { useTz?: boolean; precision?: number }): ColumnDef<Date> {
    return new ColumnDef<Date>((tb, name) => tb.datetime(name, options))
  },

  /**
   * Timestamp column.
   * @param options - Timestamp options
   */
  timestamp(options?: { useTz?: boolean; precision?: number }): ColumnDef<Date> {
    return new ColumnDef<Date>((tb, name) => tb.timestamp(name, options))
  },

  /**
   * Time column.
   */
  time(): ColumnDef<string> {
    return new ColumnDef<string>((tb, name) => tb.time(name))
  },

  /**
   * Binary column.
   * @param length - Maximum length
   */
  binary(length?: number): ColumnDef<Buffer> {
    return new ColumnDef<Buffer>((tb, name) => tb.binary(name, length))
  },

  /**
   * Enum column with specific allowed values.
   * @param values - Array of allowed values
   */
  enum<T extends readonly string[]>(values: T): ColumnDef<T[number]> {
    return new ColumnDef<T[number]>((tb, name) => tb.enum(name, [...values]))
  },

  /**
   * JSON column.
   */
  json<T = unknown>(): ColumnDef<T> {
    return new ColumnDef<T>((tb, name) => tb.json(name))
  },

  /**
   * JSONB column (PostgreSQL).
   */
  jsonb<T = unknown>(): ColumnDef<T> {
    return new ColumnDef<T>((tb, name) => tb.jsonb(name))
  },

  /**
   * UUID column.
   */
  uuid(): ColumnDef<string> {
    return new ColumnDef<string>((tb, name) => tb.uuid(name))
  },

  /**
   * Specific database type column.
   * @param type - The database-specific type
   */
  specificType<T = unknown>(type: string): ColumnDef<T> {
    return new ColumnDef<T>((tb, name) => tb.specificType(name, type))
  },
}

/**
 * Builds the Knex table schema from column definitions.
 * @internal
 */
export function buildColumnsSchema(
  tableBuilder: Knex.CreateTableBuilder,
  columns: Record<string, ColumnDef<any, any>>,
): void {
  for (const [name, columnDef] of Object.entries(columns)) {
    columnDef._build(tableBuilder, name)
  }
}
