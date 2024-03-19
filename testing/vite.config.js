import { defineConfig } from "vite";

import { jsxToHtml } from "../src/index";

export default defineConfig({
  root: "src",
  plugins: [jsxToHtml()],
  logLevel: "silent",
  // build: {
  //   rollupOptions: {
  //     input: ["src/a.jsx", "src/b.jsx"],
  //   },
  // },
});
