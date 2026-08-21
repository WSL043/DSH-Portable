/**
 * The activity entry and its panel: every install, update and uninstall the
 * user started, with the action each outcome calls for.
 *
 * The entry lives in the tab row rather than above the plugin grid, so
 * paginating, searching or switching tab cannot take a record — or a pending
 * decision — off screen. It reports the batch as one aggregate ("installing
 * 3 / 7") instead of one line per plugin.
 */
import type { ReactNode } from 'react';
import type { Translate } from './market-data.ts';
import type { OperationRecord } from './operations.ts';
/**
 * How the panel renders a plugin it only knows by package name: the catalog
 * (or the installed list) supplies the author and avatar a card would show.
 */
export type DescribePlugin = (name: string) => {
    title: string;
    author?: string | undefined;
    avatar?: ReactNode;
};
export interface OperationsPanelProps {
    t: Translate;
    /** Resolves a package name to the identity a card would show for it. */
    describe: DescribePlugin;
    records: readonly OperationRecord[];
    open: boolean;
    /** Owned by the parent: a card's "cannot install" marker raises the panel. */
    onOpenChange: (open: boolean) => void;
    /** True while a swap is running, which disables both clash outcomes. */
    replacing: boolean;
    /** Blocks the destructive outcome when pnpm is not usable yet. */
    envReady: boolean;
    onClearSettled: () => void;
    onCancel: (record: OperationRecord) => void;
    onDismiss: (record: OperationRecord) => void;
    onRefresh: () => void;
    /** Resolve a clash: keep what is installed, or uninstall it and retry. */
    onResolveConflict: (record: OperationRecord, choice: 'keep' | 'swap') => void;
    /** Retry an operation the host refused for a fixable reason. */
    onRetry?: ((record: OperationRecord) => void) | undefined;
}
export declare function OperationsPanel(props: OperationsPanelProps): any;
