import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

if (process.platform !== 'win32') process.exit(0)
const root = resolve(import.meta.dirname, '..')
const source = join(root, 'native/windows-installation/src/installation_integrity.cpp')
const output = join(root, 'apps/desktop/resources/installer/eleckoi-installation.exe')
const vswhere = join(process.env['ProgramFiles(x86)'] ?? '', 'Microsoft Visual Studio/Installer/vswhere.exe')
if (!existsSync(vswhere)) throw new Error('未找到 Visual Studio Build Tools，无法构建安装完整性检查。')
const discovery = spawnSync(vswhere, ['-latest', '-products', '*', '-requires',
  'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8' })
if (discovery.status !== 0 || !discovery.stdout.trim()) throw new Error('未找到 MSVC x64 工具链。')
const temporary = mkdtempSync(join(tmpdir(), 'eleckoi-installation-build-'))
const quote = value => `"${value.replaceAll('"', '""')}"`
mkdirSync(dirname(output), { recursive: true })
const command = ['cl.exe', '/nologo', '/std:c++17', '/MT', '/O2', '/W4', '/WX', '/EHsc',
  '/DUNICODE', '/D_UNICODE', `/Fo${quote(join(temporary, 'integrity.obj'))}`,
  `/Fe:${quote(output)}`, quote(source), '/link', '/NOLOGO', '/INCREMENTAL:NO', 'advapi32.lib'].join(' ')
const batch = join(temporary, 'build.cmd')
writeFileSync(batch, `@echo off\r\ncall ${quote(join(discovery.stdout.trim(), 'Common7/Tools/VsDevCmd.bat'))} -arch=x64 -host_arch=x64\r\nif errorlevel 1 exit /b %errorlevel%\r\n${command}\r\n`)
try {
  const result = spawnSync('cmd.exe', ['/d', '/c', batch], { cwd: root, stdio: 'inherit', windowsHide: true })
  if (result.status !== 0) process.exitCode = result.status ?? 1
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
