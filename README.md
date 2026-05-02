# NodeToolbox

An enterprise-grade Node.js/Express proxy tool for Jira, ServiceNow, and GitHub.
Designed for secure, credential-free access from `toolbox.html` served on localhost.

---

## Quick Start (Distributed Zip)

1. Extract `nodetoolbox-vX.Y.Z.zip` to any folder on your machine.
2. Double-click **`Launch Toolbox.bat`** to start the server and open the browser.
3. Complete the `/setup` wizard on first launch to enter your credentials.

> **Requirement:** Node.js must be installed and available on your PATH.
> Download from [nodejs.org](https://nodejs.org).

## Optional: Create a Desktop Shortcut

After extracting, run this once from the extracted folder to create a machine-specific
`.lnk` shortcut you can move to your Desktop:

```
npm run create-launcher
```

---

## Developer Quickstart

```
git clone git@github.com:mikejsmith1985/NodeToolbox.git
cd NodeToolbox
npm install
npm start
```

Run tests:

```
npm test
```

Build a local release zip:

```
powershell -ExecutionPolicy Bypass -File scripts\local-release.ps1
```

---

## Environment Variables

See `.env.example` for all supported `TBX_*` configuration variables.
Credentials are stored in `toolbox-proxy.json` (never committed to source control).
