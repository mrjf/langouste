import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { apiRoutes } from "./routes/index.ts";
import { config } from "./lib/config.ts";

const app = new Hono();

// Global error handler — always return JSON for API errors
app.onError((err, c) => {
  console.error(`${c.req.method} - ${c.req.url} failed`);
  console.error(err);
  return c.json({ error: err.message || "Internal server error" }, 500);
});

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// API routes
app.route("/api", apiRoutes);

// In production, serve the Vite build output
app.use("/assets/*", serveStatic({ root: "./dist/client" }));

// SPA fallback — serve index.html for all other routes
app.get("*", async (c) => {
  const html = await Bun.file("./dist/client/index.html").text();
  return c.html(html);
});

console.log(`Langouste listening on :${config.port}`);
export default {
  port: config.port,
  reusePort: true,
  fetch: app.fetch,
};
