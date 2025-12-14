/**
 * Database module for knowledge entries using Bun's native SQLite.
 */
import { Database } from "bun:sqlite";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";

// Use persistent user data directory (XDG-compliant on Linux)
const DATA_DIR = process.env.OPENCODE_PK_DATA_DIR || join(homedir(), ".local", "share", "opencode-personal-knowledge");
const DB_PATH = join(DATA_DIR, "knowledge.db");

export interface KnowledgeEntry {
  id?: number;
  title: string;
  content: string;
  source?: string;
  tags?: string[];
  created_at: string;
  updated_at: string;
}

export interface KnowledgeRecord {
  id: number;
  title: string;
  content: string;
  source: string | null;
  tags: string | null; // JSON string
  created_at: string;
  updated_at: string;
}

let db: Database | null = null;

/**
 * Ensure data directory exists.
 */
function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Initialize the database connection and create tables if needed.
 */
export function initDatabase(): Database {
  if (db) return db;

  ensureDataDir();
  db = new Database(DB_PATH, { create: true });

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

  // Create indexes
  db.run(`CREATE INDEX IF NOT EXISTS idx_tags ON knowledge_entries(tags)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_created ON knowledge_entries(created_at)`);

  return db;
}

/**
 * Save a new knowledge entry.
 */
export function saveKnowledgeEntry(entry: Omit<KnowledgeEntry, "id" | "created_at" | "updated_at">): number {
  const database = initDatabase();
  const now = new Date().toISOString();
  const tagsJson = entry.tags ? JSON.stringify(entry.tags) : null;

  const stmt = database.prepare(`
    INSERT INTO knowledge_entries (title, content, source, tags, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(entry.title, entry.content, entry.source || null, tagsJson, now, now);
  return Number(result.lastInsertRowid);
}

/**
 * Get a knowledge entry by ID.
 */
export function getKnowledgeEntry(id: number): KnowledgeEntry | null {
  const database = initDatabase();
  const record = database.prepare("SELECT * FROM knowledge_entries WHERE id = ?").get(id) as KnowledgeRecord | undefined;
  
  if (!record) return null;
  
  return {
    id: record.id,
    title: record.title,
    content: record.content,
    source: record.source || undefined,
    tags: record.tags ? JSON.parse(record.tags) : undefined,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

/**
 * Update an existing knowledge entry.
 */
export function updateKnowledgeEntry(
  id: number,
  updates: Partial<Pick<KnowledgeEntry, "title" | "content" | "source" | "tags">>
): boolean {
  const database = initDatabase();
  const existing = getKnowledgeEntry(id);
  if (!existing) return false;

  const now = new Date().toISOString();
  const newTitle = updates.title ?? existing.title;
  const newContent = updates.content ?? existing.content;
  const newSource = updates.source ?? existing.source ?? null;
  const newTags = updates.tags ? JSON.stringify(updates.tags) : (existing.tags ? JSON.stringify(existing.tags) : null);

  const stmt = database.prepare(`
    UPDATE knowledge_entries 
    SET title = ?, content = ?, source = ?, tags = ?, updated_at = ?
    WHERE id = ?
  `);

  stmt.run(newTitle, newContent, newSource, newTags, now, id);
  return true;
}

/**
 * Delete a knowledge entry.
 */
export function deleteKnowledgeEntry(id: number): boolean {
  const database = initDatabase();
  const result = database.prepare("DELETE FROM knowledge_entries WHERE id = ?").run(id);
  return result.changes > 0;
}

/**
 * List knowledge entries with optional filters.
 */
export function listKnowledgeEntries(options: {
  limit?: number;
  offset?: number;
  tags?: string[];
}): KnowledgeEntry[] {
  const database = initDatabase();
  const { limit = 20, offset = 0, tags } = options;

  let sql = "SELECT * FROM knowledge_entries";
  const params: (string | number)[] = [];

  if (tags && tags.length > 0) {
    // Search for any tag match in JSON array
    const tagConditions = tags.map(() => "tags LIKE ?").join(" OR ");
    sql += ` WHERE (${tagConditions})`;
    params.push(...tags.map(t => `%"${t}"%`));
  }

  sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const records = database.prepare(sql).all(...params) as KnowledgeRecord[];

  return records.map(record => ({
    id: record.id,
    title: record.title,
    content: record.content,
    source: record.source || undefined,
    tags: record.tags ? JSON.parse(record.tags) : undefined,
    created_at: record.created_at,
    updated_at: record.updated_at,
  }));
}

/**
 * Search knowledge entries by text.
 */
export function searchKnowledgeByText(query: string, limit = 10): KnowledgeEntry[] {
  const database = initDatabase();
  
  // Split query into words for OR search
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  
  if (words.length === 0) {
    return [];
  }

  const conditions = words.map(() => 
    "(LOWER(title) LIKE ? OR LOWER(content) LIKE ?)"
  ).join(" OR ");
  
  const params = words.flatMap(w => [`%${w}%`, `%${w}%`]);

  const records = database.prepare(`
    SELECT * FROM knowledge_entries 
    WHERE ${conditions}
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(...params, limit) as KnowledgeRecord[];

  return records.map(record => ({
    id: record.id,
    title: record.title,
    content: record.content,
    source: record.source || undefined,
    tags: record.tags ? JSON.parse(record.tags) : undefined,
    created_at: record.created_at,
    updated_at: record.updated_at,
  }));
}

/**
 * Get all entries for vector conversion.
 */
export function getAllEntries(): KnowledgeEntry[] {
  const database = initDatabase();
  const records = database.prepare("SELECT * FROM knowledge_entries ORDER BY id").all() as KnowledgeRecord[];

  return records.map(record => ({
    id: record.id,
    title: record.title,
    content: record.content,
    source: record.source || undefined,
    tags: record.tags ? JSON.parse(record.tags) : undefined,
    created_at: record.created_at,
    updated_at: record.updated_at,
  }));
}

/**
 * Get database statistics.
 */
export function getStats(): {
  totalEntries: number;
  tagCounts: Record<string, number>;
  oldestEntry: string | null;
  newestEntry: string | null;
} {
  const database = initDatabase();

  const countResult = database.prepare("SELECT COUNT(*) as count FROM knowledge_entries").get() as { count: number };
  
  const oldest = database.prepare("SELECT MIN(created_at) as oldest FROM knowledge_entries").get() as { oldest: string | null };
  const newest = database.prepare("SELECT MAX(created_at) as newest FROM knowledge_entries").get() as { newest: string | null };

  // Count tags
  const allTags = database.prepare("SELECT tags FROM knowledge_entries WHERE tags IS NOT NULL").all() as { tags: string }[];
  const tagCounts: Record<string, number> = {};
  
  for (const row of allTags) {
    const tags = JSON.parse(row.tags) as string[];
    for (const tag of tags) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
  }

  return {
    totalEntries: countResult.count,
    tagCounts,
    oldestEntry: oldest.oldest,
    newestEntry: newest.newest,
  };
}

/**
 * Close the database connection.
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
