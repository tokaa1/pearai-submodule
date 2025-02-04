import {
  BackspaceIcon,
  ChatBubbleOvalLeftIcon,
  ChevronUpIcon,
} from "@heroicons/react/24/outline";
import { JSONContent } from "@tiptap/react";
import { IndexingProgressUpdate, InputModifiers } from "core";
import { PostHog, usePostHog } from "posthog-js/react";
import {
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { ErrorBoundary } from "react-error-boundary";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import {
  Button,
  lightGray,
  vscBackground,
  vscBadgeForeground,
  vscForeground,
} from "../components";
import { ChatScrollAnchor } from "../components/ChatScrollAnchor";
import StepContainer from "../components/gui/StepContainer";
import TimelineItem from "../components/gui/TimelineItem";
import ContinueInputBox from "../components/mainInput/ContinueInputBox";
import { defaultInputModifiers } from "../components/mainInput/inputModifiers";
import { TutorialCard } from "../components/mainInput/TutorialCard";
import { IdeMessengerContext } from "../context/IdeMessenger";
import useChatHandler from "../hooks/useChatHandler";
import useHistory from "../hooks/useHistory";
import { useWebviewListener } from "../hooks/useWebviewListener";
import { defaultModelSelector } from "../redux/selectors/modelSelectors";
import {
  clearLastResponse,
  deleteMessage,
  newSession,
  setInactive,
  setShowInteractiveContinueTutorial,
} from "../redux/slices/stateSlice";
import { RootState } from "../redux/store";
import {
  getFontSize,
  getMetaKeyLabel,
  isJetBrains,
  isMetaEquivalentKeyPressed,
} from "../util";
import { FREE_TRIAL_LIMIT_REQUESTS } from "../util/freeTrial";
import { getLocalStorage, setLocalStorage } from "@/util/localStorage";
import OnboardingTutorial from "./onboarding/OnboardingTutorial";
import { setActiveFilePath } from "@/redux/slices/uiStateSlice";
import { FOOTER_HEIGHT } from "@/components/Layout";
import StatusBar from "@/components/StatusBar";

export const TopGuiDiv = styled.div`
  overflow-y: scroll;
  postion: relative;
  margin-top: -40px;
  padding-top: 48px;
	// padding-bottom: 200px;
  height: 100%;
  scrollbar-width: none;
	scroll-behavior: smooth;
  &::-webkit-scrollbar {
    display: none;
  }
`;

export const StopButtonContainer = styled.div`
  position: fixed;
  bottom: calc(${FOOTER_HEIGHT});
  left: 50%;
  transform: translateX(-50%);
  z-index: 50;
`;

export const StopButton = styled.div`
  border-radius: 4px;
  padding: 4px;
	display: flex;
	align-items: center;
	gap: 6px;
  background-color: rgb(147, 51, 51);
  z-index: 50;
  color: ${vscBadgeForeground};
  cursor: pointer;
`;

export const NewSessionButton = styled.div`
  width: fit-content;
  font-size: ${getFontSize() - 3}px;
	background-color: ${vscBackground}ee;
	padding: 0px 4px;
  color: ${lightGray};

  &:hover {
    color: ${vscForeground};
  }

  cursor: pointer;
`;

const TutorialCardDiv = styled.header`
  position: sticky;
  top: 0px;
  z-index: 500;
  background-color: ${vscBackground}ee; // Added 'ee' for slight transparency
  display: flex;
  width: 100%;
`

const FixedBottomContainer = styled.div<{ isNewSession: boolean }>`
  background-color: ${vscBackground};
  margin-left: 1rem;
  margin-right: 1rem;
  ${props =>
    props.isNewSession
      ? `
        position: fixed;
        top: 48px;
        left: 0;
        right: 0;
      `
      : `
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
      `}
  padding: 0rem 0rem 0.5rem 0rem;

  & > * + * {
    margin-top: 0.5rem;
  }
`;


export function fallbackRender({ error, resetErrorBoundary }) {
  return (
    <div
      role="alert"
      className="px-2"
      style={{ backgroundColor: vscBackground }}
    >
      <p>Something went wrong:</p>
      <pre style={{ color: "red" }}>{error.message}</pre>

      <div className="text-center">
        <Button onClick={resetErrorBoundary}>Restart</Button>
      </div>
    </div>
  );
}

function GUI() {
  const posthog = usePostHog();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const ideMessenger = useContext(IdeMessengerContext);

  const sessionState = useSelector((state: RootState) => state.state);
  const defaultModel = useSelector(defaultModelSelector);
  const active = useSelector((state: RootState) => state.state.active);
  const [stepsOpen, setStepsOpen] = useState<(boolean | undefined)[]>([]);
  // If getting this from redux state, it is false. So need to get from localStorage directly.
  // This is likely because it becomes true only after user onboards, upon which the local storage is updated.
  // On first launch, showTutorialCard will be null, so we want to show it (true)
  // Once it's been shown and closed, it will be false in localStorage
  const showTutorialCard = getLocalStorage("showTutorialCard") ?? (setLocalStorage("showTutorialCard", true), true);
  useEffect(() => {
    // Set the redux state to the updated localStorage value (true)
    dispatch(setShowInteractiveContinueTutorial(showTutorialCard ?? false));
  }, [])
  const onCloseTutorialCard = useCallback(() => {
    posthog.capture("closedTutorialCard");
    setLocalStorage("showTutorialCard", false);
    dispatch(setShowInteractiveContinueTutorial(false));
  }, []);

  const mainTextInputRef = useRef<HTMLInputElement>(null);
  const topGuiDivRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState<boolean>(false);
  const state = useSelector((state: RootState) => state.state);

  const handleScroll = () => {
    const OFFSET_HERUISTIC = 300;
    if (!topGuiDivRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = topGuiDivRef.current;
    const atBottom =
      scrollHeight - clientHeight <= scrollTop + OFFSET_HERUISTIC;

    setIsAtBottom(atBottom);
  };

  const snapToBottom = useCallback(() => {
    window.scrollTo({
      top: topGuiDivRef.current?.scrollHeight,
      behavior: "instant" as any,
    });
    setIsAtBottom(true);
  }, []);

  useEffect(() => {
    if (active) {
      snapToBottom();
    }
  }, [active])

  useEffect(() => {
    if (active && !isAtBottom) {
      if (!topGuiDivRef.current) return;
      const scrollAreaElement = topGuiDivRef.current;
      scrollAreaElement.scrollTop =
        scrollAreaElement.scrollHeight - scrollAreaElement.clientHeight;
      setIsAtBottom(true);
    }
  }, [active, isAtBottom]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      snapToBottom();
    }, 1);

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener("scroll", handleScroll);
    };
  }, [topGuiDivRef.current]);

  useEffect(() => {
    const listener = (e: any) => {
      if (
        e.key === "Backspace" &&
        isMetaEquivalentKeyPressed(e) &&
        !e.shiftKey
      ) {
        dispatch(setInactive());
      }
    };
    window.addEventListener("keydown", listener);

    return () => {
      window.removeEventListener("keydown", listener);
    };
  }, [active]);

  const { streamResponse } = useChatHandler(dispatch, ideMessenger);

  const sendInput = useCallback(
    (editorState: JSONContent, modifiers: InputModifiers) => {
      if (defaultModel?.provider === "free-trial") {
        const u = getLocalStorage("ftc");
        if (u) {
          setLocalStorage("ftc", u + 1);

          if (u >= FREE_TRIAL_LIMIT_REQUESTS) {
            navigate("/onboarding");
            posthog?.capture("ftc_reached");
            return;
          }
        } else {
          setLocalStorage("ftc", 1);
        }
      }

      streamResponse(editorState, modifiers, ideMessenger, undefined, 'continue');

      const currentCount = getLocalStorage("mainTextEntryCounter");
      if (currentCount) {
        setLocalStorage("mainTextEntryCounter", currentCount + 1);
      } else {
        setLocalStorage("mainTextEntryCounter", 1);
      }
    },
    [
      sessionState.history,
      sessionState.contextItems,
      defaultModel,
      state,
      streamResponse,
    ],
  );

  const { saveSession, getLastSessionId, loadLastSession, loadMostRecentChat } =
    useHistory(dispatch, 'continue');

  useWebviewListener(
    "newSession",
    async () => {
      saveSession();
      mainTextInputRef.current?.focus?.();
    },
    [saveSession],
  );

  useWebviewListener(
    "setActiveFilePath",
    async (data) => {
      dispatch(setActiveFilePath(data));
    },
    []
  );

  useWebviewListener(
    "loadMostRecentChat",
    async () => {
      await loadMostRecentChat();
      mainTextInputRef.current?.focus?.();
    },
    [loadMostRecentChat],
  );

  useWebviewListener("restFirstLaunchInGUI", async () => {
    setLocalStorage("showTutorialCard", true);
    localStorage.removeItem("onboardingSelectedTools");
    localStorage.removeItem("importUserSettingsFromVSCode");
    dispatch(setShowInteractiveContinueTutorial(true));
  });

  useWebviewListener(
    "showInteractiveContinueTutorial",
    async () => {
      setLocalStorage("showTutorialCard", true);
      dispatch(setShowInteractiveContinueTutorial(true));
    },
    [],
  );

  const isLastUserInput = useCallback(
    (index: number): boolean => {
      let foundLaterUserInput = false;
      for (let i = index + 1; i < state.history.length; i++) {
        if (state.history[i].message.role === "user") {
          foundLaterUserInput = true;
          break;
        }
      }
      return !foundLaterUserInput;
    },
    [state.history],
  );

  const isNewSession = state.history.length === 0;

  return (
    <>
      {!window.isPearOverlay && !!showTutorialCard &&
        <TutorialCardDiv>
          <OnboardingTutorial onClose={onCloseTutorialCard} />
        </TutorialCardDiv>
      }
      <TopGuiDiv ref={topGuiDivRef} onScroll={handleScroll}>
        {state.history.map((item, index: number) => {
          return (
            <Fragment key={index}>
              <ErrorBoundary
                FallbackComponent={fallbackRender}
                onReset={() => {
                  dispatch(newSession({ session: undefined, source: 'continue' }));
                }}
              >
                {/* <div className="bg-green-700" style={{
                      minHeight: index === state.history.length - 1 ? "50vh" : 0,
                    }}> */}
                {item.message.role === "user" ? (
                  <div className="max-w-3xl mx-auto">
                    <div className=" max-w-96 ml-auto px-2">

                      <ContinueInputBox
                        onEnter={async (editorState, modifiers) => {
                          streamResponse(
                            editorState,
                            modifiers,
                            ideMessenger,
                            index,
                          );
                        }}
                        isLastUserInput={isLastUserInput(index)}
                        isMainInput={false}
                        editorState={item.editorState}
                        contextItems={item.contextItems}
                      />
                    </div>
                  </div>
                ) : (
                  // <div className="p-4 bg-orange-500 my-4">
                  <TimelineItem
                    item={item}
                    iconElement={
                      <ChatBubbleOvalLeftIcon
                        width="16px"
                        height="16px"
                      />
                    }
                    open={
                      typeof stepsOpen[index] === "undefined"
                        ? true
                        : stepsOpen[index]!
                    }
                    onToggle={() => { }}
                  >
                    <StepContainer
                      index={index}
                      isLast={index === sessionState.history.length - 1}
                      isFirst={index === 0}
                      open={
                        typeof stepsOpen[index] === "undefined"
                          ? true
                          : stepsOpen[index]!
                      }
                      key={index}
                      onUserInput={(input: string) => { }}
                      item={item}
                      onReverse={() => { }}
                      onRetry={() => {
                        streamResponse(
                          state.history[index - 1].editorState,
                          state.history[index - 1].modifiers ??
                          defaultInputModifiers,
                          ideMessenger,
                          index - 1,
                        );
                      }}
                      onContinueGeneration={() => {
                        window.postMessage(
                          {
                            messageType: "userInput",
                            data: {
                              input: "Keep going.",
                            },
                          },
                          "*",
                        );
                      }}
                      onDelete={() => {
                        dispatch(
                          deleteMessage({
                            index: index,
                            source: "continue",
                          }),
                        );
                      }}
                      modelTitle={
                        item.promptLogs?.[0]?.completionOptions?.model ??
                        ""
                      }
                    />
                  </TimelineItem>

                  // </div>
                )}
                {/* </div> */}
              </ErrorBoundary>
            </Fragment>
          );
        })}
      </TopGuiDiv>

      {!active && (
        <FixedBottomContainer isNewSession={isNewSession} className={`${isNewSession ? "mt-0" : "mt-auto"}`}>
          <div className="max-w-3xl mx-auto">

            <ContinueInputBox
              onEnter={(editorContent, modifiers) => {
                sendInput(editorContent, modifiers);
              }}
              isLastUserInput={false}
              isMainInput={true}
              hidden={active}
            />
            <StatusBar />
          </div>
        </FixedBottomContainer>
      )}
      {/* </div> */}

      {active && (
        <StopButtonContainer>
          <StopButton
            onClick={() => {
              dispatch(setInactive());
              if (
                state.history[state.history.length - 1]?.message.content
                  .length === 0
              ) {
                dispatch(clearLastResponse("continue"));
              }
            }}
          >
            <div className="flex items-center">
              <ChevronUpIcon className="w-3 h-3 stroke-2" />
              <BackspaceIcon className="w-4 h-4 stroke-2" />
            </div>
            <span className="text-xs font-medium">Cancel</span>
          </StopButton>
        </StopButtonContainer>
      )}
    </>
  );
}

export default GUI;
