/**
 * Knowledge Service
 * 
 * Business logic coordinating database and vector operations.
 */
import {
  saveKnowledgeEntry,
  getKnowledgeEntry,
  updateKnowledgeEntry,
  deleteKnowledgeEntry,
  listKnowledgeEntries,
  searchKnowledgeByText,
  getStats as getDbStats,
  type KnowledgeEntry,
} from "../database/index.js";
import {
  queryVectors,
  updateVector,
  deleteVector,
  getVectorStats,
  type SearchResult,
} from "./vectorService.js";

export { type KnowledgeEntry };

/**
 * Add a new knowledge entry with automatic vector indexing.
 */
export async function addKnowledge(entry: {
  title: string;
  content: string;
  source?: string;
  tags?: string[];
}): Promise<{ id: number; vectorized: boolean }> {
  // Save to SQLite
  const id = saveKnowledgeEntry(entry);
  
  // Index in vector DB
  let vectorized = false;
  try {
    const savedEntry = getKnowledgeEntry(id);
    if (savedEntry) {
      await updateVector(savedEntry);
      vectorized = true;
    }
  } catch {
    // Vector indexing failed, but entry is saved
    console.error("Vector indexing failed, entry saved to database only");
  }

  return { id, vectorized };
}

/**
 * Search knowledge using semantic similarity.
 */
export async function searchKnowledge(
  query: string,
  options: { limit?: number; minScore?: number } = {}
): Promise<SearchResult[]> {
  return queryVectors(query, options);
}

/**
 * Search knowledge using text matching.
 */
export function searchKnowledgeText(query: string, limit = 10): KnowledgeEntry[] {
  return searchKnowledgeByText(query, limit);
}

/**
 * Get a knowledge entry by ID.
 */
export function getKnowledge(id: number): KnowledgeEntry | null {
  return getKnowledgeEntry(id);
}

/**
 * Update a knowledge entry with automatic vector re-indexing.
 */
export async function updateKnowledge(
  id: number,
  updates: Partial<Pick<KnowledgeEntry, "title" | "content" | "source" | "tags">>
): Promise<{ success: boolean; vectorized: boolean }> {
  const success = updateKnowledgeEntry(id, updates);
  
  if (!success) {
    return { success: false, vectorized: false };
  }

  // Re-index in vector DB
  let vectorized = false;
  try {
    const updatedEntry = getKnowledgeEntry(id);
    if (updatedEntry) {
      await updateVector(updatedEntry);
      vectorized = true;
    }
  } catch {
    console.error("Vector re-indexing failed");
  }

  return { success, vectorized };
}

/**
 * Delete a knowledge entry and its vector.
 */
export async function deleteKnowledge(id: number): Promise<boolean> {
  // Delete vector first
  try {
    await deleteVector(id);
  } catch {
    // Continue even if vector deletion fails
  }

  return deleteKnowledgeEntry(id);
}

/**
 * List knowledge entries with optional filters.
 */
export function listKnowledge(options: {
  limit?: number;
  offset?: number;
  tags?: string[];
}): KnowledgeEntry[] {
  return listKnowledgeEntries(options);
}

/**
 * Get combined statistics.
 */
export async function getKnowledgeStats(): Promise<{
  database: ReturnType<typeof getDbStats>;
  vectors: Awaited<ReturnType<typeof getVectorStats>>;
}> {
  const database = getDbStats();
  const vectors = await getVectorStats();
  return { database, vectors };
}
