import * as vscode from 'vscode';
import * as logger from './logger';
import * as util from './util';
import * as testidutil from './testidutil';
import * as model from './model';
import { BoostTestAdapter } from './adapter';

export class AdapterManager {
    private adapters = new Map<string, BoostTestAdapter>();

    constructor(
        private readonly ctrl: vscode.TestController,
        private readonly log: logger.MyLogger) {
        this.createAdapters();
        vscode.workspace.onDidChangeWorkspaceFolders(this.onWorkspaceFoldersChanged);
    }

    dispose() {
        for (const [_, adapter] of this.adapters) {
            adapter.dispose();
        }
        this.adapters.clear();
    }

    private onWorkspaceFoldersChanged(e: vscode.WorkspaceFoldersChangeEvent) {
        for (const w of e.removed) {
            const adapterId = this.createAdapterId(w);
            if (this.adapters.has(adapterId)) {
                const adapter = this.adapters.get(adapterId)!;
                adapter.dispose();
                this.adapters.delete(adapterId);
            }
        }
        for (const w of e.added) {
            const adapterId = this.createAdapterId(w);
            if (!this.adapters.has(adapterId)) {
                this.adapters.set(adapterId, this.createAdapter(w));
            }
        }
    }

    private createAdapterId(workspaceFolder: vscode.WorkspaceFolder): string {
        return util.stringHash(workspaceFolder.uri.toString());
    }

    private createAdapters() {
        if (!vscode.workspace.workspaceFolders) {
            return;
        }
        for (const workspaceFolder of vscode.workspace.workspaceFolders) {
            const adapter = this.createAdapter(workspaceFolder);
            this.adapters.set(adapter.adapterId, adapter);
        }
    }

    private createAdapter(workspaceFolder: vscode.WorkspaceFolder): BoostTestAdapter {
        return new BoostTestAdapter(
            this.createAdapterId(workspaceFolder),
            this.ctrl,
            workspaceFolder,
            this.log);
    }

    async reloadTests(): Promise<void> {
        this.log.info("Reloading tests");
        for (const [_, adapter] of this.adapters) {
            await adapter.reload();
            this.ctrl.items.add(adapter.getTestItem());
        }
    }

    async resolveHandler(testItem: vscode.TestItem | undefined): Promise<void> {
        this.log.info(`Resolving test '${testItem?.id}'`);
        if (testItem === undefined) {
            await this.reloadTests();
        } else {
            const adapter = this.getAdapterOf(testItem);
            if (adapter === undefined) {
                this.log.bug(`Cannot find adapter for TestItem '${testItem.id}'`);
                return;
            }
            adapter.resolveTestExeTests(testItem);
        }
    }

    async runHandler(request: vscode.TestRunRequest, token: vscode.CancellationToken): Promise<void> {
        if (!request.profile) {
            return;
        }

        let included: vscode.TestItem[] = [];
        if (request.include === undefined) {
            // We must run all the tests if vscode.TestRunRequest.include is undefined.
            for (const [_, adapter] of this.adapters) {
                included.push(adapter.getTestItem());
            }
        } else {
            included = request.include.map(item => item);
        }
        included = this.keepOnlyAncestors(included);

        let excluded: vscode.TestItem[] = [];
        if (request.exclude !== undefined && request.exclude.length > 0) {
            excluded = request.exclude.map(item => item);
        }
        excluded = this.keepOnlyAncestors(excluded);

        let mergedItems: model.TestItem[] = included.map(item => new model.TestItem(item, false));
        mergedItems = mergedItems.concat(excluded.map(item => new model.TestItem(item, true)));

        const groupedItems = this.groupTestItemsByAdapter(mergedItems);
        if (request.profile.kind === vscode.TestRunProfileKind.Run) {
            token.onCancellationRequested(() => {
                for (const [_, adapter] of this.adapters) {
                    adapter.cancel();
                }
            });
            const run = this.ctrl.createTestRun(request);
            this.enqueueTestItems(run, included);
            for (const [adapterId, testItems] of groupedItems) {
                const adapter = this.adapters.get(adapterId);
                if (!adapter) {
                    this.log.bug(`Cannot find adapter with ID '${adapterId}'`);
                    continue;
                }
                await adapter.run(run, testItems);
            }
            run.end();
        } else if (request.profile.kind === vscode.TestRunProfileKind.Debug) {
            for (const [adapterId, testItems] of groupedItems) {
                const adapter = this.adapters.get(adapterId);
                if (!adapter) {
                    this.log.bug(`Cannot find adapter with ID '${adapterId}'`);
                    continue;
                }
                await adapter.debug(testItems);
            }
        }
    }

    async commandCopyBoostTestId(testItem: vscode.TestItem) {
        const boostTestId = testidutil.createBoostTestIdFrom(testItem.id);
        if (boostTestId !== undefined) {
            await vscode.env.clipboard.writeText(boostTestId);
        }
    }

    async commandCopyTestItemPath(testItem: vscode.TestItem, relative: boolean) {
        const path = testItem.uri?.fsPath;
        if (path === undefined) {
            this.log.bug(`TestItem URI is ${path}.`);
            return;
        }
        const adapter = this.getAdapterOf(testItem);
        if (adapter === undefined) {
            this.log.bug(`Cannot find adapter for TestItem '${testItem.id}'`);
            return;
        }
        const workspacePath = adapter.workspaceFolder.uri.fsPath;
        if (!path.startsWith(workspacePath)) {
            this.log.bug(`TestItem URI '${path}' should start with '${workspacePath}'`);
            return;
        }
        if (relative) {
            // +1 to skip the path separator (slash or backslash).
            const relativePath = path.substring(workspacePath.length + 1);
            await vscode.env.clipboard.writeText(relativePath);
        } else {
            await vscode.env.clipboard.writeText(path);
        }
    }

    // If both a descendant test item and its ancestor is included
    // then we remove the descendant and keep only the ancestor.
    // I.e. we run every test under the ancestor.
    private keepOnlyAncestors(testItems: vscode.TestItem[]): vscode.TestItem[] {
        const isAncestorOf = (a: vscode.TestItem, b: vscode.TestItem): boolean => {
            for (let n = b.parent; n !== undefined; n = n.parent) {
                if (n === a) {
                    return true;
                }
            }
            return false;
        };
        const isAncestorPresentOf = (testItem: vscode.TestItem): boolean => {
            return testItems.find(a => isAncestorOf(a, testItem)) !== undefined;
        };
        const onlyAncestors: vscode.TestItem[] = [];
        for (const testItem of testItems) {
            if (!isAncestorPresentOf(testItem)) {
                onlyAncestors.push(testItem);
            }
        }
        return onlyAncestors;
    }

    private enqueueTestItems(testRun: vscode.TestRun, testItems: vscode.TestItem[]) {
        for (const testItem of testItems) {
            this.enqueueTestItem(testRun, testItem);
        }
    }

    private enqueueTestItem(testRun: vscode.TestRun, testItem: vscode.TestItem) {
        testRun.enqueued(testItem);
        testItem.children.forEach((childTestItem) => {
            this.enqueueTestItem(testRun, childTestItem);
        });
    }

    private groupTestItemsByAdapter(testItems: model.TestItem[]): Map<string, model.TestItem[]> {
        const m = new Map<string, model.TestItem[]>();
        for (const testItem of testItems) {
            const adapterId = testidutil.getAdapterId(testItem.id());
            if (m.has(adapterId)) {
                m.get(adapterId)!.push(testItem);
            } else {
                m.set(adapterId, [testItem]);
            }
        }
        return m;
    }

    private getAdapterOf(testItem: vscode.TestItem): BoostTestAdapter | undefined {
        const adapterId = testidutil.getAdapterId(testItem.id);
        return this.adapters.get(adapterId);
    }
}
