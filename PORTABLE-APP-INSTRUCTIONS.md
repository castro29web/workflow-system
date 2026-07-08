# Workflow System Portable Folder

This folder can be copied to another computer and run there.

## What It Can Do

- Runs the full customer sign-in, front desk, preparation, and TV queue app.
- Works from any browser on the computer running it.
- Works from other devices on the same office Wi-Fi/network.

## What It Cannot Do

- It cannot run from only a phone/tablet because the app needs a backend server.
- It cannot stay available if the computer running it is turned off.
- It is not public internet hosting. Use Render or another server host for that.

## Requirements

Install Node.js 20 or newer on the computer that will run the app:

https://nodejs.org

## Mac

1. Copy this folder to the Mac.
2. Double-click `start-mac.command`.
3. Keep the Terminal window open.
4. Open `http://localhost:3000` on that Mac.
5. Other office devices open `http://COMPUTER-IP:3000`.

If macOS blocks the file, right-click `start-mac.command`, choose `Open`, then confirm.

## Windows

1. Copy this folder to the Windows computer.
2. Double-click `start-windows.bat`.
3. Keep the Command Prompt window open.
4. Open `http://localhost:3000` on that computer.
5. Other office devices open `http://COMPUTER-IP:3000`.

## Data

Queue data is saved in:

```text
data/queue.json
```

To move current data to another computer, copy the `data` folder too. To start fresh, do not copy `data/queue.json`.

