import * as vscode from 'vscode';
import { testExplorerExtensionId, TestHub } from 'vscode-test-adapter-api';
import { TestAdapterRegistrar } from 'vscode-test-adapter-util';
import { BoostTestAdapter } from './adapter';
import * as logger from './logger';

export async function activate(context: vscode.ExtensionContext) {
    // init adaptor logging
    //const ws = (vscode.workspace.workspaceFolders || [])[0];
    const log = new logger.MyLogger('Boost.Test Adapter');
    //const log = new Log('boost-test-adapter', ws, 'Boost.Test Explorer');

    context.subscriptions.push(log);

    // get the Test Explorer extension
    const testExplorer = vscode.extensions.getExtension<TestHub>(testExplorerExtensionId);

    if (testExplorer) {
        const testHub = testExplorer.exports;
        const registrar = new TestAdapterRegistrar(
            testHub,
            workspace => new BoostTestAdapter(workspace, log),
            undefined);

        context.subscriptions.push(registrar);
    }
}
