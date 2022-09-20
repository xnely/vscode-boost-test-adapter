import * as vscode from 'vscode';
import * as logger from './logger';
import * as util from './util';
import { resolve } from 'path';

export interface TestEnvvar {
    name: string;
    value: string;
}

export interface TestExe {
    path: string;
    debugConfig?: string;
    env?: TestEnvvar[];
    cwd?: string;
    sourcePrefix?: string;
}

export interface TestConfig {
    testExes: TestExe[];
}

export function getConfig(workspaceFolder: vscode.WorkspaceFolder, log: logger.MyLogger): TestConfig {
    const testConfig: TestConfig = {
        testExes: []
    };

    const cfg = vscode.workspace.getConfiguration('boost-test-adapter');

    if (!cfg.has('tests')) {
        log.warn(`No boost-test-adapter.tests found.`);
        return testConfig;
    }
    const cfgTests = cfg.get<Record<string, any>[]>('tests');
    if (!cfgTests) {
        return testConfig;
    }

    for (const cfgTest of cfgTests) {
        const testExe: TestExe = { path: "" };

        if (typeof cfgTest.testExecutable !== 'string') {
            log.error(`Settings: testExecutable must exist and it must be a string`);
            continue;
        }
        testExe.path = util.detokenizeVariables(cfgTest.testExecutable);

        if (typeof cfgTest.debugConfig !== 'undefined') {
            if (typeof cfgTest.debugConfig !== 'string') {
                log.error(`Settings: debugConfig must be a string`);
                continue;
            }
            testExe.debugConfig = cfgTest.debugConfig;
        }
        if (typeof cfgTest.cwd !== 'undefined') {
            if (typeof cfgTest.cwd !== 'string') {
                log.error(`Settings: cwd must be a string`);
                continue;
            }
            testExe.cwd = util.detokenizeVariables(cfgTest.cwd);
        }

        if (typeof cfgTest.sourcePrefix !== 'undefined') {
            if (typeof cfgTest.sourcePrefix !== 'string') {
                log.error(`Settings: sourcePrefix must be a string`);
                continue;
            }
            testExe.sourcePrefix = resolve(workspaceFolder.uri.fsPath, cfgTest.sourcePrefix);
        }

        if (typeof cfgTest.env !== 'undefined') {
            if (!(cfgTest.env instanceof Array)) {
                log.error(`Settings: env must be an array`);
                continue;
            }
            const testEnvs: TestEnvvar[] = [];
            for (const e of cfgTest.env) {
                const cfgEnvvar = e as Record<string, any>;
                if (typeof cfgEnvvar.name !== 'string') {
                    log.error(`Settings: Environment variable name must be a string`)
                    continue;
                }
                if (typeof cfgEnvvar.value !== 'string') {
                    log.error(`Settings: Environment variable value must be a string`)
                    continue;
                }
                testEnvs.push({ name: cfgEnvvar.name, value: cfgEnvvar.value });
            }
            testExe.env = testEnvs;
        }

        testConfig.testExes.push(testExe);
    }

    return testConfig;
}
