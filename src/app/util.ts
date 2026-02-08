import fs from "node:fs"
import path from "node:path"
import util from "node:util"
import type { Knex } from "knex"
import type { LoggerStyles, ORM } from "./orm.js"

export type TextStyle = Parameters<typeof util.styleText>[0]

export const DEFAULT_BACKUP_LOCATION = path.join(process.cwd(), "backup")
export const DEFAULT_BACKUP_CHUNK_SIZE = 5 * 1024 * 1024 // 5MB

export const DEFAULT_LOGGER_HIGHLIGHT = "blueBright"
export const DEFAULT_LOGGER_DESCRIPTION = "gray"
export const DEFAULT_LOGGER_RAW_VALUE = "magentaBright"

let isCJS: boolean = false

try {
  const pack = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"))

  isCJS = pack.type === "commonjs" || pack.type === void 0
} catch {
  throw new Error(
    "Missing package.json: Can't detect the type of modules.\n" +
      "The ORM needs a package.json file present in the process's current working directory.\n" +
      "Please create a package.json file or run the project from another entry point.",
  )
}

export { isCJS }

export function styled(orm: ORM, message: string | boolean | number, style: keyof LoggerStyles) {
  const config = orm.config !== false ? orm.config : undefined
  return util.styleText(
    config?.loggerStyles?.[style] ??
      (style === "highlight"
        ? DEFAULT_LOGGER_HIGHLIGHT
        : style === "rawValue"
          ? DEFAULT_LOGGER_RAW_VALUE
          : DEFAULT_LOGGER_DESCRIPTION),
    String(message),
  )
}

export async function extractDatabaseConfig(config: Knex.Config["connection"]): Promise<{
  host: string
  port: number
  user: string
  password: string
  database?: string
}> {
  if (!config) throw new Error("Missing database configuration")

  if (typeof config === "string") {
    const url = new URL(config)
    return {
      host: url.hostname,
      port: Number(url.port),
      user: url.username,
      password: url.password,
      database: url.pathname.slice(1),
    }
  }

  if (
    typeof config === "object" &&
    "host" in config &&
    "port" in config &&
    "user" in config &&
    "password" in config
  ) {
    let { host, port, user, password } = config

    if (typeof password !== "string" && password) password = await password()
    if (!password) throw new Error("Missing password")
    if (!user) throw new Error("Missing user")
    if (!host) throw new Error("Missing host")
    if (!port) throw new Error("Missing port")

    return {
      host,
      port,
      user,
      password,
      database: "database" in config ? config.database : undefined,
    }
  }

  throw new Error("Invalid database configuration")
}
