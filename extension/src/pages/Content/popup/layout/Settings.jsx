import React, { useState, useContext, useEffect } from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { DropdownIcon } from "../../images/popup/images";

// Components
import Switch from "../components/Switch";

// Context
import { contentStateContext } from "../../context/ContentState";

const Settings = () => {
  const [open, setOpen] = useState(false);
  const [contentState, setContentState] = useContext(contentStateContext);
  const [chromeVersion, setChromeVersion] = useState(null);

  // Get Chrome version
  const getChromeVersion = () => {
    var raw = navigator.userAgent.match(/Chrom(e|ium)\/([0-9]+)\./);
    return raw ? parseInt(raw[2], 10) : false;
  };

  useEffect(() => {
    setChromeVersion(getChromeVersion());
  }, []);

  useEffect(() => {
    setContentState((prevContentState) => ({
      ...prevContentState,
      settingsOpen: open,
    }));
  }, [open]);

  return (
    <Collapsible.Root
      className="CollapsibleRoot"
      open={open}
      onOpenChange={setOpen}
    >
      <Collapsible.Trigger className="CollapsibleTrigger">
        <div className="CollapsibleLabel">
          ✨ {chrome.i18n.getMessage("showMoreOptionsLabel")}{" "}
          <img src={DropdownIcon} />
        </div>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <Switch
          label={chrome.i18n.getMessage("hideToolbarLabel")}
          name="hideUI"
          value="hideUI"
          anchorId="pro-onboarding-toolbar-toggle"
        />
      </Collapsible.Content>
    </Collapsible.Root>
  );
};

export default Settings;
