/**
 * PostgreSQL Connection: one model, drawn in its card style.
 *
 *   - timeline: the connection as a chain -- you (user, password) → the
 *     server (host, port) → the database -- with its light at the end;
 *   - sentence: "Sign in as <user> with <password> to the <db> database on
 *     <host>:<port>.";
 *   - tiles: one tile per field and one for the test.
 *
 * "Test & Reload" tests the fields being typed AND makes the rest of the
 * window use what came back: `reload()` re-runs `connect_db` through the
 * provider every other reader is subscribed to (AUDIT_retours_ui_8_points.md,
 * E1). The direct call carries the fields before they have been saved.
 */
import { useState, type ReactNode } from "react";

import StyledCard, { type CardViews } from "../../components/cardstyle/StyledCard";
import { BigTile } from "../../components/cardstyle/StyledParts";
import type { GridProps } from "../../components/cardstyle/gridProps";
import { runCommand } from "../../bridge";
import { ICONS } from "../../icons";
import { useDatabase } from "../../settings/useDatabase";
import { Glyph, TextBox, TextToken, useText, type TextSetting } from "./shared";
import "./SettingsCards.css";

const HINT =
  "Use the values shown in CS Demo Manager › Settings › Database. CS Demo Manager must be installed and its database running.";

interface PostgresModel {
  host: TextSetting;
  port: TextSetting;
  db: TextSetting;
  user: TextSetting;
  pass: TextSetting;
  test: () => void;
  /** "" until a test answers; then "Connected" or what went wrong. */
  status: string;
  state: "idle" | "busy" | "ok" | "bad";
}

function usePostgres(): PostgresModel {
  const { reload } = useDatabase();
  const host = useText({ key: "pg_host", id: "pg-host", label: "Host", empty: "localhost", tip: "Machine running the PostgreSQL server of CS Demo Manager" });
  const port = useText({ key: "pg_port", id: "pg-port", label: "Port", empty: "5432", tip: "Port the PostgreSQL server listens on" });
  const db = useText({ key: "pg_db", id: "pg-db", label: "Base", empty: "csdm", tip: "PostgreSQL database name (the one created by CS Demo Manager)" });
  const user = useText({ key: "pg_user", id: "pg-user", label: "User", empty: "postgres", tip: "PostgreSQL user name" });
  const pass = useText({ key: "pg_pass", id: "pg-pass", label: "Pass", empty: "no password", password: true, tip: "PostgreSQL password" });
  const [status, setStatus] = useState("");
  const [state, setState] = useState<PostgresModel["state"]>("idle");

  async function test() {
    setStatus("Connecting…");
    setState("busy");
    try {
      await runCommand("connect_db", {
        pg: { pg_host: host.value, pg_port: port.value, pg_user: user.value, pg_pass: pass.value, pg_db: db.value },
      });
      setStatus("Connected");
      setState("ok");
      reload();
    } catch (cause) {
      setStatus((cause as Error).message);
      setState("bad");
    }
  }

  return { host, port, db, user, pass, test: () => void test(), status, state };
}

function TestButton({ m, className, children }: { m: PostgresModel; className?: string; children?: ReactNode }) {
  return (
    <button
      type="button"
      className={className ?? "chip"}
      data-action="B1"
      title="Tests the PostgreSQL connection and reloads players/tables from the database"
      onClick={m.test}
    >
      {children ?? "Test & Reload"}
    </button>
  );
}

/** One message slot: the guidance until a test answers, then the answer. */
function Answer({ m }: { m: PostgresModel }) {
  return m.status ? (
    <span className={`settings-db-status st-${m.state}`}>{m.status}</span>
  ) : (
    <span className="capture-hint">{HINT}</span>
  );
}

function Light({ m }: { m: PostgresModel }) {
  return <i className={`st-light ${m.state}`} aria-hidden="true" />;
}

function TimelineView({ m }: { m: PostgresModel }) {
  return (
    <div className="pg-a">
      <div className="st-chain">
        <div className="st-node">
          <span className="st-node-h">
            <span className="st-ic"><Glyph g="user" /></span>You
          </span>
          <div className="st-form">
            <TextBox t={m.user} />
            <TextBox t={m.pass} />
          </div>
        </div>
        <span className="st-link" aria-hidden="true" />
        <div className="st-node">
          <span className="st-node-h">
            <span className="st-ic"><Glyph g="server" /></span>Server
          </span>
          <div className="st-form">
            <TextBox t={m.host} />
            <TextBox t={m.port} />
          </div>
        </div>
        <span className="st-link" aria-hidden="true" />
        <div className="st-node">
          <span className="st-node-h">
            <span className="st-ic"><Glyph g="db" /></span>Database
            <Light m={m} />
          </span>
          <div className="st-form">
            <TextBox t={m.db} />
          </div>
        </div>
      </div>
      <div className="row settings-db-row">
        <TestButton m={m} />
        <Answer m={m} />
      </div>
    </div>
  );
}

function SentenceView({ m }: { m: PostgresModel }) {
  return (
    <div className="pg-b">
      <div className="sc-prose">
        <div className="sc-line">
          <span className="w">Sign in as</span> <TextToken t={m.user} /> <span className="w">with</span> <TextToken t={m.pass} />{" "}
          <span className="w">to the</span> <TextToken t={m.db} tone="alt" /> <span className="w">database on</span>{" "}
          <span className="nw">
            <TextToken t={m.host} />
            <span className="w">:</span>
            <TextToken t={m.port} />
            <span className="w">.</span>
          </span>
        </div>
      </div>
      <div className="row settings-db-row">
        <Light m={m} />
        <TestButton m={m} className="sx-act">
          Test it and reload the lists
        </TestButton>
        <Answer m={m} />
      </div>
    </div>
  );
}

function TilesView({ m }: { m: PostgresModel }) {
  return (
    <div className="pg-c">
      <div className="sx-tiles">
        <BigTile icon={<Glyph g="server" />} title="Host">
          <TextBox t={m.host} bare />
        </BigTile>
        <BigTile icon={<Glyph g="port" />} title="Port">
          <TextBox t={m.port} bare />
        </BigTile>
        <BigTile icon={<Glyph g="db" />} title="Database" tone="alt">
          <TextBox t={m.db} bare />
        </BigTile>
        <BigTile icon={<Glyph g="user" />} title="User">
          <TextBox t={m.user} bare />
        </BigTile>
        <BigTile icon={<Glyph g="key" />} title="Password">
          <TextBox t={m.pass} bare />
        </BigTile>
        <BigTile icon={<Glyph g="plug" />} title="Connection" on={m.state === "ok"} tone={m.state === "bad" ? "warn" : undefined}>
          <TestButton m={m} className="chip on" />
          <Light m={m} />
        </BigTile>
      </div>
      <div className="row settings-db-row">
        <Answer m={m} />
      </div>
    </div>
  );
}

const VIEWS: CardViews<PostgresModel> = { timeline: TimelineView, sentence: SentenceView, tiles: TilesView };

export default function PostgresCard(grid: GridProps) {
  const m = usePostgres();
  return (
    <StyledCard
      cardId="postgresql"
      title="PostgreSQL Connection"
      icon={<ICONS.postgresql />}
      prefix="pg"
      m={m}
      views={VIEWS}
      grid={grid}
      count={m.state === "ok" ? "connected" : undefined}
    />
  );
}
