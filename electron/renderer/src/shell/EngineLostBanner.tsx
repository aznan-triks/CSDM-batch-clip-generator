import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";

import ActionButton from "../components/ActionButton";
import { onMessage } from "../bridge";
import type { BridgeMessage } from "../bridge";
import "./EngineLostBanner.css";

interface Props {
  onRegain: () => void;
}

/**
 * Tell the user the engine has died and offer one restart.
 *
 * Rendered as an overlay banner when `child_exit`, `child_error` or `fatal`
 * arrives on the bridge. In a browser tab (no bridge at all) it just says
 * the engine is gone -- there is no restart button because there is no
 * process to restart.
 */
export function EngineLostBanner({ onRegain }: Props): ReactNode {
  const [dead, setDead] = useState(false);
  const [trying, setTrying] = useState(false);

  useEffect(() => {
    return onMessage((msg: BridgeMessage) => {
      if (msg.type === "child_exit" || msg.type === "child_error" || msg.type === "fatal") {
        setDead(true);
      }
      // Any other message means the engine is talking again.
      if (dead) {
        setDead(false);
        setTrying(false);
        onRegain();
      }
    });
  }, [dead, onRegain]);

  const handleRestart = useCallback(() => {
    setTrying(true);
    window.bridge?.restartEngine();
  }, []);

  const hasBridge = typeof window !== "undefined" && window.bridge;

  if (!dead && hasBridge) return null;
  if (!hasBridge) {
    return (
      <div className="engine-lost is-lost" role="alert">
        <span className="engine-lost-message">Engine is gone — running outside Electron</span>
      </div>
    );
  }

  return (
    <div className="engine-lost" role="alert">
      <span className="engine-lost-icon" />
      <span className="engine-lost-message">The engine died</span>
      {trying ? (
        <span className="engine-lost-trying">Trying…</span>
      ) : (
        <ActionButton variant="run" label="Restart engine" onClick={handleRestart} />
      )}
    </div>
  );
}
