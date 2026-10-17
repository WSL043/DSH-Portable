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
function portableUseExtra(entry) {
	const [, refresh] = react.useReducer((count) => count + 1, 0);
	react.useEffect(() => {
		portableExtras.listeners.add(refresh);
		portableLoadExtras();
		return () => { portableExtras.listeners.delete(refresh); };
	}, []);
	return portableExtraFor(entry);
}
function PortableEntryExtras({ entry, language }) {
	const extra = portableUseExtra(entry);
	if (extra === null) return null;
	const zh = String(language).toLowerCase().startsWith("zh");
	const compact = (value) => new Intl.NumberFormat(language, { notation: "compact", maximumFractionDigits: 1 }).format(value);
	const facts = [];
	if (typeof extra.d === "number") facts.push(zh ? \`近 30 天下载 \${compact(extra.d)}\` : \`\${compact(extra.d)} downloads in 30 days\`);
	if (typeof extra.stars === "number") facts.push(\`★ \${compact(extra.stars)}\`);
	if (facts.length === 0) return null;
	return (0, react_jsx_runtime.jsx)("span", { "data-portable-extras": "1", style: { fontSize: "12px", opacity: 0.7 }, children: facts.join(" · ") });
}
let portableCreatePortal = null;
try { portableCreatePortal = require("react-dom").createPortal; } catch (error) { portableCreatePortal = null; }
/** Full-size preview: click or Esc closes it, the arrow keys step through the plugin's images. */
function PortableShotViewer({ shots, start, onClose }) {
	const [index, setIndex] = react.useState(start);
	react.useEffect(() => {
		const onKey = (event) => {
			if (event.key === "Escape") { event.stopPropagation(); event.preventDefault(); onClose(); }
			else if (event.key === "ArrowRight") setIndex((value) => (value + 1) % shots.length);
			else if (event.key === "ArrowLeft") setIndex((value) => (value - 1 + shots.length) % shots.length);
		};
		window.addEventListener("keydown", onKey, true);
		return () => { window.removeEventListener("keydown", onKey, true); };
	}, []);
	const viewer = (0, react_jsx_runtime.jsxs)("div", {
		role: "dialog",
		"aria-modal": "true",
		"data-portable-viewer": "1",
		onClick: onClose,
		style: { position: "fixed", top: 0, right: 0, bottom: 0, left: 0, zIndex: 2147483000, background: "rgba(0,0,0,.8)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out" },
		children: [
			(0, react_jsx_runtime.jsx)("img", { src: shots[index], alt: "", referrerPolicy: "no-referrer", style: { maxWidth: "92vw", maxHeight: "90vh", objectFit: "contain", borderRadius: "8px", background: "#fff" } }),
			shots.length > 1 ? (0, react_jsx_runtime.jsx)("span", { style: { position: "absolute", bottom: "16px", left: 0, right: 0, textAlign: "center", color: "#fff", fontSize: "13px" }, children: \`\${index + 1} / \${shots.length}\` }) : null
		]
	});
	return portableCreatePortal === null ? viewer : portableCreatePortal(viewer, document.body);
}
/** The preview sits at the right edge of the card, beside the install button, so it does not make the list taller. */
function PortableEntryShot({ entry }) {
	const extra = portableUseExtra(entry);
	const [hidden, setHidden] = react.useState(false);
	const [open, setOpen] = react.useState(false);
	const shots = extra !== null && Array.isArray(extra.shots) && !hidden ? extra.shots : [];
	if (shots.length === 0) return null;
	return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
		(0, react_jsx_runtime.jsx)("img", {
			"data-portable-shot": "1",
			role: "button",
			tabIndex: 0,
			src: shots[0],
			alt: "",
			loading: "lazy",
			decoding: "async",
			referrerPolicy: "no-referrer",
			onError: () => setHidden(true),
			onClick: () => setOpen(true),
			onKeyDown: (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setOpen(true); } },
			style: { position: "relative", zIndex: 2, flex: "none", width: "112px", height: "72px", objectFit: "cover", borderRadius: "6px", alignSelf: "center", cursor: "zoom-in", border: "1px solid var(--dsw-border, rgba(127,127,127,.25))" }
		}),
		open ? (0, react_jsx_runtime.jsx)(PortableShotViewer, { shots, start: 0, onClose: () => setOpen(false) }) : null
	] });
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
    .replace(CARD_ANCHOR, (_, rest) => `})\n\t\t\t\t\t\t\t}), (0, react_jsx_runtime.jsx)(PortableEntryExtras, { entry, language })\n\t\t\t\t\t\t]\n\t\t\t\t\t}), (0, react_jsx_runtime.jsx)(PortableEntryShot, { entry }),${rest}`)
}
