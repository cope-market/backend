import {writeFileSync} from "node:fs";
import {buildOpenApiDocument} from "../lib/api-schema/openapi";

/// Writes the OpenAPI document to disk. The result is committed, so a reviewer sees the API change
/// in the diff and a client generator can fetch it without running this project.
const target = new URL("../public/openapi.json", import.meta.url);
writeFileSync(target, `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`);
console.log(`wrote ${target.pathname}`);
