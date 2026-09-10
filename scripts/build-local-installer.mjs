// Fallback installer build from electron-builder's Windows bundle; requires NSIS 3.
import { readdir, mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = resolve('release/win-unpacked');
await stat(resolve(root, 'Video Resizer.exe'));
const quote = s => s.replaceAll('$', '$$').replaceAll('"', '$\\"');
const files = [], dirs = [];
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = resolve(dir, e.name);
    if (e.isDirectory()) { await walk(p); dirs.push(relative(root, p).replaceAll('/', '\\')); }
    else files.push(relative(root, p).replaceAll('/', '\\'));
  }
}
await walk(root);
const output = resolve('release/Video-Resizer-Windows-Setup.exe');
const script = `Unicode true
!include "MUI2.nsh"
Name "Video Resizer"
OutFile "${quote(output)}"
InstallDir "$LOCALAPPDATA\\Programs\\Video Resizer"
RequestExecutionLevel user
SetCompressor /SOLID lzma
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
Section "Video Resizer"
 SetShellVarContext current
 SetOutPath "$INSTDIR"
 File /r "${quote(root)}/*"
 WriteUninstaller "$INSTDIR\\Uninstall.exe"
 CreateDirectory "$SMPROGRAMS\\Video Resizer"
 CreateShortCut "$SMPROGRAMS\\Video Resizer\\Video Resizer.lnk" "$INSTDIR\\Video Resizer.exe"
 CreateShortCut "$SMPROGRAMS\\Video Resizer\\Uninstall.lnk" "$INSTDIR\\Uninstall.exe"
 WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\VideoResizer" "DisplayName" "Video Resizer"
 WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\VideoResizer" "DisplayVersion" "1.0.0"
 WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\VideoResizer" "UninstallString" '$\\"$INSTDIR\\Uninstall.exe$\\"'
SectionEnd
Section "Uninstall"
 SetShellVarContext current
${files.map(f => ` Delete "$INSTDIR\\${quote(f)}"`).join('\n')}
${dirs.map(d => ` RMDir "$INSTDIR\\${quote(d)}"`).join('\n')}
 Delete "$INSTDIR\\Uninstall.exe"
 RMDir "$INSTDIR"
 Delete "$SMPROGRAMS\\Video Resizer\\Video Resizer.lnk"
 Delete "$SMPROGRAMS\\Video Resizer\\Uninstall.lnk"
 RMDir "$SMPROGRAMS\\Video Resizer"
 DeleteRegKey HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\VideoResizer"
SectionEnd
`;
const scriptPath = resolve('release/local-installer.nsi');
await mkdir(dirname(scriptPath), { recursive: true });
await writeFile(scriptPath, script);
const result = spawnSync(process.env.NSIS_BINARY || 'makensis', [scriptPath], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
