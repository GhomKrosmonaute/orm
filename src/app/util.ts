import util from "util"
import path from "path"
import fs from "fs"
import { ORM } from "./orm.js"

export type TextStyle = Parameters<typeof util.styleText>[0]

export const DEFAULT_BACKUP_LOCATION = path.join(process.cwd(), "backup")
export const DEFAULT_BACKUP_CHUNK_SIZE = 5 * 1024 * 1024 // 5MB

export const DEFAULT_LOGGER_HIGHLIGHT = "blueBright"
export const DEFAULT_LOGGER_DESCRIPTION = "grey"
export const DEFAULT_LOGGER_RAW_VALUE = "magentaBright"

let isCJS: boolean = false

try {
  const pack = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
  )

  isCJS = pack.type === "commonjs" || pack.type == void 0
} catch {
  throw new Error(
    "Missing package.json: Can't detect the type of modules.\n" +
      "The ORM needs a package.json file present in the process's current working directory.\n" +
      "Please create a package.json file or run the project from another entry point.",
  )
}

export { isCJS }
