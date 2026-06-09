// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import path from 'path';

function showError(msg: string) {
	vscode.window.showErrorMessage(`Efinix RISC-V Kit: ${msg}`);
}

function showInfo(msg: string) {
	vscode.window.showInformationMessage(`Efinix RISC-V Kit: ${msg}`);
}

function checkPath(p: string | undefined, name: string) : boolean {
	if (!p) {
		showError(`Path to ${name} installation must be provided`);
		return false;
	}

	if (p.startsWith('~')) {
		p = path.join(os.homedir(), p.slice(1));
	}

	if (!path.isAbsolute(p)) {
		showError(`Path to ${name} installation must be absolute or relative to home directory`);
		return false;
	}

	if (!fs.existsSync(p)) {
		showError(`Path to ${name} (${p}) installation does not exist`);
		return false;
	}
	return true;
}

async function checkToolInPath(toolNameOrPath: string, name: string): boolean {
    // 2. If it's just a command name (e.g., 'git' or 'gcc'), look in system $PATH
    const pathEnv = process.env.PATH || '';
    // Windows uses semicolons (;), Posix (Mac/Linux) uses colons (:)
    const pathSeparator = process.platform === 'win32' ? ';' : ':';
    const directories = pathEnv.split(pathSeparator);

    // Determine extensions to check (Windows handles .exe, .cmd, etc.)
    const extensionsToCheck = process.platform === 'win32' 
        ? ['.exe', '.cmd', '.bat', ''] 
        : [''];

    for (const directory of directories) {
        for (const ext of extensionsToCheck) {
            const fullPath = path.join(directory, `${toolNameOrPath}${ext}`);
            if (fs.existsSync(fullPath)) {
				return true;
			}
        }
    }

	showError(`Path to tool ${name} must be either an absolute path, or an executable in PATH`);

	return false;

}

function checkTool(p: string | undefined, name: string) : boolean {
	if (!p) {
		showError(`Path to ${name} installation must be provided`);
		return false;
	}

	if (p.startsWith('~')) {
		p = path.join(os.homedir(), p.slice(1));
	}

	if (!path.isAbsolute(p)) {
		return checkToolInPath(p, name);
	}

	if (!fs.existsSync(p)) {
		showError(`Path to ${name} installation (${p}) does not exist`);
		return false;
	}
	return true;
}

function checkConfig() : boolean{
	let config = vscode.workspace.getConfiguration("efinixRiscvKit");
	if (!checkPath(config.get<string>('efinityPath'), "Efinity")) {
		return false;
	}
	if (!checkPath(config.get<string>('efinityToolchainPath'), "Efinity Toolchain")) {
		return false;
	}
	if (!checkTool(config.get<string>('openocdPath'), "Openocd")) {
		return false;
	}

	return true;
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('efinix-vscode-ext.validate', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		if(checkConfig()) {
			showInfo("Efinix RISC-V Kit: Configuration complete!");
		}
	});

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
