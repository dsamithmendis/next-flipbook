// Checks the package the way a user receives it: packs it, installs the tarball into an empty
// project, and uses it there. Everything the other tests run against is the source tree, so none
// of them would notice a missing file in `files`, an export that points at nothing, a type that
// does not resolve, or an import that touches the DOM.
//
//   npm run build -w next-flipbook
//   node packages/flipbook/scripts/verify-pack.mjs [--keep]
//
// It needs the npm registry, to install React and TypeScript beside the tarball.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const keep = process.argv.includes("--keep");
const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const failures = [];
const fail = (message) => failures.push(message);
const step = (message) => console.log(`- ${message}`);

/** Runs a command and returns its output. A failure carries what the command printed. */
function run(command, args, cwd) {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
    throw new Error(`${command} ${args.join(" ")} failed:\n${output}`, { cause: error });
  }
}

if (!existsSync(join(root, "dist", "index.js"))) {
  console.error("There is no dist/. Run `npm run build -w next-flipbook` first.");
  process.exit(2);
}

const work = mkdtempSync(join(tmpdir(), "next-flipbook-pack-"));
try {
  // 1. What goes into the tarball.
  step("packing");
  const packed = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", work], root))[0];
  const files = packed.files.map((file) => file.path);
  const tarball = join(work, packed.filename);

  const exportTargets = [];
  const collect = (value) => {
    if (typeof value === "string") exportTargets.push(value.replace(/^\.\//, ""));
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  collect(pkg.exports);
  for (const required of ["package.json", "README.md", "LICENSE", ...exportTargets]) {
    if (!files.includes(required)) fail(`the tarball does not contain ${required}`);
  }
  for (const file of files) {
    if (/^(src|tests?|scripts|benchmarks|e2e|docs|demo)\//.test(file) || /\.tsbuildinfo$/.test(file)) {
      fail(`the tarball contains ${file}, which is not part of the package`);
    }
  }
  console.log(`  ${packed.filename}: ${files.length} files, ${(packed.size / 1024).toFixed(0)} kB packed, ${(packed.unpackedSize / 1024).toFixed(0)} kB unpacked`);

  // 2. Install it into an empty project beside the peers a user would have.
  step("installing the tarball into an empty project");
  const app = join(work, "app");
  mkdirSync(app);
  writeFileSync(join(app, "package.json"), JSON.stringify({ name: "consumer", private: true, type: "module" }));
  run(
    "npm",
    ["install", "--no-audit", "--no-fund", "--loglevel=error", tarball, "react@^19", "react-dom@^19", "typescript@~5.9", "@types/react@^19", "@types/react-dom@^19"],
    app,
  );
  const installed = JSON.parse(readFileSync(join(app, "node_modules", pkg.name, "package.json"), "utf8"));
  if (installed.version !== pkg.version) fail(`installed ${installed.version}, expected ${pkg.version}`);

  // 3. Every entry point imports in plain Node, where there is no window and no document, and
  //    exports something. A browser global read at import time fails here.
  step("importing every entry point in Node");
  const entries = Object.keys(pkg.exports)
    .filter((key) => key !== "./package.json" && !key.endsWith(".css"))
    .map((key) => (key === "." ? pkg.name : `${pkg.name}/${key.slice(2)}`));
  writeFileSync(
    join(app, "imports.mjs"),
    `const entries = ${JSON.stringify(entries)};
for (const entry of entries) {
  const module = await import(entry);
  const names = Object.keys(module);
  if (names.length === 0) throw new Error(entry + " exports nothing");
  console.log("  " + entry + ": " + names.length + " exports");
}
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const css = fileURLToPath(import.meta.resolve(${JSON.stringify(`${pkg.name}/styles.css`)}));
if (!existsSync(css)) throw new Error("styles.css does not resolve to a file");
console.log("  styles.css resolves");
`,
  );
  process.stdout.write(run("node", ["imports.mjs"], app));

  // 4. A book renders on the server, which is what Next.js does with it before the browser has it.
  step("rendering a book on the server");
  writeFileSync(
    join(app, "ssr.mjs"),
    `import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { FlipBook } from ${JSON.stringify(pkg.name)};
const html = renderToString(
  createElement(FlipBook, { pages: ["/a.jpg", "/b.jpg", "/c.jpg", "/d.jpg"], aspectRatio: "3/4" }),
);
for (const part of ['role="region"', 'aria-label="Flipbook"']) {
  if (!html.includes(part)) throw new Error("the server markup lacks " + part);
}
console.log("  " + html.length + " characters of markup");
`,
  );
  process.stdout.write(run("node", ["ssr.mjs"], app));

  // 5. The types resolve and are usable, under both module resolutions a consumer may have.
  step("type-checking a consumer");
  writeFileSync(
    join(app, "consumer.tsx"),
    `import { FlipBook, useFlipBook, type FlipBookController } from ${JSON.stringify(pkg.name)};
import { FlipBookEngine } from ${JSON.stringify(`${pkg.name}/core`)};
import type { PdfSource } from ${JSON.stringify(`${pkg.name}/pdf`)};
import ${JSON.stringify(`${pkg.name}/styles.css`)};
import { createRef } from "react";

const source: PdfSource = "/guide.pdf";
const ref = createRef<FlipBookController>();
export const book = (
  <FlipBook
    ref={ref}
    source={source}
    pdf={{ workerSrc: "/pdf.worker.min.mjs" }}
    cacheSize={10}
    cover
    thumbnails
    bookmarks
    search
    onPageChange={(page: number) => void page}
  />
);
export function Counter() {
  const book = useFlipBook();
  return <span>{book.getCurrentPage()}</span>;
}
export const stats: number | undefined = ref.current?.getCacheStats().pages.entries;
export const engine = FlipBookEngine;
`,
  );
  for (const [name, moduleResolution, module] of [
    ["bundler", "Bundler", "ESNext"],
    ["nodenext", "NodeNext", "NodeNext"],
  ]) {
    writeFileSync(
      join(app, `tsconfig.${name}.json`),
      JSON.stringify({
        compilerOptions: { strict: true, noEmit: true, jsx: "react-jsx", target: "ES2022", module, moduleResolution, skipLibCheck: false, types: [] },
        files: ["consumer.tsx"],
      }),
    );
    try {
      run(join(app, "node_modules", ".bin", "tsc"), ["-p", `tsconfig.${name}.json`], app);
      console.log(`  ${moduleResolution}: ok`);
    } catch (error) {
      fail(`type-checking with ${moduleResolution} failed:\n${error.message}`);
    }
  }
} catch (error) {
  fail(error.message);
} finally {
  if (keep) console.log(`kept ${work}`);
  else rmSync(work, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\n${failures.length} problem(s) with the package:\n${failures.map((message) => `  * ${message}`).join("\n")}`);
  process.exit(1);
}
console.log(`\n${pkg.name}@${pkg.version} installs and works from its tarball.`);
