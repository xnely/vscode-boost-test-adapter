import { Mutex } from 'async-mutex';
import * as vscode from "vscode";
import * as logger from './logger';
import { TestExecutable } from './test-executable';
import * as config from './config';
import * as testidutil from './testidutil';
import * as util from './util';

export class BoostTestAdapter {
    private readonly mutex: Mutex = new Mutex();
    private readonly disposables: { dispose(): void }[] = [];
    private testExecutables: Map<string, TestExecutable> = new Map();
    private watchers: Map<string, vscode.FileSystemWatcher> = new Map();
    private testItem: vscode.TestItem;

    constructor(
        readonly adapterId: string,
        private readonly ctrl: vscode.TestController,
        private readonly workspaceFolder: vscode.WorkspaceFolder,
        private readonly log: logger.MyLogger) {

        log.info("Initializing adapter.");

        this.testItem = this.ctrl.createTestItem(
            this.adapterId,
            this.workspaceFolder.name,
            this.workspaceFolder.uri);

        vscode.workspace.onDidChangeConfiguration(async event => {
            if (event.affectsConfiguration(config.BoosTestAdapterConfig)) {
                try {
                    this.log.info("Configuration changed. Reloading tests.")
                    await this.reload();
                } catch (err) {
                    console.warn(err)
                }
            }
        });
    }

    async reload(): Promise<void> {
        await this.updateSettings();
        await this.load();
    }

    private async updateSettings(): Promise<void> {
        const release = await this.mutex.acquire();
        try {
            await this.updateSettingsUnlocked();
        } finally {
            release();
        }
    }

    private async updateSettingsUnlocked(): Promise<void> {
        this.clearWatchers();
        this.testExecutables.clear();

        const cfg = await config.getConfig(this.workspaceFolder, this.log);

        for (const cfgTestExe of cfg.testExes) {
            const testExeTestItemId = this.createTestExeId(cfgTestExe.path);
            this.testExecutables.set(testExeTestItemId, new TestExecutable(
                testExeTestItemId,
                this.workspaceFolder,
                cfgTestExe,
                this.log));
        }
    }

    getTestItem(): vscode.TestItem {
        return this.testItem;
    }

    dispose() {
        this.cancel();
        this.clearWatchers();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables.length = 0;
    }

    async load(): Promise<void> {
        const release = await this.mutex.acquire();
        try {
            await this.loadUnlocked();
        } finally {
            release();
        }
    }

    async run(testRun: vscode.TestRun, testItems: vscode.TestItem[]): Promise<void> {
        const release = await this.mutex.acquire();
        try {
            await this.runUnlocked(testRun, testItems);
        } finally {
            release();
        }
    }

    async debug(testItems: vscode.TestItem[]): Promise<void> {
        const release = await this.mutex.acquire();
        try {
            await this.debugUnlocked(testItems);
        } finally {
            release();
        }
    }

    cancel() {
        for (const [_, testExecutable] of this.testExecutables) {
            testExecutable.cancelTests(this.log);
        }
    }

    private async loadUnlocked(): Promise<void> {
        this.clearWatchers();
        this.testItem.children.replace([]);

        if (this.testExecutables.size === 0) {
            await this.updateSettingsUnlocked();
            if (this.testExecutables.size === 0) {
                this.log.info('No valid test executables found. Cannot load tests.');
                return;
            }
        }

        for (const [_, testExecutable] of this.testExecutables) {
            await this.loadOneUnlocked(testExecutable);
        }
    }

    private async runUnlocked(testRun: vscode.TestRun, testItems: vscode.TestItem[]): Promise<void> {
        const resolvedItems = this.resolveAdapterItemsToTestExeItems(testItems);
        const m = this.groupTestItemsByTestExeId(resolvedItems);
        for (const [testExeId, testExeTestItems] of m) {
            const testExe = this.testExecutables.get(testExeId);
            if (!testExe) {
                this.log.bug(`Cannot find TestExecutable with ID '${testExeId}'.`);
                this.log.error("Could not run some of the tests!", true);
                continue;
            }
            try {
                await testExe.runTests(testRun, testExeTestItems);
            } catch (e) {
                this.log.exception(e, true);
            }
        }
    }

    private async debugUnlocked(testItems: vscode.TestItem[]): Promise<void> {
        const resolvedItems = this.resolveAdapterItemsToTestExeItems(testItems);
        const m = this.groupTestItemsByTestExeId(resolvedItems);
        if (m.size > 1) {
            this.log.error("Cannot debug multiple test executables at once", true);
            return;
        }

        const testExeId = testidutil.getTestExeId(resolvedItems[0].id);
        const testExecutable = this.testExecutables.get(testExeId)!;
        await testExecutable.debugTests(resolvedItems, this.log);
    }

    private async loadOne(testExecutable: TestExecutable): Promise<void> {
        const release = await this.mutex.acquire();
        try {
            await this.loadOneUnlocked(testExecutable);
        } finally {
            release();
        }
    }

    private async loadOneUnlocked(testExecutable: TestExecutable): Promise<void> {
        this.addTestExeWatcher(testExecutable);
        try {
            await testExecutable.loadTests(this.ctrl);
            this.testItem.children.add(testExecutable.getTestItem());
        } catch (e) {
            this.log.exception(e);
        }
    }

    private addTestExeWatcher(testExecutable: TestExecutable) {
        const key = testExecutable.testExeTestItemId;
        // start watching test binary
        if (this.watchers.has(key)) {
            return;

        }
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(this.workspaceFolder, testExecutable.cfg.path));

        try {
            const load = async (e: vscode.Uri) => {
                this.log.info(`Test executable has changed: ${testExecutable.cfg.path}`);
                if (e.fsPath !== testExecutable.absPath) {
                    this.log.warn(`Paths don't match: ${e.fsPath} should be ${testExecutable.absPath}`);
                    return;
                }
                try {
                    await this.loadOne(testExecutable);
                } catch (e) {
                    this.log.exception(e);
                }
            };

            watcher.onDidChange(load);
            watcher.onDidCreate(load);
            watcher.onDidDelete(load);
            this.watchers.set(key, watcher);
        } catch (e) {
            this.log.exception(e);
            watcher.dispose();
        }
    }

    private clearWatchers() {
        for (const [_, watcher] of this.watchers) {
            watcher.dispose();
        }
        this.watchers.clear();
    }

    private createTestExeId(testExePath: string): string {
        return testidutil.createChildTestId(
            this.adapterId,
            util.stringHash(testExePath));
    }

    // If the adapter ID is present among the test IDs then
    // include all of the test-exe-ids into the list.
    // I.e. we want to include every test executable.
    private resolveAdapterItemsToTestExeItems(testItems: vscode.TestItem[]): vscode.TestItem[] {
        const resolvedTestItems: vscode.TestItem[] = [];
        for (const testItem of testItems) {
            if (testItem.id === this.adapterId) {
                for (const [_, testExe] of this.testExecutables) {
                    if (!testExe.testItem) {
                        this.log.bug(`testExe.testItem is undefined for ${testExe.cfg.path}`);
                        continue;
                    }
                    resolvedTestItems.push(testExe.testItem);
                }
            } else {
                resolvedTestItems.push(testItem);
            }
        }
        return resolvedTestItems;
    }

    // Groups the test IDs by their test-exe-id component.
    // The test IDs have this format:
    // "test-exe-id/suite-1/suite-2/.../test-case"
    private groupTestItemsByTestExeId(testItems: vscode.TestItem[]): Map<string, vscode.TestItem[]> {
        const m: Map<string, vscode.TestItem[]> = new Map();
        for (const testItem of testItems) {
            const testExeId = testidutil.getTestExeId(testItem.id);
            if (m.has(testExeId)) {
                m.get(testExeId)!.push(testItem);
            } else {
                m.set(testExeId, [testItem]);
            }
        }
        return m;
    }
}
