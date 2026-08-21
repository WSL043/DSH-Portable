/**
 * Self-restart: relaunch the exact DSH invocation that booted this host so
 * pending (non-hot) plugin changes take effect without the user leaving the
 * UI. Contributed in #14 by @ysyyhhh; ported onto the layered architecture.
 *
 * Safety model: the endpoint accepts only direct same-origin loopback
 * requests (no forwarding headers), refuses while a plugin operation runs,
 * and deployments under a supervisor (systemd/launchd/pm2) can disable the
 * whole feature with `allowRestart: false` — the supervisor owns restarts.
 */
import type { IncomingMessage } from 'node:http';
/** Self-restart is enabled by default and disabled only by an explicit false. */
export declare function restartAllowed(config: {
    allowRestart?: boolean;
}): boolean;
/**
 * The port this process is serving on, read off the request that asked for
 * the restart.
 *
 * The alternative is to parse it out of the launch argv, which is wrong for
 * every host that binds from config or an env var. The Host header is what
 * the browser actually reached us on, so it is the port the replacement has
 * to take over — and it is already validated against Origin by the guard
 * below before any of this runs.
 * @returns the port, or null when the header carries none (a default port).
 */
export declare function servingPort(request: Pick<IncomingMessage, 'headers'>): number | null;
/** Whether a process-control request came from this Web host on loopback. */
export declare function trustedRestartRequest(request: Pick<IncomingMessage, 'headers' | 'socket'>): boolean;
/**
 * Whether a download navigation may fetch a sensitive GET export.
 * Browsers do NOT send an Origin header on same-origin GET navigations
 * (`<a href="/..." download>`), so unlike process-control requests a missing
 * Origin is the NORMAL shape of a user-initiated download and must pass.
 * Keep the rest of the posture: loopback peer only, no proxy forwarding
 * headers, and — when an Origin IS present (fetch/CORS attempts) — it must
 * still match Host so a cross-origin page cannot read the export.
 */
export declare function trustedDownloadRequest(request: Pick<IncomingMessage, 'headers' | 'socket'>): boolean;
/** The exact boot invocation the detached restart helper replays. */
export declare function restartLaunch(): {
    file: string;
    args: string[];
    cwd: string;
    viaShell: boolean;
};
/**
 * Platform-correct spawn invocation for the replacement host (#40 by
 * @1123762794): on Windows a `detached` spawn maps to DETACHED_PROCESS — the
 * new host gets NO console, and every console child it later spawns (e.g.
 * DSH sandbox tool runners) pops a visible node window. Wrapping the launch
 * in `powershell -WindowStyle Hidden` gives the host a HIDDEN console that
 * children inherit instead. POSIX keeps the plain detached spawn.
 */
export declare function respawnInvocation(launch: {
    file: string;
    args: string[];
    viaShell: boolean;
}, platform?: NodeJS.Platform): {
    file: string;
    args: string[];
    viaShell: boolean;
    detached: boolean;
};
/** What scheduleRestart reports back to the caller for logging/response. */
export interface RestartResult {
    pid: number;
    helperPid: number | undefined;
    logOut: string;
    logErr: string;
}
/**
 * Source for the detached helper that outlives this process and brings the
 * replacement up.
 *
 * Extracted so the waiting can be tested by RUNNING it, which is the only
 * way this class of bug shows itself: every part of the old helper looked
 * right in isolation.
 *
 * What it fixes (#177, reported on Windows 11, reproducible every time): the
 * helper slept a flat 1500ms and spawned. The old process had exited, but
 * the listening socket had not been released yet, so the replacement died
 * instantly with EADDRINUSE — and the spawn was wrapped in `catch {}`, so
 * nothing was written anywhere. The user saw a restart button that did
 * nothing. The docstring above it even claimed the helper "waits for our
 * port to free up"; it never did.
 *
 * So: wait for the port to actually go quiet, then start, then CHECK that
 * something came up, and write a diagnosis when it did not. A restart that
 * fails must leave evidence — this one is invisible by construction, since
 * the process that would have logged it is the one that just exited.
 * @param port - the port the replacement must bind; when unknown, the helper
 *   falls back to the old fixed delay, which is better than nothing.
 */
export declare function restartHelperSource(spawned: {
    file: string;
    args: string[];
    viaShell: boolean;
    detached: boolean;
}, launch: {
    cwd: string;
}, logs: {
    out: string;
    err: string;
}, port: number | null): string;
/**
 * Relaunch this exact DSH entry after a detached handoff, then stop this
 * process. The helper outlives us (detached + unref), waits for our port to
 * be released before starting the replacement, and logs under tmpdir.
 * @param port - the port this process is serving on, so the helper can wait
 *   for it rather than guessing at a delay.
 */
export declare function scheduleRestart(port?: number | null): RestartResult;
