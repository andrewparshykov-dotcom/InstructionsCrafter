import React, { useEffect, useContext, useState } from "react";
import * as Toolbar from "@radix-ui/react-toolbar";

// Components
import ToolTrigger from "../components/ToolTrigger";
import RadialMenu from "../components/RadialMenu";

// Canvas utils
import {
  undoCanvas,
  redoCanvas,
  saveCanvas,
} from "../../canvas/modules/History";

// Icons
import {
  DrawIcon,
  EraserIcon,
  ArrowIcon,
  UndoIcon,
  RedoIcon,
  TransformIcon,
  HighlighterIcon,
  TrashIcon,
} from "../components/SVG";

// Rewrite imports above with the chrome-extension URL inline

import TooltipWrap from "../components/TooltipWrap";

// Context
import { contentStateContext } from "../../context/ContentState";

const DrawingToolbar = (props) => {
  const [contentState, setContentState] = useContext(contentStateContext);
  const [tool, setTool] = useState("");

  useEffect(() => {
    setTool(contentState.tool);
  }, [contentState.tool]);

  return (
    <Toolbar.Root
      className={"DrawingToolbar" + " " + props.visible}
      aria-label="Drawing tools"
    >
      <Toolbar.ToggleGroup
        type="single"
        className="ToolbarToggleGroup"
        value={tool}
        onValueChange={(value) => {
          if (value)
            setContentState((prevContentState) => ({
              ...prevContentState,
              tool: value,
            }));
        }}
      >
        <ToolTrigger
          type="toggle"
          value="select"
          content={chrome.i18n.getMessage("selectToolTooltip")}
          shortcut="1"
        >
          <TransformIcon />
        </ToolTrigger>
        <ToolTrigger
          type="toggle"
          value="pen"
          content={chrome.i18n.getMessage("penToolTooltip")}
          shortcut="2"
        >
          <DrawIcon />
        </ToolTrigger>
        <ToolTrigger
          type="toggle"
          value="highlighter"
          content={chrome.i18n.getMessage("highlighterToolTooltip")}
          shortcut="3"
        >
          <HighlighterIcon />
        </ToolTrigger>
        <ToolTrigger
          type="toggle"
          value="eraser"
          content={chrome.i18n.getMessage("eraserToolTooltip")}
          shortcut="4"
        >
          <EraserIcon />
        </ToolTrigger>
        <RadialMenu shortcut="5" />
        <ToolTrigger
          type="toggle"
          value="arrow"
          content={chrome.i18n.getMessage("arrowToolTooltip")}
          shortcut="6"
        >
          <ArrowIcon />
        </ToolTrigger>
      </Toolbar.ToggleGroup>
      <Toolbar.Separator className="ToolbarSeparator" />
      <ToolTrigger
        type="button"
        content={chrome.i18n.getMessage("undoTooltip")}
        disabled={contentState.undoStack.length === 0 ? true : false}
        onClick={() => undoCanvas(contentState, setContentState)}
      >
        <UndoIcon />
      </ToolTrigger>
      <ToolTrigger
        type="button"
        content={chrome.i18n.getMessage("redoTooltip")}
        disabled={contentState.redoStack.length === 0 ? true : false}
        onClick={() => redoCanvas(contentState, setContentState)}
      >
        <RedoIcon />
      </ToolTrigger>
      <ToolTrigger
        type="button"
        content={chrome.i18n.getMessage("clearCanvasTooltip")}
        shortcut="0"
        disabled={
          contentState.canvas
            ? contentState.canvas.getObjects().length === 0
              ? true
              : false
            : true
        }
        onClick={() => {
          if (!contentState.canvas) return;

          contentState.canvas.clear();
          contentState.canvas.renderAll();
          contentState.canvas.requestRenderAll();
          saveCanvas(contentState, setContentState);
        }}
      >
        <TrashIcon />
      </ToolTrigger>
    </Toolbar.Root>
  );
};

export default DrawingToolbar;
