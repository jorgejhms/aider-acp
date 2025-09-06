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
    const chunk = data.toString();
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
