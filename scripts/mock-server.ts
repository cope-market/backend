import {createServer} from "node:http";
import {readFileSync} from "node:fs";
import {BASE_PATH, describeRoutes, handleRequest} from "../lib/mock/server";

/// Runs the mock API. No database, no chain, no environment to configure.
///
///   npm run mock            serves on 4000
///   PORT=4100 npm run mock  serves elsewhere

const port = Number(process.env["PORT"] ?? 4000);

let openapi: string | null = null;
try {
  openapi = readFileSync(new URL("../public/openapi.json", import.meta.url), "utf8");
} catch {
  // Generated artifact; the mock still works without it.
}

const server = createServer((request, response) => {
  const url = request.url ?? "/";
  const method = request.method ?? "GET";

  if (openapi && url.startsWith(`${BASE_PATH}/openapi.json`)) {
    response.writeHead(200, {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    });
    response.end(openapi);
    return;
  }

  const result = handleRequest(method, url, request.headers as Record<string, string | undefined>);
  process.stdout.write(`${method} ${url} -> ${result.status}\n`);
  response.writeHead(result.status, result.headers);
  response.end(result.body);
});

server.listen(port, () => {
  process.stdout.write(
    [
      `Cope Market mock API on http://localhost:${port}${BASE_PATH}`,
      "",
      "Every route answers with a fixture. Writes are not remembered.",
      "Authenticated routes need any `Authorization: Bearer <anything>` header.",
      "",
      describeRoutes(),
      "",
      `Spec: http://localhost:${port}${BASE_PATH}/openapi.json`,
      "",
    ].join("\n"),
  );
});
