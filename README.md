# Boost.Test Adapter for Visual Studio Code
![debugger](debug.gif)

This is a test adapter for [Test Explorer](https://marketplace.visualstudio.com/items?itemName=hbenl.vscode-test-explorer) to work with Boot.Test.

I've adapted [firoorg's boost test adapter](https://github.com/firoorg/vscode-boost-test-adapter) to allow debugging

## Required Configurations

You need to configure `boost-test-adapter.testExecutable` to point to the path of your test executable.

## Features that not implemented yet

- Cancel the test.
- Automatic configurations reloading.
