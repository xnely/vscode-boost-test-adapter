import { ChildProcess, spawn } from 'child_process';
import parseDot = require('dotparser');
import { Graph, Node } from 'dotparser';
import { resolve } from 'path';
import { createInterface, ReadLine } from 'readline';
import * as vscode from "vscode";
import { TestEvent, TestInfo, TestSuiteEvent, TestSuiteInfo } from 'vscode-test-adapter-api';
import { assert } from 'console';
import * as logger from './logger';
import * as config from './config';

interface TestSession {
    readonly stdout: ReadLine;
    readonly stderr: ReadLine;
    readonly stopped: Promise<number>;
    readonly process: ChildProcess;
}

class LabelInfo {
    constructor(
        public name: string,
        public file: string,
        public line: number) { }
}

function parseLabel(node: Node): LabelInfo {
    const label = node.attr_list.find(a => a.id === 'label');

    if (!label) {
        throw new Error('Node does not have a "label" attribute');
    }

    const match = /^(\w+)\|(.+)\((\d+)\)$/.exec(label.eq);

    if (!match) {
        throw new Error(`Failed to extract label "${label.eq}"`);
    }

    return <LabelInfo>{
        name: match[1],
        file: match[2],
        line: parseInt(match[3])
    };
}

export class BinaryError extends Error {
    constructor(readonly cause: any, testExePath: string, cwd?: string) {
        super(`Cannot execute ${testExePath} (cwd is ${cwd}).`);
    }
}

class TreeNode {
    constructor(
        public parent: TreeNode | null,
        public node: Node,
        public children: Array<TreeNode>) {
    }

    nodeId(): string {
        return this.node.node_id.id;
    }

    isRoot(): boolean {
        return this.parent === null;
    }

    createTestInfo(
        rootId: string,
        rootInfo: LabelInfo,
        parentTestId: string,
        sourcePrefix?: string): TestSuiteInfo | TestInfo {

        let info: LabelInfo;

        let testId = "";
        if (parentTestId === "") {
            info = { ...rootInfo };
            testId = rootId;
        } else {
            info = parseLabel(this.node);
            testId = `${parentTestId}/${info.name}`;
        }

        if (this.children.length > 0) {
            let testSuiteInfo: TestSuiteInfo;
            if (testId === rootId) {
                // The root node is the executable file.
                testSuiteInfo = <TestSuiteInfo>{
                    type: 'suite',
                    id: rootId,
                    label: rootInfo.name,
                    file: rootInfo.file,
                    line: undefined,
                    children: []
                };
            } else {
                testSuiteInfo = <TestSuiteInfo>{
                    type: 'suite',
                    id: testId,
                    label: info.name,
                    file: sourcePrefix ? resolve(sourcePrefix, info.file) : info.file,
                    line: info!.line - 1, // we need to decrease line number by one otherwise codelen will not correct
                    children: []
                };
            }
            let childrenTestInfos: Array<TestSuiteInfo | TestInfo> = [];
            for (const child of this.children) {
                childrenTestInfos.push(child.createTestInfo(rootId, rootInfo, testId, sourcePrefix));
            }
            testSuiteInfo.children = childrenTestInfos;
            return testSuiteInfo;
        } else {
            return <TestInfo>{
                type: 'test',
                id: testId,
                label: info.name,
                file: sourcePrefix ? resolve(sourcePrefix, info.file) : info.file,
                line: info.line - 1
            };
        }
    }
}

class TreeBuilder {
    nodes: Array<TreeNode> = [];
    buildFrom(graph: Graph) {
        for (const child of graph.children) {
            switch (child.type) {
                case "node_stmt":
                    this.nodes.push(new TreeNode(null, child, []));
                    break;
                case "edge_stmt":
                    const fromNode = this.findTreeNode(child.edge_list[0].id);
                    const toNode = this.findTreeNode(child.edge_list[1].id);
                    if (toNode.isRoot()) {
                        // Remove toNode from nodes.
                        this.nodes = this.nodes.filter(n => n !== toNode);
                        // Add toNode under fromNode.
                        fromNode.children.push(toNode);
                    } else {
                        throw new Error(`Edge-to node is not root`);
                    }
                    break;
                case "subgraph":
                    this.buildFrom(child);
                    break;
            }
        }
    }

    createTestInfo(rootId: string, rootInfo: LabelInfo, sourcePrefix?: string): TestSuiteInfo {
        assert(this.nodes.length === 1);
        return this.nodes[0].createTestInfo(rootId, rootInfo, "", sourcePrefix) as TestSuiteInfo;
    }

    private findTreeNode(nodeId: string): TreeNode {
        for (const n of this.nodes) {
            const f = this.findTreeNodeIn(n, nodeId);
            if (f) {
                return f;
            }
        }
        throw new Error(`Cannot find node`);
    }

    private findTreeNodeIn(tn: TreeNode, nodeId: string): TreeNode | null {
        if (tn.nodeId() === nodeId) {
            return tn;
        }
        for (const child of tn.children) {
            const ctn = this.findTreeNodeIn(child, nodeId);
            if (ctn) {
                return ctn;
            }
        }
        return null;
    }
}

export class TestExecutable {
    absPath: string;
    runningTests: TestSession[] = [];
    constructor(
        readonly id: string,
        readonly workspaceFolder: vscode.WorkspaceFolder,
        readonly cfg: config.TestExe) {
        this.absPath = resolve(this.workspaceFolder.uri.fsPath, this.cfg.path);
    }

    async listTest(log: logger.MyLogger): Promise<TestSuiteInfo> {
        log.info(`Loading tests from ${this.cfg.path}`);

        // gather all output
        const session = this.run(['--color_output=no', '--list_content=DOT']);
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
        const parsed = parseDot(output);

        if (!parsed.length) {
            throw new Error(`Failed to parse list of test cases from ${this.cfg.path}`);
        }

        // extract module information
        const root = parsed[0];

        const rootInfo = new LabelInfo(
            this.cfg.path,
            this.absPath,
            0);
        const tree = new TreeBuilder();
        tree.buildFrom(root);
        let tests = tree.createTestInfo(this.id, rootInfo, this.cfg.sourcePrefix);
        return tests;
    }

    // Full test IDs have this format:
    // "test-exe-id/suite-1/suite-2/.../test-case"
    //
    // The Boost test ID has this format:
    // "suite-1/suite-2/.../test-case"
    //
    // We must remove the test-exe-id because that is
    // not part of the Boost test ID.
    private createBoostTestIdsFrom(testIds: string[]): string[] {
        const boostTestIds: string[] = [];
        for (const testId of testIds) {
            const separatorPos = testId.indexOf('/');
            if (separatorPos === -1) {
                continue;
            }
            const boostTestId = testId.substring(separatorPos + 1);
            if (boostTestId.length === 0) {
                continue;
            }
            boostTestIds.push(boostTestId);
        }
        return boostTestIds;
    }

    async runTests(
        ids: string[],
        progress: (e: TestSuiteEvent | TestEvent) => void,
        log: logger.MyLogger): Promise<void> {

        if (this.runningTests.length > 0) {
            log.warn(`Some tests are still running from ${this.cfg.path}`, true);
            return;
        }

        let session: TestSession;
        let error: string | undefined;

        if (ids.length === 0) {
            log.warn(`No test IDs were provided. Not running anything from ${this.cfg.path}`);
            return;
        }

        // spawn the test process
        const boostTestIds = this.createBoostTestIdsFrom(ids);
        const args = [
            '-l', 'test_suite',
            '--catch_system_errors=no',
            '--detect_memory_leaks=0',
            '--color_output=no'];
        if (boostTestIds.length > 0) {
            log.info(`Running the following tests from ${this.cfg.path}:`);
            for (const boostTestId of boostTestIds) {
                log.info(boostTestId);
            }
            session = this.run(args.concat(['-t', boostTestIds.join(':')]));
        } else {
            // If there are no valid boost test IDs then we run all the tests.
            log.info(`Running all tests from ${this.cfg.path}`);
            session = this.run(args);
        }

        // Tracks the current test ID based on the stdout output.
        let currentTestId = [this.id];

        log.show();
        log.info("----------------------------------------");

        const maxStdErrLines = 100;
        const stdError: string[] = [];
        session.stderr.on('line', line => {
            if (stdError.length < maxStdErrLines) {
                stdError.push(line);
            }
        });

        session.stdout.on('line', line => {
            let match: RegExpMatchArray | null;
            log.test(line);

            // case start
            match = /^(.+): Entering test case "(\w+)"$/.exec(line);

            if (match) {
                currentTestId.push(match[2]);
                progress({
                    type: 'test',
                    test: currentTestId.join('/'),
                    state: 'running'
                });
                return;
            }

            // case end
            match = /^(.+): Leaving test case "(\w+)"; testing time: (\d+)(\w+)$/.exec(line);

            if (match) {
                assert(currentTestId[-1] === match[2]);
                progress({
                    type: 'test',
                    test: currentTestId.join('/'),
                    state: error === undefined ? 'passed' : 'failed',
                    message: error
                });
                currentTestId.pop();
                error = undefined;
                return;
            }

            // case error
            match = /^(.+): error: in "([\w\/]+)": (.+)$/.exec(line);
            if (match) {
                error = match[3];
                return;
            }
            // case fatal error
            match = /^(.+): fatal error: in "([\w\/]+)": (.+)$/.exec(line);
            if (match) {
                error = match[3];
                return;
            }

            // suite start
            match = /^(.+): Entering test suite "(\w+)"$/.exec(line);

            if (match) {
                currentTestId.push(match[2]);

                progress({
                    type: 'suite',
                    suite: currentTestId.join('/'),
                    state: 'running'
                });
                return;
            }

            // suite end
            match = /^(.+): Leaving test suite "(\w+)"; testing time: (\d+)(\w+)$/.exec(line);

            if (match) {
                assert(currentTestId[-1] === match[2]);
                progress({
                    type: 'suite',
                    suite: currentTestId.join('/'),
                    state: 'completed'
                });
                currentTestId.pop();
                return;
            }
        });

        this.runningTests.push(session);

        // wait for process to exit
        const code = await session.stopped;
        log.info(`${this.cfg.path} exited with code ${code}`);
        if (code !== 0) {
            log.error(`${this.cfg.path} exited with code ${code}`, true);
            if (stdError.length > 0) {
                log.error(`First ${maxStdErrLines} lines of stderr:`);
                for (const err of stdError) {
                    log.error(err);
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

    async debugTests(ids: string[], log: logger.MyLogger): Promise<void> {
        if (typeof this.cfg.debugConfig !== 'string') {
            log.error(`Settings: debugConfig is not set for ${this.cfg.path}`, true);
            return;
        }

        let args = ['-l', 'all', '--catch_system_errors=no', '--detect_memory_leaks=0'];
        const boostTestIds = this.createBoostTestIdsFrom(ids);
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
        if (this.cfg.env instanceof Array) {
            debugConfiguration["environment"] = this.cfg.env;
        }
        await vscode.debug.startDebugging(undefined, debugConfiguration);
    }

    private run(args: string[]): TestSession {
        const options: Record<string, any> = {
            cwd: this.cfg.cwd
        };
        if (this.cfg.env instanceof Array) {
            // spawn() needs env as a plain object of (key, value) pairs.
            const env: Record<string, string> = {};
            for (const e of this.cfg.env) {
                env[e.name] = e.value;
            }
            options.env = env;
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
}
