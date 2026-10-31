// Prints the CHANGELOG.md section for one version, for the notes of a GitHub release:
//   node scripts/release-notes.mjs 0.7.0
// Exits with 1 if there is no such section, or it is empty, so a release cannot go out unexplained.
import { readFileSync } from "node:fs";

const version = process.argv[2]?.replace(/^v/, "");
if (!version) {
  console.error("Usage: node scripts/release-notes.mjs <version>");
  process.exit(2);
}

const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const lines = changelog.split("\n");
const heading = (line) => /^## \[/.test(line);
const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
if (start === -1) {
  console.error(`CHANGELOG.md has no section for ${version}.`);
  process.exit(1);
}
let end = lines.findIndex((line, index) => index > start && heading(line));
if (end === -1) end = lines.length;
const notes = lines.slice(start + 1, end).join("\n").trim();
if (notes === "") {
  console.error(`The CHANGELOG.md section for ${version} is empty.`);
  process.exit(1);
}
console.log(notes);
