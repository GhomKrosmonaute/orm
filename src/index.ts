export * from "./app/orm.js"
export * from "./app/table.js"

// @ts-ignore
declare module "@ghom/orm/esm" {
  export * from "./app/orm.js"
  export * from "./app/table.js"
}

// @ts-ignore
declare module "@ghom/orm/cjs" {
  export * from "./app/orm.js"
  export * from "./app/table.js"
}
