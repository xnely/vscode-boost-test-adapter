import * as vscode from 'vscode';
import * as logger from './logger';
import { AdapterManager } from './adapter-manager';

export async function activate(context: vscode.ExtensionContext) {
    const BoosTestAdapterExtensionName = "boost-test-adapter-feher";

    const log = new logger.MyLogger('Boost.Test Adapter');
    context.subscriptions.push(log);
    log.info("Extension activated.");

    const ctrl = vscode.tests.createTestController(`${BoosTestAdapterExtensionName}.test-controller`, 'Boost.Test');
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
        `${BoosTestAdapterExtensionName}.copyTestItemPath`,
        (testItem: vscode.TestItem) => {
            adapterManager.commandCopyTestItemPath(testItem, false);
        }));

    context.subscriptions.push(vscode.commands.registerCommand(
        `${BoosTestAdapterExtensionName}.copyTestItemRelativePath`,
        (testItem: vscode.TestItem) => {
            adapterManager.commandCopyTestItemPath(testItem, true);
        }));

    context.subscriptions.push(vscode.commands.registerCommand(
        `${BoosTestAdapterExtensionName}.copyBoostTestId`,
        (testItem: vscode.TestItem) => {
            adapterManager.commandCopyBoostTestId(testItem);
        }));
}
