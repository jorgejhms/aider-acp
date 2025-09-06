import { AgentSideConnection } from "@zed-industries/agent-client-protocol";
import { AiderAcpAgent } from "./acp-agent.js";
import { nodeToWebReadable, nodeToWebWritable } from "./utils.js";

// This is the main entry point for the ACP agent.
// It creates a connection that pipes messages to and from the Zed editor,
// and instantiates our agent class.
new AgentSideConnection(
  (client) => new AiderAcpAgent(client),
  nodeToWebWritable(process.stdout),
  nodeToWebReadable(process.stdin),
);
