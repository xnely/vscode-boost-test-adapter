import * as vscode from 'vscode';

export function createChildTestId(parentId: string, childId: string) {
	return `${parentId}/${childId}`;
}

export function createTestIdFromParts(idParts: string[]) {
	return idParts.join('/');
}

export function getTestIdParts(testId: string): string[] {
	return testId.split('/');
}

export function getAdapterId(testId: string): string {
	const idParts = getTestIdParts(testId);
	return idParts[0];
}

export function getTestExeId(testId: string): string {
	const idParts = getTestIdParts(testId);
	return createChildTestId(idParts[0], idParts[1]);
}

// Full test IDs have this format:
// "adapter-id/test-exe-id/suite-1/suite-2/.../test-case"
//
// The Boost test ID has this format:
// "suite-1/suite-2/.../test-case"
//
// We must remove the test-exe-id because that is
// not part of the Boost test ID.
export function createBoostTestIdsFrom(testItems: vscode.TestItem[]): string[] {
	const boostTestIds: string[] = [];
	for (const testItem of testItems) {
		const testId = testItem.id;
		const idParts = getTestIdParts(testId);
		if (idParts.length < 3) {
			continue;
		}
		const boostTestId = idParts.slice(2).join('/');
		if (boostTestId.length === 0) {
			continue;
		}
		boostTestIds.push(boostTestId);
	}
	return boostTestIds;
}
