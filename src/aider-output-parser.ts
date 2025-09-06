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
  let isUserMessage = false;
  let foundFirstUserMessage = false;

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Handle code blocks - use the original line to preserve exact formatting
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        // Exiting a code block - add the closing line
        if (currentBlock.path !== undefined) {
          currentBlock.content += line + "\n";
          codeBlocks.push(currentBlock as CodeBlock);
        }
        currentBlock = {};
        inCodeBlock = false;
        // After a code block, we might be in user message
        isUserMessage = true;
      } else {
        // Entering a new code block
        const path = line.substring(3).trim();
        currentBlock = { path, content: line + "\n" };
        inCodeBlock = true;
        isUserMessage = false;
      }
      continue;
    }

    if (inCodeBlock) {
      // Preserve the original line including any leading/trailing whitespace
      currentBlock.content += line + "\n";
      continue;
    }

    // Parse information lines
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

    if (trimmedLine.startsWith("Warning:") || trimmedLine.includes("warning")) {
      info.warnings.push(trimmedLine);
      isUserMessage = false;
      continue;
    }

    if (trimmedLine.startsWith("Error:") || trimmedLine.includes("error")) {
      info.errors.push(trimmedLine);
      isUserMessage = false;
      continue;
    }

    // Detect the start of user message (usually after metadata)
    // Once we find non-metadata content, treat it as user message until a code block
    if (
      !foundFirstUserMessage &&
      line.length > 0 &&
      !trimmedLine.match(/^[A-Za-z\s]+:/) &&
      !trimmedLine.startsWith("Aider v") &&
      !line.startsWith("```")
    ) {
      foundFirstUserMessage = true;
      isUserMessage = true;
    }

    if (isUserMessage) {
      // Preserve original line formatting for user message
      userMessageLines.push(line);
    }
  }

  return {
    info,
    userMessage: userMessageLines.join("\n\n"),
    codeBlocks,
  };
}

export function formatAiderInfo(info: AiderInfo): string {
  const parts: string[] = [];

  // Agregar todos los campos de información con formato consistente
  if (info.version) parts.push(`🚀 **Aider**: ${info.version}`);
  if (info.mainModel) parts.push(`🤖 **Main Model**: ${info.mainModel}`);
  if (info.weakModel) parts.push(`🤖 **Weak Model**: ${info.weakModel}`);
  if (info.gitRepo) parts.push(`📁 **Repo**: ${info.gitRepo}`);
  if (info.repoMap) parts.push(`🗺️ **Repo-map**: ${info.repoMap}`);
  if (info.chatTokens) parts.push(`💬 **Tokens**: ${info.chatTokens}`);
  if (info.cost) parts.push(`💰 **Cost**: ${info.cost}`);

  // Agregar advertencias y errores
  info.warnings.forEach((w) => parts.push(`⚠️ ${w}`));
  info.errors.forEach((e) => parts.push(`❌ ${e}`));

  // Unir todas las partes con doble salto de línea
  if (parts.length > 0) {
    return parts.map((part) => part.trim()).join("\n\n") + "\n\n";
  }

  return "";
}
