# Push a Chrome App to a mobile device

This is a small, standalone, Node.js-powered tool that can bundle a Chrome App into a `.crx` file, and send it to the [Chrome App Developer Tool](https://github.com/MobileChromeApps/harness) running on a mobile device.

## Installation

    npm install -g cca-push

## Usage

- First, (install and) launch the Chrome ADT app on your device.
- Press the "Start listening" button in the app.
- Run `cca-push path/to/manifest.json <IP address>`
    - You can provide either the path to the `manifest.json` file, or its containing directory.

The app should launch on your device. You can push the app as many times as you like, even while the app is running, and it will re-launch with the new version.

## Getting a connection to your device

This is unfortunately troublesome. If you're on the same Wi-fi network, great! If not, you can use `adb` to set up a port forwarding between your desktop and an Android device, and then push to that local port.

## Future Improvements

- We hope in the future to have more sophisticated ways of locating and sending the CRX file to your device.

