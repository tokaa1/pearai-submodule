import { CheckIcon, ClipboardIcon } from "@heroicons/react/24/outline";
import { useContext, useState } from "react";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { isJetBrains } from "../../util";
import HeaderButtonWithText from "../HeaderButtonWithText";

interface CopyButtonProps {
  text: string | (() => string);
  color?: string;
  inline?: boolean;
}

export function CopyButton(props: CopyButtonProps) {
  const [copied, setCopied] = useState<boolean>(false);

  const ideMessenger = useContext(IdeMessengerContext);

  return (
      <HeaderButtonWithText
        text={copied ? "Copied!" : "Copy"}
        onClick={(e) => {
          const text =
            typeof props.text === "string" ? props.text : props.text();
          if (isJetBrains()) {
            ideMessenger.request("copyText", { text });
          } else {
            navigator.clipboard.writeText(text);
          }

          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
        className={props.inline ? "inline-flex" : ""}
      >
        {copied ? (
          <CheckIcon className="w-[14px] h-[14px] stroke-2 stroke-green-500" />
        ) : (
          <ClipboardIcon className="w-[14px] h-[14px] stroke-2" color={props.color} />
        )}
      </HeaderButtonWithText>
  );
}
