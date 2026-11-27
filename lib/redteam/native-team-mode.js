/**
 * Use the official Harness Agent Teams board in redteam root Sessions.
 * Adapted from CallMeGuLab/dsh-purge-safe v2.0.0, lib/redteam/team-mode.js
 * (Apache-2.0, see NOTICE).
 *
 * Team state is owned by the host Session. Do not create a second task store,
 * change agent limits, interfere with tool approvals, or override a manual
 * team/mode selection (including enabled:false).
 */
import { isRedteamPresetId, isRedteamSession } from "../identity.js";

function eventsOf(session) {
  const collected = [];
  try {
    if (typeof session?.snapshotEvents === "function") {
      const snapshot = session.snapshotEvents();
      if (Array.isArray(snapshot)) collected.push(...snapshot);
    }
  } catch { /* session may no longer be active */ }
  if (Array.isArray(session?.events)) collected.push(...session.events);
  return collected;
}

function hasSelectedTeamMode(session) {
  return eventsOf(session).some(event => event?.type === "team/mode");
}

function isRoot(session) {
  const header = session?.header;
  const origin = String(header?.origin || "").toLowerCase();
  return !["subagent", "teammate", "delegate"].includes(origin)
    && Number(header?.delegationDepth ?? 0) <= 0;
}

function knownPreset(session) {
  if (eventsOf(session).some(e => e?.type === "agent-preset/selected")) return true;
  return Boolean(String(session?.header?.agentPreset || session?.agentPreset || "").trim());
}

/**
 * Returns a concrete decision to support tests and diagnostics.
 * A failure must not be memoized: next step may retry after service recovery.
 */
export function ensureNativeRedteamTeam(session, check = () => isRedteamSession({ agent: { session } }), succeeded = new WeakSet()) {
  if (!session || typeof session.append !== "function") return "no-session";
  if (!isRoot(session)) return "child";
  if (hasSelectedTeamMode(session) || succeeded.has(session)) return "already-selected";
  let selected = false;
  try { selected = check() === true; } catch { return "unknown"; }
  if (!selected) return knownPreset(session) ? "not-redteam" : "unknown";
  try {
    session.append("team/mode", { enabled: true });
    succeeded.add(session);
    return "enabled";
  } catch {
    return "append-failed";
  }
}

function teamServiceOf(ctx) {
  try {
    const team = typeof ctx?.get === "function" ? ctx.get("agentTeams") : ctx?.agentTeams;
    return team && typeof team.isEnabled === "function" ? team : null;
  } catch { return null; }
}

/**
 * Three host event positions cover first-step tools and mid-session preset
 * changes. The newest selection wins over an older queued microtask.
 */
export function bindNativeRedteamTeamEvents(ctx) {
  if (typeof ctx?.on !== "function") return () => {};
  const successful = new WeakSet();
  const generations = new WeakMap();
  const offs = [];
  const ensure = (session, check) => ensureNativeRedteamTeam(session, check, successful);

  offs.push(ctx.on("agent/created", ({ agent } = {}) => {
    if (agent?.session) ensure(agent.session);
  }, { global: true, prepend: true }));

  offs.push(ctx.on("session/event", (session, event) => {
    if (!session || event?.type !== "agent-preset/selected") return;
    const sequence = (generations.get(session) || 0) + 1;
    generations.set(session, sequence);
    const preset = event.data?.agentPreset ?? event.data?.preset ?? event.data?.name;
    if (!isRedteamPresetId(preset) || !isRoot(session)) return;
    // session.append cannot be nested inside its own session/event notification.
    queueMicrotask(() => {
      if (generations.get(session) !== sequence) return;
      ensure(session, () => true);
    });
  }, { global: true }));

  offs.push(ctx.on("agent/pre-step", async ({ agent } = {}, next) => {
    if (agent?.session) ensure(agent.session);
    return typeof next === "function" ? next() : undefined;
  }, { global: true, prepend: true }));

  return () => {
    for (const off of offs) if (typeof off === "function") off();
  };
}

/**
 * Official rc.2+ service uses isEnabled on the Agent Teams domain.
 * Subscribe to service availability instead of assuming missing==new host:
 * old experimental builds and installations without Teams get no new events.
 */
export function installNativeRedteamTeams(ctx, config = {}) {
  if (config.redteamTeamMode === false) return;
  const mount = scope => {
    if (!teamServiceOf(scope)) return;
    const off = bindNativeRedteamTeamEvents(scope);
    if (typeof scope.effect === "function") scope.effect(() => off, "dsh-purge: native redteam Team mode");
  };
  if (typeof ctx?.inject === "function") {
    ctx.inject(["agentTeams"], scope => mount(scope));
  } else if (teamServiceOf(ctx)) {
    mount(ctx);
  }
}
