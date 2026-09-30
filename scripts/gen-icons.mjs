/**
 * Generate the PWA icon set (PNG 192/512, apple-touch 180, favicon)
 * from an inline SVG so no binary assets need to be committed.
 * Run: bun scripts/gen-icons.mjs
 */
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#0f172a"/>
  <circle cx="256" cy="256" r="236" fill="#0f172a" stroke="#f0a821" stroke-width="10"/>
  <path d="M256 96l31 96h101l-82 60 31 96-81-60-81 60 31-96-82-60h101z" fill="#f0a821"/>
  <circle cx="256" cy="256" r="150" fill="none" stroke="#0ea5e9" stroke-width="8" stroke-dasharray="24 16"/>
</svg>`;

const targets = [
  { file: "public/icon-192.png", size: 192 },
  { file: "public/icon-512.png", size: 512 },
  { file: "public/apple-touch-icon.png", size: 180 },
  { file: "public/favicon.ico", size: 48 },
];

mkdirSync("public", { recursive: true });

for (const { file, size } of targets) {
  await sharp(Buffer.from(SVG))
    .resize(size, size)
    .png()
    .toFile(file.endsWith(".ico") ? "public/favicon.ico" : file);
  console.log(`✔ wrote ${file} (${size}x${size})`);
}
