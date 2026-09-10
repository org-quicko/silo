import { describe, expect, test } from "bun:test";
import { ApiPath } from "../../src/transport/api-path";

describe("ApiPath", () => {
  test("health and instance search take no segments", () => {
    expect(ApiPath.health()).toBe("/api/health");
    expect(ApiPath.instanceSearch()).toBe("/api/search");
  });

  test("projects", () => {
    expect(ApiPath.projects()).toBe("/api/projects");
    expect(ApiPath.project("acme")).toBe("/api/projects/acme");
  });

  test("environments use /envs/, not /environments/", () => {
    expect(ApiPath.environments("acme")).toBe("/api/projects/acme/envs");
    expect(ApiPath.environment("acme", "prod")).toBe("/api/projects/acme/envs/prod");
  });

  test("project and environment variables", () => {
    expect(ApiPath.projectVariables("acme")).toBe("/api/projects/acme/variables");
    expect(ApiPath.projectVariable("acme", "API_URL")).toBe("/api/projects/acme/variables/API_URL");
    expect(ApiPath.environmentVariables("acme", "prod")).toBe("/api/projects/acme/envs/prod/variables");
    expect(ApiPath.environmentVariable("acme", "prod", "API_URL")).toBe(
      "/api/projects/acme/envs/prod/variables/API_URL",
    );
  });

  test("collections and schemas", () => {
    expect(ApiPath.collections("acme", "prod")).toBe("/api/projects/acme/envs/prod/collections");
    expect(ApiPath.collection("acme", "prod", "posts")).toBe("/api/projects/acme/envs/prod/collections/posts");
    expect(ApiPath.schemas("acme", "prod")).toBe("/api/projects/acme/envs/prod/schemas");
    expect(ApiPath.collectionSchema("acme", "prod", "posts")).toBe(
      "/api/projects/acme/envs/prod/collections/posts/schema",
    );
  });

  test("entries", () => {
    expect(ApiPath.entries("acme", "prod", "posts")).toBe("/api/projects/acme/envs/prod/collections/posts");
    expect(ApiPath.entry("acme", "prod", "posts", "01J8")).toBe(
      "/api/projects/acme/envs/prod/collections/posts/01J8",
    );
  });

  test("search reaches", () => {
    expect(ApiPath.collectionSearch("acme", "prod", "posts")).toBe(
      "/api/projects/acme/envs/prod/collections/posts/search",
    );
    expect(ApiPath.environmentSearch("acme", "prod")).toBe("/api/projects/acme/envs/prod/search");
  });

  test("media", () => {
    expect(ApiPath.media()).toBe("/api/media");
    expect(ApiPath.mediaExtensions()).toBe("/api/media/extensions");
    expect(ApiPath.mediaAsset("01J8")).toBe("/api/media/01J8");
    expect(ApiPath.mediaAssetUsages("01J8")).toBe("/api/media/01J8/usages");
    expect(ApiPath.mediaBulkDelete()).toBe("/api/media/delete");
    expect(ApiPath.mediaFolders()).toBe("/api/media/folders");
  });

  test("every dynamic segment is encoded, including a slash and a space", () => {
    expect(ApiPath.project("a/b")).toBe("/api/projects/a%2Fb");
    expect(ApiPath.project("a b")).toBe("/api/projects/a%20b");
    expect(ApiPath.environment("acme", "a/b")).toBe("/api/projects/acme/envs/a%2Fb");
    expect(ApiPath.collection("acme", "prod", "a/b c")).toBe(
      "/api/projects/acme/envs/prod/collections/a%2Fb%20c",
    );
    expect(ApiPath.entry("acme", "prod", "posts", "a/b")).toBe(
      "/api/projects/acme/envs/prod/collections/posts/a%2Fb",
    );
    expect(ApiPath.mediaAsset("a/b")).toBe("/api/media/a%2Fb");
    expect(ApiPath.projectVariable("acme", "a/b")).toBe("/api/projects/acme/variables/a%2Fb");
    expect(ApiPath.environmentVariable("acme", "prod", "a/b")).toBe(
      "/api/projects/acme/envs/prod/variables/a%2Fb",
    );
  });
});
