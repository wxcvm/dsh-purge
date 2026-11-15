// Use the same native main-panel slots as Armory: navigation stays in the DSH shell.
const PURGE_PANEL_ID = "dsh-purge-workspace";
let purgeWorkspaceCtx = null;
const purgeWorkspaceBus = { page: "drill", listeners: new Set() };
function selectPurgeWorkspacePage(page) {
	purgeWorkspaceBus.page = page === "clean" ? "clean" : "drill";
	for (const fn of purgeWorkspaceBus.listeners) fn(purgeWorkspaceBus.page);
}
function selectPurgeHostPanel(panel) {
	try {
		const ctx = purgeWorkspaceCtx;
		const layout = ctx && typeof ctx.get === "function" ? ctx.get("layout") : ctx && ctx.layout;
		if (!layout || typeof layout.selectPanel !== "function") return false;
		layout.selectPanel(panel);
		return true;
	} catch (error) {
		console.warn("[dsh-purge] host panel selection failed:", error);
		return false;
	}
}
function showPurgeWorkspace(page) {
	selectPurgeWorkspacePage(page);
	setDock({ open: false, authOpen: false });
	if (!selectPurgeHostPanel(PURGE_PANEL_ID)) {
		// Only older hosts without the main-panel slot need the existing Dock.
		setDock({ open: true, maximized: true, tab: purgeWorkspaceBus.page });
	}
}
const PURGE_WORKSPACE_CSS = "__DSH_PURGE_WORKSPACE_CSS__";
// Both the native main slot and the old Dock use the same runtime stylesheet.
// The main slot must not rely on the overlay slot being mounted first.
function ensurePurgeWorkspaceStyles() {
	let uiTag = document.querySelector('style[data-dsh-purge-ui="1"]');
	if (!uiTag) {
		uiTag = document.createElement("style");
		uiTag.setAttribute("data-dsh-purge-ui", "1");
		document.head.append(uiTag);
	}
	uiTag.textContent = PURGE_CSS + PURGE_WORKSPACE_CSS;
	if (__dshPurgeDrill && __dshPurgeDrill.CSS) {
		let drillTag = document.querySelector('style[data-dsh-purge-drill="1"]');
		if (!drillTag) {
			drillTag = document.createElement("style");
			drillTag.setAttribute("data-dsh-purge-drill", "1");
			document.head.append(drillTag);
		}
		drillTag.textContent = __dshPurgeDrill.CSS;
	}
}
// Keep navigation alive when an individual workspace page fails to render.
// A page switch or an explicit retry remounts only the failed content.
class PurgeWorkspaceBoundary extends Component {
	constructor(props) {
		super(props);
		this.state = { failed: false };
	}
	static getDerivedStateFromError() { return { failed: true }; }
	componentDidCatch(error) {
		console.error("[dsh-purge] workspace page render failed:", error);
	}
	render() {
		if (!this.state.failed) return this.props.children;
		return h("div", { className: "dshp-workspace-recovery", role: "alert" },
			h("h2", null, "此页面暂时无法加载"),
			h("p", null, "工作区导航仍然可用。你可以重试当前页面，或切换到其他页面。"),
			h("button", { type: "button", onClick: () => this.setState({ failed: false }) }, "重试此页面"));
	}
}
function PurgeWorkspaceContent({ page, t }) {
	return page === "clean" ? h(SettingsRoot, { t, workspace: true }) : h(__dshPurgeDrill.Panel, { embedded: true });
}
// Keep the native Windows caption palette aligned with the active workspace.
// Capture the host's latest values, so leaving Purge restores its own theme.
function installPurgeCaptionPalette(doc, Observer) {
	const body = doc.body;
	const root = doc.documentElement;
	if (!body || !root) return;
	const style = body.style;
	const palette = [["--dsw-specific-sidebar-fill", "#101c2d"], ["--dsw-alias-label-primary", "#e5eefb"]];
	const previous = new Map();
	const restore = () => {
		for (const [name, saved] of previous) {
			// A host change not yet observed belongs to the host, not Purge.
			if (style.getPropertyValue(name).trim() !== saved.color || style.getPropertyPriority(name)) continue;
			if (saved.value) style.setProperty(name, saved.value, saved.priority);
			else style.removeProperty(name);
		}
		previous.clear();
	};
	const sync = () => {
		if (!root.hasAttribute("data-windows-titlebar")) {
			restore();
			return;
		}
		for (const [name, color] of palette) {
			const value = style.getPropertyValue(name);
			if (value.trim() === color) continue;
			previous.set(name, { color, value, priority: style.getPropertyPriority(name) });
			style.setProperty(name, color);
		}
	};
	// Only the two native caption inputs are changed; unrelated body
	// style mutations do not cause a write or a repaint loop.
	const observer = new Observer(sync);
	observer.observe(root, { attributes: true, attributeFilter: ["data-windows-titlebar"] });
	observer.observe(body, { attributes: true, attributeFilter: ["style"] });
	sync();
	return () => {
		observer.disconnect();
		restore();
	};
}
function workspacePrivacySummary(status) {
	if (status?.ok !== true || typeof status.maskHistory !== "boolean" || typeof status.maskAssetResults !== "boolean") {
		return { label: "隐私 · 未知", detail: "未取得已保存的展示保护状态" };
	}
	const count = Number(status.maskHistory) + Number(status.maskAssetResults);
	return {
		label: "隐私 · " + count + "/2",
		detail: "已保存：扫描记录与运行诊断 " + (status.maskHistory ? "遮蔽" : "显示")
			+ "；测绘与 ARTEX 联动展示 " + (status.maskAssetResults ? "遮蔽" : "显示")
			+ "。仅本地展示，不代表网络、原始数据或外部应用已受保护。",
	};
}
function PurgeWorkspacePage() {
	const t = useT();
	useLayoutEffect(() => { ensurePurgeWorkspaceStyles(); }, []);
	const [page, setPage] = useState(purgeWorkspaceBus.page);
	const [workspaceVisible, setWorkspaceVisible] = useState(true);
	const [privacyStatus, setPrivacyStatus] = useState(null);
	useEffect(() => {
		if (!workspaceVisible || !__dshPurgeDrill?.api) return;
		let live = true, revision = 0;
		const refresh = async () => {
			const current = ++revision;
			try {
				const result = await __dshPurgeDrill.api({ op: "privacyDisplayStatus" });
				if (live && current === revision) setPrivacyStatus(result);
			} catch { if (live && current === revision) setPrivacyStatus(null); }
		};
		document.addEventListener("dsh-purge-privacy-saved", refresh);
		setPrivacyStatus(null);
		refresh();
		return () => { live = false; document.removeEventListener("dsh-purge-privacy-saved", refresh); };
	}, [page, workspaceVisible]);
	const privacySummary = workspacePrivacySummary(privacyStatus);
	const temporaryPrivacy = __dshPurgeDrill.useTemporaryPrivacy();
	useEffect(() => () => __dshPurgeDrill.setTemporaryPrivacy(null), []);
	// Install before paint, and also follow a late native caption mount.
	useLayoutEffect(() => {
		if (!workspaceVisible) return;
		return installPurgeCaptionPalette(document, MutationObserver);
	}, [workspaceVisible]);
	const workspaceRef = useRef(null);
	const [immersive, setImmersive] = useState(false);
	const [fullscreenError, setFullscreenError] = useState("");
	const [navigationError, setNavigationError] = useState("");
	useEffect(() => {
		const onChange = () => {
			setImmersive(document.fullscreenElement === workspaceRef.current);
			setFullscreenError("");
		};
		document.addEventListener("fullscreenchange", onChange);
		return () => document.removeEventListener("fullscreenchange", onChange);
	}, []);
	const toggleImmersive = () => {
		const el = workspaceRef.current;
		if (!el) return;
		setFullscreenError("");
		try {
			if (document.fullscreenElement === el) {
				const result = document.exitFullscreen();
				if (result && typeof result.catch === "function") {
					result.catch(() => setFullscreenError("退出全屏失败，可以使用 Esc"));
				}
			} else if (typeof el.requestFullscreen === "function") {
				const result = el.requestFullscreen();
				if (result && typeof result.catch === "function") {
					result.catch(() => setFullscreenError("宿主不允许全屏，可试试 F11 或最大化 DSH 窗口"));
				}
			} else {
				setFullscreenError("当前宿主不支持此全屏方式，可试试 F11");
			}
		} catch {
			setFullscreenError("全屏切换被宿主拒绝，可试试 F11");
		}
	};
	useEffect(() => {
		const fn = (next) => { setPage(next); setWorkspaceVisible(true); setNavigationError(""); };
		purgeWorkspaceBus.listeners.add(fn);
		return () => purgeWorkspaceBus.listeners.delete(fn);
	}, []);
	useEffect(() => {
		if (page === "drill" && __dshPurgeDrill && __dshPurgeDrill.setUI) {
			__dshPurgeDrill.setUI({ open: true });
		}
	}, [page]);
	const open = (next) => selectPurgeWorkspacePage(next);
	const back = () => {
		// Leave the browser's fullscreen top layer before returning to the host.
		if (document.fullscreenElement === workspaceRef.current && typeof document.exitFullscreen === "function") {
			try {
				const result = document.exitFullscreen();
				if (result && typeof result.catch === "function") result.catch(() => {});
			} catch { /* The host may already have exited fullscreen. */ }
		}
		// Do not blank the workspace if the host refuses the navigation.
		if (!selectPurgeHostPanel(null)) {
			setNavigationError("暂时无法返回会话，请重试。");
			return;
		}
		setNavigationError("");
		__dshPurgeDrill.setTemporaryPrivacy(null);
		setWorkspaceVisible(false);
	};
	if (!workspaceVisible) return null;
	const panel = h("section", {
		ref: workspaceRef,
		className: "dshp-dock dshp-workspace",
		"data-default-full": "1",
		"data-workspace": page === "clean" ? "clean" : "redteam",
		"data-maximized": "1", "data-open": "1", "data-theme": "dusk",
		"aria-label": "Purge 工作区",
	},
		h("header", { className: "dshp-workspace-nav" },
			h("strong", null, "Purge"),
			h("nav", { className: "dshp-workspace-tabs", role: "tablist", "aria-label": "Purge 工作区" },
				["clean", "drill"].map((key) => h("button", {
					type: "button", key, role: "tab",
					"aria-selected": String(page === key),
					onClick: () => open(key),
				}, key === "clean" ? "清洗台" : "作战台"))),
			h("button", { type: "button", className: "dshp-workspace-privacy", title: privacySummary.detail,
				"aria-label": "打开智能隐私中心。" + privacySummary.detail,
				onClick: () => { __dshPurgeDrill.setUI({ tab: "low-impact", focus: null }); showPurgeWorkspace("drill"); } }, privacySummary.label + (temporaryPrivacy ? ' · 临时' : '')),
			h("button", { type: "button", className: "dshp-workspace-back", onClick: back }, "返回会话"),
			h("button", { type: "button", className: "dshp-workspace-fullscreen",
				"aria-pressed": immersive ? "true" : "false", title: "可选系统级全屏，Purge 默认已铺满 Harness 窗口",
				onClick: toggleImmersive }, immersive ? "退出系统全屏" : "系统全屏"),
			fullscreenError || navigationError ? h("span", { className: "dshp-workspace-fullscreen-error",
				role: "status" }, navigationError || fullscreenError) : null),
		h("div", { className: "dshp-dock-body" },
			h(PurgeWorkspaceBoundary, { key: page }, h(PurgeWorkspaceContent, { page, t }))));
	// Portal escapes the Harness main-panel layout and its sidebar/clipping container.
	// Keep the same React state and host API; no separate browser window.
	try {
		const rd = require("react-dom");
		if (rd && typeof rd.createPortal === "function" && document.body) {
			return rd.createPortal(panel, document.body);
		}
	} catch { /* Fixed-position fallback for hosts without react-dom. */ }
	return panel;
}
function PurgeWorkspaceIcon(props) {
	return h("svg", { width: props.size || 18, height: props.size || 18,
		viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
		strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round",
		"aria-hidden": "true" },
		h("path", { d: "M12 2 20 6v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" }),
		h("path", { d: "m8.5 12 2.5 2.5 4.5-5" }));
}
