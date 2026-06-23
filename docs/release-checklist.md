# Release Checklist

1. Confirm `config.json`, `asset_state.json`, `tag_state.json`, `downloads/`, `build/`, and `dist/` are not staged.
2. Run:

```powershell
.\scripts\build-exe.ps1
```

3. Test:

```powershell
.\dist\BoothImportManager.exe
```

4. In Unity, import or copy:

```text
unity_package/BoothImportManager
```

5. Create a GitHub Release and upload:

```text
dist/BoothImportManager.exe
```

6. Mention Chrome extension setup in the release note.
