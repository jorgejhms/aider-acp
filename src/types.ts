import { AiderProcessManager } from "./aider-runner.js";

// This will be the main state for each session.
// We are keeping it separate from the SDK types as it's internal to our agent.
export interface SessionState {
  id: string;
  created: Date;
  model: string;
  files: string[];
  workingDir: string;
  aiderProcess?: AiderProcessManager;
  commandQueue: string[];
  pendingPromptId?: string | number;
  lastPromptText?: string;
}
