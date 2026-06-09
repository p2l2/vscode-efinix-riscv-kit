import * as vscode from "vscode";

export function showError(msg: string) {
	vscode.window.showErrorMessage(`Efinix RISC-V Kit: ${msg}`);
}

export function showInfo(msg: string) {
	vscode.window.showInformationMessage(`Efinix RISC-V Kit: ${msg}`);
}

export async function uriExists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}

export async function isEmptyDir(uri: vscode.Uri): Promise<boolean> {
	try {
		const stats = await vscode.workspace.fs.stat(uri);
		if (stats.type === vscode.FileType.Directory) {
			const contents = await vscode.workspace.fs.readDirectory(uri);
			return contents.length === 0;
		} else {
			return false;
		}
	} catch {
		return false;
	}
}
