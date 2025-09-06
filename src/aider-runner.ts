import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";

export enum AiderState {
  STARTING,
  WAITING_FOR_CONFIRMATION,
  READY,
  PROCESSING,
}

export class AiderProcessManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private workingDir: string;
  private model: string;
  private buffer: string = "";
  private turnBuffer: string = "";
  private state: AiderState = AiderState.STARTING;
  public pendingConfirmation: string | null = null;
  private lastCommand: string | null = null;

  private readonly AIDER_READY_PROMPT = ">";
  private readonly GITIGNORE_PROMPT =
    "Add .aider* to .gitignore (recommended)?";

  constructor(workingDir: string, model: string) {
    super();
    this.workingDir = workingDir;
    this.model = model;
  }

  public getState(): AiderState {
    return this.state;
  }

  public start(): void {
    if (this.process) return;

    const args = [
      "--model",
      this.model,
      "--no-pretty",
      "--no-show-model-warnings",
      "--no-browser",
      "--no-auto-commits",
      "--no-auto-test",
      "--no-dirty-commits",
    ];

    this.process = spawn("aider", args, {
      cwd: this.workingDir,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process.stdout?.on("data", (data) => this.handleOutput(data));
    this.process.stderr?.on("data", (data) => this.handleError(data));
    this.process.on("close", (code) => this.handleClose(code));
    this.process.on("error", (err) => this.emit("error", err.message));
  }

  private handleOutput(data: Buffer): void {
    let chunk = data.toString();
    
    // Filter out the echoed command lines that start with '> '
    if (this.lastCommand) {
      // Create a regex to match lines that start with '> ' followed by the exact command
      // We need to escape special regex characters in the command
      const escapedCommand = this.lastCommand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const echoedRegex = new RegExp(`^> ${escapedCommand}[\\r\\n]*`, 'gm');
      
      // Check if the entire chunk matches the echoed command
      if (chunk.match(echoedRegex)) {
        this.lastCommand = null;
        return;
      }
      
      // Remove any instances of the echoed command from the chunk
      const newChunk = chunk.replace(echoedRegex, '');
      if (newChunk.length !== chunk.length) {
        chunk = newChunk;
        this.lastCommand = null;
      }
      
      // If chunk is empty after filtering, return early
      if (chunk.length === 0) {
        return;
      }
    }
    
    this.buffer += chunk;
    this.turnBuffer += chunk;
    this.emit("data", chunk);

    if (
      this.state === AiderState.STARTING &&
      this.buffer.includes(this.GITIGNORE_PROMPT)
    ) {
      this.state = AiderState.WAITING_FOR_CONFIRMATION;
      this.pendingConfirmation = this.GITIGNORE_PROMPT;
      this.emit("confirmation_required", this.GITIGNORE_PROMPT);
      this.buffer = "";
      this.turnBuffer = "";
    } else if (this.buffer.trim().endsWith(this.AIDER_READY_PROMPT)) {
      this.emit("turn_completed", this.turnBuffer);
      this.state = AiderState.READY;
      this.emit("ready");
      this.buffer = "";
      this.turnBuffer = "";
    }
  }

  private handleError(data: Buffer): void {
    const errorChunk = data.toString();
    if (errorChunk.includes("Input is not a terminal")) {
      // Suppress this specific, harmless warning
      return;
    }
    this.emit("data", errorChunk);
    this.emit("error", errorChunk);
  }

  private handleClose(code: number | null): void {
    this.emit("exit", `Aider process exited with code ${code ?? "unknown"}`);
    this.process = null;
  }

  public sendCommand(command: string): void {
    if (!this.process || !this.process.stdin) {
      this.emit("error", "Aider process is not running.");
      return;
    }
    this.state = AiderState.PROCESSING;
    this.turnBuffer = "";
    this.buffer = "";
    this.lastCommand = command;
    this.process.stdin.write(`${command}\n`);
  }

  public answerConfirmation(answer: string): void {
    if (this.state !== AiderState.WAITING_FOR_CONFIRMATION) return;
    this.state = AiderState.PROCESSING;
    this.pendingConfirmation = null;
    this.sendCommand(answer);
  }

  public stop(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}
