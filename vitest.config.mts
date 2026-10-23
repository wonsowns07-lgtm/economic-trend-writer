import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 지우기 전에 옮겨 둔 파일(trash-can)은 시험하지 않는다.
    exclude: [...configDefaults.exclude, "trash-can/**"],
  },
});
