import { copyFileSync, existsSync, mkdirSync } from "node:fs";

const here = new URL("../", import.meta.url);

mkdirSync(new URL("dist/", here), { recursive: true });
copyFileSync(new URL("src/styles.css", here), new URL("dist/styles.css", here));

// npm publishes the README and LICENSE that sit next to package.json.
for (const file of ["README.md", "LICENSE"]) {
  const source = new URL(`../../${file}`, here);
  if (existsSync(source)) copyFileSync(source, new URL(file, here));
}
