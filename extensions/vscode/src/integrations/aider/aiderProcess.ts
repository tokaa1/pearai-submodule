import * as cp from "child_process";
import * as vscode from "vscode";
import * as os from "os";
import { execSync } from "child_process";
import { AiderState } from "./types/aiderTypes";
import { PearAICredentials } from "core/pearaiServer/PearAICredentials";
import {
  checkCredentials,
  checkGitRepository,
  getUserPath,
  getUserShell
} from "./aiderUtil";
import { SERVER_URL } from "core/util/parameters";

// Constants
export const PLATFORM = process.platform;
export const IS_WINDOWS = PLATFORM === "win32";
export const IS_MAC = PLATFORM === "darwin";
export const IS_LINUX = PLATFORM === "linux";
export const EDIT_FORMAT: string = "normal"; // options ["normal", "udiff"]
export const UDIFF_FLAG = EDIT_FORMAT === "udiff";
export const AIDER_READY_FLAG = UDIFF_FLAG ? "udiff> " : "> ";
export const END_MARKER = IS_WINDOWS
  ? UDIFF_FLAG ? "\r\nudiff> " : "\r\n> "
  : UDIFF_FLAG ? "\nudiff> " : "\n> ";
export const READY_PROMPT_REGEX = />[^\S\r\n]*(?:[\r\n]|\s)*(?:\s+)(?:[\r\n]|\s)*$/;
export const AIDER_QUESTION_MARKER = "[Yes]\\:";
export const AIDER_END_MARKER = "─────────────────────────────────────";
export const COMPLETION_DELAY = 1500; // 1.5 seconds wait time

export function buildAiderCommand(model: string, accessToken: string | undefined, apiKey: string | undefined): string[] {
  const aiderCommand = ["aider"];

  let aiderFlags = [
    "--no-pretty",
    "--yes-always",
    "--no-auto-commits",
    "--no-suggest-shell-commands",
    "--no-check-update",
    "--no-auto-lint",
    "--map-tokens", "2048",
    "--subtree-only"
  ];

  aiderCommand.push(...aiderFlags);

  if (model === "pearai_model") {
    aiderCommand.push("--openai-api-key", accessToken || "");
    aiderCommand.push("--openai-api-base", `${SERVER_URL}/integrations/aider`);
  } else if (model.includes("claude")) {
    aiderCommand.unshift(`export ANTHROPIC_API_KEY=${apiKey};`);
    aiderCommand.push("--model", model);
  } else if (model.includes("gpt")) {
    aiderCommand.unshift(`export OPENAI_API_KEY=${apiKey};`);
    aiderCommand.push("--model", model);
  }

  if (UDIFF_FLAG) {
    aiderCommand.push("--edit-format", "udiff");
  }

  return aiderCommand;
}

async function spawnAiderProcessWindows(
  currentDir: string,
  command: string[],
  model: string,
  apiKey: string | undefined,
  accessToken: string | undefined,
  userPath: string
): Promise<cp.ChildProcess> {
  const envSetCommands = [
    "setx PYTHONIOENCODING utf-8",
    "setx AIDER_SIMPLE_OUTPUT 1",
    "chcp 65001",
  ];
  if (model.includes("claude")) {
    envSetCommands.push(`setx ANTHROPIC_API_KEY ${apiKey}`);
  } else if (model.includes("gpt")) {
    envSetCommands.push(`setx OPENAI_API_KEY ${apiKey}`);
  } else {
    envSetCommands.push(`setx OPENAI_API_KEY ${accessToken}`);
  }

  // Execute setx commands in the background
  for (const cmd of envSetCommands) {
    await new Promise((resolve, reject) => {
      cp.exec(cmd, { windowsHide: true }, (error, stdout, stderr) => {
        if (error) {
          console.error(`Error executing ${cmd}: ${error}`);
          reject(error);
        } else {
          console.log(`Executed: ${cmd}`);
          resolve(stdout);
        }
      });
    });
  }

  return cp.spawn("cmd.exe", ["/c", ...command], {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: currentDir,
    env: {
      ...process.env,
      PATH: userPath,
      PYTHONIOENCODING: "utf-8",
      AIDER_SIMPLE_OUTPUT: "1",
    },
    windowsHide: true,
  });
}

function spawnAiderProcessUnix(
  currentDir: string,
  command: string[],
  model: string,
  apiKey: string | undefined,
  accessToken: string | undefined,
  userPath: string,
  userShell: string
): cp.ChildProcess {
  let envVars = "";
  if (model.includes("claude")) {
    envVars = `export ANTHROPIC_API_KEY=${apiKey};`;
  } else if (model.includes("gpt")) {
    envVars = `export OPENAI_API_KEY=${apiKey};`;
  } else {
    envVars = `export OPENAI_API_KEY=${accessToken};`;
  }

  return cp.spawn(userShell, ["-c", `${envVars} ${command.join(" ")}`], {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: currentDir,
    env: {
      ...process.env,
      PATH: userPath,
      PYTHONIOENCODING: "utf-8",
      AIDER_SIMPLE_OUTPUT: "1",
    },
  });
}

export async function startAiderProcess(
  currentDir: string,
  command: string[],
  model: string,
  apiKey: string | undefined,
  accessToken: string | undefined
): Promise<cp.ChildProcess | null> {
  const userPath = getUserPath();
  const userShell = getUserShell();

  try {
    if (IS_WINDOWS) {
      return await spawnAiderProcessWindows(currentDir, command, model, apiKey, accessToken, userPath);
    } else {
      return spawnAiderProcessUnix(currentDir, command, model, apiKey, accessToken, userPath, userShell);
    }
  } catch (error) {
    console.error("Error spawning Aider process:", error);
    return null;
  }
}


export function killAiderProcess(process: cp.ChildProcess, onKill?: () => void) {
  if (process && !process.killed) {
    console.log("Killing Aider process...");
    process.kill();
    if (onKill) {
      onKill();
    }
  }
}

export function aiderCtrlC(process: cp.ChildProcess) {
  if (process && !process.killed) {
    console.log("Sending Ctrl+C signal to Aider process...");
    if (process.stdin) {
      process.stdin.write("\x03"); // Send Ctrl+C
    }
  } else {
    console.log("No active Aider process to send Ctrl+C to.");
  }
}

export class AiderProcessManager {
  private static instance: AiderProcessManager | null = null;
  private aiderProcess: cp.ChildProcess | null = null;
  private apiKey?: string | undefined = undefined;
  private model?: string;
  private _state: AiderState = { state: "undefined" };
  private credentials: PearAICredentials;
  public aiderOutput: string = "";
  private lastProcessedIndex: number = 0;

  private constructor(apiKey: string | undefined, model: string, credentials: PearAICredentials) {
    console.dir("Initializing Aider Process Manager");
    this.apiKey = apiKey;
    this.model = model;
    this.credentials = credentials;
  }

  get state(): AiderState {
    return this._state;
  }


  public updateState(newState: Omit<AiderState, "timeStamp">) {
    console.log(`Aider state changing from ${this._state.state} to ${newState.state}`);

    // TODO: probably handle this better. Crashed happens because we send a SIGINT to the process needed to reset. @nang
    if (this._state.state === "restarting" && newState.state === "crashed") {
    console.log("Blocking state change from 'restarting' to 'crashed'");

      return;
    }
    this._state = {
      ...newState,
      timeStamp: Date.now()
    };
    vscode.commands.executeCommand("pearai.setAiderProcessState", this._state);
  }

  private captureAiderOutput(data: Buffer): void {
    const output = data.toString();
    console.log("Raw Aider output: ", JSON.stringify(output));

    let cleanOutput = output.replace(/\x1B\[[0-9;]*[JKmsu]/g, "");
    const specialLoadingChars = /⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏/g;
    cleanOutput = cleanOutput.replace(specialLoadingChars, "");
    cleanOutput = cleanOutput.replace(/Updating repo map/g, "Updating repo map...");

    this.aiderOutput += cleanOutput;
  }

async startAiderChat(model: string, apiKey: string | undefined, isRestarting: boolean = false): Promise<void> {
  if (!isRestarting) {
    this.updateState({ state: "starting" });
  }

    try {
        // Check if current workspace is a git repo
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            this.updateState({ state: "notgitrepo" });
            vscode.window.showErrorMessage('Please open a workspace folder to use PearAI Creator.');
            return;
        }
        const currentDir = workspaceFolders[0].uri.fsPath;


      const isGitRepo = await checkGitRepository(currentDir);
      if (!isGitRepo) {
        this.updateState({ state: "notgitrepo" });
        throw new Error("Not a git repository");
      }

      if (!checkCredentials(model, this.credentials)) {
        this.updateState({ state: "signedOut" });
        throw new Error("User not logged in");
      }

      const command = buildAiderCommand(model, this.credentials.getAccessToken(), apiKey);

      this.aiderProcess = await startAiderProcess(
        currentDir,
        command,
        model,
        apiKey,
        this.credentials.getAccessToken()
      );

      this.setupProcessListeners();
      this.setupExtendedProcessHandlers();
    } catch (error) {
      console.error("Error in startAiderChat:", error);
      const errorState = this.determineErrorState(error);
      this.updateState({ state: errorState });
      throw error;
    }
  }

  private setupProcessListeners() {
    if (!this.aiderProcess) return;

    if (this.aiderProcess.stdout) {
      this.aiderProcess.stdout.on("data", (data: Buffer) => {
        this.captureAiderOutput(data);
        const output = data.toString();
        if (READY_PROMPT_REGEX.test(output)) {
          this.updateState({ state: "ready" });
        }
      });
    }

    this.aiderProcess.on('exit', (code, signal) => {
      console.log(`Aider process exited with code ${code}, signal ${signal}`);
      const newState = code === 0 ? "stopped" : "crashed";
      this.updateState({ state: newState });
    });

    this.aiderProcess.on('error', (err) => {
      console.error("Aider process error:", err);
      this.handleProcessError(err);
    });
  }

  private setupExtendedProcessHandlers() {
    if (!this.aiderProcess) return;

    this.aiderProcess.on('disconnect', () => {
      console.log("Aider process disconnected");
      this.updateState({ state: "stopped" });
    });

    this.aiderProcess.on('spawn', () => {
      console.log("Aider process spawned successfully");
    });

    if (this.aiderProcess.stdout) {
      this.aiderProcess.stdout.on('close', () => {
        console.log("Aider stdout closed");
      });
    }

    if (this.aiderProcess.stderr) {
      this.aiderProcess.stderr.on('close', () => {
        console.log("Aider stderr closed");
      });
    }

    if (this.aiderProcess.stdin) {
      this.aiderProcess.stdin.on('error', (error) => {
        console.error("Error writing to Aider stdin:", error);
        this.handleProcessError(error);
      });
    }
  }

  private handleProcessError(error: Error): void {
    console.error("Aider process error:", error);

    if (error.message.includes("authentication")) {
      this.updateState({ state: "signedOut" });
    } else if (error.message.includes("ENOENT")) {
      this.updateState({ state: "uninstalled" });
    } else {
      this.updateState({ state: "crashed" });
    }

    this.cleanup();
  }

  sendToAiderChat(message: string): void {
    if (
      this.aiderProcess &&
      this.aiderProcess.stdin &&
      !this.aiderProcess.killed
    ) {
      const formattedMessage = message.replace(/\n+/g, " ");
      this.aiderProcess.stdin.write(`${formattedMessage}\n`);
    } else {
      this.handleProcessNotRunning();
    }
  }

  private handleProcessNotRunning() {
    console.error("PearAI Creator (Powered by Aider) process is not running");
    vscode.window
      .showErrorMessage(
        "PearAI Creator (Powered by Aider) process is not running. Please view PearAI Creator troubleshooting guide.",
        "View Troubleshooting",
      )
      .then((selection) => {
        if (selection === "View Troubleshooting") {
          vscode.env.openExternal(
            vscode.Uri.parse(
              "https://trypear.ai/blog/how-to-setup-aider-in-pearai",
            ),
          );
        }
      });
  }

  private determineErrorState(error: any): AiderState["state"] {
    if (error.message.includes("Not a git repository")) {
      return "notgitrepo";
    }
    if (error.message.includes("User not logged in")) {
      return "signedOut";
    }
    return "crashed";
  }

  killAiderProcess(): void {
    if (this.aiderProcess) {
      killAiderProcess(this.aiderProcess);
      this.aiderProcess = null;
      this.updateState({ state: "stopped" });
    }
  }

  aiderCtrlC(): void {
    if (this.aiderProcess) {
      aiderCtrlC(this.aiderProcess);
    }
  }

  async resetSession(model: string, apiKey: string | undefined): Promise<void> {
    console.log("Resetting Aider process...");
    if (this.aiderProcess) {
      killAiderProcess(this.aiderProcess);
      this.aiderProcess = null;
      this.updateState({ state: "restarting" });
    }

    try {
      await this.startAiderChat(model, apiKey, true);
      console.log("Aider process reset successfully.");
    } catch (error) {
      console.error("Error resetting Aider process:", error);
      throw error;
    }
  }

  cleanup(): void {
    this.killAiderProcess();
    this.aiderOutput = "";
    this.lastProcessedIndex = 0;
    this.aiderProcess = null;
    this.updateState({ state: "stopped" });
  }

  getAiderProcess(): cp.ChildProcess | null {
    return this.aiderProcess;
  }

  isProcessRunning(): boolean {
    return this.aiderProcess !== null && !this.aiderProcess.killed;
  }

  isPipeActive(): boolean {
    return this.isProcessRunning() && this.aiderProcess?.stdin !== null;
  }
  public static getInstance(apiKey: string | undefined, model: string, credentials: PearAICredentials): AiderProcessManager {
    if (!AiderProcessManager.instance) {
      AiderProcessManager.instance = new AiderProcessManager(apiKey, model, credentials);
    }
    // Update credentials and API key if they've changed
    AiderProcessManager.instance.credentials = credentials;
    AiderProcessManager.instance.apiKey = apiKey;
    AiderProcessManager.instance.model = model;
    return AiderProcessManager.instance;
  }
}

