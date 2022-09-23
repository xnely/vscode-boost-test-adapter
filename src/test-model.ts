import * as vscode from 'vscode';

/**
 * Information about a test.
 */
export interface TestInfo {
	type: 'test';
	id: string;
	/** The label to be displayed by the Test Explorer for this test. */
	label: string;
	/** The description to be displayed next to the label. */
	description?: string;
	/** The tooltip text to be displayed by the Test Explorer when you hover over this test. */
	tooltip?: string;
	/**
	 * The file containing this test (if known).
	 * This can either be an absolute path (if it is a local file) or a URI.
	 * Note that this should never contain a `file://` URI.
	 */
	file?: string;
	/** The line within the specified file where the test definition starts (if known). */
	line?: number;
	/** Indicates whether this test will be skipped during test runs */
	skipped?: boolean;
	/** Set this to `false` if Test Explorer shouldn't offer debugging this test. */
	debuggable?: boolean;
	/** Set this to `true` if there was an error while loading the test */
	errored?: boolean;
	/**
	 * This message will be displayed by the Test Explorer when the user selects the test.
	 * It is usually used for information about why the test was set to errored.
	 */
	message?: string;
}

/**
 * Information about a test suite.
 */
export interface TestSuiteInfo {
	type: 'suite';
	id: string;
	/** The label to be displayed by the Test Explorer for this suite. */
	label: string;
	/** The description to be displayed next to the label. */
	description?: string;
	/** The tooltip text to be displayed by the Test Explorer when you hover over this suite. */
	tooltip?: string;
	/**
	 * The file containing this suite (if known).
	 * This can either be an absolute path (if it is a local file) or a URI.
	 * Note that this should never contain a `file://` URI.
	 */
	file?: string;
	/** The line within the specified file where the suite definition starts (if known). */
	line?: number;
	/** Set this to `false` if Test Explorer shouldn't offer debugging this suite. */
	debuggable?: boolean;
	children: (TestSuiteInfo | TestInfo)[];
	/** Set this to `true` if there was an error while loading the suite */
	errored?: boolean;
	/**
	 * This message will be displayed by the Test Explorer when the user selects the suite.
	 * It is usually used for information about why the suite was set to errored.
	 */
	message?: string;
}

/**
 * This event is sent by a Test Adapter when it starts loading the test definitions.
 */
export interface TestLoadStartedEvent {
	type: 'started';
}

/**
 * This event is sent by a Test Adapter when it finished loading the test definitions.
 */
export interface TestLoadFinishedEvent {
	type: 'finished';
	/** The test definitions that have just been loaded */
	testItem?: vscode.TestItem;
	/** If loading the tests failed, this should contain the reason for the failure */
	errorMessage?: string;
}
