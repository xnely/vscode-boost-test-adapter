# Boost.Test Adapter
This extension allows you to run your [Boost.Test](https://github.com/boostorg/test) tests
using the [Test Explorer UI](https://marketplace.visualstudio.com/items?itemName=hbenl.vscode-test-explorer).

This extension is based on code from these extensions:
- https://github.com/firoorg/vscode-boost-test-adapter
- https://github.com/newdigate/vscode-boost-test-adapter.git

## Features
* Tests will appear in the [Test Explorer UI](https://marketplace.visualstudio.com/items?itemName=hbenl.vscode-test-explorer)
* ```run``` or ```debug``` tests 
  * from ```Test Explorer UI``` 
  * from inside test source code
* Output
  * Diagnostic info appears in the `Boost.Test Adapter` Output channel.
  * Running test output appears in the `Boost.Test Adapter` Output channel.
  * Debugged test output appears in the corresponding Terminal panel.
* Update 3.0.0
  * Add support for deeply nested test suites (multiple levels of test suites)
  * Add support for multiple test executables
  * Add support for cancelling tests

## Configurations
```json
    "boost-test-adapter-feher.tests": [
        {
            // Mandatory: Path to a test executable. May be absolute or relative path.
            "testExecutable": "build\\Debug\\main_test_1.exe",
            // Optional: The working directory for the test executable.
            "cwd": "${workspaceFolder}",
            // Mandatory: The name of the launch configuration used for debugging.
            // The 'program' and 'args' options will be overwritten by this extension. 
            "debugConfig": "Test config",
            // Optional: Used to convert relative source file paths to absolute paths.
            // It's needed only if the test-case file paths are broken in the Test Explorer UI.
            "sourcePrefix": "${workspaceFolder}"
        },
        {
            "testExecutable": "build\\Debug\\main_test_2.exe",
            "cwd": "${workspaceFolder}",
            "debugConfig": "Test config"
        }
    ]

```

## Features that not implemented yet
- When debugging a test, the red/green status of the test is not updated in the test explorer
