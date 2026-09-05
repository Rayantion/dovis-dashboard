import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/*
  Tests live in `tests/`, not beside the code, because the only handlers worth
  testing here are under `src/app/` and Next treats that tree as routing. A
  `route.test.ts` sitting next to a `route.ts` is a file the framework has an
  opinion about; a directory it never scans is not.
*/
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
