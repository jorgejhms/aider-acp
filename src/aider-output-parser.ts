import {
  alt_sc,
  apply,
  buildLexer,
  expectEOF,
  expectSingleResult,
  rep_sc,
  rule,
  seq,
  tok,
} from "typescript-parsec";

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

export interface EditBlock {
  format:
    | "whole"
    | "diff"
    | "diff-fenced"
    | "udiff"
    | "editor-diff"
    | "editor-whole";
  path: string;
  oldText?: string;
  newText: string;
}

export interface CodeBlock {
  path: string;
  content: string;
}

export interface ParsedAiderOutput {
  info: AiderInfo;
  userMessage: string;
  editBlocks: EditBlock[];
  codeBlocks: CodeBlock[];
  prompts: string[];
}

interface DiffSearchReplace {
  search: string;
  replace: string;
}

enum AiderTokenKind {
  Fence,
  Line,
}

type LineSegment = {
  kind: "line";
  text: string;
};

type CodeSegment = {
  kind: "code";
  open: string;
  lines: string[];
  close: string;
};

type IncompleteCodeSegment = {
  kind: "incomplete";
  open: string;
  lines: string[];
};

type Segment = LineSegment | CodeSegment | IncompleteCodeSegment;

const aiderLexer = buildLexer<AiderTokenKind>([
  [true, /^[ \t]*```[^\n]*\r?\n?/g, AiderTokenKind.Fence],
  [true, /^(?![ \t]*```)[^\n]*\r?\n?/g, AiderTokenKind.Line],
]);

const lineTokenParser = apply(
  tok<AiderTokenKind>(AiderTokenKind.Line),
  (token) => token.text,
);
const fenceTokenParser = apply(
  tok<AiderTokenKind>(AiderTokenKind.Fence),
  (token) => token.text,
);

const completeBlockParser = apply(
  seq(fenceTokenParser, rep_sc(lineTokenParser), fenceTokenParser),
  ([open, lines, close]) => ({
    kind: "code" as const,
    open,
    lines,
    close,
  }),
);

const incompleteBlockParser = apply(
  seq(fenceTokenParser, rep_sc(lineTokenParser)),
  ([open, lines]) => ({
    kind: "incomplete" as const,
    open,
    lines,
  }),
);

const segmentRule = rule<AiderTokenKind, Segment>();
segmentRule.setPattern(
  alt_sc(
    completeBlockParser,
    incompleteBlockParser,
    apply(lineTokenParser, (text) => ({
      kind: "line" as const,
      text,
    })),
  ),
);

const segmentsRule = rule<AiderTokenKind, Segment[]>();
segmentsRule.setPattern(rep_sc(segmentRule));

export function parseAiderOutput(output: string): ParsedAiderOutput {
  const info: AiderInfo = {
    warnings: [],
    errors: [],
  };
  const userMessageLines: string[] = [];
  const editBlocks: EditBlock[] = [];
  const codeBlocks: CodeBlock[] = [];
  const promptMessages: string[] = [];

  const segments = parseSegmentsFromOutput(output);

  let capturingUserMessage = false;
  let foundFirstUserMessage = false;

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];

    if (segment.kind === "line") {
      const nextSegment = segments[index + 1];
      const normalizedLine = trimTrailingNewline(segment.text);
      const trimmedLine = normalizedLine.trim();

      if (collectPromptMessage(normalizedLine, promptMessages)) {
        capturingUserMessage = false;
        continue;
      }

      if (
        nextSegment?.kind === "code" &&
        isPotentialFilePath(trimmedLine) &&
        !isCommandEcho(normalizedLine)
      ) {
        const editBlock = buildEditBlockFromPathAndCode(
          trimmedLine,
          nextSegment,
        );
        if (editBlock) {
          editBlocks.push(editBlock);
          index += 1;
          capturingUserMessage = false;
          continue;
        }
      }

      if (processInfoLine(trimmedLine, info)) {
        capturingUserMessage = false;
        continue;
      }

      if (shouldSkipForUserMessage(normalizedLine)) {
        capturingUserMessage = false;
        continue;
      }

      if (
        !foundFirstUserMessage &&
        trimmedLine.length > 0 &&
        !/^[A-Za-z\s]+:/.test(trimmedLine) &&
        !trimmedLine.startsWith("Aider v") &&
        !normalizedLine.startsWith("```")
      ) {
        foundFirstUserMessage = true;
        capturingUserMessage = true;
      }

      if (capturingUserMessage) {
        userMessageLines.push(normalizedLine);
      }
    } else if (segment.kind === "code") {
      handleStandaloneCodeSegment(segment, editBlocks, codeBlocks);
      capturingUserMessage = false;
    } else if (segment.kind === "incomplete") {
      const pendingLines = [
        trimTrailingNewline(segment.open),
        ...segment.lines.map(trimTrailingNewline),
      ];
      for (const line of pendingLines) {
        if (line.length > 0) {
          userMessageLines.push(line);
        }
      }
    }
  }

  return {
    info,
    userMessage: userMessageLines.join("\n"),
    editBlocks,
    codeBlocks,
    prompts: promptMessages,
  };
}

function parseSegmentsFromOutput(output: string): Segment[] {
  if (output.length === 0) {
    return [];
  }

  try {
    const firstToken = aiderLexer.parse(output);
    if (!firstToken) {
      return [];
    }

    return expectSingleResult(expectEOF(segmentsRule.parse(firstToken)));
  } catch {
    return fallbackToLineSegments(output);
  }
}

function fallbackToLineSegments(output: string): Segment[] {
  return splitPreservingNewlines(output).map<LineSegment>((text) => ({
    kind: "line",
    text,
  }));
}

function splitPreservingNewlines(value: string): string[] {
  if (value.length === 0) {
    return [];
  }

  const parts: string[] = [];
  let start = 0;

  for (let i = 0; i < value.length; i++) {
    if (value[i] === "\n") {
      parts.push(value.slice(start, i + 1));
      start = i + 1;
    }
  }

  if (start < value.length) {
    parts.push(value.slice(start));
  }

  return parts;
}

function trimTrailingNewline(value: string): string {
  if (value.endsWith("\r\n")) {
    return value.slice(0, -2);
  }

  if (value.endsWith("\n") || value.endsWith("\r")) {
    return value.slice(0, -1);
  }

  return value;
}

function stripStatusPrefix(line: string): string {
  let result = line.trimStart();
  if (
    result.startsWith("⚠️") ||
    result.startsWith("❌") ||
    result.startsWith("📁")
  ) {
    result = result.slice(2).trimStart();
  }
  result = result.replace(/^[░█]+\s*/, "");
  return result;
}

function collectPromptMessage(line: string, prompts: string[]): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (!isPromptLine(trimmed)) {
    return false;
  }
  if (prompts[prompts.length - 1] !== trimmed) {
    prompts.push(trimmed);
  }
  return true;
}

function shouldSkipForUserMessage(line: string): boolean {
  if (isPromptIndicator(line)) {
    return true;
  }
  if (isPromptLine(line.trim())) {
    return true;
  }
  if (line.startsWith("> ") && !line.includes("<<<") && !line.includes(">>>")) {
    return true;
  }
  return false;
}

function isCommandEcho(line: string): boolean {
  if (isPromptIndicator(line)) {
    return true;
  }
  return (
    line.startsWith("> ") && !line.includes("<<<") && !line.includes(">>>")
  );
}

function isPromptIndicator(line: string): boolean {
  return line === ">" || line.trim() === ">";
}

function isPromptLine(line: string): boolean {
  if (!line.includes("?")) {
    return false;
  }
  const normalized = line.toLowerCase();
  return (
    normalized.includes("(y)es/(n)o") ||
    normalized.includes("(y/n)") ||
    normalized.includes("[y/n]") ||
    normalized.includes("(y)es/(n)o/(d)on't ask again") ||
    normalized.includes("open url for more info?") ||
    normalized.includes("add file to the chat?")
  );
}

function processInfoLine(line: string, info: AiderInfo): boolean {
  if (line.length === 0) {
    return false;
  }

  const normalizedLine = stripStatusPrefix(line);

  const versionMatch = normalizedLine.match(/^Aider (v[0-9.]+\S*)/);
  if (versionMatch) {
    info.version = versionMatch[1];
    return true;
  }

  const mainModelMatch = normalizedLine.match(/^Main model: (.+)/);
  if (mainModelMatch) {
    info.mainModel = mainModelMatch[1];
    return true;
  }

  const weakModelMatch = normalizedLine.match(/^Weak model: (.+)/);
  if (weakModelMatch) {
    info.weakModel = weakModelMatch[1];
    return true;
  }

  const gitRepoMatch = normalizedLine.match(/^Git repo: (.+)/);
  if (gitRepoMatch) {
    info.gitRepo = gitRepoMatch[1];
    return true;
  }

  const repoMapMatch = normalizedLine.match(/^Repo-map: (.+)/);
  if (repoMapMatch) {
    info.repoMap = repoMapMatch[1];
    return true;
  }

  const tokensMatch = normalizedLine.match(/^Tokens?: (.+)/);
  if (tokensMatch) {
    info.chatTokens = tokensMatch[1];
    return true;
  }

  const costMatch = normalizedLine.match(/^Cost: (.+)/);
  if (costMatch) {
    info.cost = costMatch[1];
    return true;
  }

  if (/\bwarning\b/i.test(normalizedLine)) {
    info.warnings.push(normalizedLine);
    return true;
  }

  if (/\berror\b/i.test(normalizedLine)) {
    info.errors.push(normalizedLine);
    return true;
  }

  if (normalizedLine.startsWith("Cost estimates may be inaccurate")) {
    info.warnings.push(normalizedLine);
    return true;
  }

  if (normalizedLine.startsWith("Initial repo scan can be slow")) {
    info.warnings.push(normalizedLine);
    return true;
  }

  if (/^https?:\/\/[\w\-./?#=&%]+$/i.test(normalizedLine)) {
    info.warnings.push(normalizedLine);
    return true;
  }

  if (/^waiting for /i.test(normalizedLine)) {
    info.warnings.push(normalizedLine);
    return true;
  }

  return false;
}

function buildEditBlockFromPathAndCode(
  path: string,
  block: CodeSegment,
): EditBlock | null {
  const content = linesToContent(block.lines);

  if (content.includes("<<<<<<< SEARCH")) {
    return parseDiffFormat(path, content);
  }

  return {
    format: "whole",
    path,
    newText: content,
  };
}

function handleStandaloneCodeSegment(
  segment: CodeSegment,
  editBlocks: EditBlock[],
  codeBlocks: CodeBlock[],
): void {
  const label = extractFenceLabel(segment.open);
  const normalizedLabel = label.toLowerCase();
  const contentLines = segment.lines.map(trimTrailingNewline);
  const content = contentLines.join("\n");

  if (normalizedLabel === "diff" || normalizedLabel === "udiff") {
    const editBlock = parseUdiffFormat(content);
    if (editBlock) {
      editBlocks.push(editBlock);
      return;
    }
  }

  if (contentLines.length > 0) {
    const firstLine = contentLines[0].trim();
    if (isPotentialFilePath(firstLine) && content.includes("<<<<<<< SEARCH")) {
      const diffBlock = parseDiffFencedFormat(firstLine, contentLines.slice(1));
      if (diffBlock) {
        editBlocks.push(diffBlock);
        return;
      }
    }
  }

  codeBlocks.push({
    path: label || "unknown",
    content,
  });
}

function extractFenceLabel(openLine: string): string {
  const trimmedStart = trimTrailingNewline(openLine).trimStart();
  if (trimmedStart.startsWith("```")) {
    return trimmedStart.substring(3).trim();
  }
  return trimmedStart.trim();
}

function linesToContent(lines: string[]): string {
  return lines.map(trimTrailingNewline).join("\n");
}

function isPotentialFilePath(value: string): boolean {
  if (!value || /\s/.test(value)) {
    return false;
  }
  return isValidFilePath(value);
}

function parseDiffFormat(path: string, content: string): EditBlock | null {
  const searchReplaceBlocks = extractSearchReplaceBlocks(content);

  if (searchReplaceBlocks.length === 0) {
    return null;
  }

  const firstBlock = searchReplaceBlocks[0];

  return {
    format: "diff",
    path,
    oldText: firstBlock.search,
    newText: firstBlock.replace,
  };
}

function parseDiffFencedFormat(
  path: string,
  contentLines: string[],
): EditBlock | null {
  const content = contentLines.join("\n");
  return parseDiffFormat(path, content);
}

function parseUdiffFormat(content: string): EditBlock | null {
  const lines = content.split("\n");

  let path = "";
  let oldText = "";
  let newText = "";

  for (const line of lines) {
    if (line.startsWith("--- ")) {
      path = line.substring(4).trim();
    } else if (line.startsWith("+++ ")) {
      const newPath = line.substring(4).trim();
      if (newPath.length > 0) {
        path = newPath;
      }
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      oldText += line.substring(1) + "\n";
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      newText += line.substring(1) + "\n";
    }
  }

  if (!path) {
    return null;
  }

  return {
    format: "udiff",
    path,
    oldText: oldText.trimEnd(),
    newText: newText.trimEnd(),
  };
}

function extractSearchReplaceBlocks(content: string): DiffSearchReplace[] {
  const blocks: DiffSearchReplace[] = [];
  const lines = content.split("\n");

  let index = 0;
  while (index < lines.length) {
    if (lines[index].trim() === "<<<<<<< SEARCH") {
      const searchLines: string[] = [];
      const replaceLines: string[] = [];
      index += 1;

      while (index < lines.length && lines[index].trim() !== "=======") {
        searchLines.push(lines[index]);
        index += 1;
      }

      if (index < lines.length) {
        index += 1;
      }

      while (
        index < lines.length &&
        lines[index].trim() !== ">>>>>>> REPLACE"
      ) {
        replaceLines.push(lines[index]);
        index += 1;
      }

      if (searchLines.length > 0 || replaceLines.length > 0) {
        blocks.push({
          search: searchLines.join("\n"),
          replace: replaceLines.join("\n"),
        });
      }

      index += 1;
    } else {
      index += 1;
    }
  }

  return blocks;
}

function isValidFilePath(path: string): boolean {
  if (!path || path.length === 0) {
    return false;
  }

  if (
    path.includes("```") ||
    path.includes("<<<") ||
    path.includes(">>>") ||
    path.includes("===") ||
    path.includes("diff") ||
    path.startsWith("-") ||
    path.startsWith("+")
  ) {
    return false;
  }

  return (
    path.includes("/") ||
    path.includes(".") ||
    /^[a-zA-Z0-9_.-]+\.[a-zA-Z0-9]+$/.test(path) ||
    /^[a-zA-Z0-9_.-]+\//.test(path) ||
    /^[a-zA-Z0-9_.-]+$/.test(path)
  );
}

export function convertEditBlocksToACPDiffs(editBlocks: EditBlock[]): Array<{
  type: "diff";
  path: string;
  oldText: string | null;
  newText: string;
}> {
  return editBlocks.map((block) => ({
    type: "diff" as const,
    path: block.path,
    oldText: block.oldText || null,
    newText: block.newText,
  }));
}

export function formatAiderInfo(info: AiderInfo): string {
  const parts: string[] = [];

  if (info.version) parts.push(`🚀 **Aider**: ${info.version}`);
  if (info.mainModel) parts.push(`🤖 **Main Model**: ${info.mainModel}`);
  if (info.weakModel) parts.push(`🤖 **Weak Model**: ${info.weakModel}`);
  if (info.gitRepo) parts.push(`📁 **Repo**: ${info.gitRepo}`);
  if (info.repoMap) parts.push(`🗺️ **Repo-map**: ${info.repoMap}`);
  if (info.chatTokens) parts.push(`\n\n💬 **Tokens**: ${info.chatTokens}`);
  if (info.cost) parts.push(`💰 **Cost**: ${info.cost}`);

  info.warnings.forEach((warning) => parts.push(`⚠️ ${warning}`));
  info.errors.forEach((error) => parts.push(`❌ ${error}`));

  if (parts.length > 0) {
    return parts.join("\n\n") + "\n\n";
  }

  return "";
}

export function testParser(): void {
  console.log("Testing Aider Output Parser...\n");

  const wholeFormatOutput = `show_greeting.py
\`\`\`
import sys

def greeting(name):
    print("Hey", name)

if __name__ == '__main__':
    greeting(sys.argv[1])
\`\`\``;

  console.log("=== Testing Whole Format ===");
  const wholeResult = parseAiderOutput(wholeFormatOutput);
  console.log("Edit blocks found:", wholeResult.editBlocks.length);
  console.log("Edit block:", wholeResult.editBlocks[0]);

  const diffFormatOutput = `mathweb/flask/app.py
\`\`\`
<<<<<<< SEARCH
from flask import Flask
=======
import math
from flask import Flask
>>>>>>> REPLACE
\`\`\``;

  console.log("\n=== Testing Diff Format ===");
  const diffResult = parseAiderOutput(diffFormatOutput);
  console.log("Edit blocks found:", diffResult.editBlocks.length);
  console.log("Edit block:", diffResult.editBlocks[0]);

  const diffFencedOutput = `\`\`\`
mathweb/flask/app.py
<<<<<<< SEARCH
from flask import Flask
=======
import math
from flask import Flask
>>>>>>> REPLACE
\`\`\``;

  console.log("\n=== Testing Diff-Fenced Format ===");
  const diffFencedResult = parseAiderOutput(diffFencedOutput);
  console.log("Edit blocks found:", diffFencedResult.editBlocks.length);
  console.log("Edit block:", diffFencedResult.editBlocks[0]);

  const udiffFormatOutput = `\`\`\`diff
--- mathweb/flask/app.py
+++ mathweb/flask/app.py
@@ ... @@
-class MathWeb:
+import sympy

+class MathWeb:
\`\`\``;

  console.log("\n=== Testing Udiff Format ===");
  const udiffResult = parseAiderOutput(udiffFormatOutput);
  console.log("Edit blocks found:", udiffResult.editBlocks.length);
  console.log("Edit block:", udiffResult.editBlocks[0]);

  const mixedOutput = `Aider v0.37.1-dev
Main model: claude-3-5-sonnet-20241022 with diff edit format
Weak model: claude-3-haiku-20240307
Git repo: .git with 12 files
Repo-map: using 1024 tokens

> /add test.py

Added test.py to the chat

Let me help you create a simple test function.

test.py
\`\`\`
<<<<<<< SEARCH
def old_function():
    pass
=======
def new_function():
    print("Hello World")
>>>>>>> REPLACE
\`\`\`

Tokens: 1,234 sent, 567 received, 1,801 total
Cost: $0.02
`;

  console.log("\n=== Testing Mixed Output ===");
  const mixedResult = parseAiderOutput(mixedOutput);
  console.log("Info:", mixedResult.info);
  console.log("Edit blocks found:", mixedResult.editBlocks.length);
  console.log("Edit block:", mixedResult.editBlocks[0]);
  console.log("User message length:", mixedResult.userMessage.length);

  const promptOutput = `Add file to the chat? (Y)es/(N)o/(D)on't ask again [Yes]: y`;
  console.log("\n=== Testing Prompt Extraction ===");
  const promptResult = parseAiderOutput(promptOutput);
  console.log("Prompts:", promptResult.prompts);
}
