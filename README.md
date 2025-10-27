# aider-acp

An [Agent Client Protocol (ACP)](https://zed.dev/blog/bring-your-own-agent-to-zed) bridge that integrates [Aider](https://aider.chat) into editors like [Zed](https://zed.dev).
This project allows you to use Aider as an AI coding assistant inside Zed, review diffs, and apply changes seamlessly.

---

## 🚀 Overview

- **Runs as a standalone ACP agent**: Zed spawns this project as an external process.
- **Communicates with Zed via ACP (JSON-RPC over stdio)**.
- **Communicates with Aider via subprocess**: calls the `aider` CLI binary under the hood.
- **Configurable AI models**: Choose from various LLM providers (Gemini, Claude, GPT, DeepSeek, etc.).
- **Diff workflow**:
  1. Zed sends a prompt via ACP.
  2. This bridge launches Aider with the request.
  3. Aider applies edits directly to disk.
  4. Changes are returned in SEARCH/REPLACE code block.
  5. Zed shows the changes (unformatted!!)

---

## 📦 Project Structure

```
aider-acp/
├── src/
│   ├── index.ts        # ACP entrypoint (JSON-RPC loop)
│   ├── acp-agent.ts    # Main ACP protocol implementation
│   ├── aider-output-parser.ts  # Parses Aider output to extract changes and format it for ACP.
│   ├── aider-runner.ts # Helper to run aider subprocess
│   ├── utils.ts        # Utility functions
│   └── types.ts        # Shared TypeScript types
├── package.json
├── tsconfig.json
└── README.md
```

---

## ⚙️ Requirements

- **Node.js** 20+
- **TypeScript** (installed as dev dependency)
- **Aider** (Python package) installed globally or in your environment:

  ```bash
  pip install aider-chat
  ```

- **Git** (Aider expects a git repo to track changes)
- **Zed Editor** or other editor with ACP support (v0.201.5+)

---

## 🔧 Installation & Setup

### 1. Clone and setup the project

```bash
git clone <your-repo-url>
cd aider-acp
pnpm install  # or npm install
pnpm run build
```

### 2. Test the agent standalone

```bash
# Test the ACP agent directly
node test-acp.js
```

### 3. Configure in Zed

Add this configuration to your Zed settings (`cmd/ctrl + ,` → Open `settings.json`):

```json
{
  "agent_servers": {
    "Aider": {
      "command": "node",
      "args": ["/absolute/path/to/your/aider-acp/dist/index.js"],
      "env": {
        "AIDER_MODEL": "gemini/gemini-2.5-flash"
      }
    }
  }
}
```

> **Important**: Replace `/absolute/path/to/your/aider-acp/` with the actual absolute path to your cloned project.

#### Model Configuration

You can specify which AI model Aider should use in three ways (in order of priority):

**Option 1: Via Zed Configuration (Recommended)**

Set the model in your Zed `settings.json` using the `env` property as shown above:
```json
"env": {
  "AIDER_MODEL": "openrouter/deepseek/deepseek-chat-v3.1:free"
}
```

**Option 2: System Environment Variable**

Set the `AIDER_MODEL` environment variable in your shell before launching Zed:

```bash
# In your shell configuration (~/.zshrc, ~/.bashrc, etc.)
export AIDER_MODEL="claude-3-5-sonnet-20241022"

# Then launch Zed from terminal
zed
```

**Option 3: Change Default in Code**

Edit `src/acp-agent.ts` around line 48 and change the default:
```typescript
const model =
  (params._meta as any)?.model ||
  process.env.AIDER_MODEL ||
  "your-preferred-model-here";
```

Then rebuild with `pnpm run build`.

**Popular Model Options:**
- `gemini/gemini-2.5-flash` (default, fast and free)
- `claude-3-5-sonnet-20241022` (powerful, requires API key)
- `openrouter/deepseek/deepseek-chat-v3.1:free` (free via OpenRouter)
- `gpt-4o` (OpenAI, requires API key)

> **Note**: Make sure you have the necessary API keys configured in your environment for non-free models (e.g., `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.).

### 4. Use in Zed

1. Open the Agent Panel: `cmd/ctrl + ?`
2. Click the `+` button in the top right
3. Select "Aider" from the dropdown
4. Start chatting with Aider directly in Zed!

---

## 🎯 Usage Examples

### Basic Usage
```
You: "Add error handling to the main function in src/index.ts"
Aider: *analyzes code and applies changes*
Zed: *shows real-time diff updates*
```

### With File Context
```
You: "Refactor this function to use async/await"
*Select code in editor before sending*
Aider: *receives context and makes improvements*
```

---

## 🛠 How it Works

### ACP Protocol Flow
1. **Initialization**: Zed sends `initialize` → Agent responds with capabilities
2. **Session Creation**: Zed sends `session/new` → Agent creates session context
3. **Prompt Processing**: Zed sends `session/prompt` → Agent processes with Aider
4. **Real-time Updates**: Agent sends `session/update` notifications during execution
5. **Completion**: Agent responds with `stopReason: "end_turn"`

### Technical Implementation
- **JSON-RPC 2.0** communication over stdin/stdout
- **Subprocess execution** of Aider CLI with proper argument handling
- **Git diff parsing** to capture and report changes
- **Streaming updates** for real-time progress feedback
- **Error handling** with proper ACP error codes

---

## 🐛 Debugging

### View ACP Communication Logs in Zed
1. Open Command Palette (`cmd/ctrl + shift + p`)
2. Run `dev: open acp logs`
3. This opens a dedicated panel showing all JSON-RPC messages between Zed and the agent in real-time
4. You'll see the complete protocol flow: initialize, session/new, session/prompt, session/update, etc.

---

## ✅ Current Status

- ✅ **Basic ACP loop** (initialize + session management + prompt and response)
- ✅ **Aider subprocess integration** with proper argument handling and file editing
- ✅ **Real-time streaming updates** via session/update notifications
- ✅ **Configurable model selection** via Zed settings, environment variables, or defaults

---

## 🔮 Future Roadmap

- [ ] **Diff parsing to ACP edits**: Convert SEARCH/REPLACE blocks to structured file_edit blocks
- [ ] **Model selection UI**: Add dynamic model switching within Zed's UI
- [ ] **File context**: Better integration with Zed's file selection
- [ ] **Slash commands**: Implement aider slash commands for quick actions
- [ ] **Format Output**: Correctly format all aider messages (ask for user input, error messages, additional info, etc)

---

## 🤝 Contributing

This project follows the Agent Client Protocol specification. Contributions are welcome!

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test with both standalone and Zed integration
5. Submit a pull request

---

## 📜 License

Apache License, Version 2.0
