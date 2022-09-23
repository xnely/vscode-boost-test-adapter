import * as vscode from 'vscode';
import * as logger from './logger';
import * as util from './util';
import * as testidutil from './testidutil';
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

    async loadTests(): Promise<void> {
        for (const [_, adapter] of this.adapters) {
            await adapter.load();
            this.ctrl.items.add(adapter.getTestItem());
        }
    }

    async runHandler(request: vscode.TestRunRequest, token: vscode.CancellationToken): Promise<void> {
        if (!request.profile) {
            return;
        }
        if (request.exclude !== undefined && request.exclude.length > 0) {
            this.log.error("Excluding (hiding) tests is not supported yet :(", true);
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
        const inc = this.groupTestItemsByAdapter(included);
        if (request.profile.kind === vscode.TestRunProfileKind.Run) {
            token.onCancellationRequested(() => {
                for (const [_, adapter] of this.adapters) {
                    adapter.cancel();
                }
            });
            const run = this.ctrl.createTestRun(request);
            for (const [adapterId, testItems] of inc) {
                const adapter = this.adapters.get(adapterId);
                if (!adapter) {
                    this.log.bug(`Cannot find adapter with ID '${adapterId}'`);
                    continue;
                }
                await adapter.run(run, testItems);
            }
            run.end();
        } else if (request.profile.kind === vscode.TestRunProfileKind.Debug) {
            for (const [adapterId, testItems] of inc) {
                const adapter = this.adapters.get(adapterId);
                if (!adapter) {
                    this.log.bug(`Cannot find adapter with ID '${adapterId}'`);
                    continue;
                }
                await adapter.debug(testItems);
            }
        }
    }

    private groupTestItemsByAdapter(testItems: vscode.TestItem[]): Map<string, vscode.TestItem[]> {
        const m = new Map<string, vscode.TestItem[]>();
        for (const testItem of testItems) {
            const adapterId = testidutil.getAdapterId(testItem.id);
            if (m.has(adapterId)) {
                m.get(adapterId)!.push(testItem);
            } else {
                m.set(adapterId, [testItem]);
            }
        }
        return m;
    }
}
