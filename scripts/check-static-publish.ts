import { config } from "../src/lib/config.ts";
const secrets = [config.turbopufferApiKey, config.jwtSecret, config.elevenLabsApiKey].filter(
  (value) => typeof value === "string" && value.length > 12,
);
let files = 0,
  bytes = 0;
for await (const path of new Bun.Glob("**/*").scan({ cwd: "dist/pages", onlyFiles: true })) {
  if (
    !/^(index\.html|_headers|assets\/[^/]+\.(js|css)|assets\/source-serif4-[A-Za-z0-9_-]+\.ttf|licenses\/source-serif4-OFL\.txt|course\/catalog\.json|course\/lessons\/[\w-]+\.json|audio\/(manifest\.json|[a-f0-9]{64}\.mp3))$/.test(
      path,
    )
  )
    throw Error(`Unexpected publish file: ${path}`);
  const file = Bun.file(`dist/pages/${path}`);
  if (file.size > 25 * 1024 * 1024) throw Error("Asset exceeds Pages limit");
  if (!path.endsWith(".mp3")) {
    const text = await file.text();
    if (secrets.some((secret) => text.includes(secret)))
      throw Error(`Secret detected in publish file: ${path}`);
  }
  files++;
  bytes += file.size;
}
if (files > 20000 || !(await Bun.file("dist/pages/course/catalog.json").exists()))
  throw Error("Invalid static build");
console.log({ files, bytes, secretMatches: 0, workerResources: 0 });
