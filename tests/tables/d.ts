import { Table } from "../../src"

export default new Table({
  name: "d",
  priority: 0,
  columns: (col) => ({
    id: col.increments(),
    name: col.string(100).unique(),
    email: col.string(255),
    age: col.integer().nullable().unsigned(),
    role: col.enum(["admin", "user", "guest"] as const).defaultTo("user"),
    isActive: col.boolean().defaultTo(true),
    metadata: col.json<{ tags: string[]; score: number }>().nullable(),
    createdAt: col.timestamp().nullable(),
  }),
  async then({ query }) {
    await query.insert({
      id: 1,
      name: "Test User",
      email: "test@example.com",
      age: 25,
      role: "admin",
      isActive: true,
      metadata: { tags: ["test"], score: 100 },
      createdAt: new Date(),
    })
  },
})
