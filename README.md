# aider-acp

An [Agent Client Protocol (ACP)](https://zed.dev/blog/bring-your-own-agent-to-zed) bridge that integrates [Aider](https://aider.chat) into editors like [Zed](https://zed.dev).
This project allows you to use Aider as an AI coding assistant inside Zed, review diffs, and apply changes seamlessly.

---

## 🚀 Overview

- **Runs as a standalone ACP agent**: Zed spawns this project as an external process.
- **Communicates with Zed via ACP (JSON-RPC over stdio)**.
- **Communicates with Aider via subprocess**: calls the `aider` CLI binary under the hood.
- **Diff workflow**:
  1. Zed sends a prompt + selected files via ACP.
  2. This bridge launches Aider with the request.
  3. Aider applies edits directly to disk.
  4. The bridge collects changes using `git diff`.
  5. Diffs are translated into ACP `file_edit` messages and sent back to Zed for review/approval.

---

## 📦 Project Structure

```

aider-acp/
├── src/
│   ├── index.ts        # ACP entrypoint (JSON-RPC loop)
│   ├── aider-runner.ts # Helper to run aider subprocess
│   ├── diff-parser.ts  # Utilities to collect diffs from git
│   └── types.ts        # Shared TypeScript types
├── package.json
├── tsconfig.json
└── README.md

````

---

## ⚙️ Requirements

- **Node.js** 20+
- **TypeScript**
- **Aider** (Python package) installed globally or in your environment:

  ```bash
  pip install aider-chat
  ```

- **Git** (Aider expects a git repo to track changes).

---

## 🔧 Usage

### 1. Install dependencies

```bash
npm install
```

### 2. Build

```bash
npm run build
```

### 3. Run manually

```bash
node dist/index.js
```

The agent will listen for ACP requests on stdin/stdout. Zed can then connect to it as an external agent.

---

## 🛠 How it Works

* **Initialization**: The bridge responds to `initialize` with metadata about supported models.
* **Execution** (`agent/execute`):

  * Runs `aider` with the user’s prompt.
  * Captures `git diff` output.
  * Translates it into ACP `file_edit` objects.
  * Returns them to Zed for preview/approval.

---

## 🔮 Roadmap

* [ ] **Basic ACP loop** (initialize + agent/execute).
* [ ] **Run Aider subprocess** and capture edits.
* [ ] **Git diff → ACP edits** translation.
* [ ] Model selection (map Aider’s supported models).
* [ ] Streaming output for "follow the agent" UX.
* [ ] Future: parse Aider’s `SEARCH/REPLACE` diffs directly (more efficient).

---

## 📜 License

Apache License, Version 2.0
