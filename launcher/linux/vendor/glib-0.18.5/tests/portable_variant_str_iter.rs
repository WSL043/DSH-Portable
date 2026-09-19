use glib::variant::ToVariant;

#[test]
fn portable_optimized_variant_string_iteration() {
    let strings = ["", "alpha", "日本語", "中文", "omega"];
    let value = strings.to_variant();
    assert_eq!(value.array_iter_str().unwrap().collect::<Vec<_>>(), strings);
    let mut iter = value.array_iter_str().unwrap();
    assert_eq!(iter.next(), Some(""));
    assert_eq!(iter.next_back(), Some("omega"));
    assert_eq!(iter.nth(1), Some("日本語"));
    assert_eq!(iter.nth_back(0), Some("中文"));
    assert_eq!(iter.next(), None);
    assert_eq!(value.array_iter_str().unwrap().last(), Some("omega"));
    let empty: [&str; 0] = [];
    assert_eq!(empty.to_variant().array_iter_str().unwrap().next(), None);
}
