// The official market's cards show an icon, a title, a description and the version. The Portable market's own cards also
// showed how often a plugin is downloaded, its stars and a preview image. The official index format has no field for any
// of those, so this adds them to the official card from the Portable server (/dsh-market/official-extras), which serves
// them from the Awesome DSH catalog it already keeps. A failed request leaves the card exactly as the core draws it.
export const EXTRAS_MARKER = 'dsh-portable-market-extras-v1'

const CARD_ANCHOR = /\}\)\s*\}\)\s*\]\s*\}\),(\s*\(0, react_jsx_runtime\.jsx\)\("div", \{\s*className: DiscoverSection_module_css_default\.cardEnd)/u
const CARD_FUNCTION = 'function EntryCard({ entry, t, face, language, labels, onOpen, onInstall, onOpenInstalled }) {'

// Plain React from the module's own scope; no dependency on anything the core does not already load.
const HELPER = `/* ${EXTRAS_MARKER} */
const portableExtras = { data: null, state: "idle", listeners: new Set() };
function portableLoadExtras() {
	if (portableExtras.state !== "idle") return;
	portableExtras.state = "loading";
	fetch("/dsh-market/official-extras", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((data) => {
		portableExtras.data = data;
	}, () => {}).finally(() => {
		portableExtras.state = "done";
		portableExtras.listeners.forEach((listener) => listener());
	});
}
function portableExtraFor(entry) {
	const data = portableExtras.data;
	if (data === null || typeof data !== "object") return null;
	if (data.byName && Object.hasOwn(data.byName, entry.name)) return data.byName[entry.name];
	const match = /^https:\\/\\/github\\.com\\/([^/]+)\\/([^/#?]+?)(?:\\.git)?\\/?$/u.exec(entry.repository?.url ?? "");
	const key = match === null ? "" : \`\${match[1]}/\${match[2]}\`.toLowerCase();
	return data.byRepo && key !== "" && Object.hasOwn(data.byRepo, key) ? data.byRepo[key] : null;
}
function PortableEntryExtras({ entry, language }) {
	const [, refresh] = react.useReducer((count) => count + 1, 0);
	const [hidden, setHidden] = react.useState(false);
	react.useEffect(() => {
		portableExtras.listeners.add(refresh);
		portableLoadExtras();
		return () => { portableExtras.listeners.delete(refresh); };
	}, []);
	const extra = portableExtraFor(entry);
	if (extra === null) return null;
	const zh = String(language).toLowerCase().startsWith("zh");
	const compact = (value) => new Intl.NumberFormat(language, { notation: "compact", maximumFractionDigits: 1 }).format(value);
	const facts = [];
	if (typeof extra.d === "number") facts.push(zh ? \`近 30 天下载 \${compact(extra.d)}\` : \`\${compact(extra.d)} downloads in 30 days\`);
	if (typeof extra.stars === "number") facts.push(\`★ \${compact(extra.stars)}\`);
	const shot = Array.isArray(extra.shots) && !hidden ? extra.shots[0] : null;
	if (facts.length === 0 && shot === null) return null;
	return (0, react_jsx_runtime.jsxs)("span", {
		"data-portable-extras": "1",
		style: { display: "flex", flexDirection: "column", gap: "6px", marginTop: "4px" },
		children: [
			facts.length === 0 ? null : (0, react_jsx_runtime.jsx)("span", { style: { fontSize: "12px", opacity: 0.7 }, children: facts.join(" · ") }),
			shot === null ? null : (0, react_jsx_runtime.jsx)("img", {
				src: shot,
				alt: "",
				loading: "lazy",
				decoding: "async",
				referrerPolicy: "no-referrer",
				onError: () => setHidden(true),
				style: { maxHeight: "120px", maxWidth: "100%", width: "auto", alignSelf: "flex-start", borderRadius: "6px", border: "1px solid var(--dsw-border, rgba(127,127,127,.25))", objectFit: "cover" }
			})
		]
	});
}
`

function countOf(source, pattern) {
  return source.match(new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`))?.length ?? 0
}

export function patchMarketExtras(source) {
  if (source.includes(EXTRAS_MARKER)) return source
  if (source.split(CARD_FUNCTION).length - 1 !== 1) throw new Error('Official market card function changed: expected exactly one EntryCard')
  const anchors = countOf(source, CARD_ANCHOR)
  if (anchors !== 1) throw new Error(`Official market card layout changed: expected 1 card end, found ${anchors}`)
  return source
    .replace(CARD_FUNCTION, () => `${HELPER}\t\t${CARD_FUNCTION}`)
    .replace(CARD_ANCHOR, (_, rest) => `})\n\t\t\t\t\t\t\t}), (0, react_jsx_runtime.jsx)(PortableEntryExtras, { entry, language })\n\t\t\t\t\t\t]\n\t\t\t\t\t}),${rest}`)
}
