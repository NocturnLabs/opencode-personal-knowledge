<p align="center">
  <h1 align="center">🧠 opencode-personal-knowledge</h1>
  <p align="center">
    <strong>A personal knowledge MCP server with vector database for the Opencode ecosystem</strong>
  </p>
  <p align="center">
    <a href="https://www.npmjs.com/package/opencode-personal-knowledge"><img src="https://img.shields.io/npm/v/opencode-personal-knowledge.svg" alt="npm version"></a>
    <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
    <a href="https://opencode.ai"><img src="https://img.shields.io/badge/Opencode-Compatible-blue.svg" alt="Opencode Compatible"></a>
  </p>
</p>

---

Store and retrieve knowledge using semantic search, powered by local embeddings. No external API keys required.

## ✨ Features

- **🔍 Semantic Search** — Find knowledge using vector embeddings (BGE-small-en-v1.5)
- **📝 Text Search** — Keyword-based search fallback
- **🏷️ Tag Organization** — Categorize entries with tags
- **🔌 Plug-and-Play** — No external services required (embeddings run 100% locally)
- **💾 Persistent Storage** — Data stored in `~/.local/share/opencode-personal-knowledge/`
- **🔄 Automatic Indexing** — Entries are vectorized on creation

## 🚀 Quick Start

### Opencode Integration (Recommended)

Add to `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "mcp": {
    "personal-knowledge": {
      "type": "local",
      "command": ["bunx", "opencode-personal-knowledge"],
      "enabled": true
    }
  }
}
```

Restart Opencode — the MCP tools will be available immediately.

### Source Installation (Development)

```bash
git clone https://github.com/NocturnLabs/opencode-personal-knowledge.git
cd opencode-personal-knowledge
bun install
bun run mcp  # Start MCP server
```

## 🛠️ MCP Tools

| Tool                    | Description                                    |
| :---------------------- | :--------------------------------------------- |
| `store_knowledge`       | Store a new knowledge entry with optional tags |
| `search_knowledge`      | Semantic similarity search                     |
| `search_knowledge_text` | Keyword-based text search                      |
| `get_knowledge`         | Retrieve entry by ID                           |
| `update_knowledge`      | Update an existing entry                       |
| `delete_knowledge`      | Delete an entry                                |
| `list_knowledge`        | List entries with filters                      |
| `get_knowledge_stats`   | Database statistics                            |

## 📖 Example Usage

### Storing Knowledge

**User:** "store a knowledge entry about Opencode Features"

**Agent:** Researches and stores entry:

```
✅ Stored knowledge entry #2: "Opencode Features"
📊 Indexed for semantic search
```

### Searching Knowledge

**User:** "@search_knowledge for opencode"

**Agent:** Returns semantic matches:

```
Found 1 similar entry:

### 1. Opencode Features (85% similar)
Opencode is an open source AI coding agent...
```

## ⚙️ Configuration

### Data Location

By default, data is stored in:

```
~/.local/share/opencode-personal-knowledge/
├── knowledge.db      # SQLite database
└── vectors/          # LanceDB vector store
```

Override with environment variable:

```bash
export OPENCODE_PK_DATA_DIR=/custom/path
```

### Embedding Model

Uses `BGE-small-en-v1.5` via [FastEmbed](https://github.com/Anush008/fastembed-js) (auto-downloads on first use).

## 🏗️ Technology Stack

- **Runtime:** [Bun](https://bun.sh) / Node.js
- **Vector DB:** [LanceDB](https://lancedb.com) (embedded)
- **Embeddings:** [FastEmbed](https://github.com/Anush008/fastembed-js) (ONNX Runtime)
- **MCP SDK:** [@modelcontextprotocol/sdk](https://modelcontextprotocol.io)
- **Database:** SQLite (via Bun)

## 📄 License

MIT © [NocturnLabs](https://github.com/NocturnLabs)

---

<p align="center">
  Made with 🖤 for the <a href="https://opencode.ai">Opencode</a> ecosystem
</p>
