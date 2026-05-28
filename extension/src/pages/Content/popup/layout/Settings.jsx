import React from "react";

// Components
import Switch from "../components/Switch";

const Settings = () => {
  return (
    <Switch
      label={chrome.i18n.getMessage("hideToolbarLabel")}
      name="hideUI"
      value="hideUI"
    />
  );
};

export default Settings;
