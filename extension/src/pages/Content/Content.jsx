import React, { useState, useContext, useEffect, useRef } from "react";

import Wrapper from "./Wrapper";

import ContentState from "./context/ContentState";

const Content = () => {
  return (
    <div className="instructionscrafter-shadow-dom">
      <ContentState>
        <Wrapper />
      </ContentState>
      <style type="text/css">{`
			#instructionscrafter-ui, #instructionscrafter-ui div {
				background-color: unset;
				padding: unset;
				width: unset;
				box-shadow: unset;
				display: unset;
				margin: unset;
				border-radius: unset;
			}
			.instructionscrafter-outline {
				position: absolute;
				z-index: 99999999999;
				border: 2px solid #3080F8;
				outline-offset: -2px;
				pointer-events: none;
				border-radius: 5px!important;
			}
		.instructionscrafter-blur {
			filter: blur(10px)!important;
		}
			.instructionscrafter-shadow-dom * {
				transition: unset;
			}
			.instructionscrafter-shadow-dom .TooltipContent {
  border-radius: 6px!important;
	background-color: #15171C!important;
	border: 1px solid rgba(255, 255, 255, 0.06)!important;
  padding: 6px 10px!important;
  font-size: 12px;
	margin-bottom: 10px!important;
	bottom: 100px;
  line-height: 1;
	font-family: "Geist", -apple-system, BlinkMacSystemFont, sans-serif;
	font-weight: 500;
	letter-spacing: 0.01em;
	z-index: 99999999!important;
  color: #FFF;
  box-shadow: 0 4px 12px rgba(15, 17, 28, 0.18)!important;
  user-select: none;
	transition: opacity 0.3 ease-in-out;
  will-change: transform, opacity;
	animation-duration: 400ms;
  animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
  will-change: transform, opacity;
}

.instructionscrafter-shadow-dom .hide-tooltip {
	display: none!important;
}

.instructionscrafter-shadow-dom .tooltip-tall {
	margin-bottom: 20px;
}

.instructionscrafter-shadow-dom .tooltip-small {
	margin-bottom: 5px;
}

.instructionscrafter-shadow-dom .TooltipContent[data-state='delayed-open'][data-side='top'] {
	animation-name: instructionscrafter-slideDownAndFade;
}
.instructionscrafter-shadow-dom .TooltipContent[data-state='delayed-open'][data-side='right'] {
  animation-name: instructionscrafter-slideLeftAndFade;
}
.instructionscrafter-shadow-dom.TooltipContent[data-state='delayed-open'][data-side='bottom'] {
  animation-name: instructionscrafter-slideUpAndFade;
}
.instructionscrafter-shadow-dom.TooltipContent[data-state='delayed-open'][data-side='left'] {
  animation-name: instructionscrafter-slideRightAndFade;
}

@keyframes instructionscrafter-slideUpAndFade {
  from { opacity: 0; transform: translateY(2px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes instructionscrafter-slideRightAndFade {
  from { opacity: 0; transform: translateX(-2px); }
  to   { opacity: 1; transform: translateX(0); }
}
@keyframes instructionscrafter-slideDownAndFade {
  from { opacity: 0; transform: translateY(-2px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes instructionscrafter-slideLeftAndFade {
  from { opacity: 0; transform: translateX(2px); }
  to   { opacity: 1; transform: translateX(0); }
}

#instructionscrafter-ui [data-radix-popper-content-wrapper] { z-index: 999999999999!important; }

.instructionscrafter-shadow-dom .CanvasContainer {
	position: fixed;
	pointer-events: all!important;
	top: 0px!important;
	left: 0px!important;
	z-index: 99999999999!important;
}
.instructionscrafter-shadow-dom .canvas {
	position: fixed;
	top: 0px!important;
	left: 0px!important;
	z-index: 99999999999!important;
	background: transparent!important;
}
.instructionscrafter-shadow-dom .canvas-container {
	top: 0px!important;
	left: 0px!important;
	z-index: 99999999999;
	position: fixed!important;
	background: transparent!important;
}

`}</style>
    </div>
  );
};

export default Content;
