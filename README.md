# Boost.Test Adapter with debugging

* Extends original [boost test adapter](https://github.com/firoorg/vscode-boost-test-adapter) by firoorg, enabling debugging 

* Boost tests will appear in [Test Explorer](https://marketplace.visualstudio.com/items?itemName=hbenl.vscode-test-explorer)

![debugger](https://github.com/newdigate/vscode-boost-test-adapter/raw/master/debug.gif)

## Required Configurations

You need to configure `boost-test-adapter.testExecutable` to point to the path of your test executable.

## Features that not implemented yet
- When debugging a test, the red/green status of the test is not updated in the test explorer
- Cancel the test.
- Automatic configurations reloading.