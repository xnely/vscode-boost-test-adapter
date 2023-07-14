import parseDot = require('dotparser');
import * as vscode from "vscode";
import { Graph, Node } from 'dotparser';
import * as testidutil from './testidutil';
import { resolve } from 'path';

export function createTestExeTestItem(
    testExePath: string,
    testItemId: string,
    sourcePrefix: string | undefined,
    graphs: parseDot.Graph[],
    ctrl: vscode.TestController): vscode.TestItem {
    // extract module information
    const root = graphs[0];

    const testExeLabel = new LabelInfo(
        "", // Will be filled by createTestItem() with the Boost Test Module name.
        testExePath,
        -1 // The line number is not relevant for the root item.
    );
    const tree = new TreeBuilder();
    tree.buildFrom(root);
    return tree.createTestItem(ctrl, testItemId, testExeLabel, sourcePrefix);
}

class LabelInfo {
    constructor(
        public name: string,
        public file: string,
        public line: number) { }
}

function parseTestModuleLabel(node: Node): string {
    const label = node.attr_list.find(a => a.id === 'label');
    if (!label) {
        throw new Error('Node does not have a "label" attribute');
    }
    return label.eq;
}

// Node labels are of this form:
//
//  a) node_name|file_path(line_number)
//  b) node_name|file_path(line_number)|some_other_stuff
//
const regexLabelWith2Parts = /^([a-zA-Z0-9_<> ]+)\|(.+)\((\d+)\)$/;
const regexLabelWith3Parts = /^([a-zA-Z0-9_<> ]+)\|(.+)\((\d+)\)\|.+$/;

function parseLabel(node: Node): LabelInfo {
    const label = node.attr_list.find(a => a.id === 'label');

    if (!label) {
        throw new Error('Node does not have a "label" attribute');
    }

    let match = regexLabelWith2Parts.exec(label.eq);
    if (!match) {
        match = regexLabelWith3Parts.exec(label.eq);
        if (!match) {
            throw new Error(`Failed to extract label "${label.eq}"`);
        }
    }

    return <LabelInfo>{
        name: match[1],
        file: match[2],
        line: parseInt(match[3])
    };
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

    createTestItem(
        ctrl: vscode.TestController,
        testExeTestItemId: string,
        testExeLabel: LabelInfo,
        parentTestId: string,
        sourcePrefix?: string): vscode.TestItem {

        let labelInfo: LabelInfo;

        let testId = "";
        if (parentTestId === "") {
            labelInfo = { ...testExeLabel };
            labelInfo.name = parseTestModuleLabel(this.node);
            testId = testExeTestItemId;
        } else {
            labelInfo = parseLabel(this.node);
            testId = testidutil.createChildTestId(parentTestId, labelInfo.name);
        }

        if (this.children.length > 0) {
            let testItem: vscode.TestItem;
            if (testId === testExeTestItemId) {
                // The root node is the executable file (i.e. the test module).
                testItem = ctrl.createTestItem(testId, labelInfo.name, vscode.Uri.file(labelInfo.file));
            } else {
                // This is a Boost Test Suite.
                testItem = ctrl.createTestItem(
                    testId, labelInfo.name,
                    vscode.Uri.file(sourcePrefix ? resolve(sourcePrefix, labelInfo.file) : labelInfo.file));
                testItem.range = new vscode.Range(labelInfo.line - 1, 0, labelInfo.line - 1, 0);
            }
            for (const child of this.children) {
                testItem.children.add(child.createTestItem(ctrl, testExeTestItemId, testExeLabel, testId, sourcePrefix));
            }
            return testItem;
        } else {
            // This is a Boost Test Case.
            const testItem = ctrl.createTestItem(testId, labelInfo.name,
                vscode.Uri.file(sourcePrefix ? resolve(sourcePrefix, labelInfo.file) : labelInfo.file));
            testItem.range = new vscode.Range(labelInfo.line - 1, 0, labelInfo.line - 1, 0);
            return testItem;
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

    createTestItem(
        ctrl: vscode.TestController,
        testExeId: string,
        testExeLabel: LabelInfo,
        sourcePrefix?: string): vscode.TestItem {
        if (this.nodes.length !== 1) {
            throw new Error(`Test graph error. Exactly one root node was expected but found ${this.nodes.length}.`);
        }
        return this.nodes[0].createTestItem(ctrl, testExeId, testExeLabel, "", sourcePrefix);
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
