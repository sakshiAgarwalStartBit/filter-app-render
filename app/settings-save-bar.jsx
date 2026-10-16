import { SaveBar } from "@shopify/app-bridge-react";

// Wraps App Bridge's contextual save bar (https://shopify.dev/docs/api/app-bridge-library/react-components/save-bar)
// so every settings page shows/hides it the same way: visible while `dirty`
// is true, Save/Discard wired to the caller's own submit/reset handlers.
export function SettingsSaveBar({ id, dirty, saving, onSave, onDiscard }) {
  return (
    <SaveBar id={id} open={dirty}>
      <button variant="primary" onClick={onSave} {...(saving ? { loading: "" } : {})}>
        Save
      </button>
      <button onClick={onDiscard}></button>
    </SaveBar>
  );
}
