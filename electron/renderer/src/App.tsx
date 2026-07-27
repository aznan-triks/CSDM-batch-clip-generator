import { useEffect, useRef, useState } from "react";

import { onMessage, send, sendCommand } from "./bridge";
import type { BridgeMessage } from "./bridge";

/** One rendered console line. `key` is a counter: two identical lines are distinct events. */
interface Line {
  key: number;
  text: string;
  cssClass: string;
}

/** The question currently on screen, or null when nothing is pending. */
interface PendingAsk {
  id: string;
  title: string;
  choices: string[];
}

function levelClass(level: string | undefined): string {
  switch (level) {
    case "err":
      return "line-err";
    case "warn":
      return "line-warn";
    case "ok":
      return "line-ok";
    case "dim":
      return "line-dim";
    default:
      return "";
  }
}

/** Render one protocol message the way the skeleton page did, verbatim. */
function describe(message: BridgeMessage): { text: string; cssClass: string } {
  switch (message.type) {
    case "log":
      return {
        text: `[log:${message.level || "-"}] ${message.message}`,
        cssClass: levelClass(message.level),
      };
    case "log_parts":
      return {
        text: `[log_parts] ${message.parts.map(([text]) => text).join("")}`,
        cssClass: "",
      };
    case "state":
      return {
        text: `[state] ${message.name} ${JSON.stringify(message.payload)}`,
        cssClass: "line-dim",
      };
    case "ask":
      return { text: `[ask:${message.kind}] ${message.message}`, cssClass: "" };
    case "result":
      return {
        text:
          `[result] id=${message.id} ok=${message.ok}` +
          (message.error ? ` error=${message.error}` : ""),
        cssClass: "",
      };
    case "fatal":
      return { text: `[fatal] ${message.error}`, cssClass: "line-err" };
    case "child_exit":
      return {
        text: `[bridge] python engine exited (code=${message.code}, signal=${message.signal})`,
        cssClass: "line-err",
      };
    case "child_error":
      return {
        text: `[bridge] failed to start python engine: ${message.error}`,
        cssClass: "line-err",
      };
    default:
      return { text: `[unknown] ${JSON.stringify(message)}`, cssClass: "line-dim" };
  }
}

export default function App() {
  const [lines, setLines] = useState<Line[]>([]);
  const [ask, setAsk] = useState<PendingAsk | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const nextKey = useRef(0);

  useEffect(() => {
    return onMessage((message) => {
      const { text, cssClass } = describe(message);
      nextKey.current += 1;
      const key = nextKey.current;
      setLines((previous) => [...previous, { key, text, cssClass }]);

      if (message.type === "ask") {
        // `options[0]` is the dialog title, the rest are the answers.
        setAsk({
          id: message.id,
          title: message.options[0] ?? message.message,
          choices: message.options.slice(1),
        });
      }
    });
  }, []);

  // Follow the tail, the way the skeleton page did on every appended line.
  useEffect(() => {
    const element = logRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [lines]);

  function answer(value: string | null) {
    if (!ask) return;
    send({ type: "answer", id: ask.id, value });
    setAsk(null);
  }

  return (
    <>
      <div id="toolbar">
        <button type="button" onClick={() => sendCommand("ping")}>
          ping
        </button>
        <button type="button" onClick={() => sendCommand("demo_logs")}>
          demo_logs
        </button>
        <button type="button" onClick={() => sendCommand("demo_ask")}>
          demo_ask
        </button>
      </div>

      {ask && (
        <div id="ask-panel">
          <span>{ask.title} </span>
          {ask.choices.map((choice) => (
            <button type="button" key={choice} onClick={() => answer(choice)}>
              {choice}
            </button>
          ))}
        </div>
      )}

      <div id="log" ref={logRef}>
        {lines.map((line) => (
          <div key={line.key} className={line.cssClass}>
            {line.text}
          </div>
        ))}
      </div>
    </>
  );
}
