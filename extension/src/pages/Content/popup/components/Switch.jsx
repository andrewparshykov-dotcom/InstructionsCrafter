import React, { useContext, useRef } from "react";
import * as S from "@radix-ui/react-switch";

// Context
import { contentStateContext } from "../../context/ContentState";

export const BaseSwitch = ({ value, checked, onChange }) => (
  <S.Root
    className="SwitchRoot"
    id={value}
    checked={checked}
    onCheckedChange={onChange}
  >
    <S.Thumb className="SwitchThumb" />
  </S.Root>
);

const Switch = (props) => {
  const [contentState, setContentState] = useContext(contentStateContext);
  const switchRef = useRef(null);
  const switchId = props.anchorId || props.value || props.name;
  const switchRowId =
    props.rowAnchorId ||
    (props.anchorId ? `${props.anchorId}-row` : undefined);

  return (
    <form>
      <div className="SwitchRow" id={switchRowId}>
        <label className="Label" htmlFor={switchId} style={{ paddingRight: 15 }}>
          {props.label}
          {props.experimental && (
            <span className="ExperimentalLabel">Experimental</span>
          )}
        </label>
        {props.value ? (
          <S.Root
            className="SwitchRoot"
            id={switchId}
            ref={switchRef}
            checked={contentState[props.value]}
            disabled={props.disabled}
            onCheckedChange={(checked) => {
              if (props.disabled) return;

              setContentState((prevContentState) => ({
                ...prevContentState,
                [props.value]: checked,
              }));
              chrome.storage.local.set({ [props.value]: checked });

              if (props.value === "customRegion") {
                if (checked) {
                  chrome.storage.local.set({
                    region: true,
                  });
                }
              }

              if (props.name === "hideUI") {
                setContentState((prevContentState) => ({
                  ...prevContentState,
                  hideToolbar: checked,
                }));
                chrome.storage.local.set({ hideToolbar: checked });
              }

              if (typeof props.onChange === "function") {
                props.onChange(checked);
              }
            }}
          >
            <S.Thumb className="SwitchThumb" />
          </S.Root>
        ) : (
          <S.Root className="SwitchRoot" id={switchId}>
            <S.Thumb className="SwitchThumb" />
          </S.Root>
        )}
      </div>
    </form>
  );
};

export default Switch;
