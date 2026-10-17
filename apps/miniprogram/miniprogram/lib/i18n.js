// EN and 简体中文 (spec 07). Pages put table(lang) in their data so WXML reads {{t.section.key}}; strings with
// placeholders are filled in JavaScript with t().
const TABLES = { en: require('./i18n/en.js'), 'zh-CN': require('./i18n/zh-CN.js') };

/** WeChat reports zh_CN, zh_HK, zh_TW...: every Chinese locale gets Simplified Chinese, everything else English. */
function langOf(systemLanguage) {
  return typeof systemLanguage === 'string' && systemLanguage.indexOf('zh') === 0 ? 'zh-CN' : 'en';
}

function table(lang) {
  return TABLES[lang] || TABLES.en;
}

function lookup(tbl, key) {
  let v = tbl;
  for (const part of key.split('.')) {
    if (v == null || typeof v !== 'object') return undefined;
    v = v[part];
  }
  return typeof v === 'string' ? v : undefined;
}

/** The string for a dotted key with {name} placeholders filled; English when missing, then the key itself. */
function t(lang, key, vars) {
  const s = lookup(table(lang), key) || lookup(TABLES.en, key) || key;
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] !== undefined ? String(vars[k]) : m));
}

function flatten(obj, prefix) {
  const out = {};
  for (const k of Object.keys(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (obj[k] !== null && typeof obj[k] === 'object') Object.assign(out, flatten(obj[k], key));
    else out[key] = obj[k];
  }
  return out;
}

module.exports = { langOf, table, t, flatten };
