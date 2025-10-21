import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";
import { AiderAcpAgent } from "./acp-agent.js";
import { nodeToWebReadable, nodeToWebWritable } from "./utils.js";
import { testParser } from "./aider-output-parser.js";

// Check for test mode
if (process.argv.includes("--test-parser")) {
  testParser();
  process.exit(0);
}

// This is the main entry point for the ACP agent.
// It creates a connection that pipes messages to and from the Zed editor,
// and instantiates our agent class.
const stream = ndJsonStream(
  nodeToWebWritable(process.stdout),
  nodeToWebReadable(process.stdin),
);

new AgentSideConnection((client) => new AiderAcpAgent(client), stream);
