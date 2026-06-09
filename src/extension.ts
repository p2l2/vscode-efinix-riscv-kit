// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import path from 'path';
import * as utils from './utils';


function checkPath(p: string | undefined, name: string): boolean {
	if (!p) {
		utils.showError(`Path to ${name} installation must be provided`);
		return false;
	}

	if (p.startsWith('~')) {
		p = path.join(os.homedir(), p.slice(1));
	}

	if (!path.isAbsolute(p)) {
		utils.showError(`Path to ${name} installation must be absolute or relative to home directory`);
		return false;
	}

	if (!fs.existsSync(p)) {
		utils.showError(`Path to ${name} (${p}) installation does not exist`);
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

	utils.showError(`Path to tool ${name} must be either an absolute path, or an executable in PATH`);

	return false;

}

function checkTool(p: string | undefined, name: string): boolean {
	if (!p) {
		utils.showError(`Path to ${name} installation must be provided`);
		return false;
	}

	if (p.startsWith('~')) {
		p = path.join(os.homedir(), p.slice(1));
	}

	if (!path.isAbsolute(p)) {
		return checkToolInPath(p, name);
	}

	if (!fs.existsSync(p)) {
		utils.showError(`Path to ${name} installation (${p}) does not exist`);
		return false;
	}
	return true;
}

function checkConfig(): boolean {
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

function validateProjectName(text: string) {
	return text && text.trim().length > 0 ? null : 'Project name cannot be empty';
}

function isEfinixBSP(path: vscode.Uri): boolean {
	return true;
}

interface TemplateSettings {
	prjName: string
}

async function copyTemplateFile(template_path: vscode.Uri, target_path: vscode.Uri, settings: TemplateSettings) {
	vscode.workspace.fs.copy(template_path, target_path);
}


async function copyTemplateDir(template_path: vscode.Uri, target_path: vscode.Uri, settings: TemplateSettings) {
	const children = await vscode.workspace.fs.readDirectory(template_path);
	vscode.workspace.fs.createDirectory(target_path);
	children.forEach(item => {
		copyTemplate(vscode.Uri.joinPath(template_path, item[0]), vscode.Uri.joinPath(target_path, item[0]), settings);
	});
}

async function copyTemplate(template_path: vscode.Uri, target_path: vscode.Uri, settings: TemplateSettings) {
	const source_stat = await vscode.workspace.fs.stat(template_path);
	switch (source_stat.type) {
		case vscode.FileType.File:
			await copyTemplateFile(template_path, target_path, settings);
			break;
		case vscode.FileType.Directory:
			await copyTemplateDir(template_path, target_path, settings);
			break;
		default:
			console.log(`Warning: unhandled fileType ${source_stat.type} in template. Ignoring`);

	}
}

async function createProject(template_path: vscode.Uri) {
	const prjName = await vscode.window.showInputBox({
		prompt: "Project Name",
		placeHolder: "my-new-project",
		validateInput: validateProjectName
	});

	if (!prjName) {
		utils.showInfo("Project creation cancelled");
		return;
	}

	let realPrjPath;
	let realBspPath;

	while (!realPrjPath) {
		const prjPath = await vscode.window.showOpenDialog({
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
			openLabel: "select Project Base Directory",
		});

		if (!prjPath || prjPath.length === 0) {
			utils.showInfo("Project creation cancelled");
			return;
		}

		realPrjPath = prjPath[0];
		if (!utils.uriExists(realPrjPath)) {
			utils.showError("Selected directory does not exist, choose a different directory");
		}

		if (!utils.isEmptyDir(realPrjPath)) {
			const result = await vscode.window.showQuickPick(["Use Anyways", "Choose another Folder", "Abort"], { canPickMany: false, title: "Use non-empty directory?" });
		}
	}

	while (!realBspPath) {
		const bspPath = await vscode.window.showOpenDialog({
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
			openLabel: "select Efinix BSP Directory"
		});

		if (!bspPath || bspPath.length === 0) {
			utils.showInfo("Project creation cancelled");
			return;
		}

		realBspPath = bspPath[0];

		if (!isEfinixBSP(realBspPath)) {
			utils.showError("Not a valid Efinix BSP path, choose a different directory or cancel.");
		}
	}

	// All prompts succeeded. Copy template and replace placeholders

	await copyTemplate(template_path, realPrjPath, { prjName: prjName });
}


// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const validateCmd = vscode.commands.registerCommand('efinix-vscode-ext.validate', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		if (checkConfig()) {
			utils.showInfo("Efinix RISC-V Kit: Configuration complete!");
		}
	});
	const templateCmd = vscode.commands.registerCommand('efinix-vscode-ext.createStandaloneProject', async () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		if (!checkConfig()) {
			utils.showError("Errors encountered in Configuration. Project cannot be created!");
		}

		await createProject(vscode.Uri.joinPath(context.extensionUri, "resources", "project_template_standalone"));
	});

	context.subscriptions.push(validateCmd);
	context.subscriptions.push(templateCmd);
}

// This method is called when your extension is deactivated
export function deactivate() { }
