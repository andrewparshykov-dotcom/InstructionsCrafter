import { onInstalledListener } from "./onInstalledListener";
import { onUpdateAvailableListener } from "./onUpdateAvailableListener";
import { onTabRemovedListener } from "./onTabRemovedListener";
import { onTabActivatedListener } from "./onTabActivatedListener";
import { onTabUpdatedListener } from "./onTabUpdatedListener";
import { onWindowFocusChangedListener } from "./onWindowFocusChangedListener";
import { onActionButtonClickedListener } from "./onActionButtonClickedListener";
import { onStartupListener } from "./onStartupListener";
import { onCommandListener } from "./onCommandListener";

export const initializeListeners = () => {
  onInstalledListener();
  onUpdateAvailableListener();
  onTabRemovedListener();
  onTabActivatedListener();
  onTabUpdatedListener();
  onWindowFocusChangedListener();
  onActionButtonClickedListener();
  onStartupListener();
  onCommandListener();
};
