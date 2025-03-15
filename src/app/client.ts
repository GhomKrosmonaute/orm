import { Client, QueryBuilder } from "knex"
import { JSQL } from "./jsql.js"

class JSQLClient extends Client {
  private engine: JSQL;
  private dialect = "sql"

  constructor(config: Omit<ConstructorParameters<typeof Client>[0], "client" | "dialect">) {
    super(config);

    this.engine = new JSQL();
  }

  public queryBuilder() {
    const builder: any = {
      _single: {
        columns: [],
        from: '',
        wheres: [],
        updates: {},
        insert: []
      },

      // Méthodes de construction de requête
      select: function(...columns: string[]) {
        this._single.columns = columns.length ? columns : ['*'];
        return this;
      },

      from: function(tableName: string) {
        this._single.from = tableName;
        return this;
      },

      where: function(column: string, operator: string, value: any) {
        this._single.wheres.push({ column, operator, value });
        return this;
      },

      update: function(updates: Record<string, any>) {
        this._single.updates = updates;
        return this;
      },

      insert: function(rows: Record<string, any> | Record<string, any>[]) {
        const rowsArray = Array.isArray(rows) ? rows : [rows];
        this._single.insert = rowsArray;
        return this;
      },

      delete: function() {
        return this;
      },

      // Méthode d'exécution
      then: (resolve: Function, reject?: Function) => {
        try {
          const result = this.executeQuery(builder);
          resolve(result);
        } catch (error) {
          if (reject) reject(error);
        }
      }
    };

    return builder;
  }

  // Exécuter une requête SQL brute
  public raw(sql: string, bindings?: any): Promise<QueryBuilder> {
    // Remplacer les ? par les valeurs liées
    let query = sql;
    if (bindings && Array.isArray(bindings)) {
      bindings.forEach(binding => {
        query = query.replace('?', this.dialect.formatter().parameter(binding, {}));
      });
    }

    try {
      const result = this.engine.execute(query);
      return Promise.resolve(result);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  // Support des transactions
  public transaction(trxCallback: (trx: any) => Promise<any>): Promise<any> {
    // Note: JSQL n'a pas de support natif pour les transactions
    // C'est une implémentation simulée
    const trx = { ...this, commit: () => {}, rollback: () => {} };

    return trxCallback(trx)
      .then(result => {
        return result;
      })
      .catch(error => {
        throw error;
      });
  }

  // Nettoyer les ressources
  public destroy(): Promise<void> {
    // Pas besoin de faire quoi que ce soit de spécial pour nettoyer
    return Promise.resolve();
  }

  // Créer une table
  public schema = {
    createTable: (tableName: string, builderFn: (table: any) => void) => {
      const tableBuilder: any = {
        columns: [],

        integer: function(name: string) {
          const column: any = { name, type: 'INTEGER' };
          this.columns.push(column);
          return {
            primary: () => {
              column.primaryKey = true;
              return this;
            },
            notNullable: () => {
              column.notNull = true;
              return this;
            }
          };
        },

        text: function(name: string) {
          const column: any = { name, type: 'TEXT' };
          this.columns.push(column);
          return {
            notNullable: () => {
              column.notNull = true;
              return this;
            }
          };
        },

        real: function(name: string) {
          const column: any = { name, type: 'REAL' };
          this.columns.push(column);
          return {
            notNullable: () => {
              column.notNull = true;
              return this;
            }
          };
        },

        boolean: function(name: string) {
          const column: any = { name, type: 'BOOLEAN' };
          this.columns.push(column);
          return {
            notNullable: () => {
              column.notNull = true;
              return this;
            }
          };
        }
      };

      builderFn(tableBuilder);

      const sql = this.dialect.tableCompiler().createTable(tableName, tableBuilder.columns);
      return this.raw(sql);
    }
  };

  // Méthode privée pour exécuter la requête construite
  private executeQuery(builder: any): Promise<QueryResult> {
    const { _single } = builder;
    let sql: string;

    // Déterminer le type de requête
    if (_single.insert && _single.insert.length) {
      sql = this.dialect.queryCompiler(builder).insert();
    } else if (_single.updates && Object.keys(_single.updates).length) {
      sql = this.dialect.queryCompiler(builder).update();
    } else if (_single.from && _single.columns) {
      sql = this.dialect.queryCompiler(builder).select();
    } else if (_single.from) {
      sql = this.dialect.queryCompiler(builder).delete();
    } else {
      return Promise.reject(new Error('Invalid query'));
    }

    return this.raw(sql);
  }
}


export { JSQLClient, JSQLDialect };