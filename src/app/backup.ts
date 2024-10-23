import fs from "fs"
import path from "path"
import util from "util"
import csv from "json-2-csv"
import csvParser from "csv-parser"
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

export async function restoreBackup(table: Table, dirname?: string) {
  if (!table.orm) throw new Error("missing ORM")

  const chunkDir = path.join(
    table.orm.config.backups?.location ?? DEFAULT_BACKUP_LOCATION,
    dirname ?? "",
  )

  const chunkFiles = fs
    .readdirSync(chunkDir)
    .filter((file) => file.split("_chunk_")[0] === table.options.name)

  await table.query.truncate()

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
              await table.query.insert(rowsCopy)
            }
          })
          .on("end", async () => {
            // Insérer les données dans la table une fois le fichier entièrement lu
            if (rows.length > 0) await table.query.insert(rows)

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

export async function disableForeignKeys(orm: ORM) {
  const result = await Promise.allSettled([
    orm.raw("SET session_replication_role = replica;"), // for pg
    orm.raw("PRAGMA foreign_keys = OFF;"), // for sqlite3
    orm.raw("SET FOREIGN_KEY_CHECKS = 0;"), // for mysql2
  ])

  const errors = result.filter((r) => r.status === "rejected")

  if (errors.length === 3) {
    throw new Error("Failed to disable foreign key constraints.")
  }
}

export async function enableForeignKeys(orm: ORM) {
  const result = await Promise.allSettled([
    orm.raw("SET session_replication_role = DEFAULT;"), // for pg
    orm.raw("PRAGMA foreign_keys = ON;"), // for sqlite3
    orm.raw("SET FOREIGN_KEY_CHECKS = 1;"), // for mysql2
  ])

  const errors = result.filter((r) => r.status === "rejected")

  if (errors.length === 3) {
    throw new Error("Failed to enable foreign key constraints.")
  }
}
