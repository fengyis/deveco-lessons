//! 把 CPython 的 textwrap 模块移植成**行为等价**的 Rust。
//!
//! 半成品:所有函数都是 `todo!()`。你的活是把它们逐个实现到与
//! CPython `textwrap` 在相同输入、相同选项下输出**完全一致**。
//!
//! 参考实现就在这台机器上:`python3 -c "import textwrap; ..."`,
//! 拿不准某个边界行为,跑一下参考实现对照——这就是移植工程的日常。

/// 对应 CPython `textwrap.TextWrapper` 的构造参数,默认值也与之一致。
#[derive(Debug, Clone)]
pub struct WrapOptions {
    pub width: usize,
    pub initial_indent: String,
    pub subsequent_indent: String,
    pub expand_tabs: bool,
    pub tabsize: usize,
    pub replace_whitespace: bool,
    pub fix_sentence_endings: bool,
    pub break_long_words: bool,
    pub drop_whitespace: bool,
    pub break_on_hyphens: bool,
    pub max_lines: Option<usize>,
    pub placeholder: String,
}

impl Default for WrapOptions {
    fn default() -> Self {
        Self {
            width: 70,
            initial_indent: String::new(),
            subsequent_indent: String::new(),
            expand_tabs: true,
            tabsize: 8,
            replace_whitespace: true,
            fix_sentence_endings: false,
            break_long_words: true,
            drop_whitespace: true,
            break_on_hyphens: true,
            max_lines: None,
            placeholder: " [...]".to_string(),
        }
    }
}

/// 等价于 `textwrap.wrap(text, **options)`。
pub fn wrap(text: &str, opts: &WrapOptions) -> Vec<String> {
    let _ = (text, opts);
    todo!("port textwrap.wrap")
}

/// 等价于 `textwrap.fill(text, **options)`。
pub fn fill(text: &str, opts: &WrapOptions) -> String {
    let _ = (text, opts);
    todo!("port textwrap.fill")
}

/// 等价于 `textwrap.dedent(text)`。
pub fn dedent(text: &str) -> String {
    let _ = text;
    todo!("port textwrap.dedent")
}

/// 等价于 `textwrap.indent(text, prefix)`(默认 predicate)。
pub fn indent(text: &str, prefix: &str) -> String {
    let _ = (text, prefix);
    todo!("port textwrap.indent")
}

/// 等价于 `textwrap.shorten(text, width, placeholder=placeholder)`。
pub fn shorten(text: &str, width: usize, placeholder: &str) -> String {
    let _ = (text, width, placeholder);
    todo!("port textwrap.shorten")
}
