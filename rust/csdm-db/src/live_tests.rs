//! Tests against the real CSDM server, read-only. Ignored by default; run with
//! `CSDM_TEST_PG_CONFIG=<copy of csdm_config.json> cargo test -p csdm-db -- --ignored`.
//! Every write attempted here inserts zero rows even if a lock failed (`WHERE false`).

use crate::conn::{session_config, Db, PgParams, Query};
use crate::error::{ConnectCause, DbError};
use crate::value::DbValue;
use postgres::NoTls;

const CONFIG_ENV: &str = "CSDM_TEST_PG_CONFIG";
/// SQLSTATE 25006 read_only_sql_transaction.
const READ_ONLY_REFUSAL: &str = "25006";
/// A write that changes nothing even if it ran.
const HARMLESS_WRITE: &str = "INSERT INTO tags (name) SELECT name FROM tags WHERE false";

fn params() -> PgParams {
    let path = std::env::var(CONFIG_ENV).unwrap_or_else(|_| panic!("{CONFIG_ENV} must name a copy of csdm_config.json"));
    let raw = std::fs::read_to_string(&path).expect("config copy readable");
    let v: serde_json::Value = serde_json::from_str(&raw).expect("config copy is JSON");
    PgParams::from_settings(v.as_object().expect("config is an object")).expect("pg_* keys present")
}

fn code(e: &postgres::Error) -> String {
    e.code().map(|c| c.code().to_string()).unwrap_or_default()
}

#[test]
#[ignore = "needs the real server: set CSDM_TEST_PG_CONFIG"]
fn session_lock_alone_refuses_a_write() {
    let mut client = session_config(&params()).unwrap().connect(NoTls).unwrap();
    let e = client.execute(HARMLESS_WRITE, &[]).unwrap_err();
    assert_eq!(code(&e), READ_ONLY_REFUSAL, "{e}");
}

#[test]
#[ignore = "needs the real server: set CSDM_TEST_PG_CONFIG"]
fn transaction_lock_alone_refuses_a_write() {
    let p = params();
    let mut cfg = postgres::Config::new();
    cfg.host(&p.host).port(p.port.parse().unwrap()).user(&p.user).password(&p.pass).dbname(&p.db);
    let mut client = cfg.connect(NoTls).unwrap();
    let mut tx = client.build_transaction().read_only(true).start().unwrap();
    let e = tx.execute(HARMLESS_WRITE, &[]).unwrap_err();
    assert_eq!(code(&e), READ_ONLY_REFUSAL, "{e}");
}

#[test]
#[ignore = "needs the real server: set CSDM_TEST_PG_CONFIG"]
fn db_run_refuses_a_write_with_a_clear_sentence() {
    let mut db = Db::connect(&params()).unwrap();
    let e = db.run(&Query::new(HARMLESS_WRITE, vec![])).unwrap_err();
    assert!(matches!(e, DbError::Server { .. }), "{e:?}");
    assert!(e.detail().contains("read-only transaction"), "{}", e.detail());
    assert!(e.to_string().starts_with("The database reported an error: cannot execute INSERT in a read-only transaction."));
}

#[test]
#[ignore = "needs the real server: set CSDM_TEST_PG_CONFIG"]
fn decodes_numeric_real_domains_and_refuses_unknown_types() {
    let mut db = Db::connect(&params()).unwrap();
    let rows = db
        .run(&Query::new(
            "SELECT 1.50::numeric, 0.1::real, 'abc'::information_schema.sql_identifier, 7::smallint, NULL::bigint, $1::bigint",
            vec![DbValue::text("42")],
        ))
        .unwrap();
    assert_eq!(
        rows,
        vec![vec![
            DbValue::Numeric("1.50".parse().unwrap()),
            DbValue::Float(0.1),
            DbValue::text("abc"),
            DbValue::Int(7),
            DbValue::Null,
            DbValue::Int(42),
        ]]
    );
    let e = db.run(&Query::new("SELECT '{}'::jsonb AS doc", vec![])).unwrap_err();
    assert!(matches!(e, DbError::UnsupportedType { ref column, ref type_name } if column == "doc" && type_name == "jsonb"), "{e:?}");
    let e = db.run(&Query::new("SELECT 1 FROM pg_user", vec![])).unwrap_err();
    assert!(matches!(e, DbError::TableOutsideDiscovery { .. }), "{e:?}");
    let e = db.run(&Query::new("SELECT 1 FROM kills WHERE nope = 1", vec![])).unwrap_err();
    assert!(matches!(e, DbError::Schema { .. }), "{e:?}");
}

#[test]
#[ignore = "needs the real server: set CSDM_TEST_PG_CONFIG"]
fn connection_failures_name_their_cause() {
    let good = params();
    let cause = |p: PgParams| match Db::connect(&p) {
        Err(DbError::Connect { cause, .. }) => cause,
        other => panic!("expected a connect error, got {:?}", other.map(|_| ())),
    };
    assert_eq!(cause(PgParams { pass: format!("{}-wrong", good.pass), ..good.clone() }), ConnectCause::Credentials);
    assert_eq!(cause(PgParams { db: "csdm_t1_no_such_db".into(), ..good.clone() }), ConnectCause::NoDatabase);
    assert_eq!(cause(PgParams { host: "127.0.0.1".into(), port: "1".into(), ..good.clone() }), ConnectCause::Unreachable);
    assert!(matches!(Db::connect(&PgParams { port: "x".into(), ..good }), Err(DbError::BadPort(_))));
}
