// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import path from 'path';
import * as utils from './utils';
import { MultiStepInput, InputStep } from './multiStepInput';

// globalState key under which the last successfully used BSP path is stored, so
// it can be offered as a grayed-out default in future project-creation wizards.
const LAST_BSP_KEY = "lastBspPath";


// Validates a directory path setting. Returns an error string describing the
// problem, or null if the path is valid.
function checkPath(p: string | undefined, name: string): string | null {
	if (!p) {
		return `Path to ${name} installation must be provided`;
	}

	if (p.startsWith('~')) {
		p = path.join(os.homedir(), p.slice(1));
	}

	if (!path.isAbsolute(p)) {
		return `Path to ${name} installation must be absolute or relative to home directory`;
	}

	if (!fs.existsSync(p)) {
		return `Path to ${name} (${p}) installation does not exist`;
	}
	return null;
}

function checkToolInPath(toolNameOrPath: string, name: string): string | null {
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
				return null;
			}
		}
	}

	return `Path to tool ${name} must be either an absolute path, or an executable in PATH`;
}

// Validates a tool/executable path setting. Returns an error string describing
// the problem, or null if the tool is valid.
function checkTool(p: string | undefined, name: string): string | null {
	if (!p) {
		return `Path to ${name} installation must be provided`;
	}

	if (p.startsWith('~')) {
		p = path.join(os.homedir(), p.slice(1));
	}

	if (!path.isAbsolute(p)) {
		return checkToolInPath(p, name);
	}

	if (!fs.existsSync(p)) {
		return `Path to ${name} installation (${p}) does not exist`;
	}
	return null;
}

// Collects all configuration problems. An empty array means the configuration
// is complete and valid.
function configProblems(): string[] {
	const config = vscode.workspace.getConfiguration("efinixRiscvKit");
	const problems = [
		checkPath(config.get<string>('efinityPath'), "Efinity"),
		checkPath(config.get<string>('efinityToolchainPath'), "Efinity Toolchain"),
		checkTool(config.get<string>('openocdPath'), "Openocd"),
	];
	return problems.filter((p): p is string => p !== null);
}

// Shows an actionable error for the given configuration problems, offering a
// button that opens the VS Code settings GUI filtered to this extension.
async function promptConfigureSettings(problems: string[]) {
	const sel = await vscode.window.showErrorMessage(
		"Efinix RISC-V Kit: Efinity tool paths are not configured. " +
		"Configure them before creating a project.",
		{ modal: true, detail: problems.join("\n") },
		"Open Settings");
	if (sel === "Open Settings") {
		await vscode.commands.executeCommand("workbench.action.openSettings", "efinixRiscvKit");
	}
}

function validateProjectName(text: string) {
	return text && text.trim().length > 0 ? null : 'Project name cannot be empty';
}

// Validates that `bspPath` points at a genuine Efinix RISC-V (Sapphire SoC) BSP by
// checking for the directories and files the generated project's build system
// (resources/project_template_standalone/CMakeLists.txt + Makefile) references.
// Returning false rejects the path — the wizard's BSP step hard-blocks until this
// returns true.
async function isEfinixBSP(bspPath: vscode.Uri): Promise<boolean> {
	const requiredDirs = [
		["bsp", "efinix", "EfxSapphireSoc", "include"],  // headers (bsp.h, print.h) — distinctive signature
		["software", "standalone", "driver"],            // driver headers
	];
	const requiredFiles = [
		["software", "standalone", "common", "start.S"], // startup assembly
		["software", "standalone", "common", "trap.S"],  // trap handler assembly
	];

	for (const segments of requiredDirs) {
		if (!await utils.isDirectory(vscode.Uri.joinPath(bspPath, ...segments))) {
			return false;
		}
	}
	for (const segments of requiredFiles) {
		if (!await utils.uriExists(vscode.Uri.joinPath(bspPath, ...segments))) {
			return false;
		}
	}

	// The `openocd`/debug Make targets need at least one *.cfg in the openocd directory.
	const openocdDir = vscode.Uri.joinPath(bspPath, "bsp", "efinix", "EfxSapphireSoc", "openocd");
	if (!await utils.isDirectory(openocdDir)) {
		return false;
	}
	const entries = await vscode.workspace.fs.readDirectory(openocdDir);
	return entries.some(([name, type]) => type === vscode.FileType.File && name.endsWith(".cfg"));
}

interface TemplateSettings {
	prjName: string,
	bspPath: string,
	openocdPath: string,
	toolchainPath: string,
	efinityPath: string
}

// Normalizes a path to forward slashes so it is valid inside the generated
// JSON presets file and safe to embed in CMake strings on Windows.
function toCMakePath(p: string): string {
	return p.replace(/\\/g, "/");
}

async function copyTemplateFile(template_path: vscode.Uri, target_path: vscode.Uri, settings: TemplateSettings) {

	const replacement_map = new Map(
		[
			["__PROJECT_NAME__", settings.prjName],
			["__BSP_DIR__", toCMakePath(settings.bspPath)],
			["__OPENOCD_PATH__", toCMakePath(settings.openocdPath)],
			["__TOOLCHAIN_PATH__", toCMakePath(settings.toolchainPath)],
			["__EFINITY_PATH__", toCMakePath(settings.efinityPath)],

		]
	);


	const content = await vscode.workspace.fs.readFile(template_path);
	const orig_content = new TextDecoder().decode(content);
	// const orig_content = Buffer.from(content).toString();
	let content_str = orig_content;

	replacement_map.forEach((value, key, map) => {
		content_str = content_str.replaceAll(key, value);
	});

	if (content_str !== orig_content) {
		const encoded = new TextEncoder().encode(content_str);
		vscode.workspace.fs.writeFile(target_path, encoded);
	} else {
		vscode.workspace.fs.copy(template_path, target_path);
	}

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

function isFolderOpenAnywhere(target_folder: vscode.Uri): boolean {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	const targetStr = target_folder.toString();
	const targetStrSlashed = targetStr.endsWith('/') ? targetStr : `${targetStr}/`;
	return (workspaceFolders !== undefined) && workspaceFolders.some(folder => {
		const folderStr = folder.toString();
		const folderStrSlashed = targetStr.endsWith('/') ? folderStr : `${folderStr}/`;

		return targetStrSlashed === folderStrSlashed || targetStrSlashed.startsWith(folderStrSlashed);
	});
}

interface ProjectConfig {
	name: string;
	basePath: vscode.Uri;
	createNewDir: boolean;
	bspPath: vscode.Uri;
}

// Browse button shown in the path input steps; opens a native folder picker.
const browseButton: vscode.QuickInputButton = {
	iconPath: new vscode.ThemeIcon('folder-opened'),
	tooltip: "Browse…"
};

async function pickFolder(openLabel: string): Promise<string | undefined> {
	const picked = await vscode.window.showOpenDialog({
		canSelectFiles: false,
		canSelectFolders: true,
		canSelectMany: false,
		openLabel
	});
	return picked && picked.length > 0 ? picked[0].fsPath : undefined;
}

// Returns the directory containing the opened .code-workspace file, or undefined
// when the window isn't backed by a saved workspace file (single-folder window,
// no folder open, or an unsaved/untitled workspace).
function workspaceFileDir(): vscode.Uri | undefined {
	const wsFile = vscode.workspace.workspaceFile;
	if (wsFile && wsFile.scheme === 'file') {
		return vscode.Uri.joinPath(wsFile, '..');
	}
	return undefined;
}

// Resolves a user-entered path to an absolute Uri. Relative paths are resolved
// against `baseDir` (the .code-workspace directory) when one is available, so a
// workspace bundling several projects can be referenced with paths like
// './standalone/'.
function resolvePath(value: string, baseDir?: vscode.Uri): vscode.Uri {
	if (!path.isAbsolute(value) && baseDir) {
		return vscode.Uri.joinPath(baseDir, value);
	}
	return vscode.Uri.file(value);
}

async function validateExistingDir(value: string, baseDir?: vscode.Uri): Promise<string | undefined> {
	if (!value || value.trim().length === 0) {
		return "Directory cannot be empty";
	}
	if (!await utils.isDirectory(resolvePath(value, baseDir))) {
		return "Path does not exist or is not a directory";
	}
	return undefined;
}

// Runs the guided multi-step wizard, returning the collected configuration or
// undefined if the user cancelled at any step.
async function collectProjectConfig(lastBsp?: string): Promise<ProjectConfig | undefined> {
	const title = "Create Standalone Project";
	const totalSteps = 4;
	const state: Partial<ProjectConfig> = { createNewDir: true };

	// When opened from a .code-workspace file, default the base directory to that
	// file's folder and resolve relative paths against it.
	const wsDir = workspaceFileDir();

	const inputName: InputStep = async input => {
		state.name = await input.showInputBox({
			title, step: 1, totalSteps,
			value: state.name || '',
			prompt: "Project name",
			placeholder: "my-new-project",
			validate: async value => validateProjectName(value) || undefined,
		});
		return inputBasePath;
	};

	const inputBasePath: InputStep = async input => {
		const value = await input.showInputBox({
			title, step: 2, totalSteps,
			value: state.basePath ? state.basePath.fsPath : (wsDir?.fsPath ?? ''),
			prompt: "Project base directory",
			placeholder: "/path/to/projects",
			buttons: [browseButton],
			validate: value => validateExistingDir(value, wsDir),
			onButton: async () => pickFolder("Select Project Base Directory"),
		});
		state.basePath = resolvePath(value, wsDir);
		return pickCreateNewDir;
	};

	const pickCreateNewDir: InputStep = async input => {
		const base = state.basePath!.fsPath;
		const yesItem: vscode.QuickPickItem = {
			label: `Yes — create '${state.name}' subdirectory`,
			detail: path.join(base, state.name!),
		};
		const noItem: vscode.QuickPickItem = {
			label: "No — use the selected folder directly",
			detail: base,
		};
		const pick = await input.showQuickPick({
			title, step: 3, totalSteps,
			placeholder: "Create a new directory for the project?",
			items: [yesItem, noItem],
			activeItem: state.createNewDir === false ? noItem : yesItem,
		});
		state.createNewDir = pick === yesItem;
		return inputBspPath;
	};

	const inputBspPath: InputStep = async input => {
		// An empty field falls back to the last-used BSP (shown grayed out as the
		// placeholder), so a returning user can just press Enter to reuse it.
		const resolveBsp = (value: string) =>
			value.trim().length === 0 && lastBsp ? lastBsp : value;
		const value = await input.showInputBox({
			title, step: 4, totalSteps,
			value: state.bspPath ? state.bspPath.fsPath : '',
			prompt: "Efinix BSP directory",
			placeholder: lastBsp ?? "/path/to/efinix/bsp",
			buttons: [browseButton],
			validate: async value => {
				const target = resolveBsp(value);
				const dirError = await validateExistingDir(target, wsDir);
				if (dirError) {
					return dirError;
				}
				if (!await isEfinixBSP(resolvePath(target, wsDir))) {
					return "Not a valid Efinix BSP directory";
				}
				return undefined;
			},
			onButton: async () => pickFolder("Select Efinix BSP Directory"),
		});
		state.bspPath = resolvePath(resolveBsp(value), wsDir);
	};

	await MultiStepInput.run(inputName);

	if (!state.name || !state.basePath || !state.bspPath) {
		return undefined;
	}
	return {
		name: state.name,
		basePath: state.basePath,
		createNewDir: state.createNewDir ?? true,
		bspPath: state.bspPath,
	};
}

async function createProject(template_path: vscode.Uri, store: vscode.Memento) {
	const lastBsp = store.get<string>(LAST_BSP_KEY);
	const config = await collectProjectConfig(lastBsp);
	if (!config) {
		utils.showInfo("Project creation cancelled");
		return;
	}

	const realPrjPath = config.createNewDir
		? vscode.Uri.joinPath(config.basePath, config.name)
		: config.basePath;
	const realBspPath = config.bspPath;

	// Guard against clobbering an existing non-empty target directory.
	if (await utils.uriExists(realPrjPath) && !await utils.isEmptyDir(realPrjPath)) {
		const result = await vscode.window.showInformationMessage(
			`Directory '${realPrjPath.fsPath}' is not empty. Use it anyway?`,
			{ modal: true }, "Use Anyways", "Abort");
		if (result !== "Use Anyways") {
			utils.showInfo("Project creation cancelled");
			return;
		}
	}

	// All prompts succeeded. Copy template and replace placeholders
	const relative_bsp = path.relative(realPrjPath.fsPath, realBspPath.fsPath);
	const extConfig = vscode.workspace.getConfiguration("efinixRiscvKit");
	await copyTemplate(template_path, realPrjPath, {
		prjName: config.name,
		bspPath: relative_bsp,
		openocdPath: extConfig.get<string>('openocdPath') ?? "",
		toolchainPath: extConfig.get<string>('efinityToolchainPath') ?? "",
		efinityPath: extConfig.get<string>('efinityPath') ?? "",
	});

	// Remember the BSP so the next run can offer it as a grayed-out default.
	await store.update(LAST_BSP_KEY, config.bspPath.fsPath);

	if (!isFolderOpenAnywhere(realPrjPath)) {
		const shouldOpenFolder = await vscode.window.showInformationMessage("Open the project folder in this workspace?", { modal: true }, "Yes", "No");
		if (shouldOpenFolder === "Yes") {
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders || workspaceFolders.length === 0) {
				await vscode.commands.executeCommand("vscode.openFolder", realPrjPath);
			} else {
				vscode.workspace.updateWorkspaceFolders(
					workspaceFolders.length,
					null,
					{ uri: realPrjPath }
				);
			}
		}
	}

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
		const problems = configProblems();
		if (problems.length === 0) {
			utils.showInfo("Configuration complete!");
		} else {
			promptConfigureSettings(problems);
		}
	});
	const templateCmd = vscode.commands.registerCommand('efinix-vscode-ext.createStandaloneProject', async () => {
		const problems = configProblems();
		if (problems.length > 0) {
			await promptConfigureSettings(problems);
			return;
		}

		await createProject(vscode.Uri.joinPath(context.extensionUri, "resources", "project_template_standalone"), context.globalState);
	});

	context.subscriptions.push(validateCmd);
	context.subscriptions.push(templateCmd);
}

// This method is called when your extension is deactivated
export function deactivate() { }
