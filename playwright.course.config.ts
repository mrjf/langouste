/** Uses installed Chrome for course QA; no bundled browser download required. */
import config from "./playwright.config";
export default { ...config, projects: [{ name: "installed-chrome", use: { browserName: "chromium" as const, channel: "chrome" } }] };
