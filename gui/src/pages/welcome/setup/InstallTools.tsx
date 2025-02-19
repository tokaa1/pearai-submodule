"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useContext, useState, useEffect } from "react";
import { IdeMessengerContext } from "@/context/IdeMessenger";
import { getLogoPath } from "./ImportExtensions";

interface Tool {
    id: string;
    name: string;
    description: string;
    icon: JSX.Element | string;
    preInstalled: boolean;
}


export default function InstallTools({
    onNext,
}: {
    onNext: () => void;
}) {

    const tools: Tool[] = [
        // {
        //     id: "aider",
        //     name: "PearAI Creator",
        //     description: "PearAI Creator is a no-code tool powered by aider* that let's you build complete features with just a prompt.",
        //     icon: "inventory-creator.svg",
        //     preInstalled: false
        // },
        {
            id: "supermaven",
            name: "PearAI Predict",
            description: "PearAI Predict is our upcoming code autocomplete tool. While it’s under development, we recommend using Supermaven* as a standalone extension within PearAI for code autocompletion. Selecting this option will install Supermaven.",
            icon: "inventory-autocomplete.svg",
            preInstalled: false
        }
    ];

    const [attemptedInstalls, setAttemptedInstalls] = useState<string[]>(() => {
        const saved = localStorage.getItem('onboardingSelectedTools');
        return saved ? JSON.parse(saved) : [];
    });

    const [checkedTools, setCheckedTools] = useState<Record<string, boolean>>(() => {
        const initialState: Record<string, boolean> = {};
        tools.forEach(tool => {
            initialState[tool.id] = true;
        });
        return initialState;
    });

    const handleCheckboxChange = (toolId: string) => {
        setCheckedTools(prev => ({ ...prev, [toolId]: !prev[toolId] }));
    };

    const handleInstallChecked = async () => {
        const selectedTools = tools.filter(tool =>
            checkedTools[tool.id]
        );

        localStorage.setItem('onboardingSelectedTools', JSON.stringify(selectedTools.map(t => t.id)));
        onNext()
    };

    const handleSkip = () => {
        localStorage.setItem('onboardingSelectedTools', JSON.stringify([]));
        onNext()
      }

    const areAllToolsSelected = () => {
        return tools.every(tool => checkedTools[tool.id]);
    };

    const areAnyToolsSelected = () => {
        return tools.some(tool => checkedTools[tool.id]);
    };

    const areAllToolsAttempted = () => {
        return tools.every(tool => attemptedInstalls.includes(tool.id));
    };

    const getButtonText = () => {
        if (areAllToolsAttempted() || !areAnyToolsSelected()) {
            return "Next"
        }
        if (areAllToolsSelected() && attemptedInstalls?.length > 0) {
            return "Install Selected Tool";
        }
        if (attemptedInstalls?.length > 0) {
            return "Next";
        }
        return areAllToolsSelected() ? "Install All Tools" : "Install Selected Tools";
    };
    
    return (
        <div className="flex flex-col min-h-screen bg-primary text-foreground">
          <div className="flex-1 flex items-center justify-center">
            <div className="w-full max-w-[800px] flex flex-col">
              <div className="text-xl md:text-2xl lg:text-2xl text-foreground mb-8 text-center max-w-[600px] mx-auto">
                PearAI requires some extra installation for the following integrations
              </div>
    
              <div className="flex-1 overflow-y-auto mx-6">
                <div className="w-full space-y-2">
                  {tools.map((tool) => (
                    <Card
                      key={tool.id}
                      className={`p-4 flex items-center border-solid border-2 justify-between ${
                        tool.preInstalled || attemptedInstalls.includes(tool.id) ? 'opacity-60' : ''
                      }`}
                    >
                      <div className="flex items-center gap-4 flex-1">
                        <div className="bg-muted rounded-lg">
                          {typeof tool.icon === 'string' ? (
                            <img src={getLogoPath(tool.icon)} alt={tool.name} className="h-[50px]" />
                          ) : (
                            tool.icon
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <div className="font-semibold text-lg">{tool.name}</div>
                            {(tool.preInstalled || attemptedInstalls.includes(tool.id)) && (
                              <span className="text-xs ml-2 bg-foreground text-white px-2 py-1 rounded-md">
                                {tool.preInstalled ? 'Pre-installed' : 'Setup initiated'}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">{tool.description}</p>
                        </div>
                      </div>
                      <div className="flex items-center h-5 ml-4">
                        <input
                          type="checkbox"
                          checked={checkedTools[tool.id] || false}
                          onChange={() => handleCheckboxChange(tool.id)}
                          disabled={tool.preInstalled || attemptedInstalls.includes(tool.id)}
                          className="h-5 w-5 rounded-sm cursor-pointer focus:outline-none"
                          style={{
                            accentColor: 'var(--button-background)',
                          }}
                        />
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            </div>
          </div>
    
          <div className="absolute bottom-0 right-0 p-4 bg-primary">
            <div className="flex flex-col items-end">
              <div className="flex items-center justify-end gap-4 mb-2">
                <div onClick={handleSkip} className="flex items-center gap-2 cursor-pointer">
                  Skip
                </div>
                <Button
                  className="w-[250px] text-button-foreground bg-button hover:bg-button-hover p-4 lg:py-6 lg:px-2 text-sm md:text-base cursor-pointer"
                  onClick={handleInstallChecked}
                >
                  {getButtonText()}
                </Button>
              </div>
              {/* <div className="text-[8px] text-muted-foreground">
                *View PearAI Disclaimer page
                <a
                  href="https://trypear.ai/disclaimer/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:cursor-pointer hover:text-primary hover:underline ml-1"
                >
                  here
                </a>
                .
              </div> */}
            </div>
          </div>
        </div>
      )
    }