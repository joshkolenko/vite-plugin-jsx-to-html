import { Plugin, ResolvedConfig, UserConfig } from 'vite';
import { OutputChunk } from 'rollup';

import fs from 'fs';
import path from 'path';

interface OutputFile extends OutputChunk {
  html: string;
  jsx: string;
}

const cwd = process.cwd();
const outDir = path.join(cwd, 'dist');

let config: ResolvedConfig;
export default function jsxToHtml(): Plugin {
  return {
    name: 'vite-plugin-jsx-to-html',
    config(config): UserConfig {
      const jsxFiles = fs
        .readdirSync(config.root)
        .filter(file => file.endsWith('.jsx'));

      return {
        build: {
          outDir,
          emptyOutDir: true,
          ssr: true,
          rollupOptions: {
            input: Object.fromEntries(
              jsxFiles.map(file => {
                const name = path.basename(file, '.jsx');
                return [name, path.join(config.root, file)];
              })
            ),
          },
        },
      };
    },
    configResolved(viteConfig: ResolvedConfig) {
      config = viteConfig;
    },
    transform(code) {
      const match = code.match(
        new RegExp('export default function (.+)\\(\\)')
      );

      if (match) {
        const component = match[1];

        const header = `
          import React from 'react';
          import ReactDOMServer from 'react-dom/server';
        `;

        const footer = `
          const jsxToHtmlRenderedHTML = ReactDOMServer.renderToStaticMarkup(
            React.createElement(${component})
          );

          export {
            jsxToHtmlRenderedHTML as html,
          }
        `;

        code = `${header.trim()}\n${code.trim()}\n${footer.trim()}`;
      }

      return {
        code,
      };
    },

    async generateBundle(_, bundle) {
      const jsFiles = Object.keys(bundle).map(file => {
        const obj = bundle[file] as OutputChunk;

        delete bundle[file];

        return obj;
      });

      const tmpDir = fs.mkdtempSync(path.join(config.cacheDir, 'jsx-to-html-'));

      jsFiles.forEach(jsFile => {
        fs.writeFileSync(path.join(tmpDir, jsFile.fileName), jsFile.code);
      });

      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ type: 'module' })
      );

      const outputFiles: OutputFile[] = [];

      for await (const jsFile of jsFiles) {
        const htmlFile = await import(path.join(tmpDir, jsFile.fileName));

        outputFiles.push({
          ...jsFile,
          html: htmlFile.html,
          jsx: htmlFile.default,
        });
      }

      // fs.rmSync(tmpDir, { recursive: true });

      outputFiles.forEach(file => {
        this.emitFile({
          fileName: file.name + '.html',
          code: file.html,
          type: 'prebuilt-chunk',
        });
      });
    },
  };
}
