import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
const colors = ["#296b70", "#7b5f43", "#65558f", "#386641", "#3b6aa0"];
async function main() { const dir = join(process.cwd(), "public", "test-avatars"); await mkdir(dir, { recursive: true }); for (let i = 1; i <= 15; i++) { const id = `demo-${String(i).padStart(3,"0")}`; const color = colors[(i - 1) % colors.length]; const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000"><rect width="800" height="1000" fill="${color}"/><circle cx="400" cy="350" r="155" fill="#d9e8e7"/><path d="M130 900c35-240 160-335 270-335s235 95 270 335" fill="#d9e8e7"/><text x="400" y="80" fill="white" font-family="Arial" font-size="44" font-weight="700" text-anchor="middle">PRUEBA</text></svg>`; await writeFile(join(dir, `${id}.svg`), svg); } }
main();
