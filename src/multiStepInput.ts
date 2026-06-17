// Multi-step QuickInput helper.
//
// Adapted from the official VSCode extension samples
// (microsoft/vscode-extension-samples, "quickinput-sample" / multiStepInput.ts),
// which is distributed under the MIT License. Extended here to let an input-box
// step expose custom buttons (e.g. a "Browse…" button) that are handled by the
// caller without dismissing the step.

import { QuickInput, QuickInputButton, QuickInputButtons, QuickPickItem, ThemeIcon, window } from 'vscode';

export class InputFlowAction {
	static back = new InputFlowAction();
	static cancel = new InputFlowAction();
	static resume = new InputFlowAction();
}

export type InputStep = (input: MultiStepInput) => Thenable<InputStep | void>;

interface QuickPickParameters<T extends QuickPickItem> {
	title: string;
	step: number;
	totalSteps: number;
	items: T[];
	activeItem?: T;
	placeholder: string;
	buttons?: QuickInputButton[];
	shouldResume?: () => Thenable<boolean>;
}

interface InputBoxParameters {
	title: string;
	step: number;
	totalSteps: number;
	value: string;
	prompt: string;
	placeholder?: string;
	buttons?: QuickInputButton[];
	validate: (value: string) => Promise<string | undefined>;
	/**
	 * Invoked when one of the custom `buttons` is triggered. Return a new value to
	 * write back into the input box (e.g. a path chosen from a folder picker), or
	 * `undefined` to leave the value unchanged. The step is NOT dismissed.
	 */
	onButton?: (button: QuickInputButton, currentValue: string) => Promise<string | undefined>;
	shouldResume?: () => Thenable<boolean>;
}

export class MultiStepInput {

	static async run(start: InputStep) {
		const input = new MultiStepInput();
		return input.stepThrough(start);
	}

	private current?: QuickInput;
	private steps: InputStep[] = [];

	private async stepThrough(start: InputStep) {
		let step: InputStep | void = start;
		while (step) {
			this.steps.push(step);
			if (this.current) {
				this.current.enabled = false;
				this.current.busy = true;
			}
			try {
				step = await step(this);
			} catch (err) {
				if (err === InputFlowAction.back) {
					this.steps.pop();
					step = this.steps.pop();
				} else if (err === InputFlowAction.resume) {
					step = this.steps.pop();
				} else if (err === InputFlowAction.cancel) {
					step = undefined;
				} else {
					throw err;
				}
			}
		}
		if (this.current) {
			this.current.dispose();
		}
	}

	async showQuickPick<T extends QuickPickItem, P extends QuickPickParameters<T>>(
		{ title, step, totalSteps, items, activeItem, placeholder, buttons, shouldResume }: P) {
		const disposables: { dispose(): void }[] = [];
		try {
			return await new Promise<T>((resolve, reject) => {
				const input = window.createQuickPick<T>();
				input.title = title;
				input.step = step;
				input.totalSteps = totalSteps;
				// Keep the wizard open when focus moves elsewhere (e.g. when a
				// native folder picker is opened from a step). Escape still hides it.
				input.ignoreFocusOut = true;
				input.placeholder = placeholder;
				input.items = items;
				if (activeItem) {
					input.activeItems = [activeItem];
				}
				input.buttons = [
					...(step > 1 ? [QuickInputButtons.Back] : []),
					...(buttons || [])
				];
				disposables.push(
					input.onDidTriggerButton(item => {
						if (item === QuickInputButtons.Back) {
							reject(InputFlowAction.back);
						}
					}),
					input.onDidChangeSelection(selected => resolve(selected[0])),
					input.onDidHide(() => {
						(async () => {
							reject(shouldResume && await shouldResume() ? InputFlowAction.resume : InputFlowAction.cancel);
						})().catch(reject);
					})
				);
				if (this.current) {
					this.current.dispose();
				}
				this.current = input;
				this.current.show();
			});
		} finally {
			disposables.forEach(d => d.dispose());
		}
	}

	async showInputBox<P extends InputBoxParameters>(
		{ title, step, totalSteps, value, prompt, placeholder, buttons, validate, onButton, shouldResume }: P) {
		const disposables: { dispose(): void }[] = [];
		try {
			return await new Promise<string>((resolve, reject) => {
				const input = window.createInputBox();
				input.title = title;
				input.step = step;
				input.totalSteps = totalSteps;
				// Keep the wizard open when focus moves elsewhere (e.g. when a
				// native folder picker is opened from the Browse button). Escape
				// still hides it.
				input.ignoreFocusOut = true;
				input.value = value || '';
				input.prompt = prompt;
				input.placeholder = placeholder;
				input.buttons = [
					...(step > 1 ? [QuickInputButtons.Back] : []),
					...(buttons || [])
				];
				let validating = validate('');
				// Runs validation for the given text and shows the message, guarding
				// against out-of-order results from concurrent validations.
				const revalidate = async (text: string) => {
					const current = validate(text);
					validating = current;
					const validationMessage = await current;
					if (current === validating) {
						input.validationMessage = validationMessage;
					}
				};
				disposables.push(
					input.onDidTriggerButton(item => {
						if (item === QuickInputButtons.Back) {
							reject(InputFlowAction.back);
						} else if (onButton) {
							input.busy = true;
							input.enabled = false;
							onButton(item, input.value)
								.then(newValue => {
									if (newValue !== undefined) {
										input.value = newValue;
										// Programmatic value changes don't fire
										// onDidChangeValue, so refresh validation here.
										return revalidate(newValue);
									}
								})
								.catch(reject)
								.finally(() => {
									input.busy = false;
									input.enabled = true;
								});
						}
					}),
					input.onDidAccept(async () => {
						const currentValue = input.value;
						input.enabled = false;
						input.busy = true;
						if (!(await validate(currentValue))) {
							resolve(currentValue);
						}
						input.enabled = true;
						input.busy = false;
					}),
					input.onDidChangeValue(revalidate),
					input.onDidHide(() => {
						(async () => {
							reject(shouldResume && await shouldResume() ? InputFlowAction.resume : InputFlowAction.cancel);
						})().catch(reject);
					})
				);
				if (this.current) {
					this.current.dispose();
				}
				this.current = input;
				this.current.show();
			});
		} finally {
			disposables.forEach(d => d.dispose());
		}
	}
}

export { QuickInputButtons, ThemeIcon };
