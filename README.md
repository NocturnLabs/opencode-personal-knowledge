# opencode-personal-knowledge

Personal knowledge MCP server with vector database for the Opencode ecosystem.

## Features

- **Semantic Search** — Find knowledge using vector embeddings
- **Text Search** — Keyword-based search fallback
- **Tag Organization** — Categorize entries with tags
- **Plug-and-Play** — No external services required (embeddings run locally)

## Quick Start (Source installation - Testing)

```bash
# Install dependencies
bun install

# Run CLI
bun start add "Title" "Content" --tags "ai,mcp"
bun start search "query"

# Run MCP server - For Testing (Not Required for Opencode Integration will auto start on opencode load)
bun run mcp
```

## Opencode Integration (Recommended)

Add to `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "mcp": {
    "personal-knowledge": {
      "type": "local",
      "command": ["npx", "-y", "opencode-personal-knowledge"],
      "enabled": true
    }
  }
}
```

## MCP Tools

| Tool                    | Description                 |
| :---------------------- | :-------------------------- |
| `store_knowledge`       | Store a new knowledge entry |
| `search_knowledge`      | Semantic search             |
| `search_knowledge_text` | Keyword search              |
| `get_knowledge`         | Get entry by ID             |
| `update_knowledge`      | Update entry                |
| `delete_knowledge`      | Delete entry                |
| `list_knowledge`        | List entries                |
| `get_knowledge_stats`   | Database stats              |

## Example Usage

**User:** "store a knowledge entry about Opencode Features"

**Agent:** Researches and compiles entry, then calls `store_knowledge`:

```
Tool: personal-knowledge_store_knowledge
Title: "Opencode Features"
Content: "Opencode is an open source AI coding agent that helps write code
in terminals, IDEs, or desktops. Key features include: LSP-enabled,
multi-session support, shareable session links, Claude Pro integration,
75+ LLM providers via Models.dev, and availability across terminal,
desktop app, and IDE extensions."
Tags: ["opencode", "features", "ai-coding-agent"]
```

**Result:** `✅ Stored knowledge entry #2: "Opencode Features" 📊 Indexed for semantic search`

---

**User:** "@search_knowledge for opencode"

**Agent:** Performs semantic search and returns matching entry:

```
Found 1 similar entry:

### 1. Opencode Features (85% similar)
Opencode is an open source AI coding agent that helps write code in
terminals, IDEs, or desktops. Key features include: LSP-enabled,
multi-session support, shareable session links, Claude Pro integration...
```

## License

MIT
