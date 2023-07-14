import * as vscode from 'vscode';
import * as logger from './logger';
import * as util from './util';
import { resolve } from 'path';

// IMPORTANT: Use the same name in package.json!
export const BoosTestAdapterExtensionName = "boost-test-adapter-xnely";
export const BoosTestAdapterConfig = "boost-test-adapter-xnely";

export interface TestExe {
    path: string;
    label?: string;
    debugConfig?: string;
    envFile?: string;
    env?: Map<string, string>;
    cwd?: string;
    sourcePrefix?: string;
}

export interface TestConfig {
    testExes: TestExe[];
}

export async function getConfig(workspaceFolder: vscode.WorkspaceFolder, log: logger.MyLogger): Promise<TestConfig> {
    const emptyTestConfig: TestConfig = {
        testExes: []
    };
    const testConfig: TestConfig = {
        testExes: []
    };

    const cfg = vscode.workspace.getConfiguration(BoosTestAdapterConfig);

    const cfgTests = cfg.get<Record<string, any>[]>('tests');
    if (cfgTests === undefined) {
        log.warn(`Settings: No ${BoosTestAdapterConfig}.tests found.`);
        return emptyTestConfig;
    }
    if (cfgTests.length === 0) {
        log.info(`Settings: ${BoosTestAdapterConfig}.tests is empty.`);
        return emptyTestConfig;
    }

    for (const cfgTest of cfgTests) {
        if (!(cfgTest.testExecutables instanceof Array)) {
            log.error(`Settings: testExecutables must exist and it must be an array`, true);
            return emptyTestConfig;
        }

        for (const cfgTestExe of cfgTest.testExecutables) {
            if (typeof cfgTestExe.path !== 'string') {
                log.error(`Settings: Test executable path must be a string`, true);
                return emptyTestConfig;
            }
            const testExe: TestExe = {
                path: util.detokenizeVariables(cfgTestExe.path)
            };

            if (cfgTestExe.label !== undefined) {
                if (typeof cfgTestExe.label !== 'string') {
                    log.error(`Settings: Test executable label must be a string`, true);
                    return emptyTestConfig;
                }
                testExe.label = cfgTestExe.label;
            }

            if (cfgTest.debugConfig !== undefined) {
                if (typeof cfgTest.debugConfig !== 'string') {
                    log.error(`Settings: debugConfig must be a string`, true);
                    return emptyTestConfig;
                }
                testExe.debugConfig = cfgTest.debugConfig;
            }
            if (cfgTest.cwd !== undefined) {
                if (typeof cfgTest.cwd !== 'string') {
                    log.error(`Settings: cwd must be a string`);
                    return emptyTestConfig;
                }
                testExe.cwd = util.detokenizeVariables(cfgTest.cwd);
            }

            if (cfgTest.sourcePrefix !== undefined) {
                if (typeof cfgTest.sourcePrefix !== 'string') {
                    log.error(`Settings: sourcePrefix must be a string`, true);
                    return emptyTestConfig;
                }
                testExe.sourcePrefix = resolve(workspaceFolder.uri.fsPath, cfgTest.sourcePrefix);
            }

            if (cfgTest.envFile !== undefined) {
                if (typeof cfgTest.envFile !== 'string') {
                    log.error(`Settings: envFile must be a string`, true);
                    return emptyTestConfig;
                }
                testExe.envFile = util.detokenizeVariables(cfgTest.envFile);
            }

            if (cfgTest.env !== undefined) {
                if (!(cfgTest.env instanceof Array)) {
                    log.error(`Settings: env must be an array`, true);
                    return emptyTestConfig;
                }
                let testEnvMap = new Map<string, string>();
                for (const e of cfgTest.env) {
                    const cfgEnvvar = e as Record<string, any>;
                    if (typeof cfgEnvvar.name !== 'string') {
                        log.error(`Settings: Environment variable name must be a string`, true)
                        return emptyTestConfig;
                    }
                    if (typeof cfgEnvvar.value !== 'string') {
                        log.error(`Settings: Environment variable value must be a string`, true)
                        return emptyTestConfig;
                    }
                    testEnvMap.set(cfgEnvvar.name, cfgEnvvar.value);
                }
                testExe.env = testEnvMap;
            }

            testConfig.testExes.push(testExe);
        }
    }

    return testConfig;
}
