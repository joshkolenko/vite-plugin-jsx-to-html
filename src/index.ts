import { Plugin, ResolvedConfig, UserConfig } from "vite";
import { OutputBundle, OutputChunk, OutputAsset } from "rollup";

import fs from "fs";
import path from "path";

const cwd = process.cwd();
let config: ResolvedConfig;

const pluginName = "vite-plugin-jsx-to-html";

export function jsxToHtml(): Plugin {
  return {
    name: pluginName,
    enforce: "pre",
    config(config): UserConfig {
      const jsxFiles = fs
        .readdirSync(config.root || cwd)
        .filter(file => file.endsWith(".jsx"));

      return {
        css: {
          transformer: "lightningcss",
        },
        build: {
          assetsDir: "",
          ssr: true,
          ssrEmitAssets: true,
          rollupOptions: {
            external: ["react", "react-dom/server"],
            preserveEntrySignatures: "allow-extension",
            input: Object.fromEntries(
              jsxFiles.map(file => {
                const name = path.basename(file, ".jsx");
                return [name, path.join(config.root || cwd, file)];
              })
            ),
            output: {
              entryFileNames: "[name].js",
              assetFileNames: "[name].[ext]",
            },
            treeshake: true,
          },
        },
      };
    },
    configResolved(viteConfig: ResolvedConfig) {
      config = viteConfig;
    },
    async transform(code, id) {
      const relativePath = path.relative(config.root || cwd, id);
      const { dir, name, ext } = path.parse(relativePath);

      function formatAssetPath(dir: string, name: string, ext: string) {
        const sepRE = new RegExp(`\\${path.sep}`, "g");

        const formatted = path.join(dir, name + ext).replace(sepRE, "-");

        return pluginName + "-" + formatted;
      }

      console.log(code);
      if (checkIsCSS(id)) {
        // console.log({ path: formatAssetPath(dir, name, ".css"), code });
        this.emitFile({
          type: "asset",
          name: formatAssetPath(dir, name, ".css"),
          source: code,
        });
      }

      if (ext === ".js") {
        this.emitFile({
          type: "asset",
          name: formatAssetPath(dir, name, ".js"),
          source: code,
        });
      }

      if (ext === ".jsx") {
        const exportMatch = code.match(
          /export\sdefault\s(?:function\s)?(.+?)(?:\(\)|$)/
        );

        if (exportMatch) {
          const name = exportMatch[1];

          function getPaths(re: RegExp) {
            const matches = code.matchAll(re);
            return (
              Array.from(matches).map(match => {
                const { dir, name } = path.parse(match[1]);
                let ext = path.extname(match[1]);

                if (checkIsCSS(match[1])) {
                  ext = ".css";
                } else if (!ext) {
                  ext = ".js";
                }

                return formatAssetPath(dir, name, ext);
              }) || []
            );
          }

          const jsRE = /import\s['"](.[^.]+?|.+?.js)['"].+$/gm;
          const cssRE =
            /import\s['"](.+(?:\.css|\.scss|\.sass|\.less|\.styl|\.stylus))['"].+$/gm;

          const jsPaths = getPaths(jsRE);
          const cssPaths = getPaths(cssRE);

          code +=
            `export const jsxToHTMLVitePluginHtml = renderToStaticMarkup(React.createElement(${name}));\n` +
            `export const jsxToHTMLVitePluginJs = ${JSON.stringify(
              jsPaths
            )};\n` +
            `export const jsxToHTMLVitePluginCss = ${JSON.stringify(
              cssPaths
            )};\n`;
        }

        return code;
      }
    },
    async generateBundle(_, bundle) {
      removeEmptyChunks(bundle);

      // console.dir(bundle, { depth: null });

      const entryFiles = Object.entries(bundle)
        .filter(([_, value]) => value.type === "chunk" && value.isEntry)
        .map(([_, value]) => value) as OutputChunk[];

      const tmpDir = fs.mkdtempSync(path.join(config.cacheDir, "jsx-to-html-"));

      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ type: "module" })
      );

      for await (const file of entryFiles) {
        const { name, code } = file;

        const imports = `import * as React from 'react';\nimport { renderToStaticMarkup } from 'react-dom/server';\n`;

        fs.writeFileSync(path.join(tmpDir, name + ".js"), imports + code);

        const {
          jsxToHTMLVitePluginHtml: html,
          jsxToHTMLVitePluginJs: js,
          jsxToHTMLVitePluginCss: css,
        } = await import(path.join(tmpDir, name + ".js"));

        console.log({ html, js, css });
      }
    },
  };
}

function removeEmptyChunks(bundle: OutputBundle) {
  for (const [id, chunk] of Object.entries(bundle)) {
    if (chunk.type === "chunk" && chunk.code.trim() === "") {
      delete bundle[id];

      Object.entries(bundle).forEach(([key, value]) => {
        if (value.type === "chunk" && value.code.includes(id)) {
          const importRE = new RegExp(`['"]${id}['"]`, "g");
        }
      });
    }
  }


}

function checkIsCSS(id: string) {
  const extensions = [".css", ".scss", ".sass", ".less", ".styl", ".stylus"];
  return extensions.some(ext => id.endsWith(ext));
}
