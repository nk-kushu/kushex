import { createServer } from "node:http";
import process from "node:process";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);

if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error("PORT must be an integer between 0 and 65535.");
}

const server = createServer((request, response) => {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  if (request.url?.split("?")[0] === "/health") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }
    response.writeHead(200);
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }
  response.writeHead(404);
  response.end(JSON.stringify({ error: "Not found" }));
});

server.on("error", (error) => {
  console.error("Server error:", error);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  const address = server.address();
  if (address && typeof address !== "string") {
    console.info(`Server listening on http://${host}:${address.port}`);
  }
});

function shutdown() {
  console.info("Shutting down server...");
  const timeout = setTimeout(() => {
    server.closeAllConnections();
    process.exit(1);
  }, 10_000);
  timeout.unref();
  server.close((error) => {
    clearTimeout(timeout);
    if (error) {
      console.error("Shutdown error:", error);
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
