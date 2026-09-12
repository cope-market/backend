const PORT = process.env["VERIFY_PORT"] ?? "4301";
import type {ApiRequestError} from "../lib/api-client/client";
import {createApiClient} from "../lib/api-client/client";

const api = createApiClient({
  baseUrl: `http://localhost:${PORT}/api/v1`,
  getAccessToken: async () => null,
});

const {chains} = await api.getChains({});
console.log("getChains   ->", chains[0]!.chainId, chains[0]!.contracts.syntheticVault);

const {assets} = await api.listAssets({});
console.log("listAssets  ->", assets.map((a) => a.symbol).join(", "));

try {
  await api.getMe({});
  console.log("getMe       -> UNEXPECTEDLY SUCCEEDED");
} catch (error) {
  const e = error as ApiRequestError;
  console.log("getMe       ->", e.code, `(${e.status})`);
}

const authed = createApiClient({
  baseUrl: `http://localhost:${PORT}/api/v1`,
  getAccessToken: async () => "not-a-real-token",
});
try {
  await authed.getMe({});
} catch (error) {
  const e = error as ApiRequestError;
  console.log("getMe+token ->", e.code, `(${e.status})`, e.message);
}

try {
  await api.getUser({params: {handle: "nobody"}});
} catch (error) {
  const e = error as ApiRequestError;
  console.log("getUser     ->", e.code, `(${e.status})`);
}
