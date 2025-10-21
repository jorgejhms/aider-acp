import * as protocol from "@agentclientprotocol/sdk";
import { SessionState } from "./types.js";
import { AiderProcessManager, AiderState } from "./aider-runner.js";
import {
  parseAiderOutput,
  formatAiderInfo,
  convertEditBlocksToACPDiffs,
} from "./aider-output-parser.js";

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
    // const model = "openrouter/deepseek/deepseek-chat-v3.1:free"; // Or get from params
    // const model = "opentouer/deepseek/deepseek-chat-v3-0324:free"; // Or get from params
    const model = "gemini/gemini-2.5-flash"; // Or get from params

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
    const textContents = prompt.filter((item) => item.type === "text");
    const resources = prompt.filter((item) => item.type === "resource");

    // Combinar todos los textos y eliminar espacios vacíos
    const promptText = textContents
      .map((item) => item.text?.trim() || "")
      .filter((text) => text.length > 0)
      .join(" ")
      .trim();

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

    // Guardar el texto del prompt para enviarlo después de procesar los recursos
    let finalPromptText = promptText;

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
          // Enviar comando /add
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

    // Después de procesar todos los recursos, enviar el texto del prompt si existe
    if (finalPromptText.trim().length > 0) {
      session.aiderProcess.sendCommand(finalPromptText);
      // Esperar a que se complete el turno
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
    } else {
      // Si no hay texto, simplemente terminar
      return { stopReason: "end_turn" };
    }
  }

  private setupAiderListeners(
    sessionId: string,
    processManager: AiderProcessManager,
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    processManager.on("data", (data: string) => {
      // Parse the complete data first to extract edit blocks
      const parsedOutput = parseAiderOutput(data);
      const { info, userMessage, editBlocks, codeBlocks, prompts } =
        parsedOutput;

      // Then filter only the remaining text for display, avoiding interference with edit blocks
      const processedLines = data
        .split("\n")
        .map((line) => {
          // Only filter command echoes ("> command"), not diff markers
          if (
            line.startsWith("> ") &&
            !line.includes(">>>") &&
            !line.includes("<<<")
          ) {
            return null;
          }
          // Don't process lines that are part of code blocks or edit blocks
          if (
            line.startsWith("```") ||
            line.includes("<<<<<<< SEARCH") ||
            line.includes(">>>>>>> REPLACE") ||
            line.includes("=======")
          ) {
            return null;
          }
          // Agregar emoji a mensajes de archivos añadidos
          if (line.startsWith("Added ")) {
            return `📁 ${line}`;
          }
          // Agregar emoji de advertencia a mensajes de archivos ya en el chat
          if (line.includes("is already in the chat")) {
            return `⚠️ ${line}`;
          }
          // Filtrar líneas que son solo nombres de archivo (sin prefijos)
          if (
            line.trim().length > 0 &&
            !line.includes(":") &&
            !line.includes(" ") &&
            line.includes(".") &&
            !line.startsWith("📁") &&
            !line.startsWith("⚠️")
          ) {
            return null;
          }
          return line;
        })
        .filter((line) => line !== null) as string[];

      const processedData = processedLines.join("\n");

      // Formatear información de Aider si está presente
      if (Object.keys(info).length > 0) {
        const formattedInfo = formatAiderInfo(info);
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

      // Mostrar solicitudes de confirmación/texto interactivo
      for (const promptLine of prompts) {
        this.client.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: `**Aider requires input:**\n${promptLine}`,
            },
          },
        });
      }

      // Enviar mensaje del usuario si está presente
      if (userMessage.trim().length > 0) {
        this.client.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: userMessage },
          },
        });
      }

      // Enviar bloques de edición como tool calls con diffs ACP
      if (editBlocks.length > 0) {
        const acpDiffs = convertEditBlocksToACPDiffs(editBlocks);
        for (let i = 0; i < acpDiffs.length; i++) {
          const diff = acpDiffs[i];
          const toolCallId = `edit_${Date.now()}_${i}`;

          // Crear tool call para la edición
          this.client.sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: "tool_call",
              toolCallId,
              title: `Editing ${diff.path}`,
              kind: "edit",
              status: "completed",
              content: [diff],
            },
          });
        }
      }

      // Enviar bloques de código si están presentes
      for (const codeBlock of codeBlocks) {
        this.client.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: `\`\`\`${codeBlock.path}\n${codeBlock.content}\n\`\`\``,
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
