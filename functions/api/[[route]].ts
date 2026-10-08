import { handle } from "hono/cloudflare-pages";
import { app } from "../../src/server/app";

export const onRequest = handle(app);
