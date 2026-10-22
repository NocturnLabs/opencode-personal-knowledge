/**
 * Vector Database Service
 * 
 * Provides semantic search over knowledge entries using LanceDB and FastEmbed.
 * Uses Flag Embedding model which auto-downloads on first use.
 */
import lancedb from "@lancedb/lancedb";
import { EmbeddingModel, FlagEmbedding } from "fastembed";
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { getAllEntries, type KnowledgeEntry } from "../database/index.js";

// Use persistent user data directory (XDG-compliant on Linux)
const DATA_DIR = process.env.OPENCODE_PK_DATA_DIR || join(homedir(), ".local", "share", "opencode-personal-knowledge");
const VECTOR_DB_PATH = join(DATA_DIR, "vectors");

// Throttled vector-store maintenance (see maybeOptimizeVectorDB).
// Every LanceDB write commits a new dataset version; without periodic
// cleanup _versions grows without bound (~1 GB/day under per-message
// session logging). Optimize at most once per interval and only after a
// minimum number of writes, in the background so tool calls stay fast.
const MAINTENANCE_STATE_FILE = join(DATA_DIR, ".vector-maintenance.json");
const OPTIMIZE_MIN_WRITES = 200;
const OPTIMIZE_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface MaintenanceState {
  lastOptimize: string | null;
  writesSinceOptimize: number;
}

function readMaintenanceState(): MaintenanceState {
  const fallback: MaintenanceState = { lastOptimize: null, writesSinceOptimize: 0 };
  try {
    if (!existsSync(MAINTENANCE_STATE_FILE)) return fallback;
    const parsed = JSON.parse(readFileSync(MAINTENANCE_STATE_FILE, "utf-8"));
    return {
      lastOptimize: typeof parsed.lastOptimize === "string" ? parsed.lastOptimize : null,
      writesSinceOptimize: typeof parsed.writesSinceOptimize === "number" ? parsed.writesSinceOptimize : 0,
    };
  } catch {
    return fallback;
  }
}

function writeMaintenanceState(state: MaintenanceState): void {
  try {
    writeFileSync(MAINTENANCE_STATE_FILE, JSON.stringify(state), "utf-8");
  } catch {
    // Maintenance bookkeeping must never break vector writes
  }
}

// Singleton embedding model
let embeddingModel: FlagEmbedding | null = null;

/**
 * Get or initialize the embedding model.
 */
async function getEmbeddingModel(): Promise<FlagEmbedding> {
  if (!embeddingModel) {
    console.error("Loading embedding model (first run may download model files)...");
    embeddingModel = await FlagEmbedding.init({ model: EmbeddingModel.BGESmallENV15 });
    console.error("Embedding model loaded.");
  }
  return embeddingModel;
}

/**
 * Generate embedding for text.
 */
export async function embed(text: string): Promise<number[]> {
  const model = await getEmbeddingModel();
  const embeddings = await model.embed([text]);
  // Get the first (and only) embedding from the async iterator
  for await (const batch of embeddings) {
    // batch is number[][] (batch of embeddings), we want the first one
    if (batch.length > 0) {
      return Array.from(batch[0]);
    }
  }
  return [];
}

/**
 * Vector record with embedding.
 */
export interface VectorRecord {
  [key: string]: unknown;
  id: number;
  title: string;
  content_preview: string;
  tags: string | null;
  vector: number[];
}

/**
 * Search result from vector query.
 */
export interface SearchResult {
  id: number;
  title: string;
  content_preview: string;
  tags: string[];
  score: number;
}

/**
 * Ensure data directory exists.
 */
function ensureDataDir(): void {
  if (!existsSync(VECTOR_DB_PATH)) {
    mkdirSync(VECTOR_DB_PATH, { recursive: true });
  }
}

/**
 * Get or create LanceDB connection.
 */
async function getVectorDB() {
  ensureDataDir();
  return await lancedb.connect(VECTOR_DB_PATH);
}

/**
 * Convert all knowledge entries to vector database.
 */
export async function convertToVectorDB(options: {
  batchSize?: number;
  onProgress?: (current: number, total: number) => void;
} = {}): Promise<{ converted: number; skipped: number }> {
  const { batchSize = 50, onProgress } = options;

  // Get all entries from SQLite
  const entries = getAllEntries();

  if (entries.length === 0) {
    return { converted: 0, skipped: 0 };
  }

  const db = await getVectorDB();
  
  // Check for existing table
  const tables = await db.tableNames();
  let existingIds = new Set<number>();
  
  if (tables.includes("knowledge_vectors")) {
    const table = await db.openTable("knowledge_vectors");
    const existing = await table.query().select(["id"]).toArray();
    existingIds = new Set(existing.map((r: { id: number }) => r.id));
  }

  // Filter out already converted entries
  const toConvert = entries.filter((e) => e.id && !existingIds.has(e.id));
  
  if (toConvert.length === 0) {
    return { converted: 0, skipped: entries.length };
  }

  // Process in batches
  const vectorRecords: VectorRecord[] = [];
  
  for (let i = 0; i < toConvert.length; i += batchSize) {
    const batch = toConvert.slice(i, i + batchSize);
    
    for (const entry of batch) {
      // Combine title and content for embedding
      const text = `${entry.title}\n${entry.content.slice(0, 1000)}`;
      const vector = await embed(text);
      
      vectorRecords.push({
        id: entry.id!,
        title: entry.title,
        content_preview: entry.content.slice(0, 500),
        tags: entry.tags ? JSON.stringify(entry.tags) : null,
        vector,
      });
    }
    
    onProgress?.(Math.min(i + batchSize, toConvert.length), toConvert.length);
  }

  // Create or append to table
  if (tables.includes("knowledge_vectors")) {
    const table = await db.openTable("knowledge_vectors");
    await table.add(vectorRecords);
  } else {
    await db.createTable("knowledge_vectors", vectorRecords);
  }

  void maybeOptimizeVectorDB();
  return { converted: vectorRecords.length, skipped: existingIds.size };
}

/**
 * Query the vector database for similar entries.
 */
export async function queryVectors(
  query: string,
  options: {
    limit?: number;
    minScore?: number;
  } = {}
): Promise<SearchResult[]> {
  const { limit = 5, minScore = 0.3 } = options;

  const db = await getVectorDB();
  const tables = await db.tableNames();
  
  if (!tables.includes("knowledge_vectors")) {
    throw new Error("Vector database not initialized. Run 'bun start vectors convert' first.");
  }

  // Generate query embedding
  const queryVector = await embed(query);

  // Search
  const table = await db.openTable("knowledge_vectors");
  const results = await table
    .vectorSearch(queryVector)
    .limit(limit)
    .toArray();

  // Format and filter results
  return results
    .map((r: Record<string, unknown>) => ({
      id: r.id as number,
      title: r.title as string,
      content_preview: r.content_preview as string,
      tags: r.tags ? JSON.parse(r.tags as string) : [],
      score: 1 - (r._distance as number), // Convert distance to similarity score
    }))
    .filter((r) => r.score >= minScore);
}

/**
 * Delete a vector by entry ID.
 */
export async function deleteVector(id: number): Promise<boolean> {
  const db = await getVectorDB();
  const tables = await db.tableNames();

  if (!tables.includes("knowledge_vectors")) {
    return false;
  }

  const table = await db.openTable("knowledge_vectors");
  await table.delete(`id = ${id}`);
  void maybeOptimizeVectorDB();
  return true;
}

/**
 * Update vector for a single entry (insert or replace via upsert).
 *
 * Uses a single merge-insert so each call commits exactly one dataset
 * version. The previous delete-then-add committed two versions per call,
 * including a wasted delete commit for brand-new ids (the log_message
 * hot path), which made _versions grow without bound.
 */
export async function updateVector(entry: KnowledgeEntry): Promise<boolean> {
  if (!entry.id) return false;

  const db = await getVectorDB();
  const tables = await db.tableNames();

  const text = `${entry.title}\n${entry.content.slice(0, 1000)}`;
  const vector = await embed(text);

  const record: VectorRecord = {
    id: entry.id,
    title: entry.title,
    content_preview: entry.content.slice(0, 500),
    tags: entry.tags ? JSON.stringify(entry.tags) : null,
    vector,
  };

  if (tables.includes("knowledge_vectors")) {
    const table = await db.openTable("knowledge_vectors");
    await table.mergeInsert("id")
      .whenMatchedUpdateAll()
      .whenNotMatchedInsertAll()
      .execute([record]);
  } else {
    await db.createTable("knowledge_vectors", [record]);
  }

  void maybeOptimizeVectorDB();
  return true;
}

/**
 * Get vector database statistics.
 */
export async function getVectorStats(): Promise<{
  totalVectors: number;
  tagCounts: Record<string, number>;
}> {
  const db = await getVectorDB();
  const tables = await db.tableNames();
  
  if (!tables.includes("knowledge_vectors")) {
    return { totalVectors: 0, tagCounts: {} };
  }

  const table = await db.openTable("knowledge_vectors");
  const all = await table.query().select(["tags"]).toArray();
  
  const tagCounts: Record<string, number> = {};
  
  for (const r of all) {
    const record = r as { tags: string | null };
    if (record.tags) {
      const tags = JSON.parse(record.tags) as string[];
      for (const tag of tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }
  }

  return {
    totalVectors: all.length,
    tagCounts,
  };
}

/**
 * Compact data fragments and prune old dataset versions.
 *
 * Every LanceDB write commits a new version under _versions/; without
 * this the vector store grows without bound. Safe to run any time:
 * live rows are preserved, only superseded versions/fragments are removed.
 */
export async function optimizeVectorDB(): Promise<{
  oldVersionsRemoved: number;
  bytesRemoved: number;
  fragmentsRemoved: number;
  fragmentsAdded: number;
}> {
  const db = await getVectorDB();
  const tables = await db.tableNames();

  if (!tables.includes("knowledge_vectors")) {
    return { oldVersionsRemoved: 0, bytesRemoved: 0, fragmentsRemoved: 0, fragmentsAdded: 0 };
  }

  const table = await db.openTable("knowledge_vectors");
  const stats = await table.optimize({ cleanupOlderThan: new Date() });
  writeMaintenanceState({ lastOptimize: new Date().toISOString(), writesSinceOptimize: 0 });

  return {
    oldVersionsRemoved: stats.prune.oldVersionsRemoved,
    bytesRemoved: Number(stats.prune.bytesRemoved),
    fragmentsRemoved: stats.compaction.fragmentsRemoved,
    fragmentsAdded: stats.compaction.fragmentsAdded,
  };
}

/**
 * Pure maintenance-due decision, exported for tests.
 */
export function shouldOptimize(
  nowMs: number,
  state: { lastOptimize: string | null; writesSinceOptimize: number }
): boolean {
  if (state.writesSinceOptimize < OPTIMIZE_MIN_WRITES) return false;
  if (state.lastOptimize === null) return true;
  const lastMs = Date.parse(state.lastOptimize);
  if (Number.isNaN(lastMs)) return true;
  return nowMs - lastMs >= OPTIMIZE_MIN_INTERVAL_MS;
}

let optimizeInFlight = false;

/**
 * Record a vector write and run a background optimize when due.
 * Never throws and never blocks the caller.
 */
export async function maybeOptimizeVectorDB(): Promise<void> {
  const state = readMaintenanceState();
  state.writesSinceOptimize += 1;
  writeMaintenanceState(state);

  if (optimizeInFlight || !shouldOptimize(Date.now(), state)) return;
  optimizeInFlight = true;
  try {
    await optimizeVectorDB();
  } catch (error) {
    console.error("Vector store optimize failed:", error instanceof Error ? error.message : error);
  } finally {
    optimizeInFlight = false;
  }
}

/**
 * Clear the vector database.
 */
export async function clearVectorDB(): Promise<void> {
  const db = await getVectorDB();
  const tables = await db.tableNames();
  
  if (tables.includes("knowledge_vectors")) {
    await db.dropTable("knowledge_vectors");
  }
}
