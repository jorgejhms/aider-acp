export interface AiderInfo {
  version?: string;
  mainModel?: string;
  weakModel?: string;
  gitRepo?: string;
  repoMap?: string;
  chatTokens?: string;
  cost?: string;
  warnings: string[];
  errors: string[];
}

export interface CodeBlock {
  path: string;
  content: string;
}

export function parseAiderOutput(output: string): {
  info: AiderInfo;
  userMessage: string;
  codeBlocks: CodeBlock[];
} {
  const lines = output.split("\n");
  const info: AiderInfo = {
    warnings: [],
    errors: [],
  };
  const userMessageLines: string[] = [];
  const codeBlocks: CodeBlock[] = [];

  let inCodeBlock = false;
  let currentBlock: Partial<CodeBlock> = {};
  let isUserMessage = true;

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      if (inCodeBlock) {
        // Entering a new code block
        const path = trimmedLine.substring(3).trim();
        currentBlock = { path, content: "" };
        isUserMessage = false; // Stop capturing as user message
      } else {
        // Exiting a code block
        if (currentBlock.path && currentBlock.content) {
          codeBlocks.push(currentBlock as CodeBlock);
        }
        currentBlock = {};
        isUserMessage = true; // Resume capturing user message
      }
      continue;
    }

    if (inCodeBlock) {
      currentBlock.content += line + "\n";
      continue;
    }

    const versionMatch = trimmedLine.match(/^Aider (v[0-9.]+\S*)/);
    if (versionMatch) {
      info.version = versionMatch[1];
      isUserMessage = false;
      continue;
    }

    const mainModelMatch = trimmedLine.match(/Main model: (.+)/);
    if (mainModelMatch) {
      info.mainModel = mainModelMatch[1];
      isUserMessage = false;
      continue;
    }

    const weakModelMatch = trimmedLine.match(/Weak model: (.+)/);
    if (weakModelMatch) {
      info.weakModel = weakModelMatch[1];
      isUserMessage = false;
      continue;
    }

    const gitRepoMatch = trimmedLine.match(/Git repo: (.+)/);
    if (gitRepoMatch) {
      info.gitRepo = gitRepoMatch[1];
      isUserMessage = false;
      continue;
    }

    const repoMapMatch = trimmedLine.match(/Repo-map: (.+)/);
    if (repoMapMatch) {
      info.repoMap = repoMapMatch[1];
      isUserMessage = false;
      continue;
    }

    const tokensMatch = trimmedLine.match(/Tokens: (.+)/);
    if (tokensMatch) {
      info.chatTokens = tokensMatch[1];
      isUserMessage = false;
      continue;
    }

    const costMatch = trimmedLine.match(/Cost: (.+)/);
    if (costMatch) {
      info.cost = costMatch[1];
      isUserMessage = false;
      continue;
    }

    if (
      trimmedLine.startsWith("Warning:") ||
      trimmedLine.startsWith("Cost estimates")
    ) {
      info.warnings.push(trimmedLine);
      isUserMessage = false;
      continue;
    }

    if (trimmedLine.startsWith("Error:")) {
      info.errors.push(trimmedLine);
      isUserMessage = false;
      continue;
    }

    if (isUserMessage) {
      userMessageLines.push(line);
    }
  }

  return {
    info,
    userMessage: userMessageLines.join("\n").trim(),
    codeBlocks,
  };
}

export function formatAiderInfo(info: AiderInfo): string {
  const parts: string[] = [];
  if (info.version) parts.push(`\n\n🚀 **Aider**: ${info.version}\n\n`);
  if (info.mainModel)
    parts.push(`\n\n🤖 **Main Model**: ${info.mainModel}\n\n`);
  if (info.weakModel)
    parts.push(`\n\n🤖 **Weak Model**: ${info.weakModel}\n\n`);
  if (info.gitRepo) parts.push(`\n\n📁 **Repo**: ${info.gitRepo}\n\n`);
  if (info.repoMap) parts.push(`\n\n🗺️ **Repo-map**: ${info.repoMap}\n\n`);
  if (info.chatTokens) parts.push(`\n\n💬 **Tokens**: ${info.chatTokens}\n\n`);
  if (info.cost) parts.push(`\n\n💰 **Cost**: ${info.cost}\n\n`);

  let formattedString = parts.join("\n\n");

  if (info.warnings.length > 0) {
    const warningLines = info.warnings.map((w) => `\n\n⚠️ ${w}`).join("\n");
    if (formattedString) {
      formattedString += "\n\n" + warningLines;
    } else {
      formattedString = warningLines;
    }
  }

  if (info.errors.length > 0) {
    const errorLines = info.errors.map((e) => `\n\n❌ ${e}`).join("\n");
    if (formattedString) {
      formattedString += "\n\n" + errorLines;
    } else {
      formattedString = errorLines;
    }
  }

  return formattedString;
}
