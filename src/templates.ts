// Project template discovery and manifest handling.
//
// A template is a directory containing an `efinix-template.json` manifest plus the
// files to instantiate. The extension ships one bundled template
// (resources/project_template_standalone) and users can register more via the
// `efinixRiscvKit.customTemplatePaths` setting.

import * as vscode from "vscode";
import * as os from "os";
import path from "path";
import * as utils from "./utils";

// Manifest file that marks a directory as a project template.
export const MANIFEST_FILE = "efinix-template.json";

// Placeholder tokens the extension fills in itself; a custom variable may not
// redefine these. Tokens appear in template files wrapped as `__TOKEN__`.
export const RESERVED_TOKENS = [
	"PROJECT_NAME",
	"BSP_DIR",
	"OPENOCD_PATH",
	"TOOLCHAIN_PATH",
	"EFINITY_PATH",
] as const;

const VAR_NAME_RE = /^[A-Z0-9_]+$/;

export interface TemplateVariable {
	// Token name; substituted into files as `__NAME__`.
	name: string;
	// Input-box prompt shown in the wizard.
	prompt: string;
	// Optional longer description (shown as the input placeholder).
	description?: string;
	// Optional default value pre-filled into the input box.
	default?: string;
	// "path" adds a Browse button and forward-slash normalizes the value.
	kind?: "text" | "path";
}

export interface TemplateManifest {
	id?: string;
	name: string;
	description?: string;
	requiresBsp?: boolean;
	requiresToolPaths?: boolean;
	variables?: TemplateVariable[];
}

// A validated, ready-to-use template.
export interface Template {
	id: string;
	name: string;
	description: string;
	requiresBsp: boolean;
	requiresToolPaths: boolean;
	variables: TemplateVariable[];
	rootUri: vscode.Uri;
}

// Expands a leading `~` to the home directory (mirrors checkPath in extension.ts).
function expandHome(p: string): string {
	if (p.startsWith("~")) {
		return path.join(os.homedir(), p.slice(1));
	}
	return p;
}

// Validates a parsed manifest and turns it into a Template, or returns an error
// string describing the first problem found.
function toTemplate(manifest: unknown, rootUri: vscode.Uri): Template | string {
	if (typeof manifest !== "object" || manifest === null) {
		return "manifest is not a JSON object";
	}
	const m = manifest as Partial<TemplateManifest>;
	if (typeof m.name !== "string" || m.name.trim().length === 0) {
		return "manifest is missing a non-empty 'name'";
	}

	const id = (typeof m.id === "string" && m.id.trim().length > 0)
		? m.id.trim()
		: path.basename(rootUri.fsPath);

	const variables: TemplateVariable[] = [];
	for (const v of m.variables ?? []) {
		if (typeof v !== "object" || v === null || typeof v.name !== "string") {
			return "each variable must be an object with a string 'name'";
		}
		if (!VAR_NAME_RE.test(v.name)) {
			return `variable name '${v.name}' must match [A-Z0-9_]+`;
		}
		if ((RESERVED_TOKENS as readonly string[]).includes(v.name)) {
			return `variable name '${v.name}' is reserved`;
		}
		if (typeof v.prompt !== "string" || v.prompt.trim().length === 0) {
			return `variable '${v.name}' is missing a 'prompt'`;
		}
		if (v.kind !== undefined && v.kind !== "text" && v.kind !== "path") {
			return `variable '${v.name}' has invalid kind '${v.kind}'`;
		}
		variables.push({
			name: v.name,
			prompt: v.prompt,
			description: typeof v.description === "string" ? v.description : undefined,
			default: typeof v.default === "string" ? v.default : undefined,
			kind: v.kind ?? "text",
		});
	}

	return {
		id,
		name: m.name,
		description: typeof m.description === "string" ? m.description : "",
		requiresBsp: m.requiresBsp === true,
		requiresToolPaths: m.requiresToolPaths === true,
		variables,
		rootUri,
	};
}

// Reads and validates the manifest at `dir`. Returns the Template on success, or
// null if there is no manifest / it is invalid (an error is surfaced to the user
// in the latter case so a broken custom template doesn't silently disappear).
async function loadTemplate(dir: vscode.Uri): Promise<Template | null> {
	const manifestUri = vscode.Uri.joinPath(dir, MANIFEST_FILE);
	if (!await utils.uriExists(manifestUri)) {
		return null;
	}
	let parsed: unknown;
	try {
		const raw = new TextDecoder().decode(await vscode.workspace.fs.readFile(manifestUri));
		parsed = JSON.parse(raw);
	} catch (err) {
		utils.showError(`Failed to read template manifest at ${dir.fsPath}: ${err}`);
		return null;
	}
	const result = toTemplate(parsed, dir);
	if (typeof result === "string") {
		utils.showError(`Invalid template at ${dir.fsPath}: ${result}`);
		return null;
	}
	return result;
}

// Resolves a single configured path into zero or more templates: the path itself
// if it holds a manifest, otherwise each immediate subdirectory that does (so a
// user can point at a whole "templates library" folder).
async function templatesAtPath(entry: vscode.Uri): Promise<Template[]> {
	if (!await utils.isDirectory(entry)) {
		utils.showError(`Custom template path does not exist or is not a directory: ${entry.fsPath}`);
		return [];
	}
	const direct = await loadTemplate(entry);
	if (direct) {
		return [direct];
	}
	const found: Template[] = [];
	for (const [childName, type] of await vscode.workspace.fs.readDirectory(entry)) {
		if (type === vscode.FileType.Directory) {
			const child = await loadTemplate(vscode.Uri.joinPath(entry, childName));
			if (child) {
				found.push(child);
			}
		}
	}
	return found;
}

// Discovers all available templates: the bundled one plus every valid template
// reachable from `efinixRiscvKit.customTemplatePaths`. De-duped by id (first wins,
// so the bundled template always takes precedence over a custom clash).
export async function discoverTemplates(context: vscode.ExtensionContext): Promise<Template[]> {
	const byId = new Map<string, Template>();

	const bundled = await loadTemplate(
		vscode.Uri.joinPath(context.extensionUri, "resources", "project_template_standalone"));
	if (bundled) {
		byId.set(bundled.id, bundled);
	}

	const config = vscode.workspace.getConfiguration("efinixRiscvKit");
	for (const entry of config.get<string[]>("customTemplatePaths") ?? []) {
		if (!entry || entry.trim().length === 0) {
			continue;
		}
		for (const template of await templatesAtPath(vscode.Uri.file(expandHome(entry)))) {
			if (byId.has(template.id)) {
				utils.showError(
					`Duplicate template id '${template.id}' at ${template.rootUri.fsPath} ignored.`);
				continue;
			}
			byId.set(template.id, template);
		}
	}

	return [...byId.values()];
}
