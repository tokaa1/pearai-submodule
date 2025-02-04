import { RootState } from "@/redux/store";
import { useDispatch, useSelector } from "react-redux";
import { IdeMessengerContext } from "@/context/IdeMessenger";
import { useCallback, useContext } from "react";
import { X } from "lucide-react";
import { setActiveFilePath } from "@/redux/slices/uiStateSlice";

export default function ActiveFileIndicator() {
  const activeFilePath = useSelector((state: RootState) => state.uiState.activeFilePath);
  const fileName = activeFilePath?.split(/[/\\]/)?.pop() ?? activeFilePath;
  const ideMessenger = useContext(IdeMessengerContext);
  const dispatch = useDispatch();
  
  const removeActiveFile = useCallback(() => {
    dispatch(setActiveFilePath(undefined));
  }, [])
    
  if (!activeFilePath) return null;

  return (
    <div className="flex gap-1 mb-2 text-xs items-center">
      <span>Current file: </span>
        <span className="mention cursor-pointer flex items-center gap-[0.15rem]">
          <span
          onClick={() => {
            ideMessenger.post("openFile", { path: activeFilePath });
          }}>
            {`@${fileName}`}
          </span>
          <X className="text-xs pt-[0.15rem] pr-[0.1rem]" size={9} onClick={removeActiveFile}/>
        </span>
    </div>
  );
};
