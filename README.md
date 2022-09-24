# Boost.Test Adapter
This extension allows you to run your [Boost.Test](https://github.com/boostorg/test) tests
from the Testing sidebar of VS Code.

![debugger](https://github.com/feher/vscode-boost-test-adapter/raw/master/debug.gif)

This extension is based on code from these extensions:
- https://github.com/firoorg/vscode-boost-test-adapter
- https://github.com/newdigate/vscode-boost-test-adapter.git

## Features
* Tests will appear in the Testing sidebar of VS Code.
* ```run``` or ```debug``` tests 
  * from the ```Testing``` sidebar
  * from inside test source code
* Output
  * Test output appears in Test Explorer's `Test Output` Terminal.
  * During debugging the test output appears in the corresponding Terminal.
  * Diagnostic info appears in the `Boost.Test Adapter` Output channel.

## Changelog
* Update 3.2.0
  * Remove dependency on [Test Explorer UI](https://marketplace.visualstudio.com/items?itemName=hbenl.vscode-test-explorer)
    * Use the native Test Explorer of VS Code.
* Update 3.0.0
  * Add support for deeply nested test suites (multiple levels of test suites)
  * Add support for multiple test executables
  * Add support for cancelling tests

## Configurations
```json
    "boost-test-adapter-feher.tests": [
        {
            // Mandatory: Path to test executables. May be absolute or relative paths.
            "testExecutables": [
                "build/Debug/main_test_1",
                "build/Debug/main_test_2"
            ],

            // Optional: The working directory for the test executables.
            "cwd": "${workspaceFolder}",

            // Mandatory: The name of the launch configuration used for debugging.
            // The 'program' and 'args' options will be overwritten by this extension. 
            "debugConfig": "Test config",

            // Optional: A simple key=value file with environment variables for running and debugging the tests.
            "envFile": "${workspaceFolder}/.env",

            // Optional: Environment variables for running and debugging the tests.
            // These env vars are merged with the ones from envFile (if present).
            // These env vars take precedence over the ones from envFile.
            "env": [
              {
                "name": "MY_VAR",
                "value": "my var value"
              }
            ],

            // Optional: Used to convert relative source file paths to absolute paths.
            // It's needed only if the test-case file paths are broken in the Test Explorer UI.
            "sourcePrefix": "${workspaceFolder}"
        },
        {
            "testExecutables": [ "build/Debug/other_test_2" ],
            "cwd": "${workspaceFolder}",
            "debugConfig": "Test config"
        }
    ]

```

## FAQ
1. I don't see any tests in the Testing sidebar. Why?
   - Make sure you have configured your `settings.json` and `launch.json` properly.
     - Take a look at the `Boost.Test Adapter` Output channel for potential issues.
   - Press the reload button at the top of the Testing sidebar.
   - Restart VS Code.
2. Why is my test-root called "Hello World" (or some other nonsense) in the Testing sidebar?
   - That is the Boost test module name. It comes from your test executable.
     Usually from a line like this:
     ```
     #define BOOST_TEST_MODULE Hello World
     ``` 

## Features not implemented yet
- When debugging a test, the red/green status of the test is not updated in the UI.
