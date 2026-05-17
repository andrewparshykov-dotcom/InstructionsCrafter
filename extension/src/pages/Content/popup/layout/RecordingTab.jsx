import React from "react";

import RecordingType from "./RecordingType";

const RecordingTab = (props) => {
  return (
    <div className="recording-ui">
      <RecordingType shadowRef={props.shadowRef} />
    </div>
  );
};

export default RecordingTab;
