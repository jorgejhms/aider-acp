import * as protocol from "@zed-industries/agent-client-protocol";
import { SessionState } from "./types.js";
import { AiderProcessManager, AiderState } from "./aider-runner.js";
import { parseAiderOutput, formatAiderInfo } from "./aider-output-parser.js";

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
      throw new Error("Invalid session or Aider process not running");
    }

    // Separar el contenido de texto y los recursos
    const textContent = prompt.find((item) => item.type === "text");
    const resources = prompt.filter((item) => item.type === "resource");

    // Si no hay texto, usar cadena vacía
    const promptText = textContent?.text || "";
    // Almacenar el último prompt para filtrarlo de la salida
    session.lastPromptText = promptText;

    const agentState = session.aiderProcess.getState();

    // Si estamos esperando confirmación, manejar directamente
    if (agentState === AiderState.WAITING_FOR_CONFIRMATION) {
      session.aiderProcess.answerConfirmation(promptText);
      return new Promise((resolve) => {
        const turnCompletedListener = () => {
          session.aiderProcess?.removeListener(
            "turn_completed",
            turnCompletedListener,
          );
          resolve({ stopReason: "end_turn" });
        };
        session.aiderProcess?.once("turn_completed", turnCompletedListener);
      });
    }

    // Manejar recursos primero (archivos)
    if (resources.length > 0) {
      // Agregar todos los recursos usando comandos /add
      for (const resource of resources) {
        if (resource.type === "resource" && resource.resource) {
          // Extraer la ruta del archivo del URI
          const uri = resource.resource.uri;
          let filePath: string;
          if (uri.startsWith("file://")) {
            filePath = uri.slice(7);
          } else {
            filePath = uri;
          }
          // Enviar comando /add silenciosamente
          session.aiderProcess.sendCommand(`/add ${filePath}`);

          // Esperar a que se complete el turno antes de continuar
          await new Promise<void>((resolve) => {
            const listener = () => {
              session.aiderProcess?.removeListener("turn_completed", listener);
              resolve();
            };
            session.aiderProcess?.once("turn_completed", listener);
          });
        }
      }
    }

    // Luego enviar el mensaje de texto si no está vacío
    if (promptText.trim().length > 0) {
      session.aiderProcess.sendCommand(promptText);
    } else if (resources.length > 0) {
      // Si solo hay recursos, enviar un comando vacío para procesar
      session.aiderProcess.sendCommand("");
    }

    // Esperar a que se complete el turno final
    return new Promise((resolve) => {
      const turnCompletedListener = () => {
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
    const session = this.sessions.get(sessionId);
    if (!session) return;
    processManager.on("data", (data: string) => {
      // Acumular datos para parsear
      const parsedOutput = parseAiderOutput(data);
      
      // Formatear información de Aider si está presente
      if (Object.keys(parsedOutput.info).length > 0) {
        const formattedInfo = formatAiderInfo(parsedOutput.info);
        if (formattedInfo.trim().length > 0) {
          this.client.sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: formattedInfo },
            },
          });
        }
      }

      // Enviar mensaje del usuario si está presente
      if (parsedOutput.userMessage.trim().length > 0) {
        this.client.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: parsedOutput.userMessage },
          },
        });
      }

      // Enviar bloques de código si están presentes
      for (const codeBlock of parsedOutput.codeBlocks) {
        this.client.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { 
              type: "text", 
              text: `\`\`\`${codeBlock.path}\n${codeBlock.content}\n\`\`\`` 
            },
          },
        });
      }
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
        // Send Control-C to interrupt current operation (not exit)
        session.aiderProcess.interrupt();
      } catch (e) {
        // If interrupt fails, fall back to stopping the process
        session.aiderProcess.stop();
      }
    }
  }

  async authenticate(params: protocol.AuthenticateRequest): Promise<void> {
    throw new Error("Authentication not implemented.");
  }
}
