import React, { useEffect, useState, useContext } from "react";

import * as Select from "@radix-ui/react-select";
import {
  DropdownIcon,
  CheckWhiteIcon,
  MicOnIcon,
  MicOffIcon,
} from "../../images/popup/images";

// Context
import { contentStateContext } from "../../context/ContentState";

const Dropdown = (props) => {
  const [contentState, setContentState] = useContext(contentStateContext);
  const [label, setLabel] = useState(chrome.i18n.getMessage("None"));
  const [open, setOpen] = useState(false);

  const updateItems = () => {
    if (
      contentState.defaultAudioInput === "none" ||
      !contentState.micActive
    ) {
      setLabel(chrome.i18n.getMessage("noMicrophoneDropdownLabel"));
    } else {
      const device = contentState.audioInput.find(
        (d) => d.deviceId === contentState.defaultAudioInput
      );
      setLabel(
        device
          ? device.label
          : chrome.i18n.getMessage("noMicrophoneDropdownLabel")
      );
    }
  };

  useEffect(() => {
    updateItems();
  }, [
    contentState.defaultAudioInput,
    contentState.audioInput,
    contentState.micActive,
  ]);

  useEffect(() => {
    updateItems();
  }, []);

  return (
    <Select.Root
      open={open}
      onOpenChange={setOpen}
      value={contentState.defaultAudioInput}
      onValueChange={(newValue) => {
        const selectedLabel =
          contentState.audioInput.find(
            (device) => device.deviceId === newValue
          )?.label || "";
        setContentState((prevContentState) => ({
          ...prevContentState,
          defaultAudioInput: newValue,
          defaultAudioInputLabel: selectedLabel,
          micActive: true,
        }));
        chrome.storage.local.set({
          defaultAudioInput: newValue,
          defaultAudioInputLabel: selectedLabel,
          micActive: true,
        });
        setLabel(selectedLabel);
      }}
    >
      <Select.Trigger className="SelectTrigger" aria-label="Food">
        <Select.Icon className="SelectIconType">
          <div className="SelectIconButton">
            <img
              src={
                contentState.defaultAudioInput === "none" ||
                !contentState.micActive
                  ? MicOffIcon
                  : MicOnIcon
              }
            />
          </div>
        </Select.Icon>
        <div className="SelectValue">
          <Select.Value
            placeholder={chrome.i18n.getMessage(
              "selectSourceDropdownPlaceholder"
            )}
          >
            {label}
          </Select.Value>
        </div>
        {(contentState.defaultAudioInput == "none" ||
          !contentState.micActive) && (
          <div className="SelectOff">
            {chrome.i18n.getMessage("offLabel")}
          </div>
        )}
        <Select.Icon className="SelectIconDrop">
          <img src={DropdownIcon} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal
        container={props.shadowRef.current.shadowRoot.querySelector(
          ".container"
        )}
      >
        <Select.Content position="popper" className="SelectContent">
          <Select.ScrollUpButton className="SelectScrollButton"></Select.ScrollUpButton>
          <Select.Viewport className="SelectViewport">
            <Select.Group>
              {contentState.audioInput.map((device) => (
                <SelectItem value={device.deviceId} key={device.deviceId}>
                  {device.label}
                </SelectItem>
              ))}
            </Select.Group>
          </Select.Viewport>
          <Select.ScrollDownButton className="SelectScrollButton"></Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
};

const SelectItem = React.forwardRef(
  ({ children, className, ...props }, forwardedRef) => {
    return (
      <Select.Item className="SelectItem" {...props} ref={forwardedRef}>
        <Select.ItemText>{children}</Select.ItemText>
        <Select.ItemIndicator className="SelectItemIndicator">
          <img src={CheckWhiteIcon} />
        </Select.ItemIndicator>
      </Select.Item>
    );
  }
);

export default Dropdown;
