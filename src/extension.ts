// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import path from 'path';
import * as utils from './utils';
import { MultiStepInput, InputStep } from './multiStepInput';
import { Template, discoverTemplates, MANIFEST_FILE } from './templates';

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

// A map of placeholder token -> replacement value. Tokens appear in template
// files wrapped as `__TOKEN__` (e.g. token "PROJECT_NAME" -> `__PROJECT_NAME__`).
type VariableMap = Map<string, string>;

// Normalizes a path to forward slashes so it is valid inside the generated
// JSON presets file and safe to embed in CMake strings on Windows.
function toCMakePath(p: string): string {
	return p.replace(/\\/g, "/");
}

// Assembles the substitution map for a project-creation run: the always-present
// PROJECT_NAME, the BSP path when the template needs one, the configured tool
// paths when the template needs them, plus each custom variable declared by the
// template (forward-slash normalized when its kind is "path").
function buildVariableMap(
	template: Template,
	prjName: string,
	relativeBsp: string | undefined,
	customVars: VariableMap,
): VariableMap {
	const vars: VariableMap = new Map();
	vars.set("PROJECT_NAME", prjName);
	if (template.requiresBsp && relativeBsp !== undefined) {
		vars.set("BSP_DIR", toCMakePath(relativeBsp));
	}
	if (template.requiresToolPaths) {
		const cfg = vscode.workspace.getConfiguration("efinixRiscvKit");
		vars.set("OPENOCD_PATH", toCMakePath(cfg.get<string>("openocdPath") ?? ""));
		vars.set("TOOLCHAIN_PATH", toCMakePath(cfg.get<string>("efinityToolchainPath") ?? ""));
		vars.set("EFINITY_PATH", toCMakePath(cfg.get<string>("efinityPath") ?? ""));
	}
	for (const v of template.variables) {
		const raw = customVars.get(v.name) ?? v.default ?? "";
		vars.set(v.name, v.kind === "path" ? toCMakePath(raw) : raw);
	}
	return vars;
}

// Replaces the template placeholder tokens (__PROJECT_NAME__, __BSP_DIR__, …) in
// `content` with the concrete values from `vars`. Shared by the project-copy path
// and the on-load CMakeUserPresets regeneration path.
function substitutePlaceholders(content: string, vars: VariableMap): string {
	let result = content;
	vars.forEach((value, token) => {
		result = result.replaceAll(`__${token}__`, value);
	});
	return result;
}

async function copyTemplateFile(template_path: vscode.Uri, target_path: vscode.Uri, vars: VariableMap) {
	const content = await vscode.workspace.fs.readFile(template_path);
	const orig_content = new TextDecoder().decode(content);
	const content_str = substitutePlaceholders(orig_content, vars);

	if (content_str !== orig_content) {
		const encoded = new TextEncoder().encode(content_str);
		vscode.workspace.fs.writeFile(target_path, encoded);
	} else {
		vscode.workspace.fs.copy(template_path, target_path);
	}

}


async function copyTemplateDir(template_path: vscode.Uri, target_path: vscode.Uri, vars: VariableMap) {
	const children = await vscode.workspace.fs.readDirectory(template_path);
	vscode.workspace.fs.createDirectory(target_path);
	children.forEach(item => {
		// The manifest is template metadata; never copy it into a generated project.
		if (item[0] === MANIFEST_FILE) {
			return;
		}
		copyTemplate(vscode.Uri.joinPath(template_path, item[0]), vscode.Uri.joinPath(target_path, item[0]), vars);
	});
}

async function copyTemplate(template_path: vscode.Uri, target_path: vscode.Uri, vars: VariableMap) {
	const source_stat = await vscode.workspace.fs.stat(template_path);
	switch (source_stat.type) {
		case vscode.FileType.File:
			await copyTemplateFile(template_path, target_path, vars);
			break;
		case vscode.FileType.Directory:
			await copyTemplateDir(template_path, target_path, vars);
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
	// Only collected when the chosen template declares requiresBsp.
	bspPath?: vscode.Uri;
}

// The wizard result: the base project config plus the raw values entered for the
// template's custom variables (token name -> value).
interface CollectedConfig {
	config: ProjectConfig;
	customVars: VariableMap;
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

// Runs the guided multi-step wizard for `template`, returning the collected
// configuration or undefined if the user cancelled at any step. The step chain is
// built dynamically: name/base/new-dir are always present, the BSP step only when
// the template requires it, followed by one step per declared custom variable.
async function collectProjectConfig(template: Template, lastBsp?: string): Promise<CollectedConfig | undefined> {
	const title = `Create ${template.name}`;
	const totalSteps = 3 + (template.requiresBsp ? 1 : 0) + template.variables.length;
	const state: Partial<ProjectConfig> = { createNewDir: true };
	const customVars: VariableMap = new Map();

	// When opened from a .code-workspace file, default the base directory to that
	// file's folder and resolve relative paths against it.
	const wsDir = workspaceFileDir();

	// Ordered, dynamically built step chain. Each step returns the next one via
	// `next()`; the array is fully populated before MultiStepInput.run walks it.
	const steps: InputStep[] = [];
	const addStep = (build: (input: MultiStepInput, step: number, next: () => InputStep | void) => Promise<InputStep | void>) => {
		const index = steps.length;
		const displayStep = index + 1;
		steps.push(input => build(input, displayStep, () => steps[index + 1]));
	};

	addStep(async (input, step, next) => {
		state.name = await input.showInputBox({
			title, step, totalSteps,
			value: state.name || '',
			prompt: "Project name",
			placeholder: "my-new-project",
			validate: async value => validateProjectName(value) || undefined,
		});
		return next();
	});

	addStep(async (input, step, next) => {
		const value = await input.showInputBox({
			title, step, totalSteps,
			value: state.basePath ? state.basePath.fsPath : (wsDir?.fsPath ?? ''),
			prompt: "Project base directory",
			placeholder: "/path/to/projects",
			buttons: [browseButton],
			validate: value => validateExistingDir(value, wsDir),
			onButton: async () => pickFolder("Select Project Base Directory"),
		});
		state.basePath = resolvePath(value, wsDir);
		return next();
	});

	addStep(async (input, step, next) => {
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
			title, step, totalSteps,
			placeholder: "Create a new directory for the project?",
			items: [yesItem, noItem],
			activeItem: state.createNewDir === false ? noItem : yesItem,
		});
		state.createNewDir = pick === yesItem;
		return next();
	});

	if (template.requiresBsp) {
		addStep(async (input, step, next) => {
			// An empty field falls back to the last-used BSP (shown grayed out as the
			// placeholder), so a returning user can just press Enter to reuse it.
			const resolveBsp = (value: string) =>
				value.trim().length === 0 && lastBsp ? lastBsp : value;
			const value = await input.showInputBox({
				title, step, totalSteps,
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
			return next();
		});
	}

	for (const variable of template.variables) {
		addStep(async (input, step, next) => {
			const value = await input.showInputBox({
				title, step, totalSteps,
				value: customVars.get(variable.name) ?? variable.default ?? '',
				prompt: variable.prompt,
				placeholder: variable.description ?? '',
				buttons: variable.kind === "path" ? [browseButton] : undefined,
				validate: async () => undefined,
				onButton: variable.kind === "path"
					? async (_button, currentValue) => pickFolder(variable.prompt, currentValue)
					: undefined,
			});
			customVars.set(variable.name, value);
			return next();
		});
	}

	await MultiStepInput.run(steps[0]);

	if (!state.name || !state.basePath || (template.requiresBsp && !state.bspPath)) {
		return undefined;
	}
	return {
		config: {
			name: state.name,
			basePath: state.basePath,
			createNewDir: state.createNewDir ?? true,
			bspPath: state.bspPath,
		},
		customVars,
	};
}

// Writes the project marker file identifying `projectDir` as an Efinix RISC-V Kit
// project created from the template `templateId`. Committed (not gitignored) so
// freshly cloned projects are recognized.
async function writeMarkerFile(projectDir: vscode.Uri, templateId: string, version: string) {
	const marker = {
		type: templateId,
		template: templateId,
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

async function createProject(template: Template, store: vscode.Memento, version: string) {
	const lastBsp = store.get<string>(LAST_BSP_KEY);
	const collected = await collectProjectConfig(template, lastBsp);
	if (!collected) {
		utils.showInfo("Project creation cancelled");
		return;
	}
	const { config, customVars } = collected;

	const realPrjPath = config.createNewDir
		? vscode.Uri.joinPath(config.basePath, config.name)
		: config.basePath;

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

	// All prompts succeeded. Copy template and replace placeholders.
	const relative_bsp = config.bspPath
		? path.relative(realPrjPath.fsPath, config.bspPath.fsPath)
		: undefined;
	const vars = buildVariableMap(template, config.name, relative_bsp, customVars);
	await copyTemplate(template.rootUri, realPrjPath, vars);

	// createDirectory is idempotent and guards against copyTemplate's target not yet
	// existing. Ship the unsubstituted user-presets template (for per-machine
	// regeneration) only for templates that use machine-local presets, then write the
	// marker file identifying this as an Efinix project.
	await vscode.workspace.fs.createDirectory(realPrjPath);
	if (await utils.uriExists(vscode.Uri.joinPath(template.rootUri, USER_PRESETS_FILE))) {
		await copyUserPresetsTemplate(template.rootUri, realPrjPath);
	}
	await writeMarkerFile(realPrjPath, template.id, version);

	// Remember the BSP so the next run can offer it as a grayed-out default.
	if (config.bspPath) {
		await store.update(LAST_BSP_KEY, config.bspPath.fsPath);
	}

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



// Scans open folders for Efinix project markers and, for any project that uses
// machine-local presets (i.e. ships a CMakeUserPresets.json.template) but is
// missing the generated CMakeUserPresets.json, prompts to regenerate it from the
// project's own template. Projects without a local template (e.g. custom templates
// that have no user-presets concept) are left untouched.
async function checkProjectsForMissingUserPresets() {
	const markers = await vscode.workspace.findFiles(`**/${MARKER_FILE}`);
	for (const marker of markers) {
		const dir = vscode.Uri.joinPath(marker, '..');
		const userPresets = vscode.Uri.joinPath(dir, USER_PRESETS_FILE);
		if (await utils.uriExists(userPresets)) {
			continue;
		}

		// Only projects shipping a machine-local presets template use this lifecycle.
		const localTmpl = vscode.Uri.joinPath(dir, USER_PRESETS_TEMPLATE_FILE);
		if (!await utils.uriExists(localTmpl)) {
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

		const extConfig = vscode.workspace.getConfiguration("efinixRiscvKit");
		const content = new TextDecoder().decode(await vscode.workspace.fs.readFile(localTmpl));
		const out = substitutePlaceholders(content, new Map([
			["OPENOCD_PATH", toCMakePath(extConfig.get<string>('openocdPath') ?? "")],
			["TOOLCHAIN_PATH", toCMakePath(extConfig.get<string>('efinityToolchainPath') ?? "")],
			["EFINITY_PATH", toCMakePath(extConfig.get<string>('efinityPath') ?? "")],
		]));
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
		const templates = await discoverTemplates(context);
		if (templates.length === 0) {
			utils.showError("No project templates available.");
			return;
		}

		// One template: use it directly. More than one: let the user pick.
		let template = templates[0];
		if (templates.length > 1) {
			const pick = await vscode.window.showQuickPick(
				templates.map(t => ({ label: t.name, detail: t.description, template: t })),
				{ title: "Create Project", placeHolder: "Select a project template" });
			if (!pick) {
				return;
			}
			template = pick.template;
		}

		// Only templates that use the configured Efinity tool paths require them.
		if (template.requiresToolPaths) {
			const problems = configProblems();
			if (problems.length > 0) {
				await promptConfigureSettings(problems);
				return;
			}
		}

		await createProject(template, context.globalState, context.extension.packageJSON.version);
	});

	context.subscriptions.push(validateCmd);
	context.subscriptions.push(templateCmd);

	// The extension activates on `workspaceContains:**/.efinix-riscv-kit`; offer to
	// regenerate CMakeUserPresets.json for any recognized project missing it (e.g.
	// a freshly cloned project where the machine-local file wasn't committed).
	void checkProjectsForMissingUserPresets();
}

// This method is called when your extension is deactivated
export function deactivate() { }
