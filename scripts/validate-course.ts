import { validateCourseBundle } from "../src/services/course/catalog.ts";
const path = Bun.argv[2];
if (!path) throw new Error("Usage: bun scripts/validate-course.ts BUNDLE.json");
const bundle = validateCourseBundle(await Bun.file(path).json());
console.log(
  `Validated ${bundle.lessons.length} lessons and ${bundle.sourceRegistry.length} dated sources`,
);
