/**
 * The operations model behind the market's activity panel: one record per
 * mutating operation (install, update, uninstall), from the moment it is
 * queued until the user clears it.
 *
 * It exists because operation state used to live on the card that started it,
 * which disappears the moment the user paginates, searches, or switches tab —
 * taking any decision attached to it, such as a loader-id clash, along with
 * it. Records live here instead, keyed by their own id, so the card only has
 * to ask "is anything running for this url".
 *
 * Every function is pure so the queue, the aggregate counts, and the
 * three-way visual grouping can be tested without a host or a DOM.
 */
const BUCKETS = {
    queued: 'busy',
    running: 'busy',
    input: 'attention',
    failed: 'attention',
    done: 'ok',
    warned: 'ok',
};
/** Which of the three visual groups a state belongs to. */
export function bucketOf(state) {
    return BUCKETS[state];
}
/** Whether a record has stopped moving on its own. */
export function isSettled(record) {
    return record.state === 'done' || record.state === 'warned' || record.state === 'failed';
}
/** Whether a record is waiting on the user rather than on the host. */
export function needsUser(record) {
    return record.state === 'input';
}
/** Append a record. Ids are supplied by the caller so tests stay deterministic. */
export function enqueue(list, record) {
    return [...list, record];
}
/**
 * Apply changes to one record.
 * @returns a new list; unchanged (same contents) when no record matches.
 */
export function patch(list, id, changes) {
    return list.map(record => (record.id === id ? { ...record, ...changes } : record));
}
/** Drop one record outright — the panel's per-row dismiss. */
export function drop(list, id) {
    return list.filter(record => record.id !== id);
}
/**
 * Clear finished records, keeping anything still moving or still waiting on
 * the user. A record in `input` survives: the user has not answered it yet,
 * and clearing it would delete the only route back to that decision.
 */
export function clearSettled(list) {
    return list.filter(record => !isSettled(record));
}
/**
 * How many queued records sit ahead of this one. The panel shows it because
 * "queued" without a position reads as stuck; the host runs one mutation at a
 * time, so the order shown is the order that will run.
 * @returns the count ahead, or null when the record is not queued.
 */
export function queuePosition(list, id) {
    const queued = list.filter(record => record.state === 'queued');
    const index = queued.findIndex(record => record.id === id);
    return index < 0 ? null : index;
}
/**
 * Counts for the panel entry. The entry reports the batch, never one row:
 * one aggregate line beats seven notifications racing each other.
 */
export function summarize(list) {
    let running = 0;
    let queued = 0;
    let attention = 0;
    let settled = 0;
    for (const record of list) {
        if (record.state === 'running')
            running += 1;
        else if (record.state === 'queued')
            queued += 1;
        else if (needsUser(record))
            attention += 1;
        else
            settled += 1;
    }
    return {
        running,
        queued,
        attention,
        settled,
        total: running + queued + settled,
        progressed: settled + running,
    };
}
/**
 * Panel order: what needs the user first, then what is still moving, then
 * what is finished. Within a group the original order is kept so a queue
 * reads top-to-bottom in the order it will run.
 */
export function sortForPanel(list) {
    const rank = (record) => needsUser(record) ? 0 : isSettled(record) ? 2 : 1;
    return [...list]
        .map((record, index) => ({ record, index }))
        .sort((a, b) => rank(a.record) - rank(b.record) || a.index - b.index)
        .map(entry => entry.record);
}
/**
 * The record a plugin card should reflect, newest first. A card shows the
 * button state for an operation in flight and a terminal marker for one that
 * ended without installing — without that marker a rejected install leaves
 * the card looking untouched, and the obvious next move is to press Install
 * again.
 */
export function recordForUrl(list, url) {
    for (let index = list.length - 1; index >= 0; index -= 1) {
        const record = list[index];
        if (record.url === url)
            return record;
    }
    return null;
}
