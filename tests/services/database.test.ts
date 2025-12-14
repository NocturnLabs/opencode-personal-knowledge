import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "path";
import { existsSync, unlinkSync, mkdirSync } from "fs";

// Test with a separate test database
const TEST_DIR = join(import.meta.dir, "../../test-data");
const TEST_DB_PATH = join(TEST_DIR, "test_knowledge.db");

describe("database", () => {
  let db: Database;

  beforeAll(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
    db = new Database(TEST_DB_PATH, { create: true });
    db.run(`
      CREATE TABLE IF NOT EXISTS knowledge_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        source TEXT,
        tags TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
  });

  afterAll(() => {
    db.close();
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
  });

  test("can insert a knowledge entry", () => {
    const stmt = db.prepare(`
      INSERT INTO knowledge_entries 
      (title, content, source, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const now = new Date().toISOString();
    stmt.run("Test Title", "Test content here", "https://example.com", '["test","demo"]', now, now);

    const count = db.prepare("SELECT COUNT(*) as count FROM knowledge_entries").get() as { count: number };
    expect(count.count).toBe(1);
  });

  test("can query entries", () => {
    const records = db.prepare("SELECT * FROM knowledge_entries").all();
    expect(records.length).toBeGreaterThan(0);
  });

  test("can search by title", () => {
    const records = db.prepare(
      "SELECT * FROM knowledge_entries WHERE LOWER(title) LIKE ?"
    ).all("%test%");
    expect(records.length).toBe(1);
  });

  test("can search by content", () => {
    const records = db.prepare(
      "SELECT * FROM knowledge_entries WHERE LOWER(content) LIKE ?"
    ).all("%content%");
    expect(records.length).toBe(1);
  });

  test("can parse tags JSON", () => {
    const record = db.prepare("SELECT tags FROM knowledge_entries WHERE id = 1").get() as { tags: string };
    const tags = JSON.parse(record.tags);
    expect(tags).toEqual(["test", "demo"]);
  });

  test("can update an entry", () => {
    const now = new Date().toISOString();
    db.prepare("UPDATE knowledge_entries SET title = ?, updated_at = ? WHERE id = ?").run("Updated Title", now, 1);
    
    const record = db.prepare("SELECT title FROM knowledge_entries WHERE id = 1").get() as { title: string };
    expect(record.title).toBe("Updated Title");
  });

  test("can delete an entry", () => {
    db.prepare("DELETE FROM knowledge_entries WHERE id = ?").run(1);
    
    const count = db.prepare("SELECT COUNT(*) as count FROM knowledge_entries").get() as { count: number };
    expect(count.count).toBe(0);
  });
});
