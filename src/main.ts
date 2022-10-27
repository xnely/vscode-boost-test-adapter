import * as vscode from 'vscode';
import * as logger from './logger';
import { AdapterManager } from './adapter-manager';
import * as config from './config';

let log: logger.MyLogger | undefined = undefined;

export async function activate(context: vscode.ExtensionContext) {
    if (log) {
        log.bug("The extension is already activated!");
        return;
    }
    log = new logger.MyLogger('Boost.Test Adapter');
    log.info("Extension activated.");

    const ctrl = vscode.tests.createTestController(`${config.BoosTestAdapterExtensionName}.test-controller`, 'Boost.Test');
    context.subscriptions.push(ctrl);

    const adapterManager = new AdapterManager(ctrl, log);
    context.subscriptions.push(adapterManager);

    await adapterManager.reloadTests();

    ctrl.refreshHandler = () => {
        return adapterManager.reloadTests();
    };

    ctrl.resolveHandler = (testItem) => {
        adapterManager.resolveHandler(testItem);
    };

    ctrl.createRunProfile(
        "Run Tests",
        vscode.TestRunProfileKind.Run,
        (request: vscode.TestRunRequest, token: vscode.CancellationToken) => {
            adapterManager.runHandler(request, token);
        },
        true);

    ctrl.createRunProfile(
        "Debug Tests",
        vscode.TestRunProfileKind.Debug,
        (request: vscode.TestRunRequest, token: vscode.CancellationToken) => {
            adapterManager.runHandler(request, token);
        },
        true);

    context.subscriptions.push(vscode.commands.registerCommand(
        `${config.BoosTestAdapterExtensionName}.copyTestItemPath`,
        (testItem: vscode.TestItem) => {
            adapterManager.commandCopyTestItemPath(testItem, false);
        }));

    context.subscriptions.push(vscode.commands.registerCommand(
        `${config.BoosTestAdapterExtensionName}.copyTestItemRelativePath`,
        (testItem: vscode.TestItem) => {
            adapterManager.commandCopyTestItemPath(testItem, true);
        }));

    context.subscriptions.push(vscode.commands.registerCommand(
        `${config.BoosTestAdapterExtensionName}.copyBoostTestId`,
        (testItem: vscode.TestItem) => {
            adapterManager.commandCopyBoostTestId(testItem);
        }));
}

export function deactivate() {
    if (log) {
        log.info("Deactivating extension.");
        log.dispose();
        log = undefined;
    }
}
