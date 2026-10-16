import { useEffect, useRef, useState } from "react";
import { Modal, TitleBar } from "@shopify/app-bridge-react";

// Opens the existing /app/customize page as a true full-viewport popup via
// App Bridge's ui-modal (variant="max"). This loads that page in its own
// iframe inside Shopify admin's modal shell, so it covers the whole app
// window edge-to-edge while still running inside the embedded admin context
// (Polaris web components, auth, etc. all keep working normally). The
// /app/customize route itself is untouched — this only adds a new way to
// present it.
//
// Save/Discard live in this outer TitleBar (next to the modal's own Close
// icon) rather than inside the iframe, so the two controls sit together
// instead of stacking two separate bars. The modal content is an iframe
// App Bridge manages internally (no direct DOM ref to it is exposed here),
// and it's not reliably reachable as window.parent from inside that iframe
// (App Bridge's ui-modal may render the src iframe outside of this
// component's own frame in the DOM tree). BroadcastChannel sidesteps that
// entirely — it's a same-origin pub/sub channel any two windows/iframes
// under the same origin can join, with no need to know each other's window
// reference: the iframe (app.customize.jsx) publishes its dirty/saving
// state, and this shell publishes save/discard commands back.
const CUSTOMIZER_CHANNEL_NAME = "sb-customizer-popup";

export function CustomizerPopupButton({ variant = "primary", slot, onOpen }) {
  return (
    <s-button variant={variant} slot={slot} onClick={onOpen}>
      Customizer
    </s-button>
  );
}

export function useCustomizerPopup() {
  const [open, setOpen] = useState(false);
  return {
    open,
    onOpen: () => setOpen(true),
    onClose: () => setOpen(false),
  };
}

export function CustomizerPopupModal({ open, onClose, context = "collection" }) {
  const src = `/app/customize?popup=1&context=${encodeURIComponent(context)}`;
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const channelRef = useRef(null);

  useEffect(() => {
    if (!open) {
      setDirty(false);
      setSaving(false);
      return;
    }

    const channel = new BroadcastChannel(CUSTOMIZER_CHANNEL_NAME);
    channelRef.current = channel;
    channel.onmessage = (event) => {
      const data = event.data;
      if (!data || data.type !== "state") return;
      setDirty(Boolean(data.dirty));
      setSaving(Boolean(data.saving));
    };

    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [open]);

  const postAction = (action) => {
    channelRef.current?.postMessage({ type: "action", action });
  };

  return (
    <Modal variant="max" src={src} open={open} onHide={onClose}>
      <TitleBar title="Customizer">
        <button disabled={!dirty || saving} onClick={() => postAction("discard")}>
          Discard
        </button>
        <button
          disabled={!dirty}
          variant="primary"
          onClick={() => postAction("save")}
          {...(saving ? { loading: "" } : {})}
        >
          Save
        </button>
      </TitleBar>
    </Modal>
  );
}
