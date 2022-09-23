import * as vscode from 'vscode';
import * as logger from './logger';
import { AdapterManager } from './adapter-manager';

export async function activate(context: vscode.ExtensionContext) {
    const log = new logger.MyLogger('Boost.Test Adapter');
    context.subscriptions.push(log);
    log.info("Extension activated.");

    const ctrl = vscode.tests.createTestController('boost-test-controller-feher', 'Boost.Test');
    context.subscriptions.push(ctrl);

    const adapterManager = new AdapterManager(ctrl, log);
    context.subscriptions.push(adapterManager);

    await adapterManager.loadTests();

    ctrl.refreshHandler = () => {
        return adapterManager.loadTests();
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
}
