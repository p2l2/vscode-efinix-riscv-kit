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

// Marker file dropped into every created project so the extension can recognize
// its own projects on load (see `activate`).
const MARKER_FILE = ".efinix-riscv-kit";
// The machine-specific presets (absolute tool paths) — gitignored in generated
// projects. Alongside it we ship an unsubstituted `.template` so the file can be
// regenerated per-machine after a clone.
const USER_PRESETS_FILE = "CMakeUserPresets.json";
const USER_PRESETS_TEMPLATE_FILE = "CMakeUserPresets.json.template";


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

// If `selected` is not itself a BSP but sits inside one, returns the enclosing
// BSP root; otherwise undefined. Walks up to `maxLevels` parents so a user who
// picked a subfolder one or two levels too deep can be redirected. The deepest
// marker path (bsp/efinix/EfxSapphireSoc/include) is 4 segments, so 4 levels
// covers every realistic mis-selection.
async function findEnclosingBspRoot(selected: vscode.Uri, maxLevels = 4): Promise<vscode.Uri | undefined> {
	let current = selected;
	for (let i = 0; i < maxLevels; i++) {
		const parent = vscode.Uri.joinPath(current, "..");
		if (parent.fsPath === current.fsPath) {   // reached filesystem root
			break;
		}
		current = parent;
		if (await isEfinixBSP(current)) {
			return current;
		}
	}
	return undefined;
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

// Replaces the template placeholder tokens (__PROJECT_NAME__, __BSP_DIR__, …) in
// `content` with the concrete values from `settings`. Shared by the project-copy
// path and the on-load CMakeUserPresets regeneration path.
function substitutePlaceholders(content: string, settings: TemplateSettings): string {
	const replacement_map = new Map(
		[
			["__PROJECT_NAME__", settings.prjName],
			["__BSP_DIR__", toCMakePath(settings.bspPath)],
			["__OPENOCD_PATH__", toCMakePath(settings.openocdPath)],
			["__TOOLCHAIN_PATH__", toCMakePath(settings.toolchainPath)],
			["__EFINITY_PATH__", toCMakePath(settings.efinityPath)],
		]
	);

	let result = content;
	replacement_map.forEach((value, key) => {
		result = result.replaceAll(key, value);
	});
	return result;
}

async function copyTemplateFile(template_path: vscode.Uri, target_path: vscode.Uri, settings: TemplateSettings) {
	const content = await vscode.workspace.fs.readFile(template_path);
	const orig_content = new TextDecoder().decode(content);
	const content_str = substitutePlaceholders(orig_content, settings);

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

// Walks up from `p` until it finds a directory that actually exists, so a
// partially-typed or not-yet-created path still gives the folder picker a
// sensible starting point instead of falling back to the cwd. Returns undefined
// if nothing along the chain exists.
async function nearestExistingDir(p: string): Promise<string | undefined> {
	let current = path.resolve(p);
	for (;;) {
		if (await utils.isDirectory(vscode.Uri.file(current))) {
			return current;
		}
		const parent = path.dirname(current);
		if (parent === current) {   // reached filesystem root
			return undefined;
		}
		current = parent;
	}
}

async function pickFolder(openLabel: string, startPath?: string): Promise<string | undefined> {
	const existing = startPath ? await nearestExistingDir(startPath) : undefined;
	const picked = await vscode.window.showOpenDialog({
		canSelectFiles: false,
		canSelectFolders: true,
		canSelectMany: false,
		defaultUri: existing ? vscode.Uri.file(existing) : undefined,
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
			// Pre-fill the last-used BSP as a real, editable value (not just a
			// grayed-out placeholder) so a returning user can accept or tweak it.
			value: state.bspPath?.fsPath ?? lastBsp ?? '',
			prompt: "Efinix BSP directory",
			placeholder: lastBsp ?? "/path/to/efinix/bsp",
			buttons: [browseButton],
			validate: async value => {
				const target = resolveBsp(value);
				const dirError = await validateExistingDir(target, wsDir);
				if (dirError) {
					return dirError;
				}
				const resolved = resolvePath(target, wsDir);
				if (!await isEfinixBSP(resolved)) {
					const root = await findEnclosingBspRoot(resolved);
					if (root) {
						return "This is a subfolder of a BSP. Use this path instead: " + root.fsPath;
					}
					return "Not a valid Efinix BSP directory";
				}
				return undefined;
			},
			onButton: async (_button, currentValue) =>
				pickFolder("Select Efinix BSP Directory", currentValue || lastBsp),
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

// Writes the project marker file identifying `projectDir` as an Efinix RISC-V Kit
// project. Committed (not gitignored) so freshly cloned projects are recognized.
async function writeMarkerFile(projectDir: vscode.Uri, version: string) {
	const marker = {
		type: "standalone",
		createdBy: "efinix-riscv-kit",
		version,
	};
	const encoded = new TextEncoder().encode(JSON.stringify(marker, null, 2) + "\n");
	await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(projectDir, MARKER_FILE), encoded);
}

// Drops the bundled user-presets template into the project unmodified (placeholders
// intact). Each project carrying its own template means later changes to the
// extension's bundled template can't alter or break existing projects.
async function copyUserPresetsTemplate(template_path: vscode.Uri, projectDir: vscode.Uri) {
	const raw = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(template_path, USER_PRESETS_FILE));
	await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(projectDir, USER_PRESETS_TEMPLATE_FILE), raw);
}

async function createProject(template_path: vscode.Uri, store: vscode.Memento, version: string) {
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

	// Ship the unsubstituted user-presets template (for per-machine regeneration)
	// and the marker file identifying this as an Efinix project. createDirectory is
	// idempotent and guards against copyTemplate's target not yet existing.
	await vscode.workspace.fs.createDirectory(realPrjPath);
	await copyUserPresetsTemplate(template_path, realPrjPath);
	await writeMarkerFile(realPrjPath, version);

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



// Scans open folders for Efinix project markers and, for any project missing its
// machine-local CMakeUserPresets.json, prompts to regenerate it. The source is the
// project's own CMakeUserPresets.json.template when present (update-safe), else the
// extension's bundled template.
async function checkProjectsForMissingUserPresets(context: vscode.ExtensionContext) {
	const markers = await vscode.workspace.findFiles(`**/${MARKER_FILE}`);
	for (const marker of markers) {
		const dir = vscode.Uri.joinPath(marker, '..');
		const userPresets = vscode.Uri.joinPath(dir, USER_PRESETS_FILE);
		if (await utils.uriExists(userPresets)) {
			continue;
		}

		const name = path.basename(dir.fsPath);
		const choice = await vscode.window.showInformationMessage(
			`Efinix project '${name}' is missing ${USER_PRESETS_FILE}. Create it now?`,
			{ modal: true }, "Create", "Skip");
		if (choice !== "Create") {
			continue;
		}

		// Regeneration only needs the three tool paths, which configProblems validates.
		const problems = configProblems();
		if (problems.length > 0) {
			await promptConfigureSettings(problems);
			continue;
		}

		// Prefer the project-local template for update-safety; fall back to bundled.
		const localTmpl = vscode.Uri.joinPath(dir, USER_PRESETS_TEMPLATE_FILE);
		const src = await utils.uriExists(localTmpl)
			? localTmpl
			: vscode.Uri.joinPath(context.extensionUri, "resources", "project_template_standalone", USER_PRESETS_FILE);

		const extConfig = vscode.workspace.getConfiguration("efinixRiscvKit");
		const content = new TextDecoder().decode(await vscode.workspace.fs.readFile(src));
		const out = substitutePlaceholders(content, {
			prjName: "",
			bspPath: "",
			openocdPath: extConfig.get<string>('openocdPath') ?? "",
			toolchainPath: extConfig.get<string>('efinityToolchainPath') ?? "",
			efinityPath: extConfig.get<string>('efinityPath') ?? "",
		});
		await vscode.workspace.fs.writeFile(userPresets, new TextEncoder().encode(out));
		utils.showInfo(`Generated ${USER_PRESETS_FILE} for '${name}'.`);
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

		await createProject(
			vscode.Uri.joinPath(context.extensionUri, "resources", "project_template_standalone"),
			context.globalState,
			context.extension.packageJSON.version);
	});

	context.subscriptions.push(validateCmd);
	context.subscriptions.push(templateCmd);

	// The extension activates on `workspaceContains:**/.efinix-riscv-kit`; offer to
	// regenerate CMakeUserPresets.json for any recognized project missing it (e.g.
	// a freshly cloned project where the machine-local file wasn't committed).
	void checkProjectsForMissingUserPresets(context);
}

// This method is called when your extension is deactivated
export function deactivate() { }
