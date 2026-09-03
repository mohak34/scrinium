/**
 * LaTeX completion source for math regions.
 *
 * Fires only on a `\word` trigger directly before the cursor, and only when
 * the cursor is inside math: a ```math / $$ block (via findMathBlockRanges)
 * or an unclosed single `$` on the current line. Code is excluded via the
 * syntax tree, so `\` in ```python never completes.
 *
 * Registered through the markdown language's data facet (see
 * markdownLanguage() in markdownSetup.ts) so the built-in HTML-tag
 * completion keeps working - `override` would have replaced it.
 */

import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import { inMathRegion } from './mathRanges';

interface MathEntry {
	/** Shown and typed text, with leading backslash. */
	label: string;
	/** Right-side hint. */
	detail: string;
	/** Full text to insert (defaults to label). */
	insert?: string;
	/** Cursor offset from `from` after insert (brace placement). */
	cursor?: number;
}

// Curated for lecture notes: Greek, big operators, relations, arrows,
// std functions, symbols, delimiters. Only \frac / \sqrt / \sum / \text
// place the cursor inside braces - everything else inserts plainly.
const LATEX_COMMANDS: MathEntry[] = [
	{ label: '\\frac', detail: 'fraction', insert: '\\frac{}{}', cursor: 6 },
	{ label: '\\sqrt', detail: 'square root', insert: '\\sqrt{}', cursor: 6 },
	{ label: '\\sum', detail: '∑ summation', insert: '\\sum_{}^{}', cursor: 6 },
	{ label: '\\text', detail: 'upright text', insert: '\\text{}', cursor: 6 },
	{ label: '\\prod', detail: '∏ product' },
	{ label: '\\int', detail: '∫ integral' },
	{ label: '\\oint', detail: '∮ contour integral' },
	{ label: '\\lim', detail: 'limit' },
	{ label: '\\binom', detail: 'binomial coefficient' },
	{ label: '\\alpha', detail: 'Greek α' },
	{ label: '\\beta', detail: 'Greek β' },
	{ label: '\\gamma', detail: 'Greek γ' },
	{ label: '\\delta', detail: 'Greek δ' },
	{ label: '\\epsilon', detail: 'Greek ε' },
	{ label: '\\varepsilon', detail: 'Greek ε variant' },
	{ label: '\\zeta', detail: 'Greek ζ' },
	{ label: '\\eta', detail: 'Greek η' },
	{ label: '\\theta', detail: 'Greek θ' },
	{ label: '\\iota', detail: 'Greek ι' },
	{ label: '\\kappa', detail: 'Greek κ' },
	{ label: '\\lambda', detail: 'Greek λ' },
	{ label: '\\mu', detail: 'Greek μ' },
	{ label: '\\nu', detail: 'Greek ν' },
	{ label: '\\xi', detail: 'Greek ξ' },
	{ label: '\\pi', detail: 'Greek π' },
	{ label: '\\rho', detail: 'Greek ρ' },
	{ label: '\\sigma', detail: 'Greek σ' },
	{ label: '\\tau', detail: 'Greek τ' },
	{ label: '\\phi', detail: 'Greek φ' },
	{ label: '\\varphi', detail: 'Greek φ variant' },
	{ label: '\\chi', detail: 'Greek χ' },
	{ label: '\\psi', detail: 'Greek ψ' },
	{ label: '\\omega', detail: 'Greek ω' },
	{ label: '\\Gamma', detail: 'Greek Γ' },
	{ label: '\\Delta', detail: 'Greek Δ' },
	{ label: '\\Theta', detail: 'Greek Θ' },
	{ label: '\\Lambda', detail: 'Greek Λ' },
	{ label: '\\Xi', detail: 'Greek Ξ' },
	{ label: '\\Pi', detail: 'Greek Π' },
	{ label: '\\Sigma', detail: 'Greek Σ' },
	{ label: '\\Phi', detail: 'Greek Φ' },
	{ label: '\\Psi', detail: 'Greek Ψ' },
	{ label: '\\Omega', detail: 'Greek Ω' },
	{ label: '\\leq', detail: '≤ less-equal' },
	{ label: '\\geq', detail: '≥ greater-equal' },
	{ label: '\\neq', detail: '≠ not equal' },
	{ label: '\\approx', detail: '≈ approximately' },
	{ label: '\\equiv', detail: '≡ equivalent' },
	{ label: '\\sim', detail: '∼ similar' },
	{ label: '\\simeq', detail: '≃ similar equal' },
	{ label: '\\propto', detail: '∝ proportional' },
	{ label: '\\perp', detail: '⊥ perpendicular' },
	{ label: '\\parallel', detail: '∥ parallel' },
	{ label: '\\in', detail: '∈ in set' },
	{ label: '\\notin', detail: '∉ not in set' },
	{ label: '\\subset', detail: '⊂ subset' },
	{ label: '\\subseteq', detail: '⊆ subset-equal' },
	{ label: '\\supset', detail: '⊃ superset' },
	{ label: '\\supseteq', detail: '⊇ superset-equal' },
	{ label: '\\cup', detail: '∪ union' },
	{ label: '\\cap', detail: '∩ intersection' },
	{ label: '\\setminus', detail: '\\ set difference' },
	{ label: '\\times', detail: '× cross' },
	{ label: '\\div', detail: '÷ divide' },
	{ label: '\\pm', detail: '± plus-minus' },
	{ label: '\\mp', detail: '∓ minus-plus' },
	{ label: '\\cdot', detail: '⋅ centered dot' },
	{ label: '\\circ', detail: '∘ compose' },
	{ label: '\\to', detail: '→ to' },
	{ label: '\\rightarrow', detail: '→ right arrow' },
	{ label: '\\leftarrow', detail: '← left arrow' },
	{ label: '\\Rightarrow', detail: '⇒ implies' },
	{ label: '\\Leftarrow', detail: '⇐ implied by' },
	{ label: '\\Leftrightarrow', detail: '⇔ iff' },
	{ label: '\\mapsto', detail: '↦ maps to' },
	{ label: '\\uparrow', detail: '↑ up arrow' },
	{ label: '\\downarrow', detail: '↓ down arrow' },
	{ label: '\\sin', detail: 'sine' },
	{ label: '\\cos', detail: 'cosine' },
	{ label: '\\tan', detail: 'tangent' },
	{ label: '\\log', detail: 'logarithm' },
	{ label: '\\ln', detail: 'natural log' },
	{ label: '\\exp', detail: 'exponential' },
	{ label: '\\max', detail: 'maximum' },
	{ label: '\\min', detail: 'minimum' },
	{ label: '\\det', detail: 'determinant' },
	{ label: '\\infty', detail: '∞ infinity' },
	{ label: '\\partial', detail: '∂ partial' },
	{ label: '\\nabla', detail: '∇ nabla' },
	{ label: '\\forall', detail: '∀ for all' },
	{ label: '\\exists', detail: '∃ exists' },
	{ label: '\\emptyset', detail: '∅ empty set' },
	{ label: '\\angle', detail: '∠ angle' },
	{ label: '\\triangle', detail: '△ triangle' },
	{ label: '\\ldots', detail: '… low dots' },
	{ label: '\\cdots', detail: '⋯ centered dots' },
	{ label: '\\vdots', detail: '⋮ vertical dots' },
	{ label: '\\ddots', detail: '⋱ diagonal dots' },
	{ label: '\\quad', detail: 'wide space' },
	{ label: '\\hat', detail: 'x̂ hat accent' },
	{ label: '\\bar', detail: 'x̄ bar accent' },
	{ label: '\\vec', detail: 'x⃗ vector accent' },
	{ label: '\\dot', detail: 'ẋ dot accent' },
	{ label: '\\ddot', detail: 'ẍ double dot' },
	{ label: '\\tilde', detail: 'x̃ tilde accent' },
	{ label: '\\left', detail: 'auto-sized open delimiter' },
	{ label: '\\right', detail: 'auto-sized close delimiter' },
	{ label: '\\langle', detail: '⟨ left angle bracket' },
	{ label: '\\rangle', detail: '⟩ right angle bracket' },
	{ label: '\\lceil', detail: '⌈ left ceiling' },
	{ label: '\\rceil', detail: '⌉ right ceiling' },
	{ label: '\\lfloor', detail: '⌊ left floor' },
	{ label: '\\rfloor', detail: '⌋ right floor' },
	{ label: '\\mid', detail: '∣ divides' }
];

const TRIGGER = /\\[A-Za-z]*$/;

export function mathCompletionSource(context: CompletionContext): CompletionResult | null {
	const { state, pos } = context;
	const line = state.doc.lineAt(pos);
	const before = line.text.slice(0, pos - line.from);
	const trigger = TRIGGER.exec(before);
	if (!trigger) return null;
	if (!inMathRegion(state, pos)) return null;
	const from = pos - trigger[0].length;

	return {
		from,
		options: LATEX_COMMANDS.map((e) => ({
			label: e.label,
			detail: e.detail,
			apply:
				e.insert === undefined
					? undefined
					: (view: EditorView, _completion: unknown, afrom: number, ato: number) => {
							view.dispatch({
								changes: { from: afrom, to: ato, insert: e.insert as string },
								selection: { anchor: afrom + (e.cursor ?? (e.insert as string).length) }
							});
						}
		})),
		validFor: TRIGGER
	};
}
