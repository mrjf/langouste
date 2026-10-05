import worker from "../../cloudflare/worker.ts";
export { AccountCoordinator } from "../../cloudflare/worker.ts";
export default {
  fetch(req: Request, env: any) {
    return new URL(req.url).pathname.startsWith("/api/")
      ? worker.fetch(req, env)
      : env.ASSETS.fetch(req);
  },
};
