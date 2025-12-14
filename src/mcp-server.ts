#!/usr/bin/env bun
/**
 * Personal Knowledge MCP Server
 * 
 * Exposes knowledge database via Model Context Protocol for use by AI agents.
 * 
 * Tools provided:
 * - store_knowledge: Store a new knowledge entry
 * - search_knowledge: Semantic search using vector embeddings
 * - search_knowledge_text: Keyword-based text search
 * - get_knowledge: Get a specific entry by ID
 * - update_knowledge: Update an existing entry
 * - delete_knowledge: Delete an entry
 * - list_knowledge: List entries with filters
 * - get_knowledge_stats: Get database statistics
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  addKnowledge,
  searchKnowledge,
  searchKnowledgeText,
  getKnowledge,
  updateKnowledge,
  deleteKnowledge,
  listKnowledge,
  getKnowledgeStats,
} from "./services/knowledgeService.js";

// Create MCP server
const server = new McpServer({
  name: "personal-knowledge-mcp",
  version: "1.0.0",
});

// Tool: Store knowledge
server.tool(
  "store_knowledge",
  "Store a new knowledge entry in your personal knowledge base. Use this to save important information, notes, or learnings for later retrieval.",
  {
    title: z.string().describe("Short descriptive title for the entry"),
    content: z.string().describe("The full content/text of the knowledge entry"),
    source: z.string().optional().describe("Optional source URL or reference"),
    tags: z.array(z.string()).optional().describe("Optional tags for categorization (e.g., ['typescript', 'patterns'])"),
  },
  async ({ title, content, source, tags }) => {
    try {
      const result = await addKnowledge({ title, content, source, tags });
      return {
        content: [{
          type: "text",
          text: `✅ Stored knowledge entry #${result.id}: "${title}"\n${result.vectorized ? "📊 Indexed for semantic search" : "⚠️ Saved to database only (vector indexing failed)"}`,
        }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        content: [{ type: "text", text: `❌ Failed to store knowledge: ${message}` }],
      };
    }
  }
);

// Tool: Semantic search
server.tool(
  "search_knowledge",
  "Search your personal knowledge base using semantic similarity. Returns entries most similar in meaning to your query.",
  {
    query: z.string().describe("Search query to find similar knowledge entries"),
    limit: z.number().optional().default(5).describe("Maximum number of results (default: 5)"),
  },
  async ({ query, limit }) => {
    try {
      const results = await searchKnowledge(query, { limit, minScore: 0.3 });
      
      if (results.length === 0) {
        return {
          content: [{ type: "text", text: "No similar knowledge entries found." }],
        };
      }
      
      let output = `## Found ${results.length} similar entries:\n\n`;
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const similarity = Math.round(r.score * 100);
        output += `### ${i + 1}. ${r.title} (${similarity}% similar)\n`;
        output += `**ID:** ${r.id}\n`;
        if (r.tags.length > 0) {
          output += `**Tags:** ${r.tags.join(", ")}\n`;
        }
        output += `\n${r.content_preview}...\n\n---\n\n`;
      }
      
      return {
        content: [{ type: "text", text: output }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      if (message.includes("not initialized")) {
        return {
          content: [{ 
            type: "text", 
            text: "Vector database not initialized. Use search_knowledge_text for keyword search, or add some entries first." 
          }],
        };
      }
      return {
        content: [{ type: "text", text: `Search error: ${message}` }],
      };
    }
  }
);

// Tool: Text search
server.tool(
  "search_knowledge_text",
  "Search knowledge entries by keyword (text-based, no semantic similarity). Good for exact matches.",
  {
    query: z.string().describe("Keywords to search for in titles and content"),
    limit: z.number().optional().default(10).describe("Maximum number of results"),
  },
  async ({ query, limit }) => {
    const results = searchKnowledgeText(query, limit);
    
    if (results.length === 0) {
      return {
        content: [{ type: "text", text: `No results found for: "${query}"` }],
      };
    }
    
    const formatted = results.map((r) => 
      `**${r.title}** (ID: ${r.id})\n${r.content.slice(0, 200)}...${r.tags ? `\nTags: ${r.tags.join(", ")}` : ""}`
    ).join("\n\n---\n\n");
    
    return {
      content: [{ 
        type: "text", 
        text: `Found ${results.length} result(s) for "${query}":\n\n${formatted}` 
      }],
    };
  }
);

// Tool: Get by ID
server.tool(
  "get_knowledge",
  "Get a specific knowledge entry by its ID",
  {
    id: z.number().describe("The ID of the knowledge entry"),
  },
  async ({ id }) => {
    const entry = getKnowledge(id);
    
    if (!entry) {
      return {
        content: [{ type: "text", text: `No entry found with ID: ${id}` }],
      };
    }
    
    return {
      content: [{
        type: "text",
        text: `# ${entry.title}\n\n**ID:** ${entry.id}\n**Created:** ${entry.created_at}\n**Updated:** ${entry.updated_at}${entry.source ? `\n**Source:** ${entry.source}` : ""}${entry.tags ? `\n**Tags:** ${entry.tags.join(", ")}` : ""}\n\n---\n\n${entry.content}`,
      }],
    };
  }
);

// Tool: Update
server.tool(
  "update_knowledge",
  "Update an existing knowledge entry",
  {
    id: z.number().describe("The ID of the entry to update"),
    title: z.string().optional().describe("New title"),
    content: z.string().optional().describe("New content"),
    source: z.string().optional().describe("New source"),
    tags: z.array(z.string()).optional().describe("New tags (replaces existing)"),
  },
  async ({ id, title, content, source, tags }) => {
    const updates: Record<string, unknown> = {};
    if (title !== undefined) updates.title = title;
    if (content !== undefined) updates.content = content;
    if (source !== undefined) updates.source = source;
    if (tags !== undefined) updates.tags = tags;
    
    if (Object.keys(updates).length === 0) {
      return {
        content: [{ type: "text", text: "No updates provided" }],
      };
    }
    
    const result = await updateKnowledge(id, updates);
    
    if (!result.success) {
      return {
        content: [{ type: "text", text: `No entry found with ID: ${id}` }],
      };
    }
    
    return {
      content: [{ 
        type: "text", 
        text: `✅ Updated entry #${id}\n${result.vectorized ? "📊 Re-indexed for semantic search" : "⚠️ Database updated (vector re-indexing failed)"}` 
      }],
    };
  }
);

// Tool: Delete
server.tool(
  "delete_knowledge",
  "Delete a knowledge entry from the database",
  {
    id: z.number().describe("The ID of the entry to delete"),
  },
  async ({ id }) => {
    const success = await deleteKnowledge(id);
    
    if (!success) {
      return {
        content: [{ type: "text", text: `No entry found with ID: ${id}` }],
      };
    }
    
    return {
      content: [{ type: "text", text: `✅ Deleted entry #${id}` }],
    };
  }
);

// Tool: List
server.tool(
  "list_knowledge",
  "List knowledge entries with optional filtering",
  {
    limit: z.number().optional().default(20).describe("Maximum entries to return"),
    offset: z.number().optional().default(0).describe("Offset for pagination"),
    tags: z.array(z.string()).optional().describe("Filter by tags"),
  },
  async ({ limit, offset, tags }) => {
    const entries = listKnowledge({ limit, offset, tags });
    
    if (entries.length === 0) {
      return {
        content: [{ type: "text", text: "No knowledge entries found." }],
      };
    }
    
    const formatted = entries.map((e) => 
      `- **${e.title}** (ID: ${e.id})${e.tags ? ` [${e.tags.join(", ")}]` : ""}`
    ).join("\n");
    
    return {
      content: [{ 
        type: "text", 
        text: `📚 Knowledge Entries (${entries.length}):\n\n${formatted}` 
      }],
    };
  }
);

// Tool: Stats
server.tool(
  "get_knowledge_stats",
  "Get statistics about your personal knowledge base",
  {},
  async () => {
    const stats = await getKnowledgeStats();
    
    const tagList = Object.entries(stats.database.tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => `  ${tag}: ${count}`)
      .join("\n");
    
    return {
      content: [{
        type: "text",
        text: `## Personal Knowledge Base Stats

**Total Entries:** ${stats.database.totalEntries}
**Vectors Indexed:** ${stats.vectors.totalVectors}

**Date Range:**
  Oldest: ${stats.database.oldestEntry || "N/A"}
  Newest: ${stats.database.newestEntry || "N/A"}

**Top Tags:**
${tagList || "  No tags yet"}`,
      }],
    };
  }
);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Personal Knowledge MCP Server running on stdio");
}

main().catch(console.error);
