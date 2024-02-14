import { Plugin, ResolvedConfig, UserConfig } from 'vite';
import { OutputChunk, OutputAsset } from 'rollup';

import fs from 'fs';
import path from 'path';

interface OutputFile extends OutputChunk {
  html?: string;
  css?: string;
}

function checkIsCss(file: string) {
  return (
    file.endsWith('.css') ||
    file.endsWith('.scss') ||
    file.endsWith('.sass') ||
    file.endsWith('.less') ||
    file.endsWith('.styl') ||
    file.endsWith('.stylus')
  );
}

const cwd = process.cwd();

let config: ResolvedConfig;
export default function jsxToHtml(): Plugin {
  return {
    name: 'vite-plugin-jsx-to-html',
    config(config): UserConfig {
      const jsxFiles = fs
        .readdirSync(config.root || cwd)
        .filter(file => file.endsWith('.jsx'));

      return {
        build: {
          assetsDir: '',
          emptyOutDir: true,
          cssCodeSplit: true,
          ssr: true,
          ssrEmitAssets: true,
          rollupOptions: {
            input: Object.fromEntries(
              jsxFiles.map(file => {
                const name = path.basename(file, '.jsx');
                return [name, path.join(config.root || cwd, file)];
              })
            ),
            output: {
              assetFileNames: '[name].[ext]',
            },
            treeshake: true,
          },
        },
      };
    },
    configResolved(viteConfig: ResolvedConfig) {
      config = viteConfig;
    },
    load(id) {
      if (id.endsWith('.js')) {
        if (Array.from(this.getModuleIds()).includes(id + 'x')) {
          this.error(
            `Cannot have a .js file with the same name as a .jsx file in the same directory. Please rename the file "${path.basename(
              id
            )}" to something else.`
          );
        }
      }
    },
    async transform(code, id) {
      const isJSX = id.endsWith('.jsx') === true;

      if (isJSX) {
        const match = code.match(
          new RegExp('export default function (.+)\\(\\)')
        );

        if (match) {
          const component = match[1];

          const sideEffectMatches = Array.from(
            code.matchAll(new RegExp('import [\'"](.+js)[\'"]', 'g'))
          );

          const sideEffectFiles: string[] = [];

          for await (const match of sideEffectMatches) {
            sideEffectFiles.push(
              (
                await import(path.join(path.dirname(id), match[1]))
              ).default.toString()
            );
          }

          const header = `
            import React from 'react';
            import ReactDOMServer from 'react-dom/server';
          `;

          const footer = `
            const jsxToHtmlRenderedHTML = ReactDOMServer.renderToStaticMarkup(
              React.createElement(${component})
            );

            const jsxToHtmlRenderedSideEffects = ${JSON.stringify(
              sideEffectFiles
            )};

            export {
              jsxToHtmlRenderedHTML as html,
              jsxToHtmlRenderedSideEffects as scripts
            }
          `;

          code = `${header.trim()}\n${code.trim()}\n${footer.trim()}`;
        }
      }

      return {
        code,
      };
    },
    async generateBundle(_, bundle) {
      // console.log(bundle);

      const bundleObjs = Object.keys(bundle).map(key => {
        const obj = bundle[key];
        delete bundle[key];
        return obj;
      });

      const assets = bundleObjs.filter(
        obj => obj.type === 'asset'
      ) as OutputAsset[];

      const chunks = bundleObjs.filter(
        obj => obj.type === 'chunk'
      ) as OutputChunk[];

      if (!fs.existsSync(config.cacheDir)) {
        fs.mkdirSync(config.cacheDir);
      }

      const tmpDir = fs.mkdtempSync(path.join(config.cacheDir, 'jsx-to-html-'));

      chunks.forEach(chunk => {
        if (chunk.hasOwnProperty('code')) {
          fs.writeFileSync(path.join(tmpDir, chunk.fileName), chunk.code);
        }
      });

      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ type: 'module' })
      );

      const outputFiles: OutputFile[] = [];

      for await (const chunk of chunks) {
        const { html, scripts }: { html: string; scripts: string[] } =
          await import(path.join(tmpDir, chunk.fileName));

        let script = '',
          style = '';

        if (scripts.length) {
          script = `\n<script>\n${scripts
            .map(script => `(${script})()`)
            .join('\n')}\n</script>`;
        }
        console.log(chunk);

        const styles = assets
          .filter(asset => {
            if (!checkIsCss(asset.fileName)) return false;
            const chunkStyles = chunk.moduleIds.filter(checkIsCss);

            return chunkStyles
              .map(file => path.parse(file).name)
              .includes(path.parse(asset.fileName).name);
          })
          .map(asset => asset.source);

        if (styles.length) {
          style = `\n<style>${styles.join('\n')}</style>`;
        }

        outputFiles.push({
          ...chunk,
          html: html + script + style,
        });
      }

      // console.log(outputFiles);

      // fs.rmSync(tmpDir, { recursive: true });

      outputFiles.forEach(file => {
        this.emitFile({
          fileName: file.name + '.html',
          code: file.html || '',
          type: 'prebuilt-chunk',
        });
      });
    },
  };
}
