# Build

## Requirements

- Windows
- Python 3.12+
- PyInstaller
- Pillow

```powershell
python -m pip install pyinstaller pillow
```

## Build EXE

```powershell
.\scripts\build-exe.ps1
```

The executable is written to:

```text
dist/BoothImportManager.exe
```

For GitHub, upload the EXE through GitHub Releases instead of committing it to the repository.
