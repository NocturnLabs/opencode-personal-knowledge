/**
 * Session Service
 *
 * Business logic for session memory feature.
 * Coordinates session management and vector indexing of messages.
 */
import {
    createSession as dbCreateSession,
    getSession as dbGetSession,
    getActiveSession as dbGetActiveSession,
    endSession as dbEndSession,
    saveSessionMessage as dbSaveSessionMessage,
    getSessionMessages as dbGetSessionMessages,
    listSessions as dbListSessions,
    getSessionMessageCount,
    closeTimedOutSessions as dbCloseTimedOutSessions,
    type Session,
    type SessionMessage,
} from "../database/index.js";
import { queryVectors, updateVector, type SearchResult } from "./vectorService.js";

export { type Session, type SessionMessage };

// Track the current active session ID in memory for auto-logging
let currentSessionId: number | null = null;

/**
 * Start a new logging session.
 */
export function startLoggingSession(name?: string): { sessionId: number; session: Session } {
    // Close any existing active session first
    const existing = dbGetActiveSession();
    if (existing) {
        dbEndSession(existing.id, "Auto-closed when new session started");
    }

    const sessionId = dbCreateSession(name);
    currentSessionId = sessionId;

    const session = dbGetSession(sessionId);
    if (!session) {
        throw new Error("Failed to create session");
    }

    return { sessionId, session };
}

/**
 * Log a message to the current or specified session.
 * Also indexes the message in the vector database for search.
 */
export async function logMessage(
    role: "user" | "agent",
    content: string,
    sessionId?: number
): Promise<{ messageId: number; indexed: boolean }> {
    const targetSessionId = sessionId ?? currentSessionId;

    if (!targetSessionId) {
        throw new Error("No active session. Call start_logging_session first.");
    }

    // Check if session exists and is active
    const session = dbGetSession(targetSessionId);
    if (!session) {
        throw new Error(`Session ${targetSessionId} not found`);
    }
    if (!session.is_active) {
        throw new Error(`Session ${targetSessionId} is already closed`);
    }

    // Save message to database
    const messageId = dbSaveSessionMessage(targetSessionId, role, content);

    // Index in vector DB for semantic search
    let indexed = false;
    try {
        await updateVector({
            id: messageId,
            title: `[${role}] Session ${targetSessionId}`,
            content: content,
            tags: [`session:${targetSessionId}`, `role:${role}`],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        });
        indexed = true;
    } catch {
        // Vector indexing failed, but message is saved
        console.error("Vector indexing failed for session message");
    }

    return { messageId, indexed };
}

/**
 * Search within a specific session using semantic similarity.
 */
export async function searchSession(
    sessionId: number,
    query: string,
    limit = 5
): Promise<SearchResult[]> {
    // Query vectors with session tag filter
    const results = await queryVectors(query, { limit: limit * 2, minScore: 0.3 });

    // Filter to only include messages from this session
    const sessionTag = `session:${sessionId}`;
    const filtered = results.filter(r => r.tags?.includes(sessionTag));

    return filtered.slice(0, limit);
}

/**
 * Search across all sessions using semantic similarity.
 */
export async function searchAllSessions(
    query: string,
    limit = 10
): Promise<SearchResult[]> {
    // Get all session-tagged results
    const results = await queryVectors(query, { limit: limit * 2, minScore: 0.3 });

    // Filter to only session messages (have session: tag)
    const filtered = results.filter(r => r.tags?.some(t => t.startsWith("session:")));

    return filtered.slice(0, limit);
}

/**
 * Get a session with its messages.
 */
export function getSession(sessionId: number): {
    session: Session;
    messages: SessionMessage[];
    messageCount: number;
} | null {
    const session = dbGetSession(sessionId);
    if (!session) return null;

    const messages = dbGetSessionMessages(sessionId);
    const messageCount = getSessionMessageCount(sessionId);

    return { session, messages, messageCount };
}

/**
 * Get the current active session.
 */
export function getActiveSession(): Session | null {
    return dbGetActiveSession();
}

/**
 * Check if there's an active session for auto-logging.
 */
export function hasActiveSession(): boolean {
    return currentSessionId !== null && dbGetActiveSession() !== null;
}

/**
 * End the current or specified session.
 */
export function endSession(
    sessionId?: number,
    summary?: string
): { success: boolean; messageCount: number } {
    const targetSessionId = sessionId ?? currentSessionId;

    if (!targetSessionId) {
        return { success: false, messageCount: 0 };
    }

    const messageCount = getSessionMessageCount(targetSessionId);
    const success = dbEndSession(targetSessionId, summary);

    if (success && targetSessionId === currentSessionId) {
        currentSessionId = null;
    }

    return { success, messageCount };
}

/**
 * List all sessions.
 */
export function listSessions(options?: {
    limit?: number;
    offset?: number;
    activeOnly?: boolean;
}): Session[] {
    return dbListSessions(options);
}

/**
 * Close any timed-out sessions (inactive for 1+ hour).
 */
export function closeTimedOutSessions(): number {
    const closed = dbCloseTimedOutSessions();

    // Clear current session if it was closed
    if (currentSessionId && !dbGetActiveSession()) {
        currentSessionId = null;
    }

    return closed;
}

/**
 * Get session stats.
 */
export function getSessionStats(): {
    totalSessions: number;
    activeSessions: number;
    totalMessages: number;
} {
    const allSessions = dbListSessions({ limit: 1000 });
    const activeSessions = allSessions.filter(s => s.is_active).length;

    let totalMessages = 0;
    for (const session of allSessions) {
        totalMessages += getSessionMessageCount(session.id);
    }

    return {
        totalSessions: allSessions.length,
        activeSessions,
        totalMessages,
    };
}
