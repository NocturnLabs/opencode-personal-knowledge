/**
 * Session Service Tests
 *
 * Uses isolated test database via OPENCODE_PK_DATA_DIR environment variable.
 * Uses dynamic imports to ensure env var is set BEFORE module loads.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Set up isolated test database BEFORE any imports
const testDir = mkdtempSync(join(tmpdir(), "opencode-pk-test-"));
process.env.OPENCODE_PK_DATA_DIR = testDir;

// Types for the dynamically imported module
type DatabaseModule = typeof import("../../src/database/index");

let db: DatabaseModule;

describe("Session Database Functions", () => {
    beforeAll(async () => {
        // Dynamic import AFTER env var is set
        db = await import("../../src/database/index");
        db.initDatabase();
    });

    afterAll(() => {
        // Clean up
        db.closeDatabase();
        rmSync(testDir, { recursive: true, force: true });
    });

    describe("createSession", () => {
        test("creates a session with name", () => {
            const id = db.createSession("Test Session");
            expect(id).toBeGreaterThan(0);

            const session = db.getSession(id);
            expect(session).not.toBeNull();
            expect(session!.name).toBe("Test Session");
            expect(session!.is_active).toBe(true);
            expect(session!.ended_at).toBeNull();
        });

        test("creates a session without name", () => {
            const id = db.createSession();
            const session = db.getSession(id);
            expect(session).not.toBeNull();
            expect(session!.name).toBeNull();
            expect(session!.is_active).toBe(true);
        });
    });

    describe("getActiveSession", () => {
        test("returns most recent active session", () => {
            db.createSession("First");
            db.createSession("Second");

            const active = db.getActiveSession();
            expect(active).not.toBeNull();
            // Check it's the most recent by name (ID ordering can vary)
            expect(active!.name).toBe("Second");
        });
    });

    describe("endSession", () => {
        test("ends a session with summary", () => {
            const id = db.createSession("To End");
            const success = db.endSession(id, "Completed successfully");

            expect(success).toBe(true);

            const session = db.getSession(id);
            expect(session).not.toBeNull();
            expect(session!.is_active).toBe(false);
            expect(session!.ended_at).not.toBeNull();
            expect(session!.summary).toBe("Completed successfully");
        });

        test("returns false for non-existent session", () => {
            const success = db.endSession(99999);
            expect(success).toBe(false);
        });
    });

    describe("saveSessionMessage", () => {
        test("saves user message", () => {
            const sessionId = db.createSession("Message Test");
            const msgId = db.saveSessionMessage(sessionId, "user", "Hello, world!");

            expect(msgId).toBeGreaterThan(0);

            const messages = db.getSessionMessages(sessionId);
            expect(messages.length).toBe(1);
            expect(messages[0].role).toBe("user");
            expect(messages[0].content).toBe("Hello, world!");
        });

        test("saves agent message", () => {
            const sessionId = db.createSession("Agent Message Test");
            db.saveSessionMessage(sessionId, "user", "Question");
            const msgId = db.saveSessionMessage(sessionId, "agent", "Answer");

            const messages = db.getSessionMessages(sessionId);
            expect(messages.length).toBe(2);
            expect(messages[1].role).toBe("agent");
            expect(messages[1].content).toBe("Answer");
        });
    });

    describe("getSessionMessageCount", () => {
        test("returns correct count", () => {
            const sessionId = db.createSession("Count Test");
            db.saveSessionMessage(sessionId, "user", "Message 1");
            db.saveSessionMessage(sessionId, "agent", "Message 2");
            db.saveSessionMessage(sessionId, "user", "Message 3");

            const count = db.getSessionMessageCount(sessionId);
            expect(count).toBe(3);
        });

        test("returns 0 for empty session", () => {
            const sessionId = db.createSession("Empty");
            const count = db.getSessionMessageCount(sessionId);
            expect(count).toBe(0);
        });
    });

    describe("listSessions", () => {
        test("lists all sessions", () => {
            // Create a few sessions for testing
            db.createSession("List Test 1");
            db.createSession("List Test 2");

            const sessions = db.listSessions({ limit: 100 });
            expect(sessions.length).toBeGreaterThanOrEqual(2);
        });

        test("respects limit", () => {
            const sessions = db.listSessions({ limit: 2 });
            expect(sessions.length).toBeLessThanOrEqual(2);
        });

        test("filters active only", () => {
            const activeId = db.createSession("Active Only Test");
            const inactiveId = db.createSession("Will End");
            db.endSession(inactiveId);

            const activeSessions = db.listSessions({ activeOnly: true });
            const activeIds = activeSessions.map(s => s.id);

            expect(activeIds).toContain(activeId);
            expect(activeIds).not.toContain(inactiveId);
        });
    });
});
