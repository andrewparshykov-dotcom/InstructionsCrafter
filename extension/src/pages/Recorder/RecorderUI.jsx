// RecorderUI.jsx
import React from "react";

const RecorderUI = () => {
  return (
    <div className="wrap">
      <div className="setupBackgroundSVG"></div>

      <style>
        {`
          body {
            overflow: hidden;
          }
          .setupBackgroundSVG {
            position: absolute;
            top: 0px;
            left: 0px;
            width: 100%;
            height:100%;
            background: url('${chrome.runtime.getURL(
              "assets/helper/pattern-svg.svg"
            )}') repeat;
            background-size: 62px 23.5px;
            animation: moveBackground 138s linear infinite;
            transform: rotate(0deg);
          }
          @keyframes moveBackground {
            0% {
              background-position: 0 0;
            }
            100% {
              background-position: 100% 0;
            }
          }
          .wrap {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: #F6F7FB;
          }
        `}
      </style>
    </div>
  );
};

export default RecorderUI;
