// TypeScript SQL Engine - Une alternative simple à SQLite3
// Implémentation en mémoire d'un moteur SQL basique

// Types pour notre système
type ColumnType = 'TEXT' | 'INTEGER' | 'REAL' | 'BOOLEAN';

interface ColumnDefinition {
  name: string;
  type: ColumnType;
  primaryKey?: boolean;
  notNull?: boolean;
}

interface TableDefinition {
  name: string;
  columns: ColumnDefinition[];
}

interface Record {
  [key: string]: string | number | boolean | null;
}

// Classe principale du moteur SQL
export class JSQL {
  private tables: Map<string, TableDefinition> = new Map();
  private data: Map<string, Record[]> = new Map();

  constructor() {
    console.log("JSQL initialized");
  }

  // Exécuter une requête SQL
  public execute(query: string): any {
    query = query.trim();

    if (query.toUpperCase().startsWith('CREATE TABLE')) {
      return this.executeCreateTable(query);
    } else if (query.toUpperCase().startsWith('INSERT INTO')) {
      return this.executeInsert(query);
    } else if (query.toUpperCase().startsWith('SELECT')) {
      return this.executeSelect(query);
    } else if (query.toUpperCase().startsWith('UPDATE')) {
      return this.executeUpdate(query);
    } else if (query.toUpperCase().startsWith('DELETE FROM')) {
      return this.executeDelete(query);
    } else {
      throw new Error(`Unsupported SQL operation: ${query}`);
    }
  }

  // Analyser et exécuter CREATE TABLE
  private executeCreateTable(query: string): boolean {
    // Regex pour extraire le nom de la table et les définitions de colonnes
    const createTableRegex = /CREATE\s+TABLE\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([\s\S]*)\)/i;
    const matches = query.match(createTableRegex);

    if (!matches) {
      throw new Error('Invalid CREATE TABLE syntax');
    }

    const tableName = matches[1];
    const columnDefinitionsStr = matches[2];
    const columnDefinitions: ColumnDefinition[] = [];

    // Séparation des définitions de colonnes
    const columnDefs = columnDefinitionsStr.split(',').map(def => def.trim());

    for (const colDef of columnDefs) {
      const colMatches = colDef.match(/([a-zA-Z_][a-zA-Z0-9_]*)\s+([A-Z]+)(\s+PRIMARY\s+KEY)?(\s+NOT\s+NULL)?/i);

      if (!colMatches) {
        throw new Error(`Invalid column definition: ${colDef}`);
      }

      columnDefinitions.push({
        name: colMatches[1],
        type: colMatches[2] as ColumnType,
        primaryKey: !!colMatches[3],
        notNull: !!colMatches[4]
      });
    }

    // Création de la table
    this.tables.set(tableName, { name: tableName, columns: columnDefinitions });
    this.data.set(tableName, []);

    return true;
  }

  // Analyser et exécuter INSERT INTO
  private executeInsert(query: string): number {
    // Regex pour extraire le nom de la table, les colonnes et les valeurs
    const insertRegex = /INSERT\s+INTO\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:\(([^)]+)\))?\s*VALUES\s*\((.*)\)/i;
    const matches = query.match(insertRegex);

    if (!matches) {
      throw new Error('Invalid INSERT syntax');
    }

    const tableName = matches[1];
    const columnsStr = matches[2] || '';
    const valuesStr = matches[3];

    const table = this.tables.get(tableName);
    if (!table) {
      throw new Error(`Table ${tableName} does not exist`);
    }

    // Préparation des colonnes
    let columns: string[];
    if (columnsStr) {
      columns = columnsStr.split(',').map(col => col.trim());
    } else {
      columns = table.columns.map(col => col.name);
    }

    // Préparation des valeurs
    const valueRegex = /'([^']*)'|(\d+)|true|false|null/gi;
    const values: (string | number | boolean | null)[] = [];
    let match;

    while ((match = valueRegex.exec(valuesStr)) !== null) {
      if (match[1] !== undefined) {
        values.push(match[1]); // string
      } else if (match[2] !== undefined) {
        values.push(Number(match[2])); // number
      } else if (match[0].toLowerCase() === 'true') {
        values.push(true);
      } else if (match[0].toLowerCase() === 'false') {
        values.push(false);
      } else {
        values.push(null);
      }
    }

    if (values.length !== columns.length) {
      throw new Error('Number of values does not match number of columns');
    }

    // Création de l'enregistrement
    const record: Record = {};
    for (let i = 0; i < columns.length; i++) {
      record[columns[i]] = values[i];
    }

    // Validation des contraintes
    for (const col of table.columns) {
      if (col.notNull && record[col.name] === null) {
        throw new Error(`Column ${col.name} cannot be null`);
      }
    }

    // Insertion des données
    const tableData = this.data.get(tableName) || [];
    tableData.push(record);
    this.data.set(tableName, tableData);

    return 1; // Nombre de lignes insérées
  }

  // Analyser et exécuter SELECT
  private executeSelect(query: string): Record[] {
    // Regex simple pour les SELECT basiques
    const selectRegex = /SELECT\s+(.*?)\s+FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+WHERE\s+(.*))?/i;
    const matches = query.match(selectRegex);

    if (!matches) {
      throw new Error('Invalid SELECT syntax');
    }

    const columnsStr = matches[1];
    const tableName = matches[2];
    const whereClause = matches[3] || '';

    const table = this.tables.get(tableName);
    if (!table) {
      throw new Error(`Table ${tableName} does not exist`);
    }

    let tableData = this.data.get(tableName) || [];

    // Filtrage par WHERE
    if (whereClause) {
      // Support simple pour les conditions d'égalité
      const whereRegex = /([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(?:'([^']*)'|(\d+)|true|false|null)/i;
      const whereMatches = whereClause.match(whereRegex);

      if (whereMatches) {
        const columnName = whereMatches[1];
        let value: string | number | boolean | null;

        if (whereMatches[2] !== undefined) {
          value = whereMatches[2]; // string
        } else if (whereMatches[3] !== undefined) {
          value = Number(whereMatches[3]); // number
        } else if (whereMatches[0].toLowerCase().includes('true')) {
          value = true;
        } else if (whereMatches[0].toLowerCase().includes('false')) {
          value = false;
        } else {
          value = null;
        }

        tableData = tableData.filter(record => record[columnName] === value);
      }
    }

    // Sélection des colonnes
    if (columnsStr === '*') {
      return tableData;
    } else {
      const columns = columnsStr.split(',').map(col => col.trim());
      return tableData.map(record => {
        const result: Record = {};
        for (const col of columns) {
          result[col] = record[col];
        }
        return result;
      });
    }
  }

  // Analyser et exécuter UPDATE
  private executeUpdate(query: string): number {
    const updateRegex = /UPDATE\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+SET\s+(.*?)(?:\s+WHERE\s+(.*))?/i;
    const matches = query.match(updateRegex);

    if (!matches) {
      throw new Error('Invalid UPDATE syntax');
    }

    const tableName = matches[1];
    const setClause = matches[2];
    const whereClause = matches[3] || '';

    const table = this.tables.get(tableName);
    if (!table) {
      throw new Error(`Table ${tableName} does not exist`);
    }

    // Préparation des mises à jour
    const setRegex = /([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(?:'([^']*)'|(\d+)|true|false|null)/gi;
    const updates: Record = {};
    let setMatch;

    while ((setMatch = setRegex.exec(setClause)) !== null) {
      const columnName = setMatch[1];

      if (setMatch[2] !== undefined) {
        updates[columnName] = setMatch[2]; // string
      } else if (setMatch[3] !== undefined) {
        updates[columnName] = Number(setMatch[3]); // number
      } else if (setMatch[0].toLowerCase().includes('true')) {
        updates[columnName] = true;
      } else if (setMatch[0].toLowerCase().includes('false')) {
        updates[columnName] = false;
      } else {
        updates[columnName] = null;
      }
    }

    // Application des mises à jour
    let tableData = this.data.get(tableName) || [];
    let updatedCount = 0;

    // Filtrage par WHERE
    let recordsToUpdate: Record[];
    if (whereClause) {
      // Support simple pour les conditions d'égalité
      const whereRegex = /([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(?:'([^']*)'|(\d+)|true|false|null)/i;
      const whereMatches = whereClause.match(whereRegex);

      if (whereMatches) {
        const columnName = whereMatches[1];
        let value: string | number | boolean | null;

        if (whereMatches[2] !== undefined) {
          value = whereMatches[2]; // string
        } else if (whereMatches[3] !== undefined) {
          value = Number(whereMatches[3]); // number
        } else if (whereMatches[0].toLowerCase().includes('true')) {
          value = true;
        } else if (whereMatches[0].toLowerCase().includes('false')) {
          value = false;
        } else {
          value = null;
        }

        recordsToUpdate = tableData.filter(record => record[columnName] === value);
      } else {
        recordsToUpdate = [];
      }
    } else {
      recordsToUpdate = [...tableData];
    }

    // Mise à jour des enregistrements
    for (const record of recordsToUpdate) {
      for (const [key, value] of Object.entries(updates)) {
        record[key] = value;
      }
      updatedCount++;
    }

    return updatedCount;
  }

  // Analyser et exécuter DELETE
  private executeDelete(query: string): number {
    const deleteRegex = /DELETE\s+FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+WHERE\s+(.*))?/i;
    const matches = query.match(deleteRegex);

    if (!matches) {
      throw new Error('Invalid DELETE syntax');
    }

    const tableName = matches[1];
    const whereClause = matches[2] || '';

    const table = this.tables.get(tableName);
    if (!table) {
      throw new Error(`Table ${tableName} does not exist`);
    }

    let tableData = this.data.get(tableName) || [];
    const originalCount = tableData.length;

    // Filtrage par WHERE
    if (whereClause) {
      // Support simple pour les conditions d'égalité
      const whereRegex = /([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(?:'([^']*)'|(\d+)|true|false|null)/i;
      const whereMatches = whereClause.match(whereRegex);

      if (whereMatches) {
        const columnName = whereMatches[1];
        let value: string | number | boolean | null;

        if (whereMatches[2] !== undefined) {
          value = whereMatches[2]; // string
        } else if (whereMatches[3] !== undefined) {
          value = Number(whereMatches[3]); // number
        } else if (whereMatches[0].toLowerCase().includes('true')) {
          value = true;
        } else if (whereMatches[0].toLowerCase().includes('false')) {
          value = false;
        } else {
          value = null;
        }

        tableData = tableData.filter(record => record[columnName] !== value);
      }
    } else {
      // Si pas de WHERE, supprime tout
      tableData = [];
    }

    this.data.set(tableName, tableData);
    return originalCount - tableData.length;
  }

  public listTables(): string[] {
    return Array.from(this.tables.keys());
  }

  public describeTable(tableName: string): TableDefinition | null {
    return this.tables.get(tableName) || null;
  }

  public getTableData(tableName: string): Record[] | null {
    return this.data.get(tableName) || null;
  }
}