import { Hono } from "hono";
import { config } from "../lib/config.ts";
import { authRoutes } from "./api/auth.ts";
import { profileRoutes } from "./api/profile.ts";
import { profileStatsRoutes } from "./api/profile-stats.ts";
import { conversationRoutes } from "./api/conversations.ts";
import { messageRoutes } from "./api/messages.ts";
import { reviewRoutes } from "./api/review.ts";
import { agentConnectorRoutes } from "./api/agent-connectors.ts";
import { dictionaryRoutes } from "./api/dictionary.ts";

export const apiRoutes = new Hono();

apiRoutes.route("/auth", authRoutes);
apiRoutes.route("/profile", profileRoutes);
apiRoutes.route("/profile", profileStatsRoutes);
apiRoutes.route("/conversations", conversationRoutes);
apiRoutes.route("/messages", messageRoutes);
apiRoutes.route("/review", reviewRoutes);
apiRoutes.route("/agent-connectors", agentConnectorRoutes);
apiRoutes.route("/dictionary", dictionaryRoutes);

if (config.testMode) {
  // Loaded lazily so production builds don't ship test-only code.
  const { testRoutes } = await import("./api/test.ts");
  apiRoutes.route("/test", testRoutes);
  console.log("[routes] test mode — /api/test/* routes mounted");
}
