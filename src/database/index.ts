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

// Session types for session memory feature
export interface Session {
  id: number;
  name: string | null;
  started_at: string;
  ended_at: string | null;
  summary: string | null;
  is_active: boolean;
}

export interface SessionMessage {
  id: number;
  session_id: number;
  role: "user" | "agent";
  content: string;
  created_at: string;
}

interface SessionRecord {
  id: number;
  name: string | null;
  started_at: string;
  ended_at: string | null;
  summary: string | null;
  is_active: number;
}

interface SessionMessageRecord {
  id: number;
  session_id: number;
  role: string;
  content: string;
  created_at: string;
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

  // Session tables for session memory feature
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      summary TEXT,
      is_active INTEGER DEFAULT 1
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS session_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  // Create indexes
  db.run(`CREATE INDEX IF NOT EXISTS idx_tags ON knowledge_entries(tags)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_created ON knowledge_entries(created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_session_messages ON session_messages(session_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(is_active)`);

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

// ============================================================================
// Session Memory Functions
// ============================================================================

const SESSION_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

/**
 * Create a new session.
 */
export function createSession(name?: string): number {
  const database = initDatabase();
  const now = new Date().toISOString();

  const stmt = database.prepare(`
    INSERT INTO sessions (name, started_at, is_active)
    VALUES (?, ?, 1)
  `);

  const result = stmt.run(name || null, now);
  return Number(result.lastInsertRowid);
}

/**
 * Get a session by ID.
 */
export function getSession(id: number): Session | null {
  const database = initDatabase();
  const record = database.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRecord | undefined;

  if (!record) return null;

  return {
    id: record.id,
    name: record.name,
    started_at: record.started_at,
    ended_at: record.ended_at,
    summary: record.summary,
    is_active: record.is_active === 1,
  };
}

/**
 * Get the current active session (most recent).
 */
export function getActiveSession(): Session | null {
  const database = initDatabase();
  const record = database.prepare(
    "SELECT * FROM sessions WHERE is_active = 1 ORDER BY id DESC LIMIT 1"
  ).get() as SessionRecord | undefined;

  if (!record) return null;

  return {
    id: record.id,
    name: record.name,
    started_at: record.started_at,
    ended_at: record.ended_at,
    summary: record.summary,
    is_active: record.is_active === 1,
  };
}

/**
 * End a session.
 */
export function endSession(id: number, summary?: string): boolean {
  const database = initDatabase();
  const now = new Date().toISOString();

  const stmt = database.prepare(`
    UPDATE sessions 
    SET ended_at = ?, summary = ?, is_active = 0
    WHERE id = ?
  `);

  const result = stmt.run(now, summary || null, id);
  return result.changes > 0;
}

/**
 * Save a message to a session.
 */
export function saveSessionMessage(sessionId: number, role: "user" | "agent", content: string): number {
  const database = initDatabase();
  const now = new Date().toISOString();

  const stmt = database.prepare(`
    INSERT INTO session_messages (session_id, role, content, created_at)
    VALUES (?, ?, ?, ?)
  `);

  const result = stmt.run(sessionId, role, content, now);
  return Number(result.lastInsertRowid);
}

/**
 * Get all messages for a session.
 */
export function getSessionMessages(sessionId: number): SessionMessage[] {
  const database = initDatabase();
  const records = database.prepare(
    "SELECT * FROM session_messages WHERE session_id = ? ORDER BY created_at ASC"
  ).all(sessionId) as SessionMessageRecord[];

  return records.map(record => ({
    id: record.id,
    session_id: record.session_id,
    role: record.role as "user" | "agent",
    content: record.content,
    created_at: record.created_at,
  }));
}

/**
 * List all sessions.
 */
export function listSessions(options: { limit?: number; offset?: number; activeOnly?: boolean } = {}): Session[] {
  const database = initDatabase();
  const { limit = 20, offset = 0, activeOnly = false } = options;

  let sql = "SELECT * FROM sessions";
  if (activeOnly) {
    sql += " WHERE is_active = 1";
  }
  sql += " ORDER BY started_at DESC LIMIT ? OFFSET ?";

  const records = database.prepare(sql).all(limit, offset) as SessionRecord[];

  return records.map(record => ({
    id: record.id,
    name: record.name,
    started_at: record.started_at,
    ended_at: record.ended_at,
    summary: record.summary,
    is_active: record.is_active === 1,
  }));
}

/**
 * Get session message count.
 */
export function getSessionMessageCount(sessionId: number): number {
  const database = initDatabase();
  const result = database.prepare(
    "SELECT COUNT(*) as count FROM session_messages WHERE session_id = ?"
  ).get(sessionId) as { count: number };
  return result.count;
}

/**
 * Close timed-out sessions (inactive for more than 1 hour).
 */
export function closeTimedOutSessions(): number {
  const database = initDatabase();
  const cutoff = new Date(Date.now() - SESSION_TIMEOUT_MS).toISOString();

  // Find sessions where last message is older than cutoff
  const stmt = database.prepare(`
    UPDATE sessions 
    SET is_active = 0, ended_at = CURRENT_TIMESTAMP, summary = 'Auto-closed due to inactivity'
    WHERE is_active = 1 AND id IN (
      SELECT s.id FROM sessions s
      LEFT JOIN (
        SELECT session_id, MAX(created_at) as last_msg 
        FROM session_messages 
        GROUP BY session_id
      ) m ON s.id = m.session_id
      WHERE s.is_active = 1 
      AND (m.last_msg IS NULL OR m.last_msg < ?)
      AND s.started_at < ?
    )
  `);

  const result = stmt.run(cutoff, cutoff);
  return result.changes;
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
