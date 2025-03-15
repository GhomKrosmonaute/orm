import knex, { Knex } from "knex"
import * as vitest from "vitest"
import { JSQL, JSQLDialect, JSQLClient } from "./index.js"

vitest.describe('KnexJSQL Provider', () => {
  let engine: vitest.Mocked<JSQL>;
  let client: Knex

  vitest.beforeEach(() => {
    // Créer une instance mockée de JSQL
    engine = new JSQL() as vitest.Mocked<JSQL>;

    // Initialiser Knex avec notre adaptateur personnalisé
    client = knex({
      client: new JSQLClient({ engine })
    })
  });

  describe('Schema operations', () => {
    it('should create a table correctly', async () => {
      // Configurer le mock pour retourner true (succès)
      engine.execute.mockResolvedValue(true);

      // Exécuter la création de table
      await knex.schema.createTable('users', (table: any) => {
        table.integer('id').primary();
        table.text('name').notNullable();
        table.integer('age');
        table.boolean('active');
      });

      // Vérifier que execute a été appelé avec la bonne requête SQL
      expect(engine.execute).toHaveBeenCalledTimes(1);
      expect(engine.execute).toHaveBeenCalledWith(
        expect.stringMatching(/CREATE TABLE users.*id INTEGER PRIMARY KEY.*name TEXT NOT NULL.*age INTEGER.*active BOOLEAN/is)
      );
    });
  });

  describe('INSERT operations', () => {
    it('should insert a single row correctly', async () => {
      // Configurer le mock pour retourner 1 (une ligne insérée)
      engine.execute.mockResolvedValue(1);

      // Exécuter l'insertion
      const result = await knex('users').insert({
        id: 1,
        name: 'Alice',
        age: 28,
        active: true
      });

      // Vérifier que execute a été appelé avec la bonne requête SQL
      expect(engine.execute).toHaveBeenCalledTimes(1);
      expect(engine.execute).toHaveBeenCalledWith(
        expect.stringMatching(/INSERT INTO users.*VALUES.*1.*'Alice'.*28.*true/is)
      );

      // Vérifier le résultat
      expect(result).toBe(1);
    });

    it('should insert multiple rows correctly', async () => {
      // Configurer le mock pour retourner 2 (deux lignes insérées)
      engine.execute.mockResolvedValue(2);

      // Exécuter l'insertion multiple
      const result = await knex('users').insert([
        { id: 1, name: 'Alice', age: 28, active: true },
        { id: 2, name: 'Bob', age: 35, active: false }
      ]);

      // Vérifier que execute a été appelé avec la bonne requête SQL
      expect(engine.execute).toHaveBeenCalledTimes(1);
      expect(engine.execute).toHaveBeenCalledWith(
        expect.stringMatching(/INSERT INTO users.*VALUES.*1.*'Alice'.*28.*true.*2.*'Bob'.*35.*false/is)
      );

      // Vérifier le résultat
      expect(result).toBe(2);
    });
  });

  describe('SELECT operations', () => {
    it('should select all rows correctly', async () => {
      // Données de test à retourner
      const mockData = [
        { id: 1, name: 'Alice', age: 28, active: true },
        { id: 2, name: 'Bob', age: 35, active: false }
      ];

      // Configurer le mock pour retourner nos données
      engine.execute.mockResolvedValue(mockData);

      // Exécuter la sélection
      const result = await knex('users').select();

      // Vérifier que execute a été appelé avec la bonne requête SQL
      expect(engine.execute).toHaveBeenCalledTimes(1);
      expect(engine.execute).toHaveBeenCalledWith('SELECT * FROM users');

      // Vérifier le résultat
      expect(result).toEqual(mockData);
    });

    it('should select specific columns correctly', async () => {
      // Données de test à retourner
      const mockData = [
        { name: 'Alice', age: 28 },
        { name: 'Bob', age: 35 }
      ];

      // Configurer le mock pour retourner nos données
      engine.execute.mockResolvedValue(mockData);

      // Exécuter la sélection avec colonnes spécifiques
      const result = await knex('users').select('name', 'age');

      // Vérifier que execute a été appelé avec la bonne requête SQL
      expect(engine.execute).toHaveBeenCalledTimes(1);
      expect(engine.execute).toHaveBeenCalledWith('SELECT name, age FROM users');

      // Vérifier le résultat
      expect(result).toEqual(mockData);
    });

    it('should filter rows with WHERE correctly', async () => {
      // Données de test à retourner
      const mockData = [
        { id: 1, name: 'Alice', age: 28, active: true }
      ];

      // Configurer le mock pour retourner nos données
      engine.execute.mockResolvedValue(mockData);

      // Exécuter la sélection avec filtre
      const result = await knex('users')
        .select()
        .where('active', '=', true);

      // Vérifier que execute a été appelé avec la bonne requête SQL
      expect(engine.execute).toHaveBeenCalledTimes(1);
      expect(engine.execute).toHaveBeenCalledWith(
        expect.stringMatching(/SELECT \* FROM users WHERE active = true/i)
      );

      // Vérifier le résultat
      expect(result).toEqual(mockData);
    });
  });

  describe('UPDATE operations', () => {
    it('should update rows correctly', async () => {
      // Configurer le mock pour retourner 1 (une ligne mise à jour)
      engine.execute.mockResolvedValue(1);

      // Exécuter la mise à jour
      const result = await knex('users')
        .where('id', '=', 2)
        .update({ active: false, name: 'Robert' });

      // Vérifier que execute a été appelé avec la bonne requête SQL
      expect(engine.execute).toHaveBeenCalledTimes(1);
      expect(engine.execute).toHaveBeenCalledWith(
        expect.stringMatching(/UPDATE users SET.*active = false.*name = 'Robert'.*WHERE id = 2/is)
      );

      // Vérifier le résultat
      expect(result).toBe(1);
    });
  });

  describe('DELETE operations', () => {
    it('should delete rows correctly', async () => {
      // Configurer le mock pour retourner 1 (une ligne supprimée)
      engine.execute.mockResolvedValue(1);

      // Exécuter la suppression
      const result = await knex('users')
        .where('active', '=', false)
        .delete();

      // Vérifier que execute a été appelé avec la bonne requête SQL
      expect(engine.execute).toHaveBeenCalledTimes(1);
      expect(engine.execute).toHaveBeenCalledWith(
        expect.stringMatching(/DELETE FROM users WHERE active = false/i)
      );

      // Vérifier le résultat
      expect(result).toBe(1);
    });
  });

  describe('Raw queries', () => {
    it('should execute raw queries correctly', async () => {
      // Données de test à retourner
      const mockData = [
        { id: 1, name: 'Alice', age: 28, active: true }
      ];

      // Configurer le mock pour retourner nos données
      engine.execute.mockResolvedValue(mockData);

      // Exécuter une requête brute
      const result = await knex.raw('SELECT * FROM users WHERE age > ?', [25]);

      // Vérifier que execute a été appelé avec la bonne requête SQL
      expect(engine.execute).toHaveBeenCalledTimes(1);
      expect(engine.execute).toHaveBeenCalledWith('SELECT * FROM users WHERE age > 25');

      // Vérifier le résultat
      expect(result).toEqual(mockData);
    });
  });

  describe('Integration test', () => {
    it('should handle a complete CRUD workflow', async () => {
      // Configurer les mocks pour les différentes opérations
      engine.execute
        // CREATE TABLE
        .mockResolvedValueOnce(true)
        // INSERT
        .mockResolvedValueOnce(1)
        // SELECT
        .mockResolvedValueOnce([{ id: 1, name: 'Alice', age: 28, active: true }])
        // UPDATE
        .mockResolvedValueOnce(1)
        // SELECT après UPDATE
        .mockResolvedValueOnce([{ id: 1, name: 'Alice', age: 29, active: true }])
        // DELETE
        .mockResolvedValueOnce(1)
        // SELECT après DELETE
        .mockResolvedValueOnce([]);

      // Exécuter une série d'opérations CRUD
      // 1. Créer une table
      await knex.schema.createTable('users', (table: any) => {
        table.integer('id').primary();
        table.text('name').notNullable();
        table.integer('age');
        table.boolean('active');
      });

      // 2. Insérer une ligne
      await knex('users').insert({ id: 1, name: 'Alice', age: 28, active: true });

      // 3. Sélectionner des données
      const users = await knex('users').select();
      expect(users).toEqual([{ id: 1, name: 'Alice', age: 28, active: true }]);

      // 4. Mettre à jour des données
      await knex('users').where('id', '=', 1).update({ age: 29 });

      // 5. Vérifier la mise à jour
      const updatedUsers = await knex('users').select();
      expect(updatedUsers).toEqual([{ id: 1, name: 'Alice', age: 29, active: true }]);

      // 6. Supprimer des données
      await knex('users').where('id', '=', 1).delete();

      // 7. Vérifier la suppression
      const remainingUsers = await knex('users').select();
      expect(remainingUsers).toEqual([]);

      // Vérifier le nombre total d'appels à execute
      expect(engine.execute).toHaveBeenCalledTimes(7);
    });
  });
});