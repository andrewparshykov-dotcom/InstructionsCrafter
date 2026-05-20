// RecorderUI.jsx
import React from "react";
import Warning from "./warning/Warning";

const isTabFromUrl = new URLSearchParams(window.location.search).has("tab");

const RecorderUI = ({ started, isTab }) => {
  return (
    <div className="wrap">
      <div className="middle-area">
        <div className="eyebrow">
          INSTRUCTIONSCRAFTER
          <span className="eyebrow-dot">·</span>
          PREPARING
        </div>
        <img
          src={chrome.runtime.getURL("assets/record-tab-active.svg")}
          alt="Recording icon"
        />
        <div className="title">
          {started
            ? chrome.i18n.getMessage("recorderSelectProgressTitle")
            : (isTab || isTabFromUrl)
              ? chrome.i18n.getMessage("preparingLabel")
              : chrome.i18n.getMessage("recorderSelectTitle")}
        </div>
        <div className="subtitle">
          {chrome.i18n.getMessage("recorderSelectDescription")}
        </div>
      </div>

      {!isTab && !started && <Warning />}

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
          .middle-area {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: flex-start;
            padding-top: 24px;
            height: 100%;
            box-sizing: border-box;
            font-family: "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            position: relative;
            z-index: 1;
          }
          .eyebrow {
            font-family: "Geist Mono", "JetBrains Mono", ui-monospace, monospace;
            font-size: 11px;
            font-weight: 500;
            letter-spacing: 0.14em;
            text-transform: uppercase;
            color: #6E7684;
            margin-bottom: 14px;
          }
          .eyebrow-dot {
            color: #C9CDD6;
            margin: 0 6px;
          }
          .middle-area img {
            width: 24px;
            margin-bottom: 10px;
          }
          .title {
            font-size: 18px;
            font-weight: 700;
            color: #15171C;
            margin-bottom: 6px;
            font-family: "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            text-align: center;
          }
          .subtitle {
            font-size: 13px;
            font-weight: 500;
            color: #6E7684;
            margin-bottom: 0;
            font-family: "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            text-align: center;
            max-width: 480px;
            line-height: 1.5;
          }
        `}
      </style>
    </div>
  );
};

export default RecorderUI;
