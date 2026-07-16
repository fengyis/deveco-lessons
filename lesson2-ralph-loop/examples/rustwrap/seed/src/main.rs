//! 验收用 CLI 协议 —— ⚠️ 本文件是验收接口的一部分,**不要修改**。
//!
//! stdin 每行一个 JSON 请求:
//!   {"func":"wrap","text":"...","kwargs":{"width":10,...}}
//! stdout 每行一个 JSON 响应:
//!   {"result": [...]} / {"result": "..."} / {"error": "..."}
//!
//! 未实现的函数(todo!)会 panic,这里 catch 住并返回 {"error":"panic"},
//! 所以从第一天起整个协议就是可跑的,分数从 0 逐步往上爬。

use std::io::{self, BufRead, Write};
use std::panic;

use rustwrap::{dedent, fill, indent, shorten, wrap, WrapOptions};
use serde_json::{json, Value};

fn opts_from(kwargs: &Value) -> WrapOptions {
    let mut o = WrapOptions::default();
    let get = |k: &str| kwargs.get(k);
    if let Some(v) = get("width").and_then(Value::as_u64) {
        o.width = v as usize;
    }
    if let Some(v) = get("initial_indent").and_then(Value::as_str) {
        o.initial_indent = v.to_string();
    }
    if let Some(v) = get("subsequent_indent").and_then(Value::as_str) {
        o.subsequent_indent = v.to_string();
    }
    if let Some(v) = get("expand_tabs").and_then(Value::as_bool) {
        o.expand_tabs = v;
    }
    if let Some(v) = get("tabsize").and_then(Value::as_u64) {
        o.tabsize = v as usize;
    }
    if let Some(v) = get("replace_whitespace").and_then(Value::as_bool) {
        o.replace_whitespace = v;
    }
    if let Some(v) = get("fix_sentence_endings").and_then(Value::as_bool) {
        o.fix_sentence_endings = v;
    }
    if let Some(v) = get("break_long_words").and_then(Value::as_bool) {
        o.break_long_words = v;
    }
    if let Some(v) = get("drop_whitespace").and_then(Value::as_bool) {
        o.drop_whitespace = v;
    }
    if let Some(v) = get("break_on_hyphens").and_then(Value::as_bool) {
        o.break_on_hyphens = v;
    }
    if let Some(v) = get("max_lines").and_then(Value::as_u64) {
        o.max_lines = Some(v as usize);
    }
    if let Some(v) = get("placeholder").and_then(Value::as_str) {
        o.placeholder = v.to_string();
    }
    o
}

fn dispatch(req: &Value) -> Value {
    let func = req.get("func").and_then(Value::as_str).unwrap_or("");
    let text = req.get("text").and_then(Value::as_str).unwrap_or("").to_string();
    let kwargs = req.get("kwargs").cloned().unwrap_or_else(|| json!({}));

    let result = panic::catch_unwind(move || -> Value {
        match func {
            "wrap" => json!(wrap(&text, &opts_from(&kwargs))),
            "fill" => json!(fill(&text, &opts_from(&kwargs))),
            "dedent" => json!(dedent(&text)),
            "indent" => {
                let prefix = kwargs.get("prefix").and_then(Value::as_str).unwrap_or("");
                json!(indent(&text, prefix))
            }
            "shorten" => {
                let width = kwargs.get("width").and_then(Value::as_u64).unwrap_or(70) as usize;
                let placeholder = kwargs
                    .get("placeholder")
                    .and_then(Value::as_str)
                    .unwrap_or(" [...]");
                json!(shorten(&text, width, placeholder))
            }
            other => json!({ "__unknown_func": other }),
        }
    });

    match result {
        Ok(v) if v.get("__unknown_func").is_some() => {
            json!({"error": format!("unknown func: {}", v["__unknown_func"])})
        }
        Ok(v) => json!({ "result": v }),
        Err(_) => json!({"error": "panic"}),
    }
}

fn main() {
    // todo!() 的 panic 信息很吵,静音;协议输出只走 stdout
    panic::set_hook(Box::new(|_| {}));

    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = stdout.lock();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) if !l.trim().is_empty() => l,
            Ok(_) => continue,
            Err(_) => break,
        };
        let resp = match serde_json::from_str::<Value>(&line) {
            Ok(req) => dispatch(&req),
            Err(e) => json!({"error": format!("bad request: {e}")}),
        };
        writeln!(out, "{resp}").ok();
    }
}
