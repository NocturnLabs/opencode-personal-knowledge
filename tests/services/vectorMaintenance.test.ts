/**
 * Vector Maintenance Tests
 *
 * Covers the throttled background optimize that keeps LanceDB _versions
 * from growing without bound. Uses an isolated OPENCODE_PK_DATA_DIR and
 * fake vectors (no embedding model download).
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, readdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import lancedb from "@lancedb/lancedb";

// Isolated data dir BEFORE any service import (module reads env at load)
const testDir = mkdtempSync(join(tmpdir(), "opencode-pk-vectors-"));
process.env.OPENCODE_PK_DATA_DIR = testDir;

type VectorServiceModule = typeof import("../../src/services/vectorService");

let vs: VectorServiceModule;

function fakeRecord(id: number) {
  return {
    id,
    title: `t${id}`,
    content_preview: "preview",
    tags: "[]",
    vector: Array(8).fill(0.1),
  };
}

function versionCount(): number {
  return readdirSync(join(testDir, "vectors", "knowledge_vectors.lance", "_versions")).length;
}

describe("Vector Maintenance", () => {
  beforeAll(async () => {
    vs = await import("../../src/services/vectorService");
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("shouldOptimize", () => {
    test("false below minimum writes", () => {
      expect(vs.shouldOptimize(Date.now(), { lastOptimize: null, writesSinceOptimize: 0 })).toBe(false);
      expect(vs.shouldOptimize(Date.now(), { lastOptimize: null, writesSinceOptimize: 199 })).toBe(false);
    });

    test("true when never optimized and threshold reached", () => {
      expect(vs.shouldOptimize(Date.now(), { lastOptimize: null, writesSinceOptimize: 200 })).toBe(true);
    });

    test("false when recently optimized", () => {
      const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      expect(vs.shouldOptimize(Date.now(), { lastOptimize: recent, writesSinceOptimize: 500 })).toBe(false);
    });

    test("true when last optimize older than interval", () => {
      const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      expect(vs.shouldOptimize(Date.now(), { lastOptimize: old, writesSinceOptimize: 200 })).toBe(true);
    });

    test("true on unparsable timestamp", () => {
      expect(vs.shouldOptimize(Date.now(), { lastOptimize: "garbage", writesSinceOptimize: 200 })).toBe(true);
    });
  });

  describe("optimizeVectorDB", () => {
    test("prunes old versions and preserves rows", async () => {
      const db = await lancedb.connect(join(testDir, "vectors"));
      await db.createTable("knowledge_vectors", [fakeRecord(1)]);
      const table = await db.openTable("knowledge_vectors");
      await table.add([fakeRecord(2)]);
      await table.add([fakeRecord(3)]);
      expect(await table.countRows()).toBe(3);
      expect(versionCount()).toBeGreaterThan(1);

      const stats = await vs.optimizeVectorDB();

      expect(await table.countRows()).toBe(3);
      expect(stats.oldVersionsRemoved).toBeGreaterThan(0);
      expect(versionCount()).toBeLessThanOrEqual(2);

      const stateFile = join(testDir, ".vector-maintenance.json");
      expect(existsSync(stateFile)).toBe(true);
      const state = JSON.parse(readFileSync(stateFile, "utf-8"));
      expect(state.writesSinceOptimize).toBe(0);
      expect(typeof state.lastOptimize).toBe("string");
    });

    test("missing table returns zeros", async () => {
      const db = await lancedb.connect(join(testDir, "vectors"));
      await db.dropTable("knowledge_vectors");
      const stats = await vs.optimizeVectorDB();
      expect(stats).toEqual({ oldVersionsRemoved: 0, bytesRemoved: 0, fragmentsRemoved: 0, fragmentsAdded: 0 });
    });
  });

  describe("maybeOptimizeVectorDB", () => {
    test("records writes without throwing when not due", async () => {
      await vs.maybeOptimizeVectorDB();
      const state = JSON.parse(readFileSync(join(testDir, ".vector-maintenance.json"), "utf-8"));
      expect(state.writesSinceOptimize).toBeGreaterThanOrEqual(1);
    });
  });
});
