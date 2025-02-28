import fs from "fs"
import path from "path"
import util from "util"
import csv from "json-2-csv"
import csvParser from "csv-parser"
import { Knex } from "knex"
import { ORM } from "./orm.js"
import { Table } from "./table.js"
import {
  DEFAULT_BACKUP_CHUNK_SIZE,
  DEFAULT_BACKUP_LOCATION,
  DEFAULT_LOGGER_HIGHLIGHT,
  DEFAULT_LOGGER_RAW_VALUE,
} from "./util.js"

export async function backupTable(table: Table, dirname?: string) {
  if (!table.orm) throw new Error("missing ORM")

  let offset = 0
  let chunkIndex = 0

  const chunkDir = path.join(
    table.orm.config.backups?.location ?? DEFAULT_BACKUP_LOCATION,
    dirname ?? "",
  )

  if (!fs.existsSync(chunkDir)) {
    fs.mkdirSync(chunkDir, { recursive: true })

    console.log(
      `Backup directory ${util.styleText(
        table.orm.config.loggerStyles?.highlight ?? DEFAULT_LOGGER_HIGHLIGHT,
        path.relative(process.cwd(), chunkDir),
      )} created.`,
    )
  }

  try {
    // Compter le nombre total d'enregistrements dans la table
    const rowCount = await table.count()
    const limit = 1000 // Limite par requête
    const chunkCount = Math.ceil(rowCount / limit)

    let writeStream: fs.WriteStream | null = null
    const closePromises = [] // Tableau pour stocker les promesses de fermeture

    while (offset < rowCount) {
      // Récupérer un "chunk" de données
      const rows = await table.query.select("*").limit(limit).offset(offset)

      // Convertir les données en CSV
      const csvData = csv.json2csv(rows)

      // Si aucun fichier n'est créé ou qu'on a dépassé la taille max du chunk, on crée un nouveau fichier CSV
      if (
        !writeStream ||
        writeStream.bytesWritten + Buffer.byteLength(csvData, "utf8") >
          (table.orm.config.backups?.chunkSize ?? DEFAULT_BACKUP_CHUNK_SIZE)
      ) {
        if (writeStream) {
          closePromises.push(
            new Promise((resolve) => writeStream!.end(resolve)),
          ) // Ajouter la promesse de fermeture
        }

        const chunkFile = path.join(
          chunkDir,
          `${table.options.name}_chunk_${chunkIndex}.csv`,
        )
        writeStream = fs.createWriteStream(chunkFile, { flags: "a" })
        chunkIndex++
      }

      // Écrire les données dans le stream
      writeStream.write(csvData)
      offset += limit

      process.stdout.write(
        `\rBacking up table ${util.styleText(
          table.orm.config.loggerStyles?.highlight ?? DEFAULT_LOGGER_HIGHLIGHT,
          table.options.name,
        )}: ${util.styleText(
          table.orm.config.loggerStyles?.rawValue ?? DEFAULT_LOGGER_RAW_VALUE,
          String(Math.round((chunkIndex / chunkCount) * 100)),
        )}%`,
      )
    }

    if (writeStream) {
      closePromises.push(new Promise((resolve) => writeStream!.end(resolve))) // Ajouter la promesse de fermeture pour le dernier stream
    }

    // Attendre que tous les flux d'écriture soient fermés
    await Promise.all(closePromises)

    console.log(
      `\nBackup of table ${util.styleText(
        table.orm.config.loggerStyles?.highlight ?? DEFAULT_LOGGER_HIGHLIGHT,
        table.options.name,
      )} completed.`,
    )
  } catch (error) {
    console.error(
      `\nError while backing up table ${util.styleText(
        table.orm.config.loggerStyles?.highlight ?? DEFAULT_LOGGER_HIGHLIGHT,
        table.options.name,
      )}:`,
      error,
    )
  }
}

export async function restoreBackup(
  table: Table,
  trx: Knex.Transaction | Knex,
  dirname?: string,
) {
  if (!table.orm) throw new Error("missing ORM")

  const chunkDir = path.join(
    table.orm.config.backups?.location ?? DEFAULT_BACKUP_LOCATION,
    dirname ?? "",
  )

  const chunkFiles = fs
    .readdirSync(chunkDir)
    .filter((file) => file.split("_chunk_")[0] === table.options.name)

  await trx(table.options.name).del()

  try {
    const limit = 1000 // Limite par requête

    for (let chunkFile of chunkFiles) {
      const filePath = path.join(chunkDir, chunkFile)

      let rows: any[] = []

      await new Promise<void>((resolve, reject) => {
        fs.createReadStream(filePath)
          .pipe(csvParser())
          .on("data", async (row) => {
            rows.push(row)

            if (rows.length > limit) {
              const rowsCopy = rows.slice()
              rows = []
              await trx(table.options.name).insert(rowsCopy)
            }
          })
          .on("end", async () => {
            // Insérer les données dans la table une fois le fichier entièrement lu
            if (rows.length > 0) await trx(table.options.name).insert(rows)

            console.log(
              `Restored chunk ${util.styleText(
                table.orm!.config.loggerStyles?.highlight ??
                  DEFAULT_LOGGER_HIGHLIGHT,
                chunkFile,
              )} into table ${util.styleText(
                table.orm!.config.loggerStyles?.highlight ??
                  DEFAULT_LOGGER_HIGHLIGHT,
                table.options.name,
              )}.`,
            )

            resolve()
          })
          .on("error", reject)
      })
    }
  } catch (error) {
    console.error(
      `Error while restoring backup of table ${util.styleText(
        table.orm.config.loggerStyles?.highlight ?? DEFAULT_LOGGER_HIGHLIGHT,
        table.options.name,
      )}:`,
      error,
    )
  }

  console.log(
    `Backup of table ${util.styleText(
      table.orm.config.loggerStyles?.highlight ?? DEFAULT_LOGGER_HIGHLIGHT,
      table.options.name,
    )} restored.`,
  )
}

export async function enableForeignKeys(
  orm: ORM,
  trx?: Knex.Transaction | Knex,
) {
  const ctx = trx ?? orm

  await orm.clientBasedOperation({
    mysql2: () => ctx.raw("SET FOREIGN_KEY_CHECKS = 1;"),
    sqlite3: () => ctx.raw("PRAGMA foreign_keys = 1;"),
    pg: () => ctx.raw("SET session_replication_role = DEFAULT;"),
  })
}

export async function disableForeignKeys(
  orm: ORM,
  run: (trx: Knex.Transaction | Knex) => unknown,
) {
  const trx =
    orm.clientBasedOperation({
      sqlite3: () => orm.database,
    }) ?? (await orm.database.transaction())

  const ran = await orm.clientBasedOperation<Promise<boolean>>({
    mysql2: async () => {
      const result = await trx.raw("SELECT @@FOREIGN_KEY_CHECKS;")
      const check = result?.[0] && result[0]["@@FOREIGN_KEY_CHECKS"] != 0

      if (check) await trx.raw("SET FOREIGN_KEY_CHECKS = 0;")

      return check
    },
    sqlite3: async () => {
      const result = await trx.raw("PRAGMA foreign_keys;")
      const check = result?.[0] && result[0].foreign_keys != 0

      if (check) await trx.raw("PRAGMA foreign_keys = 0;")

      return check
    },
    pg: async () => {
      const result = await trx.raw("SHOW session_replication_role;")
      const check =
        result?.rows?.[0] &&
        result.rows[0].session_replication_role !== "replica"

      if (check) await trx.raw("SET session_replication_role = replica;")

      return check
    },
  })

  try {
    await run(trx)
    await enableForeignKeys(orm, trx)

    if (trx.isTransaction) await (trx as Knex.Transaction).commit()
  } catch (error) {
    if (trx.isTransaction) await (trx as Knex.Transaction).rollback()
    throw error
  }
}
