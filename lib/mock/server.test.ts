import {describe, expect, it} from "vitest";
import {BASE_PATH, findRoute, handleRequest} from "./server";

const authed = {authorization: "Bearer tok"};

describe("routing", () => {
  it("matches a static path", () => {
    expect(findRoute("GET", `${BASE_PATH}/assets`)?.operationId).toBe("listAssets");
  });

  it("matches a path with a parameter", () => {
    expect(findRoute("GET", `${BASE_PATH}/users/alice`)?.operationId).toBe("getUser");
  });

  it("distinguishes routes by method on the same path", () => {
    expect(findRoute("POST", `${BASE_PATH}/users/alice/follow`)?.operationId).toBe("followUser");
    expect(findRoute("DELETE", `${BASE_PATH}/users/alice/follow`)?.operationId).toBe(
      "unfollowUser",
    );
  });

  /// "theses/{id}" and "theses/{id}/comments" differ only in length, so a matcher that ignored
  /// segment count would serve the wrong one.
  it("does not match a path with extra segments", () => {
    expect(findRoute("GET", `${BASE_PATH}/theses/abc/comments`)?.operationId).toBe("listComments");
    expect(findRoute("GET", `${BASE_PATH}/theses/abc`)?.operationId).toBe("getThesis");
  });

  it("returns 404 for an unknown path", () => {
    expect(handleRequest("GET", `${BASE_PATH}/nope`, {}).status).toBe(404);
  });
});

describe("responses", () => {
  it("serves the fixture for a public route", () => {
    const response = handleRequest("GET", `${BASE_PATH}/assets`, {});
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body).assets).toHaveLength(4);
  });

  it("serves query strings without confusing the matcher", () => {
    expect(handleRequest("GET", `${BASE_PATH}/feed?tab=top&limit=5`, {}).status).toBe(200);
  });

  /// The client has signed-out paths, and they can only be exercised if the mock refuses.
  it("rejects an authenticated route with no bearer token", () => {
    const response = handleRequest("GET", `${BASE_PATH}/me`, {});
    expect(response.status).toBe(401);
    expect(JSON.parse(response.body).error.code).toBe("UNAUTHORIZED");
  });

  it("accepts an authenticated route with any bearer token", () => {
    expect(handleRequest("GET", `${BASE_PATH}/me`, authed).status).toBe(200);
  });
});

describe("browser access", () => {
  it("sets permissive CORS headers", () => {
    const response = handleRequest("GET", `${BASE_PATH}/assets`, {});
    expect(response.headers["access-control-allow-origin"]).toBe("*");
  });

  it("answers a preflight", () => {
    const response = handleRequest("OPTIONS", `${BASE_PATH}/me`, {});
    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-headers"]).toContain("authorization");
  });
});
