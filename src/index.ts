import { Plugin, ResolvedConfig, UserConfig } from "vite";
import { OutputChunk, OutputAsset } from "rollup";

import fs from "fs";
import path from "path";
import * as prettier from "prettier";

const cwd = process.cwd();
let config: ResolvedConfig;

const pluginName = "vite-plugin-jsx-to-html";

export function jsxToHtml(): Plugin {
  return {
    name: pluginName,
    config(config): UserConfig {
      const jsxFiles = fs
        .readdirSync(config.root || cwd)
        .filter(file => file.endsWith(".jsx"));

      return {
        build: {
          assetsDir: "",
          ssr: true,
          ssrEmitAssets: true,
          rollupOptions: {
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

      if (checkIsCSS(id)) {
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
            `export const jsxToHtmlVitePluginHtml = renderToStaticMarkup(React.createElement(${name}));\n` +
            `export const jsxToHtmlVitePluginJs = ${JSON.stringify(
              jsPaths
            )};\n` +
            `export const jsxToHtmlVitePluginCss = ${JSON.stringify(
              cssPaths
            )};\n`;
        }

        return code;
      }
    },
    generateBundle: {
      order: "post",
      async handler(_, bundle) {
        const entryFiles = Object.entries(bundle)
          .filter(([_, value]) => value.type === "chunk" && value.isEntry)
          .map(([_, value]) => value) as OutputChunk[];

        if (!fs.existsSync(config.cacheDir)) {
          fs.mkdirSync(config.cacheDir);
        }

        const tmpDir = fs.mkdtempSync(
          path.join(config.cacheDir, "jsx-to-html-")
        );

        fs.writeFileSync(
          path.join(tmpDir, "package.json"),
          JSON.stringify({ type: "module" })
        );

        const jsxToHtmlFilesToRemove = new Set<string>();

        for await (const file of entryFiles) {
          const { name, code } = file;

          const imports = `import * as React from 'react';\nimport { renderToStaticMarkup } from 'react-dom/server';\n`;

          fs.writeFileSync(path.join(tmpDir, name + ".js"), imports + code);

          const {
            jsxToHtmlVitePluginHtml: html,
            jsxToHtmlVitePluginJs: jsFiles,
            jsxToHtmlVitePluginCss: cssFiles,
          } = await import(path.join(tmpDir, name + ".js"));

          let js = "";
          let css = "";

          for await (const file of jsFiles) {
            const asset = bundle[file] as OutputAsset;
            fs.writeFileSync(path.join(tmpDir, file + ".js"), asset.source);

            const { default: module } = await import(
              path.join(tmpDir, file + ".js")
            );

            if (typeof module !== "function") {
              this.error(`The default export of inlined js must be a function`);
            }

            js += "\n(" + module.toString() + ")();\n";

            jsxToHtmlFilesToRemove.add(file);
          }

          for await (const file of cssFiles) {
            const asset = bundle[file] as OutputAsset;
            css += "\n\n" + asset.source;

            jsxToHtmlFilesToRemove.add(file);
          }

          this.emitFile({
            type: "prebuilt-chunk",
            code: await prettier.format(
              html +
                "\n\n<style>\n" +
                css.trim() +
                "\n</style>" +
                "\n\n<script>\n" +
                js +
                "\n</script>",
              {
                parser: "html",
              }
            ),
            fileName: name + ".html",
          });
        }

        jsxToHtmlFilesToRemove.forEach(file => {
          delete bundle[file];
        });

        Object.keys(bundle).forEach(key => {
          if (!key.endsWith(".html")) {
            delete bundle[key];
          }
        });

        fs.rmSync(tmpDir, { recursive: true });
      },
    },
  };
}

function checkIsCSS(id: string) {
  const extensions = [".css", ".scss", ".sass", ".less", ".styl", ".stylus"];
  return extensions.some(ext => id.endsWith(ext));
}
