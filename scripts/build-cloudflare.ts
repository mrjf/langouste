import { mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { loadCourseCatalog } from "../src/services/course/catalog.ts";
import {courseReadingSupport,courseSentenceParts} from "../src/client/lib/course-reading-support.ts";
const staticOnly = Bun.argv.includes("--static");
const lessons = await loadCourseCatalog();
// Fail the release before publishing a word without its authored gloss/dictionary data.
for(const lesson of lessons){
 const rows=[...lesson.readings.flatMap(r=>[...r.sentences,...(r.recognitionOnly??[])]),...lesson.vocabulary.map(v=>v.example),...lesson.concepts.flatMap(c=>c.examples),...(lesson.optionalDialogue??[]),...(lesson.instructionBlocks?.flatMap(b=>b.examples??[])??[])];
 for(const row of rows)for(const sentence of courseSentenceParts(row,lesson.language))courseReadingSupport(sentence,lesson.language);
}
await mkdir("cloudflare/generated", { recursive: true });
// Build-time validation/resolution; each request parses only its selected lesson.
const summaries = lessons.map(
  ({ id, courseId, day, language, title, subtitle, estimatedMinutes, objectives, exercises }) => ({
    id,
    courseId,
    day,
    language,
    title,
    subtitle,
    estimatedMinutes,
    objectives,
    exerciseCount: exercises.length,
  }),
);
await writeFile(
  "cloudflare/generated/catalog.ts",
  `export const summaries=${JSON.stringify(summaries)};\nexport const lessons: Record<string,string>=${JSON.stringify(Object.fromEntries(lessons.map((l) => [l.id, JSON.stringify(l)])))};\n`,
);
const child = Bun.spawn(
  [
    "bun",
    "x",
    "vite",
    "build",
    "--config",
    "vite.cloudflare.config.ts",
    "--mode",
    staticOnly ? "localcourse" : "production",
  ],
  {
    stdout: "inherit",
    stderr: "inherit",
  },
);
if (await child.exited) throw Error("Vite failed");
await copyFile("dist/pages/cloudflare/site/index.html", "dist/pages/index.html");
await rm("dist/pages/cloudflare", { recursive: true });
if (!staticOnly) {
  await copyFile("cloudflare/pages-worker.js", "dist/pages/_worker.js");
  await writeFile(
    "dist/pages/_routes.json",
    JSON.stringify({ version: 1, include: ["/api/*"], exclude: [] }),
  );
} else {
  await mkdir("dist/pages/course/lessons", { recursive: true });
  await writeFile("dist/pages/course/catalog.json", JSON.stringify(summaries));
  for (const lesson of lessons)
    await writeFile(`dist/pages/course/lessons/${lesson.id}.json`, JSON.stringify(lesson));
}
await writeFile(
  "dist/pages/_headers",
  "/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: same-origin\n  X-Frame-Options: DENY\n  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'\n",
);
console.log(
  `Built ${lessons.length} lessons for ${staticOnly ? "static Pages" : "Pages and Worker"}; no learner records included.`,
);

await mkdir("dist/pages/audio", { recursive: true });
let audio: Record<string, { url: string; generationId: string; sha256: string }> = {};
try {
  audio = JSON.parse(await readFile("data/course-audio/manifest.json", "utf8"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw Error("Invalid audio manifest");
}
for (const a of Object.values(audio)) {
  if (!/^[a-f0-9]{64}$/.test(a.generationId) || a.url !== `/audio/${a.generationId}.mp3`)
    throw Error("Invalid audio manifest");
  const bytes = await Bun.file(`data/course-audio/${a.generationId}.mp3`).arrayBuffer();
  if (
    bytes.byteLength > 25 * 1024 * 1024 ||
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !== a.sha256
  )
    throw Error("Audio integrity failed");
  await copyFile(
    `data/course-audio/${a.generationId}.mp3`,
    `dist/pages/audio/${a.generationId}.mp3`,
  );
}
await writeFile("dist/pages/audio/manifest.json", JSON.stringify(audio));

await mkdir("dist/pages/licenses",{recursive:true});
await copyFile("src/client/assets/source-serif4-OFL.txt","dist/pages/licenses/source-serif4-OFL.txt");
