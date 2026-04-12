import { Hono } from "hono";
import { authRoutes } from "./api/auth.ts";
import { profileRoutes } from "./api/profile.ts";
import { conversationRoutes } from "./api/conversations.ts";
import { messageRoutes } from "./api/messages.ts";
import { reviewRoutes } from "./api/review.ts";

export const apiRoutes = new Hono();

apiRoutes.route("/auth", authRoutes);
apiRoutes.route("/profile", profileRoutes);
apiRoutes.route("/conversations", conversationRoutes);
apiRoutes.route("/messages", messageRoutes);
apiRoutes.route("/review", reviewRoutes);
