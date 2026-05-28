// I need to make this work for a Chrome extension, so I can't import images, instead it needs to be a string with the path to the image
const URL =
  "chrome-extension://" + chrome.i18n.getMessage("@@extension_id") + "/assets";

const DropdownIcon = `${URL}/dropdown.svg`;
const MicOnIcon = `${URL}/mic-on.svg`;
const MicOffIcon = `${URL}/mic-off.svg`;
const CheckWhiteIcon = `${URL}/check-white.svg`;
const Waveform = `${URL}/waveform.svg`;
const TempLogo = `${URL}/new-logo.svg`;
const CopyLinkIcon = `${URL}/copy-link.svg`;
const MoreActionsIcon = `${URL}/more-actions.svg`;
const ProfilePic = `${URL}/pfp.png`;
const HandleControl = `${URL}/canvas/handle.png`;
const RotateControl = `${URL}/canvas/rotate.png`;
const MiddleHandleControl = `${URL}/canvas/middle-handle.png`;
const MiddleHandleControlV = `${URL}/canvas/middle-handle-v.png`;
const MicOffBlue = `${URL}/mic-off-blue.svg`;

export {
  DropdownIcon,
  MicOnIcon,
  MicOffIcon,
  CheckWhiteIcon,
  Waveform,
  TempLogo,
  CopyLinkIcon,
  MoreActionsIcon,
  ProfilePic,
  HandleControl,
  RotateControl,
  MiddleHandleControl,
  MiddleHandleControlV,
  MicOffBlue,
};
