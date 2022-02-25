# File handler

## Example for table handler

```ts
import { Handler } from "@ghom/handler"

export const tableHandler = new Handler(path.join(process.cwd(), "dist", "tables"))

tableHandler.once("finish", async (pathList) => {
  const tables = await Promise.all(
    pathList.map(async (filepath) => {
      const file = await import("file://" + filepath)
      if (filepath.endsWith(".native.js")) file.default.options.native = true
      file.default.filepath = filepath
      return file.default
    })
  )

  return Promise.all(
    tables
      .sort((a, b) => {
        return (b.options.priority ?? 0) - (a.options.priority ?? 0)
      })
      .map((table) => table.make())
  )
})
```
