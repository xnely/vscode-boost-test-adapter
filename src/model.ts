import * as vscode from 'vscode';
export class TestItem {
	constructor(
		private readonly testItem: vscode.TestItem,
		readonly isExcluded: boolean) {
	}
	id() {
		return this.testItem.id;
	}
}
