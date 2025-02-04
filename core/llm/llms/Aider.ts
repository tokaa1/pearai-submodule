import {
  ChatMessage,
  CompletionOptions,
  LLMOptions,
  ModelProvider,
} from "../../index.js";
import { SERVER_URL } from "../../util/parameters.js";
import { BaseLLM } from "../index.js";
import { streamSse, streamJSON } from "../stream.js";
import { checkTokens } from "../../db/token.js";
import { stripImages } from "../images.js";
import { countTokens } from "../countTokens.js";
import * as cp from "child_process";
import * as process from "process";
import { PearAICredentials } from "../../pearaiServer/PearAICredentials.js";
import { getHeaders } from "../../pearaiServer/stubs/headers.js";
import { execSync } from "child_process";
import * as os from "os";
import * as vscode from "vscode";

const PLATFORM = process.platform;
const IS_WINDOWS = PLATFORM === "win32";
const IS_MAC = PLATFORM === "darwin";
const IS_LINUX = PLATFORM === "linux";
const EDIT_FORMAT:string = "normal"; // options ["normal", "udiff"]
const UDIFF_FLAG = EDIT_FORMAT === "udiff"
const AIDER_READY_FLAG = UDIFF_FLAG ? "udiff> " : "> ";
const END_MARKER = IS_WINDOWS
  ? (UDIFF_FLAG ? "\r\nudiff> " : "\r\n> ")
  : (UDIFF_FLAG ? "\nudiff> " : "\n> ");
const READY_PROMPT_REGEX = />[^\S\r\n]*(?:[\r\n]|\s)*(?:\s+)(?:[\r\n]|\s)*$/;

export const AIDER_QUESTION_MARKER = "[Yes]\\:";
export const AIDER_END_MARKER = "─────────────────────────────────────";

export interface AiderState {
  state: "starting" | "uninstalled" | "ready" |  "stopped" |"crashed" | "signedOut";
}

class Aider extends BaseLLM {
  getCurrentDirectory: (() => Promise<string>) | null = null;
  static providerName: ModelProvider = "aider";
  static defaultOptions: Partial<LLMOptions> = {
    model: "pearai_model",
    contextLength: 8192,
    completionOptions: {
      model: "pearai_model",
      maxTokens: 2048,
    },
  };

  public aiderProcess: cp.ChildProcess | null = null;
  private aiderOutput: string = "";
  private credentials: PearAICredentials;
  private command: string[];

  public aiderState: AiderState["state"] = "starting";

  public getAiderState(): AiderState["state"] {
    return this.aiderState;
  }

  public setAiderState(state: AiderState["state"]): void {
    this.aiderState = state;
    // Send an update to the UI
    vscode.commands.executeCommand("pearai.refreshAiderProcessState");
  }


  constructor(options: LLMOptions) {
    super(options);
    if (options.getCurrentDirectory) {
      this.getCurrentDirectory = options.getCurrentDirectory;
    }
    this.credentials = new PearAICredentials(
      options.getCredentials,
      options.setCredentials || (async () => {}),
    );
    console.log("Aider constructor called");
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.command = [];
  }

  public async aiderResetSession(
    model: string,
    apiKey: string | undefined,
  ): Promise<void> {
    console.log("Resetting Aider process...");
    // Kill the current process if it exists, with reset flag
    this.killAiderProcess(true);
    // Reset the output
    this.aiderOutput = "";

    // Restart the Aider chat with the provided model and API key
    try {
      await this.startAiderChat(model, apiKey);
      console.log("Aider process reset successfully.");
    } catch (error) {
      console.error("Error resetting Aider process:", error);
      throw error;
    }
  }

  public killAiderProcess(reset: boolean = false): void {
    if (this.aiderProcess && !this.aiderProcess.killed) {
      console.log("Killing Aider process...");
      this.aiderProcess.kill();
      this.aiderProcess = null;
      if (!reset) {
        this.setAiderState("stopped");
      }
    }
  }

  public aiderCtrlC(): void {
    if (this.aiderProcess && !this.aiderProcess.killed) {
      console.log("Sending Ctrl+C signal to Aider process...");
      this.sendToAiderChat("\x03"); // Send Ctrl+C to the Aider process
    } else {
      console.log("No active Aider process to send Ctrl+C to.");
    }
  }

  public setPearAIAccessToken(value: string | undefined): void {
    this.credentials.setAccessToken(value);
  }

  public setPearAIRefreshToken(value: string | undefined): void {
    this.credentials.setRefreshToken(value);
  }

  private getUserShell(): string {
    if (IS_WINDOWS) {
      return process.env.COMSPEC || "cmd.exe";
    }
    // return process.env.SHELL || "/bin/sh";
    return "/bin/sh";
  }

  private getUserPath(): string {
    try {
      let pathCommand: string;
      const shell = this.getUserShell();

      if (os.platform() === "win32") {
        // For Windows, we'll use a PowerShell command
        pathCommand =
          "powershell -Command \"[Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')\"";
      } else {
        // For Unix-like systems (macOS, Linux)
        pathCommand = `${shell} -ilc 'echo $PATH'`;
      }

      return execSync(pathCommand, { encoding: "utf8" }).trim();
    } catch (error) {
      console.error("Error getting user PATH:", error);
      return process.env.PATH || "";
    }
  }

  private captureAiderOutput(data: Buffer): void {
    const output = data.toString();
    console.log("Raw Aider output: ", JSON.stringify(output));

    // Remove ANSI escape codes
    let cleanOutput = output.replace(/\x1B\[[0-9;]*[JKmsu]/g, "");

    const specialLoadingChars = /⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏/g;
    cleanOutput = cleanOutput.replace(specialLoadingChars, "");
    cleanOutput = cleanOutput.replace(/Updating repo map/g, "Updating repo map...");

    // Preserve line breaks
    this.aiderOutput += cleanOutput;
  }



  public async startAiderChat(
    model: string,
    apiKey: string | undefined,
  ): Promise<void> {
    if (this.aiderProcess && !this.aiderProcess.killed) {
      console.log("Aider process already running");
      this.setAiderState("ready");
      return;
    }

    return new Promise(async (resolve, reject) => {
      let currentDir: string;
      if (this.getCurrentDirectory) {
        currentDir = await this.getCurrentDirectory();
      } else {
        currentDir = "";
      }

      let aiderFlags =
        "--no-pretty --yes-always --no-auto-commits --no-suggest-shell-commands --no-check-update --no-auto-lint --map-tokens 2048 --subtree-only"
      if (UDIFF_FLAG) {
        aiderFlags += " --edit-format udiff";
      }

        const aiderCommands = [
        `python -m aider ${aiderFlags}`,
        `python3 -m aider ${aiderFlags}`,
        `aider ${aiderFlags}`,
      ];
      let commandFound = false;

      for (const aiderCommand of aiderCommands) {
        try {
          console.dir("Running aider command: ")
          console.dir(aiderCommand)
          await execSync(`${aiderCommand} --version`, { stdio: "ignore" });
          commandFound = true;

          if (model.includes("claude")) {
            this.command = [`${aiderCommand} --model ${model}`];
          } else if (model.includes("gpt")) {
            this.command = [`${aiderCommand} --model ${model}`];
          } else {  // handles pearai, aider, and default cases
              await this.credentials.checkAndUpdateCredentials();
              const accessToken = this.credentials.getAccessToken();
              if (!accessToken) {
                this.setAiderState("signedOut");
                throw new Error("User not logged in to PearAI.");
              }
              this.command = [
                aiderCommand,
                "--openai-api-key",
                accessToken,
                "--openai-api-base",
                `${SERVER_URL}/integrations/aider`,
              ];
              break;
          }
          break; // Exit the loop if a working command is found
        } catch (error) {
          console.log(
            `Command ${aiderCommand} not found or errored. Trying next...`,
          );
          if (error instanceof Error && error.message === "User not logged in to PearAI.") {
            throw error; // Re-throw auth errors
          }
        }
      }

      if (!commandFound) {
        throw new Error(
          "Aider command not found. Please ensure it's installed correctly.",
        );
      }

      const userPath = this.getUserPath();
      const userShell = this.getUserShell();

  const spawnAiderProcess = async () => {
    try {
      if (IS_WINDOWS) {
        return spawnAiderProcessWindows();
      } else {
        return spawnAiderProcessUnix();
      }
    } catch (error) {
      console.error('Error spawning Aider process:', error);
      return null;
    }
  };

  const spawnAiderProcessWindows = async () => {
    const envSetCommands = [
      "setx PYTHONIOENCODING utf-8",
      "setx AIDER_SIMPLE_OUTPUT 1",
      "chcp 65001",
    ];

    if (model === "claude-3-5-sonnet-20240620") {
      envSetCommands.push(`setx ANTHROPIC_API_KEY ${apiKey}`);
    } else if (model === "gpt-4o") {
      envSetCommands.push(`setx OPENAI_API_KEY ${apiKey}`);
    } else {
      // For pearai_model, we're using the access token
      const accessToken = this.credentials.getAccessToken();
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

    // Now spawn Aider in the background
    return cp.spawn("cmd.exe", ["/c", ...this.command], {
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
  };

  const spawnAiderProcessUnix = () => {
    if (model.includes("claude")) {
      this.command.unshift(`export ANTHROPIC_API_KEY=${apiKey};`);
    } else if (model.includes("gpt")) {
      this.command.unshift(`export OPENAI_API_KEY=${apiKey};`);
    } else {
      // For pearai_model, we're using the access token
      const accessToken = this.credentials.getAccessToken();
      this.command.unshift(`export OPENAI_API_KEY=${accessToken};`);
    }
    console.dir("RUNNING AIDER COMMMAND:")
    console.dir(this.command.join(" "))
    return cp.spawn(userShell, ["-c", this.command.join(" ")], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: currentDir,
      env: {
        ...process.env,
        PATH: userPath,
        PYTHONIOENCODING: "utf-8",
        AIDER_SIMPLE_OUTPUT: "1",
      },
    });
  };

      const tryStartAider = async () => {
        console.log("Starting Aider...");
        this.aiderProcess = await spawnAiderProcess();

        if (this.aiderProcess === null) {
          this.setAiderState("crashed");
          return;
        }

        if (this.aiderProcess.stdout && this.aiderProcess.stderr) {
          const timeout = setTimeout(() => {
            reject(new Error("Aider failed to start within timeout period"));
          }, 30000); // 30 second timeout

          this.aiderProcess.stdout.on("data", (data: Buffer) => {
            this.captureAiderOutput(data);
            // Look for the prompt that indicates aider is ready
            const output = data.toString();
            //if (output.endsWith(AIDER_READY_FLAG)) {
            if (READY_PROMPT_REGEX.test(output)) {
              // Aider's ready prompt
              console.log("Aider is ready!");
              this.setAiderState("ready");
              clearTimeout(timeout);
              resolve();
            }
          });

          this.aiderProcess.stderr.on("data", (data: Buffer) => {
          // Scanning repo text ends up here, we can maybe include this in the output in the future.
          // ie "Scanning repo:  15%|█▍        | 151/1024 [00:00<00:03, 242.84it/s]""
            console.error(`Aider error: ${data.toString()}`);
          });

          this.aiderProcess.on("close", (code: number | null) => {
            console.log(`Aider process exited with code ${code}`);
            clearTimeout(timeout);
            if (code !== 0) {
              reject(new Error(`Aider process exited with code ${code}`));
            } else {
              this.aiderProcess = null;
              resolve();
            }
          });

          this.aiderProcess.on("error", (error: Error) => {
            console.error(`Error starting Aider: ${error.message}`);

            // Check if this is an authentication error for pearai_model
            if (model === "pearai_model" && error.message.includes("authentication")) {
              this.setAiderState("signedOut");  // Use new signedOut state
            } else {
              this.setAiderState("crashed");
            }

            clearTimeout(timeout);
            reject(error);

            // Customize error message based on authentication state
            let message = model === "pearai_model" && error.message.includes("authentication")
              ? "Please sign in to use PearAI Creator with hosted servers. You can also opt to use your own API-Key."
              : "PearAI Creator (Powered by aider) failed to start. Please contact PearAI support on Discord.";

            vscode.window
              .showErrorMessage(
                message,
                ...(model === "pearai_model" ? ["Sign In"] : []),
                "PearAI Support (Discord)",
                "Show Logs",
              )
              .then((selection: any) => {
                if (selection === "Sign In") {
                  vscode.commands.executeCommand("pearai.login");
                } else if (selection === "PearAI Support (Discord)") {
                  vscode.env.openExternal(
                    vscode.Uri.parse("https://discord.com/invite/7QMraJUsQt"),
                  );
                } else if (selection === "Show Logs") {
                  vscode.commands.executeCommand(
                    "workbench.action.toggleDevTools",
                  );
                }
              });
          });
        }
      };

      await tryStartAider();
    });
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
      console.error("PearAI Creator (Powered by Aider) process is not running");
      this.setAiderState("stopped");
      vscode.window.showErrorMessage(
        "PearAI Creator (Powered by Aider) process is not running. Please view PearAI Creator troubleshooting guide.",
        "View Troubleshooting"
      ).then(selection => {
        if (selection === "View Troubleshooting") {
          vscode.env.openExternal(vscode.Uri.parse("https://trypear.ai/blog/how-to-setup-aider-in-pearai"));
        }
      });
    }
  }

  private _convertArgs(options: CompletionOptions): any {
    return {
      model: options.model,
      frequency_penalty: options.frequencyPenalty,
      presence_penalty: options.presencePenalty,
      max_tokens: options.maxTokens,
      stop: options.stop?.slice(0, 2),
      temperature: options.temperature,
      top_p: options.topP,
    };
  }

  protected async *_streamComplete(
    prompt: string,
    options: CompletionOptions,
  ): AsyncGenerator<string> {
    for await (const chunk of this._streamChat(
      [{ role: "user", content: prompt }],
      options,
    )) {
      yield stripImages(chunk.content);
    }
  }

  countTokens(text: string): number {
    return countTokens(text, this.model);
  }

  protected _convertMessage(message: ChatMessage) {
    if (typeof message.content === "string") {
      return message;
    }
    return {
      ...message,
      content: message.content.map((part) => {
        if (part.type === "text") {
          return part;
        }
        return {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/jpeg",
            data: part.imageUrl?.url.split(",")[1],
          },
        };
      }),
    };
  }

  protected async *_streamChat(
    messages: ChatMessage[],
    options: CompletionOptions,
  ): AsyncGenerator<ChatMessage> {
    console.log("Inside Aider _streamChat");
    const lastMessage = messages[messages.length - 1].content.toString();
    this.sendToAiderChat(lastMessage);

    this.aiderOutput = "";
    let lastProcessedIndex = 0;
    let responseComplete = false;

    const escapeDollarSigns = (text: string | undefined) => {
      if (!text) {return "Aider response over";}
      return text.replace(/([\\$])/g, "\\$1");
    };

    while (!responseComplete) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const newOutput = this.aiderOutput.slice(lastProcessedIndex);

      if (newOutput) {
        if (UDIFF_FLAG) {
          //if (newOutput.endsWith(END_MARKER)) {
          if (READY_PROMPT_REGEX.test(newOutput)) {
              // Remove the END_MARKER from the output before yielding
              const cleanOutput = newOutput.slice(0, -END_MARKER.length);
              if (cleanOutput) {
                  yield {
                      role: "assistant",
                      content: escapeDollarSigns(cleanOutput),
                  };
              }
              responseComplete = true;
              break;
          }

          lastProcessedIndex = this.aiderOutput.length;
          yield {
              role: "assistant",
              content: escapeDollarSigns(newOutput),
          };
        } else {
          lastProcessedIndex = this.aiderOutput.length;
          yield {
            role: "assistant",
            content: escapeDollarSigns(newOutput),
          };

          //if (newOutput.endsWith(END_MARKER)) {
          if (READY_PROMPT_REGEX.test(newOutput)) {
            responseComplete = true;
            break;
          }
        }

        // Safety check
        if (this.aiderProcess?.killed) {
          this.setAiderState("stopped");
          break;
        }
      }
    }


    // Reset the output after capturing a complete response
    this.aiderOutput = "";
  }

  async listModels(): Promise<string[]> {
    return ["aider", "pearai_model", "claude-3-5-sonnet-20240620", "gpt-4o"];
  }

  supportsFim(): boolean {
    return false;
  }
}

export default Aider;
