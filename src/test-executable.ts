import parseDot = require('dotparser');
import { ChildProcess, spawn } from 'child_process';
import { resolve } from 'path';
import { createInterface, ReadLine } from 'readline';
import * as vscode from "vscode";
import * as logger from './logger';
import * as config from './config';
import * as testidutil from './testidutil';
import * as treebuilder from './test-tree-builder';

const fs = require('fs');

interface TestSession {
    readonly stdout: ReadLine;
    readonly stderr: ReadLine;
    readonly stopped: Promise<number>;
    readonly process: ChildProcess;
}

export class BinaryError extends Error {
    constructor(readonly cause: any, testExePath: string, cwd?: string) {
        super(`Cannot execute ${testExePath} (cwd is ${cwd}).`);
    }
}

export class TestExecutable {
    absPath: string;
    runningTests: TestSession[] = [];
    testItem?: vscode.TestItem;
    constructor(
        readonly testExeTestItemId: string,
        readonly workspaceFolder: vscode.WorkspaceFolder,
        readonly cfg: config.TestExe,
        readonly log: logger.MyLogger) {
        this.absPath = resolve(this.workspaceFolder.uri.fsPath, this.cfg.path);
    }

    async loadTests(ctrl: vscode.TestController): Promise<void> {
        this.log.info(`Loading tests from ${this.cfg.path}`);

        // gather all output
        const session = await this.run(['--color_output=no', '--list_content=DOT']);
        let output = '';
        let exit: number;

        session.stderr.on('line', line => output += line);

        try {
            exit = await session.stopped;
        } catch (e) {
            throw new BinaryError(e, this.absPath, this.cfg.cwd);
        }

        if (exit !== 0) {
            throw new Error(`${this.cfg.path} exited with code ${exit}`);
        }

        // parse the output
        const graphs = parseDot(output);
        if (graphs.length === 0) {
            throw new Error(`Failed to parse list of test cases from ${this.cfg.path}`);
        }

        // extract test module information
        this.testItem = treebuilder.createTestExeTestItem(
            this.absPath,
            this.testExeTestItemId,
            this.cfg.sourcePrefix,
            graphs,
            ctrl);
    }

    getTestItem(): vscode.TestItem {
        if (!this.testItem) {
            throw Error(`TestItem is undefined for ${this.cfg.path}`);
        }
        return this.testItem;
    }

    async runTests(testRun: vscode.TestRun, testItems: vscode.TestItem[]): Promise<void> {

        if (this.runningTests.length > 0) {
            this.log.warn(`Some tests are still running from ${this.cfg.path}`, true);
            return;
        }

        let session: TestSession;
        let errors: vscode.TestMessage[] = [];

        if (testItems.length === 0) {
            this.log.warn(`No test IDs were provided. Not running anything from ${this.cfg.path}`);
            return;
        }

        // spawn the test process
        const boostTestIds = testidutil.createBoostTestIdsFrom(testItems);
        const args = [
            '-l', 'test_suite',
            '--catch_system_errors=no',
            '--detect_memory_leaks=0',
            '--color_output=no'];
        if (boostTestIds.length > 0) {
            this.log.info(`Running the following tests from ${this.cfg.path}:`);
            for (const boostTestId of boostTestIds) {
                this.log.info(boostTestId);
            }
            session = await this.run(args.concat(['-t', boostTestIds.join(':')]));
        } else {
            // If there are no valid boost test IDs then we run all the tests.
            this.log.info(`Running all tests from ${this.cfg.path}`);
            session = await this.run(args);
        }

        // Tracks the current test ID based on the stdout output.
        let currentTestIdParts = [this.testExeTestItemId];

        this.log.info("----------------------------------------");

        const maxStdErrLines = 100;
        const stdError: string[] = [];
        session.stderr.on('line', line => {
            if (stdError.length < maxStdErrLines) {
                stdError.push(line);
            }
        });

        const lastItem = (arr: string[]) => arr[arr.length - 1];

        const reportProgress = (testIdParts: string[], reporter: (testItem: vscode.TestItem) => void) => {
            const testItemId = testidutil.createTestIdFromParts(testIdParts);
            const testItem = this.lookupTestItemById(testItemId);
            if (!testItem) {
                this.log.bug(`Cannot find TestItem with ID ${testItemId}`);
            } else {
                reporter(testItem);
            }
        };

        session.stdout.on('line', line => {
            let match: RegExpMatchArray | null;
            this.log.test(line);
            testRun.appendOutput(line + "\r\n");

            // test case start
            match = /^(.+): Entering test case "(\w+)"$/.exec(line);
            if (match) {
                currentTestIdParts.push(match[2]);
                reportProgress(currentTestIdParts, (testItem) => {
                    testRun.started(testItem);
                });
                return;
            }

            // test case end
            match = /^(.+): Leaving test case "(\w+)"; testing time: (\d+)(\w+)$/.exec(line);
            if (match) {
                if (lastItem(currentTestIdParts) !== match[2]) {
                    this.log.bug(`When parsing test output: '${lastItem(currentTestIdParts)}' != '${match[2]}'`);
                }
                reportProgress(currentTestIdParts, (testItem) => {
                    if (errors.length === 0) {
                        testRun.passed(testItem);
                    } else {
                        testRun.failed(testItem, errors);
                    }
                });
                currentTestIdParts.pop();
                errors = [];
                return;
            }

            // test case error
            match = /^(.+)\(([0-9]+)\): error: in "([\w\/]+)": (.+)$/.exec(line);
            const handleErrorMatch = (m: RegExpMatchArray) => {
                const file = m[1];
                const lineStr = m[2];
                const lineNum = Number(lineStr) - 1;
                const msg = new vscode.TestMessage(m[4]);
                msg.location = new vscode.Location(
                    vscode.Uri.file(file),
                    new vscode.Position(lineNum, 0));
                errors.push(msg);
            }
            if (match) {
                handleErrorMatch(match);
                return;
            }

            // test case fatal error
            match = /^(.+)\(([0-9]+)\): fatal error: in "([\w\/]+)": (.+)$/.exec(line);
            if (match) {
                handleErrorMatch(match);
                return;
            }

            // test suite start
            match = /^(.+): Entering test suite "(\w+)"$/.exec(line);
            if (match) {
                currentTestIdParts.push(match[2]);
                reportProgress(currentTestIdParts, (testItem) => {
                    testRun.started(testItem);
                });
                return;
            }

            // suite end
            match = /^(.+): Leaving test suite "(\w+)"; testing time: (\d+)(\w+)$/.exec(line);

            if (match) {
                if (lastItem(currentTestIdParts) !== match[2]) {
                    this.log.bug(`When parsing test output: '${lastItem(currentTestIdParts)}' != '${match[2]}'`);
                }
                reportProgress(currentTestIdParts, (testItem) => {
                    testRun.passed(testItem);
                });
                currentTestIdParts.pop();
                return;
            }
        });

        this.runningTests.push(session);

        // wait for process to exit
        const code = await session.stopped;
        this.log.info(`${this.cfg.path} exited with code ${code}`);
        if (code !== 0) {
            this.log.error(`${this.cfg.path} exited with code ${code}`, true);
            if (stdError.length > 0) {
                this.log.error(`First ${maxStdErrLines} lines of stderr:`);
                for (const err of stdError) {
                    this.log.error(err);
                }
            }
        }

        this.runningTests = this.runningTests.filter(s => s !== session);

        return;
    }

    cancelTests(log: logger.MyLogger) {
        if (this.runningTests.length === 0) {
            return;
        }
        log.info(`Cancelling running tests of ${this.cfg.path}`);
        for (const session of this.runningTests) {
            session.process.kill();
        }
    }

    async debugTests(testItems: vscode.TestItem[], log: logger.MyLogger): Promise<void> {
        if (typeof this.cfg.debugConfig !== 'string') {
            log.error(`Settings: debugConfig is not set for ${this.cfg.path}`, true);
            return;
        }

        let args = ['-l', 'all', '--catch_system_errors=no', '--detect_memory_leaks=0'];
        const boostTestIds = testidutil.createBoostTestIdsFrom(testItems);
        // If there are no valid boost test IDs then we run all the tests.
        if (boostTestIds.length > 0) {
            args = args.concat(['-t', boostTestIds.join(':')]);
            log.info(`Debugging the following tests from ${this.cfg.path}:`);
            for (const boostTestId of boostTestIds) {
                log.info(boostTestId);
            }
        } else {
            log.info(`Debugging all tests from ${this.cfg.path}`);
        }

        const config = vscode.workspace.getConfiguration(
            'launch',
            this.workspaceFolder.uri
        );
        const configs = config.get<vscode.DebugConfiguration[]>('configurations');
        if (!configs) {
            log.error(`Cannot find any launch configurations. Please create one with the name '${this.cfg.debugConfig}'.`, true);
            return;
        }
        let debugConfiguration = configs.find(cfg => cfg.name === this.cfg.debugConfig);
        if (!debugConfiguration) {
            log.error(`Cannot find launch configuration '${this.cfg.debugConfig}' for ${this.cfg.path}.`, true);
            return;
        }

        debugConfiguration["program"] = this.absPath;
        debugConfiguration["args"] = args;
        debugConfiguration["outputCapture"] = "std";
        const envMap = await this.createFinalEnvMap();
        if (envMap !== undefined) {
            debugConfiguration["environment"] = createEnvForDebug(envMap);
        }

        await vscode.debug.startDebugging(undefined, debugConfiguration);
    }

    private async run(args: string[]): Promise<TestSession> {
        const options: Record<string, any> = {
            cwd: this.cfg.cwd
        };
        const envMap = await this.createFinalEnvMap();
        if (envMap !== undefined) {
            options.env = createEnvForSpawn(envMap);
        }
        const process = spawn(this.absPath, args, options);
        let stdout, stderr: ReadLine | undefined;

        try {
            const stopped = new Promise<number>((resolve, reject) => {
                process.on('error', reject);
                process.on('close', resolve);
            });

            stdout = createInterface({ input: process.stdout! });
            stderr = createInterface({ input: process.stderr! });

            return { stdout, stderr, stopped, process };
        } catch (e) {
            stdout?.close();
            stderr?.close();
            process.kill();
            throw e;
        }
    }

    private lookupTestItemById(testItemId: string): vscode.TestItem | undefined {
        if (!this.testItem) {
            this.log.bug(`Tests are not loaded yet for ${this.cfg.path}`);
            return undefined;
        }
        // First find the root of the tree.
        let root: vscode.TestItem = this.testItem;
        while (root.parent) {
            root = root.parent;
        }
        // Then look for the item starting from the root.
        const idParts = testidutil.getTestIdParts(testItemId);
        let item: vscode.TestItem | undefined = root;
        for (let level = 1; item && item.id !== testItemId; ++level) {
            const nextTestItemId = testidutil.createChildTestId(item.id, idParts[level]);
            item = item.children.get(nextTestItemId);
        }
        return item;
    }

    private async createFinalEnvMap(): Promise<Map<string, string> | undefined> {
        let map: Map<string, string> | undefined;
        if (this.cfg.envFile !== undefined) {
            map = await parseEnvFile(this.cfg.envFile, this.log);
        }
        if (this.cfg.env !== undefined) {
            if (map !== undefined) {
                for (const [name, val] of this.cfg.env) {
                    map.set(name, val);
                }
            } else {
                map = this.cfg.env;
            }
        }
        return map;
    }

}

async function parseEnvFile(
    filePath: string,
    log: logger.MyLogger): Promise<Map<string, string>> {
    let envMap = new Map<string, string>();
    try {
        const contents: string = await fs.promises.readFile(filePath, 'utf-8');
        contents.split(/\r?\n/).forEach((line) => {
            const trimmedLine = line.trim();
            if (trimmedLine.length > 0) {
                const eqPos = trimmedLine.indexOf('=');
                if (eqPos !== -1) {
                    const name = trimmedLine.substring(0, eqPos);
                    const value = trimmedLine.substring(eqPos + 1);
                    envMap.set(name, value);
                } else {
                    log.warn(`Settings: Bad line in envFile: '${trimmedLine}'`);
                }
            }
        });
    } catch (e) {
        log.exception(e);
    }
    return envMap;
}

function createEnvForDebug(envMap: Map<string, string>): { name: string, value: string }[] {
    let env: { name: string, value: string }[] = [];
    for (const [n, v] of envMap) {
        env.push({ name: n, value: v });
    }
    return env;
}

function createEnvForSpawn(envMap: Map<string, string>): Record<string, string> {
    // spawn() needs env as a plain object of (key, value) pairs.
    let env: Record<string, string> = {};
    for (const [n, v] of envMap) {
        env[n] = v;
    }
    return env;
}
