import React from "react";

// Components
import Switch from "../components/Switch";

const Settings = () => {
  return (
    <Switch
      label={chrome.i18n.getMessage("hideToolbarLabel")}
      name="hideUI"
      value="hideUI"
      anchorId="pro-onboarding-toolbar-toggle"
    />
  );
};

export default Settings;
