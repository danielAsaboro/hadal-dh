import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

export function registerUiStaticRoutes(server: FastifyInstance, root: string): void {
  void server.register(fastifyStatic, { root, wildcard: false });
  server.get("/workspace", async (_request, reply) => await reply.sendFile("index.html"));
  server.get("/workspace/*", async (_request, reply) => await reply.sendFile("index.html"));
}
