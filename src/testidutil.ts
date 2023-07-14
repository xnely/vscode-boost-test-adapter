import * as model from './model';

//
// IMPORTANT!
// If you change the format of the IDs then make sure you update the regex for the
// boost-test-adapter-xnely.copyBoostTestId command in package.json.
//

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
export function createBoostTestIdFrom(testId: string): string | undefined {
	const idParts = getTestIdParts(testId);
	if (idParts.length < 3) {
		return;
	}
	const boostTestId = idParts.slice(2).join('/');
	if (boostTestId.length === 0) {
		return;
	}
	return boostTestId;
}

// Creates Boost test IDs for the given TestItems.
// It also adds the "!" prefix for excluded items.
export function createBoostTestIdsFrom(testItems: model.TestItem[]): string[] {
	const boostTestIds: string[] = [];
	for (const testItem of testItems) {
		const boostTestId = createBoostTestIdFrom(testItem.id());
		if (boostTestId === undefined) {
			continue;
		}
		if (testItem.isExcluded) {
			boostTestIds.push(`!${boostTestId}`);
		} else {
			boostTestIds.push(boostTestId);
		}
	}
	return boostTestIds;
}
