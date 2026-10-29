// Optional build path for environments that cannot launch esbuild's native helper.
// The regular `pnpm build` remains the default.
import { build } from "vite";
import ts from "typescript";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
const require = createRequire(import.meta.url);

await build({
  configFile: false,
  base: "/",
  resolve: { preserveSymlinks: true, alias: { scheduler: require.resolve("scheduler", { paths: [realpathSync("node_modules/react-dom")] }) } },
  esbuild: false,
  plugins: [{
    name: "typescript-portable",
    enforce: "pre",
    transform(source, id) {
      source = source.replaceAll("process.env.NODE_ENV", '"production"');
      if (!/\.[cm]?tsx?$/.test(id.split("?")[0])) return source;
      return ts.transpileModule(source, {
        fileName: id,
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, sourceMap: false },
      }).outputText;
    },
  }],
  build: { target: "esnext", minify: false, cssMinify: false, rollupOptions: { output: { manualChunks: { three: ["three"] } } } },
});
