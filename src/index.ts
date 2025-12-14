#!/usr/bin/env bun
/**
 * Personal Knowledge CLI
 * 
 * Command-line interface for managing personal knowledge entries.
 */
import { Command } from "commander";
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
import { convertToVectorDB, getVectorStats, clearVectorDB } from "./services/vectorService.js";

const program = new Command();

program
  .name("pk")
  .description("Personal Knowledge CLI - Manage your knowledge base")
  .version("1.0.0");

// Add command
program
  .command("add")
  .description("Add a new knowledge entry")
  .argument("<title>", "Entry title")
  .argument("<content>", "Entry content")
  .option("-s, --source <source>", "Source URL or reference")
  .option("-t, --tags <tags>", "Comma-separated tags")
  .action(async (title, content, options) => {
    const tags = options.tags ? options.tags.split(",").map((t: string) => t.trim()) : undefined;
    const result = await addKnowledge({ title, content, source: options.source, tags });
    console.log(`✅ Added entry #${result.id}: "${title}"`);
    console.log(result.vectorized ? "📊 Indexed for semantic search" : "⚠️ Saved to database only");
  });

// Search command
program
  .command("search")
  .description("Search knowledge entries")
  .argument("<query>", "Search query")
  .option("-t, --text", "Use text search instead of semantic search")
  .option("-l, --limit <limit>", "Maximum results", "5")
  .action(async (query, options) => {
    const limit = parseInt(options.limit);
    
    if (options.text) {
      const results = searchKnowledgeText(query, limit);
      if (results.length === 0) {
        console.log("No results found.");
        return;
      }
      console.log(`Found ${results.length} result(s):\n`);
      for (const r of results) {
        console.log(`[${r.id}] ${r.title}`);
        console.log(`    ${r.content.slice(0, 100)}...`);
        if (r.tags) console.log(`    Tags: ${r.tags.join(", ")}`);
        console.log();
      }
    } else {
      try {
        const results = await searchKnowledge(query, { limit });
        if (results.length === 0) {
          console.log("No similar entries found.");
          return;
        }
        console.log(`Found ${results.length} similar entries:\n`);
        for (const r of results) {
          const similarity = Math.round(r.score * 100);
          console.log(`[${r.id}] ${r.title} (${similarity}% similar)`);
          console.log(`    ${r.content_preview.slice(0, 100)}...`);
          if (r.tags.length > 0) console.log(`    Tags: ${r.tags.join(", ")}`);
          console.log();
        }
      } catch (error) {
        console.error("Semantic search failed. Try --text for keyword search.");
        console.error(error instanceof Error ? error.message : error);
      }
    }
  });

// Get command
program
  .command("get")
  .description("Get a knowledge entry by ID")
  .argument("<id>", "Entry ID")
  .action((id) => {
    const entry = getKnowledge(parseInt(id));
    if (!entry) {
      console.log(`No entry found with ID: ${id}`);
      return;
    }
    console.log(`# ${entry.title}\n`);
    console.log(`ID: ${entry.id}`);
    console.log(`Created: ${entry.created_at}`);
    console.log(`Updated: ${entry.updated_at}`);
    if (entry.source) console.log(`Source: ${entry.source}`);
    if (entry.tags) console.log(`Tags: ${entry.tags.join(", ")}`);
    console.log(`\n${entry.content}`);
  });

// Update command
program
  .command("update")
  .description("Update a knowledge entry")
  .argument("<id>", "Entry ID")
  .option("--title <title>", "New title")
  .option("--content <content>", "New content")
  .option("-s, --source <source>", "New source")
  .option("-t, --tags <tags>", "New comma-separated tags")
  .action(async (id, options) => {
    const updates: Record<string, unknown> = {};
    if (options.title) updates.title = options.title;
    if (options.content) updates.content = options.content;
    if (options.source) updates.source = options.source;
    if (options.tags) updates.tags = options.tags.split(",").map((t: string) => t.trim());
    
    if (Object.keys(updates).length === 0) {
      console.log("No updates provided.");
      return;
    }
    
    const result = await updateKnowledge(parseInt(id), updates);
    if (!result.success) {
      console.log(`No entry found with ID: ${id}`);
      return;
    }
    console.log(`✅ Updated entry #${id}`);
    console.log(result.vectorized ? "📊 Re-indexed" : "⚠️ Vector update failed");
  });

// Delete command
program
  .command("delete")
  .description("Delete a knowledge entry")
  .argument("<id>", "Entry ID")
  .action(async (id) => {
    const success = await deleteKnowledge(parseInt(id));
    if (!success) {
      console.log(`No entry found with ID: ${id}`);
      return;
    }
    console.log(`✅ Deleted entry #${id}`);
  });

// List command
program
  .command("list")
  .description("List knowledge entries")
  .option("-l, --limit <limit>", "Maximum entries", "20")
  .option("-o, --offset <offset>", "Offset for pagination", "0")
  .option("-t, --tags <tags>", "Filter by comma-separated tags")
  .action((options) => {
    const limit = parseInt(options.limit);
    const offset = parseInt(options.offset);
    const tags = options.tags ? options.tags.split(",").map((t: string) => t.trim()) : undefined;
    
    const entries = listKnowledge({ limit, offset, tags });
    if (entries.length === 0) {
      console.log("No entries found.");
      return;
    }
    
    console.log(`📚 Knowledge Entries (${entries.length}):\n`);
    for (const e of entries) {
      console.log(`[${e.id}] ${e.title}${e.tags ? ` [${e.tags.join(", ")}]` : ""}`);
    }
  });

// Stats command
program
  .command("stats")
  .description("Get knowledge base statistics")
  .action(async () => {
    const stats = await getKnowledgeStats();
    
    console.log("📊 Knowledge Base Stats\n");
    console.log(`Total Entries: ${stats.database.totalEntries}`);
    console.log(`Vectors Indexed: ${stats.vectors.totalVectors}`);
    console.log(`Oldest: ${stats.database.oldestEntry || "N/A"}`);
    console.log(`Newest: ${stats.database.newestEntry || "N/A"}`);
    
    const tags = Object.entries(stats.database.tagCounts).sort((a, b) => b[1] - a[1]);
    if (tags.length > 0) {
      console.log("\nTop Tags:");
      for (const [tag, count] of tags.slice(0, 10)) {
        console.log(`  ${tag}: ${count}`);
      }
    }
  });

// Vectors subcommand
const vectors = program.command("vectors").description("Manage vector database");

vectors
  .command("convert")
  .description("Convert all entries to vector database")
  .action(async () => {
    console.log("Converting entries to vectors...");
    const result = await convertToVectorDB({
      onProgress: (current, total) => {
        process.stdout.write(`\rProgress: ${current}/${total}`);
      },
    });
    console.log(`\n✅ Converted ${result.converted} entries (${result.skipped} already indexed)`);
  });

vectors
  .command("stats")
  .description("Get vector database statistics")
  .action(async () => {
    const stats = await getVectorStats();
    console.log("📊 Vector Database Stats\n");
    console.log(`Total Vectors: ${stats.totalVectors}`);
    
    const tags = Object.entries(stats.tagCounts).sort((a, b) => b[1] - a[1]);
    if (tags.length > 0) {
      console.log("\nTags in vectors:");
      for (const [tag, count] of tags.slice(0, 10)) {
        console.log(`  ${tag}: ${count}`);
      }
    }
  });

vectors
  .command("clear")
  .description("Clear the vector database")
  .action(async () => {
    await clearVectorDB();
    console.log("✅ Vector database cleared");
  });

program.parse();
