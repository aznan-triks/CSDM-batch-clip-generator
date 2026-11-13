//! Dynamic typing (research/03 §1.2): the engine does not know the schema in advance, so a
//! cell is decoded from its SQL type at run time, the way psycopg2 hands back a Python type.

use bytes::BytesMut;
use chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};
use postgres::types::{to_sql_checked, FromSql, IsNull, Kind, ToSql, Type};
use rust_decimal::Decimal;
use std::error::Error;
use uuid::Uuid;

/// Python `str(datetime)` layout (space separator, fraction only when non-zero).
const PY_STR_DATETIME: &str = "%Y-%m-%d %H:%M:%S%.f";
/// Python `datetime.isoformat()` layouts, without and with microseconds.
const PY_ISO_SECONDS: &str = "%Y-%m-%dT%H:%M:%S";
const PY_ISO_MICROS: &str = "%Y-%m-%dT%H:%M:%S%.6f";

type BoxErr = Box<dyn Error + Sync + Send>;

/// One cell, typed like the Python value psycopg2 would return.
#[derive(Debug, Clone, PartialEq)]
pub enum DbValue {
    Null,
    Bool(bool),
    /// smallint, integer, bigint, oid.
    Int(i64),
    /// double precision; `real` widened through its shortest decimal text, as psycopg2 does.
    Float(f64),
    Numeric(Decimal),
    Text(String),
    Timestamp(NaiveDateTime),
    TimestampTz(DateTime<Utc>),
    Date(NaiveDate),
    Uuid(Uuid),
}

pub type Row = Vec<DbValue>;

impl DbValue {
    pub fn text(s: impl Into<String>) -> Self {
        DbValue::Text(s.into())
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            DbValue::Text(s) => Some(s),
            _ => None,
        }
    }

    pub fn is_null(&self) -> bool {
        matches!(self, DbValue::Null)
    }

    /// Python truthiness (`if row[0]:` in 3.5).
    pub fn is_truthy(&self) -> bool {
        match self {
            DbValue::Null => false,
            DbValue::Bool(b) => *b,
            DbValue::Int(i) => *i != 0,
            DbValue::Float(f) => *f != 0.0,
            DbValue::Numeric(d) => !d.is_zero(),
            DbValue::Text(s) => !s.is_empty(),
            _ => true,
        }
    }

    /// Python `str(value)` for the types discovery stringifies (map names, game modes, ids).
    pub fn py_str(&self) -> String {
        match self {
            DbValue::Null => "None".into(),
            DbValue::Bool(true) => "True".into(),
            DbValue::Bool(false) => "False".into(),
            DbValue::Int(i) => i.to_string(),
            // shortcut: Rust's shortest float text differs from Python repr for exponents
            // and whole numbers ("1" vs "1.0"); no caller stringifies a float column today.
            DbValue::Float(f) => format!("{f:?}"),
            DbValue::Numeric(d) => d.to_string(),
            DbValue::Text(s) => s.clone(),
            DbValue::Timestamp(t) => t.format(PY_STR_DATETIME).to_string(),
            DbValue::TimestampTz(t) => format!("{}+00:00", t.format(PY_STR_DATETIME)),
            DbValue::Date(d) => d.to_string(),
            DbValue::Uuid(u) => u.to_string(),
        }
    }

    /// `discovery_to_json` `_json_scalar`: JSON scalars stay, dates become ISO text, the rest `str()`.
    /// Timestamps with time zone are rendered in UTC (the session zone of CSDM's server).
    pub fn to_json_scalar(&self) -> serde_json::Value {
        use serde_json::Value as J;
        match self {
            DbValue::Null => J::Null,
            DbValue::Bool(b) => J::Bool(*b),
            DbValue::Int(i) => J::from(*i),
            DbValue::Float(f) => serde_json::Number::from_f64(*f).map_or(J::Null, J::Number),
            DbValue::Text(s) => J::String(s.clone()),
            DbValue::Timestamp(t) => J::String(iso(t)),
            DbValue::TimestampTz(t) => J::String(format!("{}+00:00", iso(&t.naive_utc()))),
            DbValue::Date(d) => J::String(d.to_string()),
            other => J::String(other.py_str()),
        }
    }
}

/// Python `datetime.isoformat()`: microseconds only when non-zero.
fn iso(t: &NaiveDateTime) -> String {
    if t.and_utc().timestamp_subsec_micros() == 0 {
        t.format(PY_ISO_SECONDS).to_string()
    } else {
        t.format(PY_ISO_MICROS).to_string()
    }
}

/// A domain (e.g. `information_schema.sql_identifier`) reads as its base type.
pub(crate) fn base_type(t: &Type) -> Type {
    match t.kind() {
        Kind::Domain(inner) => base_type(inner),
        _ => t.clone(),
    }
}

fn is_text(t: &Type) -> bool {
    [Type::TEXT, Type::VARCHAR, Type::BPCHAR, Type::NAME, Type::UNKNOWN].contains(t)
}

/// The raw bytes of a cell, whatever its type; decoded afterwards by `decode`.
pub(crate) struct Raw<'a>(pub Option<&'a [u8]>);

impl<'a> FromSql<'a> for Raw<'a> {
    fn from_sql(_: &Type, raw: &'a [u8]) -> Result<Self, BoxErr> {
        Ok(Raw(Some(raw)))
    }
    fn from_sql_null(_: &Type) -> Result<Self, BoxErr> {
        Ok(Raw(None))
    }
    fn accepts(_: &Type) -> bool {
        true
    }
}

/// Decodes one non-null cell. `Ok(None)` = a type this layer does not read.
pub(crate) fn decode(ty: &Type, raw: &[u8]) -> Result<Option<DbValue>, BoxErr> {
    let t = base_type(ty);
    let v = if t == Type::BOOL {
        DbValue::Bool(bool::from_sql(&t, raw)?)
    } else if t == Type::INT2 {
        DbValue::Int(i16::from_sql(&t, raw)?.into())
    } else if t == Type::INT4 {
        DbValue::Int(i32::from_sql(&t, raw)?.into())
    } else if t == Type::INT8 {
        DbValue::Int(i64::from_sql(&t, raw)?)
    } else if t == Type::OID {
        DbValue::Int(u32::from_sql(&t, raw)?.into())
    } else if t == Type::FLOAT4 {
        // psycopg2 parses the server's shortest text of the float4, not its binary widening.
        DbValue::Float(f32::from_sql(&t, raw)?.to_string().parse()?)
    } else if t == Type::FLOAT8 {
        DbValue::Float(f64::from_sql(&t, raw)?)
    } else if t == Type::NUMERIC {
        DbValue::Numeric(Decimal::from_sql(&t, raw)?)
    } else if is_text(&t) {
        DbValue::Text(String::from_sql(&Type::TEXT, raw)?)
    } else if t == Type::TIMESTAMP {
        DbValue::Timestamp(NaiveDateTime::from_sql(&t, raw)?)
    } else if t == Type::TIMESTAMPTZ {
        DbValue::TimestampTz(DateTime::<Utc>::from_sql(&t, raw)?)
    } else if t == Type::DATE {
        DbValue::Date(NaiveDate::from_sql(&t, raw)?)
    } else if t == Type::UUID {
        DbValue::Uuid(Uuid::from_sql(&t, raw)?)
    } else {
        return Ok(None);
    };
    Ok(Some(v))
}

/// A parameter sent as the type the server inferred for its placeholder, the way psycopg2's
/// quoted literals let the server coerce `'123'` into a bigint column.
#[derive(Debug)]
pub(crate) struct Param<'a>(pub &'a DbValue);

fn mismatch(v: &DbValue, t: &Type) -> BoxErr {
    format!("cannot send {v:?} as {t}").into()
}

impl ToSql for Param<'_> {
    fn to_sql(&self, ty: &Type, out: &mut BytesMut) -> Result<IsNull, BoxErr> {
        let t = base_type(ty);
        match self.0 {
            DbValue::Null => Ok(IsNull::Yes),
            DbValue::Text(s) if is_text(&t) => s.as_str().to_sql(&Type::TEXT, out),
            DbValue::Text(s) if t == Type::INT8 => s.trim().parse::<i64>()?.to_sql(&t, out),
            DbValue::Text(s) if t == Type::INT4 => s.trim().parse::<i32>()?.to_sql(&t, out),
            DbValue::Text(s) if t == Type::INT2 => s.trim().parse::<i16>()?.to_sql(&t, out),
            DbValue::Text(s) if t == Type::UUID => Uuid::parse_str(s.trim())?.to_sql(&t, out),
            DbValue::Int(i) if t == Type::INT8 => i.to_sql(&t, out),
            DbValue::Int(i) if t == Type::INT4 => i32::try_from(*i)?.to_sql(&t, out),
            DbValue::Int(i) if t == Type::INT2 => i16::try_from(*i)?.to_sql(&t, out),
            DbValue::Int(i) if t == Type::NUMERIC => Decimal::from(*i).to_sql(&t, out),
            DbValue::Int(i) if t == Type::FLOAT8 => (*i as f64).to_sql(&t, out),
            DbValue::Bool(b) if t == Type::BOOL => b.to_sql(&t, out),
            DbValue::Float(f) if t == Type::FLOAT8 => f.to_sql(&t, out),
            DbValue::Numeric(d) if t == Type::NUMERIC => d.to_sql(&t, out),
            DbValue::Uuid(u) if t == Type::UUID => u.to_sql(&t, out),
            DbValue::Uuid(u) if is_text(&t) => u.to_string().as_str().to_sql(&Type::TEXT, out),
            DbValue::TimestampTz(d) if t == Type::TIMESTAMPTZ => d.to_sql(&t, out),
            DbValue::Timestamp(d) if t == Type::TIMESTAMP => d.to_sql(&t, out),
            DbValue::Date(d) if t == Type::DATE => d.to_sql(&t, out),
            v => Err(mismatch(v, &t)),
        }
    }

    fn accepts(_: &Type) -> bool {
        true
    }

    to_sql_checked!();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn float4_widens_like_psycopg2() {
        let raw = 0.1f32.to_be_bytes();
        assert_eq!(decode(&Type::FLOAT4, &raw).unwrap(), Some(DbValue::Float(0.1)));
    }

    #[test]
    fn unknown_type_is_reported_not_guessed() {
        assert_eq!(decode(&Type::JSONB, b"\x01{}").unwrap(), None);
    }

    #[test]
    fn text_param_is_coerced_to_the_inferred_integer_type() {
        let mut out = BytesMut::new();
        Param(&DbValue::text("42")).to_sql(&Type::INT8, &mut out).unwrap();
        assert_eq!(&out[..], &42i64.to_be_bytes());
        assert!(Param(&DbValue::text("x")).to_sql(&Type::INT8, &mut BytesMut::new()).is_err());
        assert!(Param(&DbValue::Int(1)).to_sql(&Type::VARCHAR, &mut BytesMut::new()).is_err());
    }

    #[test]
    fn json_scalar_matches_python_isoformat() {
        let t = NaiveDate::from_ymd_opt(2024, 5, 1).unwrap().and_hms_opt(12, 0, 3).unwrap();
        assert_eq!(DbValue::TimestampTz(t.and_utc()).to_json_scalar(), "2024-05-01T12:00:03+00:00");
        let t2 = t + chrono::Duration::microseconds(5);
        assert_eq!(DbValue::Timestamp(t2).to_json_scalar(), "2024-05-01T12:00:03.000005");
        assert!(!DbValue::text("").is_truthy() && DbValue::Int(3).is_truthy());
    }
}
