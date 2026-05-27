# NodeToolbox Startup Guide (Silent Launcher)

Use this guide when you want to download NodeToolbox, extract it, and start it with the hidden VBScript launcher so no console window appears.

## Download

1. Open the latest NodeToolbox release.
2. Download the zip file named `nodetoolbox-vX.Y.Z-exe.zip`.
3. Save the zip to a location you can access easily, such as `Downloads`.

## Extract

1. Right-click the downloaded zip file.
2. Select **Extract All...**
3. Extract it to a permanent folder such as `C:\Tools\NodeToolbox`.
4. Open the extracted folder and confirm these files and folders are present:

```text
NodeToolbox\
  Launch Toolbox Silent.vbs
  Launch Toolbox.bat
  README.md
  current.txt
  versions\
    X.Y.Z\
      nodetoolbox.exe
```

## Start NodeToolbox with the silent launcher

1. Open the extracted `NodeToolbox` folder.
2. Double-click `Launch Toolbox Silent.vbs`.
3. Wait up to 30 seconds for NodeToolbox to start.
4. Your default browser should open automatically to `http://localhost:5555`.

## What the silent launcher does

- Starts `versions\X.Y.Z\nodetoolbox.exe` in the background with no visible console window.
- Uses `current.txt` to determine which installed version to launch.
- Opens NodeToolbox in your default browser after the local server is ready.

## Important notes

- Do **not** run NodeToolbox directly from inside the zip file. Always extract it first.
- Keep the extracted folder structure intact. The silent launcher depends on `current.txt` and the `versions` folder.
- A good permanent location is something simple like `C:\Tools\NodeToolbox` or your Desktop.

## Troubleshooting

### SmartScreen or antivirus warning

If Windows SmartScreen appears, select **More info** and then **Run anyway**.

### Browser does not open

1. Wait the full 30 seconds.
2. Open a browser manually and go to `http://localhost:5555`.
3. If it still does not load, close any existing NodeToolbox processes in Task Manager and try again.

### Launcher error about missing files

If the launcher says it cannot find NodeToolbox files, the zip was likely not extracted correctly. Re-extract the full `nodetoolbox-vX.Y.Z-exe.zip` package and try again.

### Launcher starts but NodeToolbox times out

Possible causes:

- Windows blocked `nodetoolbox.exe`
- Another app is already using port `5555`
- The extracted folder is missing `current.txt` or the `versions\X.Y.Z\nodetoolbox.exe` payload
