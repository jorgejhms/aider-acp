import * as protocol from "@zed-industries/agent-client-protocol";
import { SessionState } from "./types.js";
import { AiderProcessManager, AiderState } from "./aider-runner.js";

export class AiderAcpAgent implements protocol.Agent {
  private sessions: Map<string, SessionState> = new Map();
  private client: protocol.AgentSideConnection;

  constructor(client: protocol.AgentSideConnection) {
    this.client = client;
  }

  async initialize(
    request: protocol.InitializeRequest,
  ): Promise<protocol.InitializeResponse> {
    return {
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: {
          image: false,
          audio: false,
          embeddedContext: true,
        },
      },
      authMethods: [],
    };
  }

  async newSession(
    params: protocol.NewSessionRequest,
  ): Promise<protocol.NewSessionResponse> {
    const sessionId = `sess_${Date.now()}`;
    const workingDir = params.cwd || process.cwd();
    const model = "openrouter/deepseek/deepseek-chat-v3.1:free"; // Or get from params

    const aiderProcess = new AiderProcessManager(workingDir, model);

    const session: SessionState = {
      id: sessionId,
      created: new Date(),
      model,
      files: [],
      workingDir,
      aiderProcess,
      commandQueue: [],
    };

    this.sessions.set(sessionId, session);
    this.setupAiderListeners(sessionId, aiderProcess);
    aiderProcess.start();

    return { sessionId };
  }

  async prompt(
    params: protocol.PromptRequest,
  ): Promise<protocol.PromptResponse> {
    const { sessionId, prompt } = params;
    const session = this.sessions.get(sessionId);

    if (!session || !session.aiderProcess) {
      // In a real scenario, you might throw a RequestError here
      throw new Error("Invalid session or Aider process not running");
    }

    const textContent = prompt.find((item) => item.type === "text");
    if (!textContent || !textContent.text) {
      throw new Error("No text content found in prompt");
    }

    const agentState = session.aiderProcess.getState();
    const promptText = textContent.text;

    if (agentState === AiderState.WAITING_FOR_CONFIRMATION) {
      session.aiderProcess.answerConfirmation(promptText);
    } else {
      session.aiderProcess.sendCommand(promptText);
    }

    // The SDK handles the promise. We resolve it when we get the 'turn_completed' event.
    return new Promise((resolve) => {
      const turnCompletedListener = () => {
        // Clean up the listener to avoid memory leaks
        session.aiderProcess?.removeListener(
          "turn_completed",
          turnCompletedListener,
        );
        resolve({ stopReason: "end_turn" });
      };
      session.aiderProcess?.once("turn_completed", turnCompletedListener);
    });
  }

  private setupAiderListeners(
    sessionId: string,
    processManager: AiderProcessManager,
  ): void {
    processManager.on("data", (data: string) => {
      if (data.trim() === ">") return;
      this.client.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: data },
        },
      });
    });

    processManager.on("error", (errorData: string) => {
      const errorStr = errorData.toString();

      // Ignore progress bars, they are not errors
      if (errorStr.includes("Scanning repo:")) {
        // TODO: Parse this and send as a proper progress notification
        return;
      }

      // Handle specific warnings without treating them as critical errors
      if (errorStr.includes("leaked semaphore objects")) {
        this.client.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: `
**Warning:**
${errorStr}`,
            },
          },
        });
        return;
      }

      // For all other errors, report them
      this.client.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: `
**Error:**
${errorStr}`,
          },
        },
      });
    });

    processManager.on("confirmation_required", (question: string) => {
      this.client.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: `
**Aider requires input:**
${question}`,
          },
        },
      });
    });

    processManager.on("exit", (message: string) => {
      this.client.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: `
**Aider process terminated:** ${message}`,
          },
        },
      });
      const session = this.sessions.get(sessionId);
      if (session) session.aiderProcess = undefined;
    });
  }

  // Cancel is a fire-and-forget notification
  async cancel(params: protocol.CancelNotification): Promise<void> {
    const session = this.sessions.get(params.sessionId);
    if (session && session.aiderProcess) {
      try {
        // Try to exit gracefully first
        session.aiderProcess.sendCommand("/exit");
      } catch (e) {
        // If sending command fails, just kill it
        session.aiderProcess.stop();
      }
    }
  }

  async authenticate(params: protocol.AuthenticateRequest): Promise<void> {
    throw new Error("Authentication not implemented.");
  }
}
